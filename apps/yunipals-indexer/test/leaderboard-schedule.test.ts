import { describe, expect, it } from "vitest";

import {
  leaderboardSchedule,
  nextLeaderboardRefreshAt
} from "../lib/leaderboard/schedule.js";

const day = 86_400_000;
const hour = 3_600_000;

describe("leaderboard schedule", () => {
  it("defaults to hourly refreshes and hourly retries", () => {
    expect(leaderboardSchedule({})).toEqual({ refreshMs: hour, retryMs: hour });
  });

  it("retries a daily refresh after an hour", () => {
    expect(
      leaderboardSchedule({ LEADERBOARD_REFRESH_MS: String(day) })
    ).toEqual({ refreshMs: day, retryMs: hour });
  });

  it("never waits longer for a retry than for a refresh", () => {
    expect(
      leaderboardSchedule({
        LEADERBOARD_REFRESH_MS: String(10 * 60_000),
        LEADERBOARD_RETRY_MS: String(hour)
      })
    ).toEqual({ refreshMs: 10 * 60_000, retryMs: 10 * 60_000 });
  });

  it("rejects intervals that would spin or never run", () => {
    for (const value of ["abc", "0", "-1", "59999", "1.5e5", "Infinity"])
      expect(() =>
        leaderboardSchedule({ LEADERBOARD_RETRY_MS: value })
      ).toThrow("LEADERBOARD_RETRY_MS");
    expect(() => leaderboardSchedule({ LEADERBOARD_REFRESH_MS: "x" })).toThrow(
      "LEADERBOARD_REFRESH_MS"
    );
  });

  it("schedules a success from its start, so runs do not drift", () => {
    const schedule = { refreshMs: day, retryMs: hour };
    const startedAt = Date.UTC(2026, 10, 9, 23, 24, 30);
    // An 8-minute refresh followed by a 1-minute ENS update.
    const finishedAt = startedAt + 9 * 60_000;
    expect(
      nextLeaderboardRefreshAt(
        { startedAt, finishedAt, succeeded: true },
        schedule
      )
    ).toBe(startedAt + day);
  });

  it("does not schedule a success in the past when a run outlasts the interval", () => {
    const schedule = { refreshMs: hour, retryMs: hour };
    const startedAt = 0;
    const finishedAt = 90 * 60_000;
    expect(
      nextLeaderboardRefreshAt(
        { startedAt, finishedAt, succeeded: true },
        schedule
      )
    ).toBe(finishedAt);
  });

  it("retries a failure after the retry interval, not the refresh interval", () => {
    const schedule = { refreshMs: day, retryMs: hour };
    const finishedAt = Date.UTC(2026, 10, 10, 23, 30);
    expect(
      nextLeaderboardRefreshAt(
        { startedAt: finishedAt - 60_000, finishedAt, succeeded: false },
        schedule
      )
    ).toBe(finishedAt + hour);
  });
});
