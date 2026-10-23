export type CollectionEdition = "og" | "tcg";

export const collectionFilterStorageKey = "yunipals.collection.filters.v1";

/** Explicit links win; only a bare collection URL restores saved filters. */
export function resolveCollectionQuery(
  params: URLSearchParams,
  saved: string | null
) {
  const query = new URLSearchParams(params.size > 0 ? params : (saved ?? ""));
  query.set("edition", query.get("edition") === "tcg" ? "tcg" : "og");
  return query;
}

export function readSavedCollectionFilters() {
  try {
    const saved = localStorage.getItem(collectionFilterStorageKey);
    return saved && saved.length <= 4096 ? saved : null;
  } catch {
    return null;
  }
}

export function saveCollectionFilters(query: string) {
  try {
    localStorage.setItem(collectionFilterStorageKey, query);
  } catch {
    // Browsing and shared links still work when browser storage is unavailable.
  }
}
