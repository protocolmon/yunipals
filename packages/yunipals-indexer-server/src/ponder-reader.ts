import type { PoolClient } from "pg";
import {
  ponderChainCoverage,
  type PonderCheckpointRow
} from "../../yunipals-indexer-client/src/ponder.js";
import { sqlIdentifier } from "./database.js";

type RuntimeRow = {
  app: {
    version: string;
    build_id: string;
    heartbeat_at: number;
    is_ready: number;
    is_locked: number;
    is_dev: number;
  };
  checkpoints: PonderCheckpointRow[];
  witnesses: Array<{
    chain_id: number;
    block_number: string;
    block_hash: string;
    parent_hash: string;
    timestamp: string;
  }>;
};

// One statement gives meta and all chain checkpoints from a single MVCC
// snapshot. Reading coverage must never update Ponder's internal tables.
export async function readPonderRuntime(
  db: Pick<PoolClient, "query">,
  schemaName: string
) {
  const schema = sqlIdentifier(schemaName);
  const { rows } = await db.query<RuntimeRow>(`
    SELECT value AS app, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id::text, 'chain_name', chain_name,
        'latest_checkpoint', latest_checkpoint,
        'safe_checkpoint', safe_checkpoint,
        'finalized_checkpoint', finalized_checkpoint
      ) ORDER BY chain_id) FROM ${schema}._ponder_checkpoint
    ), '[]'::jsonb) AS checkpoints, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'chain_id', chain_id, 'block_number', block_number::text,
        'block_hash', block_hash, 'parent_hash', parent_hash, 'timestamp', timestamp::text
      ) ORDER BY chain_id) FROM ${schema}.chain_checkpoint
    ), '[]'::jsonb) AS witnesses
    FROM ${schema}._ponder_meta WHERE key='app'
  `);
  const row = rows[0];
  if (
    !row ||
    row.app.version !== "6" ||
    !row.app.build_id ||
    !Number.isSafeInteger(row.app.heartbeat_at) ||
    row.app.heartbeat_at < 0 ||
    ![0, 1].includes(row.app.is_locked) ||
    ![0, 1].includes(row.app.is_ready) ||
    row.app.is_dev !== 0
  ) {
    throw new Error(
      "Unsupported or missing production Ponder runtime metadata."
    );
  }
  const chains = row.checkpoints.map(ponderChainCoverage);
  if (new Set(chains.map((chain) => chain.chainId)).size !== chains.length) {
    throw new Error("Conflicting Ponder chain checkpoints.");
  }
  const witnesses = row.witnesses.map((witness) => {
    if (
      !Number.isSafeInteger(witness.chain_id) ||
      !/^(0|[1-9][0-9]*)$/.test(witness.block_number) ||
      !/^(0|[1-9][0-9]*)$/.test(witness.timestamp) ||
      !/^0x[0-9a-f]{64}$/.test(witness.block_hash) ||
      !/^0x[0-9a-f]{64}$/.test(witness.parent_hash)
    ) {
      throw new Error("Invalid Ponder block witness.");
    }
    return {
      chainId: witness.chain_id,
      blockNumber: BigInt(witness.block_number),
      blockHash: witness.block_hash,
      parentHash: witness.parent_hash,
      timestamp: BigInt(witness.timestamp)
    };
  });
  if (
    new Set(witnesses.map((witness) => witness.chainId)).size !==
      witnesses.length ||
    witnesses.some(
      (witness) => !chains.some((chain) => chain.chainId === witness.chainId)
    )
  ) {
    throw new Error("Conflicting Ponder block witnesses.");
  }
  return {
    schema: schemaName,
    buildId: row.app.build_id,
    observedAtMs: row.app.heartbeat_at,
    running: row.app.is_locked === 1,
    frameworkReady: row.app.is_ready === 1,
    chains,
    witnesses
  };
}
