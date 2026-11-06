/**
 * Where the leaderboard worker reads its inputs.
 * - "projection": rebuild the projection generation (search, traits and the
 *   leaderboard bound to it), then complete the leaderboard. This is the default.
 * - "current": recompute only the leaderboard from current ownership and
 *   metadata. Projection generations are then not rebuilt by this worker.
 */
export type LeaderboardSource = "projection" | "current";

export function leaderboardSource(
  value = process.env.LEADERBOARD_SOURCE
): LeaderboardSource {
  if (value === undefined || value === "" || value === "projection")
    return "projection";
  if (value === "current") return "current";
  throw new Error("LEADERBOARD_SOURCE must be projection or current");
}
