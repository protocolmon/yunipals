import { useInfiniteQuery } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";

import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import { orderWasFilled } from "@/lib/marketplace/confirmedSettlements";
import { marketClient } from "@/hooks/marketplace/useMarketplace";
import {
  marketOrderKey,
  type WalletOrderView
} from "@/lib/marketplace/marketApi";
import type { MarketplaceChain } from "@/lib/marketplace/registry";

type Page = { cursor: string; snapshot: string; visited: string[] } | null;

export function useWalletOrders(
  wallet: Address,
  view: WalletOrderView,
  chain: MarketplaceChain | "all"
) {
  const changes = useConfirmedSettlements();
  const query = useInfiniteQuery({
    queryKey: ["marketplace", "wallet-orders", getAddress(wallet), view, chain],
    enabled: Boolean(marketClient),
    initialPageParam: null as Page,
    queryFn: async ({ pageParam, signal }) => {
      const page = await marketClient!.walletOrders(
        {
          wallet,
          view,
          chain,
          ...(pageParam
            ? { cursor: pageParam.cursor, snapshot: pageParam.snapshot }
            : {})
        },
        signal
      );
      if (page.nextCursor && pageParam?.visited.includes(page.nextCursor))
        throw new Error("Order-history pagination repeated. Refresh the view.");
      return page;
    },
    getNextPageParam: (last, pages): Page | undefined =>
      last.nextCursor
        ? {
            cursor: last.nextCursor,
            snapshot: last.snapshot.id,
            visited: pages.flatMap((page) =>
              page.nextCursor ? [page.nextCursor] : []
            )
          }
        : undefined,
    staleTime: 15_000,
    retry: 1,
    // Explicit refresh starts a new snapshot. Do not splice independently
    // refreshed pages into an older history snapshot while the user browses.
    refetchOnWindowFocus: false
  });
  const known = new Set<string>();
  const items = (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => {
      // Other signed orders remain manageable/cancellable after a transfer.
      // Only the verified filled order is removed from open-order workspaces.
      if (view !== "history" && orderWasFilled(item.order, changes))
        return false;
      const key = marketOrderKey(item.order);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    }
  );
  return { configured: Boolean(marketClient), query, items };
}
