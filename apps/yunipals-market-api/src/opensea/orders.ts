import { getAddress, type Hex } from "viem";
import {
  parseMarketAssetId,
  parseMarketOrder,
  type MarketOrder
} from "@protopals/yunipals-market-core/marketOrder";
import type { OpenSeaOrderPolicy } from "@protopals/yunipals-market-core/openseaOrderPolicy";
import { createOpenSeaPublicationIntent } from "@protopals/yunipals-market-core/openseaPublication";
import { seaportOrderHash } from "@protopals/yunipals-market-core/seaport";
import {
  bindOpenSeaOrder,
  decodeOpenSeaParameters
} from "@protopals/yunipals-market-core/openseaOrder";
import {
  isOpenSeaChain,
  openseaConduit
} from "@protopals/yunipals-market-core/openseaRegistry";
import {
  decodeSeaportOrder,
  encodeSeaportOrder,
  type SeaportOrderJson
} from "@protopals/yunipals-market-core/seaportWire";
import {
  address,
  enumeration,
  hex,
  integer,
  record,
  string
} from "@protopals/yunipals-market-core/validation";

import {
  assertOpenSeaPolicyFresh,
  type OpenSeaPolicyPurpose
} from "@/opensea/policyFreshness";

export type OpenSeaPublication = {
  order: SeaportOrderJson;
  signature: Hex;
  summary: MarketOrder;
};

// Snapshot before any await: a caller must not mutate the reviewed identity
// between authorization and transmission. This is a structural/economic check;
// admission must separately verify signature, policy and current chain state.
export function snapshotOpenSeaPublication(value: OpenSeaPublication) {
  const summary = parseMarketOrder(value.summary);
  const order = decodeSeaportOrder(value.order);
  bindOpenSeaOrder(order, summary);
  if (
    !isOpenSeaChain(summary.asset.chain) ||
    ![0, 2].includes(order.orderType) ||
    order.conduitKey.toLowerCase() !== openseaConduit.key
  )
    throw new Error("Unsupported OpenSea publication.");
  const signature = hex(value.signature);
  const wire = encodeSeaportOrder(order);
  return {
    chain: summary.asset.chain,
    summary,
    order: wire,
    signature,
    body: {
      parameters: {
        ...wire,
        totalOriginalConsiderationItems: wire.consideration.length
      },
      protocol_address: summary.protocolAddress,
      signature
    }
  };
}

/** An acknowledgment proves provider identity, not current onchain fillability. */
export function verifyOpenSeaAcknowledgment(
  value: unknown,
  expected: MarketOrder,
  observedAt: Date
) {
  const reviewed = parseMarketOrder(expected);
  const data = record(value);
  if (
    data.chain !== reviewed.asset.chain ||
    address(data.protocol_address) !== reviewed.protocolAddress ||
    hex(data.order_hash, 32) !== reviewed.orderHash.toLowerCase()
  )
    throw new Error("OpenSea acknowledgment identity mismatch.");
  const protocol = record(data.protocol_data);
  const order = decodeOpenSeaParameters(protocol.parameters);
  // Includes recomputed components hash, maker, exact NFT, amounts, recipients,
  // times, supported currency, zone and conduit. Never trust an echoed hash.
  bindOpenSeaOrder(order, reviewed);
  if (
    data.maker !== undefined &&
    address(record(data.maker).address) !== getAddress(order.offerer)
  )
    throw new Error("OpenSea acknowledgment maker mismatch.");
  return {
    schemaVersion: 1 as const,
    source: "opensea" as const,
    chain: reviewed.asset.chain,
    chainId: reviewed.asset.chainId,
    protocolAddress: reviewed.protocolAddress,
    orderHash: reviewed.orderHash,
    maker: reviewed.maker,
    observedAt: observedAt.toISOString(),
    providerStatus: enumeration(data.status, [
      "ACTIVE",
      "INACTIVE",
      "FULFILLED",
      "EXPIRED",
      "CANCELLED"
    ]),
    remainingQuantity: integer(data.remaining_quantity, 1),
    order: encodeSeaportOrder(order)
  };
}

export type OpenSeaAcknowledgment = ReturnType<
  typeof verifyOpenSeaAcknowledgment
>;

export class OpenSeaOrderError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 | 503 = 409
  ) {
    super(code);
    this.name = "OpenSeaOrderError";
  }
}

export function parseOpenSeaOrderRequest(value: unknown, submission = false) {
  try {
    const data = record(value);
    const expected = [
      "asset",
      "lifecycle",
      "order",
      "policyVersion",
      ...(submission ? ["preparationId", "signature"] : [])
    ];
    if (
      Object.keys(data).length !== expected.length ||
      expected.some((key) => !Object.hasOwn(data, key))
    )
      throw new Error();
    const asset = parseMarketAssetId(data.asset);
    if (!isOpenSeaChain(asset.chain)) throw new Error();
    const order = decodeSeaportOrder(data.order);
    const preparationId = submission
      ? string(data.preparationId, 36)
      : undefined;
    if (
      preparationId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        preparationId
      )
    )
      throw new Error();
    return {
      asset: { ...asset, chain: asset.chain },
      lifecycle: integer(data.lifecycle, 2147483647),
      order,
      wire: encodeSeaportOrder(order),
      hash: seaportOrderHash(order),
      policyVersion: string(data.policyVersion, 128),
      signature: submission ? hex(data.signature) : undefined,
      preparationId
    };
  } catch {
    throw new OpenSeaOrderError("invalid_order_request", 400);
  }
}

export type OpenSeaOrderRequest = ReturnType<typeof parseOpenSeaOrderRequest>;

export function checkOpenSeaOrder(
  input: OpenSeaOrderRequest,
  policy: OpenSeaOrderPolicy,
  timestamp: bigint,
  purpose: OpenSeaPolicyPurpose = "transaction"
) {
  try {
    assertOpenSeaPolicyFresh(policy, timestamp, purpose);
    if (input.policyVersion !== policy.version) throw new Error();
    const firstOffer = input.order.offer[0];
    const firstConsideration = input.order.consideration[0];
    if (!firstOffer || !firstConsideration) throw new Error();
    const listing = firstOffer.itemType === 2;
    const grossAmount = listing
      ? input.order.consideration.reduce(
          (sum, item) => sum + item.startAmount,
          0n
        )
      : firstOffer.startAmount;
    const intent = createOpenSeaPublicationIntent(
      {
        asset: input.asset,
        lifecycle: input.lifecycle,
        maker: input.order.offerer,
        side: listing ? "listing" : "offer",
        grossAmount,
        endTime: input.order.endTime,
        currency: listing ? firstConsideration.token : firstOffer.token
      },
      { ...policy, expiresAt: input.order.startTime + 120n },
      { timestamp: input.order.startTime, counter: input.order.counter },
      input.order.salt
    );
    if (intent.orderHash.toLowerCase() !== input.hash.toLowerCase())
      throw new Error();
    return intent.summary;
  } catch {
    throw new OpenSeaOrderError("order_policy_rejected", 400);
  }
}
