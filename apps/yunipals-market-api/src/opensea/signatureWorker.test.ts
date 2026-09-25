import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import {
  readOpenSeaSignatureEnvironment,
  readOpenSeaSignatureFleetEnvironment
} from "@/environment";
import { testUrl } from "@/bnb/fixtures/database";
import { SignatureSchedule } from "@/opensea/signatureSchedule";
import { withSignatureWorkerLocks } from "@/opensea/signatureWorkerLock";

test("signature runtime requires explicit live chain, actor, confirmations and positive foreground headroom", () => {
  const config = {
    MARKET_OPENSEA_SIGNATURE_CHAIN: "base",
    MARKET_OPENSEA_SIGNATURE_RPC: "https://rpc.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER:
      "https://backup.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_CONFIRMATIONS: "12",
    MARKET_OPENSEA_SIGNATURE_LISTING_ACTOR:
      "0x0000000000000000000000000000000000001234",
    MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM: "60",
    MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM: "2",
    MARKET_OPENSEA_SIGNATURE_MAX_SECONDS: "180"
  };
  const value = readOpenSeaSignatureEnvironment(config);
  assert.equal(value.chain, "base");
  assert.equal(value.confirmations, 12n);
  assert.equal(value.maxSeconds, 180);
  assert.equal(value.concurrency, 1);
  assert.deepEqual(value.rpcUrls, [
    config.MARKET_OPENSEA_SIGNATURE_RPC,
    config.MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER
  ]);
  assert.deepEqual(value.headroom, { allPerHour: 60, fulfillmentPerMinute: 2 });
  for (const changes of [
    { MARKET_OPENSEA_SIGNATURE_CHAIN: "bnb" },
    { MARKET_OPENSEA_SIGNATURE_CONFIRMATIONS: undefined },
    { MARKET_OPENSEA_SIGNATURE_RPC: "http://127.0.0.1:8545" },
    {
      MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER:
        "https://rpc.example.test/another-token"
    },
    {
      MARKET_OPENSEA_SIGNATURE_LISTING_ACTOR:
        "0x0000000000000000000000000000000000000000"
    },
    { MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM: undefined },
    { MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM: "0" },
    { MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM: "0" },
    { MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM: "100001" },
    { MARKET_OPENSEA_VALIDATION_RPC: "http://127.0.0.1:8545" }
  ])
    assert.throws(
      () => readOpenSeaSignatureEnvironment({ ...config, ...changes }),
      (error: unknown) =>
        error instanceof Error && !error.message.includes("private-token")
    );
});

test("fleet requires all three RPCs and rejects mixed single-chain configuration", () => {
  const config = {
    MARKET_OPENSEA_SIGNATURE_RPC_ETHEREUM:
      "https://eth.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_BASE:
      "https://base.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_POLYGON:
      "https://polygon.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER_ETHEREUM:
      "https://eth-backup.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER_BASE:
      "https://base-backup.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_RPC_FAILOVER_POLYGON:
      "https://polygon-backup.example.test/private-token",
    MARKET_OPENSEA_SIGNATURE_STATE_DIRECTORY:
      "/var/lib/yunipals-market-signature-fleet",
    MARKET_OPENSEA_SIGNATURE_CONFIRMATIONS: "12",
    MARKET_OPENSEA_SIGNATURE_LISTING_ACTOR:
      "0x0000000000000000000000000000000000001234",
    MARKET_OPENSEA_SIGNATURE_HOURLY_HEADROOM: "60",
    MARKET_OPENSEA_SIGNATURE_FULFILLMENT_HEADROOM: "2"
  };
  const result = readOpenSeaSignatureFleetEnvironment(config);
  assert.deepEqual(Object.keys(result.chains), ["ethereum", "base", "polygon"]);
  assert.equal(result.chains.base.rpcUrls.length, 2);
  for (const change of [
    { MARKET_OPENSEA_SIGNATURE_RPC_BASE: undefined },
    { MARKET_OPENSEA_SIGNATURE_CHAIN: "base" },
    { MARKET_OPENSEA_SIGNATURE_STATE_DIRECTORY: "relative" },
    { MARKET_OPENSEA_SIGNATURE_STATE_DIRECTORY: "/var/lib/../tmp" }
  ])
    assert.throws(() =>
      readOpenSeaSignatureFleetEnvironment({ ...config, ...change })
    );
});

test("schedule retains quota waits across restart and rejects malformed or linked state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yunipals-schedule-"));
  try {
    const first = await SignatureSchedule.load(directory);
    await first.advance(true);
    await first.defer();
    const resumed = await SignatureSchedule.load(directory);
    assert.equal(resumed.next, "base");
    assert.ok(resumed.notBefore > Date.now());
    await resumed.advance(true);
    const next = await SignatureSchedule.load(directory);
    assert.equal(next.next, "polygon");
    assert.equal(next.notBefore, 0);
    const path = join(directory, "schedule.json");
    await writeFile(path, '{"version":1,"next":"bnb"}');
    await assert.rejects(SignatureSchedule.load(directory));
    await rm(path);
    const target = join(directory, "other.json");
    await writeFile(target, '{"version":1,"next":"ethereum"}', { mode: 0o600 });
    await symlink(target, path);
    await assert.rejects(SignatureSchedule.load(directory));
    assert.equal(
      await readFile(target, "utf8"),
      '{"version":1,"next":"ethereum"}'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session ownership excludes overlapping fleets and single-chain workers and releases partial locks", async () => {
  const pool = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
    max: 4
  });
  const signal = new AbortController().signal;
  try {
    await withSignatureWorkerLocks(pool, ["base"], signal, async () => {
      await assert.rejects(
        withSignatureWorkerLocks(
          pool,
          ["ethereum", "base", "polygon"],
          signal,
          async () => assert.fail("overlap")
        ),
        /already owns/
      );
      // The failed fleet must release the earlier Ethereum/Polygon locks.
      await withSignatureWorkerLocks(
        pool,
        ["ethereum", "polygon"],
        signal,
        async () => undefined
      );
    });
    await withSignatureWorkerLocks(
      pool,
      ["ethereum", "base", "polygon"],
      signal,
      async () => {
        await assert.rejects(
          withSignatureWorkerLocks(pool, ["polygon"], signal, async () =>
            assert.fail("overlap")
          ),
          /already owns/
        );
      }
    );
  } finally {
    await pool.end();
  }
});

test("losing the coordinator session aborts work and fences successful completion", async () => {
  const pool = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
    max: 4,
    application_name: "yunipals_signature_lock_loss_test"
  });
  try {
    await assert.rejects(
      withSignatureWorkerLocks(
        pool,
        ["ethereum"],
        new AbortController().signal,
        async (guard) => {
          const aborted = new Promise<void>((resolve) =>
            guard.signal.addEventListener("abort", () => resolve(), {
              once: true
            })
          );
          await pool.query(`SELECT pg_terminate_backend(l.pid) FROM pg_locks l JOIN pg_stat_activity a USING(pid)
        WHERE l.locktype='advisory' AND l.classid=1970171497 AND l.objid=1 AND a.application_name='yunipals_signature_lock_loss_test'`);
          await aborted;
          guard.assertOwner();
        }
      ),
      /lost its coordinator/
    );
    await withSignatureWorkerLocks(
      pool,
      ["ethereum"],
      new AbortController().signal,
      async () => undefined
    );
  } finally {
    await pool.end();
  }
});
