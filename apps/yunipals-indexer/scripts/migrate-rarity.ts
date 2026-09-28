import { closePool, pool } from "../lib/offchain/db.js";
import { migrations } from "../lib/offchain/migrations.js";

const firstRarityMigration = migrations.findIndex((sql) =>
  sql.includes("CREATE TABLE IF NOT EXISTS metadata.token_rarity")
);

if (firstRarityMigration < 0) {
  throw new Error("The token rarity migration is missing");
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "LOCK TABLE metadata.schema_migration IN SHARE ROW EXCLUSIVE MODE"
  );
  const appliedResult = await client.query<{ version: number }>(
    "SELECT version FROM metadata.schema_migration ORDER BY version"
  );
  const applied = new Set(appliedResult.rows.map((row) => row.version));

  for (let version = 1; version <= firstRarityMigration; version += 1) {
    if (!applied.has(version)) {
      throw new Error(`Required schema migration ${version} is not applied`);
    }
  }

  for (let index = firstRarityMigration; index < migrations.length; index += 1) {
    const version = index + 1;
    if (applied.has(version)) continue;
    await client.query(migrations[index]);
    await client.query(
      "INSERT INTO metadata.schema_migration(version) VALUES ($1) ON CONFLICT DO NOTHING",
      [version]
    );
  }

  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      status: "complete",
      firstVersion: firstRarityMigration + 1,
      lastVersion: migrations.length
    })
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closePool();
}
