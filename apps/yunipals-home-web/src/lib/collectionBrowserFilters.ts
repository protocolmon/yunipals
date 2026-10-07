import * as evm from "@/lib/collectionFilters";
import { environment } from "@/environment";
import { indexedChains, isIndexedChain } from "@/lib/yunipalsIndexer";

export type CollectionChain = (typeof indexedChains)[number] | "solana";
export type CollectionSort = evm.CollectionSort;
export type CollectionFilters = Omit<evm.CollectionFilters, "chains"> & {
  chains: CollectionChain[];
};
export const collectionChains: readonly CollectionChain[] = [
  ...indexedChains,
  ...(environment.exomonEnabled ? ["solana" as const] : [])
];
export const isPriceSort = evm.isPriceSort;

/** Marketplace and wallet clients retain their EVM-only types. */
export function toEvmCollectionFilters(
  filters: CollectionFilters
): evm.CollectionFilters {
  return { ...filters, chains: filters.chains.filter(isIndexedChain) };
}

export function includesSolana(filters: CollectionFilters) {
  return (
    environment.exomonEnabled &&
    (!filters.chains.length || filters.chains.includes("solana"))
  );
}

export function parseCollectionFilters(
  params: URLSearchParams
): CollectionFilters {
  const selected = collectionChains.filter((chain) =>
    params.getAll("chain").includes(chain)
  );
  return {
    ...evm.parseCollectionFilters(params),
    chains: selected.length === collectionChains.length ? [] : selected
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
    chains: [...filters.chains]
  };
}

export function clearCollectionFilters(
  filters: CollectionFilters
): CollectionFilters {
  return evm.clearCollectionFilters(toEvmCollectionFilters(filters));
}

export function clearMarketFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...evm.clearMarketFilters(toEvmCollectionFilters(filters)),
    chains: filters.chains
  };
}

export function updateCollectionChains(
  current: CollectionFilters,
  next: CollectionFilters
): CollectionFilters {
  if (current.chains.join(",") === next.chains.join(",")) return next;
  const updated = {
    ...next,
    currency: "all" as const,
    priceMin: "",
    priceMax: "",
    sort: isPriceSort(next.sort) ? ("rarity-capped-desc" as const) : next.sort
  };
  return includesSolana(updated) ? clearMarketFilters(updated) : updated;
}

export function hasMarketFilters(filters: CollectionFilters) {
  return evm.hasMarketFilters(toEvmCollectionFilters(filters));
}

export function priceCurrencyForFilters(filters: CollectionFilters) {
  return evm.priceCurrencyForFilters(toEvmCollectionFilters(filters));
}

export function countCollectionFilters(filters: CollectionFilters) {
  return (
    evm.countCollectionFilters(toEvmCollectionFilters(filters)) +
    (filters.chains.length > 0 &&
    filters.chains.every((chain) => chain === "solana")
      ? 1
      : 0)
  );
}

/** Old Exomon links used rarityMin/Max for capped rarity. Preserve that meaning. */
export function exomonCollectionRedirect(search: string) {
  const params = new URLSearchParams(search);
  params.delete("chain");
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
