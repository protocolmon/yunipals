import {
  indexedChains,
  isIndexedChain,
  tokenSorts,
  type IndexedChain,
  type TokenMetadataFilter,
  type TokenQuery,
  type TokenSort
} from "./collectionTypes";
import {
  defaultCatalogCurrency,
  type CatalogCurrencySelection
} from "./catalogCurrency";

export type CollectionSort = TokenSort | "price-asc" | "price-desc";
export type CollectionFilters = {
  chains: IndexedChain[];
  traits: Record<string, string[]>;
  rarityMode: "capped" | "raw";
  rarityMin: string;
  rarityMax: string;
  metadata: TokenMetadataFilter;
  sort: CollectionSort;
  sale: "all" | "listed" | "unlisted";
  currency: CatalogCurrencySelection;
  priceMin: string;
  priceMax: string;
};

export const DEFAULT_COLLECTION_FILTERS: CollectionFilters = {
  chains: [],
  traits: {},
  rarityMode: "capped",
  rarityMin: "",
  rarityMax: "",
  metadata: "all",
  sort: "rarity-capped-desc",
  sale: "all",
  currency: "all",
  priceMin: "",
  priceMax: ""
};

const METADATA_FILTERS: TokenMetadataFilter[] = ["all", "available", "missing"];

function isTokenSort(value: string | null): value is TokenSort {
  return tokenSorts.some((sort) => sort === value);
}

export function isPriceSort(
  value: string | null
): value is "price-asc" | "price-desc" {
  return value === "price-asc" || value === "price-desc";
}

export function hasMarketFilters(filters: CollectionFilters) {
  return (
    filters.sale !== "all" ||
    filters.currency !== "all" ||
    Boolean(filters.priceMin || filters.priceMax) ||
    isPriceSort(filters.sort)
  );
}

export function priceCurrencyForFilters(filters: CollectionFilters) {
  return filters.currency === "all"
    ? defaultCatalogCurrency(
        filters.chains.length === 1 ? filters.chains[0] : undefined
      )
    : filters.currency;
}

/** Switching payment tokens clears both applied and locally edited price bounds. */
export function updateCollectionCurrency(
  filters: CollectionFilters,
  currency: CatalogCurrencySelection
): CollectionFilters {
  if (filters.currency === currency) return filters;
  return {
    ...filters,
    currency,
    priceMin: "",
    priceMax: "",
    sale: currency === "all" ? filters.sale : "listed",
    sort:
      currency === "all" && isPriceSort(filters.sort)
        ? "rarity-capped-desc"
        : filters.sort
  };
}

export function clearMarketFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...filters,
    sale: "all",
    currency: "all",
    priceMin: "",
    priceMax: "",
    sort: isPriceSort(filters.sort) ? "rarity-capped-desc" : filters.sort
  };
}

/** A numeric amount must never silently keep its meaning after changing chains. */
export function updateCollectionChains(
  current: CollectionFilters,
  next: CollectionFilters
): CollectionFilters {
  if (current.chains.join(",") === next.chains.join(",")) return next;
  return {
    ...next,
    currency: "all",
    priceMin: "",
    priceMax: "",
    sort: isPriceSort(next.sort) ? "rarity-capped-desc" : next.sort
  };
}

function isMetadataFilter(value: string | null): value is TokenMetadataFilter {
  return METADATA_FILTERS.some((filter) => filter === value);
}

function numericValue(value: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  return trimmed !== "" && Number.isFinite(Number(trimmed)) ? trimmed : "";
}

export function parseCollectionFilters(
  searchParams: URLSearchParams
): CollectionFilters {
  const traits: Record<string, string[]> = Object.create(null);

  searchParams.forEach((value, key) => {
    if (!key.startsWith("t.")) return;
    const traitType = key.slice(2).trim();
    const traitValue = value.trim();
    if (!traitType || !traitValue) return;
    traits[traitType] ??= [];
    if (!traits[traitType].includes(traitValue)) {
      traits[traitType].push(traitValue);
    }
  });

  Object.values(traits).forEach((values) => values.sort());

  const metadataValue = searchParams.get("metadata");
  const currencies = [...new Set(searchParams.getAll("currency"))];
  const currency = !currencies.length
    ? "all"
    : currencies.length === 1 &&
        ["all", "native", "weth"].includes(currencies[0]!)
      ? (currencies[0] as CatalogCurrencySelection)
      : "unsupported";
  const sortValue = searchParams.get("sort");
  const requestedChains = new Set(
    searchParams.getAll("chain").filter(isIndexedChain)
  );
  const selectedChains = indexedChains.filter((chain) =>
    requestedChains.has(chain)
  );
  const chains =
    selectedChains.length === indexedChains.length ? [] : selectedChains;
  const rawRarityMin = numericValue(searchParams.get("rarityMin"));
  const rawRarityMax = numericValue(searchParams.get("rarityMax"));
  const cappedRarityMin = numericValue(searchParams.get("rarityCappedMin"));
  const cappedRarityMax = numericValue(searchParams.get("rarityCappedMax"));
  const requestedRarityMode = searchParams.get("rarityMode");
  const rarityMode =
    cappedRarityMin || cappedRarityMax
      ? "capped"
      : rawRarityMin || rawRarityMax || requestedRarityMode === "raw"
        ? "raw"
        : "capped";
  let rarityMin = rarityMode === "capped" ? cappedRarityMin : rawRarityMin;
  let rarityMax = rarityMode === "capped" ? cappedRarityMax : rawRarityMax;
  if (rarityMin && rarityMax && Number(rarityMin) > Number(rarityMax)) {
    [rarityMin, rarityMax] = [rarityMax, rarityMin];
  }

  return {
    chains,
    traits,
    rarityMode,
    rarityMin,
    rarityMax,
    metadata: isMetadataFilter(metadataValue) ? metadataValue : "all",
    sort:
      isTokenSort(sortValue) || isPriceSort(sortValue)
        ? sortValue
        : rawRarityMin || rawRarityMax
          ? "rarity-desc"
          : "rarity-capped-desc",
    sale:
      searchParams.get("sale") === "listed"
        ? "listed"
        : searchParams.get("sale") === "unlisted"
          ? "unlisted"
          : "all",
    // Unsupported or conflicting currencies block price requests instead of
    // silently broadening a financial URL into the unfiltered collection.
    currency,
    // Preserve invalid bounds so the UI can report them; never silently drop a
    // mistyped financial filter and show a broader set of purchases.
    priceMin: searchParams.get("priceMin")?.trim() ?? "",
    priceMax: searchParams.get("priceMax")?.trim() ?? ""
  };
}

