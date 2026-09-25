import type { QueryClient } from "@tanstack/react-query";
import { parseCatalogToken } from "@protopals/yunipals-market-core/catalogToken";
import { record } from "@protopals/yunipals-market-core/validation";
import {
  collectorFiltersKey,
  collectorPageSize,
  serializeCollectorFilters,
  type CollectorFilters
} from "@protopals/yunipals-market-core/collectorFilters";

import { environment } from "@/environment";
import {
  IndexerError,
  isEthereumAddress,
  indexedChains,
  tokenKey,
  type OwnerTokenPage
} from "@/lib/yunipalsIndexer";

export * from "@protopals/yunipals-market-core/collectorFilters";
export type CollectorPage = OwnerTokenPage & {
  version: 1;
  query: string;
  previousCursor: string | null;
};
export type CollectorCapabilities = {
  version: 0 | 1;
  namePrefixSearch: boolean;
  rarityRange: boolean;
};

export function parseCollectorPage(
  value: unknown,
  filters: CollectorFilters,
  visibility: "visible" | "hidden",
  cursor = ""
): CollectorPage {
  const data = record(value);
  const chains = filters.chains.length ? filters.chains : [...indexedChains];
  const resolved = record(data.resolvedAddresses);
  if (
    data.version !== 1 ||
    data.query !== collectorFiltersKey(filters) ||
    data.visibility !== visibility ||
    typeof data.owner !== "string" ||
    !isEthereumAddress(data.owner) ||
    !Array.isArray(data.chains) ||
    data.chains.join() !== chains.join() ||
    data.chain !== (chains.length === 1 ? chains[0] : null) ||
    !Array.isArray(data.items) ||
    data.items.length > collectorPageSize
  ) {
    throw new Error(
      "The collection response does not match the requested view."
    );
  }
  for (const [chain, address] of Object.entries(resolved)) {
    if (
      !chains.includes(chain as (typeof chains)[number]) ||
      typeof address !== "string" ||
      !isEthereumAddress(address)
    )
      throw new Error("Invalid collection owner.");
  }
  const items = data.items.map((raw) => {
    const item = record(raw);
    if (item.hidden !== (visibility === "hidden"))
      throw new Error("Invalid token visibility.");
    const token = {
      ...parseCatalogToken({ ...item, hidden: false }),
      hidden: item.hidden
    };
    if (
      !chains.includes(token.chain) ||
      token.owner.toLowerCase() !== String(resolved[token.chain]).toLowerCase()
    )
      throw new Error("Invalid token owner.");
    return token;
  });
  if (new Set(items.map(tokenKey)).size !== items.length)
    throw new Error("Duplicate collection token.");
  for (const key of ["previousCursor", "nextCursor"] as const) {
    const next = data[key];
    if (
      next !== null &&
      (typeof next !== "string" ||
        !next ||
        next.length > 2048 ||
        next === cursor)
    )
      throw new Error("Invalid collection cursor.");
  }
  return { ...data, items } as CollectorPage;
}

export function createCollectorClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  async function read(path: string, signal?: AbortSignal) {
    const response = await fetcher(`${baseUrl}${path}`, {
      signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const details = body && typeof body === "object" ? record(body) : {};
      throw new IndexerError(
        response.status,
        typeof details.error === "string" ? details.error : undefined,
        typeof details.message === "string" ? details.message : undefined
      );
    }
    return response.json() as Promise<unknown>;
  }
  return {
    async capabilities(signal?: AbortSignal): Promise<CollectorCapabilities> {
      try {
        const data = record(await read("/v1/collector-capabilities", signal));
        return {
          version: data.version === 1 ? 1 : 0,
          namePrefixSearch: data.version === 1 && data.namePrefixSearch === true,
          rarityRange: data.version === 1 && data.rarityRange === true
        };
      } catch (error) {
        if (error instanceof IndexerError && error.status === 404)
          return { version: 0, namePrefixSearch: false, rarityRange: false };
        throw error;
      }
    },
    async page(
      owner: string,
      filters: CollectorFilters,
      visibility: "visible" | "hidden",
      cursor = "",
      signal?: AbortSignal
    ) {
      const params = serializeCollectorFilters(filters);
      params.set("visibility", visibility);
      params.set("limit", String(collectorPageSize));
      if (cursor) params.set("cursor", cursor);
      const data = await read(
        `/v2/owners/${encodeURIComponent(owner)}/tokens?${params}`,
        signal
      );
      try {
        return parseCollectorPage(data, filters, visibility, cursor);
      } catch {
        throw new IndexerError(
          502,
          "invalid_collector_response",
          "The collection response could not be verified. Please refresh."
        );
      }
    }
  };
}

export const collectorClient = createCollectorClient(
  environment.yunipalsIndexerUrl
);

/** Expiry is not a size limit: retain five page payloads across all filter variants. */
export function pruneCollectorPages(client: QueryClient, activeHash: string) {
  const pages = client.getQueryCache().findAll({
    predicate: (query) =>
      query.queryKey[0] === "collector" &&
      query.queryKey[3] === "tokens" &&
      query.queryKey[5] === "page-v1"
  });
  const removable = pages
    .filter(
      (query) =>
        query.queryHash !== activeHash && query.getObserversCount() === 0
    )
    .sort(
      (left, right) => left.state.dataUpdatedAt - right.state.dataUpdatedAt
    );
  for (const query of removable.slice(0, Math.max(0, pages.length - 5)))
    client.removeQueries({ queryKey: query.queryKey, exact: true });
}
