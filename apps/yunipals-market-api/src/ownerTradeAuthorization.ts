import { createHash } from "node:crypto";

import { getAddress, maxUint256, zeroAddress, type Address } from "viem";
import {
  parseMarketAssetId,
  parseMarketOrder,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";
import type { MarketplaceChain } from "@protopals/yunipals-market-core/registry";
import {
  address,
  decimal,
  enumeration,
  hex,
  integer,
  record,
  string
} from "@protopals/yunipals-market-core/validation";

export const ownerTradeActions = [
  "createListing",
  "createOffer",
  "buy",
  "acceptOffer"
] as const;
export type OwnerTradeAction = (typeof ownerTradeActions)[number];

const chainOrder = ["bnb", "ethereum", "base", "polygon"] as const;
const canaryStatement =
  "I authorize only the exact Yunipals marketplace canary actions listed in this schedule until validUntil. Each listed order may become executable and may be filled by a third party before cancellation or expiry.";
const publicStatement =
  "I authorize public Yunipals marketplace trading only for the chains and actions listed in this schedule until validUntil, subject to the recorded fee ceiling and production safety gates.";
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type AuthorizedOrder = {
  id: string;
  chain: MarketplaceChain;
  action: OwnerTradeAction;
  asset: ReturnType<typeof parseMarketAssetId> & { lifecycle: number };
  orderHash: `0x${string}`;
  actor: Address;
  maker: Address;
  currency: Address;
  grossAmount: string;
  sellerProceeds: string;
  startTime: string;
  endTime: string;
  policyVersion: string;
};

export type OwnerTradeSchedule = {
  formatVersion: 1;
  kind: "yunipals-marketplace-owner-trade-schedule";
  status: "authorized";
  mode: "canary" | "public";
  ownerWallet: Address;
  chains: MarketplaceChain[];
  actions: OwnerTradeAction[];
  maximumFeesBasisPoints: number;
  orders: AuthorizedOrder[];
  validFrom: string;
  validUntil: string;
  cancellationAndSettlementProcedure: string;
  authorizedBy: Address;
  authorizedAt: string;
  authorizationStatement: string;
};

export type VerifiedOwnerTradeAuthorization = {
  digest: `sha256:${string}`;
  schedule: OwnerTradeSchedule;
};

export type OwnerTradeCandidate = {
  action: OwnerTradeAction;
  order: MarketOrder;
  actor: Address;
  policyVersion: string;
};

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Owner trade authorization contains unexpected fields.");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("Owner trade authorization contains an unsafe number.");
    return String(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("Owner trade authorization contains an unsupported value.");
}

function timestamp(value: unknown) {
  const parsed = string(value, 20);
  if (!utcTimestamp.test(parsed) || Number.isNaN(Date.parse(parsed)))
    throw new Error("Owner trade authorization has an invalid timestamp.");
  return parsed;
}

function orderedUnique<T extends string>(
  values: unknown,
  supported: readonly T[]
): T[] {
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > supported.length
  )
    throw new Error("Owner trade authorization has an invalid scope.");
  const result = values.map((value) => enumeration(value, supported));
  const expected = supported.filter((value) => result.includes(value));
  if (
    new Set(result).size !== result.length ||
    result.some((value, index) => value !== expected[index])
  )
    throw new Error(
      "Owner trade authorization scope must be unique and ordered."
    );
  return result;
}

function uint(value: unknown) {
  const parsed = decimal(value);
  if (BigInt(parsed) > maxUint256)
    throw new Error("Owner trade authorization integer exceeds uint256.");
  return parsed;
}

