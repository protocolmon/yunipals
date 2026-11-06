import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  locked: true,
  failOn: "" as string
}));
vi.mock("../lib/offchain/db.js", () => ({ pool: {}, apiPool: {} }));
vi.mock("../lib/ownership/readiness.js", () => ({
  assertOwnershipAvailable: async () => {
    state.calls.push("ownership-ready");
    if (state.failOn === "ownership") throw new Error("ownership_unavailable");
  },
  assertOwnershipSourceSelection: async () => undefined,
  ownershipReadIdentity: async () => null
}));
vi.mock("../lib/metadata/chain-readiness.js", () => ({
  assertChainReady: async () => state.calls.push("chains-ready")
}));
vi.mock("../lib/ownership/derived-snapshot.js", () => ({
  stampDerivedSnapshot: async (_db: unknown, name: string) =>
    state.calls.push(`stamp:${name}`)
}));
import { refreshLeaderboardFromCurrentData } from "../lib/leaderboard/refresh.js";
import { leaderboardSource } from "../lib/leaderboard/source.js";

function fakeDb() {
  let released = false;
  const client = {
    async query(sql: string) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT pg_try_advisory_lock")) {
        state.calls.push("lock");
        return { rows: [{ acquired: state.locked }] };
      }
      if (text.startsWith("SELECT pg_advisory_unlock(")) {
        state.calls.push("unlock");
        return { rows: [] };
      }
      if (text.startsWith("CREATE TEMP TABLE next_wallet_stats")) {
        state.calls.push("create-temp");
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO next_wallet_stats")) {
        state.calls.push("compute");
        if (state.failOn === "compute") throw new Error("canceling statement");
        return { rows: [] };
      }
      if (text.startsWith("DELETE FROM leaderboard.wallet_stats")) {
        state.calls.push("delete");
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO leaderboard.wallet_stats")) {
        state.calls.push("insert");
        return { rows: [] };
      }
      if (text.startsWith("SELECT count(*) FROM leaderboard.wallet_stats"))
        return { rows: [{ count: "62956" }] };
      if (text.startsWith("SELECT set_config('statement_timeout'")) {
        state.calls.push("timeouts");
        return { rows: [] };
      }
      state.calls.push(text.split(" ").slice(0, 4).join(" "));
      return { rows: [] };
    },
    release() {
      released = true;
    }
  };
  return {
    db: { connect: async () => client } as never,
    released: () => released
  };
}

beforeEach(() => {
  state.calls = [];
  state.locked = true;
  state.failOn = "";
});

describe("leaderboard from current data", () => {
  it("computes, replaces and stamps the leaderboard in one transaction", async () => {
    const fake = fakeDb();
    const result = await refreshLeaderboardFromCurrentData(fake.db);
    expect(result.wallets).toBe(62956);
    expect(state.calls).toEqual([
      "lock",
      "BEGIN ISOLATION LEVEL REPEATABLE",
      "timeouts",
      "ownership-ready",
      "create-temp",
      "compute",
      "delete",
      "insert",
      "stamp:leaderboard",
      "COMMIT",
      "unlock"
    ]);
    expect(fake.released()).toBe(true);
  });

  it("does nothing when another refresh holds the lock", async () => {
    state.locked = false;
    const fake = fakeDb();
    await expect(refreshLeaderboardFromCurrentData(fake.db)).rejects.toThrow(
      "leaderboard_refresh_busy"
    );
    expect(state.calls).toEqual(["lock", "ROLLBACK"]);
    expect(fake.released()).toBe(true);
  });

  it("rolls back and keeps the previous leaderboard when a step fails", async () => {
    for (const failOn of ["ownership", "compute"]) {
      state.calls = [];
      state.failOn = failOn;
      const fake = fakeDb();
      await expect(
        refreshLeaderboardFromCurrentData(fake.db)
      ).rejects.toThrow();
      expect(state.calls).not.toContain("delete");
      expect(state.calls).not.toContain("COMMIT");
      expect(state.calls.slice(-2)).toEqual(["ROLLBACK", "unlock"]);
      expect(fake.released()).toBe(true);
    }
  });
});

describe("leaderboard input source setting", () => {
  it("defaults to the projection and accepts current", () => {
    expect(leaderboardSource(undefined)).toBe("projection");
    expect(leaderboardSource("")).toBe("projection");
    expect(leaderboardSource("projection")).toBe("projection");
    expect(leaderboardSource("current")).toBe("current");
    expect(() => leaderboardSource("live")).toThrow();
  });
});
