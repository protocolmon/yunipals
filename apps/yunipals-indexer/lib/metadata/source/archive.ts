import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { archiveReleaseId, canonicalJson, contentHash } from "./canonical.js";

export type ArchiveRecord = {
  key: string;
  payload: unknown;
  assetKey: string | null;
  legacyId: string | null;
  family: string | null;
  chainId: string | null;
  originType: string | null;
  burned: boolean | null;
  issue: string | null;
};

export async function ensureCandidate(pool: Pool, id: string, manifest: unknown) {
  archiveReleaseId(id);
  await pool.query(`INSERT INTO metadata_source.archive_release(release_id,manifest)
    VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING`, [id, canonicalJson(manifest)]);
  const result = await pool.query("SELECT state, manifest FROM metadata_source.archive_release WHERE release_id=$1", [id]);
  if (result.rows[0]?.state !== "candidate") throw new Error("Archive release is not writable");
  if (canonicalJson(result.rows[0].manifest) !== canonicalJson(manifest)) throw new Error("Archive manifest changed; select a new release");
}

export async function lockCandidate(client: PoolClient, release: string) {
  const result = await client.query("SELECT state FROM metadata_source.archive_release WHERE release_id=$1 FOR SHARE", [release]);
  if (result.rows[0]?.state !== "candidate") throw new Error("Archive release is not a writable candidate");
}

export async function beginSource(pool: Pool, release: string, namespace: string, descriptor: unknown, upperBound: unknown) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCandidate(client, release);
    await client.query(`INSERT INTO metadata_source.import_run(release_id,namespace,source_descriptor,upper_bound)
      VALUES ($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT DO NOTHING`,
    [release, namespace, canonicalJson(descriptor), canonicalJson(upperBound)]);
    const result = await client.query(`SELECT cursor, upper_bound AS "upperBound", rows_imported::text AS count,
      state,source_descriptor AS descriptor FROM metadata_source.import_run WHERE release_id=$1 AND namespace=$2`, [release,namespace]);
    if (canonicalJson(result.rows[0].descriptor) !== canonicalJson(descriptor)) throw new Error("Source descriptor changed; use a new release");
    await client.query("COMMIT");
    return result.rows[0] as {cursor: unknown; upperBound: unknown; count: string; state: string};
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function commitSourceBatch(pool: Pool, release: string, namespace: string,
  expectedCursor: unknown, cursor: unknown, records: ArchiveRecord[], finished = false) {
  const prepared = records.map(record => ({ ...record, hash: contentHash(record.payload) }));
  if (new Set(prepared.map(record => record.key)).size !== prepared.length) throw new Error("Duplicate source keys in batch");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockCandidate(client, release);
    const result = await client.query(`SELECT cursor, rolling_hash AS hash, state FROM metadata_source.import_run
      WHERE release_id=$1 AND namespace=$2 FOR UPDATE`, [release,namespace]);
    const run = result.rows[0];
    if (!run || run.state !== "running" || canonicalJson(run.cursor) !== canonicalJson(expectedCursor)) {
      throw new Error("Import cursor changed; reload checkpoint before retrying");
    }
    let rollingHash: string = run.hash;
    if (prepared.length) {
      // Hash the source once, and send its large payload only to the blob
      // insert. Re-parsing every envelope for the small pointer/checkpoint
      // statements needlessly multiplies database work on million-row imports.
      const blobs = JSON.stringify(prepared.map(({ hash, payload }) => ({ hash, payload })));
      const json = JSON.stringify(prepared.map(({ payload: _payload, ...record }) => record));
      await client.query(`INSERT INTO metadata_source.source_blob(content_hash,payload)
        SELECT DISTINCT ON (hash) hash,payload FROM jsonb_to_recordset($1::jsonb) AS x(hash text,payload jsonb)
        ON CONFLICT DO NOTHING`, [blobs]);
      const conflict = await client.query(`SELECT 1 FROM metadata_source.source_record r
        JOIN jsonb_to_recordset($3::jsonb) AS x(key text,hash text) ON x.key=r.source_key
        WHERE r.release_id=$1 AND r.namespace=$2 LIMIT 1`, [release,namespace,json]);
      if (conflict.rowCount) throw new Error("Source key was already imported outside its checkpoint");
      await client.query(`INSERT INTO metadata_source.source_record
        (release_id,namespace,source_key,content_hash,asset_key,legacy_id,family,chain_id,origin_type,source_burned,issue)
        SELECT $1,$2,key,hash,"assetKey","legacyId",family,"chainId","originType",burned,issue
        FROM jsonb_to_recordset($3::jsonb) AS x(key text,hash text,"assetKey" text,"legacyId" text,
          family text,"chainId" text,"originType" text,burned boolean,issue text)`, [release,namespace,json]);
      for (const record of prepared) {
        rollingHash = createHash("sha256").update(canonicalJson([rollingHash,namespace,record.key,record.hash])).digest("hex");
      }
    }
    await client.query(`UPDATE metadata_source.import_run SET cursor=$3::jsonb,rows_imported=rows_imported+$4,
      rolling_hash=$5,state=$6,updated_at=now() WHERE release_id=$1 AND namespace=$2`,
    [release,namespace,canonicalJson(cursor),prepared.length,rollingHash,finished ? "scanned" : "running"]);
    await client.query("COMMIT");
    return rollingHash;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
