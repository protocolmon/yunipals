import type { Pool } from "pg";

export type ArenaHealthIssue = {
  code: string;
  severity: "warning" | "critical";
  tournamentId?: string;
};

/** Operational reads use the existing database only: no RPC or provider traffic. */
export async function arenaHealth(
  pool: Pool,
  deployment: string,
  entriesEnabled: boolean
) {
  const db = await pool.connect();
  try {
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    const issues: ArenaHealthIssue[] = [];
    const current = (
      await db.query<{
        halted: boolean;
        fresh: boolean;
        capacity: boolean;
        funded: boolean;
      }>(
        `SELECT d.halted,d.finalized_at>now()-interval '3 minutes' AS fresh,
        c.checked_at>now()-interval '6 minutes' AS capacity,
        ((c.snapshot->>'openaiFundingMode'='ongoing' OR (c.snapshot->>'openaiBudgetExpiresAt')::numeric>extract(epoch FROM now())*1000)
          AND (c.snapshot->>'diskFreeBytes')::numeric>=2000000000
          AND (c.snapshot->>'refereeGasWei')::numeric>=100000000000000
          AND (c.snapshot->>'operatorGasWei')::numeric>=50000000000000) AS funded
       FROM yunipals_arena.deployment d LEFT JOIN yunipals_arena.capacity c ON c.deployment=d.id WHERE d.id=$1`,
        [deployment]
      )
    ).rows[0];
    if (!current)
      issues.push({ code: "deployment-not-indexed", severity: "critical" });
    else {
      if (current.halted)
        issues.push({ code: "confirmed-history-halted", severity: "critical" });
      if (!current.fresh)
        issues.push({ code: "indexer-stale", severity: "critical" });
      if (entriesEnabled && !current.capacity)
        issues.push({ code: "capacity-stale", severity: "critical" });
      if (entriesEnabled && !current.funded)
        issues.push({
          code: "operating-funds-or-storage-low",
          severity: "critical"
        });
    }
    const deadlines = (
      await db.query<{
        id: string;
        phase: string;
        late: boolean;
        urgent: boolean;
      }>(
        `SELECT id::text,state->>'phase' AS phase,
        (state->>'deadline')::bigint<extract(epoch FROM now())-1800 AS late,
        (state->>'deadline')::bigint<extract(epoch FROM now())+7200 AS urgent
       FROM yunipals_arena.tournament WHERE deployment=$1
        AND state->>'phase' IN ('open','strategies','resolving') AND (state->>'deadline')::bigint>0
        AND (state->>'deadline')::bigint<extract(epoch FROM now())+7200 ORDER BY id LIMIT 20`,
        [deployment]
      )
    ).rows;
    for (const row of deadlines) {
      if (row.late)
        issues.push({
          code: `${row.phase}-transition-overdue`,
          severity: "critical",
          tournamentId: row.id
        });
      else if (row.urgent && row.phase === "resolving")
        issues.push({
          code: "referee-deadline-near",
          severity: "warning",
          tournamentId: row.id
        });
    }
    const provider = (
      await db.query<{ id: string; kind: string; state: string }>(
        `SELECT tournament_id::text AS id,kind,state FROM yunipals_arena.provider_task WHERE deployment=$1
        AND (state IN ('uncertain','failed','incomplete','cancelled') OR
          (state NOT IN ('completed') AND updated_at<now()-interval '30 minutes'))
        ORDER BY updated_at LIMIT 20`,
        [deployment]
      )
    ).rows;
    for (const row of provider)
      issues.push({
        code: `${row.kind}-job-${row.state}`,
        severity: "critical",
        tournamentId: row.id
      });
    const media = (
      await db.query<{ id: string }>(
        `SELECT t.id::text FROM yunipals_arena.tournament t LEFT JOIN yunipals_arena.media_job m
       ON m.deployment=t.deployment AND m.tournament_id=t.id WHERE t.deployment=$1 AND t.state->>'phase'='settled'
        AND coalesce(t.state->>'videoHash','') IN ('','0x0000000000000000000000000000000000000000000000000000000000000000')
        AND t.updated_at<now()-interval '1 hour' ORDER BY t.id LIMIT 20`,
        [deployment]
      )
    ).rows;
    for (const row of media)
      issues.push({
        code: "video-or-payout-release-delayed",
        severity: "critical",
        tournamentId: row.id
      });
    const identities = (
      await db.query<{ state: string; count: string }>(
        `SELECT state,count(*)::text AS count FROM yunipals_arena.identity_job WHERE deployment=$1
        AND (state IN ('uncertain','review','failed') OR (state IN ('loading','submitting','queued') AND updated_at<now()-interval '10 minutes'))
        GROUP BY state`,
        [deployment]
      )
    ).rows;
    for (const row of identities)
      issues.push({
        code: `identity-${row.state}-${row.count}`,
        severity: "warning"
      });
    const transactions = (
      await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM yunipals_arena.client_transaction WHERE deployment=$1
        AND (state='delayed' OR (state IN ('submitted','confirming','indexing') AND created_at<now()-interval '30 minutes'))`,
        [deployment]
      )
    ).rows[0]!;
    if (Number(transactions.count))
      issues.push({ code: "client-transactions-delayed", severity: "warning" });
    await db.query("COMMIT");
    return {
      version: "arena-operational-health-v1",
      checkedAt: new Date().toISOString(),
      deployment,
      status: issues.some((i) => i.severity === "critical")
        ? "needs-attention"
        : issues.length
          ? "warning"
          : "healthy",
      entriesEnabled,
      issues,
      externalRequests: 0
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
