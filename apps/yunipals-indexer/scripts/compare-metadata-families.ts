import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ArchiveReader } from '../lib/metadata/source/read.js';
import { decodeSource } from '../lib/metadata/source/ejson.js';
import { archiveReleaseId, canonicalJson, contentHash } from '../lib/metadata/source/canonical.js';
import { comparisonDocument } from '../lib/metadata/render/compare.js';
import * as pureUtilities from '../lib/metadata/render/legacy.cjs';
import { argumentsOf, postgresFrom, safeFailure, writeReport } from './metadata/support.js';
const args = argumentsOf({ release: { type: 'string' }, 'reuse-samples': { type: 'boolean', default: false } });
async function main() {
    const release = archiveReleaseId(String(args.release ?? '')), { pool } = await postgresFrom(String(args['env-file']));
    try {
        // Execute the deployed reference factory with only the pinned pure utilities.
        // Loading the old package root would initialize unrelated native dependencies.
        const factorySource = await readFile(join(String(args['legacy-root']), 'node_modules/@polkamon/feature-nft-transformation/src/lib/utils/transformer/legacyMetadataFactory.js'), 'utf8');
        const reference: any = {};
        runInNewContext(factorySource, { exports: reference, require: (name: string) => {
                if (!['@polkamon/web3-util-core', '@polkamon/web3-util-pmons'].includes(name))
                    throw new Error('Unexpected reference dependency');
                return pureUtilities;
            } });
        const factory = new reference.LegacyMetadataFactory(), reader = new ArchiveReader(pool, release, true);
        const groups = args['reuse-samples'] ? JSON.parse(await readFile('docs/metadata-migration/family-comparison.json', 'utf8')).results :
            (await pool.query(`WITH samples AS(SELECT namespace,family,origin_type,chain_id,min(source_key) AS source_key,count(*)::text AS records
   FROM metadata_source.source_record WHERE release_id=$1 AND namespace IN ('nfts.pmonCollection','nfts.pmonCollectionBurned') AND issue IS NULL
   GROUP BY namespace,family,origin_type,chain_id)
   SELECT s.*,r.asset_key,r.legacy_id FROM samples s JOIN metadata_source.source_record r ON r.release_id=$1 AND r.namespace=s.namespace AND r.source_key=s.source_key
   ORDER BY s.family,s.origin_type,s.chain_id,s.namespace`, [release])).rows;
        const results = [];
        for (const item of groups) {
            const { namespace, family, origin_type, chain_id, source_key, records, asset_key, legacy_id } = item;
            const result: any = { namespace, family, origin_type, chain_id, source_key, records, asset_key, legacy_id };
            try {
                const stored = await reader.byAsset(asset_key), decoded = decodeSource(stored.payload) as any;
                const projected = { ...decoded, nft: Object.fromEntries(Object.keys(reference.MandatoryNftProjection.nft).filter(k => decoded.nft[k] !== undefined).map(k => [k, decoded.nft[k]])) };
                let expected: any;
                try {
                    expected = JSON.parse(JSON.stringify(factory.envelopeToLegacy(projected)));
                }
                catch (e) {
                    result.referenceError = e instanceof Error ? e.name : 'Error';
                }
                try {
                    const actual = (await reader.snapshotByAsset(asset_key, false, true)).document;
                    // Historical rainbow enrichment is checked exhaustively by the parent audit.
                    const factoryFields = { ...actual };
                    delete factoryFields.originIds;
                    delete factoryFields.origins;
                    delete factoryFields.originScore;
                    result.referenceStatus = expected && canonicalJson(comparisonDocument(factoryFields)) === canonicalJson(comparisonDocument(expected)) ? 'matched' : 'mismatch';
                    if (result.referenceStatus === 'mismatch')
                        result.referenceDifferentFields = [...new Set([...Object.keys(factoryFields), ...Object.keys(expected ?? {})])].filter(k => JSON.stringify(comparisonDocument(factoryFields[k])) !== JSON.stringify(comparisonDocument(expected?.[k])));
                }
                catch (e) {
                    result.localError = e instanceof Error ? e.name : 'Error';
                    result.referenceStatus = result.referenceError ? 'unrenderable_in_legacy' : 'mismatch';
                }
                const numeric = /^\d+$/.test(legacy_id);
                const response = await fetch(numeric ? 'http://127.0.0.1:9001/v1/getMetasById' : `http://127.0.0.1:9001/meta?id=${encodeURIComponent(legacy_id)}`, { signal: AbortSignal.timeout(20000), redirect: 'error', ...(numeric ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [legacy_id], genIdType: family }) } : {}) });
                result.httpStatus = response.status;
                const bodyText = await response.text();
                if (!response.ok) {
                    result.httpStatusKind = bodyText.includes('NFT is burned') ? 'legacy_burned_rejection' : bodyText.includes('Invalid') || bodyText.includes('invalid') ? 'legacy_invalid_id' : 'legacy_http_failure';
                }
                else {
                    const body = JSON.parse(bodyText), legacy = numeric ? body[0] : body;
                    if (!legacy || typeof legacy.name !== 'string') {
                        result.httpStatusKind = 'legacy_message_only';
                        results.push(result);
                        continue;
                    }
                    const selected = await reader.lookup(legacy_id, numeric ? family : undefined);
                    const actual = (await reader.snapshotByAsset(selected.assetKey, !numeric, numeric)).document;
                    result.selectedAsset = selected.assetKey;
                    result.httpStatusKind = legacy && canonicalJson(comparisonDocument(actual)) === canonicalJson(comparisonDocument(legacy)) ? 'matched' : 'mismatch';
                }
            }
            catch (e) {
                result.error = e instanceof Error ? e.name : 'error';
            }
            results.push(result);
        }
        const report = { release, observedAt: new Date().toISOString(), referenceFactoryHash: contentHash(factorySource),
            sampling: 'One record per live/burned source, family, origin and chain group; complete raw validation and rainbow parent audit are separate', results };
        await writeReport('docs/metadata-migration/family-comparison.json', report);
        console.log(JSON.stringify({ groups: results.length, referenceMatched: results.filter(r => r.referenceStatus === 'matched').length, httpMatched: results.filter(r => r.httpStatusKind === 'matched').length, exceptions: results.filter(r => r.referenceStatus !== 'matched' || r.httpStatusKind !== 'matched').map(r => ({ family: r.family, origin: r.origin_type, reference: r.referenceStatus, http: r.httpStatusKind, fields: r.referenceDifferentFields, error: r.error })) }));
        if (results.some(r => r.referenceStatus === 'mismatch' || r.httpStatusKind === 'mismatch' || r.error))
            process.exitCode = 2;
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
