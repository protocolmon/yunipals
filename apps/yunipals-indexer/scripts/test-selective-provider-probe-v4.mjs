import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { toHex, zeroAddress } from "viem";
import { probe, attributeBatch, endpointObservation, qualifications, BLOCKS, LIMITS, PINS, PRIMARY_INDICES } from "../../../ops/unified-indexer-transition/source6-selective-provider-probe-v4.mjs";
import { fetchHistoricalLogBlock } from "../../../patches/ponder-historical-log-transactions.mjs";
import { isFreeRpcCall } from "../../yunipals-market-api/src/rpcBudgetProxy.ts";

const entry = import.meta.resolve("ponder");
const actions = await import(new URL("./rpc/actions.js", entry));
const encoders = await import(new URL("./sync-store/encode.js", entry));
const hash = (n) => toHex(BigInt(n), { size: 32 });
const configuration = { freeRouting: true, paidFallbackOnFreeFailure: false, sourcePaidFallbackOnFreeFailure: false };
const privateMarker = "do-not-export-raw-provider-extension";
function fixture(n) {
  const transactions = [0, 1].map((i) => ({ hash: hash(n * 10 + i), transactionIndex: toHex(i),
    blockNumber: toHex(n), blockHash: hash(n), from: zeroAddress, to: zeroAddress,
    input: "0x1234", value: "0x1", nonce: toHex(i), gas: "0x30d40", gasPrice: "0x12",
    type: "0x0", r: hash(2), s: hash(3), v: "0x1b" }));
  return { hash: hash(n), parentHash: hash(n - 1), number: toHex(n), timestamp: "0x60000000",
    logsBloom: `0x${"00".repeat(256)}`, receiptsRoot: hash(300), size: "0x200", transactions };
}
function scenario(options = {}) {
  let calls = 0, freeCalls = 0, batches = 0, metrics = 0, identities = 0;
  const states = PRIMARY_INDICES.map((index) => ({ index, successes: 0, failures: 0 }));
  const traces = [], requests = [];
  const transport = { traces, bytes: () => options.bytes ?? 50_000, elapsed: () => options.elapsed ?? 500,
    exchange: async (body) => {
      traces.push({ method: body ? "batch" : "metrics" });
      if (!body) {
        metrics++;
        return { status: "ready", ...configuration,
          sourcePaidFallbackOnFreeFailure: options.fallback || (options.midFallback && metrics > 1) || false,
          unified: { profileId: "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728", chainId: 56, sourceRouting: "free_first" },
          preferredFreeEndpoints: { source: batches % 5 },
          freeEndpoints: { primary: structuredClone(states) },
          traffic: { paidCalls: metrics * 100, workloads: { source: { freeCalls,
            paidCalls: options.paidChange && metrics > 1 ? 1 : 0 } } } };
      }
      assert.ok(Array.isArray(body));
      const index = batches++ % 5;
      assert.equal(body.length, batches === 1 || batches === 7 ? 1 : 3);
      requests.push(body); calls += body.length; freeCalls += body.length;
      states[index].successes++;
      if (body.length === 3 && options.extraSuccessIndex === index) states[(index + 1) % 5].successes++;
      if (body.length === 3 && options.extraFailureIndex === index) states[(index + 1) % 5].failures++;
      if (body.length === 3 && options.extraFreeIndex === index) freeCalls++;
      if (body.length === 3 && options.throwIndex === index) throw Error("bounded fixture failure");
      return body.map((call) => {
        assert.equal(isFreeRpcCall(call, undefined), true);
        assert.ok(["eth_getBlockByNumber", "eth_getTransactionByHash"].includes(call.method));
        if (call.method === "eth_getBlockByNumber") {
          const n = Number(BigInt(call.params[0]));
          const block = fixture(n);
          if (body.length === 3 && options.fullArrayMismatchIndex === index) block.transactions[1].gasPrice = "0x13";
          if (body.length === 3 && options.rawFullExtensionIndex === index) block.transactions[1].unknownProviderExtension = privateMarker;
          if (body.length === 3 && options.headerMismatchIndex === index &&
            (!options.onlyFirstBlock || n === BLOCKS[0]) && call.params[1] === false) block.size = "0x201";
          if (!call.params[1]) block.transactions = block.transactions.map((tx) => tx.hash);
          return block;
        }
        const n = Math.floor(Number(BigInt(call.params[0])) / 10);
        const transaction = fixture(n).transactions[0];
        if (options.transactionMismatchIndex === index) transaction.gasPrice = "0x13";
        if (options.standardFieldMismatchIndex === index) transaction.chainId = "0x38";
        if (options.rawExtensionIndex === index) transaction.unknownProviderExtension = privateMarker;
        if (options.badIdentityIndex === index) transaction.blockHash = hash(999);
        return transaction;
      });
    }
  };
  return { transport, requests, configuration, fetchHistoricalLogBlock, isFreeRpcCall, ...actions, ...encoders,
    readIdentity: () => {
      const final = identities++ > 0;
      return { sourceStateSha256: options.changedIdentity && final ? "changed" : "source", proxyStateSha256: "proxy",
        privateInputBaselineBindingSha256: (options.changedPool && final ? "b" : "a").repeat(64) };
    } };
}

