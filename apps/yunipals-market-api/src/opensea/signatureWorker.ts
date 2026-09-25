import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { Address } from "viem";
import {
  isOpenSeaChain,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { assertReady } from "@/db/readiness";
import type { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import {
  enqueueMissingOpenSeaSignatures,
  enrichNextOpenSeaSignature
} from "@/opensea/signatureEnrichment";
import { withSignatureWorkerLocks } from "@/opensea/signatureWorkerLock";

export async function assertOpenSeaSignatureWorkerReady(
  pool: Pool,
  deployment: "staging" | "production"
) {
  await assertReady(pool, deployment);
  const result = await pool.query<{ safe: boolean }>(
    `SELECT
    row_security_active('yunipals_market.job') AND current_setting('row_security')='on'
    AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='yunipals_market.job'::regclass
      AND polname='job_signature_scope' AND NOT polpermissive AND polcmd='*'
      AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname=current_user)]
      AND pg_get_expr(polqual,polrelid)=$1 AND pg_get_expr(polwithcheck,polrelid)=$1)
    AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='yunipals_market.job'::regclass
      AND polname='job_existing_table_access' AND polpermissive AND polcmd='*'
      AND polroles=ARRAY[0::oid] AND pg_get_expr(polqual,polrelid)='true'
      AND pg_get_expr(polwithcheck,polrelid)='true')
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND c.relkind IN ('r','p','v','m','f')
        AND (has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE') OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
          AND ((has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AND NOT (
            n.nspname='yunipals_market' AND c.relname IN ('job','opensea_maker_signature')))
          OR (has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AND NOT (
            n.nspname='yunipals_market' AND (c.relname IN ('job','opensea_maker_signature')
              OR (c.relname='opensea_discovered_state' AND a.attname='next_reconcile_at')))))))) AS safe`,
    ["(kind = 'opensea_signature_enrichment'::text)"]
  );
  if (result.rows[0]?.safe !== true)
    throw new Error(
      "OpenSea signature worker requires isolated queue and proof permissions."
    );
}

// A single lane keeps background provider demand bounded. The shared account
// budget, not this process's cadence, enforces foreground headroom across chains.
export async function runOpenSeaSignatureWorker(input: {
  pool: Pool;
  chain: OpenSeaChain;
  listingActor: Address;
  service: Pick<OpenSeaFulfillmentService, "preflight">;
  signal: AbortSignal;
  now?: () => number;
}) {
  return withSignatureWorkerLocks(
    input.pool,
    [input.chain],
    input.signal,
    async (guard) => {
      const report = await runSignatureLane({ ...input, signal: guard.signal });
      guard.assertOwner();
      return report;
    }
  );
}

async function runSignatureLane(input: {
  pool: Pool;
  chain: OpenSeaChain;
  listingActor: Address;
  service: Pick<OpenSeaFulfillmentService, "preflight">;
  signal: AbortSignal;
  now?: () => number;
}) {
  if (!isOpenSeaChain(input.chain))
    throw new Error("Invalid signature worker chain.");
  const started = performance.now();
  const report = {
    enqueued: 0,
    processed: 0,
    outcomes: {} as Record<string, number>,
    reasons: {} as Record<string, number>
  };
  let nextSeed = 0;
  while (!input.signal.aborted) {
    if (performance.now() >= nextSeed) {
      report.enqueued += await enqueueMissingOpenSeaSignatures(
        input.pool,
        input.chain,
        new Date(input.now?.() ?? Date.now())
      );
      nextSeed = performance.now() + 15000;
    }
    if (input.signal.aborted) break;
    const result = await enrichNextOpenSeaSignature(input);
    report.outcomes[result.status] = (report.outcomes[result.status] ?? 0) + 1;
    if (result.status !== "idle") report.processed++;
    if ("code" in result && result.code)
      report.reasons[result.code] = (report.reasons[result.code] ?? 0) + 1;
    try {
      await delay(result.status === "deferred" ? 15000 : 1000, undefined, {
        signal: input.signal
      });
    } catch (error) {
      if (!input.signal.aborted) throw error;
    }
  }
  return { ...report, elapsedMs: Math.round(performance.now() - started) };
}
