import {
  readEditionPreferences,
  resolveCollectionQuery,
  saveEditionPreferences,
  type CollectionEdition
} from "@/lib/collectionEdition";

const storageKey = "yunipals.collector.filters.v2";
export const resolveCollectorQuery = resolveCollectionQuery;
export function readSavedCollectorFilters(edition?: CollectionEdition) {
  return readEditionPreferences(
    storageKey,
    ["yunipals.collector.filters.v1"],
    edition
  );
}
export function saveCollectorFilters(query: string) {
  saveEditionPreferences(storageKey, query);
}
export function personalCollectionHref(
  owner: string,
  edition?: CollectionEdition
) {
  const query =
    readSavedCollectorFilters(edition) ?? `edition=${edition ?? "og"}`;
  return `/collector/${encodeURIComponent(owner)}?${query}`;
}
