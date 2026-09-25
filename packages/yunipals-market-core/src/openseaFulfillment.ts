import {
  encodeFunctionData,
  getAddress,
  zeroAddress,
  type Address,
  type Hex
} from "viem";

import {
  openSeaBytes as bytes,
  openSeaUint as uint,
  openSeaExactFields as exactFields,
  decodeOpenSeaParameters as components,
  bindOpenSeaOrder as bindOrder
} from "./openseaOrder";

import type { MarketOrder, MarketAssetId } from "./marketOrder";
import { openSeaSpender } from "./openseaRegistry";
import { marketplaceAssetKey, seaportDeployment } from "./registry";
import {
  seaportFulfillmentOrder,
  seaportWriteAbi,
  type SeaportOrderComponents
} from "./seaport";
import { encodeSeaportOrder } from "./seaportWire";
import { address, array, hex, record, string } from "./validation";

export type OpenSeaFulfillmentQuote = {
  id: string;
  asset: MarketAssetId;
  lifecycle: number;
  actor: Address;
  orderHash: Hex;
  expiresAt: string;
  fulfillment: unknown;
};

export type OpenSeaApproval =
  | { kind: "nft"; token: Address; spender: Address; tokenId: string }
  | {
      kind: "currency";
      token: Address;
      spender: Address;
      amount: bigint;
      fundedByOffer: boolean;
    };
export type OpenSeaTrade = {
  intent: {
    kind: "buy" | "accept-offer";
    chainId: number;
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
    orderHash: Hex;
    order: SeaportOrderComponents;
    asset: MarketAssetId;
    quoteExpiresAt: bigint;
  };
  signature: Hex;
  approvals: OpenSeaApproval[];
  makerSpender: Address;
};

function same(left: Address, right: Address) {
  return getAddress(left) === getAddress(right);
}

// Supported SIP-6 version 0 / SIP-7 header: version, fulfiller, uint64
// expiration, compact signature, context. Cryptographic authorization and
// context checks remain the deployed zone's responsibility during simulation.
export function openSeaAuthorizationExpiry(
  extraData: unknown,
  actor: Address,
  nowSeconds: bigint
) {
  const data = bytes(extraData);
  if (data.length < 2 + 93 * 2 || data.slice(2, 4) !== "00")
    throw new Error("Unsupported OpenSea zone authorization format.");
  const fulfiller = address(`0x${data.slice(4, 44)}`);
  const expiry = BigInt(`0x${data.slice(44, 60)}`);
  if (
    (!same(fulfiller, zeroAddress) && !same(fulfiller, actor)) ||
    expiry <= nowSeconds
  )
    throw new Error("The OpenSea zone authorization changed or expired.");
  return expiry;
}

function basicParameters(value: unknown) {
  const data = exactFields(value, [
    "considerationToken",
    "considerationIdentifier",
    "considerationAmount",
    "offerer",
    "zone",
    "offerToken",
    "offerIdentifier",
    "offerAmount",
    "basicOrderType",
    "startTime",
    "endTime",
    "zoneHash",
    "salt",
    "offererConduitKey",
    "fulfillerConduitKey",
    "totalOriginalAdditionalRecipients",
    "additionalRecipients",
    "signature"
  ]);
  return {
    considerationToken: address(data.considerationToken),
    considerationIdentifier: uint(data.considerationIdentifier),
    considerationAmount: uint(data.considerationAmount),
    offerer: address(data.offerer),
    zone: address(data.zone),
    offerToken: address(data.offerToken),
    offerIdentifier: uint(data.offerIdentifier),
    offerAmount: uint(data.offerAmount),
    basicOrderType: Number(uint(data.basicOrderType)),
    startTime: uint(data.startTime),
    endTime: uint(data.endTime),
    zoneHash: hex(data.zoneHash, 32),
    salt: uint(data.salt),
    offererConduitKey: hex(data.offererConduitKey, 32),
    fulfillerConduitKey: hex(data.fulfillerConduitKey, 32),
    totalOriginalAdditionalRecipients: uint(
      data.totalOriginalAdditionalRecipients
    ),
    additionalRecipients: array(
      data.additionalRecipients,
      (value) => {
        const item = exactFields(value, ["amount", "recipient"]);
        return {
          amount: uint(item.amount),
          recipient: address(item.recipient)
        };
      },
      31
    ),
    signature: bytes(data.signature)
  };
}
function encodedBasic(
  order: SeaportOrderComponents,
  signature: Hex,
  fulfillerConduitKey: Hex,
  listing: boolean
) {
  const first = order.consideration[0];
  const offered = order.offer[0];
  if (!first || !offered) throw new Error("The order has no transfer items.");
  return {
    considerationToken: first.token,
    considerationIdentifier: first.identifierOrCriteria,
    considerationAmount: first.startAmount,
    offerer: order.offerer,
    zone: order.zone,
    offerToken: offered.token,
    offerIdentifier: offered.identifierOrCriteria,
    offerAmount: offered.startAmount,
    basicOrderType:
      (listing ? (first.itemType === 0 ? 0 : 2) : 4) * 4 + order.orderType,
    startTime: order.startTime,
    endTime: order.endTime,
    zoneHash: order.zoneHash,
    salt: order.salt,
    offererConduitKey: order.conduitKey,
    fulfillerConduitKey,
    totalOriginalAdditionalRecipients: BigInt(order.consideration.length - 1),
    additionalRecipients: order.consideration
      .slice(1)
      .map((fee) => ({ amount: fee.startAmount, recipient: fee.recipient })),
    signature
  };
}

