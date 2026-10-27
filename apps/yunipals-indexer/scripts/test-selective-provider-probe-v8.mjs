import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { toHex, zeroAddress } from "viem";
import { probe, prepareFull, compareSample, selectTransactions, validatePrivateInput, createTransport,
  BLOCKS, INDICES, LIMITS, PINS, sha, canonical }
  from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v8.mjs";
import * as comparisons from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions-v3.mjs";

const entry = import.meta.resolve("ponder");
const actions = await import(new URL("./rpc/actions.js", entry));
const encoders = await import(new URL("./sync-store/encode.js", entry));
const deps = { ...comparisons, ...actions, ...encoders, fetchHistoricalLogBlock };
const hash = (n) => toHex(BigInt(n), { size: 32 });
const url = "https://existing-free-0.invalid/", selected = [{ primaryIndex: 0, url, urlSha256: sha(url) }];
function fixture(n) {
  const transactions = [0, 1, 2, 3].map((i) => ({ hash: hash(n * 10 + i), transactionIndex: toHex(i),
    blockNumber: toHex(n), blockHash: hash(n), from: zeroAddress, to: zeroAddress,
    input: "0x1234", value: "0x1", nonce: toHex(i), gas: "0x30d40", gasPrice: "0x12",
    type: "0x0", r: hash(2), s: hash(3), v: "0x1b" }));
  return { hash: hash(n), parentHash: hash(n - 1), number: toHex(n), timestamp: "0x60000000",
    logsBloom: `0x${"00".repeat(256)}`, receiptsRoot: hash(300), size: "0x200", transactions };
}
const discoveries = BLOCKS.map((blockNumber) => {
  const full = prepareFull(fixture(blockNumber), blockNumber, deps);
  return { blockNumber, blockHash: full.raw.hash, selectedTransactionHash: full.raw.transactions[0].hash,
    encodedBlockSha256: sha(canonical(full.encoded)), transactionsEncodedSha256: sha(canonical(full.transactionsEncoded)) };
});
function scenario(options = {}) {
  const traces = [], requests = [];
  const transport = { traces, bytes: () => options.bytes ?? 50000, elapsed: () => options.elapsed ?? 7000,
    exchange: async (primaryIndex, payload) => {
      assert.equal(primaryIndex, 0);
      const calls = Array.isArray(payload) ? payload : [payload];
      traces.push({ primaryIndex, logicalCalls: calls.length }); requests.push(payload);
      if (options.providerError && Array.isArray(payload)) throw new Error("private upstream detail");
      return calls.map((call) => {
        const raw = fixture(Number(BigInt(call.params[0])));
        if (call.method === "eth_getBlockByNumber") {
          if (!call.params[1]) {
            raw.transactions = raw.transactions.map((tx) => tx.hash);
            if (options.badSize) raw.size = "0x201";
            if (options.badHeaderMembership) raw.transactions[3] = hash(900);
          } else if (options.badFirstIndex) raw.transactions[0].transactionIndex = "0x00";
          return raw;
        }
        assert.equal(call.method, "eth_getTransactionByBlockNumberAndIndex");
        assert.ok(["0x0", "0x3"].includes(call.params[1]));
        const tx = raw.transactions[Number(BigInt(call.params[1]))];
        if (call.params[1] === "0x3") {
          if (options.nullLast) return null;
          if (options.noncanonicalIndex) tx.transactionIndex = "0x03";
          if (options.badIdentity) tx.blockHash = hash(900);
          if (options.badHash) tx.hash = hash(900);
          if (options.badMembership) tx.transactionIndex = "0x2";
          if (options.badValue) tx.value = "0x2";
          if (options.extension) tx.privateProviderField = "do-not-export";
        }
        return tx;
      });
    }
  };
  return { transport, discoveries: structuredClone(discoveries), deps, selected, requests };
}

