import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { legacyMetadataRouter } from '../lib/api/legacy-metadata.js';
import { LocalMetadataReader } from '../lib/metadata/resolve.js';
import { argumentsOf, environmentFrom, safeFailure, writeReport } from './metadata/support.js';

const args = argumentsOf({ release: { type: 'string' }, requests: { type: 'string', default: '600' },
  rps: { type: 'string', default: '100' }, concurrency: { type: 'string', default: '24' },
  'sample-source': { type: 'string', default: 'fixture' },
  output: { type: 'string', default: 'docs/metadata-migration/step-5-candidate-load.json' } });

async function main() {
  const release = String(args.release ?? ''), requests = Number(args.requests),
    rps = Number(args.rps), concurrency = Number(args.concurrency);
  assert.match(release, /^metadata-[a-z0-9-]+$/);
  assert.ok(Number.isSafeInteger(requests) && requests > 0 && requests <= 6000);
  assert.ok(Number.isSafeInteger(rps) && rps > 0 && rps <= 120);
  assert.ok(Number.isSafeInteger(concurrency) && concurrency > 0 && concurrency <= 48);
  const env = await environmentFrom(String(args['env-file']));
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 12,
    application_name: 'metadata_cutover_readonly_benchmark', connectionTimeoutMillis: 1000,
    statement_timeout: 10000, lock_timeout: 2000 });
  const fetchOriginal = globalThis.fetch;
  let forbiddenRequests = 0;
  globalThis.fetch = async () => { forbiddenRequests++; throw new Error('Candidate benchmark external HTTP forbidden'); };
  try {
    const releaseRow = await pool.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state IN ('candidate','validated')", [release]);
    assert.equal(releaseRow.rowCount, 1, 'Only a non-active candidate can be benchmarked');
    const sampleSource = String(args['sample-source']);
    assert.ok(['fixture', 'archive', 'archive-spread'].includes(sampleSource));
    let ids: string[];
    if (sampleSource !== 'fixture') {
      const sample = sampleSource === 'archive-spread' ? 'TABLESAMPLE SYSTEM (0.2) REPEATABLE (27)' : '';
      const order = sampleSource === 'archive' ? 'ORDER BY source_key' : '';
      const rows = await pool.query(`SELECT legacy_id FROM metadata_source.source_record ${sample}
        WHERE release_id=$1 AND namespace='nfts.pmonCollection' AND NOT source_burned
          AND issue IS NULL AND legacy_id ~ '^[0-9]+$'
        ${order} LIMIT $2`, [release, Math.min(requests * 3, 6000)]);
      ids = [...new Set(rows.rows.map(row => String(row.legacy_id)))].slice(0, requests);
      assert.ok(ids.length >= Math.min(requests, 100), 'Insufficient distinct archived IDs');
    } else {
      const corpus = JSON.parse(await readFile('docs/metadata-migration/public-comparison.json', 'utf8'));
      assert.equal(corpus.release, release);
      ids = corpus.results.filter((row: any) => row.status === 'matched').map((row: any) => String(row.id));
    }
    assert.ok(ids.length >= 10);
    const reader = new LocalMetadataReader(pool, env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA, { releaseId: release, candidate: true });
    const app = legacyMetadataRouter(reader);
    const active = new Set<Promise<void>>(), latencies: number[] = [], statuses: Record<string, number> = {};
    const started = performance.now();
    for (let index = 0; index < requests; index++) {
      while (active.size >= concurrency) await Promise.race(active);
      const scheduled = started + index * 1000 / rps;
      const delay = scheduled - performance.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      const began = performance.now(), id = ids[index % ids.length];
      const task = (async () => {
        try {
          const response = await app.request(`/meta?id=${encodeURIComponent(id)}`);
          await response.arrayBuffer();
          statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
        } catch { statuses.error = (statuses.error ?? 0) + 1; }
        latencies.push(performance.now() - began);
      })();
      active.add(task);
      void task.finally(() => active.delete(task));
    }
    await Promise.all(active);
    latencies.sort((a, b) => a - b);
    const elapsedSeconds = (performance.now() - started) / 1000;
    const result = { format: 'metadata-candidate-readonly-load-v1', checkedAt: new Date().toISOString(),
      release, requests, targetRps: rps, maxConcurrency: concurrency, poolMax: 12,
      elapsedSeconds, achievedRps: requests / elapsedSeconds, sampleIds: ids.length, sampleSource,
      latencyMs: { p50: latencies[Math.floor(latencies.length * .5)], p95: latencies[Math.floor(latencies.length * .95)],
        p99: latencies[Math.floor(latencies.length * .99)], max: latencies.at(-1) },
      statuses, forbiddenRequests, productionWrites: 0,
      limitation: 'In-process candidate router and production PostgreSQL; excludes Nginx, TLS and actual public-client mix.' };
    await writeReport(String(args.output), result);
    console.log(JSON.stringify(result));
    if (statuses['200'] !== requests || forbiddenRequests || result.achievedRps < rps * .9) process.exitCode = 2;
  } finally { globalThis.fetch = fetchOriginal; await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
