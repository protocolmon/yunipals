import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  toHex,
  toFunctionSelector,
  zeroAddress
} from "viem";
import { base } from "viem/chains";
import { english, generateMnemonic } from "viem/accounts";
import { collectionAbi, baseIslandsAbi } from "../lib/abi.ts";
import { baseMetadataAbi } from "../lib/metadata/base-abi.ts";
import { collections, baseIslandCollection } from "../lib/constants.ts";
import { arenaAbi } from "../../../packages/yunipals-market-core/src/arenaAbi.ts";
import {
  boosterPacksAbi,
  packRegistryAbi
} from "../../../packages/yunipals-market-core/src/boosterAbi.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { readPonderRuntime } from "../lib/unified/ponder-reader.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import {
  queueReceiptCandidates,
  claimReceiptJobs,
  enrichReceiptJob
} from "../lib/unified/receipt-worker.ts";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import { readOwnershipToken } from "../../../packages/yunipals-indexer-server/src/ownership.ts";
import { readArenaTournament } from "../../../packages/yunipals-indexer-server/src/arena.ts";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.ts";
import {
  createUnifiedRpcProject,
  logEmitterBytecode
} from "./fixtures/unified-rpc-project.mjs";
import { createBudgetedRpcFixture } from "./fixtures/unified-rpc-budget.mjs";
import { evidenceRpc } from "../lib/unified/rpc.ts";
import { seaportDeployment } from "../../../packages/yunipals-market-core/src/registry.ts";
import { verifyReceiptRuntime } from "../lib/unified/receipt-validation.ts";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    "budget-proxy": { type: "boolean", default: false }
  }
});
const budgetProxy = values["budget-proxy"];
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const databaseUrl = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname));
assert.equal(databaseUrl.pathname, "/yunipals_ponder_dependency_test");
assert.equal(databaseUrl.search, "");
assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
const pool = new pg.Pool({
  connectionString,
  max: 6,
  application_name: "yunipals_real_rpc_smoke",
  statement_timeout: 10000,
  lock_timeout: 1000
});
const directory = await mkdtemp("/tmp/yunipals-real-rpc-");
const schema = `rpc_sync_${Date.now()}_${randomBytes(4).toString("hex")}`;
const anvilPath =
  process.env.UNIFIED_RPC_ANVIL_BINARY ??
  "/tmp/yunipals-foundry/node_modules/@foundry-rs/anvil-linux-amd64/bin/anvil";
const anvilPort = budgetProxy ? 55445 : 55443;
const anvilUrl = `http://127.0.0.1:${anvilPort}`;
const output = resolve(values.output ?? join(directory, "evidence.json"));
assert.ok(
  output.startsWith("/tmp/") ||
    output.startsWith(join(repository, "docs/unified-indexer/"))
);
const safeEnvironment = Object.fromEntries(
  [
    "PATH",
    "LANG",
    "LC_ALL",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR"
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]])
);
const methods = {},
  receipts = [],
  phases = [],
  processStops = [];
let anvil,
  ponder,
  proxy,
  release,
  project,
  activeBefore,
  releasesBefore,
  budgetFixture;
