export const indexedChains = ["ethereum", "base", "polygon", "bnb"] as const;
export type IndexedChain = (typeof indexedChains)[number];
export function isIndexedChain(value: string | null): value is IndexedChain {
  return indexedChains.some((chain) => chain === value);
}
export const tokenSorts = [
  "token-id-asc",
  "token-id-desc",
  "rarity-capped-desc",
  "rarity-capped-asc",
  "rarity-desc",
  "rarity-asc"
] as const;
export type TokenSort = (typeof tokenSorts)[number];
export type TokenMetadataFilter = "all" | "available" | "missing";

/** Metadata-query subset used when translating the shared collection filters. */
export type TokenQuery = {
  chains?: readonly IndexedChain[];
  traits?: { traitType: string; traitValue: string }[];
  rarityMin?: string;
  rarityMax?: string;
  rarityCappedMin?: string;
  rarityCappedMax?: string;
  metadata?: TokenMetadataFilter;
  sort?: TokenSort;
};