function parseAuthorizedOrder(
  value: unknown,
  ownerWallet: Address,
  maximumFeesBasisPoints: number,
  validUntilSeconds: bigint
): AuthorizedOrder {
  const data = record(value);
  exactKeys(data, [
    "id",
    "chain",
    "action",
    "asset",
    "orderHash",
    "actor",
    "maker",
    "currency",
    "grossAmount",
    "sellerProceeds",
    "startTime",
    "endTime",
    "policyVersion"
  ]);
  const chain = enumeration(data.chain, chainOrder);
  const action = enumeration(data.action, ownerTradeActions);
  const rawAsset = record(data.asset);
  exactKeys(rawAsset, [
    "chain",
    "chainId",
    "contractAddress",
    "tokenId",
    "lifecycle"
  ]);
  const asset = {
    ...parseMarketAssetId(rawAsset),
    lifecycle: integer(rawAsset.lifecycle, 2147483647)
  };
  const actor = address(data.actor);
  const maker = address(data.maker);
  const grossAmount = uint(data.grossAmount);
  const sellerProceeds = uint(data.sellerProceeds);
  const startTime = uint(data.startTime);
  const endTime = uint(data.endTime);
  if (
    asset.chain !== chain ||
    actor === zeroAddress ||
    maker === zeroAddress ||
    getAddress(actor) !== getAddress(ownerWallet) ||
    ((action === "createListing" || action === "createOffer") &&
      getAddress(maker) !== getAddress(ownerWallet)) ||
    BigInt(grossAmount) === 0n ||
    BigInt(sellerProceeds) === 0n ||
    BigInt(sellerProceeds) > BigInt(grossAmount) ||
    BigInt(endTime) <= BigInt(startTime) ||
    BigInt(endTime) > validUntilSeconds ||
    (BigInt(grossAmount) - BigInt(sellerProceeds)) * 10_000n >
      BigInt(grossAmount) * BigInt(maximumFeesBasisPoints)
  )
    throw new Error("Owner trade authorization order exceeds its exact scope.");
  return {
    id: (() => {
      const value = string(data.id, 64);
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value))
        throw new Error("Owner trade authorization has an invalid order ID.");
      return value;
    })(),
    chain,
    action,
    asset,
    orderHash: hex(data.orderHash, 32),
    actor,
    maker,
    currency: address(data.currency),
    grossAmount,
    sellerProceeds,
    startTime,
    endTime,
    policyVersion: string(data.policyVersion, 128)
  };
}

function parseSchedule(value: unknown, now: number): OwnerTradeSchedule {
  const data = record(value);
  exactKeys(data, [
    "formatVersion",
    "kind",
    "status",
    "mode",
    "ownerWallet",
    "chains",
    "actions",
    "maximumFeesBasisPoints",
    "orders",
    "validFrom",
    "validUntil",
    "cancellationAndSettlementProcedure",
    "authorizedBy",
    "authorizedAt",
    "authorizationStatement"
  ]);
  if (
    data.formatVersion !== 1 ||
    data.kind !== "yunipals-marketplace-owner-trade-schedule" ||
    data.status !== "authorized"
  )
    throw new Error("Owner trade schedule is not authorized.");
  const mode = enumeration(data.mode, ["canary", "public"]);
  const ownerWallet = address(data.ownerWallet);
  const authorizedBy = address(data.authorizedBy);
  const chains = orderedUnique(data.chains, chainOrder);
  const actions = orderedUnique(data.actions, ownerTradeActions);
  const maximumFeesBasisPoints = integer(data.maximumFeesBasisPoints, 9999);
  const validFrom = timestamp(data.validFrom);
  const validUntil = timestamp(data.validUntil);
  const authorizedAt = timestamp(data.authorizedAt);
  const validFromMs = Date.parse(validFrom);
  const validUntilMs = Date.parse(validUntil);
  const authorizedAtMs = Date.parse(authorizedAt);
  const maximumDuration = mode === "canary" ? 7 * 86400000 : 90 * 86400000;
  if (
    ownerWallet === zeroAddress ||
    getAddress(authorizedBy) !== getAddress(ownerWallet) ||
    authorizedAtMs > validFromMs ||
    validUntilMs <= validFromMs ||
    validUntilMs - validFromMs > maximumDuration ||
    now < validFromMs ||
    now >= validUntilMs
  )
    throw new Error(
      "Owner trade schedule is expired or has an invalid window."
    );
  if (!Array.isArray(data.orders) || data.orders.length > 32)
    throw new Error("Owner trade schedule has too many orders.");
  const orders = data.orders.map((order) =>
    parseAuthorizedOrder(
      order,
      ownerWallet,
      maximumFeesBasisPoints,
      BigInt(Math.floor(validUntilMs / 1000))
    )
  );
  const procedure = string(data.cancellationAndSettlementProcedure, 4000);
  if (procedure.length < 20 || /[^\x20-\x7e]/.test(procedure))
    throw new Error(
      "Owner trade schedule requires an explicit ASCII procedure."
    );
  const authorizationStatement = string(data.authorizationStatement, 512);
  if (
    authorizationStatement !==
    (mode === "canary" ? canaryStatement : publicStatement)
  )
    throw new Error("Owner trade schedule statement does not match its mode.");
  if (mode === "canary") {
    if (!orders.length)
      throw new Error("A canary schedule requires exact orders.");
    const usedChains = chainOrder.filter((chain) =>
      orders.some((order) => order.chain === chain)
    );
    const usedActions = ownerTradeActions.filter((action) =>
      orders.some((order) => order.action === action)
    );
    if (
      chains.some((chain, index) => chain !== usedChains[index]) ||
      chains.length !== usedChains.length ||
      actions.some((action, index) => action !== usedActions[index]) ||
      actions.length !== usedActions.length
    )
      throw new Error("Canary scope does not match its exact orders.");
    const identities = orders.map(
      (order) =>
        `${order.chain}:${order.action}:${order.orderHash.toLowerCase()}:${order.actor.toLowerCase()}`
    );
    if (new Set(identities).size !== identities.length)
      throw new Error("Canary order identities must be unique.");
  } else if (orders.length) {
    throw new Error(
      "Public authorization uses chain/action scope, not canary orders."
    );
  }
  return {
    formatVersion: 1,
    kind: "yunipals-marketplace-owner-trade-schedule",
    status: "authorized",
    mode,
    ownerWallet,
    chains,
    actions,
    maximumFeesBasisPoints,
    orders,
    validFrom,
    validUntil,
    cancellationAndSettlementProcedure: procedure,
    authorizedBy,
    authorizedAt,
    authorizationStatement
  };
}

