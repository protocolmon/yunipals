import { decodeEventLog, type Hex } from "viem";
import { boosterPacksSourceAbi } from "./boosterSourceAbi.js";
import { seaportEventAbi } from "./seaportEvents.js";

export type IndexedAction =
  | {
      kind: "bnb-validate" | "bnb-cancel";
      orderHash: string;
      offerer: string;
    }
  | {
      kind: "booster-request-created";
      requestId: string;
      originalId: string;
      packTypeId: string;
      payer: string;
      quantity: number;
      opening: boolean;
      paid: string;
      ruleHash: string;
      callbackGas: number;
    };

export type IndexedActionRequest = {
  version: 1;
  releaseId: string;
  readIdentity: string;
  chainId: 56 | 8453;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  action: IndexedAction;
};

export type IndexedActionState =
  | "indexed"
  | "awaiting_indexing"
  | "awaiting_receipt"
  | "inclusion_changed"
  | "action_not_observed"
  | "source_unavailable"
  | "unsupported";
export type IndexedActionReason =
  | "action_indexed"
  | "block_not_indexed"
  | "receipt_not_enriched"
  | "inclusion_changed"
  | "action_not_observed"
  | "history_unsupported"
  | "source_disabled"
  | "source_definition_mismatch"
  | "source_selection_changed"
  | "source_unavailable"
  | "source_read_unavailable"
  | "event_limit_exceeded"
  | "canonical_event_invalid"
  | "inclusion_evidence_unavailable"
  | "receipt_candidate_missing"
  | "receipt_invalid"
  | "projection_inconsistent";
export type IndexedActionEvidence = {
  version: 1;
  expectationHash: string;
  state: IndexedActionState;
  reason: IndexedActionReason;
  transaction: {
    chainId: number;
    hash: string;
    blockNumber: string;
    blockHash: string;
  };
  identity: {
    releaseId: string;
    readIdentity: string;
    manifestHash: string;
    buildId: string;
  } | null;
  coverage: {
    sourceId: string;
    policy: "latest";
    completeThroughBlock: string;
    availableThroughBlock: string;
    finalizedThroughBlock: string | null;
    anchor: { number: string; hash: string };
    observationRevision: string | null;
  } | null;
  proof: {
    kind: "canonical_event" | "canonical_event_and_full_receipt";
    receiptRequirement: "none" | "full";
    receiptPayloadHash: string | null;
    events: { id: string; name: string; logIndex: number }[];
  } | null;
  application:
    | { state: "applied"; component: "booster_request" }
    | { state: "not_evaluated"; component: "marketplace" | "booster_request" };
};

export type IndexedActionSelection = {
  version: 1;
  identity: NonNullable<IndexedActionEvidence["identity"]>;
  supportedActions: IndexedAction["kind"][];
};

export class InvalidIndexedActionRequest extends Error {}
export class UnsupportedIndexedAction extends Error {}

const hash = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const decimal = /^(0|[1-9][0-9]{0,77})$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InvalidIndexedActionRequest();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new InvalidIndexedActionRequest();
}
function hex(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new InvalidIndexedActionRequest();
  return value.toLowerCase();
}
function uint(value: unknown): string {
  if (
    typeof value !== "string" ||
    !decimal.test(value) ||
    BigInt(value) >= 2n ** 256n
  )
    throw new InvalidIndexedActionRequest();
  return value;
}
function uint32(value: unknown, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value >= 2 ** 32
  )
    throw new InvalidIndexedActionRequest();
  return value;
}

/** Only the three captured action families are supported. No caller-selected
 * source, contract, ABI, policy, receipt, SQL identifier or callback discovery. */
export function parseIndexedActionRequest(
  input: unknown
): IndexedActionRequest {
  const value = object(input);
  keys(value, [
    "version",
    "releaseId",
    "readIdentity",
    "chainId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "action"
  ]);
  if (value.version !== 1) throw new InvalidIndexedActionRequest();
  const raw = object(value.action);
  let action: IndexedAction;
  if (raw.kind === "bnb-validate" || raw.kind === "bnb-cancel") {
    keys(raw, ["kind", "orderHash", "offerer"]);
    if (value.chainId !== 56) throw new InvalidIndexedActionRequest();
    action = {
      kind: raw.kind,
      orderHash: hex(raw.orderHash, hash),
      offerer: hex(raw.offerer, address)
    };
  } else if (raw.kind === "booster-request-created") {
    keys(raw, [
      "kind",
      "requestId",
      "originalId",
      "packTypeId",
      "payer",
      "quantity",
      "opening",
      "paid",
      "ruleHash",
      "callbackGas"
    ]);
    if (value.chainId !== 8453 || typeof raw.opening !== "boolean")
      throw new InvalidIndexedActionRequest();
    action = {
      kind: raw.kind,
      requestId: uint(raw.requestId),
      originalId: uint(raw.originalId),
      packTypeId: uint(raw.packTypeId),
      payer: hex(raw.payer, address),
      quantity: uint32(raw.quantity, true),
      opening: raw.opening,
      paid: uint(raw.paid),
      ruleHash: hex(raw.ruleHash, hash),
      callbackGas: uint32(raw.callbackGas, true)
    };
  } else {
    throw new UnsupportedIndexedAction();
  }
  return {
    version: 1,
    releaseId: hex(value.releaseId, hash),
    readIdentity: hex(value.readIdentity, hash),
    chainId: value.chainId as 56 | 8453,
    transactionHash: hex(value.transactionHash, hash),
    blockNumber: uint(value.blockNumber),
    blockHash: hex(value.blockHash, hash),
    action
  };
}

export function indexedActionAbi(
  action: IndexedAction,
  sourceAbiHash?: string
) {
  return action.kind === "booster-request-created"
    ? boosterPacksSourceAbi(sourceAbiHash)
    : seaportEventAbi;
}
export function indexedActionEventName(action: IndexedAction) {
  return action.kind === "booster-request-created"
    ? "RequestCreated"
    : action.kind === "bnb-validate"
      ? "OrderValidated"
      : "OrderCancelled";
}

/** Decode raw journal bytes with the exact known source ABI when supplied.
 * The caller also verifies its full manifest digest and the decoded args column. */
export function decodeIndexedActionLog(
  action: IndexedAction,
  log: { topics: readonly string[]; data: string },
  sourceAbiHash?: string
): Record<string, unknown> {
  const decoded = decodeEventLog({
    abi: indexedActionAbi(action, sourceAbiHash),
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data as Hex,
    strict: true
  });
  if (decoded.eventName !== indexedActionEventName(action))
    throw new Error("Unexpected indexed action event.");
  const args: unknown = decoded.args;
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Expected named indexed action arguments.");
  return args as Record<string, unknown>;
}

export function matchesIndexedAction(
  action: IndexedAction,
  args: Record<string, unknown>
): boolean {
  const sameAddress = (value: unknown, expected: string) =>
    typeof value === "string" && value.toLowerCase() === expected;
  if (action.kind === "booster-request-created")
    return (
      String(args.requestId) === action.requestId &&
      String(args.originalId) === action.originalId &&
      String(args.packTypeId) === action.packTypeId &&
      sameAddress(args.payer, action.payer) &&
      args.quantity === action.quantity &&
      args.opening === action.opening &&
      String(args.paid) === action.paid &&
      args.ruleHash === action.ruleHash &&
      args.callbackGas === action.callbackGas
    );
  const offerer =
    action.kind === "bnb-validate"
      ? (args.orderParameters as Record<string, unknown> | undefined)?.offerer
      : args.offerer;
  return (
    args.orderHash === action.orderHash && sameAddress(offerer, action.offerer)
  );
}