let checks = 0;
const args = scenario(), passed = await probe(args);
assert.equal(passed.status, "qualified_samples");
assert.equal(passed.rpcCalls, 32);
assert.equal(passed.probeCalls.length, 36);
assert.equal(passed.samples.length, 10);
assert.equal(passed.discoveries.length, 2);
assert.equal(passed.diagnosticComplete, true);
assert.deepEqual(passed.qualifiedPrimaryIndices, PRIMARY_INDICES);
assert.equal(passed.paidCalls, 0);
assert.deepEqual(args.requests.map((batch) => batch.length), [1, 3, 3, 3, 3, 3, 1, 3, 3, 3, 3, 3]);
assert.deepEqual(args.requests.flat().map((call) => call.id), Array.from({ length: 32 }, (_, i) => i + 1));
assert.ok(passed.endpointQualifications.every((row) => row.attributedTripleCount === 2 && row.passingBlocks.length === 2));
assert.ok(passed.samples.every((sample) => sample.equivalent && sample.attribution.attributed));
assert.equal(passed.allFutureResponsesQualified, false);
assert.equal(passed.candidateProxySelected, false);
checks++;
for (const option of ["headerMismatchIndex", "transactionMismatchIndex", "standardFieldMismatchIndex", "fullArrayMismatchIndex", "badIdentityIndex", "throwIndex"]) {
  const result = await probe(scenario({ [option]: 3 }));
  assert.equal(result.status, "qualified_samples", option);
  assert.deepEqual(result.qualifiedPrimaryIndices, [0, 1, 2, 4], option);
  assert.equal(result.endpointQualifications[3].disqualifiedByObservedFailure, true, option);
  assert.equal(result.rpcCalls, 32, "Fixed schedule continues after a failed observed triple");
  checks++;
}
const onceBad = await probe(scenario({ headerMismatchIndex: 3, onlyFirstBlock: true }));
assert.equal(onceBad.endpointQualifications[3].disqualifiedByObservedFailure, true);
assert.deepEqual(onceBad.endpointQualifications[3].passingBlocks, [BLOCKS[1]]);
assert.ok(!onceBad.qualifiedPrimaryIndices.includes(3), "Later success cannot erase an earlier failed observation");
checks++;
for (const option of ["extraSuccessIndex", "extraFailureIndex", "extraFreeIndex"]) {
  const result = await probe(scenario({ [option]: 2 }));
  assert.deepEqual(result.qualifiedPrimaryIndices, [0, 1, 3, 4], option);
  assert.equal(result.samples.filter((row) => !row.attribution.attributed).length, 2);
  assert.equal(result.endpointQualifications[2].attributedTripleCount, 0);
  assert.equal(result.endpointQualifications[2].qualified, false);
  checks++;
}
const extraRaw = await probe(scenario({ rawExtensionIndex: 4, rawFullExtensionIndex: 2 }));
assert.deepEqual(extraRaw.qualifiedPrimaryIndices, PRIMARY_INDICES);
assert.ok(extraRaw.samples.filter((row) => row.attribution.primaryIndex === 4).every((row) =>
  !row.transaction.rawEquivalent && row.transaction.standardFieldsEquivalent && row.transaction.encodedEquivalent));
