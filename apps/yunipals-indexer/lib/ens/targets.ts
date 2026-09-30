import { getAddress, type Address } from "viem";
import { collectionSlugs, collections, type CollectionSlug } from "../constants.js";

export type EnsCandidate = { owner: string; scopes: string[] };
export type EnsTarget = { address: Address; chain: CollectionSlug };

export function ensTargets(candidates: EnsCandidate[]) {
  const targets = new Map<string, EnsTarget>();
  for (const candidate of candidates) {
    const address = getAddress(candidate.owner);
    for (const chain of collectionSlugs) {
      if (candidate.scopes.some((scope) => scope === "all" || scope === chain)) {
        targets.set(`${collections[chain].chainId}:${address.toLowerCase()}`, { address, chain });
      }
    }
  }
  return [...targets.values()];
}
