import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Pool } from "pg";
import type { PublicClient } from "viem";
import { arenaNativeConfiguration, NativeArenaSource } from "./nativeSource";
import { ArenaRollbackSource, arenaRollbackSourceId } from "./rollbackSource";
import { assertArenaSourceBinding } from "./sourceSelection";
import { ArenaIntake } from "./intake";
import { StrategyCipher } from "./crypto";
import { selectedArenaRuntimeSource } from "./selectedSourceRuntime";
import {
  arenaSourceSelectionMigration,
  arenaSourceWatermarkMigration,
  arenaSourceDeleteFenceMigration,
  arenaSourcePredecessorMigration
} from "./sourceSelectionSchema";

const deployment = {
  id: `8453:0x${"ab".repeat(20)}`,
  contract: `0x${"ab".repeat(20)}` as const,
  startBlock: 100n
};
const release = `0x${"11".repeat(32)}`;
const url = "postgres://source@localhost:5432/arena_public_fixture";
const epoch = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const migrations = new Map(
  [
    arenaSourceSelectionMigration,
    arenaSourceWatermarkMigration,
    arenaSourceDeleteFenceMigration,
    arenaSourcePredecessorMigration
  ].map((row) => [row.version, row.checksum])
);
const base = {
  getBlock: async () => {
    throw new Error("Startup must not perform RPC.");
  },
  getChainId: async () => {
    throw new Error("Startup must not perform RPC.");
  }
} as Pick<PublicClient, "getBlock" | "getChainId">;
function fixture(kind: "unified" | "legacy_rollback" = "unified") {
  const native = arenaNativeConfiguration({
    ARENA_INDEXER_MODE: "unified",
    ARENA_INDEXER_DATABASE_URL: url,
    ARENA_INDEXER_RELEASE_ID:
      kind === "unified"
        ? release
        : arenaRollbackSourceId(url, deployment.contract, deployment.startBlock),
    ARENA_INDEXER_SOURCE_KIND: kind
  });
  assert.equal(native.mode, "unified");
  let selected: { epoch: string; kind: string; source_id: string } | undefined = {
    epoch,
    kind,
    source_id: native.releaseId!
  };
  let sameDatabase = false,
    floorPresent = true,
    badMigration = false;
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, args?: unknown[]) => {
      queries.push(sql);
      if (sql.startsWith("SELECT indexer_mode"))
        return { rows: [{ indexer_mode: "unified" }] };
      if (sql.startsWith("SELECT epoch"))
        return { rows: selected ? [selected] : [] };
      if (sql.includes("operational_migration"))
        return {
          rows: [
            {
              checksum: badMigration
                ? "changed"
                : migrations.get(Number(args?.[0]))
            }
          ]
        };
      if (sql.startsWith("SELECT accepted_block"))
        return {
          rows: floorPresent
            ? [{ block: "110", hash: `0x${"22".repeat(32)}` }]
            : []
        };
      if (sql.startsWith("SELECT current_database"))
        return {
          rows: [
            { db: "arena_private_fixture", host: "127.0.0.1", port: 5432 }
          ]
        };
      throw new Error("Unexpected startup SQL.");
    }
  } as unknown as Pool;
  const sourcePool = {
    query: async (sql: string) => {
      assert.ok(sql.startsWith("SELECT current_database"));
      return {
        rows: [
          {
            db: sameDatabase ? "arena_private_fixture" : "arena_public_fixture",
            host: "127.0.0.1",
            port: 5432
          }
        ]
      };
    }
  } as unknown as Pool;
  return {
    options: { pool, sourcePool, native, deployment, base },
    queries,
    selection: () => selected,
    setSelection: (value: typeof selected) => {
      selected = value;
    },
    setSameDatabase: () => {
      sameDatabase = true;
    },
    setMissingFloor: () => {
      floorPresent = false;
    },
    setBadMigration: () => {
      badMigration = true;
    }
  };
}

test("reviewed native selection supplies disclosure binding", async () => {
  const f = fixture();
  const result = await selectedArenaRuntimeSource(f.options);
  assert.ok(result.nativeSource instanceof NativeArenaSource);
  assert.deepEqual(result.binding, { epoch, kind: "unified", sourceId: release });
  await assertArenaSourceBinding(f.options.pool, deployment.id, result.binding);
  assert.equal(
    f.queries.filter((q) => q.includes("operational_migration")).length,
    4
  );
});

