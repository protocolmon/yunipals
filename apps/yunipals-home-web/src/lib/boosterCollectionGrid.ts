import { isAddress } from "viem";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";

import { environment } from "@/environment";
import type { BoosterPage } from "@/lib/boosters";
import type {
  CollectionToken,
  CollectionFacets
} from "@/lib/collectionBrowser";
import type { CollectionFilters } from "@/lib/collectionBrowserFilters";
import type { CollectorFilters } from "@/lib/collector";

const types = [
  "Yuniair",
  "Yunidonkey",
  "Yunibranch",
  "Yunidragon",
  "Yunicursed",
  "Yunikles",
  "Yuniturtle",
  "Yuniaqua",
  "Yunichick",
  "Yunisheep",
  "Yunifairy"
];
const colors = ["Yellow", "Green", "Blue", "Red", "Purple", "Black"];
const horns = ["Spiral", "Diamond"];
const tcgTraitChoices: [string, string[]][] = [
  ["Type", types],
  ["Color", colors],
  ["Horn", horns],
  ["Glitter", ["No", "Yes"]]
];
// Catalog choices, not counts of minted NFTs. TCG filters omit count badges.
export const tcgCollectionFacets: CollectionFacets = {
  items: tcgTraitChoices.map(([traitType, values]) => ({
    kind: "categorical" as const,
    traitType,
    values: values.map((value) => ({ value, count: 0 }))
  })),
  metadata: { available: 0, missing: 0 },
  updatedAt: ""
};
export type CollectionGridItem<T extends CollectionToken = CollectionToken> =
  | { kind: "original"; token: T }
  | { kind: "pack"; monster: BoosterMonster };
