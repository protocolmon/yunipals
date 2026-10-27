import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { toHex, zeroAddress } from "viem";
import { probe, fieldDifferences, endpointObservation, BLOCKS, LIMITS, PINS } from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v3.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions.mjs";
import { isFreeRpcCall } from "../../yunipals-market-api/src/rpcBudgetProxy.ts";

const entry = import.meta.resolve("ponder");
const actions = await import(new URL("./rpc/actions.js", entry));
const encoders = await import(new URL("./sync-store/encode.js", entry));
const hash = (n) => toHex(BigInt(n), { size: 32 });
const configuration = { freeRouting: true, paidFallbackOnFreeFailure: false, sourcePaidFallbackOnFreeFailure: false };
function fixture(n, size) {
  const transactions = [0, 1].map((i) => ({ hash: hash(n * 10 + i), transactionIndex: toHex(i),
    blockNumber: toHex(n), blockHash: hash(n), from: zeroAddress, to: zeroAddress,
    input: "0x1234", value: "0x1", nonce: toHex(i), gas: "0x30d40", gasPrice: "0x12",
    type: "0x0", r: hash(2), s: hash(3), v: "0x1b" }));
  return { hash: hash(n), parentHash: hash(n - 1), number: toHex(n), timestamp: "0x60000000",
    logsBloom: `0x${"00".repeat(256)}`, receiptsRoot: hash(300), size, transactions };
}
function scenario(options = {}) {
  let calls = 0, batches = 0, metrics = 0, identities = 0;
  const traces = [], requests = [];
  const transport = { traces, bytes: () => options.bytes ?? 50_000, elapsed: () => options.elapsed ?? 500,
    exchange: async (body) => {
      traces.push({ method: body ? "batch" : "metrics" });
      if (!body) {
        metrics++;
        return { status: "ready", ...configuration,
          sourcePaidFallbackOnFreeFailure: options.fallback || (options.midFallback && metrics > 1) || false,
          unified: { profileId: "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728", chainId: 56, sourceRouting: "free_first" },
          preferredFreeEndpoints: { source: batches % 2 },
          freeEndpoints: { primary: [0, 1].map((index) => ({ index, successes: Math.floor((batches + 1 - index) / 2), failures: 0 })) },
          traffic: { paidCalls: metrics * 100, workloads: { source: { freeCalls: calls, paidCalls: options.paidChange && metrics > 1 ? 1 : 0 } } } };
      }
      assert.ok(Array.isArray(body));
      batches++;
      assert.equal(body.length, batches === 2 ? 3 : 2);
      requests.push(body);
      calls += body.length;
      const result = body.map((call) => {
        assert.equal(isFreeRpcCall(call, undefined), true);
        assert.ok(["eth_getBlockByNumber", "eth_getTransactionByHash"].includes(call.method));
        if (call.method === "eth_getBlockByNumber") {
          const n = Number(BigInt(call.params[0]));
          let size = options.acrossBatchSize && batches === 2 ? "0x210" : "0x200";
          if (options.withinBatchSize && call.params[1] === false) size = "0x201";
          const block = fixture(n, size);
          if (!call.params[1]) block.transactions = block.transactions.map((tx) => tx.hash);
          return block;
        }
        const n = Math.floor(Number(BigInt(call.params[0])) / 10);
        const tx = fixture(n, "0x200").transactions[0];
        if (options.badTransaction) tx.blockHash = hash(999);
        return tx;
      });
      return options.shortBatch ? result.slice(1) : result;
    }
  };
  return { transport, requests, configuration, fetchHistoricalLogBlock, isFreeRpcCall, ...actions, ...encoders,
    readIdentity: () => ({ sourceStateSha256: options.changedIdentity && identities++ ? "changed" : "source", proxyStateSha256: "proxy" }) };
}

