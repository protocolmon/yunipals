import { collectionSlugs, type CollectionSlug } from "../constants.js";

export type ChainSelection = { chains: CollectionSlug[]; chain: CollectionSlug | null; scope: string };

export function chainSelection(url: string): ChainSelection | undefined {
  const values = new URL(url).searchParams.getAll("chain");
  if (values.some((value) => !collectionSlugs.includes(value as CollectionSlug))) return undefined;
  const chains = values.length ? collectionSlugs.filter((slug) => values.includes(slug)) : [...collectionSlugs];
  return { chains, chain: chains.length === 1 ? chains[0]! : null,
    scope: chains.length === collectionSlugs.length ? "all" : chains.join("+") };
}

export const chainSelectionJson = ({ chain, chains }: ChainSelection) => ({ chain, chains });
