import { useQuery } from "@tanstack/react-query";

import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import { applySettlementsToAsset } from "@/lib/marketplace/confirmedSettlements";
import { environment } from "@/environment";
import {
  createMarketClient,
  type MarketAssetId
} from "@/lib/marketplace/marketApi";
import { marketplaceAssetKey } from "@/lib/marketplace/registry";

export const marketClient = (() => {
  try {
    return environment.yunipalsMarketplaceUrl
      ? createMarketClient(environment.yunipalsMarketplaceUrl)
      : null;
  } catch {
    return null;
  }
})();

export function useMarketplace(
  asset: MarketAssetId | null,
  transferBlock?: string
) {
  const changes = useConfirmedSettlements();
  const capabilities = useQuery({
    queryKey: ["marketplace", "capabilities"],
    queryFn: ({ signal }) => marketClient!.capabilities(signal),
    enabled: Boolean(marketClient),
    staleTime: 10_000,
    retry: 1
  });
  const market = useQuery({
    queryKey: [
      "marketplace",
      "asset",
      asset ? marketplaceAssetKey(asset) : "invalid"
    ],
    queryFn: ({ signal }) => marketClient!.asset(asset!, signal),
    enabled: Boolean(
      marketClient && asset && capabilities.data?.[asset.chain]?.read
    ),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1
  });
  return {
    configured: Boolean(marketClient),
    capabilities,
    market: {
      ...market,
      data: market.data
        ? applySettlementsToAsset(market.data, changes, transferBlock)
        : undefined
    }
  };
}