let checks = 0;
const args = scenario(), passed = await probe(args);
assert.equal(passed.status, "passed");
assert.equal(passed.rpcCalls, 7);
assert.equal(passed.probeCalls.length, 7);
assert.equal(passed.endpointObservations.length, 4);
assert.equal(passed.candidateHelperOutcome, "passed");
assert.equal(passed.diagnosticComplete, true);
assert.ok(passed.pairs.every((pair) => pair.fullSize.decimal === 512 && pair.headerEquivalent && pair.encodedBlockEquivalent));
assert.equal(passed.paidCalls, 0);
assert.deepEqual(args.requests.map((batch) => batch.length), [2, 3, 2]);
assert.deepEqual(args.requests.flat().map((call) => call.id), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(passed.pairs.map(({ blockNumber }) => blockNumber), [BLOCKS[0], BLOCKS[0], BLOCKS[1]]);
checks++;
const sameBatch = await probe(scenario({ withinBatchSize: true }));
assert.equal(sameBatch.status, "refused_or_failed");
assert.equal(sameBatch.diagnosticComplete, true);
assert.equal(sameBatch.failedStage, "strict_equality");
assert.equal(sameBatch.rpcCalls, 7, "Complete all bounded diagnostic batches before strict comparison failure");
assert.ok(sameBatch.pairs.every((pair) => pair.fullSize.decimal === 512 && pair.headerSize.decimal === 513 &&
  pair.headerDifferences.changedFields.includes("size") && !pair.encodedBlockEquivalent));
assert.equal(sameBatch.repeatedFull.equivalent, true);
assert.equal(sameBatch.transaction.encodedEquivalent, true);
checks++;
const crossBatch = await probe(scenario({ acrossBatchSize: true }));
assert.equal(crossBatch.status, "refused_or_failed");
assert.equal(crossBatch.diagnosticComplete, true);
assert.ok(crossBatch.pairs.every((pair) => pair.headerEquivalent && pair.encodedBlockEquivalent));
assert.equal(crossBatch.repeatedFull.equivalent, false);
assert.equal(crossBatch.repeatedHeader.equivalent, false);
assert.deepEqual(crossBatch.repeatedFull.differences.changedFields, ["size"]);
assert.equal(crossBatch.repeatedFull.firstSize.decimal, 512);
assert.equal(crossBatch.repeatedFull.repeatedSize.decimal, 528);
checks++;
for (const options of [{ fallback: true }, { midFallback: true }, { paidChange: true }, { changedIdentity: true },
  { badTransaction: true }, { shortBatch: true }, { bytes: LIMITS.totalResponseBytes + 1 }, { elapsed: LIMITS.deadlineMs + 1 }]) {
  const result = await probe(scenario(options));
  assert.equal(result.status, "refused_or_failed");
  assert.equal(result.freeOnly, false);
  assert.equal(result.headerAndTransactionEquivalent, false);
  assert.equal(result.paidCalls, undefined);
  assert.ok(result.rpcCalls <= 7);
  if (options.fallback) assert.equal(result.rpcCalls, 0);
  if (options.midFallback || options.paidChange) assert.equal(result.rpcCalls, 2);
  checks++;
}
const denied = await probe({ ...scenario(), isFreeRpcCall: () => false });
assert.equal(denied.status, "refused_or_failed");
assert.equal(denied.rpcCalls, 0);
checks++;
assert.throws(() => endpointObservation({ preferredFreeEndpoints: { source: "url" }, freeEndpoints: { primary: [] } }));
const privateValue = "do-not-export-raw-value";
const diff = fieldDifferences({ size: "0x201", unrecognizedProviderKey: privateValue }, { size: "0x200" });
assert.deepEqual(diff.changedFields, ["size"]);
assert.ok(!JSON.stringify(diff).includes(privateValue) && !JSON.stringify(diff).includes("unrecognizedProviderKey"));
checks++;
for (const [file, expected] of [[new URL("./rpc/actions.js", entry), PINS.ponderActionsSha256],
  [new URL("./sync-store/encode.js", entry), PINS.ponderEncodersSha256],
  [new URL("../../../patches/ponder-historical-log-transactions.mjs", import.meta.url), PINS.candidateHelperSha256]])
  assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), expected);
checks++;
console.log(JSON.stringify({ status: "passed", checks, networkCalls: 0, actualCandidateHelper: true,
  actualPonderEncoders: true, actualProxyFreeClassifier: true, withinBatchAndCrossBatchSizeMismatchesRemainFailures: true }));
