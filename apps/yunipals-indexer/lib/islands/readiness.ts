import type { Pool } from "pg";
import { islandCollection } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { chainReadiness } from "../metadata/chain-readiness.js";

export function ethereumCheckpointBlock(checkpoint: unknown) {
  if (
    typeof checkpoint !== "string" ||
    !/^\d{75}$/.test(checkpoint) ||
    BigInt(checkpoint.slice(10, 26)) !== 1n
  )
    return null;
  return BigInt(checkpoint.slice(26, 42));
}

export async function islandsReadiness(
  pool: Pick<Pool, "query">,
  schemaName: string
) {
  const ownership = await chainReadiness(pool, [islandCollection.slug]);
  const schema = sqlIdentifier(schemaName);
  const checkpoint = (
    await pool.query<{ latest_checkpoint: string }>(
      `SELECT latest_checkpoint FROM ${schema}._ponder_checkpoint WHERE chain_id=1`
    )
  ).rows[0]?.latest_checkpoint;
  const block = ethereumCheckpointBlock(checkpoint);
  const proof = (
    await pool.query<{
      ready: string;
      verified_block: string | null;
      build_id: string;
    }>(
      `SELECT app.value->>'is_ready' AS ready,app.value->>'build_id' AS build_id,
      v.checkpoint_block::text AS verified_block FROM ${schema}._ponder_meta app
      LEFT JOIN metadata.island_verification v ON v.collection=$1 AND v.schema_name=$2
        AND v.build_id=app.value->>'build_id' WHERE app.key='app'`,
      [islandCollection.slug, schemaName]
    )
  ).rows[0];
  const verifiedBlock = proof?.verified_block;
  const indexing = proof?.ready === "1";
  return {
    ready:
      ownership.ready &&
      indexing &&
      block !== null &&
      verifiedBlock !== undefined &&
      verifiedBlock !== null &&
      block >= BigInt(verifiedBlock),
    indexedBlock: block?.toString() ?? null,
    verifiedBlock: verifiedBlock ?? null,
    indexing,
    buildId: proof?.build_id ?? null,
    ownership
  };
}
