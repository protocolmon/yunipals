import {
  clearCollectionFilters,
  parseCollectionFilters,
  type CollectionFilters
} from "@/lib/collectionBrowserFilters";
import { tcgCollectionFacets } from "@/lib/boosterCollectionGrid";

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
  return {
    ...clearCollectionFilters(parsed),
    chains: ["base"],
    sort: "token-id-asc",
    traits: parsed.traits
  };
}
