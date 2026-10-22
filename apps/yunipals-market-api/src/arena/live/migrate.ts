import pg from "pg";
import { migrateArena } from "./schema";

if (!process.env.ARENA_DATABASE_URL)
  throw new Error("ARENA_DATABASE_URL is required.");
const pool = new pg.Pool({
  connectionString: process.env.ARENA_DATABASE_URL,
  max: 1
});
try {
  await migrateArena(pool);
  console.log("Arena database schema is ready.");
} finally {
  await pool.end();
}
