import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { toHex, zeroAddress } from "viem";
import {
  probe, prepareFull, compareSample, createTransport, validatePrivateInput,
  validateEnvelope, BLOCKS, INDICES, LIMITS, PINS, sha, canonical
} from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v6.mjs";
import * as comparisons from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions-v2.mjs";

const entry = import.meta.resolve("ponder");
const actions = await import(new URL("./rpc/actions.js", entry));
const encoders = await import(new URL("./sync-store/encode.js", entry));
const deps = { ...comparisons, ...actions, ...encoders, fetchHistoricalLogBlock };
const hash = (n) => toHex(BigInt(n), { size: 32 });
const selected = INDICES.map((primaryIndex) => {
  const url = `https://existing-free-${primaryIndex}.invalid/`;
  return { primaryIndex, url, urlSha256: sha(url) };
});
const input = { selected, primaryPoolSha256: PINS.primaryPoolSha256,
  startedMonotonicMs: 0, deadlineMonotonicMs: LIMITS.deadlineMs };
function fixture(n) {
  const transactions = [0, 1].map((i) => ({ hash: hash(n * 10 + i), transactionIndex: toHex(i),
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
      const calls = Array.isArray(payload) ? payload : [payload];
      traces.push({ primaryIndex, logicalCalls: calls.length }); requests.push({ primaryIndex, payload });
      if (options.failedEndpoint === primaryIndex) throw new Error("private provider detail");
      return calls.map((call) => {
        if (call.method === "eth_getBlockByNumber") {
          const raw = fixture(Number(BigInt(call.params[0])));
          if (options.fullTransactionChange && primaryIndex === 4) raw.transactions[1].value = "0x2";
          if (options.rawFullExtension && primaryIndex === 4) raw.transactions[1].providerPrivateField = "private-value";
          if (!call.params[1]) {
            raw.transactions = raw.transactions.map((tx) => tx.hash);
            if (options.headerSize && primaryIndex === 0) raw.size = "0x201";
          }
          return raw;
        }
        const raw = fixture(Math.floor(Number(BigInt(call.params[0])) / 10)).transactions[0];
        if (options.badIdentity && primaryIndex === 0) raw.blockHash = hash(900);
        if (options.badTransaction && primaryIndex === 0) raw.value = "0x2";
        if (options.txExtension) raw.providerPrivateField = "private-value";
        return raw;
      });
    }
  };
  return { transport, discoveries: structuredClone(discoveries), deps, selected, requests };
}
let checks = 0;
const good = scenario(), result = await probe(good);
assert.equal(result.status, "qualified_samples");
assert.deepEqual(result.qualifiedPrimaryIndices, [0, 4]);
assert.equal(result.rpcCalls, 12); assert.equal(result.providerHttpRequests, 8);
assert.deepEqual(good.requests.map(({ payload }) => Array.isArray(payload) ? payload.length : 1), [1, 2, 1, 2, 1, 2, 1, 2]);
assert.deepEqual(good.requests.flatMap(({ payload }) => (Array.isArray(payload) ? payload : [payload]).map((call) => call.id)), Array.from({ length: 12 }, (_, i) => i + 1));
assert.ok(result.samples.every((sample) => sample.offlineHelperCalls === 2 && sample.equivalent));
assert.equal(result.proposedRouteExecuted, false); assert.equal(result.helperNetworkRequests, 0);
assert.equal(result.freeOnly, false, "Only wrapper before/after identity can set this true");
assert.equal(result.transportShape, "full_singleton_then_header_transaction_batch"); checks++;

for (const option of ["headerSize", "badIdentity", "badTransaction"]) {
  const failed = await probe(scenario({ [option]: true }));
  assert.deepEqual(failed.qualifiedPrimaryIndices, [4]);
  assert.ok(failed.samples.filter((s) => s.primaryIndex === 0).every((s) => !s.equivalent));
  if (option === "headerSize") assert.ok(failed.samples.filter((s) => s.primaryIndex === 0).every((s) =>
    !s.encodedBlockEquivalent && s.encodedBlockDifferences.changedFields.includes("size")));
  if (option === "badIdentity") {
    assert.ok(failed.samples.filter((s) => s.primaryIndex === 0).every((s) => s.offlineHelperCalls === 3));
    assert.equal(failed.proposedHelperExecuted, true);
  }
  assert.ok(!JSON.stringify(failed).includes("private-value")); checks++;
}
const providerFailure = await probe(scenario({ failedEndpoint: 0 }));
assert.equal(providerFailure.rpcCalls, 12); assert.deepEqual(providerFailure.qualifiedPrimaryIndices, [4]);
assert.ok(!JSON.stringify(providerFailure).includes("private provider detail")); checks++;
const arrayChange = await probe(scenario({ fullTransactionChange: true }));
assert.deepEqual(arrayChange.qualifiedPrimaryIndices, [0]);
assert.ok(arrayChange.samples.filter((s) => s.primaryIndex === 4).every((s) =>
  !s.discoveryTransactionsEquivalent && !s.crossProviderTransactions.equivalent)); checks++;
const rawExtension = await probe(scenario({ txExtension: true, rawFullExtension: true }));
assert.deepEqual(rawExtension.qualifiedPrimaryIndices, [0, 4], "Retains frozen v5 standard/encoded transaction contract");
assert.ok(rawExtension.samples.every((s) => !s.transaction.rawEquivalent && s.transaction.standardFieldsEquivalent));
assert.ok(!JSON.stringify(rawExtension).includes("private-value") && !JSON.stringify(rawExtension).includes("providerPrivateField")); checks++;
for (const option of [{ bytes: LIMITS.totalResponseBytes + 1 }, { elapsed: LIMITS.deadlineMs + 1 }]) {
  const failed = await probe(scenario(option));
  assert.equal(failed.status, "refused_or_failed"); assert.deepEqual(failed.qualifiedPrimaryIndices, []); checks++;
}
const changedDiscovery = scenario(); changedDiscovery.discoveries[0].encodedBlockSha256 = "0".repeat(64);
assert.deepEqual((await probe(changedDiscovery)).qualifiedPrimaryIndices, []); checks++;
const fallback = await compareSample(0, discoveries[0], [fixture(BLOCKS[0]), { ...fixture(BLOCKS[0]), transactions: fixture(BLOCKS[0]).transactions.map((tx) => tx.hash) }, null], deps);
assert.equal(fallback.equivalent, false); assert.equal(fallback.offlineHelperCalls, 3); checks++;

validatePrivateInput(input);
for (const update of [{ primaryPoolSha256: "0".repeat(64) }, { deadlineMonotonicMs: 61000 },
  { selected: [selected[1], selected[0]] }, { selected: [selected[0], { ...selected[1], url: "https://not-bound.invalid/" }] },
  { selected: [selected[0], { primaryIndex: 4, url: "https://secret@existing-free-4.invalid/", urlSha256: sha("https://secret@existing-free-4.invalid/") }] }]) {
  assert.throws(() => validatePrivateInput({ ...input, ...update })); checks++;
}
const single = { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x73a680", true] };
const pair = [single, { ...single, id: 2 }];
assert.deepEqual(validateEnvelope([{ jsonrpc: "2.0", id: 2, result: 2 }, { jsonrpc: "2.0", id: 1, result: 1 }], pair), [1, 2]);
for (const body of [[{ jsonrpc: "2.0", id: 1, result: 1 }, { jsonrpc: "2.0", id: 1, result: 2 }],
  [{ jsonrpc: "2.0", id: 1, result: 1 }], { jsonrpc: "2.0", id: 1, result: 1 },
  [{ jsonrpc: "2.0", id: 1, result: 1 }, { jsonrpc: "2.0", id: 2, error: {} }]]) {
  assert.throws(() => validateEnvelope(body, pair)); checks++;
}

function fakeNetwork({ status = 200, size, advance = 0 } = {}) {
  let now = 0, calls = 0; const sleeps = [], sent = [];
  const request = (url, options, callback) => {
    calls++; sent.push({ url, options }); const req = new EventEmitter(); req.destroy = () => {};
    req.end = (body) => queueMicrotask(() => {
      now += advance;
      const response = new EventEmitter(); response.statusCode = status; response.destroy = () => {};
      callback(response);
      if (status !== 200) return;
      const payload = JSON.parse(body), reply = (call) => ({ jsonrpc: "2.0", id: call.id, result: "ok" });
      response.emit("data", size ? Buffer.alloc(size, 32) : Buffer.from(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload))));
      response.emit("end");
    }); return req;
  };
  return { clock: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; }, request,
    calls: () => calls, sleeps, sent, setNow: (n) => { now = n; } };
}
const network = fakeNetwork(), transport = createTransport(input, network);
await transport.exchange(0, single); await transport.exchange(4, pair);
assert.equal(network.calls(), 2); assert.deepEqual(network.sleeps, [1000]);
assert.deepEqual(transport.traces.map((t) => [t.shape, t.logicalCalls, t.startedAfterMs]), [["full_singleton", 1, 0], ["sparse_pair", 2, 1000]]);
assert.ok(network.sent.every(({ options }) => options.agent === false && options.method === "POST" &&
  Object.keys(options.headers).sort().join(",") === "accept-encoding,connection,content-length,content-type"));
