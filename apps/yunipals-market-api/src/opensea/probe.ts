import { marketplaceChains } from "@protopals/yunipals-market-core/registry";

import { OpenSeaError } from "@/opensea/client";
import {
  OpenSeaPolicyError,
  type OpenSeaPolicyResolver
} from "@/opensea/policy";

/** Provider GET access and advertised policy only; no publication or fulfillment. */
export async function probeOpenSeaAccess(
  resolver: Pick<OpenSeaPolicyResolver, "resolve">
) {
  const chains = ["ethereum", "base", "polygon"] as const;
  const observations = await Promise.all(
    chains.map(async (chain) => {
      try {
        const result = await resolver.resolve(chain, true);
        return {
          chain,
          chainId: marketplaceChains[chain].chainId,
          status: "available" as const,
          collectionSlug: result.collectionSlug,
          policy: result.wire,
          providerFees: result.providerFees
        };
      } catch (error) {
        return {
          chain,
          chainId: marketplaceChains[chain].chainId,
          status: "unavailable" as const,
          reason:
            error instanceof OpenSeaError || error instanceof OpenSeaPolicyError
              ? error.code
              : "provider_probe_failed"
        };
      }
    })
  );
  return {
    checkedAt: new Date().toISOString(),
    status: observations.every((row) => row.status === "available")
      ? ("available" as const)
      : ("unavailable" as const),
    scope:
      "Current provider GET access and reported collection policy; publication permissions, executable-order acceptance, protected fulfillment, quotas and key lifetime remain unverified.",
    providerWritesEnabled: false,
    observations
  };
}