assert.ok(extraRaw.samples.filter((row) => row.attribution.primaryIndex === 2).every((row) =>
  !row.rawFullTransactions.equivalent && row.fullTransactions.equivalent));
assert.ok(!JSON.stringify(extraRaw).includes(privateMarker));
assert.ok(!JSON.stringify(extraRaw).includes("unknownProviderExtension"));
checks++;
for (const options of [{ fallback: true }, { midFallback: true }, { paidChange: true }, { changedIdentity: true },
  { changedPool: true }, { bytes: LIMITS.totalResponseBytes + 1 }, { elapsed: LIMITS.deadlineMs + 1 }]) {
  const result = await probe(scenario(options));
  assert.equal(result.status, "refused_or_failed");
  assert.equal(result.freeOnly, false);
  assert.deepEqual(result.qualifiedPrimaryIndices, []);
  assert.equal(result.paidCalls, undefined);
  assert.ok(result.rpcCalls <= 32);
  if (options.fallback) assert.equal(result.rpcCalls, 0);
  if (options.midFallback || options.paidChange) assert.equal(result.rpcCalls, 1);
  checks++;
}
const denied = await probe({ ...scenario(), isFreeRpcCall: () => false });
assert.equal(denied.status, "refused_or_failed");
assert.equal(denied.rpcCalls, 0);
checks++;
assert.throws(() => endpointObservation({ preferredFreeEndpoints: { source: 0 }, freeEndpoints: { primary: [] } }));
assert.throws(() => endpointObservation({ preferredFreeEndpoints: { source: 0 },
  freeEndpoints: { primary: Array.from({ length: 5 }, () => ({ index: 0, successes: 0, failures: 0 })) } }));
const baseline = { sourceCounters: { configurationSha256: "same", paidCalls: 0, freeCalls: 10 },
  primary: PRIMARY_INDICES.map((index) => ({ index, successes: 0, failures: 0 })) };
const after = structuredClone(baseline); after.sourceCounters.freeCalls = 13; after.primary[4].successes = 1;
assert.equal(attributeBatch(baseline, after, 3).primaryIndex, 4);
after.primary[0].successes = 1;
assert.equal(attributeBatch(baseline, after, 3).primaryIndex, null);
checks++;
const onlyOneBlock = qualifications([{ blockNumber: BLOCKS[0], equivalent: true, attribution: { primaryIndex: 0 } }]);
assert.equal(onlyOneBlock[0].qualified, false);
checks++;
for (const [file, expected] of [[new URL("./rpc/actions.js", entry), PINS.ponderActionsSha256],
  [new URL("./sync-store/encode.js", entry), PINS.ponderEncodersSha256],
  [new URL("../../../patches/ponder-historical-log-transactions.mjs", import.meta.url), PINS.candidateHelperSha256]])
  assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), expected);
checks++;
console.log(JSON.stringify({ status: "passed", checks, networkCalls: 0, actualCandidateHelper: true,
  actualPonderEncoders: true, actualProxyFreeClassifier: true, exactCounterAttribution: true,
  disqualifiesObservedFailures: true, codeSha256: createHash("sha256").update(await readFile(new URL("../../../ops/unified-indexer-transition/source6-selective-provider-probe-v4.mjs", import.meta.url))).digest("hex") }));
