// Disposable local PG16 only: proves the limit against a real server.
import assert from "node:assert/strict";
import pg from "pg";
import { boundedRead } from "../lib/metadata/bounded-read.ts";

const pool = new pg.Pool({
  connectionString:
    "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres",
  // Production's worker can run with a single connection, so it must be reused.
  max: 1
});
const checks = [];
const setting = async () =>
  (await pool.query("SHOW statement_timeout")).rows[0].statement_timeout;
try {
  assert.equal(await setting(), "0");

  assert.equal(
    await boundedRead(pool, "5min", async (client) => {
      assert.equal(
        (await client.query("SHOW statement_timeout")).rows[0]
          .statement_timeout,
        "5min"
      );
      return (await client.query("SELECT 7 AS value")).rows[0].value;
    }),
    7
  );
  checks.push("a read returns its result under the configured limit");

  const started = Date.now();
  await assert.rejects(
    boundedRead(pool, "200ms", (client) => client.query("SELECT pg_sleep(30)")),
    (error) => error.code === "57014"
  );
  assert.ok(Date.now() - started < 10_000);
  checks.push("a slow read is cancelled by the limit");

  const open = await pool.query(
    `SELECT count(*)::int AS count FROM pg_stat_activity
     WHERE datname=current_database() AND pid<>pg_backend_pid() AND xact_start IS NOT NULL`
  );
  assert.equal(open.rows[0].count, 0);
  assert.equal(await setting(), "0");
  checks.push(
    "a cancelled read leaves no open transaction and no lasting limit on the connection"
  );

  await assert.rejects(
    boundedRead(pool, "5min", (client) =>
      client.query("CREATE TABLE bounded_read_check(value integer)")
    ),
    (error) => error.code === "25006"
  );
  assert.equal(
    (await pool.query("SELECT to_regclass('bounded_read_check') AS name"))
      .rows[0].name,
    null
  );
  checks.push("the bounded transaction refuses writes");

  console.log(
    JSON.stringify({ event: "metadata_bounded_read_postgres_verified", checks })
  );
} finally {
  await pool.end();
}
