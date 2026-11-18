import {
  clearCollectionFilters,
  parseCollectionFilters,
  type CollectionFilters
} from "@/lib/collectionBrowserFilters";
import { tcgCollectionFacets } from "@/lib/boosterCollectionGrid";

export function sequenceNumber(value: string | null | undefined) {
  return value && /^\d{1,10}$/.test(value) && Number(value) <= 4294967295
    ? String(Number(value))
    : "";
}

export function parseTcgCollectionFilters(
  query: URLSearchParams
): CollectionFilters {
  // OG sort and market parameters never constrain TCG cards.
  const compatible = new URLSearchParams();
  for (const facet of tcgCollectionFacets.items) {
    if (facet.kind !== "categorical") continue;
    for (const value of query.getAll(`t.${facet.traitType}`)) {
      if (facet.values.some((choice) => choice.value === value))
        compatible.append(`t.${facet.traitType}`, value);
    }
  }
  const parsed = parseCollectionFilters(compatible);
  const originalOnly = query.get("originalOnly") === "true";
  const sequenceMin = sequenceNumber(query.get("sequenceMin"));
  const sequenceMax = sequenceNumber(query.get("sequenceMax"));
  const reversed =
    sequenceMin !== "" &&
    sequenceMax !== "" &&
    Number(sequenceMin) > Number(sequenceMax);
  return {
    ...clearCollectionFilters(parsed),
    chains: ["base"],
    sort: "token-id-asc",
    traits: parsed.traits,
    originalOnly,
    sequenceMin: originalOnly ? "" : reversed ? sequenceMax : sequenceMin,
    sequenceMax: originalOnly ? "" : reversed ? sequenceMin : sequenceMax
  };
}
