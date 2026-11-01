import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  collectorClient,
  collectorFiltersKey,
  collectorPageSize,
  hasCollectorFilters,
  pruneCollectorPages,
  type CollectorFilters,
  type CollectorPage
} from "@/lib/collector";
import {
  fetchOwnerTokens,
  indexedCollectionCacheVersion,
  IndexerError,
  type OwnerTokenPage
} from "@/lib/yunipalsIndexer";

export function useCollectorTokens(
  owner: string,
  validOwner: boolean,
  visibility: "visible" | "hidden",
  filters: CollectorFilters,
  filterError: string | null
) {
  const client = useQueryClient();
  const capabilities = useQuery({
    queryKey: ["collector-capabilities"],
    queryFn: ({ signal }) => collectorClient.capabilities(signal),
    enabled: validOwner,
    staleTime: 5 * 60_000,
    retry: false
  });
  const supported = capabilities.data?.version === 1;
  const filtersKey = collectorFiltersKey(filters);
  const scope = JSON.stringify([owner, visibility, supported, filtersKey]);
  const [navigation, setNavigation] = useState({
    scope,
    cursor: "",
    history: [] as string[]
  });
  const current =
    navigation.scope === scope
      ? navigation
      : { scope, cursor: "", history: [] as string[] };
  const unsupportedFilters =
    !supported &&
    (hasCollectorFilters(filters) || filters.sort !== "rarity-capped-desc");
  const unsupportedName =
    supported &&
    !capabilities.data?.namePrefixSearch &&
    Boolean(filters.search) &&
    !/^\d+$/.test(filters.search);
  const unsupportedRarityRange =
    supported &&
    !capabilities.data?.rarityRange &&
    Boolean(filters.rarityMin || filters.rarityMax);
  const queryKey = [
    "collector",
    indexedCollectionCacheVersion,
    owner,
    "tokens",
    visibility,
    "page-v1",
    supported,
    filtersKey,
    current.cursor
  ] as const;
  const tokensQuery = useQuery<OwnerTokenPage | CollectorPage>({
    queryKey,
    enabled:
      validOwner &&
      !capabilities.isPending &&
      !filterError &&
      !unsupportedFilters &&
      !unsupportedName &&
      !unsupportedRarityRange,
    queryFn: ({ signal }) =>
      supported
        ? collectorClient.page(
            owner,
            filters,
            visibility,
            current.cursor,
            signal
          )
        : fetchOwnerTokens(
            owner,
            {
              limit: collectorPageSize,
              cursor: current.cursor || undefined,
              visibility
            },
            signal
          ),
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (count, error) =>
      count < 1 && !(error instanceof IndexerError && error.status < 500)
  });
  const activeHash = hashKey(queryKey);
  useEffect(() => {
    let queued = false;
    let disposed = false;
    const prune = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        if (!disposed) pruneCollectorPages(client, activeHash);
        queued = false;
      });
    };
    prune();
    const unsubscribe = client.getQueryCache().subscribe(prune);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, activeHash]);

  const modernPage =
    tokensQuery.data && "version" in tokensQuery.data
      ? tokensQuery.data
      : undefined;
  const previousCursor =
    modernPage?.previousCursor ??
    (!supported && current.history.length
      ? current.history[current.history.length - 1]!
      : null);
  const cursorError =
    tokensQuery.error instanceof IndexerError &&
    tokensQuery.error.code === "invalid_collector_cursor";
  const viewError =
    filterError ??
    (unsupportedName
      ? "Name search is temporarily unavailable. Clear filters and search by token ID."
      : null) ??
    (unsupportedRarityRange
      ? "Rarity range filtering is temporarily unavailable. Clear the rarity range to browse your holdings."
      : null) ??
    (unsupportedFilters && !capabilities.isPending
      ? "These collection filters are temporarily unavailable. Clear filters to browse your holdings."
      : null);

  return {
    tokensQuery,
    supported,
    capabilities,
    cursor: current.cursor,
    viewError,
    cursorError,
    loading: capabilities.isPending || tokensQuery.isLoading,
    hasPrevious: previousCursor !== null,
    hasNext: Boolean(tokensQuery.data?.nextCursor),
    next() {
      if (!tokensQuery.data?.nextCursor || tokensQuery.isFetching) return;
      setNavigation({
        scope,
        cursor: tokensQuery.data.nextCursor,
        history: supported ? [] : [...current.history, current.cursor]
      });
    },
    previous() {
      if (previousCursor === null || tokensQuery.isFetching) return;
      setNavigation({
        scope,
        cursor: previousCursor,
        history: current.history.slice(0, -1)
      });
    },
    async restart() {
      await client.cancelQueries({
        queryKey: ["collector", indexedCollectionCacheVersion, owner, "tokens"]
      });
      setNavigation({ scope, cursor: "", history: [] });
      await client.invalidateQueries({
        queryKey: ["collector", indexedCollectionCacheVersion, owner, "tokens"],
        refetchType: "none"
      });
      // Reset page one only; inactive cached pages remain stale until visited.
      await client.resetQueries({
        queryKey: [...queryKey.slice(0, -1), ""],
        exact: true
      });
    }
  };
}
