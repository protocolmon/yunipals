import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectionSlugs } from '../lib/constants.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { chainReadiness } from '../lib/metadata/chain-readiness.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';

const args = argumentsOf({ release: { type: 'string' }, output: { type: 'string' },
  execute: { type: 'boolean', default: false } });

async function main() {
  assert.ok(args.execute, 'Production derived refresh requires --execute');
  assert.ok(typeof args.release === 'string' && typeof args.output === 'string');
  assert.equal(process.env.METADATA_SOURCE_MODE, 'archive');
  assert.equal(process.env.RARITY_READ_SOURCE, 'local');
  await assert.rejects(readFile(args.output), { code: 'ENOENT' }, 'Refuse to overwrite refresh receipt');
  const expected = JSON.parse(await readFile('docs/metadata-migration/step-4-publication.json', 'utf8'));
  assert.equal(expected.release, args.release);
  assert.equal(expected.complete, true);
  const { pool, env } = await postgresFrom(String(args['env-file']));
  try {
    const database = String((await pool.query('SELECT current_database() AS name')).rows[0].name);
    assert.ok(!database.startsWith('metadata_archive_test_'));
    assert.equal((await pool.query("SELECT release_id FROM metadata_source.archive_release WHERE state='active'")).rows[0]?.release_id, args.release);
    assert.equal((await chainReadiness(pool)).ready, true, 'Four-chain readiness');
    const runtime = (await pool.query('SELECT base_error FROM metadata.publication_runtime WHERE singleton=true')).rows[0];
    assert.equal(runtime?.base_error, null, 'Base replay error');
    assert.ok((await pool.query("SELECT 1 FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1' AND next_block>target_block")).rowCount);
    const unfinished = (await pool.query(`SELECT status,count(*)::int AS n FROM metadata.publication_job
      WHERE release_id=$1 AND status IN ('pending','publishing','retry','reconciliation_required') GROUP BY status`, [args.release])).rows;
    assert.deepEqual(unfinished, [], 'Publication queue is not drained');
    const readSchema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA);
    const tokens = (await pool.query(`SELECT collection,count(*)::int AS n FROM ${readSchema}.token GROUP BY collection`)).rows;
    const publications = (await pool.query(`SELECT collection,publication_status,count(*)::int AS n
      FROM metadata.token_publication WHERE release_id=$1 GROUP BY collection,publication_status`, [args.release])).rows;
    assert.equal(publications.reduce((sum: number, row: { n: number }) => sum + row.n, 0),
      tokens.reduce((sum: number, row: { n: number }) => sum + row.n, 0), 'Canonical publication coverage');
    assert.ok(publications.every((row: { publication_status: string }) =>
      row.publication_status === 'published' || row.publication_status === 'unavailable'), 'Unexpected publication status');
    for (const collection of collectionSlugs) {
      const total = tokens.find((row: { collection: string }) => row.collection === collection)?.n;
      const expectedCounts = expected.collections[collection].counts;
      assert.equal(total, expectedCounts.published + (expectedCounts.binding_unavailable ?? 0), `${collection} indexed total changed`);
      assert.equal(publications.find((row: { collection: string; publication_status: string }) =>
        row.collection === collection && row.publication_status === 'published')?.n, expectedCounts.published, `${collection} published coverage`);
      assert.equal(publications.find((row: { collection: string; publication_status: string }) =>
        row.collection === collection && row.publication_status === 'unavailable')?.n ?? 0,
      expectedCounts.binding_unavailable ?? 0, `${collection} reviewed binding gaps`);
    }
    const unexplained = (await pool.query(`SELECT count(*)::int AS n FROM metadata.token_publication
      WHERE release_id=$1 AND publication_status='unavailable'
        AND (asset_key IS NOT NULL OR publication_error IS NULL OR publication_error NOT IN ('source_missing','binding_unavailable'))`, [args.release])).rows[0].n;
    assert.equal(unexplained, 0, 'Unreviewed unavailable publications');
    const { refreshTraitIndex, refreshLeaderboard } = await import('../lib/leaderboard/refresh.js');
    const startedAt = new Date().toISOString();
    const traits = await refreshTraitIndex();
    const leaderboard = await refreshLeaderboard();
    const snapshots = (await pool.query(`SELECT name,metadata_release_id,updated_at FROM metadata.derived_snapshot
      WHERE name IN ('traits','leaderboard') ORDER BY name`)).rows;
    assert.equal(snapshots.length, 2);
    assert.ok(snapshots.every((row: { metadata_release_id: string }) => row.metadata_release_id === args.release));
    const checks = (await pool.query(`SELECT
      (SELECT count(*)::int FROM metadata.token_search WHERE metadata_available) AS searchable,
      (SELECT count(*)::int FROM metadata.token_publication WHERE release_id=$1 AND publication_status='published') AS published,
      (SELECT count(*)::int FROM ${readSchema}.token WHERE NOT burned) AS active_tokens,
      (SELECT sum(monster_count)::int FROM leaderboard.wallet_stats WHERE scope='all') AS leaderboard_tokens,
      (SELECT count(*)::int FROM metadata.market_catalog_trait_pending) AS catalog_pending`, [args.release])).rows[0];
    assert.equal(checks.searchable, checks.published);
    assert.equal(checks.leaderboard_tokens, checks.active_tokens);
    assert.equal(checks.catalog_pending, 0);
    const receipt = { format: 'metadata-cutover-derived-v1', database, release: args.release,
      startedAt, finishedAt: new Date().toISOString(), traits, leaderboard, snapshots, checks, complete: true };
    await writeReport(args.output, receipt);
    console.log(JSON.stringify({ complete: true, checks }));
  } finally {
    await pool.end();
    const runtime = await import('../lib/offchain/db.js').catch(() => null);
    if (runtime) { await runtime.pool.end(); await runtime.apiPool.end(); }
  }
}

main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