export type PackGridFilters = {
  chains: readonly string[];
  traits: Record<string, string[]>;
  search?: string;
};
export function packGridTraits(monster: BoosterMonster) {
  return {
    Type: types[Number(monster.monsterType) - 1] ?? monster.monsterType,
    Color: colors[Number(monster.color) - 1] ?? monster.color,
    Horn: horns[Number(monster.horn) - 1] ?? monster.horn,
    Glitter:
      monster.glitter === "1"
        ? "Yes"
        : monster.glitter === "0"
          ? "No"
          : monster.glitter
  };
}
export function packGridFilters(
  filters: CollectionFilters | CollectorFilters
): PackGridFilters {
  return {
    chains: filters.chains,
    traits:
      "traits" in filters
        ? filters.traits
        : { Type: filters.types, Color: filters.colors },
    search: "search" in filters ? filters.search : ""
  };
}
export function matchesPackGridFilters(
  monster: BoosterMonster,
  filters: PackGridFilters
) {
  if (
    monster.burned ||
    (filters.chains.length && !filters.chains.includes("base"))
  )
    return false;
  const traits = packGridTraits(monster);
  for (const [key, choices] of Object.entries(filters.traits)) {
    const supported = Object.keys(traits).find(
      (name) => name.toLowerCase() === key.toLowerCase()
    ) as keyof typeof traits | undefined;
    if (!supported || !choices.length) continue;
    if (
      !choices.some((choice) => {
        const value = choice.toLowerCase();
        const normalized =
          supported === "Glitter" && value === "none" ? "no" : value;
        return normalized === traits[supported].toLowerCase();
      })
    )
      return false;
  }
  const search = filters.search?.trim().toLowerCase();
  if (!search) return true;
  if (/^#?\d+$/.test(search))
    return BigInt(search.replace(/^#/, "")) === BigInt(monster.tokenId);
  return `${traits.Type} #${monster.tokenId}`.toLowerCase().includes(search);
}
export function collectionGridIdentity(item: CollectionGridItem) {
  if (item.kind === "pack")
    return `base:${item.monster.collection.toLowerCase()}:${item.monster.tokenId}`;
  const token = item.token;
  return token.chain === "solana"
    ? `solana:${token.tokenId}`
    : `${token.chain}:${token.contractAddress.toLowerCase()}:${token.tokenId}`;
}
/** Keep each source's ordering, interleaving visible pack cards with the normal catalog. */
export function mergeCollectionGrid<T extends CollectionToken>(
  originals: T[],
  monsters: BoosterMonster[]
): CollectionGridItem<T>[] {
  const merged: CollectionGridItem<T>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.max(originals.length, monsters.length); i++) {
    const rows: CollectionGridItem<T>[] = [];
    if (originals[i]) rows.push({ kind: "original", token: originals[i] });
    if (monsters[i]) rows.push({ kind: "pack", monster: monsters[i] });
    for (const row of rows) {
      const identity = collectionGridIdentity(row);
      if (!seen.has(identity)) {
        seen.add(identity);
        merged.push(row);
      }
    }
  }
  return merged;
}
export function parsePackGridPage(
  value: unknown,
  collection: string,
  owner?: string,
  after: string | null = null
): BoosterPage<BoosterMonster> {
  if (!value || typeof value !== "object")
    throw new Error("Collection cards could not be verified.");
  const page = value as BoosterPage<BoosterMonster>;
  if (
    page.chainId !== 8453 ||
    !page.enabled ||
    page.collection?.toLowerCase() !== collection.toLowerCase() ||
    !Array.isArray(page.items) ||
    page.items.length > 24 ||
    !page.indexedBlock ||
    !/^\d+$/.test(page.indexedBlock)
  )
    throw new Error(
      "Collection cards do not match the configured Base collection."
    );
  let previous = after === null ? -1n : BigInt(after);
  const seen = new Set<string>();
  for (const item of page.items) {
    if (
      !item ||
      !isAddress(item.collection) ||
      !isAddress(item.owner) ||
      item.collection.toLowerCase() !== collection.toLowerCase() ||
      (owner && item.owner.toLowerCase() !== owner.toLowerCase()) ||
      item.burned !== false ||
      !/^[1-9][0-9]*$/.test(item.tokenId) ||
      item.id !== `8453:${collection.toLowerCase()}:${item.tokenId}` ||
      !/^\d+$/.test(item.mintBlock) ||
      BigInt(item.mintBlock) > BigInt(page.indexedBlock) ||
      typeof item.metadataUri !== "string" ||
      !item.metadataUri ||
      ![item.monsterType, item.color, item.horn, item.glitter].every(
        (trait) => typeof trait === "string"
      ) ||
      BigInt(item.tokenId) <= previous ||
      seen.has(item.id)
    )
      throw new Error(
        "Collection card ownership or pagination could not be verified."
      );
    previous = BigInt(item.tokenId);
    seen.add(item.id);
  }
  if (
    page.nextCursor !== null &&
    page.nextCursor !== undefined &&
    (typeof page.nextCursor !== "string" ||
      !/^[1-9][0-9]*$/.test(page.nextCursor) ||
      page.nextCursor !== page.items.at(-1)?.tokenId ||
      page.nextCursor === after)
  )
    throw new Error("Collection card cursor could not be verified.");
  return page;
}
export async function fetchPackGridPage(
  collection: string,
  owner: string | undefined,
  after: string | null,
  signal?: AbortSignal
) {
  if (
    !isAddress(collection) ||
    (owner !== undefined && !isAddress(owner)) ||
    (after !== null && !/^[1-9][0-9]*$/.test(after))
  )
    throw new Error("Invalid collection card request.");
  const path = owner
    ? `/owners/${owner.toLowerCase()}/booster-monsters`
    : "/boosters/monsters";
  const params = new URLSearchParams({ limit: "24" });
  if (after) params.set("after", after);
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}/v1${path}?${params}`,
    { signal, cache: "no-store" }
  );
  if (!response.ok)
    throw new Error(
      "Some collection cards could not be loaded. Please try again."
    );
  return parsePackGridPage(await response.json(), collection, owner, after);
}
