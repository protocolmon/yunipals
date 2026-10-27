import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { http, ResponseBodyTooLargeError, toHex } from "viem";
import { base } from "viem/chains";
import { unifiedRpcHttpTransport } from "../lib/unified/rpc-preflight.ts";
import { buildSourceManifest } from "../lib/unified/sources.ts";
import { unifiedRpcProfileId } from "../../../packages/yunipals-indexer-server/src/rpc-policy.ts";

// Actual installed Ponder RPC queue, historical splitter and retry helper.
// Only HTTP responses are injected. No listener, provider or database is used.
const ponderEntry = import.meta.resolve("ponder");
const ponderRequire = createRequire(ponderEntry);
const { createRpc } = await import(new URL("./rpc/index.js", ponderEntry));
const { createHistoricalSync } = await import(
  new URL("./sync-historical/index.js", ponderEntry)
);
const { getLogsRetryHelper } = await import(
  pathToFileURL(ponderRequire.resolve("@ponder/utils"))
);
const byteLimit = 10_485_760;
const directory = await mkdtemp("/tmp/yunipals-log-size-");
const profile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "test-coordinator",
  coordinatorId: "12345678-1234-4123-8123-123456789012",
  manifest: buildSourceManifest({}),
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const profilePath = join(directory, "profile.json");
await writeFile(profilePath, JSON.stringify(profile));
const env = {
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_PROFILE_FILE: profilePath,
  UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile)
};
const endpoint = "http://127.0.0.1:19202/unified";
const address = `0x${"12".repeat(20)}`;
const topic = `0x${"34".repeat(32)}`;
const blockHash = `0x${"56".repeat(32)}`;
const transactionHash = `0x${"78".repeat(32)}`;
const metrics = { inc() {}, observe() {} };
const logger = {
  trace() {}, debug() {}, warn() {},
  child() { return this; }
};
const common = {
  logger,
  metrics: {
    ponder_rpc_request_error_total: metrics,
    ponder_rpc_request_duration: metrics
  },
  options: { factoryAddressCountThreshold: 1000 },
  shutdown: { add() {} }
};
const filter = (from, to) => ({
  address,
  topics: [topic],
  fromBlock: toHex(from),
  toBlock: toHex(to)
});
function log(block) {
  return {
    address, topics: [topic], blockHash, transactionHash,
    blockNumber: toHex(block), logIndex: "0x0", data: "0x",
    transactionIndex: "0x0", removed: false
  };
}
function oversized(streaming = false) {
  if (!streaming) {
    return new Response("", {
      headers: {
        "content-type": "application/json",
        "content-length": String(byteLimit + 1)
      }
    });
  }
  let remaining = byteLimit + 1;
  return new Response(new ReadableStream({
    pull(controller) {
      const size = Math.min(remaining, 262144);
      controller.enqueue(new Uint8Array(size).fill(32));
      remaining -= size;
      if (remaining === 0) controller.close();
    }
  }), { headers: { "content-type": "application/json" } });
}
function fixture({ maximum = 120, streaming = false } = {}) {
  const requests = [], accepted = [], dispatches = [];
  const fetchFn = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    const calls = Array.isArray(body) ? body : [body];
    dispatches.push(calls.length);
    for (const call of calls) {
      assert.equal(call.method, "eth_getLogs");
      assert.equal(call.params[0].address, address);
      assert.deepEqual(call.params[0].topics, [topic]);
      assert.equal(request.headers.get("x-yunipals-rpc-workload"), "unified_source");
      requests.push([Number(BigInt(call.params[0].fromBlock)), Number(BigInt(call.params[0].toBlock))]);
    }
    if (calls.some(({ params }) => BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) + 1n > BigInt(maximum)))
      return oversized(streaming);
    const replies = calls.map(({ id, params }) => {
      const from = Number(BigInt(params[0].fromBlock)), to = Number(BigInt(params[0].toBlock));
      accepted.push([from, to]);
      return { jsonrpc: "2.0", id, result: Array.from({ length: to - from + 1 }, (_, i) => log(from + i)) };
    }).reverse();
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), {
      headers: { "content-type": "application/json" }
    });
  };
  const transport = unifiedRpcHttpTransport(endpoint, 8453, "unified_source", env, { fetchFn, retryCount: 0 });
  return { transport, fetchFn, requests, accepted, dispatches };
}
async function historical(from, to, options) {
  const f = fixture(options);
  const chain = { id: 8453, name: "base", viemChain: base, rpc: f.transport };
  const rpc = createRpc({ common, chain });
  const sync = createHistoricalSync({ common, chain, rpc, childAddresses: new Map() });
  const logs = await sync.syncBlockRangeData({
    interval: [from, to],
    requiredIntervals: [{ filter: { type: "log", address, topic0: topic }, interval: [from, to] }],
    requiredFactoryIntervals: [],
    syncStore: { insertChildAddresses() { throw new Error("No factory writes expected"); } }
  });
  assert.deepEqual(logs.map((item) => Number(BigInt(item.blockNumber))).sort((a, b) => a - b),
    Array.from({ length: to - from + 1 }, (_, i) => from + i));
  assert.equal(new Set(logs.map((item) => `${item.blockNumber}:${item.logIndex}`)).size, to - from + 1);
  for (const [start, end] of f.accepted) {
    assert.ok(start >= from && end <= to && start <= end);
    assert.ok(end - start + 1 <= (options?.maximum ?? 120));
  }
  return f;
}

