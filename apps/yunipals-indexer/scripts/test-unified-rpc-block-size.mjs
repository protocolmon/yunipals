import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ResponseBodyTooLargeError, toHex } from "viem";
import { bsc } from "viem/chains";
import { unifiedRpcHttpTransport } from "../lib/unified/rpc-preflight.ts";
import { buildSourceManifest } from "../lib/unified/sources.ts";
import { unifiedRpcProfileId, unifiedRpcProfileHeader, unifiedRpcPermitHeader } from "../../../packages/yunipals-indexer-server/src/rpc-policy.ts";
const { createRpc } = await import(new URL("./rpc/index.js", import.meta.resolve("ponder")));

// Actual installed Viem batching/byte cap. Only fetch is injected: no listener,
// provider, RPC endpoint or database is contacted.
const byteLimit = 10_485_760;
const directory = await mkdtemp("/tmp/yunipals-block-size-");
const endpoint = "http://127.0.0.1:19204/unified";
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
const permit = `0x${"12".repeat(32)}`;
const env = {
  UNIFIED_RPC_POLICY_REQUIRED: "true",
  UNIFIED_RPC_PROFILE_FILE: profilePath,
  UNIFIED_RPC_PROFILE_ID: unifiedRpcProfileId(profile),
  UNIFIED_RPC_REPLAY_PERMIT_ID_56: permit
};
const block = (number) => ({
  method: "eth_getBlockByNumber",
  params: [toHex(number), true]
});
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
      if (!remaining) controller.close();
    }
  }), { headers: { "content-type": "application/json" } });
}
function fixture({ maximum = 5, streaming = false, workload = "unified_source", failure } = {}) {
  const sent = [];
  const fetchFn = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await request.json();
    const calls = Array.isArray(body) ? body : [body];
    sent.push({ array: Array.isArray(body), calls });
    assert.equal(request.headers.get("x-yunipals-rpc-workload"), workload);
    assert.equal(request.headers.get(unifiedRpcProfileHeader), env.UNIFIED_RPC_PROFILE_ID);
    assert.equal(request.headers.get(unifiedRpcPermitHeader), permit);
    if (failure) return failure();
    if (calls.length > maximum) return oversized(streaming);
    const replies = calls.map(({ id, method, params }) => ({
      jsonrpc: "2.0", id,
      result: method === "eth_getLogs" ? [] : {
        number: params[0], transactions: [{ hash: `transaction-${params[0]}`, input: "0x1234" }]
      }
    })).reverse();
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), {
      headers: { "content-type": "application/json" }
    });
  };
  const factory = unifiedRpcHttpTransport(endpoint, 56, workload, env, { fetchFn, retryCount: 0 });
  return { sent, factory, client: factory({ retryCount: 0 }) };
}
async function complete(f, numbers, requestOptions) {
  const results = await Promise.all(numbers.map((n) => f.client.request(block(n), requestOptions)));
  assert.deepEqual(results.map((r) => r.number), numbers.map(toHex));
  results.forEach((result) => assert.equal(result.transactions[0].input, "0x1234"));
  for (const dispatch of f.sent) {
    for (const call of dispatch.calls) {
      assert.equal(call.method, "eth_getBlockByNumber");
      assert.equal(call.params.length, 2);
      assert.equal(call.params[1], true);
    }
  }
}

