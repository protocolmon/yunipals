import {
  collectionSlugs as indexedChains,
  type CollectionSlug as IndexedChain,
} from "../constants.js";
const isIndexedChain = (value: string) =>
  indexedChains.some((chain) => chain === value);

export const collectorPageSize = 24;
export const collectorSorts = [
  "rarity-capped-desc",
  "rarity-capped-asc",
] as const;
export type CollectorSort = (typeof collectorSorts)[number];
export type CollectorFilters = {
  chains: IndexedChain[];
  types: string[];
  colors: string[];
  rarityMin: string;
  rarityMax: string;
  search: string;
  sort: CollectorSort;
};

export const defaultCollectorFilters: CollectorFilters = {
  chains: [],
  types: [],
  colors: [],
  rarityMin: "",
  rarityMax: "",
  search: "",
  sort: "rarity-capped-desc",
};

function normalizeRarityBound(value: string) {
  const bound = value.trim();
  if (!bound) return "";
  if (!/^\d{1,80}(?:\.\d{1,30})?$/.test(bound)) {
    throw new Error(
      "Rarity scores must be non-negative numbers with up to 30 decimal places.",
    );
  }
  const [rawInteger, rawFraction = ""] = bound.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function compareDecimalStrings(left: string, right: string) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  if (leftInteger.length !== rightInteger.length)
    return leftInteger.length - rightInteger.length;
  const integerOrder = leftInteger.localeCompare(rightInteger);
  if (integerOrder) return integerOrder;
  const width = Math.max(leftFraction.length, rightFraction.length);
  return leftFraction
    .padEnd(width, "0")
    .localeCompare(rightFraction.padEnd(width, "0"));
}

export function normalizeCollectorRarityRange(
  minimum: string,
  maximum: string,
) {
  const rarityMin = normalizeRarityBound(minimum);
  const rarityMax = normalizeRarityBound(maximum);
  if (
    rarityMin &&
    rarityMax &&
    compareDecimalStrings(rarityMin, rarityMax) > 0
  )
    throw new Error("Minimum rarity cannot be greater than maximum rarity.");
  return { rarityMin, rarityMax };
}

function traitValues(params: URLSearchParams, name: string) {
  const values = [...new Set(params.getAll(name).map((value) => value.trim()))];
  if (
    values.length > 20 ||
    values.some((value) => !value || value.length > 80)
  ) {
    throw new Error("Choose up to 20 values for each trait.");
  }
  return values.sort();
}

export function normalizeCollectorSearch(value: string) {
  const search = value.trim();
  if (search.length > 80)
    throw new Error("Search must be 80 characters or fewer.");
  if (/^#?\d+$/.test(search)) {
    const tokenId = BigInt(search.replace(/^#/, ""));
    if (tokenId >= 2n ** 256n) throw new Error("Enter a valid token ID.");
    return tokenId.toString();
  }
  if (search.startsWith("#"))
    throw new Error("Enter a numeric token ID after #.");
  if (search.length === 1)
    throw new Error("Enter at least two letters for a name.");
  return search.toLowerCase();
}

export function parseCollectorFilters(
  params: URLSearchParams,
): CollectorFilters {
  const selected = [...new Set(params.getAll("chain"))];
  if (selected.some((chain) => !isIndexedChain(chain))) {
    throw new Error("Choose a supported chain.");
  }
  const chains = indexedChains.filter((chain) => selected.includes(chain));
  const sorts = params.getAll("sort");
  const searches = params.getAll("q");
  const rarityMins = params.getAll("rarityMin");
  const rarityMaxes = params.getAll("rarityMax");
  const sort = sorts[0] ?? defaultCollectorFilters.sort;
  if (sorts.length > 1 || !collectorSorts.some((option) => option === sort)) {
    throw new Error("Choose a supported rarity sort.");
  }
  if (searches.length > 1) throw new Error("Enter one search term.");
  if (rarityMins.length > 1 || rarityMaxes.length > 1)
    throw new Error("Enter one minimum and maximum rarity score.");
  const rarityRange = normalizeCollectorRarityRange(
    rarityMins[0] ?? "",
    rarityMaxes[0] ?? "",
  );
  return {
    chains: chains.length === indexedChains.length ? [] : chains,
    types: traitValues(params, "t.Type"),
    colors: traitValues(params, "t.Color"),
    ...rarityRange,
    search: normalizeCollectorSearch(searches[0] ?? ""),
    sort: sort as CollectorSort,
  };
}

export function serializeCollectorFilters(filters: CollectorFilters) {
  const params = new URLSearchParams();
  filters.chains.forEach((chain) => params.append("chain", chain));
  filters.types.forEach((value) => params.append("t.Type", value));
  filters.colors.forEach((value) => params.append("t.Color", value));
  if (filters.rarityMin) params.set("rarityMin", filters.rarityMin);
  if (filters.rarityMax) params.set("rarityMax", filters.rarityMax);
  if (filters.search) params.set("q", filters.search);
  params.set("sort", filters.sort);
  return params;
}

export function collectorFiltersKey(filters: CollectorFilters) {
  return serializeCollectorFilters(
    parseCollectorFilters(serializeCollectorFilters(filters)),
  ).toString();
}

export function hasCollectorFilters(filters: CollectorFilters) {
  return Boolean(
    filters.chains.length ||
      filters.types.length ||
      filters.colors.length ||
      filters.rarityMin ||
      filters.rarityMax ||
      filters.search,
  );
}
