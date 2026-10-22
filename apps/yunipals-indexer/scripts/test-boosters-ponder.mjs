import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { registerBoosterRoutes } from "../lib/api/booster-routes.ts";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";

// Compile through Ponder's actual Vite loader and exercise the registered
// callbacks without a running RPC or database. The PostgreSQL suite covers
// publication/read behavior; test:ponder:postgres covers real reorg storage.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/islands_test";
const isolated = process.argv.includes("--isolated");
delete process.env.PONDER_ISLANDS_ONLY;
if (isolated) process.env.PONDER_BOOSTERS_ONLY = "true";
else delete process.env.PONDER_BOOSTERS_ONLY;
delete process.env.DATABASE_PRIVATE_URL;
for (const id of [1, 8453, 137, 56])
  process.env[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
process.env.BOOSTER_REGISTRY = "0x1111111111111111111111111111111111111111";
process.env.BOOSTER_ENGINE = "0x2222222222222222222222222222222222222222";
process.env.BOOSTER_MONSTERS = "0x3333333333333333333333333333333333333333";
process.env.BOOSTER_WRAPPER = "0x4444444444444444444444444444444444444444";
process.env.BOOSTER_DEPLOYMENT_BLOCK = "1";
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
const { createBuild } = await internal("./build/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: isolated ? "ponder.boosters.config.ts" : "ponder.config.ts",
  command: "start",
  version: "0.17.5",
  schema: "islands_test",
  logLevel: "error",
  logFormat: "json"
};
const shutdown = createShutdown();
const common = {
  options: buildOptions({ cliOptions }),
  logger: createLogger({ level: "error", mode: "json" }),
  metrics: new MetricsService(),
  shutdown,
  buildShutdown: shutdown,
  apiShutdown: shutdown
};
function resultOf(value) {
  if (value.status === "error") throw value.error;
  return value.result;
}

const database = new PGlite();
let httpServer;
try {
  const build = await createBuild({ common, cliOptions });
  const config = resultOf(await build.executeConfig()).config;
  const preBuild = resultOf(build.preCompile({ config }));
  const schema = resultOf(await build.executeSchema()).schema;
  resultOf(build.compileSchema({ schema, preBuild }));
  const handlers = resultOf(
    await build.executeIndexingFunctions()
  ).indexingFunctions;
  if (isolated) {
    assert.deepEqual(Object.keys(config.chains), ["base"]);
    assert.ok(handlers.every((handler) => handler.name.startsWith("Booster")));
  }
  assert.equal(
    config.contracts.BoosterMonsters.address,
    process.env.BOOSTER_MONSTERS
  );
  const tables = Object.values(schema).filter((table) => {
    try {
      return getTableName(table).startsWith("booster_");
    } catch {
      return false;
    }
  });
  assert.equal(tables.length, 8);
  const state = new Map();
  const keyOf = (table, row) => `${getTableName(table)}:${row.id}`;
  const db = {
    find: async (table, key) => state.get(keyOf(table, key)) ?? null,
    insert: (table) => ({
      values: (row) => ({
        then: (resolve, reject) => {
          const key = keyOf(table, row);
          if (state.has(key))
            return Promise.reject(new Error(`Duplicate ${key}`)).then(
              resolve,
              reject
            );
          state.set(key, structuredClone(row));
          return Promise.resolve(row).then(resolve, reject);
        },
        onConflictDoUpdate: async (update) => {
          const key = keyOf(table, row);
          state.set(key, { ...state.get(key), ...row, ...update });
        }
      })
    }),
    update: (table, key) => ({
      set: async (update) => {
        const id = keyOf(table, key);
        const row = state.get(id);
        assert.ok(row, `Missing ${id}`);
        state.set(id, {
          ...row,
          ...(typeof update === "function" ? update(row) : update)
        });
      }
    })
  };
  const alice = "0x0000000000000000000000000000000000000001";
  const bob = "0x0000000000000000000000000000000000000002";
  const zero = "0x0000000000000000000000000000000000000000";
  const hash = `0x${"ab".repeat(32)}`;
  const collection = process.env.BOOSTER_MONSTERS;
  const engine = process.env.BOOSTER_ENGINE;
  const registry = process.env.BOOSTER_REGISTRY;
  let logIndex = 0;
  const identity = (address, id) => `8453:${address}:${id}`;
  const dispatch = async (name, args) => {
    const handler = handlers.find((handler) => handler.name === name);
    assert.ok(handler, name);
    const number = BigInt(++logIndex);
    const event = {
      args,
      block: { number, hash, timestamp: 1_000_000n + number },
      transaction: { hash, transactionIndex: 0 },
      log: {
        address: name.startsWith("BoosterRegistry")
          ? registry
          : name.startsWith("BoosterMonsters")
            ? collection
            : engine,
        logIndex,
        data: "0x",
        topics: []
      }
    };
    await handler.fn({ event, context: { db, chain: { id: 8453 } } });
    await handler.fn({ event, context: { db, chain: { id: 8453 } } }); // duplicate delivery must not commit twice
  };
  const activatedType = {
    packTypeId: 1n,
    engine,
    paymentToken: "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3",
    price: 10n ** 18n,
    intervalSeconds: 86400n,
    mintsPerInterval: 1,
    totalVariants: 16,
    maxBatch: 7,
    catalogHash: hash,
    ruleHash: hash,
    manifestURI: "https://example.test/catalog.json",
    metadataBaseURI: "https://example.test/variants/"
  };
  await dispatch("BoosterRegistry:TypeActivated", activatedType);
  await dispatch("BoosterRegistry:TypeActivated", {
    ...activatedType,
    packTypeId: 2n,
    mintsPerInterval: 0xffffffff
  });
  await dispatch("BoosterEngine:RequestCreated", {
    requestId: 1n,
    originalId: 1n,
    packTypeId: 1n,
    payer: alice,
    quantity: 1,
    opening: true,
    paid: 100n,
    ruleHash: hash,
    callbackGas: 700000
  });
  const mint = async (id, recipient, original = false) => {
    await dispatch("BoosterMonsters:Transfer", {
      tokenId: id,
      from: zero,
      to: recipient
    });
    await dispatch("BoosterMonsters:MonsterMinted", {
      tokenId: id,
      originalTokenId: 1n,
      packTypeId: 1n,
      recipient,
      variantId: Number(id - 1n),
      monsterType: 2,
      color: 0,
      horn: 6,
      glitter: 1,
      isOriginal: original
    });
  };
  await dispatch("BoosterEngine:RandomnessReceived", {
    requestId: 1n,
    seed: 0n,
    receivedAt: 1_000_000n
  });
  await mint(1n, alice, true);
  await dispatch("BoosterEngine:OriginalRevealed", {
    originalId: 1n,
    packTypeId: 1n,
    revealedAt: 1_000_000n,
    totalVariants: 16
  });
  await dispatch("BoosterEngine:RequestCompleted", {
    requestId: 1n,
    originalId: 1n,
    recipient: alice,
    quantity: 1,
    minted: 1,
    remaining: 15
  });
  await dispatch("BoosterEngine:RequestCreated", {
    requestId: 2n,
    originalId: 1n,
    packTypeId: 1n,
    payer: alice,
    quantity: 3,
    opening: false,
    paid: 100n,
    ruleHash: hash,
    callbackGas: 1200000
  });
  const beforeTransfer = structuredClone(state);
  await dispatch("BoosterMonsters:Transfer", {
    tokenId: 1n,
    from: alice,
    to: bob
  });
  const transferred = state.get(
    keyOf(schema.boosterOriginal, { id: identity(collection, 1) })
  );
  assert.equal(transferred.owner, bob);
  assert.equal(transferred.dailyCommitted, 3n);
  assert.equal(transferred.pendingRequest, identity(engine, 2));
  state.clear();
  for (const [key, row] of beforeTransfer) state.set(key, row);
  assert.equal(
    state.get(keyOf(schema.boosterOriginal, { id: identity(collection, 1) }))
      .owner,
    alice
  );
  await dispatch("BoosterMonsters:Transfer", {
    tokenId: 1n,
    from: alice,
    to: bob
  }); // replay after rollback
  await dispatch("BoosterEngine:RandomnessReceived", {
    requestId: 2n,
    seed: 0n,
    receivedAt: 1_260_000n
  });
  await mint(2n, bob);
  await mint(3n, bob);
  await mint(4n, bob);
  await dispatch("BoosterEngine:RequestCompleted", {
    requestId: 2n,
    originalId: 1n,
    recipient: bob,
    quantity: 3,
    minted: 4,
    remaining: 12
  });
  await dispatch("BoosterMonsters:Transfer", {
    tokenId: 2n,
    from: bob,
    to: alice
  });
  await dispatch("BoosterEngine:RefundCredited", {
    requester: alice,
    amount: 50n
  });
  await dispatch("BoosterEngine:RefundWithdrawn", {
    requester: alice,
    recipient: bob,
    amount: 50n
  });
  assert.equal(
    state.get(keyOf(schema.boosterType, { id: identity(registry, 1) }))
      .openings,
    1n
  );
  assert.ok(
    [...state.keys()].every(
      (key) =>
        key.startsWith("booster_") ||
        (!isolated && key.startsWith("canonical_event:"))
    )
  ); // no market/leaderboard token writes

  // Use the actual exported table definitions and real SQL engine for API checks.
  for (const table of tables) {
    const definition = getTableConfig(table);
    const columns = definition.columns;
    await database.exec(
      `CREATE TABLE "${definition.name}" (${columns
        .map((column) => `"${column.name}" ${column.getSQLType()}`)
        .join(",")})`
    );
  }
  const persist = async () => {
    for (const table of tables) {
      const definition = getTableConfig(table);
      const columns = Object.entries(table).filter(([, value]) =>
        definition.columns.includes(value)
      );
      await database.exec(`DELETE FROM "${definition.name}"`);
      for (const [key, row] of state) {
        if (!key.startsWith(`${definition.name}:`)) continue;
        const values = columns.map(([prop]) =>
          typeof row[prop] === "bigint"
            ? row[prop].toString()
            : (row[prop] ?? null)
        );
        await database.query(
          `INSERT INTO "${definition.name}" (${columns
            .map(([, column]) => `"${column.name}"`)
            .join(",")}) VALUES (${columns
            .map((_, index) => `$${index + 1}`)
            .join(",")})`,
          values
        );
      }
    }
  };
  await persist();
  const app = new Hono();
  app.use("*", cors());
  registerBoosterRoutes(app, {
    pool: { query: (sql, params) => database.query(sql, params) },
    schemaName: "public"
  });
  const json = async (path, status = 200) => {
    const response = await app.request(`/v1${path}`);
    assert.equal(response.status, status, path);
    return response.json();
  };
  const types = await json("/boosters/types");
  assert.equal(types.items[0].price, "1000000000000000000");
  assert.equal(types.items[1].mintsPerInterval, 0xffffffff);
  const owner = await json(`/owners/${bob}/booster-originals`);
  assert.equal(owner.items[0].dailyCommitted, "3");
  assert.equal(owner.items[0].pack.totalVariants, "16");
  assert.equal(owner.items[0].pendingRequest, null);
  assert.equal(owner.items[0].minted, "4");
  const owned = await json(`/owners/${bob}/booster-monsters?limit=2`);
  assert.equal(owned.items.length, 2);
  assert.equal(owned.nextCursor, "3");
  const next = await json(`/owners/${bob}/booster-monsters?limit=2&after=3`);
  assert.equal(next.items[0].tokenId, "4");
  const child = await json(`/boosters/monsters/${collection}/2`);
  assert.equal(child.item.owner, alice);
  assert.equal(child.item.mintedTo, bob);
  assert.equal(child.item.requestKey, identity(engine, 2));
  const request = await json(`/boosters/requests/${engine}/2`);
  assert.equal(request.item.seed, "0");
  assert.equal(request.item.recipient, bob);
  await json(`/boosters/monsters/${registry}/1`, 404); // same numeric ID, different collection
  await json(`/owners/${bob}/booster-monsters?limit=999`, 400);
  await json(`/owners/${bob}/booster-originals?after=1%27`, 400);
  const refund = await json(`/owners/${alice}/booster-refunds`);
  assert.equal(refund.items[0].credit, "0");

  if (process.argv.includes("--serve")) {
    httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 9019 });
    console.log("Booster verification API listening on http://127.0.0.1:9019");
    await new Promise((resolve) => process.once("SIGTERM", resolve));
  } else {
    await dispatch("BoosterEngine:RequestCreated", {
      requestId: 3n,
      originalId: 1n,
      packTypeId: 1n,
      payer: bob,
      quantity: 1,
      opening: false,
      paid: 100n,
      ruleHash: hash,
      callbackGas: 700000
    });
    await dispatch("BoosterMonsters:Transfer", {
      tokenId: 1n,
      from: bob,
      to: zero
    });
    await dispatch("BoosterEngine:RequestForfeited", {
      requestId: 3n,
      originalId: 1n
    });
    await dispatch("BoosterMonsters:OriginalBurned", {
      tokenId: 1n,
      packTypeId: 1n
    });
    await dispatch("BoosterEngine:RandomnessReceived", {
      requestId: 3n,
      seed: 11n,
      receivedAt: 1_270_000n
    });
    await persist();
    const late = await json(`/boosters/requests/${engine}/3`);
    assert.equal(late.item.status, "forfeited");
    assert.equal(
      (await json(`/owners/${bob}/booster-originals`)).items.length,
      0
    );
    assert.equal(
      (await json(`/owners/${bob}/booster-monsters`)).items.length,
      2
    );
  }
  console.log(
    "Booster Vite handlers, idempotent replay, transfer/burn, SQL projections, pagination, and API identity verified."
  );
} finally {
  httpServer?.close();
  await database.close();
  await shutdown.kill();
  common.metrics.registry.clear();
}
