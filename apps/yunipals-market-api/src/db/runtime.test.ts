import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { enqueueJob } from "@/db/jobs";
import { assertReady } from "@/db/readiness";

const url = process.env.MARKET_TEST_RUNTIME_DATABASE_URL;
if (!url)
  throw new Error(
    "Set MARKET_TEST_RUNTIME_DATABASE_URL to the restricted role in the isolated *_test database."
  );
const parsed = new URL(url);
if (
  !/^\/[a-z0-9_]+_test$/.test(parsed.pathname) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
)
  throw new Error("Runtime tests require a loopback database ending in _test.");
const pool = new pg.Pool({
  connectionString: url,
  max: 2,
  statement_timeout: 5000,
  connectionTimeoutMillis: 1500
});
after(async () => {
  await pool.end();
});

test("runtime can operate its queue but cannot change migrations, registry or indexer tables", async () => {
  await assertReady(pool, "staging");
  await assert.rejects(assertReady(pool, "production"));
  assert.ok(
    await enqueueJob(pool, {
      kind: "runtime_grants",
      key: randomUUID(),
      payload: {}
    })
  );
  await pool.query("SELECT id FROM indexer_guard.token LIMIT 1");
  for (const sql of [
    "UPDATE yunipals_market.schema_migration SET checksum='bad' WHERE false",
    "UPDATE yunipals_market.collection SET slug='bad' WHERE false",
    "UPDATE yunipals_market.deployment SET environment='production' WHERE false",
    "DELETE FROM indexer_guard.token WHERE false",
    "CREATE TABLE yunipals_market.runtime_must_not_create(id integer)"
  ])
    await assert.rejects(pool.query(sql), (error: unknown) => {
      assert.equal((error as { code: string }).code, "42501");
      return true;
    });
});
