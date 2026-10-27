/** Additional read-only provenance on the existing BNB order point response.
 * This does not replace exact transaction evidence or attest to a caller's tx. */
export type BnbOrderProcessing = {
  version: 1;
  state: "qualified" | "pending" | "unavailable";
  reason:
    | "publication_processed"
    | "consumer_not_completed"
    | "source_unavailable"
    | "publication_history_unavailable"
    | "publication_invalid"
    | "order_binding_invalid"
    | "state_changed";
  source: {
    releaseId: string;
    readIdentity: string;
    manifestHash: string;
    buildId: string;
  } | null;
  consumer: {
    id: "bnb-discovery";
    sourceId: "marketplace:bnb:seaport";
    policy: "finalized";
    configurationHash: string;
    policyFingerprint: string;
    epoch: string;
    generation: string;
    mode: "live";
    readerMode: "unified";
  } | null;
  completed: { number: string; hash: string } | null;
  sourceAvailableThroughBlock: string | null;
  publication: {
    blockNumber: string;
    blockHash: string;
    transactionHash: string;
    transactionIndex: number;
    logIndex: number;
  } | null;
  order: {
    orderHash: string;
    maker: string;
    lifecycle: number;
    status: string;
    bindingCurrent: boolean | null;
  } | null;
  observation: {
    blockNumber: string;
    blockHash: string;
    observedAt: string;
  } | null;
  observationReason:
    | "not_observed"
    | "stale"
    | "outside_coverage"
    | "history_unavailable"
    | "canonical_mismatch"
    | null;
};
