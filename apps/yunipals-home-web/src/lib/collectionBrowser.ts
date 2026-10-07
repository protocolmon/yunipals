import { environment } from "@/environment";
import {
  collectionFiltersKey,
  hasMarketFilters,
  includesSolana,
  toEvmCollectionFilters,
  type CollectionChain,
  type CollectionFilters,
  type CollectionSort
} from "@/lib/collectionBrowserFilters";
import { collectionFiltersToTokenQuery } from "@/lib/collectionFilters";
import type { ExomonToken } from "@/lib/solanaIndexer";
import {
  fetchTokens,
  fetchTraitFacets,
  IndexerError,
  isIndexedChain,
  type TraitFacet,
  type TraitFacets,
  type YunipalToken
} from "@/lib/yunipalsIndexer";

export type CollectionToken = YunipalToken | ExomonToken;
export type CollectionFacets = Omit<TraitFacets, "chain" | "chains">;
type Source = "evm" | "solana";
type SourcePage = {
  items: CollectionToken[];
  total: number;
  nextCursor: string | null;
};
type SourceState = SourcePage & { started: boolean };
export type CollectionContinuation = {
  filtersKey: string;
  sources: Partial<Record<Source, SourceState>>;
};
export type CollectionPage = {
  items: CollectionToken[];
  total: number;
  nextCursor: CollectionContinuation | null;
};
export const collectionBrowserCacheVersion = "collection-browser-v1";
const pageSize = 24;

export const collectionTokenKey = (token: CollectionToken) =>
  `${token.chain}:${token.tokenId}`;