test("reviewed rollback selects isolated adapter and floor", async () => {
  const f = fixture("legacy_rollback");
  const result = await selectedArenaRuntimeSource(f.options);
  assert.ok(result.nativeSource instanceof ArenaRollbackSource);
  assert.equal(result.nativeSource.floor.block, "110");
  assert.equal(result.binding?.sourceId, f.selection()?.source_id);
  await assertArenaSourceBinding(f.options.pool, deployment.id, result.binding);
});

test("rollback without a reviewed binding refuses startup", async () => {
  const f = fixture("legacy_rollback");
  f.setSelection(undefined);
  await assert.rejects(
    selectedArenaRuntimeSource(f.options),
    /explicitly reviewed source switch/
  );
});

test("intake rejects missing or stale source bindings", async () => {
  const f = fixture();
  const { nativeSource, binding } = await selectedArenaRuntimeSource(f.options);
  const service = () =>
    new ArenaIntake(
      f.options.pool,
      deployment.id,
      deployment.contract,
      "https://fixture.example",
      new StrategyCipher(Buffer.alloc(32)),
      { message: async () => false, strategy: async () => false },
      nativeSource,
      binding
    );
  await service().assertSourceSelection();
  const unbound = new ArenaIntake(
    f.options.pool,
    deployment.id,
    deployment.contract,
    "https://fixture.example",
    new StrategyCipher(Buffer.alloc(32)),
    { message: async () => false, strategy: async () => false },
    nativeSource
  );
  await assert.rejects(unbound.assertSourceSelection(), /source epoch changed/);
  f.setSelection({ ...f.selection()!, epoch: "changed" });
  await assert.rejects(service().assertSourceSelection(), /source epoch changed/);
});

test("changed source identity or kind refuses startup", async () => {
  for (const change of [
    { source_id: `0x${"33".repeat(32)}` },
    { kind: "legacy_rollback" }
  ]) {
    const f = fixture();
    f.setSelection({ ...f.selection()!, ...change });
    await assert.rejects(selectedArenaRuntimeSource(f.options), /does not match/);
  }
});

test("rollback checks database isolation, floor and endpoint", async () => {
  const same = fixture("legacy_rollback");
  same.setSameDatabase();
  await assert.rejects(
    selectedArenaRuntimeSource(same.options),
    /isolated public projection/
  );
  const floor = fixture("legacy_rollback");
  floor.setMissingFloor();
  await assert.rejects(
    selectedArenaRuntimeSource(floor.options),
    /reviewed source floor/
  );
  const changed = fixture("legacy_rollback");
  assert.equal(changed.options.native.mode, "unified");
  await assert.rejects(
    selectedArenaRuntimeSource({
      ...changed.options,
      native: {
        ...changed.options.native,
        mode: "unified",
        databaseUrl: url + "_changed"
      }
    }),
    /endpoint\/configuration/
  );
});

test("schema checksums and read-only pool are required", async () => {
  const f = fixture();
  f.setBadMigration();
  await assert.rejects(
    selectedArenaRuntimeSource(f.options),
    /source selection schema/
  );
  await assert.rejects(
    selectedArenaRuntimeSource({ ...fixture().options, sourcePool: undefined }),
    /read-only source pool/
  );
});

test("native source supports the initial pre-switch epoch", async () => {
  const f = fixture();
  f.setSelection(undefined);
  const result = await selectedArenaRuntimeSource(f.options);
  assert.ok(result.nativeSource instanceof NativeArenaSource);
  assert.equal(result.binding, undefined);
  await assertArenaSourceBinding(f.options.pool, deployment.id, result.binding);
});

test("disclosure shares startup without signer/provider loaders", () => {
  const source = readFileSync(
    new URL("./nativeDisclosureWorker.ts", import.meta.url),
    "utf8"
  );
  assert.ok(source.includes("selectedArenaRuntimeSource({"));
  assert.ok(source.includes("nativeSource,\n      binding"));
  assert.ok(source.includes("await service.ready()"));
  for (const forbidden of [
    'from "./runtime"',
    "arenaSigner",
    "OPENAI_API_KEY",
    "RUNWARE_API_KEY",
    "new NativeArenaSource("
  ])
    assert.ok(!source.includes(forbidden), forbidden);
});

test("legacy runtime keeps pre-switch source behavior", async () => {
  const f = fixture();
  f.setSelection(undefined);
  const result = await selectedArenaRuntimeSource({
    ...f.options,
    native: arenaNativeConfiguration({ ARENA_INDEXER_MODE: "legacy" }),
    sourcePool: undefined
  });
  assert.equal(result.nativeSource, undefined);
  assert.equal(result.binding, undefined);
});