let checks = 0;
const good = scenario(), passed = await probe(good);
assert.equal(passed.status, "qualified_samples"); assert.deepEqual(passed.qualifiedPrimaryIndices, [0]);
assert.equal(passed.rpcCalls, 8); assert.equal(passed.providerHttpRequests, 6);
assert.deepEqual(good.requests.map((r) => Array.isArray(r) ? r.length : 1), [1, 1, 2, 1, 1, 2]);
assert.deepEqual(good.requests.flat().map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.ok(good.requests.every((r) => Array.isArray(r) ? r.every((call) => call.method === "eth_getTransactionByBlockNumberAndIndex") : r.method === "eth_getBlockByNumber"));
assert.ok(passed.samples.every((s) => s.equivalent && s.offlineHelperCalls === 3 && !s.offlineFallbackAttempted &&
  s.helperEncodedBlockEquivalent && s.helperEncodedTransactionsEquivalent && s.selectedTransactionCount === 2 &&
  s.transactionComparisons.every((tx) => tx.rawEquivalent && tx.standardFieldsEquivalent && tx.encodedEquivalent)));
assert.deepEqual(passed.samples[0].selectedTransactions.map((tx) => tx.index), ["0x0", "0x3"]);
assert.equal(passed.proposedRouteExecuted, false); assert.equal(passed.candidateProxySelected, false);
assert.equal(passed.helperNetworkRequests, 0); assert.equal(passed.freeOnly, false); checks++;
for (const option of ["nullLast", "noncanonicalIndex", "badIdentity", "badHash", "badMembership", "badValue", "badSize", "extension", "providerError"]) {
  const result = await probe(scenario({ [option]: true }));
  assert.equal(result.status, "no_qualified_endpoints", option); assert.deepEqual(result.qualifiedPrimaryIndices, []);
  assert.equal(result.rpcCalls, 8); assert.equal(result.providerHttpRequests, 6);
  if (["nullLast", "noncanonicalIndex", "badIdentity", "badHash", "badMembership"].includes(option))
    assert.ok(result.samples.every((s) => s.transactionComparisons.length === 2 && s.offlineHelperCalls === 4 && s.offlineFallbackAttempted));
  if (option === "extension") assert.ok(result.samples.every((s) => !s.transactionComparisons[1].rawEquivalent &&
    s.transactionComparisons[1].standardFieldsEquivalent && s.transactionComparisons[1].encodedEquivalent));
  if (option === "badSize") assert.ok(result.samples.every((s) => !s.encodedBlockEquivalent));
  assert.ok(!JSON.stringify(result).includes("do-not-export") && !JSON.stringify(result).includes("privateProviderField") &&
    !JSON.stringify(result).includes("private upstream detail")); checks++;
}
for (const option of ["badHeaderMembership", "badFirstIndex"]) {
  const args = scenario({ [option]: true }), result = await probe(args);
  assert.equal(result.status, "refused_or_failed"); assert.equal(result.rpcCalls, 4);
  assert.ok(args.requests.every((request) => !Array.isArray(request)), "No index request without full/header binding"); checks++;
}
for (const options of [{ bytes: LIMITS.totalResponseBytes + 1 }, { elapsed: LIMITS.deadlineMs + 1 }]) {
  const result = await probe(scenario(options));
  assert.equal(result.status, "refused_or_failed"); assert.deepEqual(result.qualifiedPrimaryIndices, []); checks++;
}
const changedDiscovery = scenario(); changedDiscovery.discoveries[0].transactionsEncodedSha256 = "0".repeat(64);
assert.deepEqual((await probe(changedDiscovery)).qualifiedPrimaryIndices, []); checks++;
const full = fixture(BLOCKS[0]), header = { ...full, transactions: full.transactions.map((tx) => tx.hash) };
const prior = structuredClone(full), selection = selectTransactions(full, header, discoveries[0], deps);
await compareSample(0, discoveries[0], [full, header, [full.transactions[0], null]], selection, deps);
assert.deepEqual(full, prior, "Qualification does not mutate provider responses");
const duplicate = structuredClone(header); duplicate.transactions[3] = duplicate.transactions[0];
assert.throws(() => selectTransactions(full, duplicate, discoveries[0], deps)); checks++;

const input = { selected, primaryPoolSha256: PINS.primaryPoolSha256, startedMonotonicMs: 0, deadlineMonotonicMs: 60000 };
validatePrivateInput(input);
assert.throws(() => validatePrivateInput({ ...input, selected: [{ ...selected[0], primaryIndex: 4 }] }));
assert.deepEqual(INDICES, [0]); checks++;
function transportFixture({ unsupported = false, oversized = false } = {}) {
  let now = 0, count = 0;
  const request = (url, options, callback) => {
    assert.equal(url.href, selected[0].url); assert.equal(options.agent, false); count++;
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = (body) => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.destroy = () => {};
      callback(response);
      const payload = JSON.parse(body), reply = (call) => unsupported ?
        { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "private provider detail", data: "private data" } } :
        { jsonrpc: "2.0", id: call.id, result: null };
      response.emit("data", oversized ? Buffer.alloc(LIMITS.perResponseBytes + 1, 32) :
        Buffer.from(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload))));
      response.emit("end");
    }); return req;
  };
  const transport = createTransport(input, { request, clock: () => now, sleep: async (ms) => { now += ms; } });
  return { transport, count: () => count };
}
const fullCall = { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [toHex(BLOCKS[0]), true] };
const headerCall = { ...fullCall, id: 2, params: [toHex(BLOCKS[0]), false] };
const pair = ["0x0", "0x3"].map((index, i) => ({ jsonrpc: "2.0", id: i + 3,
  method: "eth_getTransactionByBlockNumberAndIndex", params: [toHex(BLOCKS[0]), index] }));
