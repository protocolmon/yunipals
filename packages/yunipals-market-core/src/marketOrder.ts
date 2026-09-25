import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "./registry";
import {
  address,
  array,
  decimal,
  enumeration,
  hex,
  integer,
  record,
  string
} from "./validation";

export type MarketAssetId = {
  chain: MarketplaceChain;
  chainId: number;
  contractAddress: Address;
  tokenId: string;
};

export type MarketOrder = {
  asset: MarketAssetId;
  lifecycle: number;
  orderHash: Hex;
  protocolAddress: Address;
  source: "opensea" | "yunipals";
  side: "listing" | "offer";
  maker: Address;
  currency: { address: Address; symbol: string; decimals: number };
  grossAmount: string;
  sellerProceeds: string;
  fees: { recipient: Address; amount: string }[];
  startTime: string;
  endTime: string;
  status:
    | "active"
    | "unavailable"
    | "filled"
    | "cancelled"
    | "expired"
    | "counter-changed";
};

export function parseMarketAssetId(value: unknown): MarketAssetId {
  const data = record(value);
  const chain = enumeration(data.chain, ["ethereum", "base", "polygon", "bnb"]);
  const config = marketplaceChains[chain];
  const asset = {
    chain,
    chainId: integer(data.chainId),
    contractAddress: address(data.contractAddress),
    tokenId: decimal(data.tokenId)
  };
  if (
    asset.chainId !== config.chainId ||
    asset.contractAddress !== getAddress(config.contractAddress)
  )
    throw new Error(
      "Marketplace collection does not match the supported chain."
    );
  return asset;
}

export function parseMarketOrder(value: unknown): MarketOrder {
  const data = record(value);
  const asset = parseMarketAssetId(data.asset);
  const currency = record(data.currency);
  const order: MarketOrder = {
    asset,
    lifecycle: integer(data.lifecycle),
    orderHash: hex(data.orderHash, 32),
    protocolAddress: address(data.protocolAddress),
    source: enumeration(data.source, ["opensea", "yunipals"]),
    side: enumeration(data.side, ["listing", "offer"]),
    maker: address(data.maker),
    currency: {
      address: address(currency.address),
      symbol: string(currency.symbol, 16),
      decimals: integer(currency.decimals, 36)
    },
    grossAmount: decimal(data.grossAmount),
    sellerProceeds: decimal(data.sellerProceeds),
    fees: array(
      data.fees,
      (item) => {
        const fee = record(item);
        return {
          recipient: address(fee.recipient),
          amount: decimal(fee.amount)
        };
      },
      31
    ),
    startTime: decimal(data.startTime),
    endTime: decimal(data.endTime),
    status: enumeration(data.status, [
      "active",
      "unavailable",
      "filled",
      "cancelled",
      "expired",
      "counter-changed"
    ])
  };
  if (
    order.source !== marketplaceChains[asset.chain].source ||
    order.protocolAddress !== getAddress(seaportDeployment.address) ||
    order.maker === zeroAddress
  )
    throw new Error("Unsupported marketplace order source or maker.");
  if (
    BigInt(order.grossAmount) === 0n ||
    BigInt(order.sellerProceeds) === 0n ||
    BigInt(order.endTime) <= BigInt(order.startTime)
  )
    throw new Error("Invalid marketplace price or expiry.");
  if (
    BigInt(order.sellerProceeds) +
      order.fees.reduce((total, fee) => total + BigInt(fee.amount), 0n) !==
    BigInt(order.grossAmount)
  )
    throw new Error("Marketplace payment totals do not agree.");
  return order;
}
