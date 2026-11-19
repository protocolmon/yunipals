import type { IndexedChain } from "@protopals/yunipals-market-core/collectionTypes";

import { marketplaceChains } from "@/lib/marketplace/registry";
import { environment } from "@/environment";
import type { CollectionChain } from "@/lib/collectionBrowserFilters";

export type CollectionEdition = "og" | "airdrop" | "tcg";
type CollectionScope = "public" | "collector";
export const collectionEditions = ["og", "airdrop", "tcg"] as const;
export const collectionDefinitions = {
  og: {
    label: "OG Collection",
    description: "Original Yunipals on Ethereum, BNB Chain and Polygon.",
    chains: ["ethereum", "polygon", "bnb"]
  },
  airdrop: {
    label: "OG Airdrop",
    description: "The original Yunipals collection airdropped on Base.",
    chains: ["base"]
  },
  tcg: {
    label: "TCG Collection",
    description: "Your Yunipals cards from booster packs and daily packs.",
    chains: ["base"]
  }
} satisfies Record<
  CollectionEdition,
  { label: string; description: string; chains: IndexedChain[] }
>;

export const collectionFilterStorageKey = "yunipals.collection.filters.v3";

/** Public browsing includes Exomon; EVM wallet views retain their own chains. */
export function collectionEditionChains(
  edition: CollectionEdition,
  scope: CollectionScope = "public"
): CollectionChain[] {
  return [
    ...collectionDefinitions[edition].chains,
    ...(scope === "public" && edition === "og" && environment.exomonEnabled
      ? ["solana" as const]
      : [])
  ];
}

export function collectionEdition(params: URLSearchParams): CollectionEdition {
  if (params.get("edition") === "tcg") return "tcg";
  if (params.get("edition") === "airdrop") return "airdrop";
  // Old OG links selected the Base airdrop through a chain filter.
  const chains = params.getAll("chain");
  return chains.length > 0 && chains.every((chain) => chain === "base")
    ? "airdrop"
    : "og";
}

export function collectionMigrationNotice(
  params: URLSearchParams,
  scope: CollectionScope = "public"
) {
  const selected = params.getAll("chain");
  if (
    params.get("edition") !== "tcg" &&
    selected.includes("base") &&
    selected.some((chain) => chain !== "base")
  )
    return "Base airdrop holdings now have their own OG Airdrop view. Use the collection switch to see them.";
  const allowed: readonly string[] = collectionEditionChains(
    collectionEdition(params),
    scope
  );
  if (selected.some((chain) => !allowed.includes(chain)))
    return "The selected collection uses its own networks. Incompatible network filters have been cleared.";
  return null;
}

export function collectorHref(owner: string, edition: CollectionEdition) {
  return `/collector/${encodeURIComponent(owner)}?edition=${edition}`;
}

export function originalTokenEdition(chain: string): CollectionEdition {
  return chain === "base" ? "airdrop" : "og";
}

export function matchesOriginalEdition(
  token: { chain: string; contractAddress: string | null },
  edition: Exclude<CollectionEdition, "tcg">
) {
  const chains: readonly string[] = collectionDefinitions[edition].chains;
  if (!chains.includes(token.chain)) return false;
  const configured = marketplaceChains[token.chain as IndexedChain];
  return (
    token.contractAddress?.toLowerCase() ===
    configured.contractAddress.toLowerCase()
  );
}

/** A scope is applied before requesting pages, counts, facets or listings. */
export function scopeEditionQuery(
  params: URLSearchParams,
  scope: CollectionScope = "public"
) {
  const query = new URLSearchParams(params);
  const edition = collectionEdition(query);
  query.set("edition", edition);
  if (edition !== "og") query.delete("marketReturnChain");
  const allowed: readonly string[] = collectionEditionChains(edition, scope);
  const selected = query.getAll("chain");
  const excluded = query.getAll("excludeChain");
  if (
    selected.some(
      (chain) =>
        !["ethereum", "polygon", "bnb", "base", "solana"].includes(chain)
    )
  )
    return query; // Let the filter parser report an invalid chain.
  const effective = allowed.filter(
    (chain) =>
      (!selected.length || selected.includes(chain)) &&
      !excluded.includes(chain)
  );
  query.delete("chain");
  query.delete("excludeChain");
  // Incompatible legacy filters cannot turn an edition into an all-chain request.
  for (const chain of effective.length ? effective : allowed)
    query.append("chain", chain);
  return query;
}

/** Collection membership is implicit in browser URLs, not an active filter. */
export function collectionViewQuery(
  params: URLSearchParams,
  scope: CollectionScope = "public"
) {
  const query = scopeEditionQuery(params, scope);
  const allowed = collectionEditionChains(collectionEdition(query), scope);
  const selected = query.getAll("chain");
  if (
    selected.length === allowed.length &&
    allowed.every((chain) => selected.includes(chain))
  )
    query.delete("chain");
  return query;
}

/** Explicit URLs win; a bare URL restores the saved view. */
export function resolveCollectionQuery(
  params: URLSearchParams,
  saved: string | null
) {
  return scopeEditionQuery(
    new URLSearchParams(params.size ? params : (saved ?? ""))
  );
}

export function readEditionPreferences(
  key: string,
  previousKeys: string[],
  edition?: CollectionEdition,
  scope: CollectionScope = "public"
) {
  try {
    const keys = edition
      ? [
          `${key}.${edition}`,
          key,
          ...previousKeys.flatMap((previous) => [
            `${previous}.${edition}`,
            `${previous}.og`,
            previous
          ])
        ]
      : [key, ...previousKeys];
    for (const candidate of keys) {
      const saved = localStorage.getItem(candidate);
      if (!saved || saved.length > 4096) continue;
      const query = new URLSearchParams(saved);
      if (edition && collectionEdition(query) !== edition) continue;
      if (
        candidate !== key &&
        !candidate.startsWith(`${key}.`) &&
        collectionEdition(query) !== "tcg" &&
        query.get("sort") === "token-id-asc"
      )
        query.delete("sort");
      return collectionViewQuery(query, scope).toString();
    }
  } catch {
    // Shared URLs remain usable when storage is unavailable.
  }
  return null;
}

export function saveEditionPreferences(
  key: string,
  query: string,
  scope: CollectionScope = "public"
) {
  try {
    const normalized = collectionViewQuery(new URLSearchParams(query), scope);
    localStorage.setItem(
      `${key}.${collectionEdition(normalized)}`,
      normalized.toString()
    );
    localStorage.setItem(key, normalized.toString());
  } catch {
    // Shared URLs remain usable when storage is unavailable.
  }
}

export function readSavedCollectionFilters(edition?: CollectionEdition) {
  return readEditionPreferences(
    collectionFilterStorageKey,
    ["yunipals.collection.filters.v2", "yunipals.collection.filters.v1"],
    edition
  );
}

export function saveCollectionFilters(query: string) {
  saveEditionPreferences(collectionFilterStorageKey, query);
}
