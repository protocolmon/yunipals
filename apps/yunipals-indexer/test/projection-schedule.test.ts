import { describe, expect, it } from "vitest";

import {
  nextProjectionCheckAt,
  projectionBuildDue,
  projectionCheckComparesInputs,
  projectionRefreshSetting
} from "../lib/leaderboard/projection-schedule.js";

const ready = {
  source: "current" as const,
  projectionMode: "generation",
  metadataMode: "archive"
};
const at = (hour: number, minute = 0) =>
  Date.UTC(2026, 10, 11, hour, minute, 0);

describe("projection refresh setting", () => {
  it("stays off unless requested", () => {
    for (const value of [undefined, "", "off"])
      expect(
        projectionRefreshSetting({
          ...ready,
          env: { PROJECTION_REFRESH: value }
        })
      ).toEqual({ enabled: false });
  });

  it("builds changed data at 02:00 UTC by default, or at the set hour", () => {
    expect(
      projectionRefreshSetting({
        ...ready,
        env: { PROJECTION_REFRESH: "changed" }
      })
    ).toEqual({ enabled: true, buildHourUtc: 2 });
    expect(
      projectionRefreshSetting({
        ...ready,
        env: { PROJECTION_REFRESH: "changed", PROJECTION_BUILD_HOUR_UTC: "23" }
      })
    ).toEqual({ enabled: true, buildHourUtc: 23 });
  });

  it("rejects unknown modes and hours", () => {
    expect(() =>
      projectionRefreshSetting({
        ...ready,
        env: { PROJECTION_REFRESH: "daily" }
      })
    ).toThrow("PROJECTION_REFRESH must be off or changed");
    for (const hour of ["24", "-1", "02", "2.5", "x"])
      expect(() =>
        projectionRefreshSetting({
          ...ready,
          env: {
            PROJECTION_REFRESH: "changed",
            PROJECTION_BUILD_HOUR_UTC: hour
          }
        })
      ).toThrow("PROJECTION_BUILD_HOUR_UTC");
  });

  it("refuses combinations where a check would be wrong or a build would bind the leaderboard", () => {
    const env = { PROJECTION_REFRESH: "changed" };
    expect(() =>
      projectionRefreshSetting({ ...ready, env, source: "projection" })
    ).toThrow("LEADERBOARD_SOURCE=current");
    expect(() =>
      projectionRefreshSetting({ ...ready, env, projectionMode: "legacy" })
    ).toThrow("YUNIPALS_PROJECTION_MODE=generation");
    expect(() =>
      projectionRefreshSetting({ ...ready, env, metadataMode: "legacy-http" })
    ).toThrow("METADATA_SOURCE_MODE=archive");
  });
});

describe("projection schedule", () => {
  it("checks on the next full hour", () => {
    expect(nextProjectionCheckAt(at(1, 0))).toBe(at(2, 0));
    expect(nextProjectionCheckAt(at(1, 59) + 59_999)).toBe(at(2, 0));
    expect(nextProjectionCheckAt(at(23, 30))).toBe(at(24, 0));
  });

  it("compares inputs only in the build hour", () => {
    expect(projectionCheckComparesInputs(at(2, 0), 2)).toBe(true);
    expect(projectionCheckComparesInputs(at(2, 59), 2)).toBe(true);
    expect(projectionCheckComparesInputs(at(1, 59), 2)).toBe(false);
    expect(projectionCheckComparesInputs(at(3, 0), 2)).toBe(false);
    expect(projectionCheckComparesInputs(at(23, 0), 23)).toBe(true);
  });

  it("builds when readers reject the live generation or inputs changed", () => {
    expect(projectionBuildDue({ state: "unavailable" })).toBe(true);
    expect(
      projectionBuildDue({
        state: "changed",
        generationId: "130",
        metadataChanges: 3,
        tokenChanges: 0
      })
    ).toBe(true);
  });

  it("never builds when nothing changed or nothing was compared", () => {
    expect(
      projectionBuildDue({
        state: "current",
        generationId: "130",
        metadataChanges: 0,
        tokenChanges: 0
      })
    ).toBe(false);
    expect(
      projectionBuildDue({ state: "available", generationId: "130" })
    ).toBe(false);
  });
});
