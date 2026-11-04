import { pool, apiPool } from "../lib/offchain/db.js";
import { assertProjectionBuildCapacity } from "../lib/metadata/projection-refresh.js";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: { phase: { type: "string", default: "all" } }
});
const client = await pool.connect();
try {
  const phase = values.phase;
  if (phase !== "all" && phase !== "generation" && phase !== "leaderboard")
    throw new Error("projection_invalid_capacity_phase");
  const phases: Array<"generation" | "leaderboard"> =
    phase === "all" ? ["generation", "leaderboard"] : [phase];
  await client.query("BEGIN READ ONLY");
  for (const selected of phases)
    await assertProjectionBuildCapacity(client, selected);
  await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      event: "projection_capacity_verified",
      phase,
      productionWrites: 0
    })
  );
} catch (error) {
  const code =
    error instanceof Error && error.message.startsWith("projection_")
      ? error.message
      : error && typeof error === "object" && "code" in error
        ? `database_error_${String(error.code)}`
        : "projection_capacity_check_refused";
  console.error(
    JSON.stringify({
      event: "projection_capacity_refused",
      code,
      productionWrites: 0
    })
  );
  process.exitCode = 1;
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await Promise.all([pool.end(), apiPool.end()]);
}
