import type { Pool } from "pg";
import { islandCollection } from "../constants.js";
import {
  sqlIdentifier,
  unifiedOwnershipReads,
  physicalPonderSchemaName,
  ownershipReadConfig
} from "../offchain/sql.js";

export const islandStakingAddress =
  "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8";

/** Join only a fresh scan from this Ponder build and the token's exact latest transfer. */
export function stakingRelation(schemaName: string) {
  const schema = sqlIdentifier(schemaName);
  return `LEFT JOIN metadata.island_staking_scan ss ON ${stakingScanProof(schemaName, "ss")}
    LEFT JOIN metadata.island_staking_position sp ON sp.schema_name=ss.schema_name AND sp.build_id=ss.build_id
    AND sp.token_id=t.token_id AND sp.lifecycle=t.lifecycle AND NOT t.burned AND t.owner='${islandStakingAddress}'
    AND sp.deposit_event_id=(SELECT e.id FROM ${schema}.transfer_event e
      WHERE e.collection=t.collection AND e.token_id=t.token_id AND e.lifecycle=t.lifecycle
      AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address
      ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1)`;
}

function stakingScanProof(schemaName: string, alias: "ss" | "s") {
  const schema = sqlIdentifier(schemaName);
  return unifiedOwnershipReads
    ? `${alias}.schema_name='${physicalPonderSchemaName}'
      AND to_jsonb(${alias})->>'ownership_release_id'='${ownershipReadConfig.releaseId}'
      AND to_jsonb(${alias})->>'ownership_read_identity'=(SELECT identity FROM ${schema}._unified_read_release WHERE singleton)
      AND ${alias}.build_id=(SELECT r.build_id FROM yunipals_indexer_control.release r
        JOIN ${schema}._unified_read_release marker ON marker.release_id=r.id AND marker.singleton
        WHERE r.id='${ownershipReadConfig.releaseId}' AND r.physical_schema='${physicalPonderSchemaName}')
      AND ${alias}.state='ready' AND ${alias}.verified_at>statement_timestamp()-interval '15 minutes'
      AND ${alias}.verified_at<=statement_timestamp()
      AND EXISTS(SELECT 1 FROM ${schema}.source_boundary('ethereum-islands') boundary
        JOIN ${sqlIdentifier(physicalPonderSchemaName)}.chain_block anchor
          ON anchor.chain_id=boundary.chain_id AND anchor.block_number=${alias}.block_number
          AND anchor.block_hash=${alias}.block_hash
        WHERE ${alias}.block_number<=boundary.block_number)`
    : `${alias}.schema_name='${schemaName}'
      AND ${alias}.build_id=(SELECT value->>'build_id' FROM ${schema}._ponder_meta WHERE key='app')
      AND ${alias}.state='ready' AND ${alias}.verified_at>now()-interval '15 minutes'
      AND ${alias}.verified_at<=now()`;
}

export const stakingColumns = `jsonb_build_object(
  'status',CASE WHEN t.burned OR t.owner<>'${islandStakingAddress}' THEN 'none'
    WHEN sp.staker IS NOT NULL THEN 'staked' ELSE 'unverified' END,
  'staker',sp.staker,'contractAddress','${islandStakingAddress}',
  'checkedBlock',ss.block_number::text) AS staking`;

export async function stakingReadiness(
  pool: Pick<Pool, "query">,
  schemaName: string,
  enabled: boolean
) {
  if (!enabled)
    return {
      enabled: false,
      ready: false,
      checkedBlock: null,
      reason: "disabled"
    };
  const schema = sqlIdentifier(schemaName);
  const scan = (
    await pool.query<{ ready: boolean; block: string }>(
      `SELECT ${stakingScanProof(schemaName, "s")}
    AND NOT EXISTS(SELECT 1 FROM ${schema}.token t ${stakingRelation(schemaName)}
      WHERE t.collection='${islandCollection.slug}' AND t.chain_id=1 AND t.contract_address='${islandCollection.address}'
      AND t.owner='${islandStakingAddress}' AND NOT t.burned AND (sp.token_id IS NULL OR sp.staker IS NULL))
    AS ready,s.block_number::text AS block
    FROM metadata.island_staking_scan s WHERE s.schema_name=$1`,
      [unifiedOwnershipReads ? physicalPonderSchemaName : schemaName]
    )
  ).rows[0];
  return {
    enabled: true,
    ready: scan?.ready === true,
    checkedBlock: scan?.block ?? null,
    reason: scan?.ready ? null : "verification_unavailable"
  };
}
