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
  frameworkReady: true,
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
  it("serves the latest complete prefix without requiring the observed head", () => {
    const value = { ...snapshot, completeThroughBlock: 94n };
    const latest = { ...options, policy: { kind: "latest" } as const };
    expect(evaluateSourceReadiness(source, value, latest)).toEqual({
      ready: true,
      reason: "ready",
      availableThroughBlock: 94n,
      requiredThroughBlock: 94n
    });
    expect(
      evaluateSourceReadiness(
        source,
        { ...value, frameworkReady: false },
        latest
      )
    ).toMatchObject({ ready: false, reason: "catching_up" });
    expect(
      evaluateSourceReadiness(
        source,
        { ...value, completeThroughBlock: null },
        latest
      )
    ).toMatchObject({ ready: false, reason: "not_indexed" });
  });
  it("keeps explicit latest block requirements and source end bounds exact", () => {
    const value = { ...snapshot, completeThroughBlock: 94n };
    const latest = { ...options, policy: { kind: "latest" } as const };
    expect(
      evaluateSourceReadiness(source, value, {
        ...latest,
        requiredThroughBlock: 94n
      })
    ).toMatchObject({ ready: true, requiredThroughBlock: 94n });
    expect(
      evaluateSourceReadiness(source, value, {
        ...latest,
        requiredThroughBlock: 95n
      })
    ).toMatchObject({
      ready: false,
      reason: "catching_up",
      availableThroughBlock: 94n,
      requiredThroughBlock: 95n
    });
    expect(
      evaluateSourceReadiness({ ...source, endBlock: "90" }, value, latest)
    ).toMatchObject({ ready: true, availableThroughBlock: 90n });
    expect(
      evaluateSourceReadiness({ ...source, endBlock: "90" }, value, {
        ...latest,
        requiredThroughBlock: 91n
      })
    ).toMatchObject({ ready: false, reason: "catching_up" });
  });
  it("retains latest history, stale observation, branch and halt refusals", () => {
    const latest = { ...options, policy: { kind: "latest" } as const };
    for (const [change, reason] of [
      [{ coverageStartBlock: 11n }, "history_missing"],
      [{ halted: true }, "halted"],
      [{ head: null }, "observation_stale"],
      [
        { head: { ...snapshot.head!, chainId: 56 } },
        "observation_inconsistent"
      ],
      [{ completeThroughBlock: 101n }, "observation_inconsistent"],
      [{ indexerObservedAtMs: 1001 }, "observation_stale"]
    ] as const) {
      expect(
        evaluateSourceReadiness(source, { ...snapshot, ...change }, latest)
      ).toMatchObject({ ready: false, reason });
    }
    expect(
      evaluateSourceReadiness(source, snapshot, { ...latest, nowMs: 181001 })
    ).toMatchObject({ ready: false, reason: "observation_stale" });
  });
  it("does not change depth or finalized catch-up requirements", () => {
    const value = { ...snapshot, completeThroughBlock: 79n };
    expect(evaluateSourceReadiness(source, value, options)).toMatchObject({
      ready: false,
      requiredThroughBlock: 95n
    });
    expect(
      evaluateSourceReadiness(source, value, {
        ...options,
        policy: { kind: "finalized" }
      })
    ).toMatchObject({ ready: false, requiredThroughBlock: 80n });
  });
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
