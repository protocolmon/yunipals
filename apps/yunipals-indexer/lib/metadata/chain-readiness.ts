import type { Pool } from "pg";
import { collectionSlugs, type CollectionId } from "../constants.js";
import { MetadataUnavailable } from "./publication.js";
import { unifiedOwnershipReads } from "../offchain/sql.js";
import { unifiedOwnershipStatus } from "../ownership/readiness.js";
import { nativeBaseMetadataReads } from "./base-mode.js";
import { ponderSchema } from "../offchain/sql.js";

/** Explicit recovery fence. Ordinary indexing continues to expose its existing checkpoint/status. */
export async function chainReadiness(
  pool: Pick<Pool, "query">,
  chains: readonly CollectionId[] = collectionSlugs
) {
  const rows = (
    await pool.query(
      `SELECT collection,state,checkpoint_block::text,reason,updated_at,verified_at
    FROM metadata.chain_readiness WHERE collection=ANY($1::text[])`,
      [chains]
    )
  ).rows;
  const byCollection = new Map(rows.map((row) => [row.collection, row]));
  const source = unifiedOwnershipReads
    ? await unifiedOwnershipStatus(pool, chains)
    : null;
  const sourceByCollection = new Map(
    source?.collections.map((row) => [row.collection, row]) ?? []
  );
  let nativeMetadataReady = true;
  if (nativeBaseMetadataReads() && chains.includes("base")) {
    // The probe catches approval exceptions without aborting a broader
    // repeatable-read request or affecting another collection.
    nativeMetadataReady =
      (
        await pool.query<{ ready: boolean }>(
          `SELECT ${ponderSchema}.base_metadata_probe() AS ready`
        )
      ).rows[0]?.ready === true;
  }
  const blocked = chains.filter((collection) => {
    const row = byCollection.get(collection);
    return (
      !row ||
      row.state !== "ready" ||
      row.checkpoint_block === null ||
      row.verified_at === null ||
      (collection === "base" && !nativeMetadataReady) ||
      (unifiedOwnershipReads &&
        sourceByCollection.get(collection)?.available !== true)
    );
  });
  return {
    ready: blocked.length === 0,
    blocked,
    collections: rows,
    ...(source ? { source } : {})
  };
}
export async function assertChainReady(
  pool: Pick<Pool, "query">,
  chains: readonly CollectionId[]
) {
  if (!(await chainReadiness(pool, chains)).ready)
    throw new MetadataUnavailable("ownership_rebuilding", "retry");
}
