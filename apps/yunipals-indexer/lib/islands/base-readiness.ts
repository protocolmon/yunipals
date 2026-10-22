import type { Pool } from "pg";
import { baseIslandCollection } from "./collections.js";
import { sqlIdentifier, unifiedOwnershipReads } from "../offchain/sql.js";
import { unifiedOwnershipStatus } from "../ownership/readiness.js";

/** Native reads use the registered canonical source, never the retired scanner. */
export async function baseIslandsReadiness(pool: Pick<Pool, "query">) {
  if (unifiedOwnershipReads) {
    const source = (await unifiedOwnershipStatus(pool, [
      baseIslandCollection.slug
    ]))!;
    const status = source.collections[0]!;
    return {
      ready: status.available,
      indexedBlock: status.block_number ?? null,
      verifiedBlock: status.block_number ?? null,
      reason: status.reason,
      source
    };
  }
  const schema = sqlIdentifier(baseIslandCollection.schemaName);
  const result =
    await pool.query(`SELECT ready AND verified_block IS NOT NULL AND
    last_scanned_block>=verified_block AND completed_at>now()-interval '15 minutes'
    AND completed_at<=now() AS ready,
    last_scanned_block::text AS "indexedBlock",verified_block::text AS "verifiedBlock",
    finalized_block::text AS "finalizedBlock",updated_at AS "updatedAt",completed_at AS "completedAt",last_error AS reason,
    airdrop_finalized AS "airdropFinalized",contract_owner AS "contractOwner"
    FROM ${schema}.sync_state WHERE singleton`);
  return { ...result.rows[0], ready: result.rows[0]?.ready === true };
}
