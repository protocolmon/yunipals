import {
  erc721Abi,
  getAddress,
  parseEventLogs,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt
} from "viem";

import { catalogCurrencies } from "./catalogCurrency";
import { parseMarketOrder, type MarketOrder } from "./marketOrder";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";
import { seaportEventAbi } from "./seaportEvents";

export type SaleBlock = { number: bigint; hash: Hex; timestamp: bigint };
export type ObservedMarketSale = {
  eventId: string;
  asset: MarketOrder["asset"];
  orderHash: Hex;
  protocolAddress: Address;
  kind: "listing-filled" | "offer-accepted";
  seller: Address;
  nftRecipient: Address;
  currency: MarketOrder["currency"];
  grossAmount: string;
  sellerProceeds: string;
  fees: MarketOrder["fees"];
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  blockTimestamp: string;
  fulfillmentLogIndex: number;
  transferLogIndex: number;
};

type Payment = { recipient: Address; amount: bigint };
type SaleEconomics = Pick<
  MarketOrder,
  | "asset"
  | "side"
  | "orderHash"
  | "protocolAddress"
  | "maker"
  | "currency"
  | "fees"
  | "grossAmount"
  | "sellerProceeds"
>;
function sameAddress(left: Address, right: Address) {
  return getAddress(left) === getAddress(right);
}
function samePayments(
  actual: readonly Payment[],
  expected: readonly Payment[]
) {
  const totals = (payments: readonly Payment[]) => {
    const result = new Map<Address, bigint>();
    for (const payment of payments) {
      const address = getAddress(payment.recipient);
      result.set(address, (result.get(address) ?? 0n) + payment.amount);
    }
    return result;
  };
  const left = totals(actual),
    right = totals(expected);
  return (
    left.size === right.size &&
    [...left].every(([address, amount]) => right.get(address) === amount)
  );
}

/**
 * Extract one supported sale for a known order from authoritative chain data.
 * The caller must verify RPC chain identity, canonical block hash and finality
 * before publishing it as confirmed. This function does not establish source
 * attribution, current NFT lifecycle, or payer identity from receipt.from.
 */
export function observeMarketSale(
  knownOrder: MarketOrder,
  receipt: TransactionReceipt,
  block: SaleBlock
): ObservedMarketSale {
  const order = parseMarketOrder(knownOrder);
  if (
    block.timestamp < BigInt(order.startTime) ||
    block.timestamp >= BigInt(order.endTime)
  )
    throw new Error("Sale falls outside the known order's signed time range.");
  return observeSaleEconomics(order, receipt, block);
}

/** A collection event was seen, but its economics cannot be separated safely. */
export class UnsupportedCollectionSaleError extends Error {}

function decodeSaleReceipt(receipt: TransactionReceipt) {
  if (receipt.logs.length > 10_000)
    throw new Error("Receipt exceeds sale decoding capacity.");
  return {
    fulfillments: parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: receipt.logs,
      strict: true
    }).filter((log) => sameAddress(log.address, seaportDeployment.address)),
    transfers: parseEventLogs({
      abi: erc721Abi,
      eventName: "Transfer",
      logs: receipt.logs,
      strict: true
    })
  };
}
type DecodedSaleReceipt = ReturnType<typeof decodeSaleReceipt>;

/**
 * Verify a bounded batch against one receipt. Decoded evidence exists only for
 * this synchronous call; it is never cached across receipts or mutations.
 * A null sale is an explicit unsupported-economics exclusion. Missing events,
 * unrelated events and invalid proofs still reject the entire batch.
 */
export function observeCollectionSales(
  chain: MarketplaceChain,
  receipt: TransactionReceipt,
  block: SaleBlock,
  logIndices: readonly number[]
): { logIndex: number; sale: ObservedMarketSale | null }[] {
  if (logIndices.length > 512 || new Set(logIndices).size !== logIndices.length)
    throw new Error("Invalid collection sale batch.");
  const decoded = decodeSaleReceipt(receipt);
  return logIndices.map((logIndex) => {
    try {
      const sale = observeDecodedCollectionSale(
        chain,
        receipt,
        block,
        logIndex,
        decoded
      );
      if (!sale) throw new Error("Collection fulfillment disappeared.");
      return { logIndex, sale };
    } catch (error) {
      if (!(error instanceof UnsupportedCollectionSaleError)) throw error;
      return { logIndex, sale: null };
    }
  });
}

/**
 * Read executed economics directly from a Seaport event, including orders that
 * were never admitted by this app or seen by discovery before settlement.
 * Returns null only when the event has no NFT from this collection. Unsupported
 * collection events throw so a replay cannot silently claim complete coverage.
 * This proves no OpenSea origin, payer identity, or current ownership. The caller
 * must establish chain identity, historical runtime code, canonicality and depth.
 */
