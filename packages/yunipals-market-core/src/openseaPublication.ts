import { getAddress, zeroAddress, type Address } from "viem";

import { parseMarketAssetId } from "./marketOrder";
import {
  assertOpenSeaPolicyCurrent,
  type OpenSeaOrderPolicy
} from "./openseaOrderPolicy";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openseaConduit
} from "./openseaRegistry";
import { assertOrderActiveAt, calculateOrderFees } from "./orderPolicy";
import {
  assertOrderPublication,
  type OrderDraft,
  type PublicationIntent
} from "./orderPublication";
import { seaportDeployment } from "./registry";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash
} from "./seaport";

/** Local price/expiry/fees are fixed before the server prepares a signature. */
export function createOpenSeaPublicationIntent(
  draft: OrderDraft & { currency: Address },
  policy: OpenSeaOrderPolicy,
  chainState: { timestamp: bigint; counter: bigint },
  salt: bigint
): PublicationIntent {
  const asset = parseMarketAssetId(draft.asset);
  if (
    !isOpenSeaChain(asset.chain) ||
    policy.chain !== asset.chain ||
    getAddress(asset.contractAddress) !== getAddress(policy.collection) ||
    !Number.isSafeInteger(draft.lifecycle) ||
    draft.lifecycle < 0 ||
    !["listing", "offer"].includes(draft.side)
  )
    throw new Error("Unsupported OpenSea signing identity.");
  assertOpenSeaPolicyCurrent(policy, chainState.timestamp);
  if (
    draft.endTime <= chainState.timestamp ||
    draft.endTime - chainState.timestamp > policy.maxDurationSeconds
  )
    throw new Error("Choose an expiry within the current collection policy.");
  const currency = openSeaCurrency(asset.chain, draft.currency);
  const listing = draft.side === "listing";
  if (
    listing
      ? !policy.listingCurrencies.some(
          (token) => getAddress(token) === getAddress(currency.address)
        )
      : getAddress(currency.address) !== getAddress(policy.offerCurrency)
  )
    throw new Error("The selected currency is not accepted for this order.");
  const fees = calculateOrderFees(draft.grossAmount, policy.fees);
  const common = {
    collection: asset.contractAddress,
    tokenId: BigInt(asset.tokenId),
    totalPrice: draft.grossAmount,
    startTime: chainState.timestamp,
    endTime: draft.endTime,
    counter: chainState.counter,
    salt,
    fees
  };
  const base = listing
    ? createNativeListing({ ...common, seller: draft.maker })
    : createItemOffer({
        ...common,
        buyer: draft.maker,
        paymentToken: currency.address
      });
  const zone = listing ? policy.listingZone : policy.offerZone;
  const order = {
    ...base,
    zone,
    orderType: getAddress(zone) === zeroAddress ? 0 : 2,
    conduitKey: openseaConduit.key,
    consideration: base.consideration.map((item) =>
      listing
        ? {
            ...item,
            token: currency.address,
            itemType: currency.address === zeroAddress ? 0 : 1
          }
        : item
    )
  };
  assertOrderActiveAt(order, chainState.timestamp);
  const orderHash = seaportOrderHash(order);
  return {
    asset,
    lifecycle: draft.lifecycle,
    order,
    orderHash,
    policyVersion: policy.version,
    summary: {
      asset,
      lifecycle: draft.lifecycle,
      orderHash,
      protocolAddress: seaportDeployment.address,
      source: "opensea",
      side: draft.side,
      maker: getAddress(draft.maker),
      currency: {
        address: currency.address,
        symbol: currency.symbol,
        decimals: currency.decimals
      },
      grossAmount: draft.grossAmount.toString(),
      sellerProceeds: (
        draft.grossAmount - fees.reduce((sum, item) => sum + item.amount, 0n)
      ).toString(),
      fees: fees.map((item) => ({ ...item, amount: item.amount.toString() })),
      startTime: order.startTime.toString(),
      endTime: order.endTime.toString(),
      status: "unavailable"
    }
  };
}

/** Changed fee, currency or zone policy requires a new explicit review. */
export function assertOpenSeaCreationPolicy(
  intent: PublicationIntent,
  policy: OpenSeaOrderPolicy,
  now: bigint
) {
  assertOpenSeaPolicyCurrent(policy, now);
  if (intent.policyVersion !== policy.version)
    throw new Error("The order policy changed. Review the order again.");
  const expected = createOpenSeaPublicationIntent(
    {
      asset: intent.asset,
      lifecycle: intent.lifecycle,
      maker: intent.order.offerer,
      side: intent.summary.side,
      currency: intent.summary.currency.address,
      grossAmount: BigInt(intent.summary.grossAmount),
      endTime: intent.order.endTime
    },
    // Check freshness against the current block above, then rebuild the exact
    // original start/counter/salt without extending the signed period.
    { ...policy, expiresAt: intent.order.startTime + 120n },
    { timestamp: intent.order.startTime, counter: intent.order.counter },
    intent.order.salt
  );
  if (
    expected.orderHash.toLowerCase() !== intent.orderHash.toLowerCase() ||
    seaportOrderHash(intent.order).toLowerCase() !==
      intent.orderHash.toLowerCase()
  )
    throw new Error("The current collection policy changes your signed order.");
  assertOrderPublication(expected, intent.summary);
}