const shaped = transportFixture();
for (const payload of [fullCall, headerCall, pair]) await shaped.transport.exchange(0, payload);
assert.deepEqual(shaped.transport.traces.map((r) => [r.shape, r.logicalCalls, r.startedAfterMs]),
  [["full_singleton", 1, 0], ["header_singleton", 1, 1000], ["block_index_pair", 2, 2000]]); checks++;
const unsupported = transportFixture({ unsupported: true });
await assert.rejects(() => unsupported.transport.exchange(0, pair));
assert.deepEqual(unsupported.transport.traces[0].rpcErrorCodes, [-32601, -32601]);
assert.ok(!JSON.stringify(unsupported.transport.traces).includes("private")); checks++;
const bounded = transportFixture();
for (let i = 0; i < 6; i++) await bounded.transport.exchange(0, fullCall);
await assert.rejects(() => bounded.transport.exchange(0, fullCall)); assert.equal(bounded.count(), 6); checks++;
const oversized = transportFixture({ oversized: true });
for (let i = 0; i < 4; i++) await assert.rejects(() => oversized.transport.exchange(0, fullCall));
await assert.rejects(() => oversized.transport.exchange(0, fullCall), /response_byte_bound/);
assert.equal(oversized.count(), 4); checks++;
for (const [file, expected] of [[new URL("./rpc/actions.js", entry), PINS.ponderActionsSha256],
  [new URL("./sync-store/encode.js", entry), PINS.ponderEncodersSha256],
  [new URL("../../../patches/ponder-historical-log-transactions-v3.mjs", import.meta.url), PINS.candidateHelperSha256],
  [new URL("../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs", import.meta.url), PINS.comparisonsSha256]])
  assert.equal(sha(await readFile(file)), expected);
checks++;
console.log(JSON.stringify({ status: "passed", checks, networkCalls: 0, actualCandidateV3Helper: true,
  actualPonderActionsAndEncoders: true, firstAndLastTransactions: true, exactHelperCalls: 3,
  strictRawStandardAndEncodedEquivalence: true, noFallbackQualification: true, candidateRouteExecuted: false }));
