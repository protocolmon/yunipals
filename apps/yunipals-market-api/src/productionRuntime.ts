import type { Pool } from "pg";
import type { PublicClient } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  bnbOfferCurrency,
  marketplaceChains
} from "@protopals/yunipals-market-core/registry";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

import { BnbFulfillmentService } from "@/bnb/fulfillment";
import { BnbOrderError, bnbOrderSummary, type BnbPolicy } from "@/bnb/orders";
import type { Environment, MarketCapabilitySet } from "@/environment";
import { createLivePublicClient, type LiveRpc } from "@/liveRpc";
import { OpenSeaAdmissionService } from "@/opensea/admission";
import { OpenSeaClient } from "@/opensea/client";
import { OpenSeaFulfillmentService } from "@/opensea/fulfillment";
import { OpenSeaOrderError, type OpenSeaOrderRequest } from "@/opensea/orders";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import { OpenSeaSharedPolicyResolver } from "@/opensea/sharedPolicy";
import { assertOwnerTradeAuthorized } from "@/ownerTradeAuthorization";

const openSeaChains = ["ethereum", "base", "polygon"] as const;

export function buildProductionBnbPolicy(
  config: NonNullable<NonNullable<Environment["productionTrading"]>["bnb"]>
): BnbPolicy {
  return {
    version: config.policy.version,
    rules: {
      collection: marketplaceChains.bnb.contractAddress,
      offerCurrency: bnbOfferCurrency.address,
      fees: config.policy.fees,
      maxDurationSeconds: config.policy.maxDurationSeconds
    }
  };
}

function admissionSides(capabilities: MarketCapabilitySet) {
  return [
    ...(capabilities.createListing ? (["listing"] as const) : []),
    ...(capabilities.createOffer ? (["offer"] as const) : [])
  ];
}

function fulfillmentSides(capabilities: MarketCapabilitySet) {
  return [
    ...(capabilities.buy ? (["listing"] as const) : []),
    ...(capabilities.acceptOffer ? (["offer"] as const) : [])
  ];
}

