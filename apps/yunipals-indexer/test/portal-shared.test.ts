import { describe, expect, it } from "vitest";
import {
  applySharedPortalEvent,
  type PortalRows,
  type PortalDomain,
  type PortalProjectionStore
} from "../lib/unified/portal-projection.js";
import { portalSources } from "../lib/unified/portal-sources.js";
import {
  buildSharedIndexerManifest,
  assertRetainedIndexerSources
} from "../lib/unified/shared-deployment.js";
import type { PortalLedgerEvent } from "../lib/portals/ledger-store.js";
import { portalEvidenceRequestSchema } from "../lib/portals/action-evidence.js";
import {
  portalIndexExpectationHash,
  type PortalIndexRequest
} from "../../../packages/yunipals-market-core/src/portalIndex.js";

const addr = (n: number) => `0x${String(n).repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const zero = addr(0),
  alice = addr(1),
  bob = addr(2);
const configuration = Object.fromEntries(
  ["collection", "registry", "grading", "competition"].map((kind, i) => [
    kind,
    { address: `0x${["a", "b", "c", "d"][i]!.repeat(40)}`, startBlock: 100 + i }
  ])
);
const env = { UNIFIED_PORTALS_JSON: JSON.stringify(configuration) };
function projection() {
  const rows = new Map<string, unknown>();
  const store: PortalProjectionStore = {
    async get<K extends PortalDomain>(domain: K, key: string) {
      return (
        structuredClone(
          rows.get(`${domain}:${key}`) as PortalRows[K] | undefined
        ) ?? null
      );
    },
    async put(domain, key, row) {
      rows.set(`${domain}:${key}`, structuredClone(row));
    }
  };
  let index = 0;
  async function apply(type: string, args: Record<string, string>) {
    const before = structuredClone(rows);
    const event: PortalLedgerEvent = {
      type,
      args,
      source: addr(3),
      block: "100",
      blockHash: hash,
      transactionHash: hash,
      transactionIndex: 0,
      logIndex: index++,
      tokenId: args.portalId ?? args.tokenId ?? "0"
    };
    try {
      await applySharedPortalEvent(store, event, {
        batchSize: 111n,
        contribution: 500000n
      });
    } catch (error) {
      rows.clear();
      for (const [key, value] of before) rows.set(key, value);
      throw error;
    }
  }
  return { store, rows, apply };
}

describe("shared portal sources", () => {
  it("requires all four explicit emitters with independent history bounds", () => {
    const sources = portalSources(env);
    expect(sources).toHaveLength(4);
    expect(sources.map((s) => s.startBlock)).toEqual([
      "100",
      "101",
      "102",
      "103"
    ]);
    expect(sources.every((s) => s.receiptRequirement === "full")).toBe(true);
    expect(portalSources({})).toEqual([]);
    expect(() =>
      portalSources({
        UNIFIED_PORTALS_JSON: JSON.stringify({
          collection: configuration.collection
        })
      })
    ).toThrow();
    expect(() =>
      portalSources({
        UNIFIED_PORTALS_JSON: JSON.stringify({
          ...configuration,
          competition: configuration.collection
        })
      })
    ).toThrow();
    expect(() =>
      portalSources({
        UNIFIED_PORTALS_JSON: JSON.stringify({
          ...configuration,
          collection: { address: zero, startBlock: 1 }
        })
      })
    ).toThrow();
  });
  it("extends the shared release without changing retained definitions", () => {
    const base = {
      UNIFIED_BASE_ISLANDS_V2_ENABLED: "true",
      BOOSTER_REGISTRY: addr(1),
      BOOSTER_ENGINE: addr(2),
      BOOSTER_MONSTERS: addr(3),
      BOOSTER_WRAPPER: addr(4),
      BOOSTER_DEPLOYMENT_BLOCK: "10",
      MARKET_BNB_DISCOVERY_START_BLOCK: "10",
      UNIFIED_ANIME_REGISTRY: addr(5),
      UNIFIED_ANIME_REGISTRY_START_BLOCK: "10",
      UNIFIED_SHARED_ARENA: addr(6),
      UNIFIED_SHARED_ARENA_START_BLOCK: "10"
    };
    const old = buildSharedIndexerManifest(base),
      next = buildSharedIndexerManifest({ ...base, ...env });
    expect(next.sources.filter((s) => s.enabled)).toHaveLength(17);
    expect(() => assertRetainedIndexerSources(old, next)).not.toThrow();
    expect(() => assertRetainedIndexerSources(next, old)).toThrow();
    const changed = structuredClone(next);
    changed.sources.find((s) => s.id === "ownership:base")!.startBlock = "1";
    expect(() => assertRetainedIndexerSources(old, changed)).toThrow();
  });
});

describe("shared portal projections", () => {
  it("preserves a partial mint, transfer, fee accrual and retirement claim", async () => {
    const { apply, store } = projection();
    await apply("MintCommitted", {
      requestId: "1",
      kindId: "1",
      quantity: "2"
    });
    await apply("Transfer", { tokenId: "1000", from: zero, to: alice });
    await apply("PortalMinted", {
      tokenId: "1000",
      kindId: "1",
      requestId: "1",
      recipient: alice
    });
    expect((await store.get("mint", `${addr(3)}:1`))?.delivered).toBe(1);
    await apply("PortalFeeAccrued", {
      portalId: "1000",
      amount: "245000",
      newBalance: "245000"
    });
    await apply("Transfer", { tokenId: "1000", from: alice, to: bob });
    expect((await store.get("token", "1000"))?.balance).toBe("245000");
    await expect(
      apply("Transfer", { tokenId: "1000", from: alice, to: zero })
    ).rejects.toThrow();
    await apply("Transfer", { tokenId: "1000", from: bob, to: zero });
    await apply("PortalClaimed", {
      portalId: "1000",
      owner: bob,
      amount: "245000"
    });
    expect(await store.get("token", "1000")).toMatchObject({
      retired: true,
      claimant: bob,
      earned: "245000",
      claimed: "245000",
      balance: "0"
    });
    await expect(
      apply("PortalClaimed", { portalId: "1000", owner: bob, amount: "0" })
    ).rejects.toThrow();
  });
  it("rejects a delivery without its commitment and a grade with the wrong input version", async () => {
    const { apply, store } = projection();
    await apply("Transfer", { tokenId: "1", from: zero, to: alice });
    await expect(
      apply("PortalMinted", {
        tokenId: "1",
        kindId: "1",
        requestId: "1",
        recipient: alice
      })
    ).rejects.toThrow();
    await apply("GradingRequested", {
      requestId: "1",
      tokenId: "2",
      submitter: alice,
      portalId: "1",
      inputVersion: "3",
      spellCommitment: hash
    });
    await expect(
      apply("GradingCompleted", {
        requestId: "1",
        tokenId: "2",
        version: "5",
        scores: "1,2,3,4",
        artworkHash: hash,
        reportHash: hash
      })
    ).rejects.toThrow();
    await apply("GradingCompleted", {
      requestId: "1",
      tokenId: "2",
      version: "4",
      scores: "90,95,80,75",
      artworkHash: hash,
      reportHash: hash
    });
    expect((await store.get("request", "1"))?.scores).toEqual([90, 95, 80, 75]);
  });
  it("settles 111 entries with out-of-order grades and ties, preserving entry 112", async () => {
    const { apply, store } = projection();
    for (let i = 1; i <= 112; i++)
      await apply("CompetitionEntered", {
        entryId: String(i),
        requestId: String(i),
        batchId: i <= 111 ? "1" : "2",
        submitter: i % 2 ? alice : bob,
        amount: "500000"
      });
    await apply("CompetitionResult", {
      entryId: "112",
      requestId: "112",
      batchId: "2",
      score: "400"
    });
    await expect(apply("CompetitionReady", { batchId: "1" })).rejects.toThrow();
    for (let i = 111; i >= 1; i--)
      await apply("CompetitionResult", {
        entryId: String(i),
        requestId: String(i),
        batchId: "1",
        score: i <= 3 ? "400" : "300"
      });
    await apply("CompetitionReady", { batchId: "1" });
    await expect(
      apply("CompetitionSettled", {
        batchId: "1",
        first: "112",
        second: "1",
        third: "2"
      })
    ).rejects.toThrow();
    await apply("CompetitionSettled", {
      batchId: "1",
      first: "1",
      second: "2",
      third: "3"
    });
    for (const [rank, amount] of ["27750000", "16650000", "11100000"].entries())
      await apply("CompetitionPrizePaid", {
        batchId: "1",
        rank: String(rank),
        winner: rank === 1 ? bob : alice,
        amount
      });
    expect(await store.get("batch", "2")).toMatchObject({
      funded: 1,
      completed: 1,
      pool: "500000",
      winners: null
    });
    await expect(
      apply("CompetitionPrizePaid", {
        batchId: "1",
        rank: "0",
        winner: alice,
        amount: "27750000"
      })
    ).rejects.toThrow();
  });
});

it("binds v2 requests to the shared release while retaining v1 hashes", () => {
  const request: PortalIndexRequest = {
    version: 1,
    sourceId: hash,
    generation: null,
    chainId: 8453,
    transactionHash: hash,
    blockNumber: "1",
    blockHash: hash,
    sender: alice,
    events: [{ source: addr(3), name: "Transfer", logIndex: 0, digest: hash }]
  };
  expect(portalEvidenceRequestSchema.parse(request)).toEqual(request);
  const next = {
    ...request,
    version: 2 as const,
    shared: { releaseId: hash, readIdentity: hash }
  };
  expect(portalEvidenceRequestSchema.parse(next)).toEqual(next);
  expect(portalIndexExpectationHash(next)).not.toBe(
    portalIndexExpectationHash(request)
  );
  expect(() =>
    portalEvidenceRequestSchema.parse({ ...request, version: 2 })
  ).toThrow();
  expect(() =>
    portalEvidenceRequestSchema.parse({ ...request, shared: next.shared })
  ).toThrow();
});
