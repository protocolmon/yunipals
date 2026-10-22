import {
  confirmationPolicyKey,
  type ConfirmationPolicy,
  type SourceDefinition
} from "./sources.js";

export type IndexerRelease = {
  schema: string;
  buildId: string;
  manifestHash: string;
};

export type ChainObservation = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  observedAtMs: number;
};

export type SourceSnapshot = {
  sourceId: string;
  chainId: number;
  release: IndexerRelease;
  coverageStartBlock: bigint;
  completeThroughBlock: bigint | null;
  indexerObservedAtMs: number;
  head: ChainObservation | null;
  finalized: ChainObservation | null;
  halted: boolean;
};

export type ReadinessReason =
  | "disabled"
  | "policy_unsupported"
  | "release_mismatch"
  | "source_mismatch"
  | "halted"
  | "history_missing"
  | "observation_stale"
  | "finality_unavailable"
  | "observation_inconsistent"
  | "not_indexed"
  | "catching_up"
  | "ready";

export type SourceReadiness = {
  ready: boolean;
  reason: ReadinessReason;
  availableThroughBlock: bigint | null;
  requiredThroughBlock: bigint | null;
};

export function evaluateSourceReadiness(
  source: SourceDefinition,
  snapshot: SourceSnapshot,
  options: {
    expectedRelease: IndexerRelease;
    policy: ConfirmationPolicy;
    nowMs: number;
    maxObservationAgeMs: number;
    requiredThroughBlock?: bigint;
  }
): SourceReadiness {
  if (
    !Number.isFinite(options.nowMs) ||
    !Number.isFinite(options.maxObservationAgeMs) ||
    options.maxObservationAgeMs <= 0 ||
    (options.requiredThroughBlock !== undefined &&
      options.requiredThroughBlock < 0n)
  ) {
    throw new Error("Invalid readiness evaluation options.");
  }
  const result = (
    reason: ReadinessReason,
    availableThroughBlock: bigint | null = null,
    requiredThroughBlock: bigint | null = null
  ): SourceReadiness => ({
    ready: reason === "ready",
    reason,
    availableThroughBlock,
    requiredThroughBlock
  });
  if (!source.enabled) return result("disabled");
  const policyKey = confirmationPolicyKey(options.policy);
  if (
    !source.policies.some(
      (policy) => confirmationPolicyKey(policy) === policyKey
    )
  ) {
    return result("policy_unsupported");
  }
  if (
    snapshot.release.schema !== options.expectedRelease.schema ||
    snapshot.release.buildId !== options.expectedRelease.buildId ||
    snapshot.release.manifestHash !== options.expectedRelease.manifestHash
  )
    return result("release_mismatch");
  if (source.id !== snapshot.sourceId || source.chainId !== snapshot.chainId) {
    return result("source_mismatch");
  }
  if (snapshot.halted) return result("halted");
  if (
    source.startBlock === null ||
    snapshot.coverageStartBlock > BigInt(source.startBlock)
  )
    return result("history_missing");
  const fresh = (at: number) =>
    Number.isFinite(at) &&
    at <= options.nowMs &&
    options.nowMs - at <= options.maxObservationAgeMs;
  const valid = (observation: ChainObservation) =>
    observation.chainId === source.chainId &&
    observation.blockNumber >= 0n &&
    /^0x[0-9a-f]{64}$/.test(observation.blockHash);
  if (
    !fresh(snapshot.indexerObservedAtMs) ||
    !snapshot.head ||
    !fresh(snapshot.head.observedAtMs)
  ) {
    return result("observation_stale");
  }
  if (!valid(snapshot.head)) return result("observation_inconsistent");
  let boundary = snapshot.head.blockNumber;
  if (options.policy.kind === "depth") {
    boundary -= BigInt(options.policy.subsequentBlocks);
  } else if (options.policy.kind === "finalized") {
    if (!snapshot.finalized) return result("finality_unavailable");
    if (!fresh(snapshot.finalized.observedAtMs))
      return result("observation_stale");
    if (
      !valid(snapshot.finalized) ||
      snapshot.finalized.blockNumber > snapshot.head.blockNumber ||
      (snapshot.finalized.blockNumber === snapshot.head.blockNumber &&
        snapshot.finalized.blockHash !== snapshot.head.blockHash)
    )
      return result("observation_inconsistent");
    boundary = snapshot.finalized.blockNumber;
  }
  if (source.endBlock !== null && boundary > BigInt(source.endBlock)) {
    boundary = BigInt(source.endBlock);
  }
  const required = options.requiredThroughBlock ?? boundary;
  const indexed = snapshot.completeThroughBlock;
  if (indexed === null || indexed < BigInt(source.startBlock)) {
    return result("not_indexed", null, required);
  }
  if (indexed > snapshot.head.blockNumber) {
    return result("observation_inconsistent", null, required);
  }
  const available = indexed < boundary ? indexed : boundary;
  return result(
    available >= required && required >= BigInt(source.startBlock)
      ? "ready"
      : "catching_up",
    available < BigInt(source.startBlock) ? null : available,
    required
  );
}
