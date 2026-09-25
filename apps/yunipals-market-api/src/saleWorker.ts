import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { CollectionSaleReplay } from "@/activity/collectionReplay";
import { createPool } from "@/db/pool";
import { assertReady } from "@/db/readiness";
import { readEnvironment, readSaleReplayEnvironment } from "@/environment";
import { createMeasuredOpenSeaReadRpc } from "@/opensea/readRpc";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { rpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

let failureStage = "configuration";

async function main() {
  const environment = readEnvironment();
  const config = readSaleReplayEnvironment();
  const pool = createPool(environment);
  const coordinator =
    config.mode === "live" ? createOpenSeaRequestBudget() : undefined;
  const abort = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
  };
  pool.on("error", () => {
    console.error("Sale replay database connection failed.");
    process.exitCode = 1;
    stop();
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const limit = config.maxSeconds
    ? setTimeout(stop, config.maxSeconds * 1000)
    : undefined;
  limit?.unref();
  const rpc = createMeasuredOpenSeaReadRpc(
    config.rpcUrls,
    6000,
    30000,
    coordinator?.rpcBudget("sale", "background")
  );
  const report = {
    advanced: 0,
    idle: 0,
    rewound: 0,
    superseded: 0,
    unavailable: 0,
    budgetDeferred: 0
  };
  const log = (status: string, fields: object = {}) =>
    console.log(
      JSON.stringify({
        service: "yunipals-sale-worker",
        status,
        chain: config.chain,
        mode: config.mode,
        policy: config.policy,
        ...fields
      })
    );
  try {
    failureStage = "database-readiness";
    await assertReady(pool, environment.deployment);
    failureStage = "rpc-chain-identity";
    const client = createPublicClient({
      cacheTime: 0,
      transport: rpc.transport
    });
    if ((await client.getChainId()) !== marketplaceChains[config.chain].chainId)
      throw new Error("Sale replay RPC chain mismatch.");
    if (config.mode === "fork") {
      // This read-only check cannot reach a remote endpoint in fork mode.
      const response = await fetch(config.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_metadata",
          params: []
        }),
        signal: AbortSignal.timeout(6000),
        redirect: "error"
      });
      const metadata = (await response.json()) as {
        result?: { forkedNetwork?: { chainId?: number } };
      };
      if (
        !response.ok ||
        metadata.result?.forkedNetwork?.chainId !==
          marketplaceChains[config.chain].chainId
      )
        throw new Error("Sale replay requires a verified Anvil fork.");
    }
    const replay = new CollectionSaleReplay(
      pool,
      client,
      config.chain,
      Date.now,
      config.policy,
      config.finality
    );
    failureStage = "replay-loop";
    log("started", {
      deployment: environment.deployment,
      maxSeconds: config.maxSeconds ?? null,
      continuous: config.maxSeconds === undefined
    });
    let previous: string | undefined;
    while (!abort.signal.aborted) {
      let status: Awaited<ReturnType<CollectionSaleReplay["tick"]>>;
      try {
        status = await replay.tick();
      } catch (error) {
        const budget = rpcComputeBudgetError(error);
        if (!budget) throw error;
        report.budgetDeferred++;
        if (previous !== "budget-deferred")
          log("budget-deferred", { retryAfterMs: budget.retryAfterMs });
        previous = "budget-deferred";
        try {
          await delay(Math.min(300000, budget.retryAfterMs), undefined, {
            signal: abort.signal
          });
        } catch (delayError) {
          if (!abort.signal.aborted) throw delayError;
        }
        continue;
      }
      report[status]++;
      if (status !== previous || status === "rewound")
        log("progress", { result: status });
      previous = status;
      try {
        await delay(
          status === "advanced" || status === "rewound"
            ? 250
            : status === "unavailable"
              ? 30000
              : 180000,
          undefined,
          { signal: abort.signal }
        );
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    }
    log("stopped", report);
  } finally {
    stop();
    if (limit) clearTimeout(limit);
    log("rpc-report", { rpc: rpc.snapshot(), results: report });
    await pool.end();
    await coordinator?.close();
    if (deadline) clearTimeout(deadline);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      service: "yunipals-sale-worker",
      status: "failed",
      stage: failureStage,
      type: error instanceof Error ? error.name : "unknown",
      ...(rpcComputeBudgetError(error) ? { code: "rpc_budget_exhausted" } : {})
    })
  );
  process.exitCode = 1;
}
