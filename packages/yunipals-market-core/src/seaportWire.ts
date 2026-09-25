import { getAddress, maxUint256, type Address } from "viem";

import type {
  SeaportConsiderationItem,
  SeaportOfferItem,
  SeaportOrderComponents
} from "./seaport";

type JsonIntegers<T> = T extends bigint
  ? string
  : T extends readonly (infer Item)[]
    ? JsonIntegers<Item>[]
    : T extends object
      ? { [Key in keyof T]: JsonIntegers<T[Key]> }
      : T;

export type SeaportOrderJson = JsonIntegers<SeaportOrderComponents>;

const itemKeys = [
  "itemType",
  "token",
  "identifierOrCriteria",
  "startAmount",
  "endAmount"
] as const;
const orderKeys = [
  "offerer",
  "zone",
  "offer",
  "consideration",
  "orderType",
  "startTime",
  "endTime",
  "zoneHash",
  "salt",
  "conduitKey",
  "counter"
] as const;

function fields(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a Seaport object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new Error("Unexpected or missing Seaport fields.");
  }
  return record;
}

function decimal(value: unknown): bigint {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new Error(
      "Seaport uint256 fields require canonical decimal strings."
    );
  }
  const parsed = BigInt(value);
  if (parsed > maxUint256) throw new Error("Seaport integer exceeds uint256.");
  return parsed;
}

function uint8(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 255
  ) {
    throw new Error("Expected a Seaport uint8 number.");
  }
  return value;
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("Invalid Seaport address.");
  }
  return getAddress(value);
}

function bytes32(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Invalid Seaport bytes32 value.");
  }
  return value.toLowerCase() as `0x${string}`;
}

function offerItem(value: Record<string, unknown>): SeaportOfferItem {
  return {
    itemType: uint8(value.itemType),
    token: address(value.token),
    identifierOrCriteria: decimal(value.identifierOrCriteria),
    startAmount: decimal(value.startAmount),
    endAmount: decimal(value.endAmount)
  };
}

function items<T>(value: unknown, parse: (item: unknown) => T): T[] {
  // Bound decoding work; this is our single-item orderbook wire format,
  // not a general parser for bulk/criteria/provider order envelopes.
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error("Expected between 1 and 32 Seaport items.");
  }
  return value.map(parse);
}

/**
 * Decode untrusted JSON without Number precision loss or extra signing fields.
 * Shape validation alone does NOT establish supported order semantics, maker
 * authorization, fee policy, lifecycle, or current fillability.
 */
export function decodeSeaportOrder(value: unknown): SeaportOrderComponents {
  const order = fields(value, orderKeys);
  return {
    offerer: address(order.offerer),
    zone: address(order.zone),
    offer: items(order.offer, (item) => offerItem(fields(item, itemKeys))),
    consideration: items(
      order.consideration,
      (item): SeaportConsiderationItem => {
        const record = fields(item, [...itemKeys, "recipient"]);
        return { ...offerItem(record), recipient: address(record.recipient) };
      }
    ),
    orderType: uint8(order.orderType),
    startTime: decimal(order.startTime),
    endTime: decimal(order.endTime),
    zoneHash: bytes32(order.zoneHash),
    salt: decimal(order.salt),
    conduitKey: bytes32(order.conduitKey),
    counter: decimal(order.counter)
  };
}

export function encodeSeaportOrder(
  order: SeaportOrderComponents
): SeaportOrderJson {
  const item = (value: SeaportOfferItem) => ({
    itemType: value.itemType,
    token: value.token,
    identifierOrCriteria: value.identifierOrCriteria.toString(),
    startAmount: value.startAmount.toString(),
    endAmount: value.endAmount.toString()
  });
  const encoded = {
    offerer: order.offerer,
    zone: order.zone,
    offer: order.offer.map(item),
    consideration: order.consideration.map((value) => ({
      ...item(value),
      recipient: value.recipient
    })),
    orderType: order.orderType,
    startTime: order.startTime.toString(),
    endTime: order.endTime.toString(),
    zoneHash: order.zoneHash,
    salt: order.salt.toString(),
    conduitKey: order.conduitKey,
    counter: order.counter.toString()
  };
  decodeSeaportOrder(encoded);
  return encoded;
}
