import type { Pool } from "pg";
import { islandCollection } from "../constants.js";
import {
  sqlIdentifier,
  unifiedOwnershipReads,
  physicalPonderSchemaName,
  ownershipReadConfig
} from "../offchain/sql.js";
import { unifiedOwnershipStatus } from "../ownership/readiness.js";
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
  if (unifiedOwnershipReads) {
    const source = (await unifiedOwnershipStatus(pool, [
      islandCollection.slug
    ]))!;
    const checkpoint = source.collections[0]!;
    const verified = (
      await pool.query<{ build_id: string; verified_block: string | null }>(
        `SELECT r.build_id,v.checkpoint_block::text AS verified_block FROM yunipals_indexer_control.release r
      LEFT JOIN metadata.island_verification v ON v.collection=$1 AND v.schema_name=$2 AND v.build_id=r.build_id WHERE r.id=$3`,
        [
          islandCollection.slug,
          physicalPonderSchemaName,
          ownershipReadConfig.releaseId
        ]
      )
    ).rows[0];
    return {
      ready:
        ownership.ready &&
        checkpoint.available &&
        verified?.verified_block !== null &&
        verified?.verified_block !== undefined &&
        BigInt(checkpoint.block_number!) >= BigInt(verified.verified_block),
      indexedBlock: checkpoint.block_number ?? null,
      verifiedBlock: verified?.verified_block ?? null,
      indexing: checkpoint.available,
      buildId: verified?.build_id ?? null,
      ownership,
      source
    };
  }
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
