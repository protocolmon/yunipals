import { pool, apiPool } from "../lib/offchain/db.js";
import { assertProjectionBuildCapacity } from "../lib/metadata/projection-refresh.js";
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  await assertProjectionBuildCapacity(client);
  await assertProjectionBuildCapacity(client, "leaderboard");
  await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      event: "projection_capacity_verified",
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
