import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { encodeEventTopics, toHex, zeroAddress } from "viem";
import { collectionAbi } from "../lib/abi.ts";
import { probe, metricsGuard, BLOCKS, LIMITS, PINS } from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v1.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions.mjs";
import { isFreeRpcCall } from "../../yunipals-market-api/src/rpcBudgetProxy.ts";

const actions = await import(new URL("./rpc/actions.js", import.meta.resolve("ponder")));
const hash = (value) => toHex(BigInt(value), { size: 32 });
const address = "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d";
const configuration = { freeRouting: true, paidFallbackOnFreeFailure: false, sourcePaidFallbackOnFreeFailure: false };
function fixture(n, emptyLogs = false) {
  const transactions = [0, 1].map((i) => ({ hash: hash(n * 10 + i), transactionIndex: toHex(i),
    blockNumber: toHex(n), blockHash: hash(n), from: zeroAddress, to: address,
    input: "0x1234", value: "0x1", nonce: toHex(i), gas: "0x30d40", gasPrice: "0x12",
    type: "0x0", r: hash(2), s: hash(3), v: "0x1b" }));
  const block = { hash: hash(n), parentHash: hash(n - 1), number: toHex(n), timestamp: "0x60000000",
    logsBloom: `0x${"00".repeat(256)}`, receiptsRoot: hash(300), transactions };
  return { block, logs: emptyLogs ? [] : [{ address,
    topics: encodeEventTopics({ abi: collectionAbi, eventName: "Transfer",
      args: { from: zeroAddress, to: address, tokenId: 1n } }),
    blockNumber: toHex(n), blockHash: hash(n), transactionHash: transactions[1].hash,
    transactionIndex: "0x1", logIndex: "0x0", data: "0x", removed: false }] };
}
function scenario(options = {}) {
  let rpcCount = 0, metricsCount = 0, identities = 0;
  const traces = [];
  const transport = {
    traces, bytes: () => options.bytes ?? 5000, elapsed: () => options.elapsedMs ?? 100,
    exchange: async (body) => {
      if (!body) {
        metricsCount++;
        const metrics = { status: "ready", ...configuration,
          unified: { profileId: "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728", chainId: 56, sourceRouting: "free_first" },
          // Other workloads may legitimately increase the aggregate paid count.
          traffic: { paidCalls: metricsCount * 100, workloads: { source: { freeCalls: rpcCount,
            paidCalls: options.paidCounterChange && metricsCount > 1 ? 1 : 0 } } } };
        if (options.fallback) metrics.sourcePaidFallbackOnFreeFailure = true;
        if (options.lateFallback && metricsCount > 1) metrics.paidFallbackOnFreeFailure = true;
        return metrics;
      }
      rpcCount++;
      assert.equal(isFreeRpcCall(body, 128_816_538n), true,
        "Every probe call must qualify for legacy free routing without relying on fallback flags");
      traces.push({ method: body.method });
      let result;
      if (body.method === "eth_getLogs") result = fixture(Number(BigInt(body.params[0].fromBlock)), options.emptyLogs).logs;
      else if (body.method === "eth_getBlockByNumber") {
        result = fixture(Number(BigInt(body.params[0]))).block;
        if (!body.params[1]) result.transactions = result.transactions.map((tx) => tx.hash);
      } else if (body.method === "eth_getTransactionByHash") {
        const value = Number(BigInt(body.params[0])), n = Math.floor(value / 10);
        result = fixture(n).block.transactions[value % 10];
        if (options.badTransaction) result.blockHash = hash(999);
        if (options.missingField) delete result.gasPrice;
      } else assert.fail("Unexpected RPC method");
      return result;
    }
  };
  return { transport, configuration, fetchHistoricalLogBlock, isFreeRpcCall, ...actions,
    readIdentity: () => ({ sourceStateSha256: "source", proxyStateSha256: options.changedIdentity && identities++ ? "changed" : "proxy" }) };
}

