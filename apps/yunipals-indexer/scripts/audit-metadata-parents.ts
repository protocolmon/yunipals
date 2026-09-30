import { ArchiveReader } from '../lib/metadata/source/read.js';
import { historicalOriginIds, renderRainbowOrigins } from '../lib/metadata/render/origins.js';
import { decodeSource } from '../lib/metadata/source/ejson.js';
import { assetKey, archiveReleaseId, canonicalJson } from '../lib/metadata/source/canonical.js';
import { lockCandidate } from '../lib/metadata/source/archive.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ release: { type: 'string' } });
async function main() {
    const release = archiveReleaseId(String(args.release ?? '')), { pool } = await postgresFrom(String(args['env-file']));
    try {
        const reader = new ArchiveReader(pool, release, true);
        const rows = (await pool.query(`SELECT r.source_key,r.asset_key,r.namespace,r.content_hash,b.payload FROM metadata_source.source_record r
   JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.origin_type='GEN1_RAINBOW_FUSION' ORDER BY r.namespace,r.source_key`, [release])).rows;
        const relations = new Map<string, {
            asset: string;
            position: number;
            parent: string;
            inputs: unknown;
        }>(), failures: unknown[] = [];
        let checked = 0, totalParents = 0;
        for (const row of rows)
            try {
                const source = decodeSource(row.payload), ids = historicalOriginIds(source), parents = [];
                for (const [position, id] of ids.entries()) {
                    const parent = await reader.byAsset(assetKey('GEN1', id));
                    parents.push(decodeSource(parent.payload));
                    const relation = { asset: row.asset_key, position, parent: parent.assetKey, inputs: { childHash: row.content_hash, parentHash: parent.hash, parentId: id } };
                    const key = canonicalJson([row.asset_key, position]);
                    const old = relations.get(key);
                    if (old && old.parent !== relation.parent)
                        throw new Error('Conflicting parent identity');
                    relations.set(key, relation);
                }
                renderRainbowOrigins(ids, parents);
                checked++;
                totalParents += ids.length;
            }
            catch (e) {
                failures.push({ namespace: row.namespace, key: row.source_key, error: e instanceof Error ? e.name : 'error' });
            }
        if (!failures.length) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await lockCandidate(client, release);
                await client.query(`INSERT INTO metadata_source.asset_origin(release_id,asset_key,relation,position,parent_asset_key,original_inputs)
    SELECT $1,asset,'rainbow',position,parent,inputs FROM jsonb_to_recordset($2::jsonb) AS x(asset text,position integer,parent text,inputs jsonb)
    ON CONFLICT(release_id,asset_key,relation,position) DO UPDATE SET original_inputs=EXCLUDED.original_inputs WHERE metadata_source.asset_origin.parent_asset_key=EXCLUDED.parent_asset_key`, [release, JSON.stringify([...relations.values()])]);
                const actual = (await client.query(`SELECT asset_key AS asset,position,parent_asset_key AS parent FROM metadata_source.asset_origin WHERE release_id=$1 AND relation='rainbow'`, [release])).rows;
                if (actual.length !== relations.size || actual.some(row => relations.get(canonicalJson([row.asset, row.position]))?.parent !== row.parent))
                    throw new Error('Parent projection conflict');
                await client.query('COMMIT');
            }
            catch (e) {
                await client.query('ROLLBACK');
                throw e;
            }
            finally {
                client.release();
            }
        }
        const report = { release, observedAt: new Date().toISOString(), records: rows.length, checked, parentReferences: totalParents, uniqueRelations: relations.size, failures };
        await writeReport('docs/metadata-migration/parent-validation.json', report);
        console.log(JSON.stringify(report));
        if (failures.length)
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
