import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import { applySettlementsToCatalog } from "@/lib/marketplace/confirmedSettlements";
import { restartMarketCatalog } from "@/lib/marketplace/settlementReconciliation";
import { MarketApiError } from "@/lib/marketplace/marketApiError";

import { environment } from "@/environment";
import {
  collectionFiltersKey,
  type CollectionFilters
} from "@/lib/collectionFilters";
import {
  createCatalogClient,
  nextCatalogPage,
  validateCatalogFilters,
  type CatalogContinuation
} from "@/lib/marketplace/catalog";

const client = (() => {
  try {
    return environment.yunipalsMarketplaceUrl
      ? createCatalogClient(environment.yunipalsMarketplaceUrl)
      : null;
  } catch {
    return null;
  }
})();

export function useMarketCatalog(filters: CollectionFilters) {
  const queries = useQueryClient();
  const changes = useConfirmedSettlements();
  const recovered = useRef(new Set<string>());
  let validationError: string | null = null;
  try {
    validateCatalogFilters(filters);
  } catch (error) {
    validationError =
      error instanceof Error ? error.message : "Check the collection filters.";
  }
  const queryKey = [
    "marketplace",
    "catalog",
    collectionFiltersKey(filters)
  ] as const;
  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(client) && !validationError,
    initialPageParam: undefined as CatalogContinuation | undefined,
    queryFn: ({ pageParam, signal }) =>
      client!.catalog(filters, pageParam, signal),
    getNextPageParam: (last, pages) => nextCatalogPage(last, pages, filters),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (count, error) =>
      !(error instanceof MarketApiError && error.status === 409) && count < 1
  });
  const snapshot = query.data?.pages[0]?.snapshot.id ?? "initial";
  const filterKey = collectionFiltersKey(filters);
  useEffect(() => {
    const error = query.error;
    if (
      !(error instanceof MarketApiError && error.status === 409) &&
      !(
        error instanceof Error &&
        error.message.startsWith("The catalog snapshot changed")
      )
    )
      return;
    const key = `${filterKey}:${snapshot}`;
    if (recovered.current.has(key)) return;
    recovered.current.add(key);
    void restartMarketCatalog(queries, true).catch(() => {});
  }, [query.error, filterKey, snapshot, queries]);
  const data = useMemo(
    () =>
      query.data
        ? applySettlementsToCatalog(query.data, changes, filters)
        : undefined,
    [query.data, changes, filterKey]
  );
  return {
    configured: Boolean(client),
    validationError,
    queryKey,
    query: { ...query, data }
  };
}
