import {
  readEditionPreferences,
  collectionViewQuery,
  scopeEditionQuery,
  saveEditionPreferences,
  type CollectionEdition
} from "@/lib/collectionEdition";

const storageKey = "yunipals.collector.filters.v2";
/** Wallet holdings use the EVM networks of the edition, even when Exomon is enabled. */
export function resolveCollectorQuery(
  params: URLSearchParams,
  saved: string | null
) {
  return scopeEditionQuery(
    new URLSearchParams(params.size ? params : (saved ?? "")),
    "collector"
  );
}
export function collectorViewQuery(params: URLSearchParams) {
  return collectionViewQuery(params, "collector");
}
export function readSavedCollectorFilters(edition?: CollectionEdition) {
  return readEditionPreferences(
    storageKey,
    ["yunipals.collector.filters.v1"],
    edition,
    "collector"
  );
}
export function saveCollectorFilters(query: string) {
  saveEditionPreferences(storageKey, query, "collector");
}
export function personalCollectionHref(
  owner: string,
  edition?: CollectionEdition
) {
  const query =
    readSavedCollectorFilters(edition) ?? `edition=${edition ?? "og"}`;
  return `/collector/${encodeURIComponent(owner)}?${query}`;
}
