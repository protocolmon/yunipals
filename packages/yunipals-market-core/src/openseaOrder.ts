import {
  getAddress,
  maxUint256,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

import type { MarketOrder } from "./marketOrder";
import {
  isOpenSeaChain,
  openSeaCurrency,
  openSeaSpender,
  openseaSignedZone
} from "./openseaRegistry";
import { marketplaceChains, seaportDeployment } from "./registry";
import { seaportOrderHash, type SeaportOrderComponents } from "./seaport";
import { decodeSeaportOrder } from "./seaportWire";
import { address, array, hex, integer, record, string } from "./validation";

function same(left: Address, right: Address) {
  return getAddress(left) === getAddress(right);
}
export function openSeaBytes(value: unknown, maxBytes = 16_384): Hex {
  const result = string(value, maxBytes * 2 + 2);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(result))
    throw new Error("Invalid OpenSea signature or authorization openSeaBytes.");
  return result.toLowerCase() as Hex;
}
// OpenSea's raw wire mixes small JSON numbers, decimal strings and hex salts.
// Convert each integer once, rejecting unsafe JSON numbers before hashing.
export function openSeaUint(value: unknown): bigint {
  if (typeof value === "number") return BigInt(integer(value));
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)
  )
    throw new Error("Invalid OpenSea integer.");
  const result = BigInt(value);
  if (result > maxUint256) throw new Error("OpenSea integer exceeds uint256.");
  return result;
}
export function openSeaExactFields(value: unknown, names: readonly string[]) {
  const data = record(value);
  if (
    Object.keys(data).length !== names.length ||
    names.some((name) => !Object.hasOwn(data, name))
  )
    throw new Error("Unexpected OpenSea transaction fields.");
  return data;
}
function item(value: unknown, consideration: boolean) {
  const data = openSeaExactFields(value, [
    "itemType",
    "token",
    "identifierOrCriteria",
    "startAmount",
    "endAmount",
    ...(consideration ? ["recipient"] : [])
  ]);
  return {
    itemType: Number(openSeaUint(data.itemType)),
    token: address(data.token),
    identifierOrCriteria: openSeaUint(data.identifierOrCriteria).toString(),
    startAmount: openSeaUint(data.startAmount).toString(),
    endAmount: openSeaUint(data.endAmount).toString(),
    ...(consideration ? { recipient: address(data.recipient) } : {})
  };
}
export function decodeOpenSeaParameters(value: unknown, counter?: bigint) {
  const keys = [
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
    "totalOriginalConsiderationItems"
  ];
  const data = openSeaExactFields(
    value,
    counter === undefined ? [...keys, "counter"] : keys
  );
  const consideration = array(
    data.consideration,
    (value) => item(value, true),
    32
  );
  if (
    openSeaUint(data.totalOriginalConsiderationItems) !==
    BigInt(consideration.length)
  )
    throw new Error(
      "This fulfillment adds consideration outside the signed order."
    );
  return decodeSeaportOrder({
    offerer: address(data.offerer),
    zone: address(data.zone),
    offer: array(data.offer, (value) => item(value, false), 1),
    consideration,
    orderType: Number(openSeaUint(data.orderType)),
    startTime: openSeaUint(data.startTime).toString(),
    endTime: openSeaUint(data.endTime).toString(),
    zoneHash: hex(data.zoneHash, 32),
    salt: openSeaUint(data.salt).toString(),
    conduitKey: hex(data.conduitKey, 32),
    counter: (counter ?? openSeaUint(data.counter)).toString()
  });
}

/** Fixed individual ERC-721 economics; provider zone/conduit remain intact. */
export function bindOpenSeaOrder(
  order: SeaportOrderComponents,
  reviewed: MarketOrder
) {
  if (
    !isOpenSeaChain(reviewed.asset.chain) ||
    reviewed.source !== "opensea" ||
    reviewed.asset.chainId !==
      marketplaceChains[reviewed.asset.chain].chainId ||
    !same(
      reviewed.asset.contractAddress,
      marketplaceChains[reviewed.asset.chain].contractAddress
    ) ||
    !same(reviewed.protocolAddress, seaportDeployment.address)
  )
    throw new Error("Unsupported OpenSea collection or protocol.");
  if (
    !same(order.offerer, reviewed.maker) ||
    seaportOrderHash(order).toLowerCase() !==
      reviewed.orderHash.toLowerCase() ||
    order.startTime.toString() !== reviewed.startTime ||
    order.endTime.toString() !== reviewed.endTime ||
    ![0, 1, 2, 3].includes(order.orderType)
  )
    throw new Error("OpenSea returned a different signed order.");
  if (!same(order.zone, zeroAddress) && !same(order.zone, openseaSignedZone))
    throw new Error("This OpenSea validation zone is not supported.");
  if (order.orderType >= 2 && same(order.zone, zeroAddress))
    throw new Error("The restricted order has no supported validation zone.");
  openSeaSpender(order.conduitKey);
  const currency = openSeaCurrency(
    reviewed.asset.chain,
    reviewed.currency.address
  );
  if (
    currency.decimals !== reviewed.currency.decimals ||
    currency.symbol !== reviewed.currency.symbol
  )
    throw new Error("The payment currency changed. Review the order again.");
  if (order.offer.length !== 1)
    throw new Error("Choose an individual NFT order.");
  const offered = order.offer[0];
  const first = order.consideration[0];
  if (!offered || !first) throw new Error("Missing OpenSea order items.");
  const listing = reviewed.side === "listing";
  const nft = listing ? offered : first;
  if (
    !nft ||
    nft.itemType !== 2 ||
    !same(nft.token, reviewed.asset.contractAddress) ||
    nft.identifierOrCriteria.toString() !== reviewed.asset.tokenId ||
    nft.startAmount !== 1n ||
    nft.endAmount !== 1n ||
    (!listing && !same(first.recipient, order.offerer))
  )
    throw new Error("The fulfillment does not deliver the reviewed NFT.");
  const currencyType = same(currency.address, zeroAddress) ? 0 : 1;
  if (!listing && currencyType === 0)
    throw new Error("Native-currency offers are not supported.");
  const payments = listing
    ? order.consideration
    : [offered, ...order.consideration.slice(1)];
  if (
    payments.some(
      (payment) =>
        payment.itemType !== currencyType ||
        !same(payment.token, currency.address) ||
        payment.identifierOrCriteria !== 0n ||
        payment.startAmount <= 0n ||
        payment.endAmount !== payment.startAmount
    )
  )
    throw new Error("The fulfillment changes the payment asset or amount.");
  if (listing && !same(first.recipient, order.offerer))
    throw new Error("The seller payment is not the reviewed recipient.");
  const feeItems = order.consideration.slice(1);
  const fees = feeItems.reduce((sum, fee) => sum + fee.startAmount, 0n);
  const gross = listing ? first.startAmount + fees : offered.startAmount;
  const proceeds = gross - fees;
  if (
    gross > maxUint256 ||
    proceeds <= 0n ||
    gross.toString() !== reviewed.grossAmount ||
    proceeds.toString() !== reviewed.sellerProceeds ||
    feeItems.length !== reviewed.fees.length ||
    feeItems.some((fee, i) => {
      const expected = reviewed.fees[i];
      return (
        !expected ||
        fee.startAmount.toString() !== expected.amount ||
        !same(fee.recipient, expected.recipient) ||
        same(fee.recipient, zeroAddress)
      );
    })
  )
    throw new Error(
      "The OpenSea total, seller proceeds or fee recipients changed."
    );
  return { currency, fees };
}
