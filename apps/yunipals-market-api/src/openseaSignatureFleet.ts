import { createPublicClient } from "viem";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { createPool } from "@/db/pool";
import {
  readEnvironment,
  readOpenSeaProbeEnvironment,
  readOpenSeaSignatureFleetEnvironment
} from "@/environment";
import { OpenSeaClient } from "@/opensea/client";
import { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import { openSeaProjectionObservationMaxAgeMs } from "@/opensea/discoveredReconciliation";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { createMeasuredOpenSeaReadRpc } from "@/opensea/readRpc";
import { createLivePublicClient, type LiveRpc } from "@/liveRpc";
import { assertOpenSeaSignatureWorkerReady } from "@/opensea/signatureWorker";
import { runOpenSeaSignatureFleet } from "@/opensea/signatureFleet";
import { signatureChains } from "@/opensea/signatureSchedule";

async function main() {
  const environment = readEnvironment();
  const config = readOpenSeaSignatureFleetEnvironment();
  const common = config.chains.ethereum;
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
    process.exitCode = 1;
    stop();
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const limit =
    common.maxSeconds === undefined
      ? undefined
      : setTimeout(stop, common.maxSeconds * 1000);
  limit?.unref();
  const rpcs: Partial<Record<(typeof signatureChains)[number], LiveRpc>> = {};
  if (environment.deployment !== "production")
    for (const chain of signatureChains)
      rpcs[chain] = createMeasuredOpenSeaReadRpc(
        config.chains[chain].rpcUrls,
        6000,
        30000,
        computeBudget
      );
  const log = (value: Record<string, unknown>) =>
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-signature-fleet",
        ...value,
        publicationEnabled: false,
        settlementEnabled: false
      })
    );
  try {
    await assertOpenSeaSignatureWorkerReady(pool, environment.deployment);
    const signatureBudget = coordinator.backgroundBudget(common.headroom, {
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
    const services: Partial<
      Record<(typeof signatureChains)[number], OpenSeaFulfillmentService>
    > = {};
    for (const chain of signatureChains) {
      let client;
      if (environment.deployment === "production") {
        const live = await createLivePublicClient(
          chain,
          config.chains[chain].rpcUrls,
          computeBudget
        );
        client = live.client;
        rpcs[chain] = live.rpc;
      } else
        client = createPublicClient({
          cacheTime: 0,
          transport: rpcs[chain]!.transport
        });
      if ((await client.getChainId()) !== marketplaceChains[chain].chainId)
        throw new Error("Signature fleet RPC chain mismatch.");
      services[chain] = new OpenSeaFulfillmentService(
        pool,
        { [chain]: client },
        { resolve: (chain, fresh) => shared.resolve(chain, fresh) },
        provider,
        {
          ...config.chains[chain],
          observationMaxAgeMs: openSeaProjectionObservationMaxAgeMs
        }
      );
    }
    log({
      status: "started",
      deployment: environment.deployment,
      chains: signatureChains,
      headroom: common.headroom
    });
    const report = await runOpenSeaSignatureFleet({
      pool,
      listingActor: common.listingActor,
      directory: config.directory,
      signal: abort.signal,
      service: {
        preflight: (chain, hash, input) =>
          services[chain]!.preflight(chain, hash, input)
      }
    });
    log({ status: "stopped", ...report });
  } finally {
    stop();
    log({
      status: "rpc-report",
      chains: Object.fromEntries(
        signatureChains.map((chain) => [chain, rpcs[chain]?.snapshot()])
      )
    });
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
    "OpenSea signature fleet stopped after a configuration or processing failure."
  );
  process.exitCode = 1;
}
