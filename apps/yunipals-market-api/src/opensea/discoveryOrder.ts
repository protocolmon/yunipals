import { getAddress, zeroAddress, type Hex } from "viem";
import type { MarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import type { SeaportOrderComponents } from "@protopals/yunipals-market-core/seaport";
import {
  bindOpenSeaOrder,
  decodeOpenSeaParameters,
  openSeaBytes
} from "@protopals/yunipals-market-core/openseaOrder";
import {
  openSeaCurrency,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { marketplaceChains } from "@protopals/yunipals-market-core/registry";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import { encodeSeaportOrder } from "@protopals/yunipals-market-core/seaportWire";
import {
  address,
  enumeration,
  hex,
  integer,
  record
} from "@protopals/yunipals-market-core/validation";

export function summarizeDiscoveredOpenSeaOrder(
  order: SeaportOrderComponents,
  chain: OpenSeaChain,
  side: "listing" | "offer",
  protocolAddress: MarketOrder["protocolAddress"],
  lifecycle: number
): MarketOrder {
  const config = marketplaceChains[chain];
  const nft = side === "listing" ? order.offer[0]! : order.consideration[0]!;
  const payments = side === "listing" ? order.consideration : order.offer;
  const fees = order.consideration.slice(1).map((item) => ({
    recipient: item.recipient,
    amount: item.startAmount.toString()
  }));
  const feeAmount = fees.reduce((sum, fee) => sum + BigInt(fee.amount), 0n);
  const gross =
    side === "listing"
      ? order.consideration[0]!.startAmount + feeAmount
      : order.offer[0]!.startAmount;
  const summary: MarketOrder = {
    asset: {
      chain,
      chainId: config.chainId,
      contractAddress: config.contractAddress,
      tokenId: nft.identifierOrCriteria.toString()
    },
    lifecycle,
    source: "opensea",
    side,
    orderHash: seaportOrderHash(order),
    protocolAddress,
    maker: order.offerer,
    currency: openSeaCurrency(chain, payments[0]!.token),
    fees,
    grossAmount: gross.toString(),
    sellerProceeds: (gross - feeAmount).toString(),
    startTime: order.startTime.toString(),
    endTime: order.endTime.toString(),
    status: "unavailable"
  };
  bindOpenSeaOrder(order, summary);
  return summary;
}

/** Discovery establishes identity/economics only, never ownership or fillability. */
export function parseOpenSeaDiscoveredOrder(
  value: unknown,
  chain: OpenSeaChain,
  side: "listing" | "offer"
) {
  const data = record(value);
  const config = marketplaceChains[chain];
  const protocolAddress = address(data.protocol_address);
  const orderHash = hex(data.order_hash, 32);
  if (data.chain !== chain)
    throw new Error("Provider discovery identity mismatch.");
  const protocol = record(data.protocol_data);
  const order = decodeOpenSeaParameters(protocol.parameters);
  if (seaportOrderHash(order).toLowerCase() !== orderHash)
    throw new Error("Provider discovery hash mismatch.");
  const nft = side === "listing" ? order.offer[0]! : order.consideration[0]!;
  if (
    ![2, 3, 4, 5].includes(nft.itemType) ||
    getAddress(nft.token) !== getAddress(config.contractAddress)
  )
    throw new Error("Provider discovery collection or side mismatch.");
  const status = enumeration(data.status, [
    "ACTIVE",
    "INACTIVE",
    "FULFILLED",
    "EXPIRED",
    "CANCELLED"
  ]);
  const remainingQuantity = integer(data.remaining_quantity, 1000000000);
  const signatureValue =
    protocol.signature === null || protocol.signature === undefined
      ? "0x"
      : openSeaBytes(protocol.signature);
  const signature = signatureValue === "0x" ? null : signatureValue;
  let classification: "item" | "criteria" | "unsupported" =
    nft.itemType >= 4 ? "criteria" : "unsupported";
  const tokenId: string | null =
    nft.itemType === 2 ? nft.identifierOrCriteria.toString() : null;
  if (nft.itemType === 2) {
    try {
      // Structural classification only. No lifecycle is persisted by discovery.
      summarizeDiscoveredOpenSeaOrder(order, chain, side, protocolAddress, 0);
      if (order.offerer !== zeroAddress && remainingQuantity <= 1)
        classification = "item";
    } catch {
      classification = "unsupported";
    }
  }
  const components = encodeSeaportOrder(order);
  return {
    chainId: config.chainId,
    contractAddress: config.contractAddress.toLowerCase(),
    protocolAddress: protocolAddress.toLowerCase(),
    orderHash: orderHash as Hex,
    side,
    tokenId,
    maker: order.offerer.toLowerCase(),
    components,
    signature,
    classification,
    providerStatus: status,
    remainingQuantity,
    // Preserve only the bounded protocol envelope; artwork/account fields are
    // irrelevant to order provenance and can be fetched from our own indexer.
    observation: {
      chain,
      protocol_address: protocolAddress,
      order_hash: orderHash,
      protocol_data: {
        parameters: {
          ...components,
          totalOriginalConsiderationItems: components.consideration.length
        },
        signature
      },
      status,
      remaining_quantity: remainingQuantity
    }
  };
}
