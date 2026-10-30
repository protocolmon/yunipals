import type {
  IndexedActionEvidence,
  IndexedActionRequest,
  IndexedActionSelection
} from "@protopals/yunipals-market-core/indexedAction";
import { sha256, stringToHex, type TransactionReceipt } from "viem";

import { createMarketRequest } from "@/lib/marketplace/http";
import { MarketApiError } from "@/lib/marketplace/marketApiError";
import type { PendingMarketTransaction } from "@/lib/marketplace/pendingTransactions";
import { seaportDeployment } from "@/lib/marketplace/registry";
import { assertMarketReceipt } from "@/lib/marketplace/transactionIntent";
import {
  address,
  array,
  decimal,
  enumeration,
  hex,
  integer,
  record,
  string
} from "@/lib/marketplace/validation";

const states = [
  "indexed",
  "awaiting_indexing",
  "awaiting_receipt",
  "inclusion_changed",
  "action_not_observed",
  "source_unavailable",
  "unsupported"
] as const;
const reasons = [
  "action_indexed",
  "block_not_indexed",
  "receipt_not_enriched",
  "inclusion_changed",
  "action_not_observed",
  "history_unsupported",
  "source_disabled",
  "source_definition_mismatch",
  "source_selection_changed",
  "source_unavailable",
  "source_read_unavailable",
  "event_limit_exceeded",
  "canonical_event_invalid",
  "inclusion_evidence_unavailable",
  "receipt_candidate_missing",
  "receipt_invalid",
  "projection_inconsistent"
] as const;
const actions = [
  "bnb-validate",
  "bnb-cancel",
  "booster-request-created"
] as const;
const path = "/v1/indexer/action-evidence";

export function requiresBnbActionIndex(record: PendingMarketTransaction) {
  return (
    record.expectation.chainId === 56 &&
    (record.expectation.kind === "validate" ||
      record.expectation.kind === "cancel")
  );
}

function identity(input: unknown): IndexedActionSelection["identity"] {
  const value = record(input);
  return {
    releaseId: hex(value.releaseId, 32),
    readIdentity: hex(value.readIdentity, 32),
    manifestHash: hex(value.manifestHash, 32),
    buildId: string(value.buildId)
  };
}

export function parseIndexedActionSelection(
  input: unknown
): IndexedActionSelection {
  const value = record(input);
  if (value.version !== 1)
    throw new Error("Unsupported index evidence version.");
  return {
    version: 1,
    identity: identity(value.identity),
    supportedActions: array(
      value.supportedActions,
      (v) => enumeration(v, actions),
      3
    )
  };
}

export function bnbActionExpectation(
  saved: PendingMarketTransaction,
  receipt: TransactionReceipt,
  selection: IndexedActionSelection
): IndexedActionRequest {
  const expected = saved.expectation;
  if (
    expected.chainId !== 56 ||
    (expected.kind !== "validate" && expected.kind !== "cancel")
  )
    throw new Error("This transaction has no supported BNB index action.");
  if (receipt.transactionHash.toLowerCase() !== saved.hash.toLowerCase())
    throw new Error("The confirmed receipt belongs to another transaction.");
  assertMarketReceipt(expected, receipt);
  const kind = expected.kind === "validate" ? "bnb-validate" : "bnb-cancel";
  if (!selection.supportedActions.includes(kind)) throw new MarketApiError(422);
  return normalizeBnbActionRequest({
    version: 1,
    releaseId: selection.identity.releaseId,
    readIdentity: selection.identity.readIdentity,
    chainId: 56,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    action: {
      kind,
      orderHash: expected.orderHash,
      offerer:
        expected.kind === "validate" ? expected.order.offerer : expected.maker
    }
  });
}

function normalizeBnbActionRequest(
  input: IndexedActionRequest
): IndexedActionRequest {
  const value = record(input),
    action = record(value.action);
  if (value.version !== 1 || value.chainId !== 56)
    throw new Error("Unsupported BNB index expectation.");
  return {
    version: 1,
    releaseId: hex(value.releaseId, 32),
    readIdentity: hex(value.readIdentity, 32),
    chainId: 56,
    transactionHash: hex(value.transactionHash, 32),
    blockNumber: decimal(value.blockNumber),
    blockHash: hex(value.blockHash, 32),
    action: {
      kind: enumeration(action.kind, ["bnb-validate", "bnb-cancel"]),
      orderHash: hex(action.orderHash, 32),
      offerer: address(action.offerer).toLowerCase()
    }
  };
}

// Same sorted JSON and SHA256 representation as the server manifest digest.
// Only the already-normalized finite request is encoded, never a wallet payload.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Invalid index expectation.");
  return encoded;
}
export const indexedActionExpectationHash = (request: IndexedActionRequest) =>
  sha256(stringToHex(stableJson(normalizeBnbActionRequest(request))));

