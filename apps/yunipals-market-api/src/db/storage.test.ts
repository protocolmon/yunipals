import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import pg from "pg";

import {
  claimJob,
  completeJob,
  enqueueJob,
  LostJobLeaseError,
  renewJob,
  retryJob
} from "@/db/jobs";
import { migrate } from "@/db/migrate";
import { transaction } from "@/db/pool";
import { assertReady } from "@/db/readiness";

// An explicitly named disposable database is required. Never default to the API's URL.
const url = process.env.MARKET_TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set MARKET_TEST_DATABASE_URL to an isolated *_test database to run storage tests."
  );
const parsed = new URL(url);
if (
  !/^\/[a-z0-9_]+_test$/.test(parsed.pathname) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
)
  throw new Error("Storage tests require a loopback database ending in _test.");
const pool = new pg.Pool({
  connectionString: url,
  max: 12,
  statement_timeout: 5000,
  connectionTimeoutMillis: 1500
});

before(async () => {
  await migrate(pool, "staging");
});
after(async () => {
  await pool.end();
});

test("migrations are repeatable and reject deployment/history drift", async () => {
  assert.deepEqual(await migrate(pool, "staging"), []);
  assert.deepEqual(
    await Promise.all([migrate(pool, "staging"), migrate(pool, "staging")]),
    [[], []]
  );
  await assert.rejects(migrate(pool, "production"), /deployment marker/);
  assert.equal(
    (await pool.query("SELECT environment FROM yunipals_market.deployment"))
      .rows[0].environment,
    "staging"
  );
  await pool.query(
    "UPDATE yunipals_market.schema_migration SET checksum='changed' WHERE version=1"
  );
  try {
    await assert.rejects(migrate(pool, "staging"), /history/);
  } finally {
    const { migrationChecksum } = await import("@/db/migrate");
    const { migrations } = await import("@/db/migrations");
    await pool.query(
      "UPDATE yunipals_market.schema_migration SET checksum=$1 WHERE version=1",
      [migrationChecksum(migrations[0].sql)]
    );
  }
  await assert.rejects(assertReady(pool, "staging"), /runtime role/);
});

test("amounts retain exact uint256 precision and reject fractions, overflow and nonnumbers", async () => {
  const maximum = ((1n << 256n) - 1n).toString();
  assert.equal(
    (
      await pool.query("SELECT $1::yunipals_market.uint256::text AS value", [
        maximum
      ])
    ).rows[0].value,
    maximum
  );
  for (const value of ["1.5", "-1", (1n << 256n).toString(), "NaN", "Infinity"])
    await assert.rejects(
      pool.query("SELECT $1::yunipals_market.uint256", [value])
    );
});

test("concurrent duplicate admission creates one durable job and preserves its first payload", async () => {
  const key = randomUUID();
  const ids = await Promise.all(
    Array.from({ length: 12 }, () =>
      enqueueJob(pool, { kind: "dedup", key, payload: { order: key } })
    )
  );
  assert.equal(new Set(ids).size, 1);
  assert.equal(
    await enqueueJob(pool, { kind: "dedup", key, payload: { replaced: true } }),
    ids[0]
  );
  assert.deepEqual(
    (
      await pool.query("SELECT payload FROM yunipals_market.job WHERE id=$1", [
        ids[0]
      ])
    ).rows[0].payload,
    { order: key }
  );
});

test("aborted admission cannot leave queued work behind", async () => {
  const key = randomUUID();
  await assert.rejects(
    transaction(pool, async (client) => {
      await enqueueJob(client, { kind: "rollback", key, payload: {} });
      throw new Error("admission failed");
    })
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM yunipals_market.job WHERE deduplication_key=$1",
        [key]
      )
    ).rowCount,
    0
  );
});

test("concurrent workers claim different jobs and stale workers cannot commit effects", async () => {
  const kind = `claim_${randomUUID()}`;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      enqueueJob(pool, { kind, key: randomUUID(), payload: {} })
    )
  );
  const claimed = (
    await Promise.all(Array.from({ length: 8 }, () => claimJob(pool, kind)))
  ).map((job) => {
    assert.ok(job);
    return job;
  });
  assert.equal(new Set(claimed.map((job) => job.id)).size, 8);
  const old = claimed[0]!;
  await pool.query(
    "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [old.id]
  );
  const replacement = await claimJob(pool, kind);
  assert.ok(replacement);
  assert.equal(replacement.id, old.id);
  assert.notEqual(replacement.leaseToken, old.leaseToken);
  assert.equal(replacement.attempts, 2);
  assert.equal(await renewJob(pool, old), false);
  assert.equal(await retryJob(pool, old, "rpc_unavailable", 1000), false);
  let staleCallback = false;
  await assert.rejects(
    completeJob(pool, old, async () => {
      staleCallback = true;
    }),
    LostJobLeaseError
  );
  assert.equal(staleCallback, false);
  await completeJob(pool, replacement, async (client) => {
    await enqueueJob(client, {
      kind: "committed_effect",
      key: old.id,
      payload: { recovered: true }
    });
  });
  assert.equal(
    (
      await pool.query("SELECT state FROM yunipals_market.job WHERE id=$1", [
        old.id
      ])
    ).rows[0].state,
    "completed"
  );
});

test("lease expiry during the commit transaction rolls back all its effects", async () => {
  const kind = `elapsed_${randomUUID()}`;
  await enqueueJob(pool, { kind, key: kind, payload: {} });
  const job = await claimJob(pool, kind);
  assert.ok(job);
  await assert.rejects(
    completeJob(pool, job, async (client) => {
      await enqueueJob(client, {
        kind: "expired_effect",
        key: job.id,
        payload: {}
      });
      await client.query(
        "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [job.id]
      );
    }),
    LostJobLeaseError
  );
  assert.equal(
    (
      await pool.query(
        "SELECT id FROM yunipals_market.job WHERE kind='expired_effect' AND deduplication_key=$1",
        [job.id]
      )
    ).rowCount,
    0
  );
});

test("a crash on the final attempt retires the job instead of retrying forever", async () => {
  const kind = `exhaust_${randomUUID()}`;
  const id = await enqueueJob(pool, {
    kind,
    key: kind,
    payload: {},
    maxAttempts: 1
  });
  assert.ok(await claimJob(pool, kind));
  await pool.query(
    "UPDATE yunipals_market.job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [id]
  );
  assert.equal(await claimJob(pool, kind), null);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT state,last_error_code FROM yunipals_market.job WHERE id=$1",
        [id]
      )
    ).rows[0],
    { state: "failed", last_error_code: "attempts_exhausted" }
  );
});
