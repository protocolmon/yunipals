export type CollectionEdition = "og" | "tcg";

export const collectionFilterStorageKey = "yunipals.collection.filters.v2";

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
    if (saved && saved.length <= 4096) return saved;
    const previous = localStorage.getItem("yunipals.collection.filters.v1");
    if (!previous || previous.length > 4096) return null;
    const query = new URLSearchParams(previous);
    // The first toggle version accidentally carried TCG's ID sort into OG.
    if (query.get("edition") !== "tcg" && query.get("sort") === "token-id-asc")
      query.delete("sort");
    return query.toString();
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
