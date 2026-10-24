#!/usr/bin/env node
// Installed Ponder behavior, synthetic RPC only; no production/DB/provider work.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, registerHooks } from "node:module";
import { readFile, writeFile, mkdir, mkdtemp, symlink, open } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = path.join(ROOT, "apps/yunipals-indexer");
const SOURCE = "/tmp/yunipals-combined-ypal-build-20261023";
const PAYLOAD = path.join(ROOT, "ops/unified-indexer-transition/ypal-combined-source-v1/payload");
const sha = value => createHash("sha256").update(value).digest("hex");
const hex = n => "0x" + BigInt(n).toString(16);
const hash = n => "0x" + BigInt(n).toString(16).padStart(64, "0");
const require = createRequire(path.join(APP, "package.json"));
const ponderRequire = createRequire(realpathSync(path.join(APP, "node_modules/ponder/package.json")));
const ponder = pathToFileURL(ponderRequire.resolve("./dist/esm/index.js"));
const internal = name => import(new URL(name, ponder));
assert.equal(ponderRequire("./package.json").version, "0.17.5");
const PONDER_MANIFEST_SHA = "8d23c2a50ed66655d2e13bd8af093eba5cebe19cf0541efa27a0480abf9f29ca";
const manifestBytes = readFileSync(new URL("./ypal-bnb-cost-study-v1.ponder-files.json", import.meta.url));
assert.equal(sha(manifestBytes), PONDER_MANIFEST_SHA);
const runtimeFiles = JSON.parse(manifestBytes);
for (const file of runtimeFiles.files) {
  const raw = readFileSync(new URL("../../" + file.path, ponder));
  assert.equal(raw.length, file.bytes); assert.equal(sha(raw), file.sha256, file.path);
}
let sockets = 0;
net.Socket.prototype.connect = function () { sockets++; throw Error("cost_study_real_socket_forbidden"); };
globalThis.fetch = async () => { throw Error("cost_study_real_fetch_forbidden"); };
const logger = Object.fromEntries(["trace", "debug", "info", "warn", "error", "fatal"].map(k => [k, () => {}]));
logger.child = () => logger;
logger.warn = value => { if (value.error) throw value.error; };
const common = { logger, shutdown: { isKilled: false }, options: { command: "start" } };
const START = 129499248, LENGTH = 31000;
const address = "0x" + "11".repeat(20), topic = hash(555);

function block(number, eventBlocks = new Set()) {
  const tx = { hash: hash(number + 1000000000), blockHash: hash(number), blockNumber: hex(number), transactionIndex: "0x0",
    from: address, to: address, nonce: "0x0", gas: "0x5208", gasPrice: "0x1", value: "0x0", input: "0x", type: "0x0",
    v: "0x1b", r: "0x1", s: "0x1" };
  return { number: hex(number), hash: hash(number), parentHash: hash(number - 1), timestamp: hex(1700000000 + number),
    logsBloom: "0x" + "00".repeat(256), transactions: eventBlocks.has(number) ? [tx] : [] };
}
function filter(interval) {
  return { type: "block", chainId: 56, sourceId: "BnbCheckpoint", interval, offset: START % interval,
    fromBlock: START, toBlock: undefined, hasTransactionReceipt: false, include: [] };
}
const logFilter = { type: "log", chainId: 56, sourceId: "SyntheticEvent", address, topic0: topic,
  topic1: null, topic2: null, topic3: null, fromBlock: START, toBlock: undefined,
  hasTransactionReceipt: false, include: [] };

