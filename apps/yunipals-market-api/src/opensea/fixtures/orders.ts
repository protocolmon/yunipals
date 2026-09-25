import { zeroAddress, type Address } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  openseaConduit,
  openseaCurrencies,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  createItemOffer,
  createNativeListing,
  seaportOrderHash
} from "@protopals/yunipals-market-core/seaport";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";

import {
  snapshotOpenSeaPublication,
  type OpenSeaPublication
} from "@/opensea/orders";

export const fixtureMaker =
  "0x1111111111111111111111111111111111111111" as Address;
export const fixtureActor =
  "0x2222222222222222222222222222222222222222" as Address;
export const fixtureFeeRecipient =
  "0x3333333333333333333333333333333333333333" as Address;

export function publicationFixture(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing"
): OpenSeaPublication {
  const config = marketplaceChains[chain];
  const fields = {
    collection: config.contractAddress,
    tokenId: 42n,
    totalPrice: 10n ** 18n,
    startTime: 1700000000n,
    endTime: 1700003600n,
    counter: 2n ** 100n,
    salt: 2n ** 200n,
    fees: [{ recipient: fixtureFeeRecipient, amount: 10n ** 16n }]
  };
  const currency =
    side === "listing" ? zeroAddress : openseaCurrencies[chain].address;
  const base =
    side === "listing"
      ? createNativeListing({ ...fields, seller: fixtureMaker })
      : createItemOffer({
          ...fields,
          buyer: fixtureMaker,
          paymentToken: currency
        });
  const order = { ...base, conduitKey: openseaConduit.key };
  const summary: MarketOrder = {
    asset: {
      chain,
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      tokenId: "42"
    },
    lifecycle: 0,
    orderHash: seaportOrderHash(order),
    protocolAddress: seaportDeployment.address,
    source: "opensea",
    side,
    maker: fixtureMaker,
    currency: {
      address: currency,
      symbol: side === "listing" ? config.nativeSymbol : "WETH",
      decimals: 18
    },
    grossAmount: fields.totalPrice.toString(),
    sellerProceeds: (fields.totalPrice - fields.fees[0]!.amount).toString(),
    fees: fields.fees.map((fee) => ({ ...fee, amount: fee.amount.toString() })),
    startTime: fields.startTime.toString(),
    endTime: fields.endTime.toString(),
    status: "unavailable"
  };
  // Deliberately invalid, expired fixture signatures cannot authorize live orders.
  return { summary, order: encodeSeaportOrder(order), signature: "0x1234" };
}

export function acknowledgmentFixture(publication = publicationFixture()) {
  const snapshot = snapshotOpenSeaPublication(publication);
  return {
    chain: snapshot.chain,
    order_hash: snapshot.summary.orderHash,
    protocol_address: snapshot.summary.protocolAddress,
    protocol_data: { parameters: snapshot.body.parameters, signature: "0x" },
    status: "ACTIVE",
    remaining_quantity: 1
  };
}
