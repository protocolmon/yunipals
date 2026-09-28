import type { Pool } from "pg";
import { z } from "zod";
import { assetKey, contentHash } from "./canonical.js";
import { beginSource, commitSourceBatch, lockCandidate, type ArchiveRecord } from "./archive.js";

export const aliasNamespace = "legacy.exomon-aliases";
export const staticNamespace = "legacy.static-island-metadata";
const aliasSchema = z.object({ alias: z.string().regex(/^\d+$/),
  targetId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/), family: z.literal("GEN1") }).strict();
const emptyIdentity = { assetKey: null, legacyId: null, family: null, chainId: null,
  originType: null, burned: null, issue: null };

export function exomonAliasRecords(value: unknown): ArchiveRecord[] {
  const mapping = z.record(z.string()).parse(value);
  const targets = new Set<string>();
  return Object.keys(mapping).sort().map(alias => {
    const payload = aliasSchema.parse({ alias, targetId: mapping[alias], family: "GEN1" });
    if (targets.has(payload.targetId)) throw new Error("Duplicate Exomon mint mapping");
    targets.add(payload.targetId);
    // These are lookup inputs, not NFT envelopes; keep them out of asset lookup.
    return { key: alias, payload, ...emptyIdentity };
  });
}

export function islandDocumentRecord(id: string, body: unknown): ArchiveRecord {
  if (!["10000000", "20000000"].includes(id)) throw new Error("Unknown static island document");
  const document = z.object({ name: z.string().min(1), description: z.string().min(1), image: z.string().url() }).strict().parse(body);
  return { key: `grassland/${id}`, payload: { type: "grassland", id, status: 200, document }, ...emptyIdentity };
}

/** Fixed, sorted inputs whose digest must remain unchanged across a resume. */
export async function importSupplemental(pool: Pool, release: string, namespace: string, records: ArchiveRecord[], provenance: unknown) {
  if (!records.length || records.some((record, i) => i > 0 && record.key <= records[i-1].key)) {
    throw new Error("Supplemental inputs must be nonempty, unique and sorted");
  }
  const descriptor = { format: "supplemental-json-v1", inputHash: contentHash(records), provenance };
  const run = await beginSource(pool, release, namespace, descriptor, records.at(-1)!.key);
  if (run.state === "scanned" || run.state === "reconciled") return { records: Number(run.count), state: run.state };
  let cursor = run.cursor as string | null;
  const imported = Number(run.count);
  if (!Number.isSafeInteger(imported) || imported > records.length || (imported ? records[imported-1].key !== cursor : cursor !== null)) {
    throw new Error("Supplemental source checkpoint disagrees with input");
  }
  for (let offset = imported; offset < records.length; offset += 500) {
    const batch = records.slice(offset, offset + 500), next = batch.at(-1)!.key;
    await commitSourceBatch(pool, release, namespace, cursor, next, batch, offset + batch.length === records.length);
    cursor = next;
  }
  return { records: records.length, state: "scanned" };
}

/** Rebuildable projection from archived inputs; never creates an unverified target. */
export async function projectExomonAliases(pool: Pool, release: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCandidate(client, release);
    // Only one alias projector may inspect and extend this release at a time.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('metadata-source-aliases'),hashtext($1))", [release]);
    const run = await client.query(`SELECT state FROM metadata_source.import_run WHERE release_id=$1 AND namespace=$2`, [release,aliasNamespace]);
    if (!["scanned", "reconciled"].includes(run.rows[0]?.state)) throw new Error("Alias source scan is incomplete");
    const rows = await client.query(`SELECT b.payload FROM metadata_source.source_record r
      JOIN metadata_source.source_blob b USING(content_hash) WHERE r.release_id=$1 AND r.namespace=$2 ORDER BY r.source_key`, [release,aliasNamespace]);
    const aliases = rows.rows.map(row => {
      const value = aliasSchema.parse(row.payload);
      return { ...value, assetKey: assetKey(value.family,value.targetId) };
    });
    const encoded = JSON.stringify(aliases);
    const conflict = await client.query(`SELECT 1 FROM metadata_source.lookup_alias a
      JOIN jsonb_to_recordset($2::jsonb) AS x(alias text,"assetKey" text) USING(alias)
      WHERE a.release_id=$1 AND a.namespace='legacy-meta' AND a.asset_key<>x."assetKey" LIMIT 1`, [release,encoded]);
    if (conflict.rowCount) throw new Error("Archived aliases conflict with a previous mapping");
    const verified = await client.query(`WITH inputs AS (
        SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(alias text,family text,"targetId" text,"assetKey" text)
      ), targets AS (
        SELECT x.* FROM inputs x WHERE EXISTS (
          SELECT 1 FROM metadata_source.source_record r WHERE r.release_id=$1 AND r.asset_key=x."assetKey"
          AND r.namespace IN ('nfts.pmonCollection','nfts.pmonCollectionBurned')
          AND r.family=x.family AND r.legacy_id=x."targetId" AND r.chain_id='mainnet-beta'
          AND r.origin_type='GEN1_EXOMON_DROP' AND r.issue IS NULL
        )
      ), inserted AS (
        INSERT INTO metadata_source.lookup_alias(release_id,namespace,alias,family,asset_key)
        SELECT $1,'legacy-meta',alias,family,"assetKey" FROM targets ON CONFLICT DO NOTHING RETURNING 1
      ) SELECT (SELECT count(*)::int FROM targets) AS verified,(SELECT count(*)::int FROM inserted) AS inserted`, [release,encoded]);
    await client.query("COMMIT");
    return { aliases: aliases.length, ...verified.rows[0], unresolved: aliases.length - verified.rows[0].verified };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
