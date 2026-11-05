import {
  defaultCollectorFilters,
  parseCollectorFilters,
  serializeCollectorFilters,
  type CollectorFilters
} from "@protopals/yunipals-market-core/collectorFilters";
import { indexedChains } from "@protopals/yunipals-market-core/collectionTypes";

const storageKey = "yunipals.collector.filters.v1";
export const collectorNotBaseChains = indexedChains.filter(
  (chain) => chain !== "base"
);

export function isCollectorNotBase(filters: CollectorFilters) {
  return (
    filters.chains.length === collectorNotBaseChains.length &&
    collectorNotBaseChains.every((chain) => filters.chains.includes(chain))
  );
}

/** Shared links win; a bare profile restores the saved choice or defaults to Not Base. */
export function resolveCollectorQuery(
  params: URLSearchParams,
  saved: string | null
) {
  if (params.size > 0) return new URLSearchParams(params);
  if (saved) return new URLSearchParams(saved);
  return serializeCollectorFilters({
    ...defaultCollectorFilters,
    chains: collectorNotBaseChains
  });
}

export function readSavedCollectorFilters() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved || saved.length > 4096) return null;
    return serializeCollectorFilters(
      parseCollectorFilters(new URLSearchParams(saved))
    ).toString();
  } catch {
    return null;
  }
}

export function saveCollectorFilters(query: string) {
  try {
    localStorage.setItem(storageKey, query);
  } catch {
    // The URL remains usable when browser storage is unavailable.
  }
}
