import type { Pool } from "pg";
import type { PublicClient } from "viem";
import { readBnbHead } from "@/bnb/protocol";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

export async function writeBnbWorkerHeartbeat(
  pool: Pool,
  client: PublicClient,
  finality: "confirmations" | "finalized" = "confirmations"
) {
  let head;
  try {
    head = await readBnbHead(client, Date.now, finality);
  } catch (error) {
    if (rpcComputeBudgetError(error)) throw error;
    /* The worker remains alive and records the explicit RPC failure. */
  }
  await pool.query(
    `INSERT INTO yunipals_market.checkpoint
    (source,chain_id,name,block_number,block_hash,state,progress_at,checked_at,last_error_code)
    VALUES ('chain',56,'bnb-order-worker',$1::numeric,$2,$3,CASE WHEN $1::numeric IS NULL THEN NULL ELSE clock_timestamp() END,
      clock_timestamp(),$4)
    ON CONFLICT(source,chain_id,name) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,
      state=EXCLUDED.state,checked_at=EXCLUDED.checked_at,last_error_code=EXCLUDED.last_error_code,
      progress_at=CASE WHEN EXCLUDED.block_number IS NOT NULL AND yunipals_market.checkpoint.block_number IS DISTINCT FROM EXCLUDED.block_number
        THEN clock_timestamp() ELSE yunipals_market.checkpoint.progress_at END`,
    [
      head?.number.toString() ?? null,
      head?.hash.toLowerCase() ?? null,
      head ? "available" : "unavailable",
      head ? null : "chain_unavailable"
    ]
  );
}

export async function writeBnbWorkerUnavailable(pool: Pool) {
  await pool.query(
    `UPDATE yunipals_market.checkpoint SET state='unavailable',checked_at=clock_timestamp(),
      last_error_code='worker_stopped',generation=generation+1
    WHERE source='chain' AND chain_id=56 AND name='bnb-order-worker'`
  );
}
