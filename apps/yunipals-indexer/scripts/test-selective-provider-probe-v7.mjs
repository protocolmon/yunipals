import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { toHex, zeroAddress } from "viem";
import { probe, prepareFull, diagnoseTransaction, validatePrivateInput, createTransport, BLOCKS, INDICES, LIMITS, PINS, sha, canonical }
  from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v7.mjs";
import * as comparisons from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions-v2.mjs";
const entry = import.meta.resolve("ponder");
const actions = await import(new URL("./rpc/actions.js", entry));
const encoders = await import(new URL("./sync-store/encode.js", entry));
const deps = { ...comparisons, ...actions, ...encoders, fetchHistoricalLogBlock };
const hash = (n) => toHex(BigInt(n), { size: 32 });
const url = "https://existing-free-0.invalid/", selected = [{ primaryIndex: 0, url, urlSha256: sha(url) }];
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
  const transport = { traces, bytes: () => 50000, elapsed: () => 7000,
    exchange: async (primaryIndex, payload) => {
      assert.equal(primaryIndex, 0);
      const calls = Array.isArray(payload) ? payload : [payload];
      traces.push({ primaryIndex, logicalCalls: calls.length }); requests.push(payload);
      if (options.alternativeError && calls[0].method === "eth_getTransactionByBlockNumberAndIndex") throw new Error("private upstream detail");
      return calls.map((call) => {
        if (call.method === "eth_getBlockByNumber") {
          const raw = fixture(Number(BigInt(call.params[0])));
          if (!call.params[1]) {
            raw.transactions = raw.transactions.map((tx) => tx.hash);
            if (options.badSize) raw.size = "0x201";
          } else if (options.badFirstIndex) raw.transactions[0].transactionIndex = "0x00";
          return raw;
        }
        if (call.method === "eth_getTransactionByBlockNumberAndIndex") {
          assert.equal(call.params[1], "0x0");
          return options.alternativeNull ? null : fixture(Number(BigInt(call.params[0]))).transactions[0];
        }
        if (options.nullHash) return null;
        const tx = fixture(Math.floor(Number(BigInt(call.params[0])) / 10)).transactions[0];
        if (options.noncanonicalIndex) tx.transactionIndex = "0x00";
        if (options.badIdentity) tx.blockHash = hash(900);
        if (options.badMembership) tx.transactionIndex = "0x1";
        if (options.badValue) tx.value = "0x2";
        if (options.missingFrom) delete tx.from;
        if (options.extension) tx.privateProviderField = "do-not-export";
        return tx;
      });
    }
  };
  return { transport, discoveries, deps, selected, requests };
}
let checks = 0;
const good = scenario(), passed = await probe(good);
assert.equal(passed.status, "qualified_samples"); assert.deepEqual(passed.qualifiedPrimaryIndices, [0]);
assert.equal(passed.rpcCalls, 8); assert.equal(passed.providerHttpRequests, 6);
assert.deepEqual(good.requests.map((r) => Array.isArray(r) ? r.length : 1), [1, 2, 1, 1, 2, 1]);
assert.deepEqual(good.requests.flat().map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.ok(passed.samples.every((s) => s.preHelperTransaction.encodedEquivalent && s.alternative.preHelperTransaction.encodedEquivalent &&
  s.alternative.diagnosticOnly && !s.alternative.contributesToQualification && s.offlineHelperCalls === 2)); checks++;
const nullHash = await probe(scenario({ nullHash: true }));
assert.equal(nullHash.status, "no_qualified_endpoints"); assert.deepEqual(nullHash.qualifiedPrimaryIndices, []);
assert.ok(nullHash.samples.every((s) => s.transactionShape.isNull && !s.transactionShape.isObject &&
  !s.preHelperTransaction.standardFieldsEquivalent && s.preHelperTransaction.normalizationOutcome === "failed" &&
  s.offlineHelperCalls === 3 && s.offlineFallbackAttempted && s.alternative.preHelperTransaction.encodedEquivalent)); checks++;
const noncanonical = await probe(scenario({ noncanonicalIndex: true }));
assert.equal(noncanonical.status, "no_qualified_endpoints");
assert.ok(noncanonical.samples.every((s) => !s.transactionShape.canonicalIndex && s.transactionShape.hexIndex &&
  s.transactionShape.indexWithinHeader && s.transactionShape.indexMatchesRequestedHash &&
  s.preHelperTransaction.encodedEquivalent && s.offlineHelperCalls === 3 && !s.equivalent)); checks++;
for (const option of ["badIdentity", "badMembership", "missingFrom", "badValue", "badSize"]) {
  const r = await probe(scenario({ [option]: true }));
  assert.equal(r.status, "no_qualified_endpoints"); assert.deepEqual(r.qualifiedPrimaryIndices, []);
  assert.ok(r.samples.every((s) => s.preHelperTransaction && s.alternative.preHelperTransaction.encodedEquivalent));
  if (option === "badIdentity") assert.ok(r.samples.every((s) => !s.transactionShape.blockHashMatchesHeader));
  if (option === "badMembership") assert.ok(r.samples.every((s) => !s.transactionShape.indexMatchesRequestedHash));
  if (option === "missingFrom") assert.ok(r.samples.every((s) => s.preHelperTransaction.standardFieldsDifferences.missingFields.includes("from")));
  if (option === "badValue") assert.ok(r.samples.every((s) => !s.preHelperTransaction.encodedEquivalent)); checks++;
}
for (const option of ["alternativeError", "alternativeNull"]) {
  const r = await probe(scenario({ [option]: true }));
  assert.equal(r.status, "qualified_samples", "Alternative does not change existing helper qualification");
  assert.ok(r.samples.every((s) => s.alternative.contributesToQualification === false));
  assert.ok(!JSON.stringify(r).includes("private upstream detail")); checks++;
}
const absentAlternative = await probe(scenario({ badFirstIndex: true }));
assert.equal(absentAlternative.status, "refused_or_failed"); assert.equal(absentAlternative.rpcCalls, 6);
assert.ok(absentAlternative.samples.every((s) => s.alternative.requestOutcome === "failed")); checks++;
const extra = await probe(scenario({ extension: true }));
assert.equal(extra.status, "qualified_samples");
assert.ok(!JSON.stringify(extra).includes("do-not-export") && !JSON.stringify(extra).includes("privateProviderField")); checks++;
const fixtureRaw = fixture(BLOCKS[0]), fixtureHeader = { ...fixtureRaw, transactions: fixtureRaw.transactions.map((tx) => tx.hash) };
const prior = structuredClone(fixtureRaw);
diagnoseTransaction(fixtureRaw, fixtureHeader, null, discoveries[0], deps);
assert.deepEqual(fixtureRaw, prior, "Diagnostics do not mutate provider responses"); checks++;
assert.deepEqual(INDICES, [0]); assert.equal(LIMITS.rpcCalls, 8); assert.equal(LIMITS.providerHttpRequests, 6);
const input = { selected, primaryPoolSha256: PINS.primaryPoolSha256, startedMonotonicMs: 0, deadlineMonotonicMs: 60000 };
validatePrivateInput(input);
assert.throws(() => validatePrivateInput({ ...input, selected: [{ ...selected[0], primaryIndex: 4 }] })); checks++;
function transportFixture({ unsupported = false, oversized = false } = {}) {
  let now = 0, count = 0;
  const request = (url, options, callback) => {
    assert.equal(url.href, selected[0].url); assert.equal(options.agent, false); count++;
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = (body) => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.destroy = () => {};
      callback(response);
      const call = JSON.parse(body);
      response.emit("data", oversized ? Buffer.alloc(LIMITS.perResponseBytes + 1, 32) : Buffer.from(JSON.stringify(unsupported ?
        { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "private provider detail", data: "private data" } } :
        { jsonrpc: "2.0", id: call.id, result: null })));
      response.emit("end");
    }); return req;
  };
  const transport = createTransport(input, { request, clock: () => now, sleep: async (ms) => { now += ms; } });
  return { transport, count: () => count };
}
const alternativeCall = { jsonrpc: "2.0", id: 1, method: "eth_getTransactionByBlockNumberAndIndex", params: [toHex(BLOCKS[0]), "0x0"] };
const unsupported = transportFixture({ unsupported: true });
await assert.rejects(() => unsupported.transport.exchange(0, alternativeCall));
assert.deepEqual(unsupported.transport.traces[0].rpcErrorCodes, [-32601]);
assert.equal(unsupported.transport.traces[0].shape, "transaction_by_block_singleton");
assert.ok(!JSON.stringify(unsupported.transport.traces).includes("private")); checks++;
const bounded = transportFixture();
for (let i = 0; i < 6; i++) await bounded.transport.exchange(0, alternativeCall);
await assert.rejects(() => bounded.transport.exchange(0, alternativeCall));
assert.equal(bounded.count(), 6);
assert.deepEqual(bounded.transport.traces.map((r) => r.startedAfterMs), [0, 1000, 2000, 3000, 4000, 5000]); checks++;
const oversized = transportFixture({ oversized: true });
for (let i = 0; i < 4; i++) await assert.rejects(() => oversized.transport.exchange(0, alternativeCall));
await assert.rejects(() => oversized.transport.exchange(0, alternativeCall), /response_byte_bound/);
assert.equal(oversized.count(), 4); checks++;
for (const [file, expected] of [[new URL("./rpc/actions.js", entry), PINS.ponderActionsSha256],
  [new URL("./sync-store/encode.js", entry), PINS.ponderEncodersSha256],
  [new URL("../../../patches/ponder-historical-log-transactions-v2.mjs", import.meta.url), PINS.candidateHelperSha256],
  [new URL("../../../ops/unified-indexer-transition/source6-selective-provider-probe-v5.mjs", import.meta.url), PINS.comparisonsSha256]])
  assert.equal(sha(await readFile(file)), expected);
checks++;
console.log(JSON.stringify({ status: "passed", checks, networkCalls: 0, actualCandidateV2Helper: true,
  actualPonderActionsAndEncoders: true, existingValidationUnchanged: true, alternativeDiagnosticOnly: true,
  nullAndNoncanonicalIndexVisibleBeforeFallback: true }));
