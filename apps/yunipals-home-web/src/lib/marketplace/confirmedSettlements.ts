import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { getAddress, type TransactionReceipt } from "viem";

import type { CollectionFilters } from "@/lib/collectionFilters";
import type { CatalogPage } from "@/lib/marketplace/catalog";
import type { MarketAsset, MarketOrder } from "@/lib/marketplace/marketApi";
import { marketplaceAssetKey } from "@/lib/marketplace/registry";
import {
  assertMarketReceipt,
  type MarketReceiptExpectation
} from "@/lib/marketplace/transactionIntent";
import {
  tokenKey,
  type EvmAddress,
  type TokenVisibility,
  type YunipalToken
} from "@/lib/yunipalsIndexer";

export const settlementsKey = ["confirmed-market-settlements"] as const;
export const optimisticSettlementLifetimeMs = 30 * 60 * 1000;
export type ConfirmedSettlement = {
  id: string;
  asset: Extract<
    MarketReceiptExpectation,
    { kind: "buy" | "accept-offer" }
  >["asset"];
  orderHash: string;
  from: EvmAddress;
  to: EvmAddress;
  blockNumber: string;
  blockHash: string;
  confirmedAt: number;
  lifecycle?: number;
  token?: YunipalToken;
  synced: boolean;
};
export const emptySettlements: ConfirmedSettlement[] = [];
export function settlementId(chainId: number, hash: string) {
  return `${chainId}:${hash.toLowerCase()}`;
}
function confirmedToken(
  token: YunipalToken,
  owner: EvmAddress,
  blockNumber: string
): YunipalToken {
  return {
    ...token,
    owner,
    lastTransferBlock: blockNumber,
    hidden: false
  };
}
function cachedToken(
  client: QueryClient,
  asset: ConfirmedSettlement["asset"]
) {
  for (const [, data] of client.getQueriesData<InfiniteData<CatalogPage>>({
    queryKey: ["marketplace", "catalog"]
  })) {
    const token = data?.pages
      .flatMap((page) => page.items)
      .find((item) => marketplaceAssetKey(item.token) === marketplaceAssetKey(asset))
      ?.token;
    if (token) return token;
  }
}
export function recordSettlement(
  client: QueryClient,
  expectation: MarketReceiptExpectation,
  receipt: TransactionReceipt,
  lifecycle?: number
): ConfirmedSettlement | undefined {
  assertMarketReceipt(expectation, receipt);
  if (expectation.kind !== "buy" && expectation.kind !== "accept-offer") return;
  const id = settlementId(expectation.chainId, receipt.transactionHash);
  const previous =
    client.getQueryData<ConfirmedSettlement[]>(settlementsKey) ?? [];
  const existing = previous.find((item) => item.id === id);
  if (existing?.blockHash === receipt.blockHash) {
    const token = existing.token ?? cachedToken(client, existing.asset);
    if (
      (existing.lifecycle === undefined && lifecycle !== undefined) ||
      (!existing.token && token)
    )
      client.setQueryData(
        settlementsKey,
        previous.map((item) =>
          item.id === id
            ? {
                ...item,
                lifecycle: item.lifecycle ?? lifecycle,
                token: token
                  ? confirmedToken(token, item.to, item.blockNumber)
                  : item.token
              }
            : item
        )
      );
    return;
  }
  const entry: ConfirmedSettlement = {
    id,
    asset: expectation.asset,
    orderHash: expectation.orderHash.toLowerCase(),
    from: getAddress(
      expectation.kind === "buy"
        ? expectation.order.offerer
        : expectation.account
    ),
    to: getAddress(
      expectation.kind === "buy"
        ? expectation.account
        : expectation.order.offerer
    ),
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    confirmedAt: Date.now(),
    lifecycle,
    token: undefined,
    synced: false
  };
  const token = cachedToken(client, entry.asset);
  if (token)
    entry.token = confirmedToken(token, entry.to, entry.blockNumber);
  client.setQueryData(settlementsKey, [
    ...previous.filter(
      (item) =>
        item.id !== id &&
        !(
          marketplaceAssetKey(item.asset) === marketplaceAssetKey(entry.asset) &&
          BigInt(item.blockNumber) <= BigInt(entry.blockNumber)
        )
    ),
    entry
  ]);
  return entry;
}
export function applySettlementsToOwnerTokens(
  tokens: YunipalToken[],
  changes: ConfirmedSettlement[],
  ownerAddresses: string[],
  visibility: Extract<TokenVisibility, "visible" | "hidden">,
  now = Date.now()
) {
  const owners = new Set(ownerAddresses.map((owner) => owner.toLowerCase()));
  const seen = new Set(tokens.map(tokenKey));
  const optimistic = changes.flatMap((change) => {
    const token = change.token;
    if (
      change.synced ||
      !token ||
      !owners.has(change.to.toLowerCase()) ||
      now - change.confirmedAt > optimisticSettlementLifetimeMs ||
      (visibility === "visible" ? token.hidden : !token.hidden) ||
      seen.has(tokenKey(token))
    )
      return [];
    seen.add(tokenKey(token));
    return [token];
  });
  return [...tokens, ...optimistic];
}
export function syncSettlementsFromOwnerTokens(
  client: QueryClient,
  tokens: YunipalToken[]
) {
  const current = client.getQueryData<ConfirmedSettlement[]>(settlementsKey);
  if (!current?.some((change) => !change.synced)) return;
  const byAsset = new Map(
    tokens.map((token) => [marketplaceAssetKey(token), token])
  );
  let changed = false;
  const next = current.map((change) => {
    if (change.synced) return change;
    const token = byAsset.get(marketplaceAssetKey(change.asset));
    if (
      !token ||
      token.owner.toLowerCase() !== change.to.toLowerCase() ||
      !/^\d+$/.test(token.lastTransferBlock) ||
      BigInt(token.lastTransferBlock) < BigInt(change.blockNumber)
    )
      return change;
    changed = true;
    return { ...change, token, synced: true };
  });
  if (changed) client.setQueryData(settlementsKey, next);
}
export function forgetSettlement(
  client: QueryClient,
  chainId: number,
  hash: string
) {
  client.setQueryData<ConfirmedSettlement[]>(settlementsKey, (items = []) =>
    items.filter((item) => item.id !== settlementId(chainId, hash))
  );
}
export function orderWasFilled(
  order: MarketOrder,
  changes: ConfirmedSettlement[]
) {
  return changes.some(
    (change) =>
      marketplaceAssetKey(change.asset) === marketplaceAssetKey(order.asset) &&
      change.orderHash === order.orderHash.toLowerCase()
  );
}
export function orderWasSettled(
  order: MarketOrder,
  changes: ConfirmedSettlement[],
  transferBlock?: string
) {
  return changes.some((change) => {
    if (marketplaceAssetKey(change.asset) !== marketplaceAssetKey(order.asset))
      return false;
    if (change.orderHash === order.orderHash.toLowerCase()) return true;
    if (change.lifecycle !== undefined && change.lifecycle !== order.lifecycle)
      return false;
    if (
      transferBlock &&
      /^\d+$/.test(transferBlock) &&
      BigInt(transferBlock) > BigInt(change.blockNumber)
    )
      return false;
    return order.side === "listing" && getAddress(order.maker) === change.from;
  });
}
export function applySettlementsToAsset(
  data: MarketAsset,
  changes: ConfirmedSettlement[],
  transferBlock?: string
): MarketAsset {
  if (!changes.length) return data;
  const listings = data.listings.filter(
    (order) => !orderWasSettled(order, changes, transferBlock)
  );
  const offers = data.offers.filter(
    (order) => !orderWasSettled(order, changes, transferBlock)
  );
  return {
    ...data,
    listings,
    offers,
    listingState: listings.length
      ? data.listingState
      : data.listings.length
        ? "updating"
        : data.listingState
  };
}
/** Only presentation changes. Original pages/cursors remain untouched for pagination validation. */
export function applySettlementsToCatalog<T>(
  data: InfiniteData<CatalogPage, T>,
  changes: ConfirmedSettlement[],
  filters: CollectionFilters
): InfiniteData<CatalogPage, T> {
  if (!changes.length) return data;
  const removed = new Set<string>();
  const noLongerListed = new Set<string>();
  const needsListing =
    filters.sale === "listed" ||
    filters.sort.startsWith("price-") ||
    filters.currency !== "all" ||
    Boolean(filters.priceMin || filters.priceMax);
  const pages = data.pages.map((page) => ({
    ...page,
    items: page.items.flatMap((item) => {
      const listings = item.market.listings.filter(
        (order) =>
          !orderWasSettled(order, changes, item.token.lastTransferBlock)
      );
      if (listings.length === item.market.listings.length) return [item];
      const key = marketplaceAssetKey(item.token);
      if (!listings.length) {
        noLongerListed.add(key);
        if (needsListing) {
          removed.add(key);
          return [];
        }
      }
      return [
        {
          ...item,
          market: {
            ...item.market,
            listings,
            status: listings.length
              ? ("listed" as const)
              : ("purchased" as const)
          }
        }
      ];
    })
  }));
  return {
    ...data,
    pages: pages.map((page) => ({
      ...page,
      total: Math.max(0, page.total - removed.size),
      listedTotal:
        page.listedTotal === null
          ? null
          : Math.max(0, page.listedTotal - noLongerListed.size),
      verifiedListedTotal: Math.max(
        0,
        page.verifiedListedTotal - noLongerListed.size
      )
    }))
  };
}