assert.ok(transport.traces.every((row) => row.responseBytes > 0 && row.elapsedMs === 0)); checks++;
const redirected = fakeNetwork({ status: 302 }), redirectTransport = createTransport(input, redirected);
await assert.rejects(() => redirectTransport.exchange(0, single));
assert.equal(redirected.calls(), 1); assert.equal(redirectTransport.traces[0].responseBytes, 0); checks++;
const large = fakeNetwork({ size: LIMITS.perResponseBytes + 1 }), capped = createTransport(input, large);
for (let i = 0; i < 4; i++) await assert.rejects(() => capped.exchange(0, single));
assert.equal(large.calls(), 4);
assert.ok(capped.bytes() > LIMITS.totalResponseBytes);
await assert.rejects(() => capped.exchange(4, pair), /response_byte_bound/);
assert.equal(large.calls(), 4, "No further provider dispatch after exhausted byte cap");
assert.ok(capped.traces.every((trace) => trace.responseBytes === LIMITS.perResponseBytes + 1)); checks++;
const expiredNetwork = fakeNetwork(); expiredNetwork.setNow(55000);
const expired = createTransport(input, expiredNetwork);
await assert.rejects(() => expired.exchange(0, single), /probe_deadline/); assert.equal(expiredNetwork.calls(), 0); checks++;
const boundedNetwork = fakeNetwork(), bounded = createTransport(input, boundedNetwork);
for (let i = 0; i < 8; i++) await bounded.exchange(0, single);
await assert.rejects(() => bounded.exchange(0, single), /provider_request_bound/);
assert.equal(boundedNetwork.calls(), 8); checks++;
for (const [file, expected] of [[new URL("./rpc/actions.js", entry), PINS.ponderActionsSha256],
  [new URL("./sync-store/encode.js", entry), PINS.ponderEncodersSha256],
  [new URL("../../../patches/ponder-historical-log-transactions-v2.mjs", import.meta.url), PINS.candidateHelperSha256],
  [new URL("../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs", import.meta.url), PINS.comparisonsSha256]])
  assert.equal(sha(await readFile(file)), expected);
checks++;
console.log(JSON.stringify({ status: "passed", checks, networkCalls: 0, actualCandidateV2Helper: true,
  actualPonderActionsAndEncoders: true, actualFrozenV5Comparisons: true, candidateRouteExecuted: false,
  strictStoredSizeAndTransactionIdentity: true, noFallbackQualification: true, transportBoundsAndPacing: true }));
