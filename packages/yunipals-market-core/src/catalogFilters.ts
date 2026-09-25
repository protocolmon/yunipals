import { maxUint256, parseUnits } from "viem";
import {
  collectionFiltersKey,
  isPriceSort,
  parseCollectionFilters,
  serializeCollectionFilters,
  type CollectionFilters
} from "./collectionFilters";
import { catalogCurrency } from "./catalogCurrency";

export function parseCatalogPrice(value: string) {
  if (!value) return undefined;
  if (value.length > 80 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(value))
    throw new Error("Enter a price with up to 18 decimal places, such as 0.1.");
  const amount = parseUnits(value, 18);
  if (amount > maxUint256)
    throw new Error("This price is outside the supported range.");
  return amount;
}

export function validateCatalogFilters(filters: CollectionFilters) {
  for (const value of [filters.rarityMin, filters.rarityMax]) {
    if (
      value &&
      (value.length > 80 ||
        !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(
          value
        ) ||
        !Number.isFinite(Number(value)))
    )
      throw new Error("Choose a numeric rarity bound.");
  }
  if (filters.currency === "unsupported")
    throw new Error("Choose a supported listing currency for this chain.");
  const key = collectionFiltersKey(filters);
  if (
    key.length > 4096 ||
    Object.keys(filters.traits).length > 32 ||
    Object.values(filters.traits).flat().length > 64
  )
    throw new Error("Choose fewer trait filters before continuing.");
  for (const [name, values] of Object.entries(filters.traits))
    if (
      !name ||
      name.length > 128 ||
      values.some((value) => !value || value.length > 128)
    )
      throw new Error("A trait filter is outside the supported range.");
  if (
    key !==
    collectionFiltersKey(
      parseCollectionFilters(serializeCollectionFilters(filters))
    )
  )
    throw new Error("The collection filters are not supported.");
  const prices =
    filters.currency !== "all" ||
    filters.priceMin ||
    filters.priceMax ||
    isPriceSort(filters.sort);
  if (prices && filters.chains.length !== 1)
    throw new Error("Choose exactly one chain to compare prices.");
  if (prices && (filters.currency === "all" || filters.sale !== "listed"))
    throw new Error(
      "Choose for-sale NFTs and one listing currency before filtering prices."
    );
  const currency = prices
    ? catalogCurrency(filters.chains[0]!, filters.currency)
    : undefined;
  const min = parseCatalogPrice(filters.priceMin);
  const max = parseCatalogPrice(filters.priceMax);
  if (min !== undefined && max !== undefined && min > max)
    throw new Error("Minimum price must not exceed maximum price.");
  return { key, min, max, currency };
}
