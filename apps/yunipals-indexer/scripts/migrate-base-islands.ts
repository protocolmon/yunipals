import { pool } from "../lib/offchain/db.js";
import { baseIslandsMigrations } from "../lib/islands/base-schema.js";
import { loadAirdropSnapshot } from "../lib/islands/airdrop.js";
import { loadReplacementSnapshot } from "../lib/islands/replacement.js";
import {
  airdropSnapshotBlock,
  airdropSnapshotBlockHash,
  airdropSnapshotSha256,
  legacyBaseIslandCollection,
  replacementSnapshotBlock,
  replacementSnapshotBlockHash,
  replacementSnapshotSha256,
  replacementDistributionRoot
} from "../lib/islands/collections.js";

const tokens = await loadAirdropSnapshot();
const replacement = await loadReplacementSnapshot();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='2s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('yunipals:base-islands-migration'))"
  );
  for (const sql of baseIslandsMigrations) await client.query(sql);
  await client.query(
    `INSERT INTO metadata.island_airdrop_origin
    (token_id,source_collection,target_collection,source_owner,recipient,snapshot_block,snapshot_block_hash,snapshot_sha256)
    SELECT token_id,'ethereum-islands','base-islands',source_owner,recipient,$2,$3,$4
    FROM jsonb_to_recordset($1::jsonb) AS x(token_id text,source_owner text,recipient text)
    ON CONFLICT DO NOTHING`,
    [
      JSON.stringify(
        tokens.map((t) => ({
          token_id: t.tokenId,
          source_owner: t.sourceOwner.toLowerCase(),
          recipient: t.effectiveOwner.toLowerCase()
        }))
      ),
      String(airdropSnapshotBlock),
      airdropSnapshotBlockHash,
      airdropSnapshotSha256
    ]
  );
  const result = await client.query(
    `SELECT count(*)::int AS count FROM metadata.island_airdrop_origin
    WHERE snapshot_sha256=$1`,
    [airdropSnapshotSha256]
  );
  if (result.rows[0].count !== 898)
    throw new Error("airdrop_provenance_incomplete");
  await client.query(
    `INSERT INTO metadata.island_replacement_origin
    (token_id,recipient,source_contract,snapshot_block,snapshot_block_hash,snapshot_sha256,distribution_root)
    SELECT token_id,recipient,$2,$3,$4,$5,$6 FROM jsonb_to_recordset($1::jsonb) AS x(token_id text,recipient text)
    ON CONFLICT DO NOTHING`,
    [
      JSON.stringify(
        replacement.map((t) => ({ token_id: t.tokenId, recipient: t.owner }))
      ),
      legacyBaseIslandCollection.address,
      String(replacementSnapshotBlock),
      replacementSnapshotBlockHash,
      replacementSnapshotSha256,
      replacementDistributionRoot
    ]
  );
  const replacementCheck = await client.query(
    `SELECT count(*)::int AS count
    FROM metadata.island_replacement_origin o JOIN jsonb_to_recordset($1::jsonb) AS x(token_id text,recipient text)
    ON o.token_id=x.token_id AND o.recipient=x.recipient WHERE o.source_contract=$2 AND o.snapshot_block=$3
    AND o.snapshot_block_hash=$4 AND o.snapshot_sha256=$5 AND o.distribution_root=$6`,
    [
      JSON.stringify(
        replacement.map((t) => ({ token_id: t.tokenId, recipient: t.owner }))
      ),
      legacyBaseIslandCollection.address,
      String(replacementSnapshotBlock),
      replacementSnapshotBlockHash,
      replacementSnapshotSha256,
      replacementDistributionRoot
    ]
  );
  if (replacementCheck.rows[0].count !== 898)
    throw new Error("replacement_provenance_incomplete");
  await client.query("COMMIT");
  console.log(
    "Base Islands v2 schema, original and replacement provenance verified for 898 tokens"
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
