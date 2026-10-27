import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { isAddress } from "viem";

import { boosterAddresses, boosterQueryKey } from "@/lib/boosters";
import {
  fetchPackGridPage,
  matchesPackGridFilters,
  type PackGridFilters
} from "@/lib/boosterCollectionGrid";

export function useBoosterCollectionCards(
  filters: PackGridFilters,
  owner?: string,
  visible = true
) {
  const deployment = boosterAddresses();
  const expectedOwner = owner?.toLowerCase();
  const enabled = Boolean(
    deployment &&
      visible &&
      (!filters.chains.length || filters.chains.includes("base")) &&
      (owner === undefined || isAddress(owner))
  );
  const query = useInfiniteQuery({
    queryKey: [
      ...boosterQueryKey,
      "normal-collection",
      deployment?.monsters,
      expectedOwner ?? "all"
    ],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      fetchPackGridPage(deployment!.monsters, expectedOwner, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 15000,
    refetchInterval: enabled ? 15000 : false,
    retry: 1
  });
  const items = useMemo(() => {
    if (!enabled) return [];
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (item) => {
        if (seen.has(item.id) || !matchesPackGridFilters(item, filters))
          return false;
        seen.add(item.id);
        return true;
      }
    );
  }, [enabled, query.data, filters]);
  return { query, enabled, items };
}