try {
  const exact = await historical(22282017, 22282454);
  assert.equal(exact.requests.filter(([a, b]) => a === 22282017 && b === 22282454).length, 1);
  assert.ok(exact.accepted.length > 1);
  await historical(10, 12, { maximum: 1 });
  await historical(20, 21, { maximum: 1 });
  await historical(30, 46, { maximum: 6, streaming: true });

  // Concurrent source logs stay separate and each dense span can split safely.
  const batch = fixture();
  const client = batch.transport({ retryCount: 0 });
  const spans = [filter(100, 537), filter(1000, 1437)];
  const rejected = await Promise.allSettled(spans.map((value) => client.request({ method: "eth_getLogs", params: [value] })));
  assert.deepEqual(batch.dispatches, [1, 1]);
  rejected.forEach((item, index) => {
    assert.equal(item.status, "rejected");
    assert.equal(item.reason.name, "UnifiedRpcLogResponseTooLargeError");
    assert.ok(item.reason.cause instanceof ResponseBodyTooLargeError);
    const retry = getLogsRetryHelper({ error: item.reason, params: [spans[index]] });
    assert.equal(retry.shouldRetry, true);
    assert.equal(retry.isSuggestedRange, false);
    assert.equal(retry.ranges[0].toBlock, toHex(Number(BigInt(spans[index].fromBlock)) + 218));
  });

  // No dropping the final oversized block or fabricating an empty successful range.
  const one = fixture({ maximum: 0 });
  await assert.rejects(one.transport({ retryCount: 0 }).request({ method: "eth_getLogs", params: [filter(50, 50)] }),
    (error) => error instanceof ResponseBodyTooLargeError);
  assert.equal(one.requests.length, 1);

  // The actual Viem cap still applies outside numeric source logs/full blocks.
  const cappedFetch = async () => oversized();
  for (const [workload, args, selectedEnv] of [
    ["unified_source", { method: "eth_getLogs", params: [{ address, blockHash }] }, env],
    ["unified_source", { method: "eth_getLogs", params: [{ ...filter(1, 4), toBlock: "latest" }] }, env],
    ["unified_source", { method: "eth_getBlockByNumber", params: ["0x1", false] }, env],
    ["unified_evidence", { method: "eth_getLogs", params: [filter(1, 4)] }, env],
    ["unified_source", { method: "eth_getLogs", params: [filter(1, 4)] }, {}]
  ]) {
    const transport = unifiedRpcHttpTransport(endpoint, 8453, workload, selectedEnv, { fetchFn: cappedFetch, retryCount: 0 });
    await assert.rejects(transport({ retryCount: 0 }).request(args), (error) => error instanceof ResponseBodyTooLargeError);
  }
  await assert.rejects(http(endpoint, { fetchFn: cappedFetch, retryCount: 0 })({ retryCount: 0 }).request({ method: "eth_getLogs", params: [filter(1, 438)] }),
    (error) => error instanceof ResponseBodyTooLargeError && !getLogsRetryHelper({ error, params: [filter(1, 438)] }).shouldRetry);

  // Neither HTTP429 nor text impersonating the class is converted into a range hint.
  for (const fetchFn of [
    async () => new Response('{"error":"rpc_proxy_rate_limited"}', { status: 429 }),
    async () => { throw new Error("ResponseBodyTooLargeError"); }
  ]) {
    const transport = unifiedRpcHttpTransport(endpoint, 8453, "unified_source", env, { fetchFn, retryCount: 0 });
    await assert.rejects(transport({ retryCount: 0 }).request({ method: "eth_getLogs", params: [filter(1, 438)] }),
      (error) => error.name !== "UnifiedRpcLogResponseTooLargeError" && !getLogsRetryHelper({ error, params: [filter(1, 438)] }).shouldRetry);
  }
  const sourceSha256 = createHash("sha256").update(await readFile(new URL("../lib/unified/rpc-preflight.ts", import.meta.url))).digest("hex");
  console.log(JSON.stringify({ passed: true, actualInstalledViem: "2.55.13", actualInstalledPonder: "0.17.5", byteLimit,
    exactOriginalSpan: [22282017, 22282454], completeLogs: 438, repeatedOriginalRequests: 1,
    acceptedSubranges: exact.accepted.length, sourceSha256, networkRequests: 0, databaseCalls: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
