import {
  decodeEventLog,
  sha256,
  stringToHex,
  toEventSelector,
  type Abi,
  type AbiEvent,
  type Hex,
  type TransactionReceipt
} from "viem";
import type {
  IndexedActionEvidence,
  IndexedActionState,
  IndexedActionReason
} from "./indexedAction.js";
import {
  portalCollectionAbi,
  portalGradingAbi,
  portalRegistryAbi,
  portalCompetitionAbi
} from "./portalAbi.js";

export type PortalEventSource =
  "collection" | "grading" | "registry" | "competition";
export type PortalIndexDeployment = {
  chainId: number;
  collection: string;
  grading: string;
  registry: string;
  competition: string;
};
const supported = new Set([
  "Transfer",
  "KindConfigured",
  "MintCommitted",
  "PortalMinted",
  "PortalRetired",
  "ClaimControllerBound",
  "RandomnessRequested",
  "RandomnessReceived",
  "RandomnessPaused",
  "RefundCredited",
  "RotationRequested",
  "SelectionRequested",
  "PortalActivated",
  "PortalRoundUnavailable",
  "PaymentPolicySet",
  "RubricConfigured",
  "ArtworkRegistered",
  "GradingRequested",
  "PaymentAllocated",
  "GradingCompleted",
  "AdmissionsPaused",
  "PortalFeeAccrued",
  "PortalClaimed",
  "CompetitionConfigured",
  "CompetitionNotificationDeferred",
  "CompetitionEntered",
  "CompetitionResult",
  "CompetitionReady",
  "CompetitionSettled",
  "CompetitionPrizePaid",
  "CompetitionPrizeDeferred",
  "ThemePublished"
]);
const eventAbi = (abi: Abi) =>
  abi.filter(
    (item): item is AbiEvent =>
      item.type === "event" && supported.has(item.name)
  );
export const portalEventAbis: Record<PortalEventSource, readonly AbiEvent[]> = {
  collection: eventAbi(portalCollectionAbi),
  grading: eventAbi(portalGradingAbi),
  registry: eventAbi(portalRegistryAbi),
  competition: eventAbi(portalCompetitionAbi)
};