export function serializeCollectionFilters(filters: CollectionFilters) {
  const params = new URLSearchParams();

  filters.chains.forEach((chain) => params.append("chain", chain));

  Object.entries(filters.traits)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([traitType, values]) => {
      [...values]
        .sort()
        .forEach((value) => params.append(`t.${traitType}`, value));
    });

  if (filters.rarityMode === "raw") {
    params.set("rarityMode", "raw");
    if (filters.rarityMin) params.set("rarityMin", filters.rarityMin);
    if (filters.rarityMax) params.set("rarityMax", filters.rarityMax);
  } else {
    if (filters.rarityMin) params.set("rarityCappedMin", filters.rarityMin);
    if (filters.rarityMax) params.set("rarityCappedMax", filters.rarityMax);
  }
  if (filters.metadata !== "all") params.set("metadata", filters.metadata);
  if (filters.sort !== "rarity-capped-desc") params.set("sort", filters.sort);
  if (filters.sale !== "all") params.set("sale", filters.sale);
  if (filters.currency !== "all") params.set("currency", filters.currency);
  if (filters.priceMin) params.set("priceMin", filters.priceMin);
  if (filters.priceMax) params.set("priceMax", filters.priceMax);

  return params;
}

export function collectionFiltersKey(filters: CollectionFilters) {
  return serializeCollectionFilters(filters).toString();
}

export function collectionFiltersToTokenQuery(
  filters: CollectionFilters
): Pick<
  TokenQuery,
  | "chains"
  | "traits"
  | "rarityMin"
  | "rarityMax"
  | "rarityCappedMin"
  | "rarityCappedMax"
  | "metadata"
  | "sort"
> {
  if (hasMarketFilters(filters) || isPriceSort(filters.sort))
    throw new Error("Sale and price filters require the marketplace catalog.");
  const traits = Object.entries(filters.traits)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([traitType, values]) =>
      [...values].sort().map((traitValue) => ({ traitType, traitValue }))
    );

  return {
    chains: filters.chains.length > 0 ? filters.chains : undefined,
    traits,
    rarityMin:
      filters.rarityMode === "raw" ? filters.rarityMin || undefined : undefined,
    rarityMax:
      filters.rarityMode === "raw" ? filters.rarityMax || undefined : undefined,
    rarityCappedMin:
      filters.rarityMode === "capped"
        ? filters.rarityMin || undefined
        : undefined,
    rarityCappedMax:
      filters.rarityMode === "capped"
        ? filters.rarityMax || undefined
        : undefined,
    metadata: filters.metadata,
    sort: filters.sort
  };
}

export function countCollectionFilters(filters: CollectionFilters) {
  const traitCount = Object.values(filters.traits).reduce(
    (total, values) => total + values.length,
    0
  );
  return (
    traitCount +
    (filters.chains.length === 0 ? 0 : 1) +
    (filters.rarityMin || filters.rarityMax ? 1 : 0) +
    (filters.metadata === "all" ? 0 : 1) +
    (hasMarketFilters(filters) ? 1 : 0)
  );
}

export function cloneCollectionFilters(
  filters: CollectionFilters
): CollectionFilters {
  return {
    ...filters,
    chains: [...filters.chains],
    traits: Object.fromEntries(
      Object.entries(filters.traits).map(([traitType, values]) => [
        traitType,
        [...values]
      ])
    )
  };
}

export function clearCollectionFilters(filters: CollectionFilters) {
  return {
    ...DEFAULT_COLLECTION_FILTERS,
    sort: isPriceSort(filters.sort)
      ? ("rarity-capped-desc" as const)
      : filters.sort
  };
}