export async function historical(interval, eventOffsets = [], length = LENGTH) {
  assert([1, 10].includes(interval)); assert(Number.isSafeInteger(length) && length > 0 && length <= LENGTH);
  assert(eventOffsets.every(v => Number.isSafeInteger(v) && v >= 0 && v < length));
  const { createHistoricalSync } = await internal("./sync-historical/index.js");
  const eventBlocks = new Set(eventOffsets.map(n => START + n));
  const calls = {}, selected = [], cached = { blocks: 0, logs: 0, transactions: 0 };
  const rpc = { request: async ({ method, params }) => {
    calls[method] = (calls[method] ?? 0) + 1;
    assert.equal(method, "eth_getBlockByNumber"); assert.equal(params[1], true);
    const number = Number(BigInt(params[0])); selected.push(number); return block(number, eventBlocks);
  } };
  const store = Object.fromEntries(["Blocks", "Transactions", "TransactionReceipts", "Traces", "Logs"].map(type => ["insert" + type,
    async values => { if (type.toLowerCase() in cached) cached[type.toLowerCase()] += values[type[0].toLowerCase() + type.slice(1)].length; }]));
  const logs = eventOffsets.map((offset, index) => ({ address, topics: [topic], data: "0x", blockNumber: hex(START + offset),
    blockHash: hash(START + offset), transactionHash: hash(START + offset + 1000000000), transactionIndex: "0x0", logIndex: hex(index) }));
  const chain = { id: 56, name: "bnb", finalityBlockCount: 32, disableCache: false };
  const sync = createHistoricalSync({ common, chain, rpc, childAddresses: new Map() });
  const t = performance.now();
  await sync.syncBlockData({ interval: [START, START + length - 1],
    requiredIntervals: [{ interval: [START, START + length - 1], filter: filter(interval) },
      { interval: [START, START + length - 1], filter: logFilter }], logs, syncStore: store });
  const callbacks = selected.filter(n => n % interval === START % interval).length;
  assert.equal(new Set(selected).size, selected.length);
  for (const height of eventBlocks) assert(selected.includes(height), "real Ponder must fetch nonsampled event block");
  assert.equal(cached.logs, logs.length);
  return { kind: "synthetic-historical-tail", interval, blocks: length, syntheticEvents: logs.length,
    syntheticEventBlocks: eventBlocks.size, fullHeaderRequests: calls.eth_getBlockByNumber ?? 0,
    callbackCount: callbacks, baselineApplicationDbOperations: callbacks * 3, cacheRows: cached,
    actualRpcActionValidated: true, milliseconds: Math.round(performance.now() - t),
    sourceReceiptEnrichmentBenchmarked: false, productionTailEventCountClaimed: false };
}

export async function realtime(pollingInterval, interval = 1) {
  assert([2000, 10000].includes(pollingInterval)); assert([1, 10].includes(interval));
  const { createRealtimeSync } = await internal("./sync-realtime/index.js");
  const { standardizeBlock } = await internal("./rpc/actions.js");
  const durationMs = 120000, blockTimeMs = 450, first = START;
  let current = first, latestCalls = 0, missingCalls = 0, emptyLogCalls = 0, events = 0, matched = 0;
  const rpc = { request: async ({ method, params }) => {
    if (method === "eth_getLogs") { emptyLogCalls++; return []; }
    assert.equal(method, "eth_getBlockByNumber"); assert.equal(params[1], true);
    missingCalls++; return block(Number(BigInt(params[0])));
  } };
  const sync = createRealtimeSync({ common, chain: { id: 56, name: "bnb", pollingInterval,
    finalityBlockCount: 100000, disableCache: false }, rpc,
    eventCallbacks: [{ filter: filter(interval) }], syncProgress: { finalized: block(first) }, childAddresses: new Map() });
  for (let time = pollingInterval; time <= durationMs; time += pollingInterval) {
    const height = first + Math.floor(time / blockTimeMs); latestCalls++;
    const head = standardizeBlock(block(height), { method: "eth_getBlockByNumber", params: ["latest", true] });
    for await (const event of sync.sync(head)) if (event.type === "block") { events++; current = Number(BigInt(event.block.number)); if (event.hasMatchedFilter) matched++; }
  }
  assert.equal(current, first + Math.floor(durationMs / blockTimeMs));
  assert.equal(events, current - first);
  return { kind: "installed-Ponder-realtime-gap-reconciliation", syntheticMilliseconds: durationMs, syntheticBlockTimeMs: blockTimeMs,
    pollingInterval, interval, indexedBlocks: events, latestHeaderRequests: latestCalls, missingHeaderRequests: missingCalls,
    totalFullHeaderRequests: latestCalls + missingCalls, blockCallbacks: matched, baselineApplicationDbOperations: matched * 3,
    syntheticZeroBloomLogRequests: emptyLogCalls, realTimeWaits: false, providerRequests: 0 };
}

