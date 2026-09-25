import {
  type OrderDraft,
  type PublicationIntent
} from "@protopals/yunipals-market-core/orderPublication";
export {
  assertOrderPublication,
  type OrderDraft,
  type PublicationIntent
} from "@protopals/yunipals-market-core/orderPublication";
import { getAddress, parseUnits } from "viem";

import {
  parseMarketAssetId,
  type PreparedOrder
} from "@/lib/marketplace/marketApi";
import {
  assertOrderActiveAt,
  calculateOrderFees,
  validateOwnSeaportOrder,
  type OwnOrderPolicy
} from "@/lib/marketplace/orderPolicy";
import {
  bnbOfferCurrency,
  marketplaceAssetKey,
  marketplaceChains,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  assertSeaportSigningIntent,
  createItemOffer,
  createNativeListing,
  seaportOrderHash,
  seaportSigningData,
  type SeaportOrderComponents
} from "@/lib/marketplace/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@/lib/marketplace/seaportWire";

export function parseOrderPrice(value: string) {
  const amount = value.trim();
  if (
    amount.length > 80 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(amount)
  )
    throw new Error("Enter a price such as 0.1, with up to 18 decimal places.");
  const price = parseUnits(amount, 18);
  if (price <= 0n || price >= 2n ** 256n)
    throw new Error("Enter a positive price within the supported range.");
  return price;
}

/** User-controlled price/expiry and reviewed fees are fixed before preparation. */
export function createBnbPublicationIntent(
  draft: OrderDraft,
  policy: OwnOrderPolicy,
  chainState: { timestamp: bigint; counter: bigint },
  salt: bigint
): PublicationIntent {
  const asset = parseMarketAssetId(draft.asset);
  if (
    asset.chain !== "bnb" ||
    getAddress(policy.collection) !==
      getAddress(marketplaceChains.bnb.contractAddress) ||
    getAddress(policy.offerCurrency) !== getAddress(bnbOfferCurrency.address)
  )
    throw new Error("Unsupported BNB order configuration.");
  if (!Number.isSafeInteger(draft.lifecycle) || draft.lifecycle < 0)
    throw new Error("Invalid NFT lifecycle.");
  if (draft.side !== "listing" && draft.side !== "offer")
    throw new Error("Unsupported order side.");
  const input = {
    collection: asset.contractAddress,
    tokenId: BigInt(asset.tokenId),
    totalPrice: draft.grossAmount,
    startTime: chainState.timestamp,
    endTime: draft.endTime,
    counter: chainState.counter,
    salt,
    fees: calculateOrderFees(draft.grossAmount, policy.fees)
  };
  const order =
    draft.side === "listing"
      ? createNativeListing({ ...input, seller: draft.maker })
      : createItemOffer({
          ...input,
          buyer: draft.maker,
          paymentToken: bnbOfferCurrency.address
        });
  const checked = validateOwnSeaportOrder(order, policy);
  assertOrderActiveAt(order, chainState.timestamp);
  const orderHash = seaportOrderHash(order);
  return {
    asset,
    lifecycle: draft.lifecycle,
    order,
    orderHash,
    summary: {
      asset,
      lifecycle: draft.lifecycle,
      orderHash,
      protocolAddress: seaportDeployment.address,
      source: "yunipals",
      side: checked.side,
      maker: checked.maker,
      currency: {
        address: checked.currency,
        symbol: checked.side === "listing" ? "BNB" : "WBNB",
        decimals: 18
      },
      grossAmount: checked.grossAmount.toString(),
      sellerProceeds: checked.sellerProceeds.toString(),
      fees: checked.fees.map((fee) => ({
        ...fee,
        amount: fee.amount.toString()
      })),
      startTime: order.startTime.toString(),
      endTime: order.endTime.toString(),
      // A prepared or merely signed order is never advertised as published.
      status: "unavailable"
    }
  };
}

export function orderSigningData(intent: PublicationIntent) {
  return seaportSigningData(
    {
      name: seaportDeployment.name,
      version: seaportDeployment.version,
      chainId: intent.asset.chainId,
      verifyingContract: seaportDeployment.address
    },
    intent.order
  );
}

export function assertOrderPreparation(
  intent: PublicationIntent,
  prepared: PreparedOrder,
  now: bigint
) {
  if (
    marketplaceAssetKey(prepared.asset) !== marketplaceAssetKey(intent.asset) ||
    prepared.lifecycle !== intent.lifecycle ||
    prepared.orderHash.toLowerCase() !== intent.orderHash.toLowerCase() ||
    prepared.policyVersion !== intent.policyVersion
  )
    throw new Error("The prepared order does not match your reviewed NFT.");
  assertSeaportSigningIntent(
    orderSigningData(intent),
    orderSigningData({ ...intent, order: decodeSeaportOrder(prepared.order) })
  );
  const expiry = BigInt(prepared.expiresAt);
  if (expiry <= now || expiry > now + 120n)
    throw new Error("Order preparation expired. Review it again.");
  assertOrderActiveAt(intent.order, now);
}

export function publicationRequest(intent: PublicationIntent) {
  return {
    asset: intent.asset,
    lifecycle: intent.lifecycle,
    order: encodeSeaportOrder(intent.order),
    ...(intent.policyVersion ? { policyVersion: intent.policyVersion } : {})
  };
}
