import pg from "pg";
import { installReadCache } from "../lib/metadata/read-cache-schema.js";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SET LOCAL lock_timeout='1s'");
  await db.query("SET LOCAL statement_timeout='60s'");
  await installReadCache(db);
  await db.query("COMMIT");
  console.log(JSON.stringify({ event: "read_cache_migrated" }));
} catch (error) {
  await db.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await db.end();
}
