export type CollectionEdition = "og" | "tcg";

export const collectionFilterStorageKey = "yunipals.collection.filters.v2";

/** Explicit links win; only a bare collection URL restores saved filters. */
export function resolveCollectionQuery(
  params: URLSearchParams,
  saved: string | null
) {
  const query = new URLSearchParams(params.size > 0 ? params : (saved ?? ""));
  if (params.size === 0 && !saved) query.set("excludeChain", "base");
  query.set("edition", query.get("edition") === "tcg" ? "tcg" : "og");
  return query;
}

export function readSavedCollectionFilters(edition?: CollectionEdition) {
  try {
    const matchesEdition = (query: string) =>
      !edition ||
      resolveCollectionQuery(new URLSearchParams(query), null).get(
        "edition"
      ) === edition;
    if (edition) {
      const savedEdition = localStorage.getItem(
        `${collectionFilterStorageKey}.${edition}`
      );
      if (
        savedEdition &&
        savedEdition.length <= 4096 &&
        matchesEdition(savedEdition)
      )
        return savedEdition;
    }
    const saved = localStorage.getItem(collectionFilterStorageKey);
    if (saved && saved.length <= 4096 && matchesEdition(saved)) return saved;
    const previous = localStorage.getItem("yunipals.collection.filters.v1");
    if (!previous || previous.length > 4096 || !matchesEdition(previous))
      return null;
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
    const edition = resolveCollectionQuery(
      new URLSearchParams(query),
      null
    ).get("edition");
    localStorage.setItem(`${collectionFilterStorageKey}.${edition}`, query);
    localStorage.setItem(collectionFilterStorageKey, query);
  } catch {
    // Browsing and shared links still work when browser storage is unavailable.
  }
}