const runStarted = Date.now();
const children = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(label, check, timeout = 60000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    for (const process of children)
      if (process.exitCode !== null || process.signalCode !== null)
        throw new Error(
          `${label}: child exited (${process.exitCode ?? process.signalCode})`
        );
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await wait(250);
  }
  throw new Error(
    `${label}: observation deadline (${last?.message ?? "not ready"})`
  );
}
function child(binary, args, name, env = safeEnvironment) {
  const stream = createWriteStream(join(directory, `${name}.log`));
  const process = spawn(binary, args, {
    cwd: project?.root ?? directory,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  process.stdout.pipe(stream, { end: false });
  process.stderr.pipe(stream, { end: false });
  process.once("close", () => stream.end());
  process.fixtureName = name;
  process.logFlushed = new Promise((resolve) => stream.once("finish", resolve));
  children.push(process);
  return process;
}
async function stop(process) {
  if (!process) return;
  if (process.exitCode !== null || process.signalCode !== null) {
    await process.logFlushed;
    return;
  }
  const started = Date.now();
  let forced = false;
  const terminal = new Promise((resolve) => process.once("exit", resolve));
  process.kill("SIGTERM");
  await Promise.race([terminal, wait(10000)]);
  if (process.exitCode === null && process.signalCode === null) {
    forced = true;
    process.kill("SIGKILL");
    await terminal;
  }
  children.splice(children.indexOf(process), 1);
  await process.logFlushed;
  processStops.push({
    name: process.fixtureName,
    requestedSignal: "SIGTERM",
    forced,
    exitCode: process.exitCode,
    signal: process.signalCode,
    elapsedMs: Date.now() - started
  });
}
async function crashForRecovery(process) {
  const terminal = new Promise((resolve) => process.once("exit", resolve));
  process.kill("SIGKILL");
  await terminal;
  await process.logFlushed;
  children.splice(children.indexOf(process), 1);
  processStops.push({
    name: process.fixtureName,
    requestedSignal: "SIGKILL",
    reason: "intentional crash recovery check",
    exitCode: process.exitCode,
    signal: process.signalCode
  });
}
async function activeSelection() {
  const exists = (
    await pool.query(
      "SELECT to_regclass('yunipals_indexer_control.active_release') AS name"
    )
  ).rows[0].name;
  return exists
    ? (
        await pool.query(
          "SELECT * FROM yunipals_indexer_control.active_release ORDER BY name"
        )
      ).rows
    : [];
}
async function releaseIdentities() {
  const exists = (
    await pool.query(
      "SELECT to_regclass('yunipals_indexer_control.release') AS name"
    )
  ).rows[0].name;
  return exists
    ? (
        await pool.query(
          "SELECT id,physical_schema,build_id,manifest_hash FROM yunipals_indexer_control.release ORDER BY id"
        )
      ).rows
    : [];
}
async function checkpoint(number) {
  return eventually(`complete block ${number}`, async () => {
    const runtime = await readPonderRuntime(pool, schema),
      position = runtime.chains.find(
        (chain) => chain.chainId === 8453
      )?.completeThroughBlock;
    const witness = runtime.witnesses.find((chain) => chain.chainId === 8453);
    return runtime.running &&
      runtime.frameworkReady &&
      position !== null &&
      position !== undefined &&
      position >= number &&
      witness?.blockNumber >= number
      ? runtime
      : null;
  });
}
async function main() {
  // Never connect to, reset or reuse another live Anvil instance.
  const occupied = await fetch(anvilUrl, {
    method: "POST",
    body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(500)
  }).then(
    () => true,
    () => false
  );
  assert.equal(
    occupied,
    false,
    `Dedicated Anvil port${anvilPort} is already occupied`
  );
  assert.equal(
    (await pool.query("SELECT to_regnamespace($1) AS name", [schema])).rows[0]
      .name,
    null
  );
  activeBefore = await activeSelection();
  releasesBefore = await releaseIdentities();
  let genesis;
  const syncExists = (
    await pool.query("SELECT to_regclass('ponder_sync.blocks') AS name")
  ).rows[0].name;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = 1_000_000_000 + randomBytes(3).readUIntBE(0, 3) * 1024;
    if (
      !syncExists ||
      !(
        await pool.query(
          "SELECT 1 FROM ponder_sync.blocks WHERE chain_id=8453 AND number BETWEEN $1 AND $2 LIMIT 1",
          [candidate, candidate + 512]
        )
      ).rowCount
    ) {
      genesis = candidate;
      break;
    }
  }
  assert.ok(genesis, "No unused local chain block range found");
  const startBlock = genesis + 1;
  anvil = child(
    anvilPath,
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(anvilPort),
      "--chain-id",
      "8453",
      "--mnemonic",
      generateMnemonic(english),
      "--number",
      String(genesis),
      "--timestamp",
      String(Math.floor(Date.now() / 1000) - (budgetProxy ? 220 : 60)),
      "--silent"
    ],
    "anvil"
  );
  const client = createPublicClient({
    chain: base,
    transport: http(anvilUrl, { retryCount: 0, timeout: 10000 })
  });
  await eventually(
    "Anvil startup",
    async () => (await client.getChainId()) === 8453
  );
  const accounts = await client.request({ method: "eth_accounts" });
  const [alice, bob, carol] = accounts.map((value) => value.toLowerCase());
  const wallet = createWalletClient({
    chain: base,
    transport: http(anvilUrl, { retryCount: 0, timeout: 10000 }),
    account: alice
  });
  const address = () => `0x${randomBytes(20).toString("hex")}`;
  const arena = address(),
    registry = address(),
    engine = address(),
    monsters = address(),
    wrapper = address();
  const contracts = [
    collections.base.address,
    baseIslandCollection.address,
    arena,
    registry,
    engine,
    monsters
  ];
  const bytecode = logEmitterBytecode();
  for (const address of contracts)
    await client.request({
      method: "anvil_setCode",
      params: [address, bytecode]
    });
  let companionSeaport;
  if (budgetProxy) {
    const fixturePath = join(
      repository,
      "apps/yunipals-market-api/src/opensea/fixtures/seaport-base-bytecode.json"
    );
    const fixtureBytes = await readFile(fixturePath),
      fixture = JSON.parse(fixtureBytes.toString());
    const runtimeHash = verifyReceiptRuntime(8453, fixture.code);
    await client.request({
      method: "anvil_setCode",
      params: [seaportDeployment.address, fixture.code]
    });
    await client.request({
      method: "anvil_setCode",
      params: [
        collections.base.address,
        logEmitterBytecode({
          address: seaportDeployment.address,
          selector: toFunctionSelector("incrementCounter()")
        })
      ]
    });
    companionSeaport = {
      address: seaportDeployment.address.toLowerCase(),
      runtimeHash,
      fixtureSha256: sha256(fixtureBytes)
    };
    await client.call({
      to: collections.base.address,
      data: concatHex(Array.from({ length: 6 }, () => toHex(0, { size: 32 })))
    });
  }
  await client.request({
    method: "anvil_mine",
    params: [toHex(budgetProxy ? 200 : 40), "0x1"]
  });
  const warmHead = await client.getBlockNumber({ cacheTime: 0 });
  project = await createUnifiedRpcProject({
    repository,
    directory,
    startBlock,
    budgetProxy
  });
  proxy = createServer(async (request, response) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1048576) throw new Error("RPC body limit");
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks),
        parsed = JSON.parse(body.toString());
      for (const call of [parsed].flat()) {
        assert.ok(
          !/^(eth_send|eth_sign|personal_|anvil_|evm_)/.test(call.method),
          "Ponder must remain a read-only ingestor"
        );
        methods[call.method] = (methods[call.method] ?? 0) + 1;
      }
      const upstream = await fetch(anvilUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(15000)
      });
      response.writeHead(upstream.status, {
        "Content-Type": "application/json"
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.writeHead(502);
      response.end('{"error":"Local RPC proxy request failed"}');
    }
  });
  if (budgetProxy) {
    const { buildSourceManifest } = await import(
      pathToFileURL(join(project.root, "lib/unified/sources.ts")).href
    );
    const fixtureEnv = {
      ARENA_CONTRACT: arena,
      ARENA_DEPLOYMENT_BLOCK: String(startBlock),
      BOOSTER_REGISTRY: registry,
      BOOSTER_ENGINE: engine,
      BOOSTER_MONSTERS: monsters,
      BOOSTER_WRAPPER: wrapper,
      BOOSTER_DEPLOYMENT_BLOCK: String(startBlock),
      UNIFIED_BASE_ISLANDS_V2_ENABLED: "true"
    };
    budgetFixture = await createBudgetedRpcFixture({
      repository,
      manifest: buildSourceManifest(fixtureEnv),
      anvilUrl,
      startBlock,
      directory,
      methods,
      forceHistoricalFreeFailure: true
    });
    proxy = budgetFixture.proxy;
  }
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const rpcUrl = `http://127.0.0.1:${proxy.address().port}${budgetProxy ? "/unified" : ""}`;
  const environment = {
    ...safeEnvironment,
    DATABASE_URL: connectionString,
    ARENA_CONTRACT: arena,
    ARENA_DEPLOYMENT_BLOCK: String(startBlock),
    PONDER_RPC_URL_8453: rpcUrl,
    BOOSTER_REGISTRY: registry,
    BOOSTER_ENGINE: engine,
    BOOSTER_MONSTERS: monsters,
    BOOSTER_WRAPPER: wrapper,
    BOOSTER_DEPLOYMENT_BLOCK: String(startBlock),
    UNIFIED_BASE_ISLANDS_V2_ENABLED: "true"
  };
  if (budgetFixture)
    Object.assign(environment, {
      UNIFIED_RPC_POLICY_REQUIRED: "true",
      UNIFIED_RPC_PROFILE_FILE: budgetFixture.profilePath,
      UNIFIED_RPC_PROFILE_ID: budgetFixture.profileId,
      UNIFIED_RPC_REPLAY_PERMIT_ID: budgetFixture.permitId
    });
  const ponderBin = fileURLToPath(
    new URL("./bin/ponder.js", import.meta.resolve("ponder"))
  );
  function startPonder(name) {
    return child(
      process.execPath,
      [
        ponderBin,
        "start",
        "--root",
        project.root,
        "--schema",
        schema,
        "--port",
        String(budgetProxy ? 55446 : 55444),
        "--hostname",
        "127.0.0.1",
        "--log-level",
        "debug",
        "--log-format",
        "json"
      ],
      name,
      environment
    );
  }
  ponder = startPonder("ponder");
  const initial = await checkpoint(warmHead);
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM ${schema}.canonical_event`
      )
    ).rows[0].n,
    0
  );
  phases.push({
    name: "empty initial coverage",
    block: String(warmHead),
    complete: String(initial.chains[0].completeThroughBlock),
    events: 0
  });
  const definitions = (
    await pool.query(
      `SELECT definition FROM ${schema}.indexer_source ORDER BY id`
    )
  ).rows.map((row) => JSON.parse(row.definition));
  assert.equal(definitions.length, 7);
  const manifest = {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: definitions
  };
  if (budgetProxy)
    assert.equal(
      manifest.sources.some(
        (source) =>
          source.address?.toLowerCase() ===
          seaportDeployment.address.toLowerCase()
      ),
      false,
      "Companion code proof adds no Seaport event coverage"
    );
  await migrateIndexerControl(pool);
  release = await registerIndexerRelease(pool, {
    schema,
    buildId: initial.buildId,
    manifest
  });
  const proxyEvidence = budgetProxy ? evidenceRpc(8453, environment) : null;
  const rpc = {
    providerId: "isolated-anvil-55443",
    chainId: () =>
      proxyEvidence ? proxyEvidence.chainId() : client.getChainId(),
    block: async (value) => {
      if (value === "finalized")
        throw new Error("Isolated Anvil does not supply Ethereum finality");
      if (proxyEvidence) return proxyEvidence.block(value);
      const block = await client.getBlock(
        typeof value === "bigint" ? { blockNumber: value } : { blockTag: value }
      );
      return {
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: block.timestamp
      };
    },
    receipt: (hash) =>
      proxyEvidence
        ? proxyEvidence.receipt(hash)
        : client.request({
            method: "eth_getTransactionReceipt",
            params: [hash]
          }),
    code: async (address, blockNumber) =>
      proxyEvidence
        ? proxyEvidence.code(address, blockNumber)
        : ((await client.getCode({ address, blockNumber })) ?? "0x")
  };
  async function observe() {
    assert.equal(
      await observeIndexerChain(pool, release, 8453, rpc),
      "observed"
    );
  }
  async function emit(address, abi, name, args) {
    const event = abi.find(
      (item) => item.type === "event" && item.name === name
    );
    assert.ok(event);
    const topics = encodeEventTopics({ abi, eventName: name, args });
    const fields = event.inputs.filter((input) => !input.indexed);
    const data = encodeAbiParameters(
      fields,
      fields.map((input) => args[input.name])
    );
    const payload = concatHex([
      toHex(topics.length, { size: 32 }),
      toHex((data.length - 2) / 2, { size: 32 }),
      ...Array.from(
        { length: 4 },
        (_, i) => topics[i] ?? toHex(0, { size: 32 })
      ),
      data
    ]);
    const transactionHash = await wallet.sendTransaction({
      to: address,
      data: payload,
      gas: 200000n
    });
    const receipt = await client.waitForTransactionReceipt({
      hash: transactionHash
    });
    assert.equal(receipt.status, "success");
    const companion =
      budgetProxy && address.toLowerCase() === collections.base.address;
    assert.equal(receipt.logs.length, companion ? 2 : 1);
    if (companion)
      assert.equal(
        receipt.logs[1].address.toLowerCase(),
        seaportDeployment.address.toLowerCase()
      );
    assert.deepEqual(receipt.logs[0].topics, topics);
    assert.equal(receipt.logs[0].data, data);
    receipts.push({
      name,
      address,
      transactionHash,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash
    });
    return receipt;
  }
  const hash = () => `0x${randomBytes(32).toString("hex")}`;
  const mint = await emit(collections.base.address, collectionAbi, "Transfer", {
    from: zeroAddress,
    to: alice,
    tokenId: 1n
  });
  await emit(baseIslandCollection.address, baseIslandsAbi, "Transfer", {
    from: zeroAddress,
    to: alice,
    tokenId: 1n
  });
  await emit(collections.base.address, baseMetadataAbi, "Mint", {
    to: alice,
    tokenId: 1n,
    yunipal: {
      monsterType: 1,
      color: 2,
      horn: 1,
      background: 1,
      glitter: 0,
      rarityScore: 100n
    }
  });
  await emit(arena, arenaAbi, "TournamentOpened", {
    id: 1n,
    rulesHash: hash(),
    poolHash: hash(),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600)
  });
  await emit(arena, arenaAbi, "Entered", {
    id: 1n,
    seat: 0,
    player: alice,
    nftChainId: 8453n,
    collection: collections.base.address,
    tokenId: 1n
  });
  await emit(registry, packRegistryAbi, "TypeActivated", {
    packTypeId: 1n,
    engine,
    paymentToken: address(),
    price: 10n ** 18n,
    intervalSeconds: 86400n,
    mintsPerInterval: 1,
    totalVariants: 264,
    maxBatch: 8,
    catalogHash: hash(),
    ruleHash: hash(),
    manifestURI: "https://fixture.invalid/catalog",
    metadataBaseURI: "https://fixture.invalid/metadata/"
  });
  await emit(engine, boosterPacksAbi, "RequestsPaused", { paused: false });
  await checkpoint(await client.getBlockNumber({ cacheTime: 0 }));
  await observe();
  const reader = await createIndexerReader(pool, { releaseId: release.id });
  assert.equal(
    (
      await readOwnershipToken(
        reader,
        {
          collection: "base",
          sourceId: "ownership:base",
          policy: { kind: "latest" }
        },
        "1"
      )
    ).token.owner,
    alice
  );
  assert.equal(
    (
      await pool.query(
        `SELECT state->'seats' AS seats FROM ${schema}.arena_tournament`
      )
    ).rows[0].seats.length,
    1
  );
  assert.equal(
    (
      await pool.query(
        `SELECT total_variants::text AS n FROM ${schema}.booster_type`
      )
    ).rows[0].n,
    "264"
  );
  async function enrich() {
    await queueReceiptCandidates(pool, release, 8453);
    const jobs = await claimReceiptJobs(pool, release, 8453, 32);
    for (const job of jobs)
      assert.equal(await enrichReceiptJob(pool, release, job, rpc), "stored");
    return jobs.length;
  }
  const firstReceipts = await enrich();
  assert.ok(firstReceipts >= 1);
  const stableHead = await client.getBlock({ blockTag: "latest" });
  const snapshot = await client.request({ method: "evm_snapshot" });
  phases.push({
    name: "stable prefix",
    block: String(stableHead.number),
    events: receipts.length,
    fullReceipts: firstReceipts
  });
  async function branch(owner, paused, color) {
    const transfer = await emit(
      collections.base.address,
      collectionAbi,
      "Transfer",
      { from: alice, to: owner, tokenId: 1n }
    );
    await emit(baseIslandCollection.address, baseIslandsAbi, "Transfer", {
      from: alice,
      to: owner,
      tokenId: 1n
    });
    await emit(arena, arenaAbi, "Entered", {
      id: 1n,
      seat: 1,
      player: owner,
      nftChainId: 8453n,
      collection: collections.base.address,
      tokenId: 2n
    });
    await emit(engine, boosterPacksAbi, "RequestsPaused", { paused });
    await emit(collections.base.address, baseMetadataAbi, "Update", {
      to: owner,
      tokenId: 1n,
      yunipal: {
        monsterType: 1,
        color,
        horn: 1,
        background: 1,
        glitter: 1,
        rarityScore: 100n
      }
    });
    await client.request({ method: "anvil_mine", params: ["0x2", "0x1"] });
    return transfer;
  }
  const old = await branch(bob, true, 3);
  const oldHead = await client.getBlock({ blockTag: "latest" });
  await checkpoint(oldHead.number);
  await observe();
  await enrich();
  const oldBlocks = await Promise.all(
    Array.from(
      { length: Number(oldHead.number - stableHead.number) },
      (_, index) =>
        client.getBlock({ blockNumber: stableHead.number + BigInt(index) + 1n })
    )
  );
  const oldHashes = oldBlocks.map((block) => block.hash);
  assert.equal(oldHashes.length, 7);
  assert.equal(
    (
      await pool.query(
        `SELECT owner FROM ${schema}.token WHERE collection='base' AND token_id='1'`
      )
    ).rows[0].owner,
    bob
  );
  assert.equal(
    (await pool.query(`SELECT paused FROM ${schema}.booster_engine_state`))
      .rows[0].paused,
    true
  );
  phases.push({
    name: "first branch",
    block: String(oldHead.number),
    hash: oldHead.hash,
    owner: bob
  });
  assert.equal(
    await client.request({ method: "evm_revert", params: [snapshot] }),
    true
  );
  await client.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(stableHead.timestamp) + 9]
  });
  const replacement = await branch(carol, false, 4);
  assert.notEqual(replacement.blockHash, old.blockHash);
  const replacementHead = await client.getBlock({ blockTag: "latest" });
  await eventually("real RPC reorg rollback and replay", async () => {
    await checkpoint(replacementHead.number);
    const current = (
      await pool.query(
        `SELECT owner FROM ${schema}.token WHERE collection='base' AND token_id='1'`
      )
    ).rows[0];
    return (
      current?.owner === carol &&
      !(
        await pool.query(
          `SELECT 1 FROM ${schema}.canonical_event WHERE block_hash=$1`,
          [old.blockHash]
        )
      ).rowCount
    );
  });
  await observe();
  const replacementReceipts = await enrich();
  assert.ok(replacementReceipts >= 1);
  for (const table of [
    "canonical_event",
    "chain_block",
    "booster_event",
    "transaction_candidate"
  ])
    assert.equal(
      (
        await pool.query(
          `SELECT count(*)::integer AS n FROM ${schema}.${table} WHERE block_hash=ANY($1::text[])`,
          [oldHashes]
        )
      ).rows[0].n,
      0
    );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM ${schema}.transfer_event WHERE transaction_hash=$1`,
        [old.transactionHash]
      )
    ).rows[0].n,
    0
  );
  assert.equal(
    (
      await pool.query(
        `SELECT owner FROM ${schema}.token WHERE collection='base-islands-v2'`
      )
    ).rows[0].owner,
    carol
  );
  assert.equal(
    (
      await pool.query(
        `SELECT state->'seats'->1->>'player' AS player FROM ${schema}.arena_tournament`
      )
    ).rows[0].player,
    carol
  );
  assert.equal(
    (await pool.query(`SELECT paused FROM ${schema}.booster_engine_state`))
      .rows[0].paused,
    false
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM ${schema}.canonical_event`
      )
    ).rows[0].n,
    12
  );
  assert.equal(
    (
      await pool.query(
        `SELECT block_hash FROM ${schema}.chain_checkpoint WHERE chain_id=8453`
      )
    ).rows[0].block_hash,
    replacementHead.hash
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::integer AS n FROM ${schema}.canonical_event WHERE name='Update'`
      )
    ).rows[0].n,
    1
  );
  const currentReader = await createIndexerReader(pool, {
    releaseId: release.id
  });
  assert.equal(
    (
      await readOwnershipToken(
        currentReader,
        {
          collection: "base",
          sourceId: "ownership:base",
          policy: { kind: "latest" }
        },
        "1"
      )
    ).token.owner,
    carol
  );
  const arenaState = await readArenaTournament(
    currentReader,
    {
      contract: arena,
      startBlock: String(startBlock),
      abiHash: manifestDigest(arenaAbi)
    },
    "1"
  );
  assert.equal(arenaState.tournament.state.seats[1].player, carol);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer AS n FROM yunipals_indexer_control.transaction_evidence WHERE chain_id=8453 AND transaction_hash=ANY($1::text[])",
        [[old.transactionHash, replacement.transactionHash]]
      )
    ).rows[0].n,
    2
  );
  phases.push({
    name: "replacement branch",
    block: String(replacementHead.number),
    hash: replacementHead.hash,
    owner: carol,
    fullReceipts: replacementReceipts,
    oldReceiptRetainedAsHistory: true
  });
  await crashForRecovery(ponder);
  ponder = startPonder("ponder-restart");
  await client.request({ method: "anvil_mine", params: ["0x3", "0x1"] });
  const resumedHead = await client.getBlock({ blockTag: "latest" });
  await checkpoint(resumedHead.number);
  assert.equal(
    (
      await pool.query(
        `SELECT owner FROM ${schema}.token WHERE collection='base'`
      )
    ).rows[0].owner,
    carol
  );
  // Ponder flushes its sync cache as its internal recovery window advances.
  // This depth is framework recovery bookkeeping, not Ethereum finality.
  await client.request({ method: "anvil_mine", params: ["0x41", "0x1"] });
  await checkpoint(await client.getBlockNumber({ cacheTime: 0 }));
  const syncReceipt = budgetProxy
    ? null
    : await eventually(
        "Ponder persisted full receipt",
        async () =>
          (
            await pool.query(
              "SELECT transaction_hash,block_hash FROM ponder_sync.transaction_receipts WHERE chain_id=8453 AND block_number=$1 AND transaction_hash=$2",
              [String(mint.blockNumber), mint.transactionHash]
            )
          ).rows[0]
      );
  if (syncReceipt) assert.equal(syncReceipt.block_hash, mint.blockHash);
  const budgetEvidence = budgetFixture ? await budgetFixture.evidence() : null;
  if (budgetEvidence) {
    assert.ok(
      budgetEvidence.routes.paid > 0,
      "Deliberate free-source failure exercised the bounded local paid route"
    );
    assert.equal(budgetEvidence.deliberateFallback.failures, 1);
    assert.ok(budgetEvidence.deliberateFallback.batchCalls > 0);
    assert.ok(budgetEvidence.deliberateFallback.expectedPaidCu > 0);
    assert.ok(BigInt(budgetEvidence.permit.spent_cu) > 0n);
    assert.equal(
      BigInt(budgetEvidence.permit.spent_cu),
      BigInt(budgetEvidence.modeledPaidCu),
      "Every reserved permit CU matches actual local paid dispatch members"
    );
    assert.ok(
      budgetEvidence.modeledPaidCu >=
        budgetEvidence.deliberateFallback.expectedPaidCu,
      "The deliberately failed free batch retained its full modeled paid cost"
    );
    assert.ok(
      BigInt(budgetEvidence.permit.spent_cu) <=
        BigInt(budgetEvidence.permit.maximum_cu)
    );
    assert.equal(
      methods.eth_getBlockReceipts ?? 0,
      0,
      "Production Ponder receipt option stays disabled"
    );
    const verified = (
      await pool.query(
        "SELECT count(*)::integer AS n FROM yunipals_indexer_control.transaction_evidence WHERE chain_id=8453 AND transaction_hash=ANY($1::text[]) AND block->>'seaportRuntimeHash'=$2",
        [
          receipts.map((receipt) => receipt.transactionHash),
          companionSeaport.runtimeHash
        ]
      )
    ).rows[0].n;
    assert.equal(
      verified,
      3,
      "All three full receipts retain the actual Base Seaport runtime proof"
    );
    assert.ok(
      methods.eth_getCode >= 3,
      "Companion runtime is fetched through the actual isolated proxy"
    );
    budgetEvidence.companionSeaport = {
      ...companionSeaport,
      verifiedReceipts: verified,
      eventSourceRegistered: false
    };
  }
  assert.deepEqual(await activeSelection(), activeBefore);
  const afterReleases = await releaseIdentities();
  const protectedIds = new Set(releasesBefore.map((row) => row.id));
  assert.deepEqual(
    afterReleases.filter((row) => protectedIds.has(row.id)),
    releasesBefore
  );
  assert.ok(methods.eth_getLogs > 0);
  assert.ok(methods.eth_getBlockByNumber > 0);
  assert.ok(
    (methods.eth_getTransactionReceipt ?? 0) +
      (methods.eth_getBlockReceipts ?? 0) >
      0
  );
  phases.push({
    name: "process crash/restart and quiet-block resume",
    block: String(resumedHead.number),
    hash: resumedHead.hash,
    owner: carol
  });
  await stop(ponder);
  ponder = undefined;
  await stop(anvil);
  anvil = undefined;
  const ponderLog = await readFile(join(directory, "ponder.log"), "utf8"),
    restartLog = await readFile(join(directory, "ponder-restart.log"), "utf8");
  const reorgLog = ponderLog
    .split("\n")
    .filter(
      (line) =>
        line.includes('"msg":"Detected reorg in local chain"') ||
        line.includes('"msg":"Reorged block"')
    );
  assert.ok(reorgLog.some((line) => line.includes('"msg":"Reorged block"')));
  if (budgetProxy)
    assert.ok(
      ponderLog.includes('"msg":"Updated eth_getLogs range"') ||
        ponderLog.includes('"msg":"Caught eth_getLogs range error"'),
      "Installed Ponder adapted to the profile range cap"
    );
  const runtimeHashes = await Promise.all(
    [
      "./database/actions.js",
      "./database/yunipals-reorg-triggers.mjs",
      "./runtime/realtime.js",
      "./runtime/multichain.js",
      "./sync-realtime/index.js"
    ].map(async (path) => ({
      path,
      sha256: sha256(
        await readFile(new URL(path, import.meta.resolve("ponder")))
      )
    }))
  );
  return {
    version: 1,
    date: new Date().toISOString(),
    scope: "actual installed Ponder RPC sync, Base-only combined handler smoke",
    productionChanged: false,
    realProviderRequests: 0,
    mainnetBroadcasts: 0,
    schema,
    releaseId: release.id,
    buildId: release.buildId,
    genesis: String(genesis),
    startBlock: String(startBlock),
    directory,
    output,
    elapsedMs: Date.now() - runStarted,
    protectedControl: {
      activeSelectionUnchanged: true,
      retainedReleaseCount: releasesBefore.length,
      retainedReleaseIdentitiesSha256: sha256(JSON.stringify(releasesBefore))
    },
    fixture: project,
    harness: {
      path: "apps/yunipals-indexer/scripts/test-unified-rpc-sync.mjs",
      sha256: sha256(await readFile(fileURLToPath(import.meta.url)))
    },
    installedPonder: { version: "0.17.5", runtimeHashes },
    phases,
    reorg: {
      depth: oldHashes.length,
      orphanedBlockHashes: oldHashes,
      canonicalEvents: 12,
      logs: reorgLog.map((line) => JSON.parse(line))
    },
    processStops,
    logs: {
      ponder: {
        path: join(directory, "ponder.log"),
        sha256: sha256(ponderLog)
      },
      restart: {
        path: join(directory, "ponder-restart.log"),
        sha256: sha256(restartLog)
      }
    },
    rpcMethods: methods,
    budgetProxy: budgetEvidence,
    receipts,
    limitations: [
      "Base only; no Ethereum/BNB/Polygon/Solana RPC synchronization is proved",
      "Temporary project changes only registration/manifest/start configuration; production handler bodies and schemas are copied with recorded hashes",
      "Local EVM log emitters exercise real RPC/log/receipt synchronization, not the economics or authorization of deployed production contracts",
      "Anvil supplies no Ethereum finality; shared observer is explicitly latest-only and never fabricates a finalized anchor",
      "Source schema and release evidence are retained; global control/active release/cache data are never reset or dropped",
      "This is a short reorg/restart smoke test, not historical production replay, capacity, full parity or backup/cutover acceptance"
    ]
  };
}
try {
  const evidence = await main();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(
    JSON.stringify({
      event: "unified_real_rpc_smoke_passed",
      schema,
      releaseId: release.id,
      output,
      phases: evidence.phases,
      rpcMethods: methods
    })
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "unified_real_rpc_smoke_failed",
      schema,
      directory,
      error: error.message,
      phases,
      rpcMethods: methods
    })
  );
  process.exitCode = 1;
} finally {
  await stop(ponder);
  await stop(anvil);
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (budgetFixture) await budgetFixture.close();
  await pool.end();
}
