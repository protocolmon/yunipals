import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredRelease } from "../lib/unified/releases.js";
import { observeIndexerChain } from "../lib/unified/observer.js";
import { evaluateSourceReadiness } from "../../../packages/yunipals-indexer-client/src/readiness.js";

const state = vi.hoisted(() => ({ indexed: 86n, running: true }));
const hash = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
vi.mock("../lib/unified/releases.js", () => ({
  readBoundRuntime: async () => ({
    running: state.running,
    frameworkReady: true,
    observedAtMs: 1_000_000,
    chains: [{ chainId: 8453, completeThroughBlock: state.indexed }],
    witnesses: [
      {
        chainId: 8453,
        blockNumber: state.indexed,
        blockHash: hash(state.indexed)
      }
    ]
  })
}));
vi.mock(
  "../../../packages/yunipals-indexer-server/src/chain-status.js",
  () => ({ readChainStatus: async () => null })
);
const policy = { kind: "depth", subsequentBlocks: 12 } as const;
const release: RegisteredRelease = {
  id: hash(1n),
  schema: "candidate",
  buildId: "fixture",
  manifestHash: hash(2n),
  manifest: {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [
      {
        id: "portals:8453:collection",
        feature: "portals",
        chainId: 8453,
        contractName: "PortalCollection",
        address: `0x${"12".repeat(20)}`,
        startBlock: "10",
        endBlock: null,
        enabled: true,
        abiHash: hash(3n),
        events: ["Transfer"],
        receiptRequirement: "full",
        policies: [{ kind: "latest" }, policy, { kind: "finalized" }]
      }
    ]
  }
};
async function observe(
  advance: boolean | "head" | "past-head",
  branchMatches = true
) {
  let saved: unknown[] | undefined;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("INSERT INTO yunipals_indexer_control.chain_status"))
      saved = values;
    return {
      rows: sql.includes("ORDER BY block_number DESC")
        ? [
            {
              block_number: "100",
              block_hash: hash(100n),
              parent_hash: hash(99n),
              timestamp: "1000"
            }
          ]
        : [],
      rowCount: sql.includes("SELECT 1 FROM") && !branchMatches ? 0 : 1
    };
  });
  const db = { query, release: vi.fn() };
  const pool = { query, connect: async () => db } as unknown as Pool;
  const sleep = vi.fn(async () => {});
  const result = await observeIndexerChain(
    pool,
    release,
    8453,
    {
      providerId: "fixture",
      chainId: async () => 8453,
      block: async (tag) => {
        if (tag === "finalized" && advance === true) state.indexed = 99n;
        if (tag === "latest" && advance === "head") state.indexed = 99n;
        if (tag === "latest" && advance === "past-head") state.indexed = 105n;
        const number =
          tag === "latest" ? 100n : tag === "finalized" ? 80n : tag;
        return {
          number,
          hash: hash(number),
          parentHash: hash(number - 1n),
          timestamp: 1000n
        };
      },
      receipt: async () => {
        throw new Error("No receipts expected");
      },
      code: async () => {
        throw new Error("No code reads expected");
      }
    },
    { now: () => 1_000_000, sleep }
  );
  return { result, saved, sleep };
}
beforeEach(() => {
  state.indexed = 86n;
  state.running = true;
});
describe("observer coverage after provider reads", () => {
  it("refreshes progress made during the latest-head RPC", async () => {
    const { result, saved } = await observe("head");
    expect(result).toBe("observed");
    expect(saved?.[8]).toBe("99");
    expect(JSON.parse(String(saved?.[12]))["88"].hash).toBe(hash(88n));
  });
  it("uses a stored native witness no later than the recorded head", async () => {
    const { result, saved } = await observe("past-head");
    expect(result).toBe("observed");
    expect(saved?.[8]).toBe("100");
    expect(JSON.parse(String(saved?.[12]))["88"].hash).toBe(hash(88n));
  });
  it("uses indexing progress made during finalized RPC even when finality was already covered", async () => {
    const { result, saved, sleep } = await observe(true);
    expect(result).toBe("observed");
    expect(sleep).not.toHaveBeenCalled();
    expect(saved?.[8]).toBe("99");
    const anchors = JSON.parse(String(saved?.[12]));
    expect(anchors["88"].hash).toBe(hash(88n));
    expect(
      evaluateSourceReadiness(
        release.manifest.sources[0]!,
        {
          sourceId: release.manifest.sources[0]!.id,
          chainId: 8453,
          release,
          coverageStartBlock: 10n,
          completeThroughBlock: 99n,
          frameworkReady: true,
          indexerObservedAtMs: 1_000_000,
          halted: false,
          head: {
            chainId: 8453,
            blockNumber: 100n,
            blockHash: hash(100n),
            observedAtMs: 1_000_000
          },
          finalized: null
        },
        {
          expectedRelease: release,
          policy,
          nowMs: 1_000_000,
          maxObservationAgeMs: 180000
        }
      ).ready
    ).toBe(true);
  });
  it("does not invent coverage when the indexer remains behind the confirmation boundary", async () => {
    const { result, saved, sleep } = await observe(false);
    expect(result).toBe("observed");
    expect(saved?.[8]).toBe("86");
    expect(JSON.parse(String(saved?.[12]))["88"]).toBeUndefined();
    expect(sleep).toHaveBeenCalledTimes(24);
  });
  it("still refuses a refreshed witness that disappeared before commit", async () => {
    const { result } = await observe(true, false);
    expect(result).toBe("superseded");
  });
});
