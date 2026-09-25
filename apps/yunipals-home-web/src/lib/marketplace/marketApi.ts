import type { OpenSeaFulfillmentQuote } from "@protopals/yunipals-market-core/openseaFulfillment";
export type { OpenSeaFulfillmentQuote } from "@protopals/yunipals-market-core/openseaFulfillment";
import type {
  MarketChainAvailability,
  MarketDiscoveryCoverage,
  MarketListingState
} from "@protopals/yunipals-market-core/marketAvailability";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  parseMarketAssetId,
  parseMarketOrder,
  type MarketAssetId,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";

import {
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import {
  decodeSeaportOrder,
  type SeaportOrderJson
} from "@/lib/marketplace/seaportWire";
import { seaportOrderHash } from "@/lib/marketplace/seaport";
import type { OwnOrderPolicy } from "@/lib/marketplace/orderPolicy";
import { parseOpenSeaOrderPolicy } from "@/lib/marketplace/openseaOrderPolicy";
import { type OpenSeaChain } from "@/lib/marketplace/openseaRegistry";

import { createMarketRequest } from "@/lib/marketplace/http";
import { MarketApiError } from "@/lib/marketplace/marketApiError";
import {
  address,
  array,
  boolean,
  decimal,
  enumeration,
  hex,
  integer,
  pageToken,
  record,
  string,
  version
} from "@/lib/marketplace/validation";
export {
  parseMarketAssetId,
  parseMarketOrder,
  type MarketAssetId,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";
export { MarketApiError } from "@/lib/marketplace/marketApiError";

export type MarketAsset = {
  asset: MarketAssetId;
  lifecycle: number;
  owner: Address;
  hidden: boolean;
  burned: boolean;
  sourceStatus: "available" | "unavailable" | "syncing";
  availability: MarketChainAvailability;
  listingState: MarketListingState;
  offerAvailability: MarketDiscoveryCoverage;
  updatedAt: string;
  listings: MarketOrder[];
  offers: MarketOrder[];
};

export const walletOrderViews = [
  "listings",
  "offers-made",
  "offers-received",
  "history"
] as const;
export type WalletOrderView = (typeof walletOrderViews)[number];
export type WalletOrdersRequest = {
  wallet: Address;
  view: WalletOrderView;
  chain: MarketplaceChain | "all";
  cursor?: string;
  snapshot?: string;
};
export type WalletOrderItem = {
  order: MarketOrder;
  currentAsset: {
    owner: Address;
    lifecycle: number;
    hidden: boolean;
    burned: boolean;
  };
};
export type WalletOrdersPage = {
  wallet: Address;
  view: WalletOrderView;
  chain: MarketplaceChain | "all";
  snapshot: { id: string; observedAt: string };
  sources: Partial<
    Record<MarketplaceChain, "available" | "unavailable" | "syncing">
  >;
  items: WalletOrderItem[];
  nextCursor: string | null;
};

export function marketOrderKey(order: MarketOrder) {
  return `${order.asset.chainId}:${order.protocolAddress.toLowerCase()}:${order.orderHash.toLowerCase()}`;
}

export type MarketActions = {
  read: boolean;
  buy: boolean;
  createListing: boolean;
  createOffer: boolean;
  acceptOffer: boolean;
  cancel: boolean;
};

export type MarketCapabilities = Partial<
  Record<MarketplaceChain, MarketActions>
>;

export type BnbFulfillmentQuote = {
  id: string;
  asset: MarketAssetId;
  lifecycle: number;
  actor: Address;
  orderHash: Hex;
  expiresAt: string;
  order: SeaportOrderJson;
  signature: Hex;
};

export type PreparedOrder = {
  id: string;
  asset: MarketAssetId;
  lifecycle: number;
  orderHash: Hex;
  expiresAt: string;
  order: SeaportOrderJson;
  policyVersion?: string;
};

export function parsePreparedOrder(value: unknown): PreparedOrder {
  const data = version(value);
  const asset = parseMarketAssetId(data.asset);
  if (data.source !== marketplaceChains[asset.chain].source)
    throw new Error("Unsupported order preparation source.");
  decodeSeaportOrder(data.order);
  return {
    id: string(data.id),
    asset,
    lifecycle: integer(data.lifecycle),
    orderHash: hex(data.orderHash, 32),
    expiresAt: decimal(data.expiresAt),
    order: data.order as SeaportOrderJson,
    ...(asset.chain !== "bnb"
      ? { policyVersion: string(data.policyVersion, 128) }
      : {})
  };
}

export function parsePublishedOrder(value: unknown): MarketOrder {
  const data = version(value);
  if (data.persisted !== true)
    throw new Error("The marketplace has not confirmed durable order storage.");
  const order = parseMarketOrder(data.order);
  if (order.source === "opensea" && data.providerAccepted !== true)
    throw new Error("OpenSea has not confirmed acceptance of this order.");
  return order;
}

export function parseCancellationOrder(value: unknown, reviewed: MarketOrder) {
  const data = version(value);
  const order = decodeSeaportOrder(data.order);
  const nftSide =
    reviewed.side === "listing" ? order.offer : order.consideration;
  const nfts = [...order.offer, ...order.consideration].filter(
    (item) => item.itemType >= 2
  );
  const nft = nfts[0];
  if (
    integer(data.chainId) !== reviewed.asset.chainId ||
    address(data.protocolAddress) !== getAddress(reviewed.protocolAddress) ||
    hex(data.orderHash, 32) !== reviewed.orderHash.toLowerCase() ||
    seaportOrderHash(order).toLowerCase() !==
      reviewed.orderHash.toLowerCase() ||
    getAddress(order.offerer) !== getAddress(reviewed.maker) ||
    nfts.length !== 1 ||
    !nft ||
    !nftSide.includes(nft) ||
    nft.itemType !== 2 ||
    getAddress(nft.token) !== getAddress(reviewed.asset.contractAddress) ||
    nft.identifierOrCriteria.toString() !== reviewed.asset.tokenId ||
    nft.startAmount !== 1n ||
    nft.endAmount !== 1n
  )
    throw new Error(
      "Cancellation parameters do not match your reviewed order."
    );
  return order;
}

export function parseWalletOrdersRequest(
  value: WalletOrdersRequest
): WalletOrdersRequest {
  const wallet = address(value.wallet);
  if (wallet === zeroAddress)
    throw new Error("Choose a wallet to view its orders.");
  if ((value.cursor === undefined) !== (value.snapshot === undefined))
    throw new Error("Order history needs both its cursor and snapshot.");
  return {
    wallet,
    view: enumeration(value.view, walletOrderViews),
    chain: enumeration(value.chain, [
      "all",
      "ethereum",
      "base",
      "polygon",
      "bnb"
    ]),
    ...(value.cursor === undefined
      ? {}
      : {
          cursor: pageToken(value.cursor),
          snapshot: pageToken(value.snapshot)
        })
  };
}

export function parseWalletOrdersPage(
  value: unknown,
  expected: WalletOrdersRequest
): WalletOrdersPage {
  const query = parseWalletOrdersRequest(expected);
  const data = version(value);
  const wallet = address(data.wallet);
  const view = enumeration(data.view, walletOrderViews);
  const chain = enumeration(data.chain, [
    "all",
    "ethereum",
    "base",
    "polygon",
    "bnb"
  ]);
  const rawSnapshot = record(data.snapshot);
  const snapshot = {
    id: pageToken(rawSnapshot.id),
    observedAt: string(rawSnapshot.observedAt, 40)
  };
  if (
    wallet !== query.wallet ||
    view !== query.view ||
    chain !== query.chain ||
    (query.snapshot !== undefined && snapshot.id !== query.snapshot) ||
    !Number.isFinite(Date.parse(snapshot.observedAt))
  )
    throw new Error(
      "Order history changed or does not match this wallet. Refresh the view."
    );
  const rawSources = record(data.sources);
  const sources: WalletOrdersPage["sources"] = {};
  for (const name of Object.keys(marketplaceChains) as MarketplaceChain[]) {
    if (chain === "all" || name === chain)
      sources[name] = enumeration(rawSources[name], [
        "available",
        "unavailable",
        "syncing"
      ]);
  }
  const keys = new Set<string>();
  const items = array(
    data.items,
    (value): WalletOrderItem => {
      const item = record(value);
      const order = parseMarketOrder(item.order);
      const rawAsset = record(item.currentAsset);
      const currentAsset = {
        owner: address(rawAsset.owner),
        lifecycle: integer(rawAsset.lifecycle),
        hidden: boolean(rawAsset.hidden),
        burned: boolean(rawAsset.burned)
      };
      const own = order.maker === wallet;
      const open = order.status === "active" || order.status === "unavailable";
      const matches =
        view === "listings"
          ? own && open && order.side === "listing"
          : view === "offers-made"
            ? own && open && order.side === "offer"
            : view === "offers-received"
              ? !own &&
                open &&
                order.side === "offer" &&
                currentAsset.owner === wallet &&
                !currentAsset.burned
              : own && !open;
      const key = marketOrderKey(order);
      if (
        !matches ||
        (chain !== "all" && order.asset.chain !== chain) ||
        keys.has(key)
      )
        throw new Error(
          "Order history contains an unexpected or duplicate order."
        );
      keys.add(key);
      return { order, currentAsset };
    },
    25
  );
  const nextCursor =
    data.nextCursor === null ? null : pageToken(data.nextCursor);
  if (nextCursor && (items.length === 0 || nextCursor === query.cursor))
    throw new Error(
      "Order-history pagination did not advance. Refresh the view."
    );
  return { wallet, view, chain, snapshot, sources, items, nextCursor };
}

export function parseMarketCapabilities(value: unknown): MarketCapabilities {
  const data = record(version(value).chains);
  const result: MarketCapabilities = {};
  for (const chain of Object.keys(marketplaceChains) as MarketplaceChain[]) {
    if (!Object.hasOwn(data, chain)) continue;
    const flags = record(data[chain]);
    result[chain] = {
      read: boolean(flags.read),
      buy: boolean(flags.buy),
      createListing: boolean(flags.createListing),
      createOffer: boolean(flags.createOffer),
      acceptOffer: boolean(flags.acceptOffer),
      cancel: boolean(flags.cancel)
    };
  }
  return result;
}

export function parseMarketAsset(
  value: unknown,
  expected: MarketAssetId
): MarketAsset {
  const data = version(value, 2);
  const asset = parseMarketAssetId(data.asset);
  if (marketplaceAssetKey(asset) !== marketplaceAssetKey(expected))
    throw new Error("Marketplace returned a different NFT.");
  const listings = array(data.listings, parseMarketOrder);
  const offers = array(data.offers, parseMarketOrder);
  for (const [side, orders] of [
    ["listing", listings],
    ["offer", offers]
  ] as const) {
    if (
      orders.some(
        (order) =>
          order.side !== side ||
          marketplaceAssetKey(order.asset) !== marketplaceAssetKey(asset)
      )
    )
      throw new Error(
        "Marketplace returned orders for a different NFT or side."
      );
  }
  const updatedAt = string(data.updatedAt, 40);
  if (!Number.isFinite(Date.parse(updatedAt)))
    throw new Error("Invalid marketplace observation time.");
  const rawAvailability = record(data.availability);
  const parseCoverage = (value: unknown) => {
    const coverage = record(value);
    const completedAt =
      coverage.completedAt === null ? null : string(coverage.completedAt, 40);
    if (completedAt !== null && !Number.isFinite(Date.parse(completedAt)))
      throw new Error("Invalid marketplace coverage time.");
    return {
      status: enumeration(coverage.status, [
        "complete",
        "partial",
        "unavailable"
      ]),
      completedAt,
      revision:
        coverage.revision === null ? null : string(coverage.revision, 128)
    };
  };
  const availability: MarketChainAvailability = {
    chain: enumeration(rawAvailability.chain, [
      "ethereum",
      "base",
      "polygon",
      "bnb"
    ]),
    evidence: enumeration(rawAvailability.evidence, [
      "current",
      "recovering",
      "unavailable"
    ]),
    listings: parseCoverage(rawAvailability.listings),
    offers: parseCoverage(rawAvailability.offers)
  };
  if (availability.chain !== asset.chain)
    throw new Error("Marketplace availability belongs to another chain.");
  return {
    asset,
    lifecycle: integer(data.lifecycle),
    owner: address(data.owner),
    hidden: boolean(data.hidden),
    burned: boolean(data.burned),
    sourceStatus: enumeration(data.sourceStatus, [
      "available",
      "unavailable",
      "syncing"
    ]),
    availability,
    listingState: enumeration(data.listingState, [
      "listed",
      "unlisted",
      "updating",
      "unavailable"
    ]),
    offerAvailability: enumeration(data.offerAvailability, [
      "complete",
      "partial",
      "unavailable"
    ]),
    updatedAt,
    listings,
    offers
  };
}

export function parseBnbFulfillmentQuote(value: unknown): BnbFulfillmentQuote {
  const data = version(value);
  const asset = parseMarketAssetId(data.asset);
  if (asset.chain !== "bnb" || data.source !== "yunipals")
    throw new Error("This quote requires a different settlement adapter.");
  // Validate the entire order before returning its JSON representation.
  decodeSeaportOrder(data.order);
  return {
    id: string(data.id),
    asset,
    lifecycle: integer(data.lifecycle),
    actor: address(data.actor),
    orderHash: hex(data.orderHash, 32),
    expiresAt: decimal(data.expiresAt),
    order: data.order as SeaportOrderJson,
    signature: data.signature === "0x" ? "0x" : hex(data.signature)
  };
}

export function parseBnbPreflight(
  value: unknown,
  order: MarketOrder,
  actor: Address,
  now = BigInt(Math.floor(Date.now() / 1000))
) {
  const data = version(value);
  const asset = parseMarketAssetId(data.asset);
  const expiresAt = BigInt(decimal(data.expiresAt));
  const needsNftApproval = boolean(data.needsNftApproval);
  if (
    data.source !== "yunipals" ||
    asset.chain !== "bnb" ||
    marketplaceAssetKey(asset) !== marketplaceAssetKey(order.asset) ||
    address(data.actor) !== getAddress(actor) ||
    integer(data.lifecycle) !== order.lifecycle ||
    address(data.protocolAddress) !== getAddress(order.protocolAddress) ||
    hex(data.orderHash, 32).toLowerCase() !== order.orderHash.toLowerCase() ||
    expiresAt <= now ||
    expiresAt > now + 60n ||
    (needsNftApproval && order.side !== "offer")
  )
    throw new Error(
      "The order preflight changed or expired. Refresh the order."
    );
  return { needsNftApproval };
}

export function createMarketClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  const request = createMarketRequest(baseUrl, fetcher);
  async function openSeaTradeData(
    action: "preflight" | "fulfillment" | "prepare",
    order: MarketOrder,
    actor: Address,
    signal?: AbortSignal
  ): Promise<OpenSeaFulfillmentQuote & { simulated: boolean }> {
    const reviewed = parseMarketOrder(order);
    if (reviewed.source !== "opensea")
      throw new Error("This order does not use OpenSea fulfillment.");
    const data = version(
      await request(
        `/v1/market/orders/${reviewed.asset.chain}/${reviewed.protocolAddress}/${reviewed.orderHash}/${action}`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({
            actor: getAddress(actor),
            lifecycle: reviewed.lifecycle
          })
        }
      )
    );
    if (
      data.source !== "opensea" ||
      data.purpose !== action ||
      (action === "prepare"
        ? typeof data.simulated !== "boolean"
        : data.simulated !== (action === "fulfillment"))
    )
      throw new Error("Unexpected fulfillment provider.");
    return {
      id: string(data.id),
      asset: parseMarketAssetId(data.asset),
      lifecycle: integer(data.lifecycle),
      actor: address(data.actor),
      orderHash: hex(data.orderHash, 32),
      expiresAt: decimal(data.expiresAt),
      fulfillment: record(data.fulfillment),
      simulated: data.simulated as boolean
    };
  }
  return {
    async walletOrders(input: WalletOrdersRequest, signal?: AbortSignal) {
      const query = parseWalletOrdersRequest(input);
      const params = new URLSearchParams({
        view: query.view,
        chain: query.chain,
        limit: "25"
      });
      if (query.cursor && query.snapshot) {
        params.set("cursor", query.cursor);
        params.set("snapshot", query.snapshot);
      }
      return parseWalletOrdersPage(
        await request(`/v1/market/wallets/${query.wallet}/orders?${params}`, {
          signal
        }),
        query
      );
    },
    async capabilities(signal?: AbortSignal) {
      return parseMarketCapabilities(
        await request("/v1/market/capabilities", { signal })
      );
    },
    async asset(asset: MarketAssetId, signal?: AbortSignal) {
      const id = parseMarketAssetId(asset);
      return parseMarketAsset(
        await request(
          `/v2/market/assets/${id.chain}/${id.contractAddress}/${id.tokenId}`,
          { signal }
        ),
        id
      );
    },
    async fulfillment(
      order: MarketOrder,
      actor: Address,
      signal?: AbortSignal
    ) {
      return parseBnbFulfillmentQuote(
        await request(
          `/v1/market/orders/${order.asset.chain}/${order.protocolAddress}/${order.orderHash}/fulfillment`,
          {
            method: "POST",
            signal,
            body: JSON.stringify({
              actor: getAddress(actor),
              lifecycle: order.lifecycle
            })
          }
        )
      );
    },
    async bnbPreflight(
      order: MarketOrder,
      actor: Address,
      signal?: AbortSignal
    ) {
      const reviewed = parseMarketOrder(order);
      if (reviewed.asset.chain !== "bnb" || reviewed.source !== "yunipals")
        throw new Error("This preflight requires the BNB adapter.");
      return parseBnbPreflight(
        await request(
          `/v1/market/orders/bnb/${reviewed.protocolAddress}/${reviewed.orderHash}/preflight`,
          {
            method: "POST",
            signal,
            body: JSON.stringify({
              actor: getAddress(actor),
              lifecycle: reviewed.lifecycle
            })
          }
        ),
        reviewed,
        actor
      );
    },
    openSeaPrepare(order: MarketOrder, actor: Address, signal?: AbortSignal) {
      return openSeaTradeData("prepare", order, actor, signal);
    },
    openSeaPreflight(order: MarketOrder, actor: Address, signal?: AbortSignal) {
      return openSeaTradeData("preflight", order, actor, signal);
    },
    openSeaFulfillment(
      order: MarketOrder,
      actor: Address,
      signal?: AbortSignal
    ) {
      return openSeaTradeData("fulfillment", order, actor, signal);
    },
    async prepareOwnOrder(
      input: {
        asset: MarketAssetId;
        lifecycle: number;
        order: SeaportOrderJson;
        policyVersion?: string;
      },
      signal?: AbortSignal
    ) {
      return parsePreparedOrder(
        await request("/v1/market/orders/prepare", {
          method: "POST",
          signal,
          body: JSON.stringify(input)
        })
      );
    },
    async cancellationOrder(
      order: MarketOrder,
      actor: Address,
      signal?: AbortSignal
    ) {
      const reviewed = parseMarketOrder(order);
      return parseCancellationOrder(
        await request(
          `/v1/market/orders/${reviewed.asset.chain}/${reviewed.protocolAddress}/${reviewed.orderHash}/cancellation`,
          {
            method: "POST",
            signal,
            body: JSON.stringify({ actor: getAddress(actor) })
          }
        ),
        reviewed
      );
    },
    async publishOwnOrder(
      input: {
        preparationId: string;
        asset: MarketAssetId;
        lifecycle: number;
        order: SeaportOrderJson;
        signature: Hex;
        policyVersion?: string;
      },
      signal?: AbortSignal
    ) {
      return parsePublishedOrder(
        await request("/v1/market/orders", {
          method: "POST",
          signal,
          body: JSON.stringify(input)
        })
      );
    },
    async publishedOwnOrder(
      orderHash: Hex,
      signal?: AbortSignal,
      chain: MarketplaceChain = "bnb"
    ) {
      const hashValue = hex(orderHash, 32);
      try {
        return parsePublishedOrder(
          await request(
            `/v1/market/orders/${chain}/${seaportDeployment.address}/${hashValue}`,
            { signal }
          )
        );
      } catch (error) {
        if (error instanceof MarketApiError && error.status === 404)
          return null;
        throw error;
      }
    },
    async openSeaPolicy(chain: OpenSeaChain, signal?: AbortSignal) {
      return parseOpenSeaOrderPolicy(
        await request(`/v1/market/policies/${chain}`, { signal }),
        chain
      );
    },
    async bnbPolicy(signal?: AbortSignal): Promise<OwnOrderPolicy> {
      const data = version(
        await request("/v1/market/policies/bnb", { signal })
      );
      return {
        collection: address(data.collection),
        offerCurrency: address(data.offerCurrency),
        maxDurationSeconds: BigInt(decimal(data.maxDurationSeconds)),
        fees: array(
          data.fees,
          (value) => {
            const fee = record(value);
            return {
              recipient: address(fee.recipient),
              basisPoints: integer(fee.basisPoints, 9999)
            };
          },
          31
        )
      };
    },
    async bnbDiscoveryStatus(signal?: AbortSignal) {
      let response: unknown;
      try {
        response = await request("/v1/market/bnb/discovered-orders?limit=1", {
          signal
        });
      } catch (error) {
        // Older APIs return 503 for every unknown marketplace route. Confirm
        // they lack discovery before retaining the signed-order path; a 503
        // from a discovery-capable API must fail closed.
        if (error instanceof MarketApiError && error.status === 404)
          return { mode: "preview" as const, coverage: "partial" as const };
        if (error instanceof MarketApiError && error.status === 503) {
          const capabilities = version(
            await request("/v1/market/capabilities", { signal })
          );
          if (capabilities.bnbDiscovery !== true)
            return { mode: "preview" as const, coverage: "partial" as const };
        }
        throw error;
      }
      const data = version(response);
      return {
        mode: enumeration(data.mode, ["preview", "live"]),
        coverage: enumeration(data.coverage, ["complete", "partial"])
      };
    }
  };
}
