import { getAddress, type Address } from "viem";
import {
  validateOwnSeaportOrder,
  type OwnOrderPolicy,
  type OwnOrderSummary
} from "@protopals/yunipals-market-core/orderPolicy";
import {
  bnbOfferCurrency,
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  seaportOrderHash,
  type SeaportOrderComponents
} from "@protopals/yunipals-market-core/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@protopals/yunipals-market-core/seaportWire";
import {
  address,
  decimal,
  hex,
  integer,
  record,
  string
} from "@protopals/yunipals-market-core/validation";

export class BnbOrderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 429 | 503 = 409
  ) {
    super(code);
  }
}

export type BnbPolicy = { version: string; rules: OwnOrderPolicy };
export type BnbAsset = {
  chain: "bnb";
  chainId: 56;
  contractAddress: Address;
  tokenId: string;
};
export type OrderStatus =
  | "active"
  | "unavailable"
  | "filled"
  | "cancelled"
  | "expired"
  | "counter-changed";

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unexpected field.");
}

export function bnbAsset(value: unknown): BnbAsset {
  const asset = record(value);
  keys(asset, ["chain", "chainId", "contractAddress", "tokenId"]);
  if (
    asset.chain !== "bnb" ||
    asset.chainId !== 56 ||
    address(asset.contractAddress) !==
      getAddress(marketplaceChains.bnb.contractAddress)
  )
    throw new Error("Unsupported BNB collection.");
  return {
    chain: "bnb",
    chainId: 56,
    contractAddress: address(asset.contractAddress),
    tokenId: decimal(asset.tokenId)
  };
}

export function parseBnbOrderRequest(value: unknown, submission = false) {
  try {
    const data = record(value);
    keys(
      data,
      submission
        ? ["asset", "lifecycle", "order", "preparationId", "signature"]
        : ["asset", "lifecycle", "order"]
    );
    const asset = bnbAsset(data.asset);
    const lifecycle = integer(data.lifecycle, 2147483647);
    const order = decodeSeaportOrder(data.order);
    const signature = submission ? hex(data.signature) : undefined;
    const preparationId = submission
      ? string(data.preparationId, 36)
      : undefined;
    if (
      preparationId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        preparationId
      )
    )
      throw new Error("Invalid preparation ID.");
    return {
      asset,
      lifecycle,
      order,
      wire: encodeSeaportOrder(order),
      hash: seaportOrderHash(order),
      signature,
      preparationId
    };
  } catch {
    throw new BnbOrderError("invalid_order_request", 400);
  }
}

export type BnbOrderRequest = ReturnType<typeof parseBnbOrderRequest>;

export function validateBnbPolicy(policy: BnbPolicy) {
  if (
    string(policy.version, 256) !== policy.version ||
    getAddress(policy.rules.collection) !==
      getAddress(marketplaceChains.bnb.contractAddress) ||
    getAddress(policy.rules.offerCurrency) !==
      getAddress(bnbOfferCurrency.address) ||
    policy.rules.maxDurationSeconds <= 0n ||
    policy.rules.maxDurationSeconds > 365n * 86400n
  )
    throw new Error("Unsupported trusted BNB policy.");
  return policy;
}

export function checkBnbOrder(input: BnbOrderRequest, policy: BnbPolicy) {
  validateBnbPolicy(policy);
  let summary: OwnOrderSummary;
  try {
    summary = validateOwnSeaportOrder(input.order, policy.rules);
  } catch {
    throw new BnbOrderError("order_policy_rejected", 400);
  }
  if (
    summary.tokenId.toString() !== input.asset.tokenId ||
    getAddress(summary.collection) !== input.asset.contractAddress
  )
    throw new BnbOrderError("order_asset_mismatch", 400);
  return summary;
}

export function bnbOrderSummary(
  input: Pick<BnbOrderRequest, "asset" | "lifecycle" | "hash"> & {
    order: SeaportOrderComponents;
  },
  summary: OwnOrderSummary,
  status: OrderStatus
) {
  return {
    asset: input.asset,
    lifecycle: input.lifecycle,
    orderHash: input.hash,
    protocolAddress: seaportDeployment.address,
    source: "yunipals" as const,
    side: summary.side,
    maker: summary.maker,
    currency: {
      address: summary.currency,
      symbol: summary.side === "listing" ? "BNB" : "WBNB",
      decimals: 18
    },
    grossAmount: summary.grossAmount.toString(),
    sellerProceeds: summary.sellerProceeds.toString(),
    fees: summary.fees.map((fee) => ({
      recipient: fee.recipient,
      amount: fee.amount.toString()
    })),
    startTime: input.order.startTime.toString(),
    endTime: input.order.endTime.toString(),
    status
  };
}
