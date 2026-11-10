export type LeaderboardSchedule = { refreshMs: number; retryMs: number };

function interval(name: string, value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 60_000)
    throw new Error(`${name} must be a whole number of at least 60000`);
  return parsed;
}

/** How often the leaderboard refreshes, and how soon a failed refresh is
 * retried. A retry never waits longer than a normal refresh. */
export function leaderboardSchedule(
  env: NodeJS.ProcessEnv = process.env
): LeaderboardSchedule {
  const refreshMs = interval(
    "LEADERBOARD_REFRESH_MS",
    env.LEADERBOARD_REFRESH_MS,
    3_600_000
  );
  const retryMs = interval(
    "LEADERBOARD_RETRY_MS",
    env.LEADERBOARD_RETRY_MS,
    3_600_000
  );
  return { refreshMs, retryMs: Math.min(retryMs, refreshMs) };
}

/** A success counts the interval from the run's start, as the worker does at
 * startup, so the time a refresh takes does not push every later run back. A
 * failure retries after the retry interval. */
export function nextLeaderboardRefreshAt(
  run: { startedAt: number; finishedAt: number; succeeded: boolean },
  schedule: LeaderboardSchedule
) {
  return run.succeeded
    ? Math.max(run.startedAt + schedule.refreshMs, run.finishedAt)
    : run.finishedAt + schedule.retryMs;
}
