import type { BnbOrderProcessing } from "@protopals/yunipals-market-core/bnbProcessing";
import type { IndexedActionEvidence } from "@protopals/yunipals-market-core/indexedAction";
import type { TransactionReceipt } from "viem";

import { createMarketRequest } from "@/lib/marketplace/http";
import {
  bnbActionExpectation,
  bnbIndexRefetchInterval,
  createIndexedBnbActionClient,
  parseBnbActionEvidence
} from "@/lib/marketplace/indexedBnbAction";
import { parsePublishedOrder } from "@/lib/marketplace/marketApi";
import { MarketApiError } from "@/lib/marketplace/marketApiError";
import type { PendingMarketTransaction } from "@/lib/marketplace/pendingTransactions";
import { seaportDeployment } from "@/lib/marketplace/registry";
import {
  address,
  boolean,
  decimal,
  enumeration,
  hex,
  integer,
  record,
  string
} from "@/lib/marketplace/validation";

export type BnbActionProgress = {
  source: IndexedActionEvidence;
  marketplace: "verified" | "unverified" | "unavailable";
};

function timestamp(input: unknown) {
  const value = string(input, 40);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  )
    throw new Error("Invalid processing observation time.");
  return value;
}

export function parseBnbOrderProcessing(input: unknown): BnbOrderProcessing {
  const value = record(input);
  if (value.version !== 1) throw new Error("Unsupported processing version.");
  const nullable = <T>(
    input: unknown,
    parse: (value: Record<string, unknown>) => T
  ) => (input === null ? null : parse(record(input)));
  return {
    version: 1,
    state: enumeration(value.state, ["qualified", "pending", "unavailable"]),
    reason: enumeration(value.reason, [
      "publication_processed",
      "consumer_not_completed",
      "source_unavailable",
      "publication_history_unavailable",
      "publication_invalid",
      "order_binding_invalid",
      "state_changed"
    ]),
    source: nullable(value.source, (row) => ({
      releaseId: hex(row.releaseId, 32),
      readIdentity: hex(row.readIdentity, 32),
      manifestHash: hex(row.manifestHash, 32),
      buildId: string(row.buildId)
    })),
    sourceAvailableThroughBlock:
      value.sourceAvailableThroughBlock === null
        ? null
        : decimal(value.sourceAvailableThroughBlock),
    consumer: nullable(value.consumer, (row) => ({
      id: enumeration(row.id, ["bnb-discovery"]),
      sourceId: enumeration(row.sourceId, ["marketplace:bnb:seaport"]),
      policy: enumeration(row.policy, ["finalized"]),
      configurationHash: hex(row.configurationHash, 32),
      policyFingerprint: hex(row.policyFingerprint, 32),
      epoch: timestamp(row.epoch),
      generation: decimal(row.generation),
      mode: enumeration(row.mode, ["live"]),
      readerMode: enumeration(row.readerMode, ["unified"])
    })),
    completed: nullable(value.completed, (row) => ({
      number: decimal(row.number),
      hash: hex(row.hash, 32)
    })),
    publication: nullable(value.publication, (row) => ({
      blockNumber: decimal(row.blockNumber),
      blockHash: hex(row.blockHash, 32),
      transactionHash: hex(row.transactionHash, 32),
      transactionIndex: integer(row.transactionIndex),
      logIndex: integer(row.logIndex)
    })),
    order: nullable(value.order, (row) => ({
      orderHash: hex(row.orderHash, 32),
      maker: address(row.maker).toLowerCase(),
      lifecycle: integer(row.lifecycle),
      bindingCurrent:
        row.bindingCurrent === null ? null : boolean(row.bindingCurrent),
      status: enumeration(row.status, [
        "active",
        "unavailable",
        "filled",
        "cancelled",
        "expired",
        "counter-changed"
      ])
    })),
    observation: nullable(value.observation, (row) => ({
      blockNumber: decimal(row.blockNumber),
      blockHash: hex(row.blockHash, 32),
      observedAt: timestamp(row.observedAt)
    })),
    observationReason:
      value.observationReason === null
        ? null
        : enumeration(value.observationReason, [
            "not_observed",
            "stale",
            "outside_coverage",
            "history_unavailable",
            "canonical_mismatch"
          ])
  };
}

