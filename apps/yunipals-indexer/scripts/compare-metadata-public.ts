import { readFile } from 'node:fs/promises';
import { ArchiveReader } from '../lib/metadata/source/read.js';
import { canonicalJson } from '../lib/metadata/source/canonical.js';
import { comparisonDocument } from '../lib/metadata/render/compare.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ release: { type: 'string' } });
async function main() {
    const release = String(args.release ?? ''), families = JSON.parse(await readFile('docs/metadata-migration/family-comparison.json', 'utf8'));
    if (families.release !== release)
        throw new Error('Family sample release mismatch');
    const ids = [...new Set<string>([...families.results.map((r: any) => r.legacy_id), '1000002005569'])], { pool } = await postgresFrom(String(args['env-file']));
    try {
        const reader = new ArchiveReader(pool, release, true), results = [];
        for (const id of ids)
            try {
                const response = await fetch(`http://127.0.0.1:9001/meta?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' }), body: any = await response.json();
                if (!response.ok || typeof body?.name !== 'string') {
                    results.push({ id, status: 'legacy_unavailable', httpStatus: response.status, messageOnly: Boolean(body?.message) });
                    continue;
                }
                const snapshot = await reader.snapshot(id), a: any = comparisonDocument(snapshot.document), b: any = comparisonDocument(body);
                const matched = canonicalJson(a) === canonicalJson(b), differentFields = matched ? [] : [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
                results.push({ id, assetKey: snapshot.assetKey, status: matched ? 'matched' : 'mismatch', differentFields });
            }
            catch (e) {
                results.push({ id, status: 'error', error: e instanceof Error ? e.name : 'Error' });
            }
        const report = { release, observedAt: new Date().toISOString(), selection: 'Unqualified public lookups for every distinct family sample ID plus a numeric Exomon alias', results };
        await writeReport('docs/metadata-migration/public-comparison.json', report);
        console.log(JSON.stringify({ samples: results.length, matched: results.filter(r => r.status === 'matched').length, exceptions: results.filter(r => r.status !== 'matched') }));
        if (results.some(r => ['mismatch', 'error'].includes(r.status)))
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