let checks = 0;
const passed = await probe(scenario());
assert.equal(passed.status, "passed");
assert.equal(passed.rpcCalls, 6);
assert.equal(passed.paidCalls, 0);
assert.equal(passed.freeOnly, true);
assert.deepEqual(passed.samples.map(({ blockNumber }) => blockNumber), BLOCKS);
assert.ok(passed.samples.every((sample) => sample.selectionMode === "first_transaction" && sample.equivalent && sample.matchingLogCount === null));
assert.equal(passed.matchingLogsQueried, false);
assert.ok(passed.probeCalls.every(({ method }) => method !== "eth_getLogs"));
assert.equal(passed.candidateProxySelected, false);
assert.equal(passed.testedProxyEntrySha256, PINS.testedProxyEntrySha256);
assert.equal(passed.candidateProxyEntrySha256, PINS.candidateProxyEntrySha256);
assert.equal(passed.sourcePaidCallsUnchanged, true);
checks++;
assert.equal(isFreeRpcCall({ method: "eth_getLogs", params: [{ address,
  fromBlock: toHex(BLOCKS[0]), toBlock: toHex(BLOCKS[0]), topics: [] }] }, 128_816_538n), false,
  "Historical log requests would route directly paid and must never enter this default-source probe");
checks++;
for (const options of [
  { fallback: true }, { lateFallback: true }, { paidCounterChange: true },
  { changedIdentity: true }, { badTransaction: true }, { missingField: true },
  { bytes: LIMITS.totalResponseBytes + 1 }, { elapsedMs: LIMITS.deadlineMs + 1 }
]) {
  const result = await probe(scenario(options));
  assert.equal(result.status, "refused_or_failed");
  assert.equal(result.headerAndTransactionEquivalent, false);
  assert.equal(result.freeOnly, false);
  assert.equal(result.paidCalls, undefined);
  assert.ok(result.rpcCalls <= LIMITS.rpcCalls);
  if (options.fallback) assert.equal(result.rpcCalls, 0);
  checks++;
}
assert.throws(() => metricsGuard({ ...configuration }, configuration));
checks++;
const denied = await probe({ ...scenario(), isFreeRpcCall: () => false });
assert.equal(denied.status, "refused_or_failed");
assert.equal(denied.rpcCalls, 0);
assert.deepEqual(denied.probeCalls, []);
checks++;
for (const forbidden of [
  { method: "eth_getLogs", params: [{ fromBlock: toHex(BLOCKS[0]), toBlock: toHex(BLOCKS[0]) }] },
  { method: "eth_getBlockByNumber", params: ["latest", false] },
  { method: "eth_getBlockByNumber", params: [toHex(BLOCKS[0] + 1), true] },
  { method: "eth_getTransactionByHash", params: ["0x1234"] }
]) {
  const result = await probe({ ...scenario(), fetchHistoricalLogBlock: async ({ rpc }) => rpc.request(forbidden) });
  assert.equal(result.status, "refused_or_failed");
  assert.equal(result.rpcCalls, 1, "Only the allowed full block can reach the transport");
  assert.equal(result.probeCalls.length, 1);
  checks++;
}
const helper = await readFile(new URL("../../../patches/ponder-historical-log-transactions.mjs", import.meta.url));
assert.equal(createHash("sha256").update(helper).digest("hex"), PINS.candidateHelperSha256);
const actionBytes = await readFile(new URL("./rpc/actions.js", import.meta.resolve("ponder")));
assert.equal(createHash("sha256").update(actionBytes).digest("hex"), PINS.ponderActionsSha256);
checks++;
console.log(JSON.stringify({ status: "passed", checks, rpcNetworkCalls: 0, providerCalls: 0,
  actualCandidateHelper: true, actualPonderStandardization: true,
  unrelatedAggregatePaidTrafficDoesNotInvalidateFreeSourceProof: true }));