export function readOwnerTradeAuthorization(
  encoded: string,
  expectedDigest: string,
  now = Date.now()
): VerifiedOwnerTradeAuthorization {
  if (
    !/^[A-Za-z0-9_-]{1,87382}$/.test(encoded) ||
    !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)
  )
    throw new Error("Configure the exact owner trade authorization.");
  const bytes = Buffer.from(encoded, "base64url");
  if (
    bytes.length > 65536 ||
    bytes.toString("base64url") !== encoded ||
    Buffer.from(bytes.toString("utf8"), "utf8").compare(bytes) !== 0
  )
    throw new Error(
      "Owner trade authorization is not canonical base64url UTF-8."
    );
  const text = bytes.toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Owner trade authorization is not JSON.");
  }
  if (canonicalJson(raw) !== text)
    throw new Error("Owner trade authorization JSON is not canonical.");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== expectedDigest)
    throw new Error("Owner trade authorization digest does not match.");
  return {
    digest: digest as `sha256:${string}`,
    schedule: parseSchedule(raw, now)
  };
}

function feeWithinLimit(order: MarketOrder, maximumFeesBasisPoints: number) {
  const gross = BigInt(order.grossAmount);
  const fees = gross - BigInt(order.sellerProceeds);
  return fees * 10_000n <= gross * BigInt(maximumFeesBasisPoints);
}

export function assertOwnerTradeAuthorized(
  authorization: VerifiedOwnerTradeAuthorization,
  candidate: OwnerTradeCandidate,
  now = Date.now()
) {
  const schedule = authorization.schedule;
  const order = parseMarketOrder(candidate.order);
  const actor = getAddress(candidate.actor);
  if (
    now < Date.parse(schedule.validFrom) ||
    now >= Date.parse(schedule.validUntil) ||
    BigInt(order.endTime) >
      BigInt(Math.floor(Date.parse(schedule.validUntil) / 1000)) ||
    !schedule.chains.includes(order.asset.chain) ||
    !schedule.actions.includes(candidate.action) ||
    !feeWithinLimit(order, schedule.maximumFeesBasisPoints) ||
    ((candidate.action === "createListing" ||
      candidate.action === "createOffer") &&
      getAddress(order.maker) !== actor) ||
    ((candidate.action === "createListing" || candidate.action === "buy") &&
      order.side !== "listing") ||
    ((candidate.action === "createOffer" ||
      candidate.action === "acceptOffer") &&
      order.side !== "offer")
  )
    throw new Error("Trade is outside the owner-authorized scope.");
  if (schedule.mode === "public") return;
  const match = schedule.orders.some(
    (approved) =>
      approved.chain === order.asset.chain &&
      approved.action === candidate.action &&
      approved.asset.chainId === order.asset.chainId &&
      getAddress(approved.asset.contractAddress) ===
        getAddress(order.asset.contractAddress) &&
      approved.asset.tokenId === order.asset.tokenId &&
      approved.asset.lifecycle === order.lifecycle &&
      approved.orderHash.toLowerCase() === order.orderHash.toLowerCase() &&
      getAddress(approved.actor) === actor &&
      getAddress(approved.maker) === getAddress(order.maker) &&
      getAddress(approved.currency) === getAddress(order.currency.address) &&
      approved.grossAmount === order.grossAmount &&
      approved.sellerProceeds === order.sellerProceeds &&
      approved.startTime === order.startTime &&
      approved.endTime === order.endTime &&
      approved.policyVersion === candidate.policyVersion
  );
  if (!match)
    throw new Error("Trade is outside the exact canary authorization.");
}

export function ownerTradeActionAuthorized(
  authorization: VerifiedOwnerTradeAuthorization,
  chain: MarketplaceChain,
  action: OwnerTradeAction
) {
  return authorization.schedule.mode === "canary"
    ? authorization.schedule.orders.some(
        (order) => order.chain === chain && order.action === action
      )
    : authorization.schedule.chains.includes(chain) &&
        authorization.schedule.actions.includes(action);
}

export const ownerTradeAuthorizationStatements = {
  canary: canaryStatement,
  public: publicStatement
} as const;