export function portalIndexSourceId(deployment: PortalIndexDeployment) {
  return sha256(
    stringToHex(
      JSON.stringify([
        "portal-ledger-v5",
        deployment.chainId,
        ...Object.keys(portalEventAbis).map((key) =>
          deployment[key as PortalEventSource].toLowerCase()
        ),
        ...Object.values(portalEventAbis).flat().map(toEventSelector)
      ])
    )
  );
}
export function portalEventSource(
  deployment: PortalIndexDeployment,
  address: string
): PortalEventSource | undefined {
  return (Object.keys(portalEventAbis) as PortalEventSource[]).find(
    (key) => deployment[key].toLowerCase() === address.toLowerCase()
  );
}
export function decodePortalEvent(
  source: PortalEventSource,
  log: { data: Hex; topics: readonly Hex[] }
) {
  if (
    !portalEventAbis[source].some(
      (event) => toEventSelector(event) === log.topics[0]
    )
  )
    return null;
  const decoded = decodeEventLog({
    abi: portalEventAbis[source],
    data: log.data,
    topics: log.topics as [Hex, ...Hex[]],
    strict: true
  });
  return {
    name: decoded.eventName,
    args: Object.fromEntries(
      Object.entries(decoded.args ?? {}).map(([key, value]) => [
        key,
        String(value)
      ])
    )
  };
}
export function portalEventDigest(name: string, args: Record<string, string>) {
  return sha256(
    stringToHex(
      JSON.stringify([
        name,
        Object.entries(args).sort(([a], [b]) => a.localeCompare(b))
      ])
    )
  );
}
export type PortalIndexEvent = {
  source: string;
  name: string;
  logIndex: number;
  digest: string;
};
export function portalReceiptEvents(
  deployment: PortalIndexDeployment,
  receipt: Pick<TransactionReceipt, "logs">
): PortalIndexEvent[] {
  return receipt.logs
    .flatMap((log) => {
      const source = portalEventSource(deployment, log.address);
      if (!source) return [];
      const event = decodePortalEvent(source, log);
      if (!event || log.logIndex === null) return [];
      return [
        {
          source: log.address.toLowerCase(),
          name: event.name,
          logIndex: log.logIndex,
          digest: portalEventDigest(event.name, event.args)
        }
      ];
    })
    .sort((a, b) => a.logIndex - b.logIndex);
}
export type PortalSharedIdentity = { releaseId: string; readIdentity: string };
export type PortalIndexSelection = {
  version: 1 | 2;
  shared?: PortalSharedIdentity;
  sourceId: string;
  generation: string | null;
  deployment: PortalIndexDeployment;
};
export type PortalIndexRequest = {
  version: 1 | 2;
  shared?: PortalSharedIdentity;
  sourceId: string;
  generation: string | null;
  chainId: number;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  sender: string;
  events: PortalIndexEvent[];
};
export type PortalIndexEvidence = {
  version: 1 | 2;
  shared?: PortalSharedIdentity & { observationRevision: string };
  expectationHash: string;
  state: IndexedActionState;
  reason: IndexedActionReason;
  transaction: IndexedActionEvidence["transaction"];
  coverage: IndexedActionEvidence["coverage"];
  proof: IndexedActionEvidence["proof"];
  application: { state: "applied" | "not_evaluated"; component: "portal" };
};
export function portalIndexExpectationHash(request: PortalIndexRequest) {
  return sha256(
    stringToHex(
      JSON.stringify([
        request.version,
        ...(request.version === 2
          ? [request.shared?.releaseId, request.shared?.readIdentity]
          : []),
        request.sourceId,
        request.generation,
        request.chainId,
        request.transactionHash.toLowerCase(),
        request.blockNumber,
        request.blockHash.toLowerCase(),
        request.sender.toLowerCase(),
        request.events.map((event) => [
          event.source.toLowerCase(),
          event.name,
          event.logIndex,
          event.digest.toLowerCase()
        ])
      ])
    )
  );
}

/** Exact portal event/projection evidence. Shared reads also bind the selected
 * immutable release; unrelated source coverage never proves a portal action. */
export function portalEvidenceMatches(
  request: PortalIndexRequest,
  evidence: PortalIndexEvidence
): boolean {
  const coverage = evidence.coverage;
  return (
    evidence.version === request.version &&
    (request.version === 1 ||
      (!!request.shared &&
        evidence.shared?.releaseId === request.shared.releaseId &&
        evidence.shared?.readIdentity === request.shared.readIdentity &&
        !!evidence.shared?.observationRevision)) &&
    evidence.expectationHash === portalIndexExpectationHash(request) &&
    evidence.state === "indexed" &&
    evidence.reason === "action_indexed" &&
    evidence.application.state === "applied" &&
    evidence.transaction.chainId === request.chainId &&
    evidence.transaction.hash.toLowerCase() ===
      request.transactionHash.toLowerCase() &&
    evidence.transaction.blockNumber === request.blockNumber &&
    evidence.transaction.blockHash.toLowerCase() ===
      request.blockHash.toLowerCase() &&
    coverage?.sourceId === request.sourceId &&
    coverage.observationRevision === request.generation &&
    /^\d+$/.test(coverage.completeThroughBlock) &&
    BigInt(coverage.completeThroughBlock) >= BigInt(request.blockNumber) &&
    evidence.proof?.events.length === request.events.length &&
    request.events.length > 0 &&
    request.events.every(
      (event, i) =>
        evidence.proof?.events[i].id ===
          `${request.transactionHash.toLowerCase()}:${event.logIndex}` &&
        evidence.proof.events[i].name === event.name &&
        evidence.proof.events[i].logIndex === event.logIndex
    )
  );
}
