import { zeroAddress, zeroHash, type Hex } from "viem";

import {
  marketFixture,
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import {
  openseaConduit,
  openseaCurrencies,
  type OpenSeaChain
} from "@/lib/marketplace/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@/lib/marketplace/registry";
import {
  seaportFulfillmentOrder,
  seaportOrderHash
} from "@/lib/marketplace/seaport";
import { encodeSeaportOrder } from "@/lib/marketplace/seaportWire";
import type {
  MarketOrder,
  OpenSeaFulfillmentQuote
} from "@/lib/marketplace/marketApi";

export function openSeaFixture({
  chain = "ethereum",
  side = "listing",
  method = "fulfillAdvancedOrder",
  currency = side === "offer" ? "weth" : "native",
  signature = "0x1234",
  tokenId = "123",
  startTime = 100n,
  endTime = 3700n,
  counter: makerCounter = 0n,
  salt = 12345n,
  expiresAt = 160n,
  grossAmount = 10n ** 18n
}: {
  chain?: OpenSeaChain;
  side?: "listing" | "offer";
  method?:
    | "fulfillOrder"
    | "fulfillAdvancedOrder"
    | "fulfillBasicOrder"
    | "fulfillBasicOrder_efficient_6GL6yc";
  currency?: "native" | "weth";
  signature?: Hex;
  tokenId?: string;
  startTime?: bigint;
  endTime?: bigint;
  counter?: bigint;
  salt?: bigint;
  expiresAt?: bigint;
  grossAmount?: bigint;
} = {}) {
  const fixture = marketFixture(side, grossAmount);
  const asset = {
    ...fixture.summary.asset,
    tokenId,
    chain,
    chainId: marketplaceChains[chain].chainId,
    contractAddress: marketplaceChains[chain].contractAddress
  };
  const payment =
    currency === "native" ? zeroAddress : openseaCurrencies[chain].address;
  const changeItem = <T extends (typeof fixture.order.offer)[number]>(
    item: T
  ): T => ({
    ...item,
    token: item.itemType === 2 ? asset.contractAddress : payment,
    identifierOrCriteria:
      item.itemType === 2 ? BigInt(tokenId) : item.identifierOrCriteria,
    itemType: item.itemType === 2 ? 2 : currency === "native" ? 0 : 1
  });
  const order = {
    ...fixture.order,
    startTime,
    endTime,
    counter: makerCounter,
    salt,
    offer: fixture.order.offer.map(changeItem),
    consideration: fixture.order.consideration.map(changeItem),
    conduitKey: openseaConduit.key
  };
  const reviewed: MarketOrder = {
    ...fixture.summary,
    asset,
    source: "opensea",
    orderHash: seaportOrderHash(order),
    startTime: startTime.toString(),
    endTime: endTime.toString(),
    currency: {
      address: payment,
      decimals: 18,
      symbol:
        currency === "native" ? marketplaceChains[chain].nativeSymbol : "WETH"
    }
  };
  const actor = side === "listing" ? testBuyer : testSeller;
  const signed = encodeSeaportOrder(order);
  const { counter, ...parameters } = signed;
  const full = {
    parameters: {
      ...parameters,
      totalOriginalConsiderationItems: String(parameters.consideration.length)
    },
    signature
  };
  const first = order.consideration[0],
    offered = order.offer[0];
  const basic = {
    considerationToken: first.token,
    considerationIdentifier: first.identifierOrCriteria.toString(),
    considerationAmount: first.startAmount.toString(),
    offerer: order.offerer,
    zone: order.zone,
    offerToken: offered.token,
    offerIdentifier: offered.identifierOrCriteria.toString(),
    offerAmount: offered.startAmount.toString(),
    basicOrderType: side === "offer" ? 16 : currency === "native" ? 0 : 8,
    startTime: order.startTime.toString(),
    endTime: order.endTime.toString(),
    zoneHash: zeroHash,
    salt: order.salt.toString(),
    offererConduitKey: order.conduitKey,
    fulfillerConduitKey: openseaConduit.key,
    totalOriginalAdditionalRecipients: String(order.consideration.length - 1),
    additionalRecipients: order.consideration.slice(1).map((fee) => ({
      recipient: fee.recipient,
      amount: fee.startAmount.toString()
    })),
    signature
  };
  const input =
    method === "fulfillOrder"
      ? { order: full, fulfillerConduitKey: openseaConduit.key }
      : method === "fulfillAdvancedOrder"
        ? {
            advancedOrder: {
              ...full,
              numerator: 1,
              denominator: 1,
              extraData: "0x"
            },
            criteriaResolvers: [],
            fulfillerConduitKey: openseaConduit.key,
            recipient: actor
          }
        : { parameters: basic };
  const quote = {
    id: "opensea_fixture",
    asset,
    lifecycle: reviewed.lifecycle,
    actor,
    orderHash: reviewed.orderHash,
    expiresAt: expiresAt.toString(),
    fulfillment: {
      protocol: "seaport1.6",
      fulfillment_data: {
        orders: [
          {
            parameters: {
              ...full.parameters,
              counter,
              salt: `0x${order.salt.toString(16)}`
            },
            signature
          }
        ],
        transaction: {
          chain: asset.chainId,
          to: seaportDeployment.address,
          function: `${method}(fixture)`,
          value:
            side === "listing" && currency === "native"
              ? reviewed.grossAmount
              : "0",
          input_data: input,
          calldata_suffix: "0xcdb44011"
        }
      }
    }
  } satisfies OpenSeaFulfillmentQuote;
  return {
    order,
    reviewed,
    actor,
    quote,
    basic,
    full: seaportFulfillmentOrder(order, signature)
  };
}
