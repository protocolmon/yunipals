import type { Pool } from "pg";

export class RpcBudgetExhausted extends Error {
  constructor(readonly period: "day" | "31_days") { super(`solana_rpc_budget_${period}_exhausted`); }
}

export async function reserveRpcCredits(pool: Pick<Pool,"connect">, method: string, runId: number | null,
  credits = 10, dailyLimit = 15_000, rollingLimit = 500_000): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('solana:indexer:rpc-budget'))");
    const usage = (await client.query<{ day: string; rolling: string }>(`SELECT
      COALESCE(sum(credits) FILTER (WHERE reserved_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::text AS day,
      COALESCE(sum(credits),0)::text AS rolling
      FROM solana_indexer.rpc_usage WHERE reserved_at >= now()-interval '31 days'`)).rows[0]!;
    if (Number(usage.day) + credits > dailyLimit) throw new RpcBudgetExhausted("day");
    if (Number(usage.rolling) + credits > rollingLimit) throw new RpcBudgetExhausted("31_days");
    const id = Number((await client.query<{ id: string }>(`INSERT INTO solana_indexer.rpc_usage(method,credits,run_id)
      VALUES($1,$2,$3) RETURNING id::text`, [method,credits,runId])).rows[0]!.id);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function finishRpcUsage(pool: Pick<Pool,"query">, id: number, outcome: string, errorCode: string | null) {
  await pool.query(`UPDATE solana_indexer.rpc_usage SET outcome=$2,error_code=$3 WHERE id=$1`, [id,outcome,errorCode]);
}
