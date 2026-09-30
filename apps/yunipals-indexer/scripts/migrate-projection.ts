import { closePool, pool } from "../lib/offchain/db.js";
import { projectionSchemaStatements } from "../lib/metadata/projection-schema.js";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const statement of projectionSchemaStatements) await client.query(statement);
  await client.query("COMMIT");
  console.log("Projection schema installed");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await closePool();
}