export function observeCollectionSale(
  chain: MarketplaceChain,
  receipt: TransactionReceipt,
  block: SaleBlock,
  logIndex: number
): ObservedMarketSale | null {
  return observeDecodedCollectionSale(
    chain,
    receipt,
    block,
    logIndex,
    decodeSaleReceipt(receipt)
  );
}

function observeDecodedCollectionSale(
  chain: MarketplaceChain,
  receipt: TransactionReceipt,
  block: SaleBlock,
  logIndex: number,
  decoded: DecodedSaleReceipt
): ObservedMarketSale | null {
  const config = marketplaceChains[chain];
  if (!config || !Number.isSafeInteger(logIndex) || logIndex < 0)
    throw new Error("Invalid collection sale scope.");
  const { fulfillments } = decoded;
  const events = fulfillments.filter((log) => log.logIndex === logIndex);
  if (events.length !== 1)
    throw new Error("Missing or duplicate Seaport event.");
  const { offerer, recipient, offer, consideration, orderHash } =
    events[0]!.args;
  const isCollectionNft = (item: { itemType: number; token: Address }) =>
    item.itemType >= 2 && sameAddress(item.token, config.contractAddress);
  if (![...offer, ...consideration].some(isCollectionNft)) return null;
  const unsupported = (): never => {
    throw new UnsupportedCollectionSaleError(
      "Collection sale has unsupported or ambiguous economics."
    );
  };
  if (
    offer.length !== 1 ||
    consideration.length === 0 ||
    consideration.length > 16
  )
    unsupported();
  const side = isCollectionNft(offer[0]!) ? "listing" : "offer";
  const nfts = (side === "listing" ? offer : consideration).filter(
    isCollectionNft
  );
  if (nfts.length !== 1 || nfts[0]!.itemType !== 2 || nfts[0]!.amount !== 1n)
    unsupported();
  const nft = nfts[0]!;
  // Matching orders can emit both the bid and a counter-order for one NFT
  // transfer. Each event describes only part of the fee/proceeds allocation;
  // treating either as an independent sale can double-count or misstate it.
  if (
    fulfillments.some(
      (log) =>
        log.logIndex !== logIndex &&
        [...log.args.offer, ...log.args.consideration].some(
          (item) => isCollectionNft(item) && item.identifier === nft.identifier
        )
    )
  )
    unsupported();
  const payments = side === "listing" ? consideration : offer;
  const currency = [
    ...catalogCurrencies(chain),
    ...(chain === "bnb" && side === "offer" ? [bnbOfferCurrency] : [])
  ].find((candidate) => sameAddress(candidate.address, payments[0]!.token));
  if (!currency || (side === "offer" && currency.address === zeroAddress))
    unsupported();
  const seller = side === "listing" ? offerer : recipient;
  const principal =
    side === "listing"
      ? consideration.find((item) => sameAddress(item.recipient, seller))
      : undefined;
  if (side === "listing" && !principal) unsupported();
  const feeItems = consideration.filter((item) =>
    side === "listing" ? item !== principal : item !== nft
  );
  const fees = feeItems.map((item) => ({
    recipient: item.recipient,
    amount: item.amount.toString()
  }));
  const gross =
    side === "listing"
      ? consideration.reduce((sum, item) => sum + item.amount, 0n)
      : offer[0]!.amount;
  const proceeds =
    gross - feeItems.reduce((sum, item) => sum + item.amount, 0n);
  if (proceeds <= 0n) unsupported();
  // Every item/recipient/currency/amount and the actual NFT Transfer are checked
  // by the same receipt verifier as known orders. No synthetic signed order or
  // maker signature is constructed from these execution amounts.
  return observeSaleEconomics(
    {
      asset: {
        chain,
        chainId: config.chainId,
        contractAddress: getAddress(config.contractAddress),
        tokenId: nft.identifier.toString()
      },
      side,
      orderHash,
      protocolAddress: seaportDeployment.address,
      maker: offerer,
      currency: {
        address: getAddress(currency!.address),
        symbol: currency!.symbol,
        decimals: currency!.decimals
      },
      fees,
      grossAmount: gross.toString(),
      sellerProceeds: proceeds.toString()
    },
    receipt,
    block,
    logIndex,
    decoded
  );
}

