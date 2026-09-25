import { setTimeout as delay } from "node:timers/promises";

import { BnbSaleReplay } from "@/activity/bnbReplay";
import { runBnbDiscoveryPass } from "@/bnb/discovery";
import {
  writeBnbWorkerHeartbeat,
  writeBnbWorkerUnavailable
} from "@/bnb/workerStatus";
import {
  bnbReconcileKind,
  pruneBnbReconcileJobs,
  reconcileBnbJob,
  scheduleBnbReconciliation
} from "@/bnb/reconciliation";
import {
  bnbValidationPolicy,
  createBnbValidationClient
} from "@/bnb/validation";
import { claimJob, LostJobLeaseError, retryJob } from "@/db/jobs";
import { createPool } from "@/db/pool";
import { assertReady } from "@/db/readiness";
import { readEnvironment } from "@/environment";
import { createLivePublicClient } from "@/liveRpc";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";
import { buildProductionBnbPolicy } from "@/productionRuntime";

async function main() {
  const environment = readEnvironment();
  const production = environment.productionTrading?.bnb;
  if (!environment.bnbValidationRpc && !production)
    throw new Error(
      "The BNB worker requires explicit validation or production configuration."
    );
  const pool = createPool(environment);
  const coordinator = production ? createOpenSeaRequestBudget() : undefined;
  pool.on("error", () =>
    console.error("Marketplace worker database connection failed.")
  );
  const abort = new AbortController();
  let stopping = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    abort.abort();
    deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
  };
  const pause = async (ms: number) => {
    try {
      await delay(ms, undefined, { signal: abort.signal });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    }
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await assertReady(pool, environment.deployment);
    const client = production
      ? (
          await createLivePublicClient(
            "bnb",
            production.rpcUrls,
            coordinator!.rpcBudget("order_projection", "background")
          )
        ).client
      : await createBnbValidationClient(environment.bnbValidationRpc!);
    const saleClient = production
      ? (
          await createLivePublicClient(
            "bnb",
            production.rpcUrls,
            coordinator!.rpcBudget("sale", "background")
          )
        ).client
      : client;
    const discoveryLogClient =
      environment.bnbDiscoveryStartBlock && production
        ? (
            await createLivePublicClient(
              "bnb",
              production.rpcUrls,
              coordinator!.rpcBudget("source", "background")
            )
          ).client
        : client;
    const policy = production
      ? buildProductionBnbPolicy(production)
      : bnbValidationPolicy;
    const finality = production
      ? ("finalized" as const)
      : ("confirmations" as const);
    try {
      await writeBnbWorkerHeartbeat(pool, client, finality);
    } catch (error) {
      if (!rpcComputeBudgetError(error)) throw error;
    }
    const options = {
      confirmations: production ? 1n : 20n,
      finality,
      indexerMaxAgeMs: 720000
    };
    const discovery = async () => {
      if (!environment.bnbDiscoveryStartBlock) return;
      while (!stopping) {
        try {
          const result = await runBnbDiscoveryPass({
            pool,
            logClient: discoveryLogClient,
            stateClient: client,
            policy,
            launchBlock: environment.bnbDiscoveryStartBlock,
            maxRange: 100_000n,
            maxChunks: 4
          });
          console.info(JSON.stringify({ event: "bnb_discovery_pass", ...result }));
        } catch (error) {
          if (!rpcComputeBudgetError(error))
            console.error("BNB discovery pass failed; retrying from its stored cursor.");
        }
        await pause(300_000);
      }
    };
    console.log(
      JSON.stringify({
        service: "yunipals-market-worker",
        status: "started",
        deployment: environment.deployment,
        concurrency: environment.workerConcurrency
      })
    );
    const schedule = async () => {
      let lastHeartbeat = 0;
      let lastCleanup = 0;
      while (!stopping) {
        await scheduleBnbReconciliation(pool);
        if (Date.now() - lastHeartbeat >= 60000) {
          try {
            await writeBnbWorkerHeartbeat(pool, client, finality);
            lastHeartbeat = Date.now();
          } catch (error) {
            const budget = rpcComputeBudgetError(error);
            if (!budget) throw error;
            await pause(Math.min(300000, budget.retryAfterMs));
          }
        }
        if (Date.now() - lastCleanup >= 60000) {
          await pruneBnbReconcileJobs(pool, 1000);
          lastCleanup = Date.now();
        }
        await pause(1000);
      }
    };
    const work = async () => {
      while (!stopping) {
        const job = await claimJob(pool, bnbReconcileKind);
        if (!job) {
          await pause(250);
          continue;
        }
        try {
          await reconcileBnbJob(pool, client, policy, options, job);
        } catch (error) {
          if (error instanceof LostJobLeaseError) continue;
          const budget = rpcComputeBudgetError(error);
          await retryJob(
            pool,
            job,
            "reconciliation_failed",
            budget
              ? Math.min(300000, budget.retryAfterMs)
              : Math.min(60000, 1000 * 2 ** Math.min(job.attempts, 6))
          );
        }
      }
    };
    const sales = async () => {
      const replay = new BnbSaleReplay(pool, saleClient, Date.now, {
        finality,
        confirmationPolicy: production
          ? "bnb-finalized-tag-v1"
          : "bnb-local-validation-depth-20-v1"
      });
      while (!stopping) {
        try {
          const result = await replay.tick();
          await pause(
            result === "advanced" || result === "rewound" ? 250 : 180000
          );
        } catch (error) {
          const budget = rpcComputeBudgetError(error);
          if (!budget) throw error;
          await pause(Math.min(300000, budget.retryAfterMs));
        }
      }
    };
    // Every loop propagates a database failure and aborts its siblings. A
    // supervisor restart reclaims expired leases rather than leaving a quiet stall.
    const loops = [
      schedule(),
      discovery(),
      sales(),
      ...Array.from({ length: environment.workerConcurrency }, work)
    ].map(async (loop) => {
      try {
        await loop;
      } catch (error) {
        stop();
        throw error;
      }
    });
    const results = await Promise.allSettled(loops);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Marketplace worker loop failed.");
  } finally {
    stop();
    await writeBnbWorkerUnavailable(pool).catch(() => {});
    await pool.end();
    await coordinator?.close();
    if (deadline) clearTimeout(deadline);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

try {
  await main();
} catch {
  console.error(
    "Marketplace worker stopped after a configuration, database or processing failure."
  );
  process.exitCode = 1;
}
