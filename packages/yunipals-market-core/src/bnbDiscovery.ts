import { decodeEventLog, getAddress, type Address, type Hex } from "viem";

import { validateOwnSeaportOrder, type OwnOrderPolicy } from "./orderPolicy";
import { seaportOrderHash, type SeaportOrderComponents } from "./seaport";
import { seaportEventAbi } from "./seaportEvents";

export type ValidatedOrderParameters = Omit<SeaportOrderComponents, "counter"> & {
  totalOriginalConsiderationItems: bigint;
};

export type ValidatedPublication = {
  orderHash: Hex;
  parameters: ValidatedOrderParameters;
};

export type ValidatedOrderStatus = {
  isValidated: boolean;
  isCancelled: boolean;
  totalFilled: bigint;
  totalSize: bigint;
};

export type DiscoveredProtocolState =
  | "active"
  | "filled"
  | "cancelled"
  | "expired"
  | "counter-changed"
  | "inconsistent";

/** A matching hash proves the counter that was absent from the event. */
export function validatedComponentsAtCounter(
  publication: ValidatedPublication,
  counter: bigint
): SeaportOrderComponents | null {
  const { totalOriginalConsiderationItems: _original, ...parameters } =
    publication.parameters;
  const components = { ...parameters, counter };
  return seaportOrderHash(components).toLowerCase() ===
    publication.orderHash.toLowerCase()
    ? components
    : null;
}

/** Decode only the expected Seaport event. The caller checks address and finality. */
export function decodeValidatedPublication(input: {
  topics: readonly Hex[];
  data: Hex;
}): ValidatedPublication {
  const event = decodeEventLog({
    abi: seaportEventAbi,
    eventName: "OrderValidated",
    topics: input.topics as [Hex, ...Hex[]],
    data: input.data,
    strict: true
  });
  if (!event.args || !event.args.orderParameters)
    throw new Error("Missing validated order parameters.");
  return {
    orderHash: event.args.orderHash,
    parameters: event.args.orderParameters
  };
}

export function supportedValidatedPublication(
  publication: ValidatedPublication,
  publicationTimestamp: bigint,
  policy: OwnOrderPolicy
) {
  const { parameters } = publication;
  if (
    parameters.offer.length !== 1 ||
    parameters.consideration.length < 1 ||
    parameters.consideration.length > 32 ||
    parameters.totalOriginalConsiderationItems !==
      BigInt(parameters.consideration.length) ||
    parameters.startTime > publicationTimestamp ||
    publicationTimestamp >= parameters.endTime ||
    parameters.endTime - parameters.startTime > 2_592_000n
  )
    return null;
  try {
    return validateOwnSeaportOrder(
      { ...parameters, counter: 0n },
      {
        ...policy,
        maxDurationSeconds:
          policy.maxDurationSeconds < 2_592_000n
            ? policy.maxDurationSeconds
            : 2_592_000n
      }
    );
  } catch {
    return null;
  }
}

/** Hash-matched components are safe to use in wallet transaction construction. */
export function observeValidatedPublication(
  publication: ValidatedPublication,
  makerCounter: bigint,
  status: ValidatedOrderStatus,
  observedTimestamp: bigint
): {
  state: DiscoveredProtocolState;
  components: SeaportOrderComponents | null;
} {
  const matched = validatedComponentsAtCounter(publication, makerCounter);
  if (status.totalSize > 0n && status.totalFilled >= status.totalSize)
    return { state: "filled", components: matched };
  if (status.isCancelled) return { state: "cancelled", components: matched };
  if (!matched) return { state: "counter-changed", components: null };
  if (publication.parameters.endTime <= observedTimestamp)
    return { state: "expired", components: matched };
  if (
    !status.isValidated ||
    status.totalFilled !== 0n ||
    status.totalSize !== 0n
  )
    return { state: "inconsistent", components: matched };
  return { state: "active", components: matched };
}

export function validatedCollectionAddress(
  publication: ValidatedPublication
): Address | null {
  const { offer, consideration } = publication.parameters;
  const nft = offer[0]?.itemType === 2 ? offer[0] : consideration[0];
  return nft?.itemType === 2 ? getAddress(nft.token) : null;
}
