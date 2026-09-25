import { createPublicClient } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { createPool } from "@/db/pool";
import {
  readEnvironment,
  readOpenSeaProbeEnvironment,
  readOpenSeaReadEnvironment
} from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { createMeasuredOpenSeaReadRpc } from "@/opensea/readRpc";
import { createLivePublicClient } from "@/liveRpc";
import { OpenSeaReadEvidenceCache } from "@/opensea/readEvidenceCache";
import {
  assertOpenSeaReadWorkerReady,
  classifyOpenSeaReadTransientFailure,
  runOpenSeaReadWorker
} from "@/opensea/readWorker";

async function main() {
  const environment = readEnvironment();
  const config = readOpenSeaReadEnvironment();
  const credential = readOpenSeaProbeEnvironment();
  const coordinator = createOpenSeaRequestBudget();
  const computeBudget = coordinator.rpcBudget("order_projection", "background");
  const pool = createPool(environment);
  const abort = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    deadline = setTimeout(() => process.exit(1), 30000);
    deadline.unref();
  };
  const reportTransientFailure = (code: string) =>
    console.warn(
      JSON.stringify({
        service: "yunipals-opensea-read-worker",
        status: "transient-failure",
        chain: config.chain,
        code,
        providerWritesEnabled: false
      })
    );
  pool.on("error", (error) => {
    const code = classifyOpenSeaReadTransientFailure(error);
    if (code) {
      reportTransientFailure(code);
      return;
    }
    console.error("OpenSea read database connection failed.");
    process.exitCode = 1;
    stop();
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const limit =
    config.maxSeconds === undefined
      ? undefined
      : setTimeout(stop, config.maxSeconds * 1000);
  limit?.unref();
  let rpc =
    environment.deployment === "production"
      ? undefined
      : createMeasuredOpenSeaReadRpc(
          config.rpcUrls,
          6000,
          30000,
          computeBudget
        );
  let evidence: OpenSeaReadEvidenceCache | undefined;
  try {
    await assertOpenSeaReadWorkerReady(pool, environment.deployment);
    let client;
    if (environment.deployment === "production") {
      const live = await createLivePublicClient(
        config.chain,
        config.rpcUrls,
        computeBudget
      );
      client = live.client;
      rpc = live.rpc;
    } else
      client = createPublicClient({
        cacheTime: 0,
        transport: rpc!.transport
      });
    if ((await client.getChainId()) !== marketplaceChains[config.chain].chainId)
      throw new Error("Read RPC chain mismatch.");
    evidence = new OpenSeaReadEvidenceCache(client);
    const provider = new OpenSeaClient({
      apiKey: credential.apiKey,
      requestBudget: coordinator.backgroundBudget(
        { allPerHour: 180, fulfillmentPerMinute: 2 },
        {
          caller: "read_worker",
          workload: "order_projection",
          priority: "background"
        }
      )
    });
    const policies = new OpenSeaSharedPolicyResolver(
      coordinator.pool,
      coordinator.scope,
      provider,
      { maxDurationSeconds: credential.maxDurationSeconds }
    );
    const browsePolicies = {
      resolve: (chain: Parameters<typeof policies.resolve>[0]) =>
        policies.resolveCurrentBrowsePolicy(chain)
    };
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-read-worker",
        status: "started",
        chain: config.chain,
        deployment: environment.deployment,
        concurrency: config.concurrency,
        providerWritesEnabled: false
      })
    );
    const report = await runOpenSeaReadWorker({
      pool,
      client,
      chain: config.chain,
      policies: browsePolicies,
      options: { ...config, evidence },
      concurrency: config.concurrency,
      signal: abort.signal,
      onTransientFailure: reportTransientFailure
    });
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-read-worker",
        status: "stopped",
        chain: config.chain,
        ...report,
        providerWritesEnabled: false
      })
    );
  } finally {
    stop();
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-read-worker",
        status: "rpc-report",
        chain: config.chain,
        rpc: rpc?.snapshot(),
        evidenceCache: evidence?.snapshot(),
        providerWritesEnabled: false
      })
    );
    if (limit) clearTimeout(limit);
    await pool.end();
    await coordinator.close();
    if (deadline) clearTimeout(deadline);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}
try {
  await main();
} catch {
  console.error(
    "OpenSea read worker stopped after a configuration or processing failure."
  );
  process.exitCode = 1;
}
