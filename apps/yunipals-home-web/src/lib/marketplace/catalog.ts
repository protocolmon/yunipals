import { getAddress } from "viem";
import { parseCatalogToken } from "@protopals/yunipals-market-core/catalogToken";
import { validateCatalogFilters } from "@protopals/yunipals-market-core/catalogFilters";
import type {
  MarketChainAvailability,
  MarketListingState
} from "@protopals/yunipals-market-core/marketAvailability";

import {
  isPriceSort,
  serializeCollectionFilters,
  type CollectionFilters
} from "@/lib/collectionFilters";
import { createMarketRequest } from "@/lib/marketplace/http";
import { catalogCurrencies } from "@/lib/marketplace/catalogCurrency";
import {
  parseMarketOrder,
  type MarketOrder
} from "@/lib/marketplace/marketApi";
import {
  marketplaceAssetKey,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import {
  array,
  enumeration,
  integer,
  pageToken,
  record,
  string,
  version
} from "@/lib/marketplace/validation";
import { indexedChains, type YunipalToken } from "@/lib/yunipalsIndexer";

export {
  parseCatalogPrice,
  validateCatalogFilters
} from "@protopals/yunipals-market-core/catalogFilters";

export type CatalogMarket = {
  status: MarketListingState | "unknown" | "purchased";
  listings: MarketOrder[];
};
export type CatalogItem = { token: YunipalToken; market: CatalogMarket };
export type CatalogPage = {
  query: string;
  snapshot: { id: string; observedAt: string };
  sources: Partial<
    Record<MarketplaceChain, "available" | "unavailable" | "syncing">
  >;
  availability: Partial<Record<MarketplaceChain, MarketChainAvailability>>;
  listingCompleteness: "complete" | "partial" | "unavailable";
  total: number;
  listedTotal: number | null;
  verifiedListedTotal: number;
  items: CatalogItem[];
  nextCursor: string | null;
};
export type CatalogContinuation = {
  cursor: string;
  snapshot: string;
  observedAt: string;
  total: number;
  listedTotal: number | null;
  verifiedListedTotal: number;
  visited: string[];
  seenAssets: string[];
  seenListed: number;
  sources: CatalogPage["sources"];
  availability: CatalogPage["availability"];
  listingCompleteness: CatalogPage["listingCompleteness"];
  lastPrice?: { amount: string; tokenId: string };
};

function pricePosition(item: CatalogItem) {
  const order = item.market.listings[0];
  if (!order) throw new Error("A price-sorted NFT has no listing.");
  return { amount: order.grossAmount, tokenId: item.token.tokenId };
}
function assertPriceOrder(
  previous: { amount: string; tokenId: string },
  next: { amount: string; tokenId: string },
  descending: boolean
) {
  const a = BigInt(previous.amount),
    b = BigInt(next.amount);
  if (
    (descending ? a < b : a > b) ||
    (a === b && BigInt(previous.tokenId) >= BigInt(next.tokenId))
  )
    throw new Error(
      "Catalog prices or pagination are out of order. Refresh the collection."
    );
}

export function parseCatalogPage(
  value: unknown,
  filters: CollectionFilters,
  previous?: CatalogContinuation
): CatalogPage {
  const { key, min, max, currency } = validateCatalogFilters(filters);
  const data = version(value, 2);
  if (typeof data.query !== "string" || data.query.length > 4096)
    throw new Error("The catalog did not identify its filters.");
  const query = data.query;
  const rawSnapshot = record(data.snapshot);
  const snapshot = {
    id: pageToken(rawSnapshot.id),
    observedAt: string(rawSnapshot.observedAt, 40)
  };
  const observedAt = Date.parse(snapshot.observedAt);
  const total = integer(data.total);
  const listedTotal =
    data.listedTotal === null ? null : integer(data.listedTotal, total);
  const verifiedListedTotal = integer(data.verifiedListedTotal, total);
  const listingCompleteness = enumeration(data.listingCompleteness, [
    "complete",
    "partial",
    "unavailable"
  ]);
  if (
    query !== key ||
    !Number.isFinite(observedAt) ||
    (previous &&
      (snapshot.id !== previous.snapshot ||
        snapshot.observedAt !== previous.observedAt ||
        total !== previous.total ||
        listedTotal !== previous.listedTotal ||
        verifiedListedTotal !== previous.verifiedListedTotal ||
        listingCompleteness !== previous.listingCompleteness))
  )
    throw new Error(
      "The catalog snapshot changed or returned different filters. Refresh the collection."
    );
  const selected = filters.chains.length ? filters.chains : indexedChains;
  const sources: CatalogPage["sources"] = {};
  const rawSources = record(data.sources);
  for (const chain of selected)
    sources[chain] = enumeration(rawSources[chain], [
      "available",
      "unavailable",
      "syncing"
    ]);
  const availability: CatalogPage["availability"] = {};
  const rawAvailability = record(data.availability);
  for (const chain of selected) {
    const item = record(rawAvailability[chain]);
    const coverage = (value: unknown) => {
      const row = record(value);
      const completedAt =
        row.completedAt === null ? null : string(row.completedAt, 40);
      if (completedAt !== null && !Number.isFinite(Date.parse(completedAt)))
        throw new Error("The catalog returned an invalid coverage time.");
      return {
        status: enumeration(row.status, ["complete", "partial", "unavailable"]),
        completedAt,
        revision: row.revision === null ? null : string(row.revision, 128)
      };
    };
    const value: MarketChainAvailability = {
      chain: enumeration(item.chain, ["ethereum", "base", "polygon", "bnb"]),
      evidence: enumeration(item.evidence, [
        "current",
        "recovering",
        "unavailable"
      ]),
      listings: coverage(item.listings),
      offers: coverage(item.offers)
    };
    if (value.chain !== chain)
      throw new Error("The catalog returned availability for another chain.");
    availability[chain] = value;
  }
  if (
    (listingCompleteness === "complete") !== (listedTotal !== null) ||
    (listedTotal !== null && listedTotal !== verifiedListedTotal)
  )
    throw new Error("The catalog returned inconsistent listing totals.");
  if (
    previous &&
    (selected.some((chain) => sources[chain] !== previous.sources[chain]) ||
      JSON.stringify(availability) !== JSON.stringify(previous.availability))
  )
    throw new Error(
      "The catalog source status changed. Refresh the collection."
    );
  if (
    (filters.sale === "listed" && verifiedListedTotal !== total) ||
    (filters.sale === "unlisted" && verifiedListedTotal !== 0)
  )
    throw new Error("Catalog counts do not match the sale filters.");
  const keys = new Set<string>(previous?.seenAssets ?? []);
  const items = array(
    data.items,
    (value): CatalogItem => {
      const item = record(value);
      const token = parseCatalogToken(item.token);
      const identity = marketplaceAssetKey(token);
      const marketData = record(item.market);
      const status = enumeration(marketData.status, [
        "listed",
        "unlisted",
        "updating",
        "unavailable"
      ]);
      const listings = array(marketData.listings, parseMarketOrder, 8);
      const currencies = new Set<string>();
      if (!selected.includes(token.chain) || keys.has(identity))
        throw new Error("The catalog returned an unexpected or duplicate NFT.");
      keys.add(identity);
      if (
        (status === "listed") !== listings.length > 0 ||
        (status === "unlisted" &&
          (availability[token.chain]?.evidence !== "current" ||
            availability[token.chain]?.listings.status !== "complete")) ||
        (status === "updating" &&
          (availability[token.chain]?.evidence !== "current" ||
            availability[token.chain]?.listings.status !== "partial")) ||
        (status === "unavailable" &&
          availability[token.chain]?.evidence === "current" &&
          availability[token.chain]?.listings.status !== "unavailable")
      )
        throw new Error(
          "The catalog returned inconsistent listing availability."
        );
      for (const order of listings) {
        if (
          order.side !== "listing" ||
          order.status !== "active" ||
          marketplaceAssetKey(order.asset) !== identity ||
          order.lifecycle !== token.lifecycle ||
          getAddress(order.maker) !== getAddress(token.owner) ||
          currencies.has(order.currency.address) ||
          BigInt(order.startTime) > BigInt(Math.floor(observedAt / 1000)) ||
          BigInt(order.endTime) <= BigInt(Math.floor(observedAt / 1000))
        )
          throw new Error("A catalog listing does not match the current NFT.");
        currencies.add(order.currency.address);
        const configuredCurrency = catalogCurrencies(token.chain).find(
          (currency) =>
            getAddress(currency.address) === getAddress(order.currency.address)
        );
        if (
          !configuredCurrency ||
          order.currency.decimals !== configuredCurrency.decimals ||
          order.currency.symbol !== configuredCurrency.symbol ||
          (currency &&
            getAddress(order.currency.address) !== getAddress(currency.address))
        )
          throw new Error("The catalog returned a different price currency.");
        if (
          (min !== undefined && BigInt(order.grossAmount) < min) ||
          (max !== undefined && BigInt(order.grossAmount) > max)
        )
          throw new Error(
            "The catalog returned a listing outside the selected price range."
          );
      }
      if (
        (filters.sale !== "all" && status !== filters.sale) ||
        (currency && listings.length !== 1)
      )
        throw new Error(
          "The catalog returned an NFT outside the sale filters."
        );
      if (
        (filters.metadata === "available" && !token.metadataAvailable) ||
        (filters.metadata === "missing" && token.metadataAvailable)
      )
        throw new Error(
          "The catalog returned different metadata availability."
        );
      for (const [name, values] of Object.entries(filters.traits))
        if (
          !token.attributes?.some(
            (attribute) =>
              attribute.trait_type === name &&
              values.includes(String(attribute.value))
          )
        )
          throw new Error(
            "The catalog returned an NFT outside the trait filters."
          );
      const score =
        filters.rarityMode === "raw"
          ? token.rarityPoints
          : token.rarityPointsCapped;
      if (
        (filters.rarityMin || filters.rarityMax) &&
        (score === null ||
          (filters.rarityMin && Number(score) < Number(filters.rarityMin)) ||
          (filters.rarityMax && Number(score) > Number(filters.rarityMax)))
      )
        throw new Error(
          "The catalog returned an NFT outside the rarity range."
        );
      return { token, market: { status, listings } };
    },
    24
  );
  const nextCursor =
    data.nextCursor === null ? null : pageToken(data.nextCursor);
  const received = (previous?.seenAssets.length ?? 0) + items.length;
  const listedOnPage = items.filter(
    (item) => item.market.status === "listed"
  ).length;
  const listedReceived = (previous?.seenListed ?? 0) + listedOnPage;
  if (
    listedReceived > verifiedListedTotal ||
    (!nextCursor && listedReceived !== verifiedListedTotal) ||
    received > total ||
    (!nextCursor && received !== total) ||
    (nextCursor &&
      (received >= total ||
        items.length === 0 ||
        nextCursor === previous?.cursor ||
        previous?.visited.includes(nextCursor)))
  )
    throw new Error(
      "Catalog pagination did not advance. Refresh the collection."
    );
  if (isPriceSort(filters.sort)) {
    let last = previous?.lastPrice;
    for (const item of items) {
      const next = pricePosition(item);
      if (last) assertPriceOrder(last, next, filters.sort === "price-desc");
      last = next;
    }
  }
  return {
    query,
    snapshot,
    sources,
    availability,
    listingCompleteness,
    total,
    listedTotal,
    verifiedListedTotal,
    items,
    nextCursor
  };
}

export function nextCatalogPage(
  last: CatalogPage,
  pages: CatalogPage[],
  filters: CollectionFilters
): CatalogContinuation | undefined {
  if (!last.nextCursor) return undefined;
  return {
    cursor: last.nextCursor,
    snapshot: last.snapshot.id,
    observedAt: last.snapshot.observedAt,
    total: last.total,
    listedTotal: last.listedTotal,
    verifiedListedTotal: last.verifiedListedTotal,
    visited: pages.flatMap((page) =>
      page.nextCursor ? [page.nextCursor] : []
    ),
    seenAssets: pages.flatMap((page) =>
      page.items.map((item) => marketplaceAssetKey(item.token))
    ),
    seenListed: pages.reduce(
      (total, page) =>
        total +
        page.items.filter((item) => item.market.status === "listed").length,
      0
    ),
    sources: last.sources,
    availability: last.availability,
    listingCompleteness: last.listingCompleteness,
    ...(isPriceSort(filters.sort) && last.items.length
      ? { lastPrice: pricePosition(last.items[last.items.length - 1]) }
      : {})
  };
}

export function createCatalogClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  const request = createMarketRequest(baseUrl, fetcher);
  return {
    async catalog(
      filters: CollectionFilters,
      previous?: CatalogContinuation,
      signal?: AbortSignal
    ) {
      validateCatalogFilters(filters);
      const params = serializeCollectionFilters(filters);
      params.set("limit", "24");
      if (previous) {
        params.set("cursor", pageToken(previous.cursor));
        params.set("snapshot", pageToken(previous.snapshot));
      }
      return parseCatalogPage(
        await request(`/v2/market/tokens?${params}`, { signal }),
        filters,
        previous
      );
    }
  };
}
