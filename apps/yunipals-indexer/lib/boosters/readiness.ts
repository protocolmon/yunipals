import type { Pool } from "pg";
import { completePonderBlock, decodePonderCheckpoint } from "../../../../packages/yunipals-indexer-client/src/ponder.js";
import { sqlIdentifier } from "../offchain/sql.js";

export async function boosterReadiness(
  pool: Pick<Pool, "query">,
  schemaName: string,
  engine: string
) {
  const schema = sqlIdentifier(schemaName);
  // One SQL snapshot keeps runtime liveness, framework progress and the last
  // booster event coherent. A quiet collection still advances framework scans.
  const result = await pool.query<{
    runtime: Record<string, unknown>;
    checkpoint: string | null;
    observedAtMs: string;
    requestsPaused: boolean;
    lastBoosterEvent: { block: string; blockHash: string; timestamp: string } | null;
  }>(`SELECT m.value AS runtime,c.latest_checkpoint AS checkpoint,
    floor(extract(epoch FROM statement_timestamp())*1000)::text AS "observedAtMs",
    coalesce((SELECT paused FROM ${schema}.booster_engine_state WHERE id=$1),false) AS "requestsPaused",
    (SELECT jsonb_build_object('block',block_number::text,'blockHash',block_hash,'timestamp',timestamp::text)
     FROM ${schema}.booster_checkpoint WHERE id='8453') AS "lastBoosterEvent"
    FROM ${schema}._ponder_meta m LEFT JOIN ${schema}._ponder_checkpoint c ON c.chain_id=8453
    WHERE m.key='app'`, [engine]);
  const row = result.rows[0];
  const unavailable = { ready: false, reason: "booster_index_catching_up" } as const;
  if (!row || !row.checkpoint) return unavailable;
  const runtime = row.runtime;
  const clock = Number(row.observedAtMs);
  const heartbeat = Number(runtime.heartbeat_at);
  if (
    String(runtime.version) !== "6" || String(runtime.is_dev) !== "0" ||
    String(runtime.is_locked) !== "1" || String(runtime.is_ready) !== "1" ||
    typeof runtime.build_id !== "string" || !runtime.build_id ||
    !Number.isSafeInteger(clock) || !Number.isSafeInteger(heartbeat) ||
    heartbeat > clock || clock - heartbeat > 180_000
  ) return unavailable;
  try {
    const indexedBlock = completePonderBlock(row.checkpoint, 8453);
    const checkpoint = decodePonderCheckpoint(row.checkpoint);
    const indexedTimestamp = checkpoint.blockTimestamp;
    if (indexedBlock === null || indexedTimestamp * 1000n > BigInt(clock) ||
        BigInt(clock) - indexedTimestamp * 1000n > 180_000n) return unavailable;
    return {
      ready: true,
      indexedBlock: indexedBlock.toString(),
      // Framework checkpoints encode height/time, not a block hash. Never use
      // the unrelated last booster-event hash as the scanned-head hash.
      indexedBlockHash: null,
      indexedTimestamp: indexedTimestamp.toString(),
      buildId: runtime.build_id,
      requestsPaused: row.requestsPaused,
      lastBoosterEvent: row.lastBoosterEvent
    } as const;
  } catch {
    return unavailable;
  }
}
