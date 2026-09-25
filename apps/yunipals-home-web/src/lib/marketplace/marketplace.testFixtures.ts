import {
  encodeAbiParameters,
  encodeEventTopics,
  erc721Abi,
  zeroAddress,
  zeroHash,
  type Hex,
  type Log,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash
} from "@/lib/marketplace/seaport";
import { encodeSeaportOrder } from "@/lib/marketplace/seaportWire";
import { seaportEventAbi } from "@/lib/marketplace/transactionIntent";
import type { OwnOrderPolicy } from "@/lib/marketplace/orderPolicy";
import type {
  BnbFulfillmentQuote,
  MarketOrder
} from "@/lib/marketplace/marketApi";

// Public fixture keys, used only by deterministic tests; never a live signer.
export const testSeller = privateKeyToAccount(
  `0x${"1".padStart(64, "0")}`
).address;
export const testBuyer = privateKeyToAccount(
  `0x${"2".padStart(64, "0")}`
).address;
export const testFeeRecipient = privateKeyToAccount(
  `0x${"3".padStart(64, "0")}`
).address;
export const testHash = `0x${"a".repeat(64)}` as const;
export const testPolicy: OwnOrderPolicy = {
  collection: marketplaceChains.bnb.contractAddress,
  offerCurrency: bnbOfferCurrency.address,
  maxDurationSeconds: 3600n,
  fees: [{ recipient: testFeeRecipient, basisPoints: 250 }]
};

export function marketFixture(
  side: "listing" | "offer" = "listing",
  grossAmount = 10n ** 18n
) {
  const input = {
    seller: testSeller,
    buyer: testBuyer,
    collection: testPolicy.collection,
    tokenId: 123n,
    totalPrice: grossAmount,
    paymentToken: testPolicy.offerCurrency,
    startTime: 100n,
    endTime: 3700n,
    counter: 0n,
    salt: 12345n,
    fees: [{ recipient: testFeeRecipient, amount: grossAmount / 40n }]
  };
  const order =
    side === "listing" ? createNativeListing(input) : createItemOffer(input);
  const summary: MarketOrder = {
    asset: {
      chain: "bnb",
      chainId: 56,
      contractAddress: input.collection,
      tokenId: "123"
    },
    lifecycle: 2,
    orderHash: seaportOrderHash(order),
    protocolAddress: seaportDeployment.address,
    source: "yunipals",
    side,
    maker: order.offerer,
    currency: {
      address: side === "listing" ? zeroAddress : testPolicy.offerCurrency,
      decimals: 18,
      symbol: side === "listing" ? "BNB" : "WBNB"
    },
    grossAmount: input.totalPrice.toString(),
    sellerProceeds: (input.totalPrice - input.fees[0].amount).toString(),
    fees: input.fees.map((fee) => ({ ...fee, amount: fee.amount.toString() })),
    startTime: "100",
    endTime: "3700",
    status: "active"
  };
  const quote: BnbFulfillmentQuote = {
    id: "fixture-quote",
    asset: summary.asset,
    lifecycle: 2,
    actor: side === "listing" ? testBuyer : testSeller,
    orderHash: summary.orderHash,
    expiresAt: "160",
    order: encodeSeaportOrder(order),
    signature: "0x1234"
  };
  return { input, order, summary, quote };
}

export function eventLog(
  partial: Pick<Log, "address" | "data"> & {
    topics: ReturnType<typeof encodeEventTopics>;
  }
): TransactionReceipt["logs"][number] {
  if (
    !partial.topics.length ||
    partial.topics.some((topic) => typeof topic !== "string")
  )
    throw new Error("Fixture logs need concrete topics.");
  return {
    ...partial,
    topics: partial.topics as [Hex, ...Hex[]],
    blockHash: zeroHash,
    blockNumber: 1n,
    transactionHash: testHash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false
  };
}

export function receiptFixture(): TransactionReceipt {
  const { order, summary } = marketFixture();
  const fulfillment = seaportEventAbi.find(
    (item) => item.name === "OrderFulfilled"
  );
  if (!fulfillment) throw new Error("Missing fulfillment event ABI.");
  const logs = [
    eventLog({
      address: seaportDeployment.address,
      topics: encodeEventTopics({
        abi: seaportEventAbi,
        eventName: "OrderFulfilled",
        args: { offerer: testSeller, zone: zeroAddress }
      }),
      data: encodeAbiParameters(
        fulfillment.inputs.filter(
          (input) => !("indexed" in input && input.indexed)
        ),
        [
          summary.orderHash,
          testBuyer,
          order.offer.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifier: item.identifierOrCriteria,
            amount: item.startAmount
          })),
          order.consideration.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifier: item.identifierOrCriteria,
            amount: item.startAmount,
            recipient: item.recipient
          }))
        ]
      )
    }),
    eventLog({
      address: summary.asset.contractAddress,
      topics: encodeEventTopics({
        abi: erc721Abi,
        eventName: "Transfer",
        args: { from: testSeller, to: testBuyer, tokenId: 123n }
      }),
      data: "0x"
    })
  ];
  return {
    transactionHash: testHash,
    transactionIndex: 0,
    blockHash: zeroHash,
    blockNumber: 1n,
    from: testBuyer,
    to: seaportDeployment.address,
    cumulativeGasUsed: 100n,
    gasUsed: 100n,
    contractAddress: null,
    logs,
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    effectiveGasPrice: 1n,
    type: "eip1559"
  };
}
