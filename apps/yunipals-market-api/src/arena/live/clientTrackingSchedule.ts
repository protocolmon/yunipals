import type { PoolClient } from "pg";

export async function scheduleArenaClientCheck(
  db: Pick<PoolClient, "query">,
  deployment: string,
  hash: string,
  mode: "active" | "backoff"
) {
  // Persist the conservative delay before I/O. Only a successful check earns
  // the faster pending cadence; crashes and RPC/source failures keep backoff.
  await db.query(
    `UPDATE yunipals_arena.client_transaction SET next_check_at=now()+CASE
      WHEN $3::boolean OR state IN ('indexed','failed','delayed') THEN interval '30 seconds'
      WHEN created_at>now()-interval '90 seconds' THEN interval '2 seconds'
      ELSE interval '10 seconds' END
    WHERE deployment=$1 AND hash=$2`,
    [deployment, hash, mode === "backoff"]
  );
}
