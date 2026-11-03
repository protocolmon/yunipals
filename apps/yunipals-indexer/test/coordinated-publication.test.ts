import type { PoolClient } from "pg";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[], fail: "" }));
vi.mock("../lib/metadata/projection-snapshot.js", () => ({
  projectionSourceSnapshot: (value: unknown) => value
}));
vi.mock("../lib/metadata/read-cache.js", () => ({
  preparedReadCacheFreshSql: () => "candidate_cache_proof"
}));
vi.mock("../lib/metadata/projection-refresh.js", () => ({
  retainProjectionAnchors: async () => state.calls.push("retain"),
  publishGenerationInTransaction: async () => {
    state.calls.push("publish");
    if (state.fail === "publish") throw Error("projection_source_changed");
  }
}));
vi.mock("../lib/leaderboard/native-preparation.js", () => ({
  prepareNativeLeaderboardCandidate: async () => {
    state.calls.push("prepare");
    return {
      metadataReleaseId: "archive",
      sourceSnapshot: {},
      walletRows: "12",
      walletRowsSha256: "hash"
    };
  },
  stagePreparedNativeLeaderboard: async () => state.calls.push("stage")
}));
import {
  PublicationCommitUnconfirmed,
  publishPreparedGeneration
} from "../lib/metadata/coordinated-publication.js";

beforeEach(() => {
  state.calls = [];
  state.fail = "";
});
function fixture() {
  let commits = 0;
  const client = {
    query: async (sql: string) => {
      state.calls.push(sql);
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ acquired: true }] };
      if (sql.includes("AS snapshot"))
        return { rows: [{ snapshot: { predecessor: "114" } }] };
      if (sql.includes("AS fresh"))
        return { rows: [{ fresh: state.fail !== "cache" }] };
      if (sql.includes("AS xid")) return { rows: [{ xid: "1234" }] };
      if (sql === "COMMIT" && ++commits === 2 && state.fail === "commit")
        throw Error("connection lost");
      return { rows: [] };
    }
  } as unknown as PoolClient;
  const input = {
    generationId: "115",
    predecessor: "114",
    refreshApproval: async () => state.calls.push("refresh"),
    record: async (phase: string) => {
      state.calls.push(phase);
      if (state.fail === phase) throw Error("journal unavailable");
    }
  };
  return { client, input };
}
it("commits only private preparation before staging and atomically publishing global data", async () => {
  const { client, input } = fixture();
  await publishPreparedGeneration(client, input);
  const phases = state.calls.filter((value) =>
    [
      "prepare",
      "wallet_prepared",
      "COMMIT",
      "stage",
      "publish",
      "publication_intent",
      "publication_committed"
    ].includes(value)
  );
  expect(phases).toEqual([
    "prepare",
    "wallet_prepared",
    "COMMIT",
    "stage",
    "publish",
    "publication_intent",
    "COMMIT",
    "publication_committed"
  ]);
  expect(state.calls.filter((value) => value.startsWith("BEGIN"))).toEqual([
    "BEGIN ISOLATION LEVEL REPEATABLE READ",
    "BEGIN ISOLATION LEVEL READ COMMITTED"
  ]);
});
it.each(["publish", "publication_intent"])(
  "rolls back global staging if %s fails",
  async (failure) => {
    const { client, input } = fixture();
    state.fail = failure;
    await expect(publishPreparedGeneration(client, input)).rejects.toThrow();
    expect(state.calls).toContain("ROLLBACK");
    expect(state.calls.filter((value) => value === "COMMIT")).toHaveLength(1);
    expect(state.calls).not.toContain("publication_committed");
  }
);
it("refuses stale candidate cache before private computation or a global transaction", async () => {
  const { client, input } = fixture();
  state.fail = "cache";
  await expect(publishPreparedGeneration(client, input)).rejects.toThrow(
    "projection_prepared_cache_unavailable"
  );
  expect(state.calls).not.toContain("prepare");
  expect(state.calls.some((value) => value.startsWith("BEGIN"))).toBe(false);
});
it("surfaces an ambiguous final COMMIT without retrying publication", async () => {
  const { client, input } = fixture();
  state.fail = "commit";
  await expect(publishPreparedGeneration(client, input)).rejects.toBeInstanceOf(
    PublicationCommitUnconfirmed
  );
  expect(state.calls.filter((value) => value === "publish")).toHaveLength(1);
  expect(state.calls).not.toContain("publication_committed");
});
