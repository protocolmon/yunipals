import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { migrateArena } from "./schema";
import { ArenaCapacity } from "./capacity";
import { markArenaMediaReady } from "./media";
import { arenaMediaStorageBudget, ARENA_MEDIA_FILE_BYTES } from "./storage";
import { validateCapacity, type CapacitySnapshot } from "./capacity";

test("media storage counts retained/private/published assets without changing or deleting them", async () => {
  const root = await mkdtemp("/tmp/yunipals-storage-test-");
  try {
    await mkdir(root + "/published");
    await mkdir(root + "/private");
    await writeFile(root + "/published/film.mp4", Buffer.alloc(8192));
    await writeFile(root + "/private/provider.mp4", Buffer.alloc(8192));
    const value = await arenaMediaStorageBudget(root, 1024 * 1024, 65536);
    assert.ok(value.mediaStoredBytes >= 16384);
    assert.equal(value.mediaQuotaBytes, 1024 * 1024);
    assert.equal(value.mediaReserveBytes, 65536);
    await assert.rejects(
      arenaMediaStorageBudget(root, 32768, 32767),
      /allocation is full/
    );
    assert.equal(
      (await arenaMediaStorageBudget(root, 1024 * 1024, 65536))
        .mediaStoredBytes,
      value.mediaStoredBytes
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlinks and an excessive inventory fail closed rather than following unrelated server files", async () => {
  const root = await mkdtemp("/tmp/yunipals-storage-test-");
  try {
    await symlink("/etc", root + "/outside");
    await assert.rejects(arenaMediaStorageBudget(root), /symbolic links/);
    await rm(root + "/outside");
    await mkdir(root + "/a");
    await mkdir(root + "/b");
    await assert.rejects(
      arenaMediaStorageBudget(root, 1024 * 1024, 65536, 2),
      /scan bound/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid quota configuration never permits a storage scan or admission snapshot", async () => {
  await assert.rejects(arenaMediaStorageBudget("/unused", 100, 100), /Invalid/);
  await assert.rejects(arenaMediaStorageBudget("/unused", 100, 0), /Invalid/);
  await assert.rejects(arenaMediaStorageBudget("/unused", NaN, 1), /Invalid/);
  assert.equal(ARENA_MEDIA_FILE_BYTES, 134217728);
  const base: CapacitySnapshot = {
    runwareMicrousd: 10000000,
    openaiBudgetMicrousd: 5000000,
    openaiBudgetExpiresAt: Date.now() + 86400000,
    vrfAvailableWei: "100000000000000",
    vrfQuoteWei: "1000000000000",
    vrfMaxWei: "10000000000000",
    refereeGasWei: "200000000000000",
    operatorGasWei: "100000000000000",
    diskFreeBytes: 10000000000
  };
  assert.equal(validateCapacity(base), base);
  assert.throws(
    () => validateCapacity({ ...base, mediaStoredBytes: 1 }),
    /Invalid/
  );
  assert.throws(
    () =>
      validateCapacity({
        ...base,
        mediaStoredBytes: 100,
        mediaQuotaBytes: 200,
        mediaReserveBytes: 101
      }),
    /Invalid/
  );
  assert.equal(
    validateCapacity({
      ...base,
      mediaStoredBytes: 100,
      mediaQuotaBytes: 1000,
      mediaReserveBytes: 200
    }).mediaStoredBytes,
    100
  );
});

test("film publication invalidates stale storage/funding capacity atomically under concurrent refresh", async () => {
  const pool = new pg.Pool({
    connectionString:
      process.env.ARENA_TEST_DATABASE_URL ??
      "postgres://postgres:arena-local-test@127.0.0.1:55441/arena",
    max: 4
  });
  const deployment = "storage-" + randomUUID();
  try {
    await migrateArena(pool);
    await pool.query(
      "INSERT INTO yunipals_arena.deployment(id,contract,start_block) VALUES($1,'0x1111111111111111111111111111111111111111',1)",
      [deployment]
    );
    await pool.query(
      "INSERT INTO yunipals_arena.tournament VALUES($1,1,'{}',now())",
      [deployment]
    );
    await pool.query(
      "INSERT INTO yunipals_arena.media_job(deployment,tournament_id,state) VALUES($1,1,'assembling')",
      [deployment]
    );
    const capacity = new ArenaCapacity(pool, deployment);
    const funding: CapacitySnapshot = {
      runwareMicrousd: 10000000,
      openaiBudgetMicrousd: 5000000,
      openaiBudgetExpiresAt: Date.now() + 86400000,
      vrfAvailableWei: "100000000000000",
      vrfQuoteWei: "1000000000000",
      vrfMaxWei: "10000000000000",
      refereeGasWei: "200000000000000",
      operatorGasWei: "100000000000000",
      diskFreeBytes: 10000000000,
      mediaStoredBytes: 1000,
      mediaQuotaBytes: 1000000,
      mediaReserveBytes: 100000
    };
    await capacity.save(funding);
    const oldMeasurement = "1970-01-01T00:00:00Z";
    await Promise.allSettled([
      capacity.save(funding, oldMeasurement),
      markArenaMediaReady(pool, deployment, "1", "f".repeat(64))
    ]);
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM yunipals_arena.capacity WHERE deployment=$1",
          [deployment]
        )
      ).rowCount,
      0
    );
    assert.equal(
      (
        await pool.query(
          "SELECT state FROM yunipals_arena.media_job WHERE deployment=$1",
          [deployment]
        )
      ).rows[0].state,
      "ready"
    );
    await assert.rejects(
      capacity.save(funding, oldMeasurement),
      /finished during capacity measurement/
    );
    const measuredAfter = (
      await pool.query<{ at: string }>("SELECT clock_timestamp()::text AS at")
    ).rows[0]!.at;
    await capacity.save(funding, measuredAfter);
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM yunipals_arena.capacity WHERE deployment=$1",
          [deployment]
        )
      ).rowCount,
      1
    );
    await markArenaMediaReady(pool, deployment, "1", "f".repeat(64));
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM yunipals_arena.capacity WHERE deployment=$1",
          [deployment]
        )
      ).rowCount,
      1
    );
  } finally {
    for (const table of ["capacity", "media_job", "tournament"])
      await pool.query(
        `DELETE FROM yunipals_arena.${table} WHERE deployment=$1`,
        [deployment]
      );
    await pool.query("DELETE FROM yunipals_arena.deployment WHERE id=$1", [
      deployment
    ]);
    await pool.end();
  }
});

test("root-only deployment recovery records stay private and outside the battle media allowance", async () => {
  const root = await mkdtemp("/tmp/yunipals-storage-test-");
  try {
    await mkdir(root + "/_deployment", { mode: 0o700 });
    await writeFile(
      root + "/_deployment/recovery.json",
      Buffer.alloc(2 * 1024 * 1024),
      { mode: 0o600 }
    );
    const usage = await arenaMediaStorageBudget(root, 1024 * 1024, 65536);
    assert.equal(usage.mediaStoredBytes, 0);
    await chmod(root + "/_deployment", 0o755);
    await assert.rejects(
      arenaMediaStorageBudget(root),
      /private and root-owned/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
