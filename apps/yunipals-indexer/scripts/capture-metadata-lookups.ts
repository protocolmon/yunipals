import { projectLegacyLookups } from "../lib/metadata/source/lookups.js";
import { beginSource, commitSourceBatch, type ArchiveRecord } from "../lib/metadata/source/archive.js";
import { archiveReleaseId, contentHash } from "../lib/metadata/source/canonical.js";
import { sourceIdentity } from "../lib/metadata/source/identity.js";
import { sourceDifference } from "../lib/metadata/source/reconcile.js";
import { argumentsOf, legacyMongo, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
const args = argumentsOf({ release: { type: "string" }, "project-only": { type: "boolean", default: false }, qualified: { type: "boolean", default: false } });
async function main() {
    const release = archiveReleaseId(String(args.release ?? "")), namespace = args.qualified ? "legacy.family-lookup-decisions" : "legacy.lookup-decisions", { pool } = await postgresFrom(String(args["env-file"]));
    if (args["project-only"]) {
        try {
            console.log(JSON.stringify({ inserted: await projectLegacyLookups(pool, release, Boolean(args.qualified)) }));
        }
        finally {
            await pool.end();
        }
        return;
    }
    const mongo = await legacyMongo(String(args["legacy-root"]));
    try {
        const choices = (await pool.query(args.qualified ? `SELECT legacy_id AS id,family FROM metadata_source.source_record
    WHERE release_id=$1 AND legacy_id IS NOT NULL AND asset_key IS NOT NULL GROUP BY legacy_id,family
    HAVING min(asset_key)<>max(asset_key) ORDER BY legacy_id,family` : `SELECT legacy_id AS id FROM metadata_source.source_record
    WHERE release_id=$1 AND legacy_id IS NOT NULL AND asset_key IS NOT NULL GROUP BY legacy_id
    HAVING min(asset_key)<>max(asset_key) ORDER BY legacy_id`, [release])).rows;
        const byKey = new Map(choices.map(row => [args.qualified ? JSON.stringify([row.id, row.family]) : row.id, row]));
        const ids = [...byKey.keys()].sort();
        const run = await beginSource(pool, release, namespace, { format: "verified-legacy-findOne-v1", idsHash: contentHash(ids) }, ids.at(-1) ?? null);
        let cursor = run.cursor as string | null;
        if (!ids.length && run.state === "running")
            await commitSourceBatch(pool, release, namespace, null, null, [], true);
        if (run.state === "running")
            for (const key of ids.filter(id => !cursor || id > cursor)) {
                const { id, family } = byKey.get(key)!;
                const query = { "nft.id": id, ...(args.qualified ? { "genId.type": family } : {}) };
                let sourceName = "pmonCollection", doc = await mongo.db.collection(sourceName).findOne(query);
                if (!doc) {
                    sourceName = "pmonCollectionBurned";
                    doc = await mongo.db.collection(sourceName).findOne(query);
                }
                if (!doc)
                    throw new Error("Ambiguous archive ID no longer exists at its source");
                const identity = sourceIdentity(doc);
                if (identity.issue)
                    throw new Error("Legacy winner has an unresolved identity");
                const target = (await pool.query(`SELECT r.content_hash,b.payload,r.asset_key FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
    WHERE r.release_id=$1 AND r.namespace=$2 AND r.source_key=$3`, [release, `nfts.${sourceName}`, String(doc._id)])).rows[0];
                if (!target || target.asset_key !== identity.assetKey || sourceDifference(target.payload, mongo.driver.BSON.EJSON.serialize(doc, { relaxed: false })) === "metadata_changed")
                    throw new Error("Legacy lookup changed its metadata target");
                const record: ArchiveRecord = { key, payload: { alias: id, family: identity.family, assetKey: identity.assetKey,
                        sourceNamespace: `nfts.${sourceName}`, sourceKey: String(doc._id), sourceHash: target.content_hash, rule: "legacy findOne(nft.id), live collection before burned" },
                    assetKey: null, legacyId: null, family: null, chainId: null, originType: null, burned: null, issue: null };
                await commitSourceBatch(pool, release, namespace, cursor, key, [record], key === ids.at(-1));
                cursor = key;
            }
        const inserted = await projectLegacyLookups(pool, release, Boolean(args.qualified));
        const report = { release, ambiguousIds: ids.length, inserted, observedAt: new Date().toISOString(), precedence: args.qualified ? "Captured family-qualified Mongo lookup decisions; public Exomon aliases do not participate" : "Existing Exomon aliases first, then captured legacy Mongo lookup decisions" };
        await writeReport(args.qualified ? "docs/metadata-migration/family-lookup-validation.json" : "docs/metadata-migration/lookup-validation.json", report);
        console.log(JSON.stringify(report));
    }
    finally {
        await mongo.client.close();
        await pool.end();
    }
}
main().catch(e => { console.error(safeFailure(e)); process.exitCode = 1; });
