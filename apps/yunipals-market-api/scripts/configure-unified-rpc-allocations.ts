import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

import { manifestDigest } from "@protopals/yunipals-indexer-server/identity";

type AllocationInput = {
  scope: string;
  sourceCu: string;
  evidenceCu: string;
};
type Allocation = {
  workload: string;
  priority: string;
  daily_cu: string;
};

export async function configureUnifiedRpcAllocations(
  pool: pg.Pool,
  input: AllocationInput,
  apply?: string
) {
  const validCu = (value: string) =>
    /^[1-9][0-9]*$/.test(value) && BigInt(value) <= 1_000_000_000_000n;
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(input.scope) ||
    !validCu(input.sourceCu) ||
    !validCu(input.evidenceCu)
  )
    throw new Error(
      "Explicit scope and positive bounded allocation limits are required."
    );
  const desired: Allocation[] = [
    {
      workload: "unified_evidence",
      priority: "background",
      daily_cu: input.evidenceCu
    },
    {
      workload: "unified_source",
      priority: "background",
      daily_cu: input.sourceCu
    }
  ];
  const client = await pool.connect();
  try {
    await client.query(
      apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    if (apply) await client.query("SELECT pg_advisory_xact_lock(178858,9028)");
    const budget = (
      await client.query<{
        coordinator_id: string;
        coordinator_enabled: boolean;
        enabled: boolean;
        daily_cu: string;
        foreground_reserve_cu: string;
      }>(
        `SELECT c.coordinator_id::text,c.enabled AS coordinator_enabled,
      b.enabled,b.daily_cu::text,b.foreground_reserve_cu::text
      FROM yunipals_market.opensea_request_budget c
      JOIN yunipals_market.rpc_compute_budget b USING(scope) WHERE c.scope=$1
      ${apply ? "FOR UPDATE OF c,b" : ""}`,
        [input.scope]
      )
    ).rows[0];
    if (!budget?.coordinator_enabled || !budget.enabled)
      throw new Error(
        "An enabled existing coordinator and compute budget are required."
      );
    if (
      BigInt(input.sourceCu) + BigInt(input.evidenceCu) >
      BigInt(budget.daily_cu) - BigInt(budget.foreground_reserve_cu)
    )
      throw new Error(
        "Requested limits exceed the existing background ceiling."
      );
    const existing = (
      await client.query<Allocation>(
        `SELECT workload,priority,daily_cu::text FROM yunipals_market.rpc_compute_allocation
       WHERE scope=$1 AND workload IN ('unified_source','unified_evidence') ORDER BY workload`,
        [input.scope]
      )
    ).rows;
    for (const row of existing) {
      const wanted = desired.find((value) => value.workload === row.workload);
      if (
        !wanted ||
        row.priority !== wanted.priority ||
        row.daily_cu !== wanted.daily_cu
      )
        throw new Error(
          "Existing allocation differs; this bootstrap never changes existing limits."
        );
    }
    const reviewHash = manifestDigest({ input, budget, existing });
    if (apply) {
      if (apply !== reviewHash)
        throw new Error(
          "Budget review changed; inspect the current state again."
        );
      for (const row of desired) {
        await client.query(
          `INSERT INTO yunipals_market.rpc_compute_allocation(scope,workload,priority,daily_cu)
           VALUES($1,$2,$3,$4) ON CONFLICT(scope,workload) DO NOTHING`,
          [input.scope, row.workload, row.priority, row.daily_cu]
        );
      }
      const saved = (
        await client.query<Allocation>(
          `SELECT workload,priority,daily_cu::text FROM yunipals_market.rpc_compute_allocation
         WHERE scope=$1 AND workload IN ('unified_source','unified_evidence') ORDER BY workload`,
          [input.scope]
        )
      ).rows;
      if (manifestDigest(saved) !== manifestDigest(desired))
        throw new Error("Allocation changed during bootstrap.");
    }
    await client.query("COMMIT");
    return {
      event: "unified_rpc_allocations",
      scope: input.scope,
      reviewHash,
      applied: Boolean(apply),
      allocations: desired,
      globalBudgetChanged: false,
      existingAllocationsChanged: false,
      usageCountersReset: false
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      scope: { type: "string" },
      "source-cu": { type: "string" },
      "evidence-cu": { type: "string" },
      apply: { type: "string" },
      help: { type: "boolean", short: "h" }
    }
  });
  if (values.help) {
    console.log(
      "Usage: configure-unified-rpc-allocations --scope NAME --source-cu N --evidence-cu N [--apply REVIEW_HASH]"
    );
    return;
  }
  if (!process.env.UNIFIED_RPC_REVIEW_DATABASE_URL)
    throw new Error(
      "Set UNIFIED_RPC_REVIEW_DATABASE_URL in the private owner env file."
    );
  const pool = new pg.Pool({
    connectionString: process.env.UNIFIED_RPC_REVIEW_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    lock_timeout: 2000
  });
  try {
    console.log(
      JSON.stringify(
        await configureUnifiedRpcAllocations(
          pool,
          {
            scope: values.scope ?? "",
            sourceCu: values["source-cu"] ?? "",
            evidenceCu: values["evidence-cu"] ?? ""
          },
          values.apply
        )
      )
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Unified RPC allocation setup refused; inspect the owner inputs and current budget."
    );
    process.exitCode = 1;
  });
}