export function renderPolling10(config) {
  assert.equal(sha(config), "c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4", "exact71e-config-source-required");
  const polling = /bnb: \{\s*id: 56,[\s\S]*?pollingInterval: 2_000/;
  assert.equal((config.match(new RegExp(polling.source, "g")) ?? []).length, 1);
  return config.replace(polling, match => match.replace("2_000", "10_000"));
}

async function buildWorker(project) {
  if (process.env.COST_STUDY_DIAGNOSTIC === "1") process.stderr.write("entered_build_worker\n");
  const { createBuild } = await internal("./build/index.js");
  if (process.env.COST_STUDY_DIAGNOSTIC === "1") process.stderr.write("imported_build\n");
  const { createLogger } = await internal("./internal/logger.js");
  const { MetricsService } = await internal("./internal/metrics.js");
  const { buildOptions } = await internal("./internal/options.js");
  const { createShutdown } = await internal("./internal/shutdown.js");
  const profile = JSON.parse(await readFile(path.join(ROOT, "ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"), "utf8"));
  const viemEntry = createRequire(path.join(project, "package.json")).resolve("viem").replace("/_cjs/", "/_esm/");
  registerHooks({ resolve(specifier, context, next) {
    if (specifier === "viem" && context.parentURL?.startsWith(pathToFileURL(path.resolve(project, "../../packages") + path.sep).href))
      return next(pathToFileURL(viemEntry).href, context);
    return next(specifier, context);
  } });
  const policy = await import(pathToFileURL(path.join(ROOT, "packages/yunipals-indexer-server/src/rpc-policy.ts")));
  let intercepted = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), chain = { 19221: 1, 19222: 8453, 19223: 137, 19224: 56 }[url.port];
    assert.equal(url.hostname, "127.0.0.1"); assert(chain); intercepted++;
    const headers = new Headers(options.headers);
    if (url.pathname === "/unified/preflight" && !options.method)
      return new Response(JSON.stringify({ profileId: policy.unifiedRpcProfileId(profile), manifestHash: policy.unifiedRpcManifestId(profile),
        chainId: chain, coordinatorId: profile.coordinatorId, scope: profile.scope, workload: headers.get("x-yunipals-rpc-workload"),
        paid: "explicit_bounded_permit_only", budget: { offlineFixture: true }, replay: { mode: "free_only" } }));
    assert.equal(url.pathname, "/unified"); assert.equal(JSON.parse(options.body).method, "eth_chainId");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: hex(chain) }));
  };
  const cliOptions = { root: project, config: "ponder.config.ts", command: "start", version: "0.17.5",
    schema: "cost_study_only", logLevel: "silent", logFormat: "json" };
  const shutdown = createShutdown();
  const common = { options: buildOptions({ cliOptions }), logger: createLogger({ level: "silent", mode: "json" }),
    metrics: new MetricsService(), shutdown, buildShutdown: shutdown, apiShutdown: shutdown };
  const hashes = []; let config, handler;
  const stage = value => { if (process.env.COST_STUDY_DIAGNOSTIC === "1") process.stderr.write(value + "\n"); };
  try {
    const build = await createBuild({ common, cliOptions });
    for (const method of ["executeConfig", "executeSchema", "executeIndexingFunctions"]) {
      stage("before_" + method);
      const value = await build[method](); assert.equal(value.status, "success", value.error?.message);
      stage("after_" + method);
      hashes.push(value.result.contentHash);
      if (method === "executeConfig") config = value.result.config;
      if (method === "executeIndexingFunctions") handler = value.result.indexingFunctions.find(v => v.name === "BnbCheckpoint:block").fn;
    }
    let insertOps = 0, deleteOps = 0;
    const db = { insert: () => ({ values: () => ({
      onConflictDoUpdate: async () => { insertOps++; },
      then: (resolve, reject) => { insertOps++; return Promise.resolve().then(() => resolve(), reject); }
    }) }), delete: async () => { deleteOps++; } };
    const interval = config.blocks.BnbCheckpoint.interval;
    stage("before_actual_handler_loop");
    for (let n = START; n < START + LENGTH; n += interval)
      await handler({ event: { block: { number: BigInt(n), hash: hash(n), parentHash: hash(n - 1), timestamp: 1700000000n + BigInt(n) } }, context: { db, chain: { id: 56 } } });
    stage("after_actual_handler_loop");
    assert.equal(sockets, 0); assert.equal(intercepted, 12);
    return { buildId: sha("2" + hashes.join("")).slice(0, 10), configHash: hashes[0], schemaHash: hashes[1], indexingHash: hashes[2],
      pollingIntervals: Object.fromEntries(Object.entries(config.chains).map(([k, v]) => [k, v.pollingInterval])),
      bnbCheckpointInterval: interval, bnbActualHandlerInsertOps: insertOps, bnbActualHandlerDeleteOps: deleteOps,
      bnbActualHandlerTotalOps: insertOps + deleteOps, poolMax: config.database.poolConfig.max,
      contracts: Object.fromEntries(Object.entries(config.contracts).map(([k, v]) => [k, { address: v.address, startBlock: v.startBlock }])),
      interceptedFixtureCalls: intercepted, socketAttempts: sockets, databaseConnections: 0, providerCalls: 0 };
  } finally { stage("before_shutdown"); await shutdown.kill(); stage("after_shutdown"); }
}

