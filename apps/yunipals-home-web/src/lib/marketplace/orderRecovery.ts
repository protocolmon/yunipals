import { getAddress, type Address, type Hex } from "viem";

import {
  parseMarketAssetId,
  type MarketAssetId
} from "@/lib/marketplace/marketApi";
import type { PublicationIntent } from "@/lib/marketplace/orderPublication";
import {
  seaportOrderHash,
  type SeaportOrderComponents
} from "@/lib/marketplace/seaport";
import {
  decodeSeaportOrder,
  encodeSeaportOrder
} from "@/lib/marketplace/seaportWire";

export type OrderPublicationState =
  | "signature-requested"
  | "signed"
  | "publication-unknown"
  | "accepted";
export type RecoverableOrder = {
  asset: MarketAssetId;
  lifecycle: number;
  orderHash: Hex;
  order: SeaportOrderComponents;
  state: OrderPublicationState | "imported";
  updatedAt: number;
};
export type OrderRecoveryStorage = Pick<Storage, "getItem" | "setItem">;
const recoveryKey = "yunipals-market-order-recovery-v1";
export const recoverableOrderKey = (
  record: Pick<RecoverableOrder, "asset" | "orderHash">
) => `${record.asset.chainId}:${record.orderHash.toLowerCase()}`;
export const orderRecoveryEvent = "yunipals-market-order-recovery-changed";
export const maxOrderRecoveryFileBytes = 2_000_000;

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved order.");
  return value as Record<string, unknown>;
}

/** Never silently discard damaged or excess cancellation evidence. */
export function decodeRecoverableOrders(json: string): RecoverableOrder[] {
  if (json.length > maxOrderRecoveryFileBytes)
    throw new Error("Saved order data exceeds the supported size.");
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.length > 100)
    throw new Error(
      "Too many saved orders. Export and reconcile them before signing more."
    );
  const hashes = new Set<string>();
  return value.map((entry) => {
    const data = object(entry);
    const asset = parseMarketAssetId(data.asset);
    const order = decodeSeaportOrder(data.order);
    const orderHash = seaportOrderHash(order);
    const identity = recoverableOrderKey({ asset, orderHash });
    if (
      typeof data.orderHash !== "string" ||
      data.orderHash.toLowerCase() !== orderHash.toLowerCase() ||
      hashes.has(identity) ||
      typeof data.lifecycle !== "number" ||
      !Number.isSafeInteger(data.lifecycle) ||
      data.lifecycle < 0 ||
      typeof data.updatedAt !== "number" ||
      !Number.isSafeInteger(data.updatedAt) ||
      data.updatedAt <= 0
    )
      throw new Error("Saved order identity is invalid.");
    // Verify the recorded NFT identity without applying mutable fee/expiry policy.
    const nfts = [...order.offer, ...order.consideration].filter(
      (item) => item.itemType >= 2
    );
    const nft = nfts[0];
    if (
      !nft ||
      nfts.length !== 1 ||
      nft.itemType !== 2 ||
      nft.token.toLowerCase() !== asset.contractAddress.toLowerCase() ||
      nft.identifierOrCriteria.toString() !== asset.tokenId ||
      nft.startAmount !== 1n ||
      nft.endAmount !== 1n
    )
      throw new Error("Saved order does not match its NFT.");
    const state = data.state;
    if (
      state !== "signature-requested" &&
      state !== "signed" &&
      state !== "publication-unknown" &&
      state !== "accepted" &&
      state !== "imported"
    )
      throw new Error("Invalid saved order state.");
    hashes.add(identity);
    return {
      asset,
      lifecycle: data.lifecycle,
      orderHash,
      order,
      state,
      updatedAt: data.updatedAt
    };
  });
}

export function encodeRecoverableOrders(records: RecoverableOrder[]) {
  const json = JSON.stringify(
    records.map(({ order, ...record }) => ({
      ...record,
      order: encodeSeaportOrder(order)
    }))
  );
  decodeRecoverableOrders(json);
  return json;
}

export function readRecoverableOrders(
  storage: OrderRecoveryStorage = localStorage
) {
  return decodeRecoverableOrders(storage.getItem(recoveryKey) ?? "[]");
}

function writeRecoverableOrders(
  records: RecoverableOrder[],
  storage: OrderRecoveryStorage
) {
  const json = encodeRecoverableOrders(records);
  storage.setItem(recoveryKey, json);
  if (storage.getItem(recoveryKey) !== json)
    throw new Error(
      "Order recovery could not be saved. Enable browser storage before continuing."
    );
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(orderRecoveryEvent));
}

/** Import parameters only. A file cannot prove signing or server acceptance. */
export function importRecoverableOrders(
  json: string,
  maker: Address,
  storage: OrderRecoveryStorage = localStorage
) {
  const imported = decodeRecoverableOrders(json);
  if (imported.length === 0)
    throw new Error("This file contains no cancellation records.");
  if (
    imported.some(
      (record) => getAddress(record.order.offerer) !== getAddress(maker)
    )
  )
    throw new Error(
      "This file contains orders for another wallet. Connect the wallet used to export it."
    );
  const records = readRecoverableOrders(storage);
  const known = new Set(records.map(recoverableOrderKey));
  let added = 0;
  for (const record of imported) {
    // Existing local observations win, regardless of a file's timestamp/state.
    if (known.has(recoverableOrderKey(record))) continue;
    records.push({ ...record, state: "imported", updatedAt: Date.now() });
    added++;
  }
  // Full validation/capacity checks happen before the single storage write.
  // No pruning or partial import is used to make room for incoming evidence.
  if (added > 0) writeRecoverableOrders(records, storage);
  return { added, existing: imported.length - added };
}

/** Save before asking for a signature; cancellation needs parameters, not a signature. */
export function saveRecoverableOrder(
  intent: PublicationIntent,
  state: OrderPublicationState,
  storage: OrderRecoveryStorage = localStorage
) {
  const records = readRecoverableOrders(storage);
  const index = records.findIndex(
    (record) => recoverableOrderKey(record) === recoverableOrderKey(intent)
  );
  const record: RecoverableOrder = {
    asset: intent.asset,
    lifecycle: intent.lifecycle,
    orderHash: intent.orderHash,
    order: intent.order,
    state,
    updatedAt: Date.now()
  };
  if (index === -1) records.push(record);
  else records[index] = record;
  writeRecoverableOrders(records, storage);
}
