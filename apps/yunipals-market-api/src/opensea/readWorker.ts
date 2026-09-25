import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { PublicClient } from "viem";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { assertReady } from "@/db/readiness";
import { LostJobLeaseError } from "@/db/jobs";
import {
  claimDiscoveredOpenSeaOrder,
  openSeaProjectionLeaseMs,
  reconcileDiscoveredOpenSeaOrder,
  type DiscoveredObservationOptions
} from "@/opensea/discoveredReconciliation";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import {
  observeOpenSeaHeadHealth,
  observeOpenSeaReadHealth
} from "@/opensea/readHealth";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

export type OpenSeaReadTransientFailure =
  | "database_capacity"
  | "database_connection"
  | "database_lock_timeout"
  | "database_network"
  | "database_restart"
  | "database_serialization"
  | "database_statement_timeout"
  | "rpc_budget_exhausted";

const networkCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT"
]);

// PostgreSQL and Node expose stable machine codes for these infrastructure
// failures. Do not inspect or retain error messages because they may contain a
// private database endpoint. Unknown failures still stop the worker.
export function classifyOpenSeaReadTransientFailure(
  error: unknown
): OpenSeaReadTransientFailure | undefined {
  if (rpcComputeBudgetError(error)) return "rpc_budget_exhausted";
  const seen = new Set<object>();
  for (
    let cause = error;
    cause && typeof cause === "object" && seen.size < 8;
    cause = "cause" in cause ? cause.cause : undefined
  ) {
    if (seen.has(cause)) break;
    seen.add(cause);
    const code =
      "code" in cause && typeof cause.code === "string"
        ? cause.code.toUpperCase()
        : undefined;
    if (!code) continue;
    if (code.startsWith("08")) return "database_connection";
    if (code === "57014") return "database_statement_timeout";
    if (code === "55P03") return "database_lock_timeout";
    if (["57P01", "57P02", "57P03"].includes(code)) return "database_restart";
    if (["53300", "53400"].includes(code)) return "database_capacity";
    if (["40001", "40P01"].includes(code)) return "database_serialization";
    if (networkCodes.has(code)) return "database_network";
  }
  return undefined;
}

