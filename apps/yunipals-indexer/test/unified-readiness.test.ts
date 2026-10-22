import { describe, expect, it } from "vitest";
import {
  evaluateSourceReadiness,
  type SourceSnapshot
} from "../../../packages/yunipals-indexer-client/src/readiness.js";
import type { SourceDefinition } from "../../../packages/yunipals-indexer-client/src/sources.js";

const hash = `0x${"ab".repeat(32)}`;
const release = { schema: "candidate", buildId: "build", manifestHash: hash };
const source: SourceDefinition = {
  id: "arena:base",
  feature: "arena",
  chainId: 8453,
  contractName: "YunipalsArena",
  address: `0x${"12".repeat(20)}`,
  startBlock: "10",
  endBlock: null,
  enabled: true,
  abiHash: hash,
  events: ["Entered"],
  receiptRequirement: "none",
  policies: [
    { kind: "latest" },
    { kind: "depth", subsequentBlocks: 5 },
    { kind: "finalized" }
  ]
};
const snapshot: SourceSnapshot = {
  sourceId: source.id,
  chainId: 8453,
  release,
  coverageStartBlock: 10n,
  completeThroughBlock: 100n,
  indexerObservedAtMs: 1000,
  head: {
    chainId: 8453,
    blockNumber: 100n,
    blockHash: hash,
    observedAtMs: 1000
  },
  finalized: {
    chainId: 8453,
    blockNumber: 80n,
    blockHash: hash,
    observedAtMs: 1000
  },
  halted: false
};
const options = {
  expectedRelease: release,
  policy: { kind: "depth", subsequentBlocks: 5 } as const,
  nowMs: 1000,
  maxObservationAgeMs: 180000
};

describe("source-scoped confirmation policies", () => {
  it("allows Arena work at exactly five subsequent full blocks without waiting for finalized", () => {
    expect(
      evaluateSourceReadiness(source, snapshot, {
        ...options,
        requiredThroughBlock: 95n
      })
    ).toMatchObject({ ready: true, availableThroughBlock: 95n });
    expect(
      evaluateSourceReadiness(source, snapshot, {
        ...options,
        requiredThroughBlock: 96n
      })
    ).toMatchObject({ ready: false, reason: "catching_up" });
    expect(
      evaluateSourceReadiness(source, { ...snapshot, finalized: null }, options)
        .ready
    ).toBe(true);
  });
  it("keeps latest UI state separate from actual finalized publication", () => {
    expect(
      evaluateSourceReadiness(source, snapshot, {
        ...options,
        policy: { kind: "latest" }
      }).availableThroughBlock
    ).toBe(100n);
    expect(
      evaluateSourceReadiness(source, snapshot, {
        ...options,
        policy: { kind: "finalized" }
      }).availableThroughBlock
    ).toBe(80n);
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, finalized: null },
        { ...options, policy: { kind: "finalized" } }
      ).reason
    ).toBe("finality_unavailable");
  });
  it("uses complete indexing coverage even when no contract events occurred", () => {
    expect(evaluateSourceReadiness(source, snapshot, options).ready).toBe(true);
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, completeThroughBlock: 94n },
        options
      )
    ).toMatchObject({
      reason: "catching_up",
      availableThroughBlock: 94n,
      requiredThroughBlock: 95n
    });
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, completeThroughBlock: null },
        options
      ).reason
    ).toBe("not_indexed");
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, coverageStartBlock: 11n },
        options
      ).reason
    ).toBe("history_missing");
  });
  it("fences stale observations, disabled/halted sources, and release switches", () => {
    expect(
      evaluateSourceReadiness({ ...source, enabled: false }, snapshot, options)
        .reason
    ).toBe("disabled");
    expect(
      evaluateSourceReadiness(source, { ...snapshot, halted: true }, options)
        .reason
    ).toBe("halted");
    expect(
      evaluateSourceReadiness(source, snapshot, { ...options, nowMs: 181001 })
        .reason
    ).toBe("observation_stale");
    expect(
      evaluateSourceReadiness(source, snapshot, { ...options, nowMs: 999 })
        .reason
    ).toBe("observation_stale");
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, release: { ...release, buildId: "other" } },
        options
      ).reason
    ).toBe("release_mismatch");
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, sourceId: "another:source" },
        options
      ).reason
    ).toBe("source_mismatch");
    expect(
      evaluateSourceReadiness(source, snapshot, {
        ...options,
        policy: { kind: "depth", subsequentBlocks: 20 }
      }).reason
    ).toBe("policy_unsupported");
  });
  it("rejects inconsistent chain evidence instead of declaring it finalized", () => {
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, head: { ...snapshot.head!, chainId: 56 } },
        options
      ).reason
    ).toBe("observation_inconsistent");
    expect(
      evaluateSourceReadiness(
        source,
        { ...snapshot, completeThroughBlock: 101n },
        options
      ).reason
    ).toBe("observation_inconsistent");
    expect(
      evaluateSourceReadiness(
        source,
        {
          ...snapshot,
          finalized: { ...snapshot.finalized!, blockNumber: 101n }
        },
        { ...options, policy: { kind: "finalized" } }
      ).reason
    ).toBe("observation_inconsistent");
  });
});
