import {
  getAddress,
  maxUint256,
  zeroAddress,
  zeroHash,
  type Address
} from "viem";

import type {
  SeaportConsiderationItem,
  SeaportOfferItem,
  SeaportOrderComponents
} from "./seaport";

export type OrderFeePolicy = readonly {
  recipient: Address;
  basisPoints: number;
}[];

export type OwnOrderPolicy = {
  collection: Address;
  offerCurrency: Address;
  fees: OrderFeePolicy;
  maxDurationSeconds: bigint;
};

export type OwnOrderSummary = {
  side: "listing" | "offer";
  maker: Address;
  collection: Address;
  tokenId: bigint;
  currency: Address;
  grossAmount: bigint;
  sellerProceeds: bigint;
  fees: { recipient: Address; amount: bigint }[];
};

function integer(value: bigint) {
  if (typeof value !== "bigint" || value < 0n || value > maxUint256) {
    throw new Error("Order values must be uint256 integers.");
  }
  return value;
}

function nonzero(value: Address) {
  const normalized = getAddress(value);
  if (normalized === zeroAddress)
    throw new Error("Order address cannot be zero.");
  return normalized;
}

/** Integer fee rounding is always down; amounts remain in token base units. */
export function calculateOrderFees(
  grossAmount: bigint,
  policy: OrderFeePolicy
) {
  if (integer(grossAmount) === 0n)
    throw new Error("Order price must be positive.");
  if (policy.length > 31) throw new Error("Too many fee recipients.");
  let totalBasisPoints = 0;
  const recipients = new Set<string>();
  const fees = policy.map(({ recipient, basisPoints }) => {
    if (
      !Number.isInteger(basisPoints) ||
      basisPoints < 0 ||
      basisPoints >= 10_000
    ) {
      throw new Error("Invalid fee basis points.");
    }
    totalBasisPoints += basisPoints;
    const address = nonzero(recipient);
    if (recipients.has(address)) throw new Error("Duplicate fee recipient.");
    recipients.add(address);
    return {
      recipient: address,
      amount: (grossAmount * BigInt(basisPoints)) / 10_000n
    };
  });
  if (totalBasisPoints >= 10_000)
    throw new Error("Fees must leave seller proceeds.");
  return fees.filter((fee) => fee.amount > 0n);
}

function exactItem(
  item: SeaportOfferItem,
  itemType: number,
  token: Address,
  identifier: bigint,
  amount: bigint
) {
  if (
    item.itemType !== itemType ||
    getAddress(item.token) !== getAddress(token) ||
    item.identifierOrCriteria !== identifier ||
    item.startAmount !== amount ||
    item.endAmount !== amount
  )
    throw new Error("Order contains an unsupported asset or amount.");
}

function recipient(item: SeaportConsiderationItem, expected: Address) {
  if (getAddress(item.recipient) !== expected)
    throw new Error("Unexpected payment or NFT recipient.");
}

/**
 * Static admission policy for our own orderbook, not OpenSea's adapter.
 * The caller supplies trusted configuration and must additionally verify the
 * signing domain, signature, prepared intent and fresh chain/indexer state.
 * Owner cancellation remains possible even if an order fails current policy.
 */
export function validateOwnSeaportOrder(
  order: SeaportOrderComponents,
  policy: OwnOrderPolicy
): OwnOrderSummary {
  const maker = nonzero(order.offerer);
  const collection = nonzero(policy.collection);
  const offerCurrency = nonzero(policy.offerCurrency);
  if (integer(policy.maxDurationSeconds) === 0n)
    throw new Error("Invalid order duration policy.");
  const start = integer(order.startTime);
  const end = integer(order.endTime);
  integer(order.salt);
  integer(order.counter);
  if (end <= start || end - start > policy.maxDurationSeconds) {
    throw new Error("Order duration exceeds the supported expiry policy.");
  }
  if (
    order.orderType !== 0 ||
    getAddress(order.zone) !== zeroAddress ||
    order.zoneHash.toLowerCase() !== zeroHash ||
    order.conduitKey.toLowerCase() !== zeroHash
  )
    throw new Error("Only full, open, direct-approval orders are supported.");
  if (
    order.offer.length !== 1 ||
    order.consideration.length < 1 ||
    order.consideration.length > 32
  ) {
    throw new Error("Only one exact NFT and its payments are supported.");
  }
  const offered = order.offer[0];
  const first = order.consideration[0];
  if (!offered || !first) throw new Error("Missing order item.");
  const side = offered.itemType === 2 ? "listing" : "offer";
  const nft = side === "listing" ? offered : first;
  const tokenId = integer(nft.identifierOrCriteria);
  const currency = side === "listing" ? zeroAddress : offerCurrency;
  exactItem(nft, 2, collection, tokenId, 1n);
  const grossAmount = integer(
    side === "listing"
      ? order.consideration.reduce(
          (sum, item) => sum + integer(item.startAmount),
          0n
        )
      : offered.startAmount
  );
  const fees = calculateOrderFees(grossAmount, policy.fees);
  const sellerProceeds =
    grossAmount - fees.reduce((sum, fee) => sum + fee.amount, 0n);
  if (order.consideration.length !== fees.length + 1)
    throw new Error("Order fees do not match policy.");
  recipient(first, maker);
  if (side === "listing") {
    exactItem(first, 0, zeroAddress, 0n, sellerProceeds);
  } else {
    exactItem(offered, 1, offerCurrency, 0n, grossAmount);
  }
  fees.forEach((fee, index) => {
    const item = order.consideration[index + 1];
    if (!item) throw new Error("Missing fee consideration.");
    exactItem(item, side === "listing" ? 0 : 1, currency, 0n, fee.amount);
    recipient(item, fee.recipient);
  });
  return {
    side,
    maker,
    collection,
    tokenId,
    currency,
    grossAmount,
    sellerProceeds,
    fees
  };
}

/** Use a freshly read block timestamp; browser wall-clock time is not sufficient. */
export function assertOrderActiveAt(
  order: SeaportOrderComponents,
  blockTimestamp: bigint
) {
  const now = integer(blockTimestamp);
  if (now < integer(order.startTime) || now >= integer(order.endTime)) {
    throw new Error("Order is not active at the current block timestamp.");
  }
}