export async function assertOpenSeaReadWorkerReady(
  pool: Pool,
  deployment: "staging" | "production"
) {
  await assertReady(pool, deployment);
  const result = await pool.query<{ unsafe: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE') OR (
        has_table_privilege(current_user,c.oid,'INSERT,UPDATE') AND NOT (
          n.nspname='yunipals_market' AND c.relname IN ('opensea_discovered_state','checkpoint'))))) AS unsafe`);
  if (result.rows[0]?.unsafe !== false)
    throw new Error(
      "OpenSea read worker has unexpected database write privileges."
    );
}

// This worker has no publication provider, admission scheduler or wallet client.
// In-flight observations finish on shutdown; failed leases remain recoverable.
export async function runOpenSeaReadWorker(input: {
  pool: Pool;
  client: PublicClient;
  chain: OpenSeaChain;
  policies: Pick<OpenSeaPolicyResolver, "resolve">;
  options: DiscoveredObservationOptions;
  concurrency: number;
  signal: AbortSignal;
  onTransientFailure?: (code: OpenSeaReadTransientFailure) => void;
}) {
  if (
    !isOpenSeaChain(input.chain) ||
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    input.concurrency > 8
  )
    throw new Error("Invalid OpenSea read worker scope or concurrency.");
  const stop = new AbortController();
  const signal = AbortSignal.any([input.signal, stop.signal]);
  const started = performance.now();
  const report = {
    processed: 0,
    healthPassed: 0,
    healthFailed: 0,
    leaseLost: 0,
    transientFailures: 0,
    maxObservationMs: 0,
    states: {} as Record<string, number>,
    reasons: {} as Record<string, number>,
    transientFailureCodes: {} as Record<OpenSeaReadTransientFailure, number>
  };
  let chainReady = false;
  let budgetBlockedUntil = 0;
  const pause = async (ms: number) => {
    try {
      await delay(ms, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  };
  const transient = async (error: unknown, consecutive: number) => {
    const code = classifyOpenSeaReadTransientFailure(error);
    if (!code) throw error;
    report.transientFailures++;
    report.transientFailureCodes[code] =
      (report.transientFailureCodes[code] ?? 0) + 1;
    input.onTransientFailure?.(code);
    const budget = rpcComputeBudgetError(error);
    if (budget) {
      chainReady = false;
      budgetBlockedUntil = Math.max(
        budgetBlockedUntil,
        Date.now() + budget.retryAfterMs
      );
    }
    await pause(
      budget
        ? Math.min(300000, budget.retryAfterMs)
        : Math.min(5000, 250 * 2 ** Math.min(consecutive, 5))
    );
  };
  const health = async () => {
    let consecutiveFailures = 0;
    let lastDeepHealth = 0;
    while (!signal.aborted) {
      if (Date.now() < budgetBlockedUntil) {
        await pause(Math.min(300000, budgetBlockedUntil - Date.now()));
        continue;
      }
      try {
        const deep = Date.now() - lastDeepHealth >= 4 * 60 * 1000;
        const ready = deep
          ? await observeOpenSeaReadHealth(
              input.pool,
              input.client,
              input.chain,
              input.policies,
              input.options.now,
              input.options.finality
            )
          : await observeOpenSeaHeadHealth(
              input.pool,
              input.client,
              input.chain,
              input.options.now,
              input.options.finality
            );
        if (deep && ready) lastDeepHealth = Date.now();
        if (ready) report.healthPassed++;
        else report.healthFailed++;
        chainReady = ready;
        consecutiveFailures = 0;
        // A failed deep probe must retry while the previous verified indexer
        // boundary is still fresh; another full minute can exhaust that margin.
        await pause(ready ? 60000 : 15000);
      } catch (error) {
        chainReady = false;
        consecutiveFailures++;
        await transient(error, consecutiveFailures);
      }
    }
  };
  const work = async () => {
    let consecutiveFailures = 0;
    while (!signal.aborted) {
      if (Date.now() < budgetBlockedUntil) {
        await pause(Math.min(300000, budgetBlockedUntil - Date.now()));
        continue;
      }
      if (!chainReady) {
        await pause(100);
        continue;
      }
      try {
        const claim = await claimDiscoveredOpenSeaOrder(
          input.pool,
          input.chain,
          openSeaProjectionLeaseMs
        );
        if (!claim) {
          consecutiveFailures = 0;
          await pause(1000);
          continue;
        }
        const observedAt = performance.now();
        const result = await reconcileDiscoveredOpenSeaOrder(
          input.pool,
          input.client,
          input.chain,
          input.policies,
          input.options,
          claim
        );
        report.processed++;
        report.states[result.state] = (report.states[result.state] ?? 0) + 1;
        if (result.reason)
          report.reasons[result.reason] =
            (report.reasons[result.reason] ?? 0) + 1;
        report.maxObservationMs = Math.max(
          report.maxObservationMs,
          Math.round(performance.now() - observedAt)
        );
        consecutiveFailures = 0;
      } catch (error) {
        if (error instanceof LostJobLeaseError) {
          report.leaseLost++;
          consecutiveFailures = 0;
        } else {
          consecutiveFailures++;
          await transient(error, consecutiveFailures);
        }
      }
    }
  };
  const results = await Promise.allSettled(
    [health(), ...Array.from({ length: input.concurrency }, () => work())].map(
      async (loop) => {
        try {
          await loop;
        } catch (error) {
          stop.abort();
          throw error;
        }
      }
    )
  );
  const failed = results.find((result) => result.status === "rejected");
  if (failed)
    throw new Error(
      "OpenSea read worker failed; retained leases require inspection.",
      { cause: failed.reason }
    );
  return { ...report, elapsedMs: Math.round(performance.now() - started) };
}