function observeSaleEconomics(
  order: SaleEconomics,
  receipt: TransactionReceipt,
  block: SaleBlock,
  eventIndex?: number,
  decoded?: DecodedSaleReceipt
): ObservedMarketSale {
  const fail = () => {
    throw new Error(
      "The receipt does not establish this individual marketplace sale."
    );
  };
  if (
    order.orderHash === zeroHash ||
    receipt.status !== "success" ||
    block.hash === zeroHash ||
    block.number < 0n ||
    block.timestamp < 0n ||
    receipt.blockHash.toLowerCase() !== block.hash.toLowerCase() ||
    receipt.blockNumber !== block.number ||
    receipt.transactionHash === zeroHash ||
    receipt.logs.length > 10_000
  )
    fail();

  const currencies = [
    ...catalogCurrencies(order.asset.chain),
    ...(order.asset.chain === "bnb" && order.side === "offer"
      ? [bnbOfferCurrency]
      : [])
  ];
  if (
    !currencies.some(
      (currency) =>
        sameAddress(currency.address, order.currency.address) &&
        currency.symbol === order.currency.symbol &&
        currency.decimals === order.currency.decimals
    )
  )
    fail();
  if (order.side === "offer" && order.currency.address === zeroAddress) fail();

  const evidence = decoded ?? decodeSaleReceipt(receipt);
  const logs = evidence.fulfillments.filter(
    (log) =>
      sameAddress(log.address, seaportDeployment.address) &&
      log.args.orderHash.toLowerCase() === order.orderHash.toLowerCase() &&
      // Historical collection orders can fill several distinct NFTs in one
      // receipt. Known admitted orders still require a unique matching hash.
      (eventIndex === undefined || log.logIndex === eventIndex)
  );
  if (logs.length !== 1) fail();
  const fulfillment = logs[0]!;
  const { offerer, recipient, offer, consideration } = fulfillment.args;
  if (
    !sameAddress(offerer, order.maker) ||
    recipient === zeroAddress ||
    offer.length !== 1 ||
    !consideration.length ||
    consideration.length > 16
  )
    fail();
  const seller = getAddress(order.side === "listing" ? offerer : recipient);
  const nftRecipient = getAddress(
    order.side === "listing" ? recipient : offerer
  );
  if (seller === zeroAddress || nftRecipient === zeroAddress) fail();
  const nft = (item: {
    itemType: number;
    token: Address;
    identifier: bigint;
    amount: bigint;
  }) =>
    item.itemType === 2 &&
    sameAddress(item.token, order.asset.contractAddress) &&
    item.identifier.toString() === order.asset.tokenId &&
    item.amount === 1n;
  const payment = (item: {
    itemType: number;
    token: Address;
    identifier: bigint;
    amount: bigint;
  }) =>
    item.itemType === (order.currency.address === zeroAddress ? 0 : 1) &&
    sameAddress(item.token, order.currency.address) &&
    item.identifier === 0n &&
    item.amount > 0n;
  const fees = order.fees.map((fee) => ({
    recipient: fee.recipient,
    amount: BigInt(fee.amount)
  }));
  const principal = { recipient: seller, amount: BigInt(order.sellerProceeds) };
  if (order.side === "listing") {
    if (
      !nft(offer[0]!) ||
      !consideration.every(payment) ||
      !samePayments(consideration, [principal, ...fees])
    )
      fail();
  } else {
    const receivedNfts = consideration.filter(nft);
    const receivedPayments = consideration.filter(payment);
    if (
      !payment(offer[0]!) ||
      offer[0]!.amount.toString() !== order.grossAmount ||
      receivedNfts.length !== 1 ||
      !sameAddress(receivedNfts[0]!.recipient, nftRecipient) ||
      receivedPayments.length + 1 !== consideration.length ||
      !samePayments(receivedPayments, fees)
    )
      fail();
  }

  const transfers = evidence.transfers.filter(
    (log) =>
      sameAddress(log.address, order.asset.contractAddress) &&
      log.args.tokenId.toString() === order.asset.tokenId &&
      sameAddress(log.args.from, seller) &&
      sameAddress(log.args.to, nftRecipient)
  );
  if (transfers.length !== 1) fail();
  const transfer = transfers[0]!;
  for (const log of [fulfillment, transfer]) {
    if (
      log.removed ||
      log.blockNumber !== block.number ||
      log.blockHash?.toLowerCase() !== block.hash.toLowerCase() ||
      log.transactionHash?.toLowerCase() !==
        receipt.transactionHash.toLowerCase() ||
      log.transactionIndex !== receipt.transactionIndex ||
      log.logIndex === null ||
      !Number.isSafeInteger(log.logIndex) ||
      log.logIndex < 0 ||
      receipt.logs.filter((other) => other.logIndex === log.logIndex).length !==
        1
    )
      fail();
  }
  const fulfillmentLogIndex = fulfillment.logIndex!;
  return {
    eventId: `${order.asset.chainId}:${block.hash.toLowerCase()}:${fulfillmentLogIndex}`,
    asset: order.asset,
    orderHash: order.orderHash,
    protocolAddress: order.protocolAddress,
    kind: order.side === "listing" ? "listing-filled" : "offer-accepted",
    seller,
    nftRecipient,
    currency: order.currency,
    grossAmount: order.grossAmount,
    sellerProceeds: order.sellerProceeds,
    fees: order.fees,
    transactionHash: receipt.transactionHash,
    blockNumber: block.number.toString(),
    blockHash: block.hash,
    blockTimestamp: block.timestamp.toString(),
    fulfillmentLogIndex,
    transferLogIndex: transfer.logIndex!
  };
}
