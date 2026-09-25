import { createPublicClient } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { createPool } from "@/db/pool";
import {
  readEnvironment,
  readOpenSeaProbeEnvironment,
  readOpenSeaSignatureEnvironment
} from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import { openSeaProjectionObservationMaxAgeMs } from "@/opensea/discoveredReconciliation";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { createMeasuredOpenSeaReadRpc } from "@/opensea/readRpc";
import { createLivePublicClient } from "@/liveRpc";
import {
  assertOpenSeaSignatureWorkerReady,
  runOpenSeaSignatureWorker
} from "@/opensea/signatureWorker";

async function main() {
  const environment = readEnvironment();
  const config = readOpenSeaSignatureEnvironment();
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
  pool.on("error", () => {
    console.error("OpenSea signature database connection failed.");
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
  try {
    await assertOpenSeaSignatureWorkerReady(pool, environment.deployment);
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
      throw new Error("Signature RPC chain mismatch.");
    const signatureBudget = coordinator.backgroundBudget(config.headroom, {
      caller: "signature",
      workload: "signature",
      priority: "background"
    });
    const policyProvider = new OpenSeaClient({
      apiKey: credential.apiKey,
      requestBudget: signatureBudget
    });
    const shared = new OpenSeaSharedPolicyResolver(
      coordinator.pool,
      coordinator.scope,
      policyProvider,
      { maxDurationSeconds: credential.maxDurationSeconds }
    );
    const provider = new OpenSeaClient({
      apiKey: credential.apiKey,
      requestBudget: signatureBudget
    });
    const service = new OpenSeaFulfillmentService(
      pool,
      { [config.chain]: client },
      { resolve: (chain, fresh) => shared.resolve(chain, fresh) },
      provider,
      {
        ...config,
        observationMaxAgeMs: openSeaProjectionObservationMaxAgeMs
      }
    );
    const log = (value: Record<string, unknown>) =>
      console.log(
        JSON.stringify({
          service: "yunipals-opensea-signature-worker",
          chain: config.chain,
          ...value,
          publicationEnabled: false,
          settlementEnabled: false
        })
      );
    log({
      status: "started",
      deployment: environment.deployment,
      headroom: config.headroom
    });
    const report = await runOpenSeaSignatureWorker({
      pool,
      chain: config.chain,
      listingActor: config.listingActor,
      service,
      signal: abort.signal
    });
    log({ status: "stopped", ...report });
  } finally {
    stop();
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-signature-worker",
        status: "rpc-report",
        chain: config.chain,
        rpc: rpc?.snapshot(),
        publicationEnabled: false,
        settlementEnabled: false
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
    "OpenSea signature worker stopped after a configuration or processing failure."
  );
  process.exitCode = 1;
}