try {
  // Ten simultaneous failures at tier10 advance only to tier5. Neither the
  // failed requests nor the next wave are silently downgraded to singleton.
  const five = fixture();
  await complete(five, Array.from({ length: 10 }, (_, i) => i + 1));
  assert.deepEqual(five.sent.map((r) => r.calls.length), [10, 5, 5]);
  const mark = five.sent.length;
  await complete(five, Array.from({ length: 10 }, (_, i) => i + 101));
  assert.deepEqual(five.sent.slice(mark).map((r) => r.calls.length), [5, 5]);

  // Actual streaming cap failures traverse5→2; the same AbortSignal still has
  // distinct scheduler identities per tier, so retries cannot recombine.
  const two = fixture({ maximum: 2, streaming: true });
  await complete(two, Array.from({ length: 10 }, (_, i) => i + 201), {
    signal: new AbortController().signal
  });
  assert.equal(two.sent.filter((r) => r.calls.length === 10).length, 1);
  assert.equal(two.sent.filter((r) => r.calls.length === 5).length, 2);
  assert.ok(two.sent.some((r) => r.calls.length === 2));
  assert.ok(two.sent.every((r) => [1, 2, 5, 10].includes(r.calls.length)));

  const one = fixture({ maximum: 1 });
  await complete(one, Array.from({ length: 10 }, (_, i) => i + 301));
  assert.ok(one.sent.some((r) => !r.array));
  const singleMark = one.sent.length;
  await complete(one, [401, 402, 403, 404]);
  assert.ok(one.sent.slice(singleMark).every((r) => !r.array));

  // A full block larger than the same10MiB cap is never skipped or truncated.
  // Exactly10→5→2→singleton attempts, then the original typed failure escapes.
  const huge = fixture({ maximum: 0 });
  const failed = await Promise.allSettled([501, 502].map((n) => huge.client.request(block(n))));
  assert.ok(failed.every((r) => r.status === "rejected" &&
    r.reason instanceof ResponseBodyTooLargeError && r.reason.maxSize === byteLimit));
  assert.deepEqual(huge.sent.map((r) => r.calls.length), [2, 2, 2, 1, 1]);
  const hugeMark = huge.sent.length;
  await assert.rejects(huge.client.request(block(503)), ResponseBodyTooLargeError);
  assert.equal(huge.sent.length, hugeMark + 1);
  assert.equal(huge.sent.at(-1).array, false);

  // Other workloads, tagged/header-only blocks, other methods, HTTP429 and a
  // text impersonation preserve their existing failure behavior.
  for (const [workload, args] of [
    ["unified_evidence", block(601)],
    ["unified_source", { method: "eth_getBlockByNumber", params: ["latest", true] }],
    ["unified_source", { method: "eth_getBlockByNumber", params: ["0x1", false] }],
    ["unified_source", { method: "eth_getBlockByHash", params: [`0x${"ab".repeat(32)}`, true] }],
    ["unified_source", { method: "eth_chainId", params: [] }]
  ]) {
    const f = fixture({ workload, maximum: 0 });
    await assert.rejects(f.client.request(args), ResponseBodyTooLargeError);
    assert.equal(f.sent.length, 1);
  }
  for (const failure of [
    () => new Response('{"error":"rpc_proxy_rate_limited"}', { status: 429 }),
    () => { throw new Error("ResponseBodyTooLargeError"); }
  ]) {
    const f = fixture({ failure });
    await assert.rejects(f.client.request(block(701)));
    assert.equal(f.sent.length, 1);
  }
  // Log singleton routing remains separate even after full-block tier fallback.
  const logs = await five.client.request({ method: "eth_getLogs", params: [{ fromBlock: "0x1", toBlock: "0x1" }] });
  assert.deepEqual(logs, []);
  assert.equal(five.sent.at(-1).array, false);
  // Actual Ponder queue uses the same transport with Viem retryCount0. All
  // blocks resolve inside the bounded fallback without Ponder's ten retries.
  const queued = fixture({ maximum: 2 });
  let queueErrors = 0;
  const hooks = [];
  const logger = { trace() {}, debug() {}, warn() {}, child() { return this; } };
  const rpc = createRpc({
    common: {
      logger,
      metrics: {
        ponder_rpc_request_duration: { observe() {} },
        ponder_rpc_request_error_total: { inc() { queueErrors++; } }
      },
      shutdown: { add(hook) { hooks.push(hook); } }
    },
    chain: { id: 56, name: "bnb", viemChain: bsc, rpc: queued.factory },
    concurrency: 10
  });
  try {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => rpc.request(block(801 + i))));
    assert.deepEqual(results.map((r) => r.number), Array.from({ length: 10 }, (_, i) => toHex(801 + i)));
    assert.equal(queueErrors, 0);
    assert.ok(queued.sent.some((r) => r.calls.length > 2));
    assert.ok(queued.sent.some((r) => r.calls.length === 2));
  } finally {
    hooks.forEach((hook) => hook());
  }
  const sourceSha256 = createHash("sha256").update(await readFile(new URL("../lib/unified/rpc-preflight.ts", import.meta.url))).digest("hex");
  console.log(JSON.stringify({ passed: true, actualInstalledViem: "2.55.13", actualInstalledPonder: "0.17.5", byteLimit,
    tiers: [10, 5, 2, 1], completeFullTransactions: true, singletonOversizePropagates: true,
    concurrentTierFailuresDoNotOverAdvance: true, ponderQueueErrors: queueErrors, sourceSha256, networkRequests: 0, databaseCalls: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
