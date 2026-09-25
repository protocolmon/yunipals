import { getAddress, zeroAddress, zeroHash, type Address } from "viem";

import { catalogCurrencies } from "./catalogCurrency";
import { parseMarketAssetId, type MarketAssetId } from "./marketOrder";
import {
  bnbOfferCurrency,
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";
import type { ObservedMarketSale } from "./settledSale";
import {
  address,
  array,
  decimal,
  enumeration,
  hex,
  integer,
  pageToken,
  record,
  string,
  version
} from "./validation";

export const activityViews = ["all", "sales", "received"] as const;
export type ActivityView = (typeof activityViews)[number];
export type ActivityScope =
  | { kind: "asset"; asset: MarketAssetId }
  | {
      kind: "wallet";
      wallet: Address;
      chain: MarketplaceChain | "all";
      view: ActivityView;
    };
export type ActivityItem = {
  sale: ObservedMarketSale;
  status: "confirmed";
  currentVisibility: "public" | "hidden" | "burned" | "unknown";
};
type ChainCheckpoint = {
  status: "available" | "syncing" | "unavailable";
  confirmedThrough: { blockNumber: string; blockHash: `0x${string}` } | null;
  coverage?: {
    source: "yunipals" | "seaport";
    fromBlock: string;
    fromTimestamp: string;
    excludedEvents: number;
  };
};
export type ActivityPage = {
  query: string;
  snapshot: { id: string; observedAt: string };
  chains: Partial<Record<MarketplaceChain, ChainCheckpoint>>;
  total: number | null;
  items: ActivityItem[];
  nextCursor: string | null;
};
export type ActivityContinuation = {
  query: string;
  cursor: string;
  snapshot: ActivityPage["snapshot"];
  chains: ActivityPage["chains"];
  total: number | null;
  seen: string[];
  seenOrders: string[];
  visited: string[];
  last: ObservedMarketSale;
};
export class ActivitySnapshotError extends Error {
  constructor() {
    super("Activity could not be verified. Refresh to load a new view.");
    this.name = "ActivitySnapshotError";
  }
}

export function activityScopeKey(scope: ActivityScope) {
  if (scope.kind === "asset")
    return `asset:${marketplaceAssetKey(parseMarketAssetId(scope.asset))}`;
  if (scope.kind !== "wallet") throw new Error("Invalid activity scope.");
  const wallet = address(scope.wallet);
  if (wallet === zeroAddress) throw new Error("Choose a wallet address.");
  const chain = enumeration(scope.chain, [
    "all",
    ...Object.keys(marketplaceChains)
  ]);
  return `wallet:${wallet}:${chain}:${enumeration(scope.view, activityViews)}`;
}
function selectedChains(scope: ActivityScope): MarketplaceChain[] {
  return scope.kind === "asset"
    ? [scope.asset.chain]
    : scope.chain === "all"
      ? (Object.keys(marketplaceChains) as MarketplaceChain[])
      : [scope.chain];
}
function nonzeroHash(value: unknown) {
  const result = hex(value, 32);
  if (result === zeroHash) throw new ActivitySnapshotError();
  return result;
}
export function parseSale(value: unknown): ObservedMarketSale {
  const data = record(value);
  const asset = parseMarketAssetId(data.asset);
  const kind = enumeration(data.kind, ["listing-filled", "offer-accepted"]);
  const currencyData = record(data.currency);
  const currency = {
    address: address(currencyData.address),
    symbol: string(currencyData.symbol, 16),
    decimals: integer(currencyData.decimals, 36)
  };
  const currencies = [
    ...catalogCurrencies(asset.chain),
    ...(asset.chain === "bnb" && kind === "offer-accepted"
      ? [bnbOfferCurrency]
      : [])
  ];
  if (
    !currencies.some(
      (expected) =>
        getAddress(expected.address) === currency.address &&
        expected.symbol === currency.symbol &&
        expected.decimals === currency.decimals
    ) ||
    (kind === "offer-accepted" && currency.address === zeroAddress)
  )
    throw new ActivitySnapshotError();
  const seller = address(data.seller),
    nftRecipient = address(data.nftRecipient);
  const grossAmount = decimal(data.grossAmount),
    sellerProceeds = decimal(data.sellerProceeds);
  const fees = array(
    data.fees,
    (value) => {
      const fee = record(value);
      return { recipient: address(fee.recipient), amount: decimal(fee.amount) };
    },
    31
  );
  if (
    seller === zeroAddress ||
    nftRecipient === zeroAddress ||
    BigInt(sellerProceeds) === 0n ||
    BigInt(sellerProceeds) +
      fees.reduce((sum, fee) => sum + BigInt(fee.amount), 0n) !==
      BigInt(grossAmount)
  )
    throw new ActivitySnapshotError();
  const protocolAddress = address(data.protocolAddress);
  if (protocolAddress !== getAddress(seaportDeployment.address))
    throw new ActivitySnapshotError();
  const blockHash = nonzeroHash(data.blockHash);
  const fulfillmentLogIndex = integer(data.fulfillmentLogIndex),
    transferLogIndex = integer(data.transferLogIndex);
  const eventId = string(data.eventId, 128);
  if (
    eventId !== `${asset.chainId}:${blockHash}:${fulfillmentLogIndex}` ||
    fulfillmentLogIndex === transferLogIndex
  )
    throw new ActivitySnapshotError();
  return {
    eventId,
    asset,
    kind,
    seller,
    nftRecipient,
    currency,
    grossAmount,
    sellerProceeds,
    fees,
    protocolAddress,
    orderHash: nonzeroHash(data.orderHash),
    transactionHash: nonzeroHash(data.transactionHash),
    blockNumber: decimal(data.blockNumber),
    blockHash,
    blockTimestamp: decimal(data.blockTimestamp),
    fulfillmentLogIndex,
    transferLogIndex
  };
}
function orderKey(sale: ObservedMarketSale) {
  return `${sale.asset.chainId}:${sale.orderHash}`;
}
function precedes(left: ObservedMarketSale, right: ObservedMarketSale) {
  if (left.blockTimestamp !== right.blockTimestamp)
    return BigInt(left.blockTimestamp) > BigInt(right.blockTimestamp);
  if (left.asset.chainId !== right.asset.chainId)
    return left.asset.chainId < right.asset.chainId;
  if (left.blockNumber !== right.blockNumber)
    return BigInt(left.blockNumber) > BigInt(right.blockNumber);
  return left.fulfillmentLogIndex > right.fulfillmentLogIndex;
}

export function parseActivityPage(
  value: unknown,
  scope: ActivityScope,
  previous?: ActivityContinuation
): ActivityPage {
  const query = activityScopeKey(scope);
  const data = version(value);
  if (data.query !== query) throw new ActivitySnapshotError();
  const snapshotData = record(data.snapshot);
  const snapshot = {
    id: pageToken(snapshotData.id),
    observedAt: string(snapshotData.observedAt, 64)
  };
  const observedAt = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAt) || observedAt < 0)
    throw new ActivitySnapshotError();
  const chainData = record(data.chains);
  const selected = selectedChains(scope);
  if (Object.keys(chainData).length !== selected.length)
    throw new ActivitySnapshotError();
  const chains: ActivityPage["chains"] = {};
  for (const chain of selected) {
    const source = record(chainData[chain]);
    const status = enumeration(source.status, [
      "available",
      "syncing",
      "unavailable"
    ]);
    const head =
      source.confirmedThrough === null ? null : record(source.confirmedThrough);
    const confirmedThrough = head
      ? {
          blockNumber: decimal(head.blockNumber),
          blockHash: nonzeroHash(head.blockHash)
        }
      : null;
    if (status === "available" && !confirmedThrough)
      throw new ActivitySnapshotError();
    let coverage: ChainCheckpoint["coverage"];
    if (source.coverage !== undefined) {
      const value = record(source.coverage);
      coverage = {
        source: enumeration(value.source, ["yunipals", "seaport"]),
        fromBlock: decimal(value.fromBlock),
        fromTimestamp: decimal(value.fromTimestamp),
        excludedEvents: integer(value.excludedEvents)
      };
      if (
        !confirmedThrough ||
        BigInt(coverage.fromBlock) > BigInt(confirmedThrough.blockNumber) ||
        BigInt(coverage.fromTimestamp) >
          BigInt(Math.floor(observedAt / 1000)) ||
        coverage.source !== (chain === "bnb" ? "yunipals" : "seaport") ||
        (coverage.excludedEvents > 0 && status === "available")
      )
        throw new ActivitySnapshotError();
    }
    chains[chain] = {
      status,
      confirmedThrough,
      ...(coverage ? { coverage } : {})
    };
  }
  const partial = selected.some(
    (chain) => chains[chain]?.status !== "available"
  );
  const total = data.total === null ? null : integer(data.total);
  if ((total === null) !== partial) throw new ActivitySnapshotError();
  if (
    previous &&
    (previous.query !== query ||
      JSON.stringify(previous.snapshot) !== JSON.stringify(snapshot) ||
      JSON.stringify(previous.chains) !== JSON.stringify(chains) ||
      previous.total !== total)
  )
    throw new ActivitySnapshotError();
  const seen = new Set(previous?.seen),
    seenOrders = new Set(previous?.seenOrders);
  let last = previous?.last;
  const items = array(
    data.items,
    (value): ActivityItem => {
      const item = record(value);
      if (item.status !== "confirmed") throw new ActivitySnapshotError();
      const sale = parseSale(item.sale);
      const checkpoint = chains[sale.asset.chain]?.confirmedThrough;
      const coverage = chains[sale.asset.chain]?.coverage;
      if (
        !checkpoint ||
        BigInt(sale.blockNumber) > BigInt(checkpoint.blockNumber) ||
        (sale.blockNumber === checkpoint.blockNumber &&
          sale.blockHash !== checkpoint.blockHash) ||
        BigInt(sale.blockTimestamp) > BigInt(Math.floor(observedAt / 1000)) ||
        (coverage &&
          (BigInt(sale.blockNumber) < BigInt(coverage.fromBlock) ||
            BigInt(sale.blockTimestamp) < BigInt(coverage.fromTimestamp)))
      )
        throw new ActivitySnapshotError();
      if (scope.kind === "asset") {
        if (
          marketplaceAssetKey(sale.asset) !== marketplaceAssetKey(scope.asset)
        )
          throw new ActivitySnapshotError();
      } else {
        const sold = sale.seller === getAddress(scope.wallet),
          received = sale.nftRecipient === getAddress(scope.wallet);
        if (
          scope.view === "sales"
            ? !sold
            : scope.view === "received"
              ? !received
              : !sold && !received
        )
          throw new ActivitySnapshotError();
      }
      if (
        seen.has(sale.eventId) ||
        (sale.asset.chain === "bnb" && seenOrders.has(orderKey(sale))) ||
        (last && !precedes(last, sale))
      )
        throw new ActivitySnapshotError();
      seen.add(sale.eventId);
      // Admitted BNB orders are single-NFT full fills. Historical Seaport
      // orders on the other chains can have multiple confirmed partial fills.
      if (sale.asset.chain === "bnb") seenOrders.add(orderKey(sale));
      last = sale;
      return {
        sale,
        status: "confirmed",
        currentVisibility: enumeration(item.currentVisibility, [
          "public",
          "hidden",
          "burned",
          "unknown"
        ])
      };
    },
    25
  );
  const nextCursor =
    data.nextCursor === null ? null : pageToken(data.nextCursor);
  if (
    (total !== null &&
      (seen.size > total ||
        (!nextCursor && seen.size !== total) ||
        (nextCursor && seen.size >= total))) ||
    (nextCursor &&
      (!items.length ||
        nextCursor === previous?.cursor ||
        previous?.visited.includes(nextCursor)))
  )
    throw new ActivitySnapshotError();
  return { query, snapshot, chains, total, items, nextCursor };
}

export function nextActivityPage(
  last: ActivityPage,
  pages: ActivityPage[]
): ActivityContinuation | undefined {
  if (!last.nextCursor || !last.items.length) return undefined;
  const items = pages.flatMap((page) => page.items);
  return {
    query: last.query,
    cursor: last.nextCursor,
    snapshot: last.snapshot,
    chains: last.chains,
    total: last.total,
    seen: items.map(({ sale }) => sale.eventId),
    seenOrders: items
      .filter(({ sale }) => sale.asset.chain === "bnb")
      .map(({ sale }) => orderKey(sale)),
    visited: pages.flatMap((page) =>
      page.nextCursor ? [page.nextCursor] : []
    ),
    last: last.items[last.items.length - 1]!.sale
  };
}
