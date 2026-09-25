import { pool } from "./db.js";
import { bnbSchemaStatements } from "./schema.js";

const db = await pool.connect();
try {
  await db.query("BEGIN");
  for (const statement of bnbSchemaStatements) await db.query(statement);
  await db.query("COMMIT");
  console.log("BNB indexer schema ready");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
