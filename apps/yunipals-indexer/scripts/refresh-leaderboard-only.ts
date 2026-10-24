// Explicit forward completion after an acknowledged generation publication.
// This command never calls refreshTraitIndex or creates another generation.
import { pool } from "../lib/offchain/db.js";
import { refreshLeaderboard } from "../lib/leaderboard/refresh.js";
import { nativeProjectionSnapshotEnabled } from "../lib/metadata/projection-snapshot.js";
import { projectionMode } from "../lib/metadata/projection-mode.js";

const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== "--generation" ||
  !/^[1-9][0-9]{0,18}$/.test(args[1] ?? "") ||
  !nativeProjectionSnapshotEnabled() ||
  projectionMode() !== "generation"
)
  throw new Error(
    "Usage: native leaderboard-only completion --generation <published-generation-id>"
  );
try {
  const result = await refreshLeaderboard(args[1]);
  console.log(
    JSON.stringify({
      completed: true,
      generationId: args[1],
      traitsRebuilt: false,
      ...result
    })
  );
} finally {
  await pool.end();
}
