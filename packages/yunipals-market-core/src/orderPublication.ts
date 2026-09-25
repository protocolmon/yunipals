import { getAddress, type Address, type Hex } from "viem";

import type { MarketAssetId, MarketOrder } from "./marketOrder";
import { marketplaceAssetKey } from "./registry";
import type { SeaportOrderComponents } from "./seaport";

export type OrderDraft = {
  asset: MarketAssetId;
  lifecycle: number;
  maker: Address;
  side: "listing" | "offer";
  grossAmount: bigint;
  endTime: bigint;
};

export type PublicationIntent = {
  asset: MarketAssetId;
  lifecycle: number;
  order: SeaportOrderComponents;
  orderHash: Hex;
  summary: MarketOrder;
  policyVersion?: string;
};

export function assertOrderPublication(
  intent: PublicationIntent,
  published: MarketOrder
) {
  const expected = intent.summary;
  if (
    marketplaceAssetKey(published.asset) !==
      marketplaceAssetKey(intent.asset) ||
    published.lifecycle !== intent.lifecycle ||
    published.orderHash.toLowerCase() !== intent.orderHash.toLowerCase() ||
    getAddress(published.protocolAddress) !==
      getAddress(expected.protocolAddress) ||
    published.source !== expected.source ||
    published.side !== expected.side ||
    getAddress(published.maker) !== getAddress(expected.maker) ||
    getAddress(published.currency.address) !==
      getAddress(expected.currency.address) ||
    published.currency.symbol !== expected.currency.symbol ||
    published.currency.decimals !== expected.currency.decimals ||
    published.grossAmount !== expected.grossAmount ||
    published.sellerProceeds !== expected.sellerProceeds ||
    published.startTime !== expected.startTime ||
    published.endTime !== expected.endTime ||
    published.fees.length !== expected.fees.length ||
    published.fees.some(
      (fee, i) =>
        getAddress(fee.recipient) !== getAddress(expected.fees[i]!.recipient) ||
        fee.amount !== expected.fees[i]!.amount
    )
  )
    throw new Error(
      "The marketplace did not confirm the exact order you signed."
    );
}