export function parseBnbActionEvidence(
  input: unknown,
  request: IndexedActionRequest,
  selected: IndexedActionSelection
): IndexedActionEvidence {
  const value = record(input);
  const transaction = record(value.transaction);
  if (
    value.version !== 1 ||
    request.chainId !== 56 ||
    request.action.kind === "booster-request-created" ||
    hex(value.expectationHash, 32) !== indexedActionExpectationHash(request) ||
    transaction.chainId !== 56 ||
    hex(transaction.hash, 32) !== request.transactionHash ||
    decimal(transaction.blockNumber) !== request.blockNumber ||
    hex(transaction.blockHash, 32) !== request.blockHash
  )
    throw new Error("The index evidence belongs to another action or receipt.");
  const state = enumeration(value.state, states);
  const reason = enumeration(value.reason, reasons);
  const bound = value.identity === null ? null : identity(value.identity);
  if (
    bound &&
    (Object.keys(bound) as (keyof typeof bound)[]).some(
      (key) => bound[key] !== selected.identity[key]
    )
  )
    throw new Error("The index evidence read identity changed.");
  const application = record(value.application);
  if (
    application.state !== "not_evaluated" ||
    application.component !== "marketplace"
  )
    throw new Error("Unexpected marketplace application evidence.");
  const coverage =
    value.coverage === null
      ? null
      : (() => {
          const row = record(value.coverage),
            anchor = record(row.anchor);
          if (
            row.sourceId !== "marketplace:bnb:seaport" ||
            row.policy !== "latest"
          )
            throw new Error("Unexpected index source.");
          return {
            sourceId: row.sourceId,
            policy: "latest" as const,
            completeThroughBlock: decimal(row.completeThroughBlock),
            availableThroughBlock: decimal(row.availableThroughBlock),
            finalizedThroughBlock:
              row.finalizedThroughBlock === null
                ? null
                : decimal(row.finalizedThroughBlock),
            anchor: {
              number: decimal(anchor.number),
              hash: hex(anchor.hash, 32)
            },
            observationRevision:
              row.observationRevision === null
                ? null
                : decimal(row.observationRevision)
          };
        })();
  const proof =
    value.proof === null
      ? null
      : (() => {
          const row = record(value.proof);
          if (
            row.kind !== "canonical_event_and_full_receipt" ||
            row.receiptRequirement !== "full"
          )
            throw new Error("BNB action evidence requires the full receipt.");
          const eventName =
            request.action.kind === "bnb-validate"
              ? "OrderValidated"
              : "OrderCancelled";
          const events = array(
            row.events,
            (input) => {
              const event = record(input),
                logIndex = integer(event.logIndex);
              const id = `56:${seaportDeployment.address.toLowerCase()}:${request.transactionHash}:${logIndex}`;
              if (event.name !== eventName || event.id !== id)
                throw new Error("Unexpected indexed order event.");
              return { id, name: eventName, logIndex };
            },
            256
          );
          if (
            !events.length ||
            new Set(events.map((event) => event.logIndex)).size !==
              events.length
          )
            throw new Error("Indexed order events are missing or duplicated.");
          return {
            kind: "canonical_event_and_full_receipt" as const,
            receiptRequirement: "full" as const,
            receiptPayloadHash: hex(row.receiptPayloadHash, 32),
            events
          };
        })();
  if (
    state === "indexed" &&
    (reason !== "action_indexed" ||
      !bound ||
      !coverage ||
      !proof ||
      BigInt(coverage.completeThroughBlock) < BigInt(request.blockNumber) ||
      BigInt(coverage.availableThroughBlock) < BigInt(request.blockNumber) ||
      BigInt(coverage.anchor.number) < BigInt(request.blockNumber) ||
      (coverage.anchor.number === request.blockNumber &&
        coverage.anchor.hash !== request.blockHash))
  )
    throw new Error("The action has not been qualified as indexed.");
  if (state !== "indexed" && proof !== null)
    throw new Error("Unqualified action included an indexed proof.");
  return {
    version: 1,
    expectationHash: hex(value.expectationHash, 32),
    state,
    reason,
    transaction: {
      chainId: 56,
      hash: request.transactionHash,
      blockNumber: request.blockNumber,
      blockHash: request.blockHash
    },
    identity: bound,
    coverage,
    proof,
    application: { state: "not_evaluated", component: "marketplace" }
  };
}

export function createIndexedBnbActionClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  const request = createMarketRequest(baseUrl, fetcher);
  return {
    async evidence(
      saved: PendingMarketTransaction,
      receipt: TransactionReceipt,
      signal?: AbortSignal
    ) {
      const selected = parseIndexedActionSelection(
        await request(path, { signal })
      );
      const expected = bnbActionExpectation(saved, receipt, selected);
      return parseBnbActionEvidence(
        await request(path, {
          method: "POST",
          signal,
          body: JSON.stringify(expected)
        }),
        expected,
        selected
      );
    }
  };
}

export function pendingBnbIndexLabel(
  indexed: IndexedActionEvidence | undefined,
  error: unknown,
  configured = true
) {
  if (!configured || (error instanceof MarketApiError && error.status === 422))
    return "Confirmed · index tracking unavailable";
  if (error) return "Confirmed · index unavailable";
  if (indexed?.state === "indexed") return "Action indexed";
  if (indexed?.state === "inclusion_changed")
    return "Receipt changed · check transaction";
  if (indexed?.state === "unsupported")
    return "Confirmed · index tracking unavailable";
  if (indexed?.state === "action_not_observed")
    return "Confirmed · action not indexed";
  if (indexed?.state === "source_unavailable")
    return "Confirmed · index unavailable";
  return "Confirmed · indexing";
}

export function bnbIndexRefetchInterval(
  indexed: IndexedActionEvidence | undefined,
  error: unknown
): false | number {
  const finalized =
    indexed?.state === "indexed" &&
    indexed.coverage?.finalizedThroughBlock !== null &&
    indexed.coverage?.finalizedThroughBlock !== undefined &&
    BigInt(indexed.coverage.finalizedThroughBlock) >=
      BigInt(indexed.transaction.blockNumber);
  if (
    finalized ||
    indexed?.state === "unsupported" ||
    (error instanceof MarketApiError && error.status === 422)
  )
    return false;
  return error ||
    indexed?.state === "indexed" ||
    indexed?.state === "source_unavailable"
    ? 30_000
    : 2_000;
}