async function builds() {
  const directory = await mkdtemp("/tmp/yunipals-bnb-cost-build-");
  const inventory = JSON.parse(await readFile(path.join(SOURCE, "PUBLIC-EXPORT.json"), "utf8"));
  const overlays = { "apps/yunipals-indexer/ponder.config.ts": "c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4",
    "apps/yunipals-indexer/lib/boosters/config.ts": "01180f821236a693ecda5d7e697adefce59d42a50faf5837b8cddbf44bd4a13d",
    "apps/yunipals-indexer/lib/unified/rpc-preflight.ts": "15d2157d5fd126d1d63383186b037d14b767314c2bf9552ee379cfffa869ca91" };
  for (const row of inventory.files) {
    assert(!row.path.startsWith("/") && !row.path.split("/").includes(".."));
    const raw = await readFile(path.join(SOURCE, row.path)); assert.equal(sha(raw), overlays[row.path] ?? row.sha256, row.path);
    const target = path.join(directory, row.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, raw);
  }
  const project = path.join(directory, "apps/yunipals-indexer");
  await symlink(path.join(ROOT, "node_modules"), path.join(directory, "node_modules"));
  await symlink(path.join(APP, "node_modules"), path.join(project, "node_modules"));
  for (const name of ["yunipals-market-core", "yunipals-indexer-server"])
    await symlink(path.join(ROOT, "packages", name, "node_modules"), path.join(directory, "packages", name, "node_modules"));
  await writeFile(path.join(project, "vite.config.ts"), `export default {server:{fs:{allow:${JSON.stringify([directory, ROOT])}}}};\n`);
  const config = await readFile(path.join(project, "ponder.config.ts"), "utf8");
  const poll10 = renderPolling10(config);
  const sparse10 = config.replace('BnbCheckpoint: { chain: "bnb", startBlock: "latest", interval: 1 }', 'BnbCheckpoint: { chain: "bnb", startBlock: "latest", interval: 10 }');
  assert.notEqual(sparse10, config);
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "UTC", DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline", TSX_DISABLE_CACHE: "1" };
  for (const line of (await readFile(path.join(PAYLOAD, "combined.public.env"), "utf8")).split("\n")) {
    if (!line) continue; const at = line.indexOf("="); assert(at > 0); env[line.slice(0, at)] = line.slice(at + 1);
  }
  env.UNIFIED_RPC_PROFILE_FILE = path.join(ROOT, "ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json");
  if (process.env.COST_STUDY_DIAGNOSTIC === "1") env.COST_STUDY_DIAGNOSTIC = "1";
  const result = {};
  for (const [name, value] of Object.entries({ baseline: config, poll10, sparse10 })) {
    await writeFile(path.join(project, "ponder.config.ts"), value);
    const outPath = path.join(directory, name + ".stdout"), errPath = path.join(directory, name + ".stderr");
    const out = await open(outPath, "wx", 0o600), err = await open(errPath, "wx", 0o600);
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--build-worker", project],
        { cwd: APP, env, timeout: 60000, stdio: ["ignore", out.fd, err.fd] });
      child.on("error", reject); child.on("close", resolve);
    });
    await out.close(); await err.close();
    const child = { status, stdout: await readFile(outPath, "utf8"), stderr: await readFile(errPath, "utf8") };
    assert.equal(child.status, 0, child.stderr + child.stdout); assert(child.stdout.trim(), "worker empty output: " + child.stderr); result[name] = JSON.parse(child.stdout);
    result[name].configFileSha256 = sha(value);
  }
  assert.equal(result.baseline.buildId, "71e2a7f3b7"); assert.equal(result.poll10.buildId, result.baseline.buildId);
  assert.notEqual(result.sparse10.buildId, result.baseline.buildId);
  for (const value of Object.values(result)) {
    assert.equal(value.pollingIntervals.base, 2000); assert.equal(value.schemaHash, result.baseline.schemaHash);
    assert.equal(value.indexingHash, result.baseline.indexingHash); assert.deepEqual(value.contracts, result.baseline.contracts);
    assert.equal(value.poolMax, 5);
  }
  return { project, publicSourceExportSha256: sha(await readFile(path.join(SOURCE, "PUBLIC-EXPORT.json"))), variants: result };
}

