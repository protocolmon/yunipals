import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { PublicClient } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

import {
  observeOpenSeaHeadHealth,
  observeOpenSeaReadHealth
} from "@/opensea/readHealth";
import type { OpenSeaObservationOptions } from "@/opensea/chain";
import type { OpenSeaPolicyResolver } from "@/opensea/policy";
import {
  claimDiscoveredOpenSeaOrder,
  openSeaProjectionLeaseMs,
  reconcileDiscoveredOpenSeaOrder
} from "@/opensea/discoveredReconciliation";
import {
  openSeaReconcileKind,
  pruneOpenSeaReconcileJobs,
  reconcileOpenSeaJob,
  scheduleOpenSeaReconciliation
} from "@/opensea/reconciliation";
import { claimJob, LostJobLeaseError, retryJob } from "@/db/jobs";
import type { OpenSeaClient } from "@/opensea/client";
import {
  openSeaSubmissionKind,
  processOpenSeaSubmission,
  pruneOpenSeaSubmissionJobs,
  scheduleOpenSeaSubmissions
} from "@/opensea/outbox";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

export async function runOpenSeaSubmissionWorker(input: {
  pool: Pool;
  provider: Pick<OpenSeaClient, "lookup" | "publish">;
  chain: OpenSeaChain;
  concurrency: number;
  signal: AbortSignal;
  heartbeat?: () => Promise<void>;
  reconciliation?: {
    client: PublicClient;
    policies: Pick<OpenSeaPolicyResolver, "resolve">;
    options: OpenSeaObservationOptions;
    discoveryProviderMaxAgeMs?: number;
  };
}) {
  if (
    !Number.isSafeInteger(input.concurrency) ||
    input.concurrency < 1 ||
    input.concurrency > 8
  )
    throw new Error("Invalid OpenSea worker concurrency.");
  const scope = { chainId: marketplaceChains[input.chain].chainId };
  const stop = new AbortController();
  const signal = AbortSignal.any([input.signal, stop.signal]);
  const pause = async (ms: number) => {
    try {
      await delay(ms, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  };
  const schedule = async () => {
    let lastCleanup = 0;
    let lastHeartbeat = 0;
    while (!signal.aborted) {
      await scheduleOpenSeaSubmissions(input.pool, 100, scope);
      if (input.reconciliation)
        await scheduleOpenSeaReconciliation(input.pool, input.chain);
      if (input.heartbeat && Date.now() - lastHeartbeat >= 5000) {
        await input.heartbeat();
        lastHeartbeat = Date.now();
      }
      if (Date.now() - lastCleanup >= 60000) {
        await pruneOpenSeaSubmissionJobs(input.pool, 100);
        if (input.reconciliation) await pruneOpenSeaReconcileJobs(input.pool);
        lastCleanup = Date.now();
      }
      await pause(1000);
    }
  };
  const work = async (reconcile = false) => {
    while (!signal.aborted) {
      // A provider lookup, policy refresh, chain inspection and one POST all
      // share this lease. Sending uncertainty is durable before the remote call.
      const job = await claimJob(
        input.pool,
        reconcile ? openSeaReconcileKind : openSeaSubmissionKind,
        90000,
        scope
      );
      if (!job) {
        await pause(250);
        continue;
      }
      try {
        if (reconcile && input.reconciliation) {
          const { client, policies, options } = input.reconciliation;
          await reconcileOpenSeaJob(
            input.pool,
            client,
            input.chain,
            policies,
            options,
            job
          );
        } else await processOpenSeaSubmission(input.pool, input.provider, job);
      } catch (error) {
        if (error instanceof LostJobLeaseError) continue;
        const budget = rpcComputeBudgetError(error);
        await retryJob(
          input.pool,
          job,
          reconcile
            ? "opensea_reconciliation_failed"
            : "opensea_submission_failed",
          budget
            ? Math.min(300000, budget.retryAfterMs)
            : Math.min(60000, 1000 * 2 ** Math.min(job.attempts, 6))
        );
      }
    }
  };
  const discover = async () => {
    const config = input.reconciliation!;
    while (!signal.aborted) {
      const claim = await claimDiscoveredOpenSeaOrder(
        input.pool,
        input.chain,
        openSeaProjectionLeaseMs
      );
      if (!claim) {
        await pause(1000);
        continue;
      }
      try {
        await reconcileDiscoveredOpenSeaOrder(
          input.pool,
          config.client,
          input.chain,
          config.policies,
          {
            ...config.options,
            providerMaxAgeMs: config.discoveryProviderMaxAgeMs!
          },
          claim
        );
      } catch (error) {
        if (error instanceof LostJobLeaseError) continue;
        // Keep the lease/cursor durable on infrastructure failure. A supervised
        // restart reclaims it only after expiry, without changing discovery.
        throw error;
      }
    }
  };
  const health = async () => {
    const config = input.reconciliation!;
    let lastDeepHealth = 0;
    while (!signal.aborted) {
      try {
        const deep = Date.now() - lastDeepHealth >= 4 * 60 * 1000;
        const ready = deep
          ? await observeOpenSeaReadHealth(
              input.pool,
              config.client,
              input.chain,
              config.policies,
              config.options.now,
              config.options.finality
            )
          : await observeOpenSeaHeadHealth(
              input.pool,
              config.client,
              input.chain,
              config.options.now,
              config.options.finality
            );
        if (deep && ready) lastDeepHealth = Date.now();
        await pause(ready ? 60000 : 15000);
      } catch (error) {
        const budget = rpcComputeBudgetError(error);
        if (!budget) throw error;
        await pause(Math.min(300000, budget.retryAfterMs));
      }
    }
  };
  const results = await Promise.allSettled(
    [
      schedule(),
      ...(input.reconciliation ? [health()] : []),
      ...Array.from({ length: input.concurrency }, () => work()),
      ...(input.reconciliation
        ? Array.from({ length: input.concurrency }, () => work(true))
        : []),
      ...(input.reconciliation?.discoveryProviderMaxAgeMs !== undefined
        ? [discover()]
        : [])
    ].map(async (loop) => {
      try {
        await loop;
      } catch (error) {
        stop.abort();
        throw error;
      }
    })
  );
  if (results.some((result) => result.status === "rejected"))
    throw new Error("OpenSea submission worker failed.");
}
