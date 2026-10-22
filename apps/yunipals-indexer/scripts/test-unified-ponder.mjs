import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { indexedCollections } from "../lib/constants.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";
import {
  decodePonderCheckpoint,
  completePonderBlock
} from "../../../packages/yunipals-indexer-client/src/ponder.ts";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unified_test";
for (const name of [
  "DATABASE_PRIVATE_URL",
  "PONDER_ISLANDS_ONLY",
  "PONDER_BOOSTERS_ONLY",
  "UNIFIED_ARENA_DEPLOYMENTS",
  "BOOSTER_REGISTRY",
  "BOOSTER_ENGINE",
  "BOOSTER_MONSTERS",
  "BOOSTER_WRAPPER",
  "BOOSTER_DEPLOYMENT_BLOCK"
])
  delete process.env[name];
for (const id of [1, 56, 137, 8453])
  process.env[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
process.env.ARENA_CONTRACT = `0x${"12".repeat(20)}`;
process.env.ARENA_DEPLOYMENT_BLOCK = "100";
process.env.MARKET_BNB_DISCOVERY_START_BLOCK = "100";
process.env.BOOSTER_REGISTRY = `0x${"31".repeat(20)}`;
process.env.BOOSTER_ENGINE = `0x${"32".repeat(20)}`;
process.env.BOOSTER_MONSTERS = `0x${"33".repeat(20)}`;
process.env.BOOSTER_WRAPPER = `0x${"34".repeat(20)}`;
process.env.BOOSTER_DEPLOYMENT_BLOCK = "1";
process.env.UNIFIED_BASE_ISLANDS_V2_ENABLED = "true";
const receiptFloor = process.argv.includes("--receipt-floor");
if (receiptFloor)
  process.env.UNIFIED_RECEIPT_HISTORY_JSON = JSON.stringify({
    "ownership:bnb": indexedCollections.bnb.deploymentBlock + 1
  });
else delete process.env.UNIFIED_RECEIPT_HISTORY_JSON;
const manifest = buildSourceManifest();
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
const { createBuild } = await internal("./build/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const { encodeCheckpoint, decodeCheckpoint, blockToCheckpoint } =
  await internal("./utils/checkpoint.js");
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: "ponder.config.ts",
  command: "start",
  version: "0.17.5",
  schema: "unified_test",
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
  assert.equal(preBuild.ordering, "multichain");
  assert.deepEqual(
    Object.values(config.chains)
      .map((chain) => chain.id)
      .sort((a, b) => a - b),
    [1, 56, 137, 8453]
  );
  for (const source of manifest.sources.filter((source) => source.enabled)) {
    const contract = config.contracts[source.contractName];
    assert.ok(contract, source.id);
    assert.ok([contract.address].flat().includes(source.address), source.id);
    assert.ok(contract.startBlock <= Number(source.startBlock), source.id);
    for (const event of source.events)
      assert.ok(
        handlers.some(
          (handler) => handler.name === `${source.contractName}:${event}`
        ),
        `${source.id}:${event}`
      );
  }
  for (const source of manifest.sources.filter((source) => !source.enabled)) {
    assert.deepEqual(config.contracts[source.contractName].address, []);
  }
  // Prove our read adapter against the installed encoding, not a copied fixture.
  for (const chainId of [1, 56, 137, 8453]) {
    for (const rounding of ["up", "down"]) {
      const encoded = encodeCheckpoint(
        blockToCheckpoint(
          { number: "0x64", timestamp: "0x64" },
          chainId,
          rounding
        )
      );
      assert.deepEqual(
        decodePonderCheckpoint(encoded),
        decodeCheckpoint(encoded)
      );
      assert.equal(
        completePonderBlock(encoded, chainId),
        rounding === "up" ? 100n : 99n
      );
    }
  }
  const state = new Map();
  const keyOf = (table, row) => {
    const name = getTableName(table);
    const keys =
      name === "token"
        ? ["collection", "tokenId"]
        : name === "token_lifecycle"
          ? ["collection", "tokenId", "lifecycle"]
          : ["id"];
    return JSON.stringify([name, ...keys.map((key) => row[key])]);
  };
  const db = {
    find: async (table, key) => state.get(keyOf(table, key)) ?? null,
    delete: async (table, key) => state.delete(keyOf(table, key)),
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
          const key = keyOf(table, row),
            existing = state.get(key);
          state.set(
            key,
            existing
              ? {
                  ...existing,
                  ...(typeof update === "function" ? update(existing) : update)
                }
              : structuredClone(row)
          );
        },
        onConflictDoNothing: async () => {
          const key = keyOf(table, row);
          if (!state.has(key)) state.set(key, structuredClone(row));
        }
      })
    }),
    update: (table, key) => ({
      set: async (update) => {
        const id = keyOf(table, key),
          previous = state.get(id);
        assert.ok(previous, id);
        state.set(id, { ...previous, ...update });
      }
    })
  };
  for (const [name, chainId] of [
    ["YunipalsEthereum", 1],
    ["YunipalsBnb", 56],
    ["YunipalsPolygon", 137],
    ["YunipalsBase", 8453]
  ]) {
    await handlers
      .find((handler) => handler.name === `${name}:setup`)
      .fn({ context: { db, chain: { id: chainId } } });
  }
  assert.equal(
    [...state.values()].filter(
      (row) => row.manifestHash === sourceManifestHash(manifest)
    ).length,
    manifest.sources.length
  );
  const owner = `0x${"11".repeat(20)}`,
    other = `0x${"22".repeat(20)}`;
  const zero = `0x${"00".repeat(20)}`,
    hash = `0x${"ab".repeat(32)}`;
  for (const [name, chainId] of [
    ["EthereumCheckpoint", 1],
    ["BaseCheckpoint", 8453],
    ["PolygonCheckpoint", 137],
    ["BnbCheckpoint", 56]
  ]) {
    assert.equal(config.blocks[name].startBlock, "latest");
    const handler = handlers.find(
      (handler) => handler.name === `${name}:block`
    );
    await handler.fn({
      context: { db, chain: { id: chainId } },
      event: {
        block: { number: 50000000n, hash, parentHash: hash, timestamp: 1000n }
      }
    });
    assert.equal(
      state.get(keyOf(schema.chainCheckpoint, { id: String(chainId) }))
        .blockHash,
      hash
    );
    assert.ok(
      state.has(keyOf(schema.chainBlock, { id: `${chainId}:50000000` }))
    );
  }
  let logIndex = 0;
  const dispatch = async (
    name,
    args,
    sourceId,
    blockNumber,
    transactionHash = hash
  ) => {
    const source = manifest.sources.find((source) => source.id === sourceId);
    const handler = handlers.find((handler) => handler.name === name);
    assert.ok(source?.enabled && handler, name);
    const before = structuredClone(state);
    try {
      await handler.fn({
        context: { db, chain: { id: source.chainId } },
        event: {
          args,
          block: { number: BigInt(blockNumber), hash, timestamp: 1000n },
          transaction: { hash: transactionHash, transactionIndex: 0 },
          log: {
            address: source.address,
            logIndex: logIndex++,
            topics: [],
            data: "0x"
          }
        }
      });
    } catch (error) {
      state.clear();
      for (const [key, value] of before) state.set(key, value);
      throw error;
    }
  };
  const get = (table, key) => state.get(keyOf(table, key));
  for (const [contract, collection] of [
    ["YunipalsEthereum", "ethereum"],
    ["YunipalsBnb", "bnb"]
  ]) {
    const number = indexedCollections[collection].deploymentBlock;
    await dispatch(
      `${contract}:Transfer`,
      { from: zero, to: owner, tokenId: 1n },
      `ownership:${collection}`,
      number
    );
    assert.equal(get(schema.token, { collection, tokenId: "1" }).owner, owner);
  }
  const number = indexedCollections.bnb.deploymentBlock;
  await dispatch(
    "YunipalsBnb:Transfer",
    { from: zero, to: other, tokenId: 2n },
    "ownership:bnb",
    number
  );
  assert.equal(
    [...state.keys()].filter((key) => key.includes('"transaction_candidate"'))
      .length,
    receiptFloor ? 1 : 2
  );
  if (receiptFloor) {
    assert.equal(
      [...state.values()].filter(
        (row) => row.sourceId === "ownership:bnb" && row.name === "Transfer"
      ).length,
      2,
      "Pre-floor canonical transfers remain indexed."
    );
    assert.equal(
      get(schema.token, { collection: "bnb", tokenId: "2" }).owner,
      other
    );
    await dispatch(
      "BnbSeaport:CounterIncremented",
      { newCounter: 1n, offerer: owner },
      "marketplace:bnb:seaport",
      number
    );
    await dispatch(
      "YunipalsBnb:Transfer",
      { from: other, to: owner, tokenId: 2n },
      "ownership:bnb",
      number
    );
    assert.equal(
      [...state.keys()].filter((key) => key.includes('"transaction_candidate"'))
        .length,
      2,
      "Another eligible source creates the shared transaction candidate, and a below-floor source cannot remove it."
    );
  }
  await dispatch(
    "YunipalsBnb:Transfer",
    { from: owner, to: zero, tokenId: 1n },
    "ownership:bnb",
    number + 1
  );
  await dispatch(
    "YunipalsBnb:Transfer",
    { from: zero, to: other, tokenId: 1n },
    "ownership:bnb",
    number + 2
  );
  if (receiptFloor) {
    assert.equal(
      [...state.keys()].filter((key) => key.includes('"transaction_candidate"'))
        .length,
      2,
      "At/after-floor transfers create one candidate per shared transaction."
    );
  }
  assert.equal(
    get(schema.token, { collection: "bnb", tokenId: "1" }).lifecycle,
    2
  );
  assert.equal(
    get(schema.token, { collection: "ethereum", tokenId: "1" }).owner,
    owner
  );
  await dispatch(
    "YunipalsBnb:RoleGranted",
    { role: hash, account: owner, sender: other },
    "ownership:bnb",
    number + 2
  );
  const baseIslandsNumber =
    indexedCollections["base-islands-v2"].deploymentBlock;
  for (const [contract, collection, sourceId] of [
    ["YunipalsIslands", "ethereum-islands", "islands:ethereum"],
    ["YunipalsBaseIslandsV2", "base-islands-v2", "islands:base:v2"]
  ]) {
    await dispatch(
      `${contract}:Transfer`,
      { from: zero, to: owner, tokenId: 1n },
      sourceId,
      indexedCollections[collection].deploymentBlock
    );
    assert.equal(get(schema.token, { collection, tokenId: "1" }).owner, owner);
  }
  await dispatch(
    "YunipalsBaseIslandsV2:Transfer",
    { from: owner, to: other, tokenId: 1n },
    "islands:base:v2",
    baseIslandsNumber + 1
  );
  await assert.rejects(
    dispatch(
      "YunipalsBaseIslandsV2:Transfer",
      { from: owner, to: zero, tokenId: 1n },
      "islands:base:v2",
      baseIslandsNumber + 2
    ),
    /owner mismatch/
  );
  await dispatch(
    "YunipalsBaseIslandsV2:Transfer",
    { from: other, to: zero, tokenId: 1n },
    "islands:base:v2",
    baseIslandsNumber + 2
  );
  await dispatch(
    "YunipalsBaseIslandsV2:Transfer",
    { from: zero, to: other, tokenId: 1n },
    "islands:base:v2",
    baseIslandsNumber + 3
  );
  assert.equal(
    get(schema.token, { collection: "base-islands-v2", tokenId: "1" })
      .lifecycle,
    2
  );
  assert.equal(
    get(schema.token, { collection: "ethereum-islands", tokenId: "1" }).owner,
    owner
  );
  await dispatch(
    "YunipalsBaseIslandsV2:OwnershipTransferred",
    { previousOwner: owner, newOwner: other },
    "islands:base:v2",
    baseIslandsNumber + 3
  );
  await dispatch(
    "YunipalsBaseIslandsV2:AirdropFinalized",
    {
      totalSupply: 1n,
      sourceBlockNumber: 1n,
      sourceBlockHash: hash,
      distributionSha256: hash
    },
    "islands:base:v2",
    baseIslandsNumber + 3
  );
  const traits = {
    monsterType: 3,
    color: 2,
    horn: 1,
    background: 0,
    glitter: 1,
    rarityScore: 100
  };
  await dispatch(
    "YunipalsBaseMetadata:Mint",
    { to: owner, tokenId: 1n, yunipal: traits },
    "metadata:base",
    indexedCollections.base.deploymentBlock
  );
  const metadata = [...state.values()].find(
    (row) => row.sourceId === "metadata:base"
  );
  assert.equal(JSON.parse(metadata.args).yunipal.rarityScore, 100);
  await dispatch(
    "BoosterEngine:Upgraded",
    { implementation: other },
    "boosters:boosterengine",
    100
  );
  assert.equal(
    [...state.values()].find((row) => row.sourceId === "boosters:boosterengine")
      ?.name,
    "Upgraded"
  );
  await dispatch(
    "BnbSeaport:CounterIncremented",
    { newCounter: 1n, offerer: owner },
    "marketplace:bnb:seaport",
    100
  );
  const arena = process.env.ARENA_CONTRACT,
    sourceId = `arena:8453:${arena}`;
  const arenaEvent = async (name, args) =>
    dispatch(`YunipalsArena:${name}`, args, sourceId, 100);
  const tournamentKey = `8453:${arena}:1`;
  const opening = { id: 1n, deadline: 200n, rulesHash: hash, poolHash: hash };
  await arenaEvent("TournamentOpened", opening);
  await arenaEvent("TournamentTreasuryAssigned", {
    id: 1n,
    beneficiary: owner
  });
  for (let seat = 0; seat < 4; seat++)
    await arenaEvent("Entered", {
      id: 1n,
      seat,
      player: owner,
      nftChainId: 8453n,
      collection: indexedCollections.base.address,
      tokenId: BigInt(seat + 1)
    });
  await arenaEvent("IslandSelected", {
    id: 1n,
    islandId: 2n,
    ticket: 0n,
    beneficiary: other
  });
  await arenaEvent("StrategiesOpened", { id: 1n, deadline: 300n });
  await arenaEvent("InputFrozen", {
    id: 1n,
    deadline: 400n,
    inputHash: hash,
    strategyCommitments: [hash, hash, hash, hash]
  });
  assert.equal(
    get(schema.arenaTournament, { id: tournamentKey }).state.phase,
    "resolving"
  );
  await arenaEvent("ResultSettled", {
    id: 1n,
    resultHash: hash,
    semifinalOneWinner: 0,
    semifinalTwoWinner: 2,
    champion: 0
  });
  const beforePayout = structuredClone(state);
  await arenaEvent("PayoutsReleased", { id: 1n, videoHash: hash });
  assert.equal(
    get(schema.arenaCredit, { id: `8453:${arena}:${owner}` }).amount,
    7_600_000n
  );
  assert.equal(
    get(schema.arenaCredit, { id: `8453:${arena}:${other}` }).amount,
    400_000n
  );
  await assert.rejects(
    arenaEvent("PayoutsReleased", { id: 1n, videoHash: hash }),
    /payout release/
  );
  await assert.rejects(
    arenaEvent("Claimed", {
      player: owner,
      recipient: other,
      amount: 8_000_000n
    }),
    /exceeds indexed credit/
  );
  await arenaEvent("Claimed", {
    player: owner,
    recipient: other,
    amount: 7_600_000n
  });
  assert.equal(
    get(schema.arenaCredit, { id: `8453:${arena}:${owner}` }).amount,
    0n
  );
  // Callback replay after restoring chain state must credit exactly once.
  state.clear();
  for (const [key, value] of beforePayout) state.set(key, value);
  await arenaEvent("PayoutsReleased", { id: 1n, videoHash: hash });
  assert.equal(
    get(schema.arenaCredit, { id: `8453:${arena}:${owner}` }).amount,
    7_600_000n
  );
  assert.ok(
    [...state.keys()].every(
      (key) =>
        !/submission|provider_task|frozen_input|transaction_intent/.test(key)
    )
  );
  console.log(
    JSON.stringify({
      event: "unified_ponder_callbacks_verified",
      sources: manifest.sources.length,
      receiptFloor,
      checks: [
        "four-chain config",
        "all source handlers",
        "installed checkpoint compatibility",
        "manifest binding",
        "BNB lifecycle and chain collisions",
        "Base Islands replacement lifecycle, owner continuity and airdrop commitments",
        "receipt candidate deduplication",
        ...(receiptFloor
          ? [
              "pre-floor ownership/canonical history retained",
              "cross-source same-transaction receipt eligibility"
            ]
          : []),
        "Base metadata",
        "Seaport evidence",
        "Arena seats/payouts/claims/replay",
        "no operational writes"
      ]
    })
  );
} finally {
  await shutdown.kill();
  common.metrics.registry.clear();
}
