import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";

import { createPool } from "@/db/pool";
import { assertReady } from "@/db/readiness";
import { readEnvironment } from "@/environment";
import { createLivePublicClient } from "@/liveRpc";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { OpenSeaClient } from "@/opensea/client";
import type { OpenSeaOrderRequest } from "@/opensea/orders";
import { writeOpenSeaPublicationHeartbeat } from "@/opensea/publicationHealth";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { createOpenSeaValidation } from "@/opensea/validation";
import { runOpenSeaSubmissionWorker } from "@/opensea/worker";
import { assertOwnerTradeAuthorized } from "@/ownerTradeAuthorization";

async function main() {
  const environment = readEnvironment();
  const validationConfig = environment.openseaValidation;
  const productionConfig = environment.productionTrading?.openSea;
  const publication = productionConfig?.publication;
  if (
    !validationConfig &&
    !(
      environment.deployment === "production" &&
      productionConfig &&
      publication
    )
  )
    throw new Error(
      "The OpenSea worker requires isolated validation or owner-authorized production publication."
    );
  const pool = createPool(environment);
  pool.on("error", () =>
    console.error("OpenSea worker database connection failed.")
  );
  const abort = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let closeBudget: (() => Promise<void>) | undefined;
  let productionChain: "ethereum" | "base" | "polygon" | undefined;
  const stop = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await assertReady(pool, environment.deployment);
    if (validationConfig) {
      const validation = await createOpenSeaValidation(environment);
      const admission = new OpenSeaAdmissionService(
        pool,
        validation.clients,
        validation.policies,
        validation.options
      );
      // A fixture credential and loopback origin cannot reach the live provider.
      const provider = new OpenSeaClient({
        apiKey: "yunipals-fixture-only",
        fixtureOrigin: validationConfig.providerOrigin,
        authorizePublication: (candidate) =>
          admission.validateRetainedForSend(candidate)
      });
      console.log(
        JSON.stringify({
          service: "yunipals-opensea-worker",
          status: "started",
          deployment: "staging",
          chain: validationConfig.chain
        })
      );
      await runOpenSeaSubmissionWorker({
        pool,
        provider,
        chain: validationConfig.chain,
        concurrency: environment.workerConcurrency,
        signal: abort.signal,
        reconciliation: {
          client: validation.clients[validationConfig.chain]!,
          policies: validation.policies,
          options: validation.options,
          discoveryProviderMaxAgeMs: 300000
        }
      });
      return;
    }

    const chain = publication!.chain;
    productionChain = chain;
    const urls = productionConfig!.rpcUrls[chain]!;
    const coordinator = createOpenSeaRequestBudget();
    closeBudget = coordinator.close;
    const live = await createLivePublicClient(
      chain,
      urls,
      coordinator.rpcBudget("order_projection", "background")
    );
    const capabilities = environment.capabilities[chain];
    const enabledAdmissionSides = {
      [chain]: [
        ...(capabilities.createListing ? (["listing"] as const) : []),
        ...(capabilities.createOffer ? (["offer"] as const) : [])
      ]
    };
    let admission: OpenSeaAdmissionService;
    const provider = new OpenSeaClient({
      apiKey: productionConfig!.apiKey,
      requestBudget: coordinator.budgetFor({
        caller: "publication",
        workload: "publication",
        priority: "foreground"
      }),
      authorizePublication: async (candidate) => {
        const side = candidate.summary.side;
        if (
          candidate.summary.asset.chain !== chain ||
          (side === "listing"
            ? !capabilities.createListing
            : !capabilities.createOffer)
        )
          throw new Error("Publication is outside the authorized chain scope.");
        await admission.validateRetainedForSend(candidate);
      }
    });
    const sharedPolicies = new OpenSeaSharedPolicyResolver(
      coordinator.pool,
      coordinator.scope,
      provider,
      { maxDurationSeconds: productionConfig!.maxDurationSeconds }
    );
    const transactionPolicies = {
      resolve: (
        policyChain: Parameters<typeof sharedPolicies.resolve>[0],
        fresh?: boolean
      ) => sharedPolicies.resolve(policyChain, fresh)
    };
    const browsePolicies = {
      resolve: (policyChain: Parameters<typeof sharedPolicies.resolve>[0]) =>
        sharedPolicies.resolveCurrentBrowsePolicy(policyChain)
    };
    const options = {
      confirmations: 1n,
      finality: "finalized" as const,
      indexerMaxAgeMs: 60000,
      authorize: (input: OpenSeaOrderRequest, summary: MarketOrder) => {
        if (!environment.ownerTradeAuthorization) throw new Error();
        assertOwnerTradeAuthorized(environment.ownerTradeAuthorization, {
          action: summary.side === "listing" ? "createListing" : "createOffer",
          order: summary,
          actor: summary.maker,
          policyVersion: input.policyVersion
        });
      }
    };
    admission = new OpenSeaAdmissionService(
      pool,
      { [chain]: live.client },
      transactionPolicies,
      { ...options, enabledAdmissionSides }
    );
    await sharedPolicies.resolve(chain, true);
    await writeOpenSeaPublicationHeartbeat(pool, chain, true);
    console.log(
      JSON.stringify({
        service: "yunipals-opensea-worker",
        status: "started",
        deployment: "production",
        chain,
        authorizationConfigured: true
      })
    );
    await runOpenSeaSubmissionWorker({
      pool,
      provider,
      chain,
      concurrency: environment.workerConcurrency,
      signal: abort.signal,
      heartbeat: () => writeOpenSeaPublicationHeartbeat(pool, chain, true),
      reconciliation: {
        client: live.client,
        policies: browsePolicies,
        options,
        discoveryProviderMaxAgeMs: 300000
      }
    });
  } finally {
    stop();
    if (productionChain)
      await writeOpenSeaPublicationHeartbeat(
        pool,
        productionChain,
        false
      ).catch(() => {});
    await closeBudget?.().catch(() => {});
    await pool.end();
    if (deadline) clearTimeout(deadline);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

try {
  await main();
} catch {
  console.error(
    "OpenSea worker stopped after a configuration, database or processing failure."
  );
  process.exitCode = 1;
}
