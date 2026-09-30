import type { Pool } from "pg";
import { lockCandidate } from "./archive.js";
import { projectExomonAliases } from "./supplemental.js";
/** Rebuild captured lookup decisions using only archived evidence. */
export async function projectLegacyLookups(pool: Pool, release: string, qualified = false) {
    if (!qualified)
        await projectExomonAliases(pool, release);
    const namespace = qualified ? "legacy.family-lookup-decisions" : "legacy.lookup-decisions", aliasNamespace = qualified ? "legacy-family" : "legacy-meta", client = await pool.connect();
    let inserted = 0;
    try {
        await client.query("BEGIN");
        await lockCandidate(client, release);
        await client.query("SELECT pg_advisory_xact_lock(hashtext('metadata-source-aliases'),hashtext($1))", [release]);
        const invalid = await client.query(`SELECT 1 FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
    LEFT JOIN metadata_source.source_record target ON target.release_id=r.release_id
     AND target.namespace=b.payload->>'sourceNamespace' AND target.source_key=b.payload->>'sourceKey'
    WHERE r.release_id=$1 AND r.namespace=$2 AND (target.source_key IS NULL OR target.content_hash IS DISTINCT FROM b.payload->>'sourceHash'
     OR target.asset_key IS DISTINCT FROM b.payload->>'assetKey' OR target.family IS DISTINCT FROM b.payload->>'family' OR target.issue IS NOT NULL) LIMIT 1`, [release, namespace]);
        if (invalid.rowCount)
            throw new Error("Captured lookup target is missing or changed");
        const conflict = await client.query(`SELECT 1 FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
    JOIN metadata_source.lookup_alias a ON a.release_id=r.release_id AND a.namespace=$3 AND a.alias=b.payload->>'alias'
     AND (NOT $4 OR a.family=b.payload->>'family')
    WHERE r.release_id=$1 AND r.namespace=$2 AND a.asset_key<>b.payload->>'assetKey'
     AND ($4 OR NOT EXISTS(SELECT 1 FROM metadata_source.source_record ex WHERE ex.release_id=r.release_id AND ex.namespace='legacy.exomon-aliases' AND ex.source_key=a.alias)) LIMIT 1`, [release, namespace, aliasNamespace, qualified]);
        if (conflict.rowCount)
            throw new Error("Existing lookup projection conflicts with captured evidence");
        const result = await client.query(`INSERT INTO metadata_source.lookup_alias(release_id,namespace,alias,family,asset_key)
    SELECT $1,$3,b.payload->>'alias',b.payload->>'family',b.payload->>'assetKey'
    FROM metadata_source.source_record r JOIN metadata_source.source_blob b USING(content_hash)
    JOIN metadata_source.source_record target ON target.release_id=r.release_id
      AND target.namespace=b.payload->>'sourceNamespace' AND target.source_key=b.payload->>'sourceKey'
      AND target.content_hash=b.payload->>'sourceHash' AND target.asset_key=b.payload->>'assetKey' AND target.issue IS NULL
    WHERE r.release_id=$1 AND r.namespace=$2
      AND NOT EXISTS (SELECT 1 FROM metadata_source.lookup_alias a WHERE a.release_id=$1 AND a.namespace=$3 AND a.alias=b.payload->>'alias' AND (NOT $4 OR a.family=b.payload->>'family'))
    ON CONFLICT DO NOTHING`, [release, namespace, aliasNamespace, qualified]);
        inserted = result.rowCount ?? 0;
        await client.query("COMMIT");
    }
    catch (e) {
        await client.query("ROLLBACK");
        throw e;
    }
    finally {
        client.release();
    }
    return inserted;
}
