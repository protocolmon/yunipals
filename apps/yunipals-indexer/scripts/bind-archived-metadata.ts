import { readFile } from "node:fs/promises";
import { collectionSlugs, collections, ZERO_ADDRESS, type CollectionSlug } from "../lib/constants.js";
import { sqlIdentifier } from "../lib/offchain/sql.js";
import { archiveReleaseId } from "../lib/metadata/source/canonical.js";
import { metadataLookupId, verifyBinding, storeBindings, type BindingInput } from "../lib/metadata/source/bindings.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
const args = argumentsOf({ release: { type: "string" }, resume: { type: "boolean", default: false }, output: { type: "string", default: "docs/metadata-migration/bindings.json" } });
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
type Progress = {
    cursor: string;
    scanned: number;
    bound: number;
    issues: Record<string, number>;
    examples: Record<string, string[]>;
    complete: boolean;
};
async function main() {
    const release = archiveReleaseId(String(args.release ?? "")), output = String(args.output), { pool, env } = await postgresFrom(String(args["env-file"]));
    const schema = sqlIdentifier(env.READ_DATABASE_SCHEMA ?? env.DATABASE_SCHEMA);
    let report: {
        release: string;
        schema: string;
        observedAt: string;
        collections: Partial<Record<CollectionSlug, Progress>>;
    } = { release, schema, observedAt: "", collections: {} };
    if (args.resume) {
        report = JSON.parse(await readFile(output, "utf8"));
        if (report.release !== release || report.schema !== schema)
            throw new Error("Binding checkpoint changed");
    }
    try {
        for (const collection of collectionSlugs) {
            const progress = report.collections[collection] ??= { cursor: "", scanned: 0, bound: 0, issues: {}, examples: {}, complete: false };
            if (progress.complete)
                continue;
            const note = (issue: string, id: string) => { progress.issues[issue] = (progress.issues[issue] ?? 0) + 1; const examples = progress.examples[issue] ??= []; if (examples.length < 25)
                examples.push(id); };
            while (!stopping) {
                const rows = (await pool.query(`WITH candidates AS MATERIALIZED(SELECT * FROM ${schema}.token WHERE collection=$1 AND token_id>$2 ORDER BY token_id LIMIT 1000)
    SELECT t.chain_id AS "chainId",t.contract_address AS "contractAddress",t.token_id AS "tokenId",t.lifecycle,t.burned,
    m.token_uri AS "tokenUri",m.uri_provenance AS "uriProvenance",m.document->>'id' AS "documentId",m.name AS "documentName",m.fetch_status AS "fetchStatus",
    l.mint_transaction_hash AS "mintTransactionHash",e.log_index AS "mintLogIndex",e.count AS "mintCount"
    FROM candidates t LEFT JOIN metadata.token_metadata m ON m.collection=t.collection AND m.token_id=t.token_id::numeric AND m.lifecycle=t.lifecycle
    LEFT JOIN LATERAL(SELECT mint_transaction_hash,mint_block,collection,token_id,lifecycle FROM ${schema}.token_lifecycle
     WHERE collection=$1 AND token_id=t.token_id AND lifecycle=t.lifecycle OFFSET 0) l ON true
    LEFT JOIN LATERAL(SELECT min(mint.log_index) AS log_index,count(*)::int AS count FROM ${schema}.transfer_event mint
     WHERE mint.collection=l.collection AND mint.token_id=l.token_id AND mint.lifecycle=l.lifecycle AND mint.transaction_hash=l.mint_transaction_hash
     AND mint.block_number=l.mint_block AND mint."from"=$3) e ON true
    ORDER BY t.token_id`, [collection, progress.cursor, ZERO_ADDRESS])).rows;
                if (!rows.length) {
                    progress.complete = true;
                    break;
                }
                const requested = rows.map(row => { try {
                    return { ...row, id: metadataLookupId(row.tokenUri) };
                }
                catch {
                    return { ...row, id: null };
                } });
                const ids = [...new Set(requested.filter(row => row.id).map(row => row.id))];
                const matches = (await pool.query(`WITH ids AS(SELECT unnest($2::text[]) AS id), candidates AS(
    SELECT ids.id,r.asset_key,r.content_hash,r.family,r.legacy_id,r.source_burned,r.source_key FROM ids
    JOIN metadata_source.source_record r ON r.release_id=$1 AND r.legacy_id=ids.id AND r.asset_key IS NOT NULL AND r.issue IS NULL
    WHERE NOT EXISTS(SELECT 1 FROM metadata_source.lookup_alias a WHERE a.release_id=$1 AND a.namespace='legacy-meta' AND a.alias=ids.id)
    UNION ALL
    SELECT ids.id,r.asset_key,r.content_hash,r.family,r.legacy_id,r.source_burned,r.source_key FROM ids
    JOIN metadata_source.lookup_alias a ON a.release_id=$1 AND a.namespace='legacy-meta' AND a.alias=ids.id
    JOIN metadata_source.source_record r ON r.release_id=$1 AND r.asset_key=a.asset_key AND r.issue IS NULL
   ) SELECT DISTINCT ON(id,asset_key) * FROM candidates ORDER BY id,asset_key,source_burned,source_key`, [release, ids])).rows;
                const byId = new Map<string, typeof matches>();
                for (const match of matches) {
                    const list = byId.get(match.id) ?? [];
                    list.push(match);
                    byId.set(match.id, list);
                }
                const good: BindingInput[] = [];
                for (const row of requested) {
                    progress.scanned++;
                    const options = byId.get(row.id) ?? [];
                    if (!row.id) {
                        note("unsupported_uri", row.tokenId);
                        continue;
                    }
                    if (options.length !== 1) {
                        note(options.length ? "ambiguous_asset" : row.fetchStatus === "not_found" ? "legacy_metadata_not_found" : "archive_asset_missing", row.tokenId);
                        continue;
                    }
                    if (row.mintCount !== 1) {
                        note("invalid_mint_anchor_count", row.tokenId);
                        continue;
                    }
                    const source = options[0], input = { ...row, collection, assetKey: source.asset_key, sourceHash: source.content_hash, sourceLegacyId: source.legacy_id, family: source.family };
                    try {
                        verifyBinding(input);
                        good.push(input);
                    }
                    catch (error) {
                        note(error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_binding", row.tokenId);
                    }
                }
                await storeBindings(pool, release, good);
                progress.bound += good.length;
                progress.cursor = rows.at(-1)!.tokenId;
                report.observedAt = new Date().toISOString();
                await writeReport(output, report);
                if (progress.scanned % 20000 === 0)
                    console.log(JSON.stringify({ collection, ...progress }));
            }
            report.observedAt = new Date().toISOString();
            await writeReport(output, report);
            console.log(JSON.stringify({ collection, ...progress }));
            if (stopping)
                break;
        }
    }
    finally {
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
