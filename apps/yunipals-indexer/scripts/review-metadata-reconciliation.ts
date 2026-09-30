import { readFile } from 'node:fs/promises';
import { contentHash, canonicalJson } from '../lib/metadata/source/canonical.js';
import { argumentsOf, legacyMongo, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ input: { type: 'string', default: 'docs/metadata-migration/reconciliation.json' },
    output: { type: 'string', default: 'docs/metadata-migration/reconciliation-review.json' } });
function paths(a: any, b: any, path = '$'): string[] {
    if (a === b)
        return [];
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b))
        return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(k => paths(a[k], b[k], `${path}.${k}`));
    return [path];
}
async function main() {
    const report = JSON.parse(await readFile(String(args.input), 'utf8'));
    if (report.state !== 'complete')
        throw new Error('Finish the full reconciliation before reviewing its acceptance');
    const experimental=JSON.parse(await readFile('docs/metadata-migration/experimental-validation.json','utf8'));
    if(experimental.release!==report.release||!experimental.complete)throw new Error('Experimental source audit is incomplete');
    const entries = (await readFile(`${args.input}.changes.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const unique = [...new Map(entries.map(row => [canonicalJson([row.namespace, row.key, row.kind]), row])).values()];
    for (const [namespace, audit] of Object.entries(report.sources) as [
        string,
        any
    ][])
        for (const [kind, count] of Object.entries(audit.counts))
            if (kind !== 'equal' && unique.filter(r => r.namespace === namespace && r.kind === kind).length !== count)
                throw new Error('Difference journal does not match completed reconciliation counts');
    const { pool } = await postgresFrom(String(args['env-file'])), mongo = await legacyMongo(String(args['legacy-root']));
    try {
        const reviewed = [];
        for (const row of unique) {
            const archived = (await pool.query(`SELECT r.content_hash,b.payload FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
    WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key=$3`, [report.release, row.namespace, row.key])).rows[0];
            const current = await mongo.db.collection(row.namespace.replace(/^nfts\./, '')).findOne({ _id: new mongo.driver.ObjectId(row.key) });
            let disposition = 'requires_review', details: any = {};
            if (row.key === '633d632455fa724a34c4a879' && ['identity:missing_asset_identity', 'missing_render_inputs'].includes(row.kind) && archived?.payload && !archived.payload.genId && !archived.payload.nft?.id) {
                disposition = 'quarantined_legacy_orphan';
                details = { rawHash: archived.content_hash };
            }
            else if(row.kind==='missing_render_inputs'&&archived&&experimental.records.some((r:any)=>r.namespace===row.namespace&&r.key===row.key&&r.hash===archived.content_hash&&r.legacyError&&r.localError&&!r.bound)){
                disposition='preserved_legacy_experimental_record';details={rawHash:archived.content_hash};
            }
            else if (archived && current && ['metadata_changed', 'ownership_projection_changed'].includes(row.kind)) {
                const serialized = mongo.driver.BSON.EJSON.serialize(current, { relaxed: false }), changedPaths = paths(archived.payload, serialized);
                const ownerRoots = ['ownerAddress', 'ownerSince', 'delegateeAddress', 'delegateeSince', 'chain', 'minted', 'bridged', 'optimisticChange', 'ownerAddressSnapshot'];
                const ownerChanges = changedPaths.some(p => ownerRoots.includes(p.split('.')[1]));
                const onlyProjection = changedPaths.every(p => [...ownerRoots, 'updatedAt'].includes(p.split('.')[1]));
                if (ownerChanges && onlyProjection)
                    disposition = 'ownership_projection_and_bookkeeping_only';
                else if (!changedPaths.length)
                    disposition = 'no_longer_differs_requires_review';
                details = { archivedHash: archived.content_hash, sourceHashAtReview: contentHash(serialized), changedPaths };
            }
            reviewed.push({ ...row, disposition, ...details });
        }
        const invalidCounts = Object.values(report.sources as Record<string, any>).some(s => s.state !== 'complete' || String(s.count) !== s.expectedCount || s.rollingHash !== s.expectedHash);
        const result = { release: report.release, reviewedAt: new Date().toISOString(), scanStartedAt: report.startedAt, scanFinishedAt: report.updatedAt,
            consistency: report.consistency,
            rawRecords: Object.values(report.sources as Record<string, any>).reduce((n, s) => n + s.count, 0), journalEntries: entries.length, uniqueDifferences: reviewed.length,
            accepted: !invalidCounts && reviewed.every(r => ['quarantined_legacy_orphan', 'preserved_legacy_experimental_record', 'ownership_projection_and_bookkeeping_only'].includes(r.disposition)), reviewed };
        await writeReport(String(args.output), result);
        console.log(JSON.stringify(result));
        if (!result.accepted)
            process.exitCode = 2;
    }
    finally {
        await mongo.client.close();
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