// An existing published row is insufficient: its current qualified consumer must
// cover the exact new source action, with an independently bound row/publication.
export function bnbMarketplaceUpdateVerified(
  input: unknown,
  saved: PendingMarketTransaction,
  receipt: TransactionReceipt,
  source: IndexedActionEvidence
): boolean {
  try {
    if (!source.identity || source.state !== "indexed") return false;
    const selected = {
      version: 1 as const,
      identity: source.identity,
      supportedActions: ["bnb-validate", "bnb-cancel"] as const
    };
    const expected = bnbActionExpectation(saved, receipt, {
      ...selected,
      supportedActions: [...selected.supportedActions]
    });
    if (expected.action.kind === "booster-request-created") return false;
    const indexed = parseBnbActionEvidence(source, expected, {
      ...selected,
      supportedActions: [...selected.supportedActions]
    });
    // These endpoints use sequential snapshots. Require the exact source
    // inclusion to be finalized before combining it with the finalized consumer.
    if (
      indexed.coverage?.finalizedThroughBlock === null ||
      indexed.coverage?.finalizedThroughBlock === undefined ||
      BigInt(indexed.coverage.finalizedThroughBlock) < receipt.blockNumber
    )
      return false;
    const envelope = record(input);
    const order = parsePublishedOrder(input);
    const processing = parseBnbOrderProcessing(envelope.processing);
    const {
      source: identity,
      consumer,
      completed,
      publication,
      order: bound,
      observation
    } = processing;
    if (
      processing.state !== "qualified" ||
      processing.reason !== "publication_processed" ||
      !identity ||
      !consumer ||
      !completed ||
      !publication ||
      !bound ||
      processing.sourceAvailableThroughBlock === null ||
      (Object.keys(identity) as (keyof typeof identity)[]).some(
        (key) => identity[key] !== indexed.identity![key]
      ) ||
      order.asset.chainId !== 56 ||
      order.source !== "yunipals" ||
      order.orderHash !== expected.action.orderHash ||
      bound.orderHash !== order.orderHash ||
      bound.maker !== order.maker.toLowerCase() ||
      bound.maker !== expected.action.offerer ||
      bound.lifecycle !== order.lifecycle ||
      bound.status !== order.status ||
      BigInt(completed.number) < receipt.blockNumber ||
      BigInt(completed.number) >
        BigInt(processing.sourceAvailableThroughBlock) ||
      (BigInt(completed.number) === receipt.blockNumber &&
        completed.hash !== expected.blockHash) ||
      BigInt(publication.blockNumber) > receipt.blockNumber ||
      (BigInt(publication.blockNumber) === receipt.blockNumber &&
        (publication.blockHash !== expected.blockHash ||
          publication.transactionIndex > receipt.transactionIndex))
    )
      return false;
    if (publication.transactionHash === expected.transactionHash) {
      if (
        publication.blockNumber !== expected.blockNumber ||
        publication.blockHash !== expected.blockHash ||
        publication.transactionIndex !== receipt.transactionIndex
      )
        return false;
      if (
        expected.action.kind === "bnb-validate" &&
        !indexed.proof!.events.some(
          (event) => event.logIndex === publication.logIndex
        )
      )
        return false;
      if (
        expected.action.kind === "bnb-cancel" &&
        !indexed.proof!.events.some(
          (event) => event.logIndex > publication.logIndex
        )
      )
        return false;
    }
    if (saved.expectation.kind === "validate") {
      const asset = saved.expectation.asset;
      return (
        bound.bindingCurrent === true &&
        order.status === "active" &&
        order.asset.contractAddress.toLowerCase() ===
          asset.contractAddress.toLowerCase() &&
        order.asset.tokenId === asset.tokenId
      );
    }
    return (
      expected.action.kind === "bnb-cancel" &&
      order.status === "cancelled" &&
      processing.observationReason === null &&
      observation !== null &&
      BigInt(observation.blockNumber) >= receipt.blockNumber &&
      BigInt(observation.blockNumber) <=
        BigInt(processing.sourceAvailableThroughBlock) &&
      (BigInt(observation.blockNumber) !== receipt.blockNumber ||
        observation.blockHash === expected.blockHash)
    );
  } catch {
    // Missing, legacy, changed or malformed provenance stays unverified.
    return false;
  }
}

export function createBnbActionProgressClient(
  indexerUrl: string,
  marketplaceUrl: string | null | undefined,
  fetcher: typeof fetch = fetch
) {
  const indexed = createIndexedBnbActionClient(indexerUrl, fetcher);
  let market: ReturnType<typeof createMarketRequest> | null = null;
  try {
    if (marketplaceUrl) market = createMarketRequest(marketplaceUrl, fetcher);
  } catch {
    /* Source tracking remains available without a valid marketplace URL. */
  }
  return {
    async evidence(
      saved: PendingMarketTransaction,
      receipt: TransactionReceipt,
      signal?: AbortSignal
    ): Promise<BnbActionProgress> {
      const source = await indexed.evidence(saved, receipt, signal);
      if (source.state !== "indexed")
        return { source, marketplace: "unverified" };
      if (!market) return { source, marketplace: "unavailable" };
      const expected = saved.expectation;
      if (expected.kind !== "validate" && expected.kind !== "cancel")
        return { source, marketplace: "unverified" };
      try {
        const input = await market(
          `/v1/market/orders/bnb/${seaportDeployment.address}/${hex(expected.orderHash, 32)}`,
          { signal }
        );
        return {
          source,
          marketplace: bnbMarketplaceUpdateVerified(
            input,
            saved,
            receipt,
            source
          )
            ? "verified"
            : "unverified"
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          source,
          marketplace:
            error instanceof MarketApiError && error.status === 404
              ? "unverified"
              : "unavailable"
        };
      }
    }
  };
}

export function bnbActionProgressRefetchInterval(
  progress: BnbActionProgress | undefined,
  error: unknown
): false | number {
  if (error instanceof MarketApiError && error.status === 422) return false;
  if (error) return 30_000;
  const sourceInterval = bnbIndexRefetchInterval(progress?.source, error);
  if (
    progress?.source.state === "indexed" &&
    progress.marketplace !== "verified"
  )
    return 30_000;
  return sourceInterval;
}
