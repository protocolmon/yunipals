import { pool } from "../lib/offchain/db.js";
import { solanaSchemaStatements } from "../lib/solana/schema.js";

try {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('solana:indexer:migration'))"
    );
    for (const statement of solanaSchemaStatements) await db.query(statement);
    await db.query(
      "INSERT INTO solana_indexer.schema_migration(version) VALUES(1) ON CONFLICT DO NOTHING"
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  console.log(
    JSON.stringify({ event: "solana_schema_ready", activated: false })
  );
} finally {
  await pool.end();
}
