import type { ProjectionCheck } from "../metadata/projection-check.js";
import type { LeaderboardSource } from "./source.js";

export type ProjectionRefresh =
  { enabled: false } | { enabled: true; buildHourUtc: number };

/** PROJECTION_REFRESH=changed rebuilds search and traits only when their
 * inputs changed, alongside a leaderboard computed from current data. A build
 * keeps one database snapshot open for about half an hour, so changed data
 * waits for PROJECTION_BUILD_HOUR_UTC (default 2). */
export function projectionRefreshSetting(input: {
  env?: NodeJS.ProcessEnv;
  source: LeaderboardSource;
  projectionMode: string;
  metadataMode: string;
}): ProjectionRefresh {
  const env = input.env ?? process.env;
  const value = env.PROJECTION_REFRESH ?? "off";
  if (value === "" || value === "off") return { enabled: false };
  if (value !== "changed")
    throw new Error("PROJECTION_REFRESH must be off or changed");
  if (input.source !== "current")
    throw new Error(
      "PROJECTION_REFRESH=changed requires LEADERBOARD_SOURCE=current"
    );
  if (input.projectionMode !== "generation")
    throw new Error(
      "PROJECTION_REFRESH=changed requires YUNIPALS_PROJECTION_MODE=generation"
    );
  if (input.metadataMode !== "archive")
    throw new Error(
      "PROJECTION_REFRESH=changed requires METADATA_SOURCE_MODE=archive"
    );
  const hour = env.PROJECTION_BUILD_HOUR_UTC ?? "2";
  if (!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(hour))
    throw new Error("PROJECTION_BUILD_HOUR_UTC must be an hour from 0 to 23");
  return { enabled: true, buildHourUtc: Number(hour) };
}

/** Checks run on the hour, so one always falls within the build hour. */
export function nextProjectionCheckAt(now: number) {
  return (Math.floor(now / 3_600_000) + 1) * 3_600_000;
}

/** Every hourly check asks whether readers still accept the live generation,
 * which is one cheap query. Comparing every token's inputs takes minutes, so
 * only the check in the build hour does it. */
export function projectionCheckComparesInputs(
  checkedAt: number,
  buildHourUtc: number
) {
  return new Date(checkedAt).getUTCHours() === buildHourUtc;
}

/** Build at once when readers reject the live generation, because search and
 * traits are failing. Changed inputs are only found in the build hour. */
export function projectionBuildDue(check: ProjectionCheck) {
  return check.state === "unavailable" || check.state === "changed";
}