export function buildOpenSeaFulfillment(
  quote: OpenSeaFulfillmentQuote,
  reviewed: MarketOrder,
  actor: Address,
  nowSeconds: bigint
): OpenSeaTrade {
  if (
    marketplaceAssetKey(quote.asset) !== marketplaceAssetKey(reviewed.asset) ||
    quote.lifecycle !== reviewed.lifecycle ||
    quote.orderHash.toLowerCase() !== reviewed.orderHash.toLowerCase() ||
    !same(quote.actor, actor)
  )
    throw new Error("The OpenSea quote does not match the reviewed action.");
  const expiresAt = uint(quote.expiresAt);
  if (expiresAt <= nowSeconds || expiresAt > nowSeconds + 120n)
    throw new Error("The OpenSea quote expired or has an invalid lifetime.");
  const envelope = record(quote.fulfillment);
  if (envelope.protocol !== "seaport1.6")
    throw new Error("Unsupported OpenSea fulfillment protocol.");
  const fulfillment = record(envelope.fulfillment_data);
  const originals = array(fulfillment.orders, record, 1);
  if (originals.length !== 1)
    throw new Error("Choose an individual NFT fulfillment.");
  const original = originals[0];
  if (!original) throw new Error("Missing original order.");
  const order = components(original.parameters);
  const signature = bytes(original.signature);
  const { currency, fees } = bindOrder(order, reviewed);
  if (
    order.startTime > nowSeconds ||
    order.endTime <= nowSeconds ||
    reviewed.status !== "active" ||
    same(actor, order.offerer)
  )
    throw new Error("This order is not available for the connected wallet.");
  const transaction = record(fulfillment.transaction);
  if (
    uint(transaction.chain) !== BigInt(reviewed.asset.chainId) ||
    !same(address(transaction.to), seaportDeployment.address)
  )
    throw new Error("OpenSea returned a different settlement chain or target.");
  const listing = reviewed.side === "listing";
  const value =
    listing && same(currency.address, zeroAddress)
      ? BigInt(reviewed.grossAmount)
      : 0n;
  if (
    uint(transaction.value) !== value ||
    (transaction.value_hex !== undefined &&
      uint(transaction.value_hex) !== value)
  )
    throw new Error("OpenSea returned a different native payment.");
  const method = string(transaction.function, 1024).split("(")[0];
  const input = record(transaction.input_data);
  if (order.orderType >= 2) {
    if (method !== "fulfillAdvancedOrder")
      throw new Error(
        "This restricted order requires advanced zone authorization."
      );
    const authorizationExpiry = openSeaAuthorizationExpiry(
      record(input.advancedOrder).extraData,
      actor,
      nowSeconds
    );
    if (expiresAt > authorizationExpiry)
      throw new Error("The quote outlives its OpenSea zone authorization.");
  }
  let data: Hex;
  let fulfillerKey: Hex;
  let feesFromActor = false;
  if (
    method === "fulfillBasicOrder" ||
    method === "fulfillBasicOrder_efficient_6GL6yc"
  ) {
    exactFields(input, ["parameters"]);
    const parameters = basicParameters(input.parameters);
    fulfillerKey = parameters.fulfillerConduitKey;
    const expected = encodedBasic(order, signature, fulfillerKey, listing);
    data = encodeFunctionData({
      abi: seaportWriteAbi,
      functionName: method,
      args: [parameters]
    });
    if (
      data !==
      encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: method,
        args: [expected]
      })
    )
      throw new Error(
        "OpenSea's basic fulfillment differs from the signed order."
      );
  } else if (method === "fulfillOrder" || method === "fulfillAdvancedOrder") {
    const advanced = method === "fulfillAdvancedOrder";
    exactFields(
      input,
      advanced
        ? [
            "advancedOrder",
            "criteriaResolvers",
            "fulfillerConduitKey",
            "recipient"
          ]
        : ["order", "fulfillerConduitKey"]
    );
    const full = exactFields(
      input[advanced ? "advancedOrder" : "order"],
      advanced
        ? ["parameters", "numerator", "denominator", "signature", "extraData"]
        : ["parameters", "signature"]
    );
    const callOrder = components(full.parameters, order.counter);
    if (
      JSON.stringify(encodeSeaportOrder(callOrder)) !==
        JSON.stringify(encodeSeaportOrder(order)) ||
      bytes(full.signature) !== signature
    )
      throw new Error("OpenSea's fulfillment changes the signed order.");
    fulfillerKey = hex(input.fulfillerConduitKey, 32);
    feesFromActor = !listing && fees > 0n;
    const parameters = seaportFulfillmentOrder(order, signature);
    if (advanced) {
      if (
        uint(full.numerator) !== 1n ||
        uint(full.denominator) !== 1n ||
        array(input.criteriaResolvers, record, 0).length !== 0
      )
        throw new Error("Only complete individual NFT fills are supported.");
      const recipient = address(input.recipient);
      if (!same(recipient, actor) && !same(recipient, zeroAddress))
        throw new Error(
          "The fulfillment sends proceeds or the NFT to another wallet."
        );
      data = encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: "fulfillAdvancedOrder",
        args: [
          {
            ...parameters,
            numerator: 1n,
            denominator: 1n,
            extraData: bytes(full.extraData)
          },
          [],
          fulfillerKey,
          recipient
        ]
      });
    } else
      data = encodeFunctionData({
        abi: seaportWriteAbi,
        functionName: "fulfillOrder",
        args: [parameters, fulfillerKey]
      });
  } else
    throw new Error(
      "This OpenSea fulfillment route is not supported for an individual NFT."
    );
  const spender = openSeaSpender(fulfillerKey);
  const suffix =
    transaction.calldata_suffix === undefined ||
    transaction.calldata_suffix === null
      ? "0x"
      : bytes(transaction.calldata_suffix, 4);
  if (suffix !== "0x" && suffix.length !== 10)
    throw new Error("Invalid OpenSea attribution suffix.");
  data = `${data}${suffix.slice(2)}`;
  const approvals: OpenSeaApproval[] = [];
  if (!listing)
    approvals.push({
      kind: "nft",
      token: reviewed.asset.contractAddress,
      spender,
      tokenId: reviewed.asset.tokenId
    });
  if ((listing && !same(currency.address, zeroAddress)) || feesFromActor)
    approvals.push({
      kind: "currency",
      token: currency.address,
      spender,
      amount: listing ? BigInt(reviewed.grossAmount) : fees,
      fundedByOffer: feesFromActor
    });
  return {
    intent: {
      kind: listing ? "buy" : "accept-offer",
      chainId: reviewed.asset.chainId,
      account: getAddress(actor),
      to: seaportDeployment.address,
      data,
      value,
      orderHash: reviewed.orderHash,
      order,
      asset: reviewed.asset,
      quoteExpiresAt: expiresAt
    },
    signature,
    approvals,
    makerSpender: openSeaSpender(order.conduitKey)
  };
}
