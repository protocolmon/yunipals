// Ephemeral local chain + actual Ponder callbacks + SQL API for browser verification.
// Requires a fresh Anvil node on 127.0.0.1:8559 with chain ID 8453.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseEther
} from "viem";
import { base } from "viem/chains";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import {
  boosterPacksAbi,
  packRegistryAbi,
  yunipalMonstersAbi
} from "../../../packages/yunipals-market-core/src/boosterAbi.ts";
import { registerBoosterRoutes } from "../lib/api/booster-routes.ts";
import {
  BoosterArtworkStore,
  registerBoosterArtworkRoutes
} from "../lib/boosters/artwork.ts";

const rpc = "http://127.0.0.1:8559";
const client = createPublicClient({ chain: base, transport: http(rpc) });
assert.equal(await client.getChainId(), 8453);
const accounts = await client.request({ method: "eth_accounts" });
const account = accounts[0];
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(rpc)
});
const artifact = async (name) =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../contracts/boosters/out/${
          ["MockWrapper", "MockProto"].includes(name) ? "BoosterPacks.t" : name
        }.sol/${name}.json`,
        import.meta.url
      ),
      "utf8"
    )
  );
const deploy = async (name, args = []) => {
  const { abi, bytecode } = await artifact(name);
  const hash = await wallet.deployContract({
    abi,
    bytecode: bytecode.object,
    args
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  return receipt.contractAddress;
};
const send = async (address, abi, functionName, args) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
};
const proxy = async (name, abi, args) =>
  deploy("ERC1967Proxy", [
    await deploy(name),
    encodeFunctionData({ abi, functionName: "initialize", args })
  ]);
const registry = await proxy("PackRegistry", packRegistryAbi, [account]);
const monsters = await proxy("YunipalMonsters", yunipalMonstersAbi, [
  account,
  registry
]);
const wrapper = await deploy("MockWrapper");
const proto = await deploy("MockProto");
const engine = await proxy("BoosterPacks", boosterPacksAbi, [
  account,
  registry,
  monsters,
  wrapper
]);
const oracle = await artifact("MockL1Oracle");
await client.request({
  method: "anvil_setCode",
  params: [
    "0x420000000000000000000000000000000000000f",
    oracle.deployedBytecode.object
  ]
});
const multicall = JSON.parse(
  await readFile(
    new URL(
      "../../../contracts/boosters/out/MockL1Oracle.sol/MockMulticall3.json",
      import.meta.url
    ),
    "utf8"
  )
);
await client.request({
  method: "anvil_setCode",
  params: [
    "0xca11bde05977b3631167028862be2a173976ca11",
    multicall.deployedBytecode.object
  ]
});
const tokenArtifact = await artifact("MockProto");
await send(proto, tokenArtifact.abi, "mint", [account, parseEther("100")]);
await send(registry, packRegistryAbi, "configureType", [
  0n,
  {
    engine,
    paymentToken: proto,
    price: parseEther("1"),
    intervalSeconds: 86400n,
    mintsPerInterval: 1,
    maxBatch: 7,
    baseGas: 450000,
    perMintGas: 250000,
    confirmations: 3,
    supplyCap: 0n,
    artworkHash: JSON.parse(
      await readFile(
        new URL(
          "../../../docs/boosters/artwork-runtime/catalogs/base-standard-v1-demo/manifest.json",
          import.meta.url
        ),
        "utf8"
      )
    ).artworkHash,
    manifestURI:
      "http://127.0.0.1:9019/v1/boosters/art/base-standard-v1-demo/manifest.json",
    metadataBaseURI:
      "http://127.0.0.1:9019/v1/boosters/art/base-standard-v1-demo/"
  },
  {
    types: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    colors: [1, 2, 3, 4, 5, 6],
    horns: [1, 2],
    glitters: [0, 1],
    allowed: []
  }
]);
await send(registry, packRegistryAbi, "activate", [1n]);
const initialSnapshot = await client.request({ method: "evm_snapshot" });
const manifest = {
  registry,
  monsters,
  engine,
  wrapper,
  proto,
  account,
  otherAccount: accounts[1],
  rpc,
  initialSnapshot
};
await writeFile(
  "/tmp/yunipals-boosters-local.json",
  JSON.stringify(manifest, null, 2)
);
Object.assign(process.env, {
  BOOSTER_REGISTRY: registry,
  BOOSTER_MONSTERS: monsters,
  BOOSTER_ENGINE: engine,
  BOOSTER_WRAPPER: wrapper,
  BOOSTER_DEPLOYMENT_BLOCK: "1",
  PONDER_BOOSTERS_ONLY: "true",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:1/boosters_test",
  PONDER_RPC_URL_1: rpc,
  PONDER_RPC_URL_8453: rpc,
  PONDER_RPC_URL_137: rpc,
  PONDER_RPC_URL_56: rpc
});
delete process.env.DATABASE_PRIVATE_URL;
delete process.env.PONDER_ISLANDS_ONLY;
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
const { createBuild } = await internal("./build/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: "ponder.boosters.config.ts",
  command: "start",
  version: "0.17.5",
  schema: "boosters_test",
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
const resultOf = (result) => {
  if (result.status === "error") throw result.error;
  return result.result;
};
const build = await createBuild({ common, cliOptions });
const config = resultOf(await build.executeConfig()).config;
const preBuild = resultOf(build.preCompile({ config }));
const schema = resultOf(await build.executeSchema()).schema;
resultOf(build.compileSchema({ schema, preBuild }));
const handlers = resultOf(
  await build.executeIndexingFunctions()
).indexingFunctions;
const database = new PGlite();
const tables = Object.values(schema).filter((table) => {
  try {
    return getTableName(table).startsWith("booster_");
  } catch {
    return false;
  }
});
for (const table of tables) {
  const definition = getTableConfig(table);
  await database.exec(
    `CREATE TABLE "${definition.name}" (${definition.columns
      .map((column) => `"${column.name}" ${column.getSQLType()}`)
      .join(",")})`
  );
}
const state = new Map();
const keyOf = (table, row) => `${getTableName(table)}:${row.id}`;
const db = {
  find: async (table, key) => state.get(keyOf(table, key)) ?? null,
  insert: (table) => ({
    values: (row) => ({
      then: (resolve, reject) => {
        const key = keyOf(table, row);
        if (state.has(key))
          return Promise.reject(new Error("duplicate")).then(resolve, reject);
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
      assert.ok(row);
      state.set(id, {
        ...row,
        ...(typeof update === "function" ? update(row) : update)
      });
    }
  })
};
async function persist() {
  await database.exec("BEGIN");
  try {
    for (const table of tables) {
      const definition = getTableConfig(table);
      const columns = Object.entries(table).filter(([, value]) =>
        definition.columns.includes(value)
      );
      await database.exec(`DELETE FROM "${definition.name}"`);
      for (const [key, row] of state) {
        if (!key.startsWith(`${definition.name}:`)) continue;
        await database.query(
          `INSERT INTO "${definition.name}" (${columns
            .map(([, column]) => `"${column.name}"`)
            .join(",")}) VALUES (${columns
            .map((_, index) => `$${index + 1}`)
            .join(",")})`,
          columns.map(([prop]) =>
            typeof row[prop] === "bigint"
              ? row[prop].toString()
              : (row[prop] ?? null)
          )
        );
      }
    }
    await database.exec("COMMIT");
  } catch (error) {
    await database.exec("ROLLBACK");
    throw error;
  }
}
let nextBlock = 1n;
const contracts = new Map([
  [registry.toLowerCase(), ["BoosterRegistry", packRegistryAbi]],
  [engine.toLowerCase(), ["BoosterEngine", boosterPacksAbi]],
  [monsters.toLowerCase(), ["BoosterMonsters", yunipalMonstersAbi]]
]);
async function sync() {
  const toBlock = await client.getBlockNumber({ cacheTime: 0 });
  if (toBlock + 1n < nextBlock) {
    state.clear();
    nextBlock = 1n;
    await persist();
  }
  if (nextBlock > toBlock) return;
  const logs = await client.getLogs({
    address: [registry, engine, monsters],
    fromBlock: nextBlock,
    toBlock
  });
  for (const log of logs) {
    const [contract, abi] = contracts.get(log.address.toLowerCase());
    const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data });
    const handler = handlers.find(
      (item) => item.name === `${contract}:${decoded.eventName}`
    );
    if (!handler) continue;
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    await handler.fn({
      context: { db },
      event: {
        args: decoded.args,
        block,
        transaction: { hash: log.transactionHash },
        log: { address: log.address, logIndex: log.logIndex }
      }
    });
  }
  nextBlock = toBlock + 1n;
  if (logs.length) await persist();
}
await sync();
const artwork = new BoosterArtworkStore(
  fileURLToPath(
    new URL("../../../docs/boosters/artwork-runtime", import.meta.url)
  )
);
const app = new Hono();
app.use("*", cors());
registerBoosterRoutes(app, {
  pool: { query: (sql, args) => database.query(sql, args) },
  schemaName: "public"
});
registerBoosterArtworkRoutes(app, artwork);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 9019 });
let polling = false;
const timer = setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    await sync();
    await artwork.sync(
      { query: (sql, args) => database.query(sql, args) },
      "public",
      ["base-standard-v1-demo"]
    );
  } catch (error) {
    console.error(error);
  } finally {
    polling = false;
  }
}, 500);
console.log(
  "Local booster contracts, live Ponder callbacks and SQL API ready; manifest /tmp/yunipals-boosters-local.json"
);
await new Promise((resolve) => process.once("SIGTERM", resolve));
clearInterval(timer);
server.close();
await database.close();
await shutdown.kill();
common.metrics.registry.clear();
