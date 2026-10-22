import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeEventTopics, http, ResponseBodyTooLargeError, toHex, zeroAddress, zeroHash } from "viem";
import { bsc } from "viem/chains";
import { collectionAbi } from "../lib/abi.ts";
import { buildSourceManifest } from "../lib/unified/sources.ts";
import { unifiedRpcHttpTransport } from "../lib/unified/rpc-preflight.ts";
import { validateUnifiedRpcCalls, unifiedRpcPaidRange, unifiedRpcProfileId } from "../../../packages/yunipals-indexer-server/src/rpc-policy.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ponderEntry = import.meta.resolve("ponder");
const esm = dirname(fileURLToPath(ponderEntry));
const installed = resolve(esm, "../..");
const { createHistoricalSync: original } = await import(new URL("./sync-historical/index.js", ponderEntry));
const { createRpc } = await import(new URL("./rpc/index.js", ponderEntry));
const { standardizeBlock, validateTransactionsAndBlock } = await import(new URL("./rpc/actions.js", ponderEntry));
const { fetchHistoricalLogBlock } = await import("../../../patches/ponder-historical-log-transactions-v3.mjs");
const { buildEvents, decodeEvents } = await import(new URL("./runtime/events.js", ponderEntry));
const { defaultLogFilterInclude } = await import(new URL("./runtime/filter.js", ponderEntry));
const { encodeBlock, encodeLog, encodeTransaction, encodeTransactionReceipt } = await import(new URL("./sync-store/encode.js", ponderEntry));
const temporary = await mkdtemp("/tmp/yunipals-historical-log-tx-");
const patchPath = join(repository, "patches/ponder-historical-log-transactions-v3.patch");
const helperPath = join(repository, "patches/ponder-historical-log-transactions-v3.mjs");
const candidateRoot = join(temporary, "candidate");
const candidateEsm = join(candidateRoot, "dist/esm");
const number = 7_579_200;
const address = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d";
const recipient = `0x${"22".repeat(20)}`;
const hash = (value) => toHex(BigInt(value), { size: 32 });
const clone = (value) => structuredClone(value);
const logger = { trace() {}, debug() {}, warn() {}, error() {}, child() { return this; } };
const profile = {
  version: 1, model: "alchemy-2026-09-08", scope: "historical-test",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({}),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const filter = {
  type: "log", chainId: 56, sourceId: "YunipalsBnb", address,
  topic0: encodeEventTopics({ abi: collectionAbi, eventName: "Transfer" })[0],
  fromBlock: 7_579_197, toBlock: undefined, hasTransactionReceipt: false,
  include: defaultLogFilterInclude
};
const blockFilter = (fromBlock) => ({
  type: "block", chainId: 56, sourceId: "BnbCheckpoint", fromBlock,
  interval: 1, offset: 0, hasTransactionReceipt: false
});
const abiItem = collectionAbi.find((item) => item.type === "event" && item.name === "Transfer");
const eventCallbacks = [{
  filter, name: "YunipalsBnb:Transfer", type: "contract", abiItem,
  metadata: { safeName: "Transfer", abi: collectionAbi }
}];
function fixture(indices = [7, 111, 111]) {
  const transactions = Array.from({ length: 200 }, (_, i) => ({
    hash: hash(1000 + i), transactionIndex: toHex(i), blockNumber: toHex(number),
    blockHash: hash(number), from: zeroAddress, to: address,
    input: `0x${"ab".repeat(1024)}`, value: toHex(i + 17), nonce: toHex(i + 31),
    gas: "0x30d40", gasPrice: "0x12", type: "0x0", r: hash(2), s: hash(3), v: "0x1b"
  }));
  const block = {
    hash: hash(number), parentHash: hash(number - 1), number: toHex(number),
    timestamp: "0x60000000", logsBloom: `0x${"00".repeat(256)}`,
    receiptsRoot: hash(300), transactions
  };
  const logs = indices.map((index, i) => ({
    address, topics: encodeEventTopics({ abi: collectionAbi, eventName: "Transfer",
      args: { from: zeroAddress, to: recipient, tokenId: BigInt(500 + i) } }),
    data: "0x", blockNumber: block.number, blockHash: block.hash,
    transactionHash: transactions[index].hash, transactionIndex: toHex(index),
    logIndex: toHex(i), removed: false
  }));
  return { block, logs };
}
function environment({ sample = fixture(), mutate, retryOnce = false, chainId = 56 } = {}) {
  const calls = [];
  let bytes = 0, retries = 0, active = 0, maximumActive = 0;
  const hooks = [];
  const common = { logger, options: { factoryAddressCountThreshold: 1000 },
    metrics: { ponder_rpc_request_duration: { observe() {} },
      ponder_rpc_request_error_total: { inc() { retries++; } } },
    shutdown: { add(hook) { hooks.push(hook); } } };
  let failed = false;
  const transport = http("http://historical-fixture.invalid", {
    retryCount: 0,
    fetchFn: async (input, init) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      try {
        const request = input instanceof Request ? input : new Request(input, init);
        const call = await request.json();
        calls.push(call);
        // Exercise admission for the new method, not just a bypassed mock RPC.
        if (["eth_getBlockByNumber", "eth_getTransactionByBlockNumberAndIndex", "eth_getLogs"].includes(call.method))
          validateUnifiedRpcCalls(profile, 56, [call]);
        let result;
        if (call.method === "eth_getBlockByNumber") {
          result = clone(sample.block);
          if (!call.params[1]) result.transactions = result.transactions.map((tx) => tx.hash);
        } else if (call.method === "eth_getTransactionByBlockNumberAndIndex") {
          if (retryOnce && !failed) {
            failed = true;
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id,
              error: { code: -32000, message: "temporary backend unavailable" } }));
          }
          result = clone(sample.block.transactions[Number(BigInt(call.params[1]))] ?? null);
        } else if (call.method === "eth_getLogs") result = clone(sample.logs);
        else if (call.method === "eth_getBlockReceipts") result = clone(sample.receipts ?? []);
        else if (call.method === "debug_traceBlockByNumber") result = [];
        else throw new Error(`Unexpected fixture method ${call.method}`);
        if (mutate) result = mutate(result, call);
        const body = JSON.stringify({ jsonrpc: "2.0", id: call.id, result });
        bytes += Buffer.byteLength(body);
        return new Response(body, { headers: { "content-type": "application/json" } });
      } finally { active--; }
    }
  });
  const chain = { id: chainId, name: "bnb", viemChain: bsc, rpc: transport, finalityBlockCount: 20 };
  const rpc = createRpc({ common, chain, concurrency: 3 });
  return { calls, common, chain, rpc, sample, hooks,
    metrics: () => ({ bytes, retries, maximumActive }) };
}
async function run(factory, options = {}) {
  const env = environment(options);
  const rows = { blocks: [], logs: [], transactions: [], transactionReceipts: [], traces: [] };
  const syncStore = Object.fromEntries(Object.keys(rows).map((name) => [
    `insert${name[0].toUpperCase()}${name.slice(1)}`,
    async (values) => rows[name].push(...clone(values[name]))
  ]));
  const filters = options.filters ?? [filter, blockFilter(number + 1000)];
  const childAddresses = options.childAddresses ?? new Map();
  const callbacks = [{ ...eventCallbacks[0], filter: filters[0] }];
  const intervals = filters.map((filter) => ({ filter, interval: [number, number] }));
  const sync = factory({ common: env.common, chain: env.chain, rpc: env.rpc, childAddresses });
  let blockDataCompleted = false;
  try {
    const logs = await sync.syncBlockRangeData({ interval: [number, number],
      requiredIntervals: intervals, requiredFactoryIntervals: [], syncStore });
    const tip = await sync.syncBlockData({ interval: [number, number],
      requiredIntervals: intervals, logs, syncStore });
    blockDataCompleted = true;
    const encoded = {
      blocks: rows.blocks.map((block) => encodeBlock({ block, chainId: 56 })),
      logs: rows.logs.map((log) => encodeLog({ log, chainId: 56 })),
      transactions: rows.transactions.map((transaction) => encodeTransaction({ transaction, chainId: 56 })),
      transactionReceipts: rows.transactionReceipts.map((transactionReceipt) =>
        encodeTransactionReceipt({ transactionReceipt, chainId: 56 })), traces: []
    };
    const rawEvents = buildEvents({ eventCallbacks: callbacks, ...encoded,
      logs: encoded.logs.map((log) => ({ ...log,
        topics: [log.topic0, log.topic1, log.topic2, log.topic3].filter((topic) => topic !== null) })),
      childAddresses, chainId: 56 });
    const events = decodeEvents(env.common, env.chain, callbacks, rawEvents).map((value) => ({
      type: value.type, checkpoint: value.checkpoint, chainId: value.chain.id,
      name: value.eventCallback.name, event: value.event
    }));
    return { rows, encoded, events, tip, calls: env.calls, ...env.metrics() };
  } catch (error) {
    if (!blockDataCompleted) {
      assert.equal(rows.blocks.length, 0, "failed block must not be inserted");
      assert.equal(rows.logs.length, 0, "failed logs must not be inserted");
    }
    throw error;
  } finally { env.hooks.forEach((hook) => hook()); }
}
let checks = 0;
try {
  await mkdir(join(candidateEsm, "sync-historical"), { recursive: true });
  await writeFile(join(candidateRoot, "package.json"), '{"type":"module"}');
  await symlink(dirname(await realpath(installed)), join(candidateRoot, "node_modules"));
  for (const entry of await readdir(esm, { withFileTypes: true })) {
    if (entry.name !== "sync-historical") await symlink(join(esm, entry.name), join(candidateEsm, entry.name));
  }
  await copyFile(join(esm, "sync-historical/index.js"), join(candidateEsm, "sync-historical/index.js"));
  execFileSync("patch", ["--batch", "--fuzz=0", "-p1", "-i", patchPath], { cwd: candidateRoot });
  assert.equal(await readFile(join(candidateEsm, "sync-historical/yunipals-log-transactions.mjs"), "utf8"),
    await readFile(helperPath, "utf8"));
  const { createHistoricalSync: candidate } = await import(pathToFileURL(join(candidateEsm, "sync-historical/index.js")));
  // A terminal selective transport failure makes one ordinary full request;
  // it does not invent data, loop, or swallow cancellation/fallback failures.
  const sample = fixture();
  const wanted = [sample.block.transactions[7].hash, sample.block.transactions[111].hash];
  // Transaction reads start after the real header and use original positions,
  // even when requested hashes arrive out of order and are sparse in the block.
  let releaseHeader;
  const headerReady = new Promise((done) => { releaseHeader = done; });
  const sequence = [], context = {};
  const pending = fetchHistoricalLogBlock({ blockNumber: number, transactionHashes: [...wanted].reverse(),
    context, standardizeBlock, validateTransactionsAndBlock, rpc: { request: async (call, actualContext) => {
      assert.equal(actualContext, context); sequence.push(call);
      if (call.method === "eth_getBlockByNumber") {
        assert.equal(call.params[1], false); await headerReady;
        return { ...clone(sample.block), transactions: sample.block.transactions.map((tx) => tx.hash) };
      }
      assert.equal(call.method, "eth_getTransactionByBlockNumberAndIndex");
      return clone(sample.block.transactions[Number(BigInt(call.params[1]))]);
    } } });
  await Promise.resolve(); assert.equal(sequence.length, 1);
  releaseHeader();
  const mapped = await pending;
  assert.deepEqual(sequence.slice(1).map((call) => call.params), [[toHex(number), "0x6f"], [toHex(number), "0x7"]]);
  assert.deepEqual(mapped.transactions.map((tx) => tx.transactionIndex), ["0x7", "0x6f"]);
  checks++;
  for (const name of ["AbortError", "ShutdownError"]) {
    const sequence = [];
    await assert.rejects(fetchHistoricalLogBlock({ blockNumber: number, transactionHashes: wanted,
      standardizeBlock, validateTransactionsAndBlock, rpc: { request: async (call) => {
        sequence.push(call);
        if (call.method === "eth_getBlockByNumber") {
          assert.equal(call.params[1], false);
          return { ...clone(sample.block), transactions: sample.block.transactions.map((tx) => tx.hash) };
        }
        throw Object.assign(new Error("stopped after header"), { name });
      } } }), { name });
    assert.ok(!sequence.some((call) => call.method === "eth_getBlockByNumber" && call.params[1]));
    checks++;
  }
  for (const failure of [new Error("qualified endpoints unavailable"), null]) {
    const calls = [];
    const block = await fetchHistoricalLogBlock({
      blockNumber: number, transactionHashes: wanted, context: {}, standardizeBlock, validateTransactionsAndBlock,
      rpc: { request: async (call) => {
        calls.push(call);
        if (call.method === "eth_getBlockByNumber" && call.params[1] === true) return clone(sample.block);
        if (failure) throw failure;
        return null;
      } }
    });
    assert.deepEqual(block, standardizeBlock(clone(sample.block), { method: "eth_getBlockByNumber", params: [toHex(number), true] }));
    assert.equal(calls.filter((call) => call.method === "eth_getBlockByNumber" && call.params[1] === true).length, 1);
    checks++;
  }
  for (const name of ["AbortError", "ShutdownError"]) {
    const calls = [];
    await assert.rejects(fetchHistoricalLogBlock({
      blockNumber: number, transactionHashes: wanted, standardizeBlock, validateTransactionsAndBlock,
      rpc: { request: async (call) => { calls.push(call); throw Object.assign(new Error("stopped"), { name }); } }
    }), { name });
    assert.ok(!calls.some((call) => call.params[1] === true));
    checks++;
  }
  for (const fullReply of [null, { ...sample.block, number: "0x1" },
    { ...sample.block, transactions: sample.block.transactions.filter((tx) => !wanted.includes(tx.hash)) }]) {
    let fullCalls = 0;
    await assert.rejects(fetchHistoricalLogBlock({
      blockNumber: number, transactionHashes: wanted, standardizeBlock, validateTransactionsAndBlock,
      rpc: { request: async (call) => {
        if (call.method === "eth_getBlockByNumber" && call.params[1] === true) { fullCalls++; return clone(fullReply); }
        return null;
      } }
    }), /historical|Historical/);
    assert.equal(fullCalls, 1);
    checks++;
  }
  let boundCalls = 0;
  await assert.rejects(fetchHistoricalLogBlock({ transactionHashes: Array(9).fill(hash(1)),
    rpc: { request: async () => { boundCalls++; } } }), /exceeds its bound/);
  assert.equal(boundCalls, 0); checks++;
  const stock = await run(original);
  const optimized = await run(candidate);
  assert.deepEqual(optimized.rows, stock.rows);
  assert.deepEqual(optimized.encoded, stock.encoded);
  assert.deepEqual(optimized.events, stock.events);
  assert.deepEqual(optimized.tip, stock.tip);
  assert.equal(optimized.events.length, 3);
  assert.equal(optimized.rows.transactions.length, 2);
  assert.equal(optimized.calls.filter((call) => call.method === "eth_getTransactionByBlockNumberAndIndex").length, 2);
  assert.ok(optimized.calls.some((call) => call.method === "eth_getBlockByNumber" && call.params[1] === false));
  assert.ok(!optimized.calls.some((call) => call.method === "eth_getBlockByNumber" && call.params[1] === true));
  assert.ok(optimized.bytes < stock.bytes / 10);
  assert.ok(optimized.maximumActive <= 3);
  checks++;
  const receiptSample = fixture();
  receiptSample.receipts = receiptSample.block.transactions.map((tx) => ({
    transactionHash: tx.hash, transactionIndex: tx.transactionIndex,
    blockHash: tx.blockHash, blockNumber: tx.blockNumber, from: tx.from,
    to: tx.to, status: "0x1", gasUsed: "0x5208", cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x12", type: "0x0", contractAddress: null
  }));
  const factoryAddress = { type: "log", chainId: 56, id: hash(900), address: recipient,
    eventSelector: hash(901), childAddressLocation: "topic1", fromBlock: 1 };
  const factoryFilter = { ...filter, address: factoryAddress };
  const factorySample = fixture();
  factorySample.logs.push({ ...factorySample.logs[0], address: recipient, logIndex: "0x3" });
  const zeroSample = fixture([7]);
  zeroSample.logs[0].transactionHash = zeroHash;
  for (const options of [
    { sample: fixture([111, 7, 111]) },
    { sample: fixture([7]) },
    { sample: fixture(Array.from({ length: 8 }, (_, i) => i)) },
    { sample: fixture([]) },
    { sample: { ...fixture(), logs: fixture().logs.map((log) => ({ ...log, address: recipient })) } },
    { filters: [filter, blockFilter(number)] },
    { filters: [filter, { type: "transaction", chainId: 56, fromBlock: number,
      fromAddress: recipient, includeReverted: true }] },
    { filters: [filter, { type: "trace", chainId: 56, fromBlock: number, fromAddress: recipient }] },
    { filters: [filter, { type: "transfer", chainId: 56, fromBlock: number, fromAddress: recipient }] },
    { filters: [filter, { type: "transaction", chainId: 56, fromBlock: number + 1, fromAddress: recipient }] },
    { filters: [filter, { ...blockFilter(1), toBlock: number - 1 }] },
    { filters: [filter, { ...blockFilter(1), interval: 10, offset: 1 }] },
    { sample: receiptSample, filters: [{ ...filter, hasTransactionReceipt: true }] },
    { sample: factorySample, filters: [factoryFilter],
      childAddresses: new Map([[factoryAddress.id, new Map([[address, number - 1]])]]) },
    { sample: factorySample, filters: [factoryFilter],
      childAddresses: new Map([[factoryAddress.id, new Map([[address, number + 1]])]]) },
    { sample: zeroSample },
    { sample: fixture(Array.from({ length: 9 }, (_, i) => i)) },
    { chainId: 8453 }
  ]) {
    const a = await run(original, options);
    const b = await run(candidate, options);
    assert.deepEqual(b.rows, a.rows);
    assert.deepEqual(b.encoded, a.encoded);
    assert.deepEqual(b.events, a.events);
    assert.deepEqual(b.tip, a.tip);
    if (options.filters?.at(-1)?.fromBlock === number || options.chainId || options.sample?.logs.length === 9)
      assert.ok(!b.calls.some((call) => call.method === "eth_getTransactionByBlockNumberAndIndex"));
    checks++;
  }
  // Receipt-bearing filters retain stock full blocks and stock receipt checks.
  // Both paths reject this deliberately incomplete block-receipt reply.
  for (const factory of [original, candidate]) {
    await assert.rejects(run(factory, { filters: [{ ...filter, hasTransactionReceipt: true }] }), /length 200/);
  }
  checks++;
  const mutations = [
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? null : result,
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? { ...result, hash: hash(9999) } : result,
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? { ...result, transactionIndex: "0x1" } : result,
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? { ...result, transactionIndex: "0x10000" } : result,
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? { ...result, blockHash: hash(9999) } : result,
    (result, call) => call.method === "eth_getTransactionByBlockNumberAndIndex" ? { ...result, blockNumber: "0x1" } : result,
    (result, call) => call.method === "eth_getBlockByNumber" ? { ...result, number: "0x1" } : result,
    (result, call) => call.method === "eth_getBlockByNumber" ? null : result,
    (result, call) => call.method === "eth_getBlockByNumber" ? { ...result, transactions: [hash(1)] } : result,
    (result, call) => call.method === "eth_getBlockByNumber" ? { ...result, transactions: [{ hash: hash(1) }] } : result,
    (result, call) => call.method === "eth_getLogs" ? result.map((log) => ({ ...log, blockHash: hash(9999) })) : result
  ];
  for (const [index, mutate] of mutations.entries()) {
    if (index < 6) {
      const recovered = await run(candidate, { mutate });
      assert.deepEqual(recovered.rows, stock.rows);
      assert.deepEqual(recovered.encoded, stock.encoded);
      assert.deepEqual(recovered.events, stock.events);
      assert.deepEqual(recovered.tip, stock.tip);
      assert.equal(recovered.calls.filter((call) => call.method === "eth_getBlockByNumber" && call.params[1] === true).length, 1);
    } else {
      await assert.rejects(run(candidate, { mutate }), /historical|Historical|Inconsistent RPC|Invalid RPC response/);
    }
    checks++;
  }
  for (const mutateHeader of [() => null, (header) => ({ ...header, number: "0x1" }),
    (header) => ({ ...header, transactions: [hash(1)] })]) {
    const recovered = await run(candidate, { mutate: (result, call) =>
      call.method === "eth_getBlockByNumber" && call.params[1] === false ? mutateHeader(result) : result });
    assert.deepEqual(recovered.encoded, stock.encoded);
    assert.deepEqual(recovered.events, stock.events);
    assert.equal(recovered.calls.filter((call) => call.method === "eth_getBlockByNumber" && call.params[1] === true).length, 1);
    checks++;
  }
  const retry = await run(candidate, { retryOnce: true });
  assert.deepEqual(retry.rows, stock.rows);
  assert.deepEqual(retry.events, stock.events);
  assert.equal(retry.retries, 1);
  checks++;
  const read = { method: "eth_getTransactionByBlockNumberAndIndex", params: [toHex(number), "0x7"] };
  validateUnifiedRpcCalls(profile, 56, [read]);
  assert.throws(() => unifiedRpcPaidRange(read), /cannot be height bounded/);
  for (const params of [[], ["0x12"], ["latest", "0x0"], ["0x01", "0x0"], [toHex(number), "0x00"], [toHex(number), "0x80000000"], [toHex(number), 0], [toHex(number), "0x0", true], [null], [123]])
    assert.throws(() => validateUnifiedRpcCalls(profile, 56, [{ ...read, params }]));
  checks++;
  const profilePath = join(temporary, "profile.json");
  await writeFile(profilePath, JSON.stringify(profile));
  const capped = unifiedRpcHttpTransport("http://127.0.0.1:19204/unified", 56, "unified_source", {
    UNIFIED_RPC_POLICY_REQUIRED: "true", UNIFIED_RPC_PROFILE_FILE: profilePath,
    UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile)
  }, { retryCount: 0, fetchFn: async () => new Response("", { headers: {
    "content-type": "application/json", "content-length": "10485761"
  } }) })({ retryCount: 0 });
  for (const call of [read, { method: "eth_getBlockByNumber", params: [toHex(number), false] }])
    await assert.rejects(capped.request(call), (error) =>
      error instanceof ResponseBodyTooLargeError && error.maxSize === 10485760);
  checks++;
  console.log(JSON.stringify({ passed: true, checks, networkRequests: 0, databaseCalls: 0,
    dependency: "Ponder 0.17.5", actualHistoricalSyncCompared: true,
    encodedCacheRowsAndDecodedEventsEqual: true, boundedConcurrency: 3,
    syntheticFullBlockBytes: stock.bytes, syntheticSelectiveBytes: optimized.bytes,
    syntheticPayloadReduction: stock.bytes / optimized.bytes,
    patchSha256: createHash("sha256").update(await readFile(patchPath)).digest("hex"),
    candidateRuntimeSha256: createHash("sha256").update(
      await readFile(join(candidateEsm, "sync-historical/index.js"))).digest("hex"),
    helperSha256: createHash("sha256").update(await readFile(helperPath)).digest("hex"),
    nodeVersion: process.versions.node }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
