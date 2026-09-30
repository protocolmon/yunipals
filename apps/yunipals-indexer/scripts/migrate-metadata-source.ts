import { migrations } from "../lib/offchain/migrations.js";
import { archiveMigrations } from "../lib/metadata/source/schema.js";
import { argumentsOf, postgresFrom, safeFailure } from "./metadata/support.js";

const args = argumentsOf();
async function main() {
  const { pool } = await postgresFrom(String(args["env-file"]));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('metadata_source_schema'))");
    const offset = migrations.indexOf(archiveMigrations[0]);
    const applied = new Set((await client.query<{ version: number }>(
      "SELECT version FROM metadata.schema_migration ORDER BY version")).rows.map(row => row.version));
    for (let i = 1; i <= offset; i++) {
      if (!applied.has(i)) throw new Error("Existing migration ledger is incomplete; run db:migrate first");
    }
    for (const [index, sql] of archiveMigrations.entries()) {
      const version = offset + index + 1;
      if (applied.has(version)) continue;
      await client.query(sql);
      await client.query("INSERT INTO metadata.schema_migration(version) VALUES ($1)", [version]);
    }
    await client.query("COMMIT");
    console.log("Durable archive schema migrated; chain tables and read views were not modified");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(safeFailure(error)); process.exitCode = 1; });