const main = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (main && process.argv[2] === "--build-worker") {
  console.log(JSON.stringify(await buildWorker(process.argv[3])));
} else if (main) {
  const quiet = [await historical(1), await historical(10)];
  const nonempty = [await historical(1, [1, 37, 37, 87, 1000, 30999]), await historical(10, [1, 37, 37, 87, 1000, 30999])];
  const live = [await realtime(2000), await realtime(10000), await realtime(2000, 10), await realtime(10000, 10)];
  assert.equal(live[0].totalFullHeaderRequests, live[1].totalFullHeaderRequests);
  assert.equal(live[0].totalFullHeaderRequests, live[2].totalFullHeaderRequests);
  assert.equal(live[0].totalFullHeaderRequests, live[3].totalFullHeaderRequests);
  const sampleBytes = await readFile("/tmp/yunipals-bnb-source-volume-production-20261024.json");
  assert.equal(sha(sampleBytes), "94c0750811defc69827f4a8f83a9a038239a5789f9e72ef69e17d4036492524c");
  const sample = JSON.parse(sampleBytes);
  assert(sample.readOnly && sample.rawEventsOrOwnershipExported === false);
  assert.equal(sample.fromBlock, String(START)); assert.equal(sample.throughBlock, String(START + 9999));
  assert.equal(sample.databaseWrites + sample.serviceActions + sample.providerCalls, 0);
  assert.equal(sample.counts.reduce((n, v) => n + Number(v.events), 0), 6);
  assert(sample.counts.every(v => v.source_id === "marketplace:bnb:seaport"));
  const report = { format: "yunipals-bnb-cost-study-v1", actualInstalledPonder: "0.17.5", sourceOnly: true,
    runtimeFilesManifestSha256: PONDER_MANIFEST_SHA, installedRuntimeFiles: runtimeFiles.files,
    observedProductionSampleNotTail: { from: 129499248, to: 129509247, nftEvents: 0, seaportEvents: 6, eventBlocks: 5,
      input: "/tmp/yunipals-bnb-source-volume-production-20261024.json", inputSha256: sha(sampleBytes), observedAt: sample.observedAt },
    historicalQuiet: quiet, historicalExplicitSyntheticNonempty: nonempty, realtime: live,
    offlineBuild: await builds(), productionEventTailMeasured: false,
    dbWorkIsHandlerMethodCallsNotPhysicalSQLBenchmark: true,
    conditionalHeaderFloor: { syntheticBlocks: 266, syntheticSeconds: 120, publishedCuPerHeader: 20,
      computedCuPerDayAtThatRate: 3830400, actualBillClaimed: false,
      source: "https://www.alchemy.com/docs/reference/compute-unit-costs" },
    recommendation: { keepBuild: "71e2a7f3b7", keepBnbPollingMs: 2000, keepBnbBlockInterval: 1,
      polling10sIsNotHeaderCuFix: true, sparse10IsNotPermanentHeaderCuFix: true,
      nativeRebuildJustForRemainingTailRecommended: false, baseLatestUnchanged: true },
    sockets, providerCalls: 0, databaseConnections: 0, serviceActions: 0 };
  const out = process.argv.indexOf("--output");
  if (out >= 0) { assert(process.argv[out + 1].startsWith("/tmp/")); await writeFile(process.argv[out + 1], JSON.stringify(report, null, 2) + "\n"); }
  console.log(JSON.stringify(report));
}