async function solanaRequest<T>(
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<T> {
  params.set("chain", "solana");
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}${path}?${params}`,
    { signal }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new IndexerError(response.status, body?.error);
  }
  return response.json();
}

function sourcesFor(filters: CollectionFilters): Source[] {
  return [
    ...(!filters.chains.length || filters.chains.some(isIndexedChain)
      ? ["evm" as const]
      : []),
    ...(includesSolana(filters) ? ["solana" as const] : [])
  ];
}

async function fetchSource(
  source: Source,
  filters: CollectionFilters,
  cursor?: string,
  signal?: AbortSignal
): Promise<SourcePage> {
  const query = {
    ...collectionFiltersToTokenQuery(toEvmCollectionFilters(filters)),
    limit: pageSize,
    burned: false,
    cursor
  };
  if (source === "evm") return fetchTokens(query, signal);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key !== "chains" && key !== "traits" && value !== undefined)
      params.set(key, String(value));
  }
  for (const trait of query.traits ?? []) {
    params.append("traitType", trait.traitType);
    params.append("traitValue", trait.traitValue);
  }
  return solanaRequest<SourcePage>("/v1/tokens", params, signal);
}

/** PostgreSQL numeric scores can exceed JS integer precision. */
function compareDecimal(a: string, b: string) {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const precision = Math.max(af.length, bf.length);
  const left = BigInt(ai + af.padEnd(precision, "0"));
  const right = BigInt(bi + bf.padEnd(precision, "0"));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareCollectionTokens(
  a: CollectionToken,
  b: CollectionToken,
  sort: CollectionSort
) {
  const descending = sort.endsWith("desc");
  if (sort.startsWith("rarity")) {
    const key = sort.startsWith("rarity-capped")
      ? "rarityPointsCapped"
      : "rarityPoints";
    const left = a[key],
      right = b[key];
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    if (left !== null && right !== null) {
      const order = compareDecimal(left, right);
      if (order) return descending ? -order : order;
    }
  }
  // Numeric EVM IDs precede Solana mint addresses in ascending identity order.
  // Within each source we preserve the API's ordering, including rarity ties.
  const identityDirection = sort === "token-id-desc" ? -1 : 1;
  if ((a.chain === "solana") !== (b.chain === "solana")) {
    return (a.chain === "solana" ? 1 : -1) * identityDirection;
  }
  const idOrder =
    a.chain === "solana"
      ? a.tokenId < b.tokenId
        ? -1
        : a.tokenId > b.tokenId
          ? 1
          : 0
      : compareDecimal(a.tokenId, b.tokenId);
  return (
    idOrder * identityDirection ||
    (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0)
  );
}

/** Merge sorted, bounded API pages. Never fetch a whole collection or use RPC. */
export async function fetchCollectionPage(
  filters: CollectionFilters,
  cursor?: CollectionContinuation,
  signal?: AbortSignal
): Promise<CollectionPage> {
  if (hasMarketFilters(filters))
    throw new Error("Select an EVM chain to use sale and price filters.");
  const filtersKey = collectionFiltersKey(filters);
  if (cursor && cursor.filtersKey !== filtersKey)
    throw new Error("Collection filters changed. Refresh the collection.");
  const sources = sourcesFor(filters);
  const states: Partial<Record<Source, SourceState>> = {};
  for (const source of sources) {
    const old = cursor?.sources[source];
    // Never mutate cached continuations: retries must replay the same page.
    states[source] = old
      ? { ...old, items: [...old.items] }
      : { started: false, items: [], total: 0, nextCursor: null };
  }
  const items: CollectionToken[] = [];
  while (items.length < pageSize) {
    await Promise.all(
      sources.map(async (source) => {
        const state = states[source]!;
        if (state.items.length || (state.started && !state.nextCursor)) return;
        const page = await fetchSource(
          source,
          filters,
          state.nextCursor ?? undefined,
          signal
        );
        if (!page.items.length && page.nextCursor)
          throw new Error("Collection returned an empty continuing page.");
        states[source] = { ...page, started: true, items: [...page.items] };
      })
    );
    const candidates = sources.filter((source) => states[source]!.items.length);
    if (!candidates.length) break;
    const selected = candidates.reduce((left, right) =>
      compareCollectionTokens(
        states[left]!.items[0],
        states[right]!.items[0],
        filters.sort
      ) <= 0
        ? left
        : right
    );
    items.push(states[selected]!.items.shift()!);
  }
  return {
    items,
    total: sources.reduce((sum, source) => sum + states[source]!.total, 0),
    nextCursor: sources.some(
      (source) => states[source]!.items.length || states[source]!.nextCursor
    )
      ? { filtersKey, sources: states }
      : null
  };
}

export async function fetchCollectionFacets(
  chains: CollectionChain[],
  signal?: AbortSignal
): Promise<CollectionFacets> {
  const requests: Promise<CollectionFacets>[] = [];
  if (!chains.length || chains.some(isIndexedChain))
    requests.push(fetchTraitFacets(chains.filter(isIndexedChain), signal));
  if (
    environment.exomonEnabled &&
    (!chains.length || chains.includes("solana"))
  ) {
    requests.push(
      solanaRequest<CollectionFacets>(
        "/v1/traits",
        new URLSearchParams(),
        signal
      ).then((page) => ({
        ...page,
        items: page.items.filter(
          (facet) =>
            !["Rank", "Birthday", "Last metadata update"].includes(
              facet.traitType
            )
        )
      }))
    );
  }
  const pages = await Promise.all(requests);
  const facets = new Map<string, TraitFacet>();
  for (const page of pages)
    for (const original of page.items) {
      let facet = original;
      // DAS facets expose numeric metadata as categories. Preserve the common
      // collection's range filter instead of adding thousands of checkboxes.
      if (
        facet.kind === "categorical" &&
        ["Rarity Points", "Rarity Points Capped"].includes(facet.traitType)
      ) {
        const values = facet.values
          .map((item) => item.value)
          .filter((value) => /^-?\d+(\.\d+)?$/.test(value))
          .sort(compareDecimal);
        if (!values.length) continue;
        facet = {
          traitType: facet.traitType,
          kind: "numeric",
          min: values[0],
          max: values[values.length - 1]
        };
      }
      const previous = facets.get(facet.traitType);
      if (facet.kind === "categorical") {
        const counts = new Map(
          previous?.kind === "categorical"
            ? previous.values.map((item) => [item.value, item.count])
            : []
        );
        for (const item of facet.values)
          counts.set(item.value, (counts.get(item.value) ?? 0) + item.count);
        facets.set(facet.traitType, {
          ...facet,
          values: [...counts]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        });
      } else if (!previous) facets.set(facet.traitType, facet);
      else if (previous.kind === "numeric")
        facets.set(facet.traitType, {
          ...facet,
          min:
            compareDecimal(previous.min, facet.min) < 0
              ? previous.min
              : facet.min,
          max:
            compareDecimal(previous.max, facet.max) > 0
              ? previous.max
              : facet.max
        });
    }
  return {
    items: [...facets.values()],
    metadata: {
      available: pages.reduce((sum, page) => sum + page.metadata.available, 0),
      missing: pages.reduce((sum, page) => sum + page.metadata.missing, 0)
    },
    updatedAt: pages.map((page) => page.updatedAt).sort()[0] ?? ""
  };
}
