import { readFile } from 'node:fs/promises';
import { collectionSlugs, collections } from '../lib/constants.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { ArchiveOwnershipReader, metadataLookupId } from '../lib/metadata/source/bindings.js';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ release: { type: 'string' } });
async function main() {
    const release = String(args.release ?? ''), progress = JSON.parse(await readFile('docs/metadata-migration/bindings.json', 'utf8'));
    if (progress.release !== release || collectionSlugs.some(c => !progress.collections[c]?.complete))
        throw new Error('Finish the mapping scan before acceptance');
    const { pool, env } = await postgresFrom(String(args['env-file'])), schema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA), reader = new ArchiveOwnershipReader(pool, release, env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA, true);
    try {
        const coverage = (await pool.query(`SELECT t.collection,count(*)::text AS indexed,count(b.asset_key)::text AS bound,
   count(*) FILTER(WHERE b.asset_key IS NULL)::text AS unbound FROM ${schema}.token t LEFT JOIN metadata_source.asset_binding b
   ON b.release_id=$1 AND b.network='eip155' AND b.chain_id=t.chain_id::text AND b.contract_address=lower(t.contract_address) AND b.token_id=t.token_id GROUP BY t.collection`, [release])).rows;
        const missing = (await pool.query(`SELECT t.collection,t.token_id,t.burned,m.token_uri,m.fetch_status FROM ${schema}.token t LEFT JOIN metadata_source.asset_binding b
   ON b.release_id=$1 AND b.network='eip155' AND b.chain_id=t.chain_id::text AND b.contract_address=lower(t.contract_address) AND b.token_id=t.token_id
   LEFT JOIN metadata.token_metadata m ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
   WHERE b.asset_key IS NULL ORDER BY t.collection,t.token_id`, [release])).rows;
        const gaps = [];
        for (const row of missing) {
            let legacyStatus = 'check_failed', httpStatus: number | null = null;
            try {
                const id = metadataLookupId(row.token_uri), response = await fetch(`http://127.0.0.1:9001/meta?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
                httpStatus = response.status;
                const text = await response.text();
                let body: any;
                try {
                    body = JSON.parse(text);
                }
                catch { }
                legacyStatus = body && typeof body.name === 'string' ? 'metadata_exists' : response.status === 404 ? 'not_found' : response.ok && body?.message ? 'message_only' : text.includes('NFT is burned') ? 'burned_rejection' : 'other_response';
            }
            catch { }
            const ownership = await reader.token(row.collection, row.token_id);
            gaps.push({ collection: row.collection, tokenId: row.token_id, burned: row.burned, cachedStatus: row.fetch_status, legacyStatus, httpStatus,
                ownershipAvailable: Boolean(ownership && ownership.metadataStatus === 'binding_unavailable' && (row.burned ? ownership.owner === null : ownership.owner)), ownerAtBlock: ownership?.ownerAtBlock });
        }
        const complete = coverage.length === Object.keys(collections).length && gaps.every(g => g.cachedStatus === 'not_found' && ['not_found', 'message_only', 'burned_rejection'].includes(g.legacyStatus) && g.ownershipAvailable);
        const report = { release, observedAt: new Date().toISOString(), complete, coverage, gaps,
            scope: 'Current indexed Ethereum/Base/Polygon/BNB tokens. Legacy metadata gaps remain explicit; ownership reads do not depend on metadata availability.' };
        await writeReport('docs/metadata-migration/binding-validation.json', report);
        console.log(JSON.stringify({ complete, coverage, gaps: gaps.length, unresolved: gaps.filter(g => !g.ownershipAvailable || !['not_found', 'message_only', 'burned_rejection'].includes(g.legacyStatus)) }));
        if (!complete)
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
