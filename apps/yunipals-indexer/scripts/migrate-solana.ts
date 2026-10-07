import { pool } from "../lib/offchain/db.js";
import { solanaSchemaStatements } from "../lib/solana/schema.js";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('solana:indexer:migration'))");
  for (const statement of solanaSchemaStatements) await client.query(statement);
  await client.query(`INSERT INTO solana_indexer.schema_migration(version) VALUES(1)
    ON CONFLICT(version) DO NOTHING`);
  const versions = (await client.query<{ version: number }>(
    `SELECT version FROM solana_indexer.schema_migration ORDER BY version`
  )).rows.map(row => row.version);
  if (versions.length !== 1 || versions[0] !== 1) throw new Error("solana_unexpected_schema_version");
  await client.query("COMMIT");
  console.log(JSON.stringify({ solanaSchemaVersion: 1 }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
