import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";

// Compile through Ponder's actual Vite loader and exercise the registered
// callbacks without a running RPC or database. The PostgreSQL suite covers
// publication/read behavior; test:ponder:postgres covers real reorg storage.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/islands_test";
const isolated = process.argv.includes("--isolated");
if (isolated) process.env.PONDER_ISLANDS_ONLY = "true";
else delete process.env.PONDER_ISLANDS_ONLY;
delete process.env.DATABASE_PRIVATE_URL;
for (const id of [1, 8453, 137])
  process.env[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
const { createBuild } = await internal("./build/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: isolated ? "ponder.islands.config.ts" : "ponder.config.ts",
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
try {
  const build = await createBuild({ common, cliOptions });
  const config = resultOf(await build.executeConfig()).config;
  const preBuild = resultOf(build.preCompile({ config }));
  const schema = resultOf(await build.executeSchema()).schema;
  resultOf(build.compileSchema({ schema, preBuild }));
  const handlers = resultOf(
    await build.executeIndexingFunctions()
  ).indexingFunctions;
  assert.equal(config.contracts.YunipalsIslands.chain, "mainnet");
  assert.equal(config.contracts.YunipalsIslands.startBlock, 14_570_451);
  assert.equal(
    config.contracts.YunipalsIslands.address,
    "0xa22e2f53ca787414dc0643c399f92234949e2305"
  );
  assert.ok(
    !handlers.some((handler) => handler.name === "YunipalsIslands:RoleGranted")
  );
  assert.equal(
    handlers.some((handler) => handler.name === "YunipalsEthereum:RoleGranted"),
    !isolated
  );
  if (isolated) {
    assert.deepEqual(Object.keys(config.chains), ["mainnet"]);
    assert.deepEqual(Object.keys(config.contracts), ["YunipalsIslands"]);
    assert.equal(handlers.length, 2);
  }
  const state = new Map();
  const keyOf = (table, row) => {
    const name = getTableName(table);
    const columns =
      name === "token"
        ? ["collection", "tokenId"]
        : name === "token_lifecycle"
          ? ["collection", "tokenId", "lifecycle"]
          : ["id"];
    return JSON.stringify([name, ...columns.map((column) => row[column])]);
  };
  const db = {
    find: async (table, key) => state.get(keyOf(table, key)) ?? null,
    insert: (table) => ({
      values: (row) => ({
        then: (resolve, reject) => {
          const key = keyOf(table, row);
          if (state.has(key))
            return Promise.reject(new Error("duplicate row")).then(
              resolve,
              reject
            );
          state.set(key, structuredClone(row));
          return Promise.resolve(row).then(resolve, reject);
        },
        onConflictDoUpdate: async (update) => {
          const key = keyOf(table, row);
          state.set(key, { ...row, ...update });
        }
      })
    }),
    update: (table, key) => ({
      set: async (update) => {
        const id = keyOf(table, key);
        assert.ok(state.has(id));
        state.set(id, { ...state.get(id), ...update });
      }
    })
  };
  const owner = "0x0000000000000000000000000000000000000001";
  const other = "0x0000000000000000000000000000000000000002";
  const zero = "0x0000000000000000000000000000000000000000";
  const hash = `0x${"11".repeat(32)}`;
  const transfer = async (contract, from, to, number, logIndex) => {
    const handler = handlers.find(
      (handler) => handler.name === `${contract}:Transfer`
    );
    assert.ok(handler);
    await handler.fn({
      context: { db },
      event: {
        args: { from, to, tokenId: 1n },
        block: { number: BigInt(number), timestamp: BigInt(number * 10) },
        transaction: { hash, transactionIndex: 0 },
        log: { logIndex }
      }
    });
  };
  if (!isolated) await transfer("YunipalsEthereum", zero, owner, 1, 0);
  await transfer("YunipalsIslands", zero, other, 1, 0);
  const islandKey = keyOf(schema.token, {
    collection: "ethereum-islands",
    tokenId: "1"
  });
  const monsterKey = keyOf(schema.token, {
    collection: "ethereum",
    tokenId: "1"
  });
  assert.equal(state.get(islandKey).owner, other);
  if (!isolated) assert.equal(state.get(monsterKey).owner, owner);
  assert.equal(state.get(islandKey).chainId, 1);
  const beforeTransfer = structuredClone(state);
  await transfer("YunipalsIslands", other, owner, 2, 1);
  assert.equal(state.get(islandKey).owner, owner);
  await transfer("YunipalsIslands", owner, zero, 3, 2);
  assert.equal(state.get(islandKey).burned, true);
  assert.equal(
    state.get(
      keyOf(schema.tokenLifecycle, {
        collection: "ethereum-islands",
        tokenId: "1",
        lifecycle: 1
      })
    ).burnedAtBlock,
    3n
  );
  state.clear();
  for (const [key, row] of beforeTransfer) state.set(key, row);
  await transfer("YunipalsIslands", other, owner, 2, 1);
  assert.equal(state.get(islandKey).owner, owner);
  assert.equal(state.get(islandKey).burned, false);
  assert.equal(state.get(islandKey).mintBlock, 1n);
  if (!isolated) assert.equal(state.get(monsterKey).owner, owner);
  console.log(
    JSON.stringify({
      event: "islands_ponder_callbacks_verified",
      isolated,
      checks: [
        "Vite config/schema/handlers",
        "same-chain token collision",
        "mint/transfer/burn",
        "replay"
      ]
    })
  );
} finally {
  await shutdown.kill();
  common.metrics.registry.clear();
}
