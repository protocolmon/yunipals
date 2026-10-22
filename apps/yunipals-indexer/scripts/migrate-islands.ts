import { pool, closePool } from "../lib/offchain/db.js";
import { migrations } from "../lib/offchain/migrations.js";
import { islandsMigrations } from "../lib/islands/schema.js";

// Isolated deployments append the same ledger entries without recreating the
// production monster read views or rebuilding its indexes.
const firstIslandsVersion = migrations.length - islandsMigrations.length + 1;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("LOCK TABLE metadata.schema_migration IN EXCLUSIVE MODE");
  const result = await client.query<{ version: number }>(
    "SELECT version FROM metadata.schema_migration"
  );
  const applied = new Set(result.rows.map((row) => row.version));
  for (let version = 1; version < firstIslandsVersion; version++) {
    if (!applied.has(version)) {
      throw new Error(`Existing migration ${version} must be applied first`);
    }
  }
  for (const [index, sql] of islandsMigrations.entries()) {
    const version = firstIslandsVersion + index;
    if (applied.has(version)) continue;
    await client.query(sql);
    await client.query(
      "INSERT INTO metadata.schema_migration(version) VALUES ($1)",
      [version]
    );
  }
  await client.query("COMMIT");
  console.log("Applied Islands migrations without changing monster read views");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closePool();
}