export async function createProductionRuntime(
  environment: Environment,
  pool: Pool
) {
  if (environment.deployment !== "production")
    throw new Error(
      "The production runtime requires production configuration."
    );
  const config = environment.productionTrading;
  if (!config) throw new Error("No production trading runtime is configured.");
  const authorization = environment.ownerTradeAuthorization;
  const budget = createOpenSeaRequestBudget();
  const computeBudget = budget.rpcBudget("foreground", "foreground");
  const rpc: Partial<Record<"ethereum" | "base" | "polygon" | "bnb", LiveRpc>> =
    {};
  try {
    let openseaValidation;
    let openseaFulfillment;
    if (config.openSea) {
      const entries: Array<readonly [OpenSeaChain, PublicClient]> = [];
      // Startup probes share the same bounded free RPC routes as the read
      // workers. Probe chains in order so a restart cannot saturate every
      // route at once before the API becomes ready.
      for (const chain of openSeaChains) {
        const urls = config.openSea.rpcUrls[chain];
        if (!urls) continue;
        const value = await createLivePublicClient(chain, urls, computeBudget);
        rpc[chain] = value.rpc;
        entries.push([chain, value.client]);
      }
      const clients = Object.fromEntries(entries) as Partial<
        Record<OpenSeaChain, PublicClient>
      >;
      const provider = new OpenSeaClient({
        apiKey: config.openSea.apiKey,
        requestBudget: budget.budgetFor({
          caller: "api",
          workload: "foreground",
          priority: "foreground"
        })
      });
      const policies = new OpenSeaSharedPolicyResolver(
        budget.pool,
        budget.scope,
        provider,
        {
          maxDurationSeconds: config.openSea.maxDurationSeconds,
          // Bound foreground refreshes. Workers keep their separate background budgets.
          timeoutMs: 4000,
          observe: (timing) =>
            console.info(
              JSON.stringify({
                event: "market_policy_resolution",
                ...timing
              })
            )
        }
      );
      const enabledAdmissionSides = Object.fromEntries(
        entries.flatMap(([chain]) => {
          const sides = admissionSides(environment.capabilities[chain]);
          return sides.length ? [[chain, sides] as const] : [];
        })
      );
      const enabledFulfillmentSides = Object.fromEntries(
        entries.flatMap(([chain]) => {
          const sides = fulfillmentSides(environment.capabilities[chain]);
          return sides.length ? [[chain, sides] as const] : [];
        })
      );
      const options = {
        confirmations: 1n,
        finality: "finalized" as const,
        indexerMaxAgeMs: 60000,
        // Public RPC pacing can span the interactive default. Fulfillment still
        // rechecks the exact canonical block and expires provider data at 30s.
        observationMaxAgeMs: 30000,
        authorize: (input: OpenSeaOrderRequest, summary: MarketOrder) => {
          try {
            if (!authorization) throw new Error();
            assertOwnerTradeAuthorized(authorization, {
              action:
                summary.side === "listing" ? "createListing" : "createOffer",
              order: summary,
              actor: summary.maker,
              policyVersion: input.policyVersion
            });
          } catch {
            throw new OpenSeaOrderError("owner_trade_not_authorized", 503);
          }
        }
      };
      openseaValidation = new OpenSeaAdmissionService(pool, clients, policies, {
        ...options,
        enabledAdmissionSides
      });
      if (Object.keys(enabledFulfillmentSides).length)
        openseaFulfillment = new OpenSeaFulfillmentService(
          pool,
          clients,
          policies,
          provider,
          {
            ...options,
            providerMaxAgeMs: 300000,
            enabledFulfillmentSides,
            onTiming: (stage, milliseconds) =>
              console.log(
                JSON.stringify({
                  event: "trade_preparation_timing",
                  stage,
                  milliseconds
                })
              ),
            authorize: (summary, actor, policyVersion) => {
              try {
                if (!authorization) throw new Error();
                assertOwnerTradeAuthorized(authorization, {
                  action: summary.side === "listing" ? "buy" : "acceptOffer",
                  order: summary,
                  actor,
                  policyVersion
                });
              } catch {
                throw new OpenSeaOrderError("owner_trade_not_authorized", 503);
              }
            }
          }
        );
    }

    let bnbValidation;
    let bnbClient: PublicClient | undefined;
    if (config.bnb) {
      const live = await createLivePublicClient(
        "bnb",
        config.bnb.rpcUrls,
        computeBudget
      );
      bnbClient = live.client;
      rpc.bnb = live.rpc;
      const policy = buildProductionBnbPolicy(config.bnb);
      const enabledFulfillmentSides = fulfillmentSides(
        environment.capabilities.bnb
      );
      const options = {
        confirmations: 1n,
        finality: "finalized" as const,
        // The source indexer polls every five minutes to keep provider spend
        // bounded. Fulfillment checks the verified checkpoint and current chain.
        indexerMaxAgeMs: 360000
      };
      bnbValidation = {
        policy,
        fulfillment: enabledFulfillmentSides.length
          ? new BnbFulfillmentService(pool, bnbClient, policy, {
              ...options,
              enabledFulfillmentSides,
              authorize: (input, summary, actor) => {
                try {
                  if (!authorization) throw new Error();
                  assertOwnerTradeAuthorized(authorization, {
                    action: summary.side === "listing" ? "buy" : "acceptOffer",
                    order: bnbOrderSummary(input, summary, "active"),
                    actor,
                    policyVersion: policy.version
                  });
                } catch {
                  throw new BnbOrderError("owner_trade_not_authorized", 503);
                }
              }
            })
          : undefined
      };
    }
    return {
      bnbValidation,
      bnbClient,
      openseaValidation,
      openseaFulfillment,
      rpc,
      close: async () => budget.close()
    };
  } catch (error) {
    await budget.close().catch(() => {});
    throw error;
  }
}
