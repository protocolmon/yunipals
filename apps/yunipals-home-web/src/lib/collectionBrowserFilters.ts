import * as evm from "@/lib/collectionFilters";
import { environment } from "@/environment";
import { indexedChains, isIndexedChain } from "@/lib/yunipalsIndexer";

export type CollectionChain = (typeof indexedChains)[number] | "solana";
export type CollectionSort = evm.CollectionSort;
export type CollectionFilters = Omit<evm.CollectionFilters, "chains"> & {
  chains: CollectionChain[];
  excludedChains: CollectionChain[];
  /** Original selection before explicitly narrowing to priced networks. */
  marketReturnChains?: CollectionChain[];
};
export const collectionChains: readonly CollectionChain[] = [
  ...indexedChains,
  ...(environment.exomonEnabled ? ["solana" as const] : [])
];
export const isPriceSort = evm.isPriceSort;

/** Resolve exclusions before asking an API for pages, counts or facets. */
export function effectiveCollectionChains(filters: CollectionFilters) {
  return collectionChains.filter(
    (chain) =>
      (chain !== "solana" || environment.exomonEnabled) &&
      (!filters.chains.length || filters.chains.includes(chain)) &&
      !(filters.excludedChains ?? []).includes(chain)
  );
}

/** Marketplace and wallet clients retain their EVM-only types. */
export function toEvmCollectionFilters(
  filters: CollectionFilters
): evm.CollectionFilters {
  const chains = effectiveCollectionChains(filters).filter(isIndexedChain);
  return {
    ...filters,
    chains: chains.length === indexedChains.length ? [] : chains
  };
}

export function includesSolana(filters: CollectionFilters) {
  return effectiveCollectionChains(filters).includes("solana");
}

export function parseCollectionFilters(
  params: URLSearchParams
): CollectionFilters {
  const selected = collectionChains.filter((chain) =>
    params.getAll("chain").includes(chain)
  );
  return {
    ...evm.parseCollectionFilters(params),
    chains: selected.length === collectionChains.length ? [] : selected,
    excludedChains: collectionChains.filter((chain) =>
      params.getAll("excludeChain").includes(chain)
    ),
    marketReturnChains:
      environment.exomonEnabled &&
      params.getAll("marketReturnChain").includes("solana")
        ? collectionChains.filter((chain) =>
            params.getAll("marketReturnChain").includes(chain)
          )
        : undefined
  };
}

export function serializeCollectionFilters(filters: CollectionFilters) {
  const params = evm.serializeCollectionFilters(
    toEvmCollectionFilters(filters)
  );
  params.delete("chain");
  // Canonical order keeps equivalent multi-chain selections in one query cache.
  for (const chain of collectionChains) {
    if (filters.chains.includes(chain)) params.append("chain", chain);
  }
  for (const chain of collectionChains) {
    if ((filters.excludedChains ?? []).includes(chain))
      params.append("excludeChain", chain);
  }
  for (const chain of filters.marketReturnChains ?? [])
    params.append("marketReturnChain", chain);
  return params;
}

export function collectionFiltersKey(filters: CollectionFilters) {
  return serializeCollectionFilters(filters).toString();
}

export function cloneCollectionFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...evm.cloneCollectionFilters(toEvmCollectionFilters(filters)),
    chains: [...filters.chains],
    excludedChains: [...(filters.excludedChains ?? [])],
    marketReturnChains: filters.marketReturnChains
      ? [...filters.marketReturnChains]
      : undefined
  };
}

export function clearCollectionFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...evm.clearCollectionFilters(toEvmCollectionFilters(filters)),
    excludedChains: []
  };
}

export function clearMarketFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...evm.clearMarketFilters(toEvmCollectionFilters(filters)),
    chains: filters.chains,
    excludedChains: filters.excludedChains,
    marketReturnChains: filters.marketReturnChains
  };
}

export function updateCollectionChains(
  current: CollectionFilters,
  next: CollectionFilters
): CollectionFilters {
  const currentChains = effectiveCollectionChains(current).join(",");
  const nextChains = effectiveCollectionChains(next).join(",");
  // Applying the reviewed scope must retain its price/currency selections.
  if (
    includesSolana(current) &&
    !includesSolana(next) &&
    next.marketReturnChains?.join(",") === currentChains &&
    hasMarketFilters(next)
  )
    return next;
  if (currentChains === nextChains)
    return current.marketReturnChains && !hasMarketFilters(next)
      ? {
          ...next,
          chains: current.marketReturnChains,
          excludedChains: [],
          marketReturnChains: undefined
        }
      : next;
  const updated = {
    ...next,
    marketReturnChains: undefined,
    currency: "all" as const,
    priceMin: "",
    priceMax: "",
    sort: isPriceSort(next.sort) ? ("rarity-capped-desc" as const) : next.sort
  };
  return includesSolana(updated) ? clearMarketFilters(updated) : updated;
}

export function applySupportedMarketFilters(
  current: CollectionFilters,
  next: evm.CollectionFilters
): CollectionFilters {
  return {
    ...next,
    excludedChains: [],
    marketReturnChains: effectiveCollectionChains(current)
  };
}

export function hasMarketFilters(filters: CollectionFilters) {
  return evm.hasMarketFilters(toEvmCollectionFilters(filters));
}

export function priceCurrencyForFilters(filters: CollectionFilters) {
  return evm.priceCurrencyForFilters(toEvmCollectionFilters(filters));
}

export function countCollectionFilters(filters: CollectionFilters) {
  return (
    evm.countCollectionFilters({
      ...toEvmCollectionFilters(filters),
      chains: []
    }) + (filters.chains.length || filters.excludedChains?.length ? 1 : 0)
  );
}

/** Old Exomon links used rarityMin/Max for capped rarity. Preserve that meaning. */
export function exomonCollectionRedirect(search: string) {
  const params = new URLSearchParams(search);
  params.delete("chain");
  params.delete("excludeChain");
  params.delete("collection");
  params.append("chain", "solana");
  for (const bound of ["Min", "Max"]) {
    const value = params.get(`rarity${bound}`);
    if (value !== null) {
      params.set(`rarityCapped${bound}`, value);
      params.delete(`rarity${bound}`);
    }
  }
  return `/?${params}`;
}
