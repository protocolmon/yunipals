import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import {
  createRpcBudgetProxy,
  isFreeRpcCall,
  readRpcBudgetProxyEnvironment,
  rpcPrimaryPoolSha256,
  type RpcBudgetProxyOptions
} from "@/rpcBudgetProxy";
import type { RpcComputeBudget } from "@/opensea/rpcComputeBudget";
import {
  unifiedRpcProfileHeader,
  unifiedRpcProfileId,
  unifiedRpcPaidRange,
  validateUnifiedRpcCalls,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

const address = `0x${"ab".repeat(20)}`;
const hash = `0x${"cd".repeat(32)}`;
const urls = [0, 1, 2].map((index) => new URL(`https://primary-${index}.invalid/private-fixture`));
const poolSha256 = rpcPrimaryPoolSha256(urls);
const profile: UnifiedRpcProfile = {
  version: 1, model: "alchemy-2026-09-08", scope: "selective-test",
  coordinatorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  manifest: { version: 1, ponderVersion: "0.17.5", ordering: "multichain", coverage: "ponder-live-blocks-v1", sources: [{
    id: "ownership:bnb", feature: "ownership", chainId: 56,
    contractName: "YunipalsBnb", address, startBlock: "100", endBlock: null,
    enabled: true, abiHash: hash, events: ["Transfer"], receiptRequirement: "full", policies: [{ kind: "latest" }]
  }] },
  limits: { batchCalls: 10, logRange: 10000, addresses: 50, topicValues: 32 }
};
type Call = { jsonrpc: string; id: number; method: string; params: unknown[] };
const header: Call = { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x64", false] };
const transaction: Call = { jsonrpc: "2.0", id: 2, method: "eth_getTransactionByHash", params: [hash] };
const blockTransaction: Call = { jsonrpc: "2.0", id: 5, method: "eth_getTransactionByBlockNumberAndIndex", params: ["0x64", "0x7"] };
const full: Call = { ...header, id: 3, params: ["0x64", true] };
const logs: Call = { jsonrpc: "2.0", id: 4, method: "eth_getLogs", params: [{ address, fromBlock: "0x64", toBlock: "0x65" }] };
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done())))); });
function configuration() {
  const seen: Array<{ url: string; body: unknown }> = [];
  const counts = { authorize: 0, paid: 0, permit: 0 };
  const budget: RpcComputeBudget = {
    authorizeFreeDispatch: async () => { counts.authorize++; },
    reserve: async () => { counts.paid++; },
    snapshot: () => ({ model: "test", workload: "source", priority: "background", grantedCu: 0, usedCu: 0, remainingCu: 0, denied: 0 })
  };
  const options: RpcBudgetProxyOptions = {
    upstream: new URL("https://paid.invalid"), freeUpstreams: urls,
    freeLogUpstreams: [new URL("https://logs.invalid")], freeMinimumIntervalMs: 0,
    budget, workloadBudgets: { unified_source: budget, unified_evidence: budget },
    unifiedPolicy: { profile, chainId: 56, ready: async () => {}, inspect: async () => ({}), reservePaid: async () => { counts.permit++; } },
    bnbSelectivePrimaryIndices: [1, 2], bnbSelectivePoolSha256: poolSha256,
    fetch: async (input, init) => {
      const body = JSON.parse(Buffer.from(init!.body as Buffer).toString()) as Call | Call[];
      seen.push({ url: String(input), body });
      const reply = (call: Call) => ({ jsonrpc: "2.0", id: call.id, result: call.method === "eth_getLogs" ? [] : { hash, number: "0x64" } });
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(reply) : reply(body)));
    }
  };
  return { options, seen, counts };
}
async function fixture(change?: (options: RpcBudgetProxyOptions) => void) {
  const f = configuration(); change?.(f.options);
  const proxy = createRpcBudgetProxy(f.options); servers.push(proxy);
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  const bound = proxy.address(); assert.ok(bound && typeof bound === "object");
  const url = `http://127.0.0.1:${bound.port}`;
  return { ...f,
    request: (body: unknown, workload = "unified_source", headers: Record<string, string> = {}) => fetch(url + (workload === "legacy" ? "/" : "/unified"), {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(workload === "legacy" ? {} : {
        "x-yunipals-rpc-workload": workload, [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
      }), ...headers }
    }),
    metrics: async () => (await fetch(url + "/metrics")).json()
  };
}

test("qualified BNB header and transaction batches rotate only qualified primary indices", async () => {
  const f = await fixture();
  for (let i = 0; i < 3; i++) assert.equal((await f.request([header, transaction])).status, 200);
  assert.deepEqual(f.seen.map((row) => row.url), [urls[1]!.href, urls[2]!.href, urls[1]!.href]);
  assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
  const metrics = await f.metrics();
  assert.deepEqual(metrics.unified.selective.primaryIndices, [1, 2]);
  assert.equal(metrics.unified.selective.poolSha256, poolSha256);
  assert.equal(metrics.unified.traffic.unified_source.freeCalls, 6);
  assert.ok(!JSON.stringify(metrics).includes("private-fixture"));
});

test("mixed log/full/header/transaction batch remains intact on qualified endpoint", async () => {
  const f = await fixture(); const calls = [logs, full, transaction, header];
  assert.equal((await f.request(calls)).status, 200);
  assert.deepEqual(f.seen, [{ url: urls[1]!.href, body: calls }]);
  assert.equal((await f.request(full)).status, 200);
  assert.equal(f.seen[1]!.url, urls[0]!.href);
  assert.equal((await f.request(logs)).status, 200);
  assert.equal(f.seen[2]!.url, "https://logs.invalid/");
});

test("block-position transactions and mixed batches stay intact on the sole qualified endpoint", async () => {
  const f = await fixture((options) => { options.bnbSelectivePrimaryIndices = [0]; });
  const calls = [blockTransaction, { ...blockTransaction, id: 6, params: ["0x64", "0x6f"] }];
  assert.equal((await f.request(header)).status, 200);
  assert.equal((await f.request(calls)).status, 200);
  assert.equal((await f.request([logs, ...calls, header])).status, 200);
  assert.deepEqual(f.seen, [{ url: urls[0]!.href, body: header }, { url: urls[0]!.href, body: calls },
    { url: urls[0]!.href, body: [logs, ...calls, header] }]);
  assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
  assert.equal((await f.metrics()).unified.selective.endpoints[0].successes, 3);
});

test("block-position schema is canonical numeric only and never adds a paid range", async () => {
  assert.equal(isFreeRpcCall(blockTransaction, undefined), true);
  validateUnifiedRpcCalls(profile, 56, [blockTransaction]);
  assert.throws(() => unifiedRpcPaidRange(blockTransaction));
  const f = await fixture((options) => { options.bnbSelectivePrimaryIndices = [0]; });
  for (const params of [[], ["0x64"], ["latest", "0x0"], ["0x064", "0x0"], ["0x64", "0x00"],
    ["0x64", "0x-1"], ["0x64", "0x80000000"], ["0x64", 0], ["0x64", "0x0", true]]) {
    const call = { ...blockTransaction, params };
    assert.equal(isFreeRpcCall(call, undefined), false);
    assert.throws(() => validateUnifiedRpcCalls(profile, 56, [call]));
    assert.equal((await f.request(call)).status, 400);
  }
  assert.equal(f.seen.length, 0); assert.deepEqual(f.counts, { authorize: 0, paid: 0, permit: 0 });
});

test("failed qualified block-position batch cannot use unqualified or paid endpoints", async () => {
  const dispatched: string[] = [];
  const f = await fixture((options) => {
    options.bnbSelectivePrimaryIndices = [0];
    options.paidFallbackOnFreeFailure = true;
    options.sourcePaidFallbackOnFreeFailure = true;
    options.unifiedSourcePaidPrimary = true;
    options.fetch = async (input) => { dispatched.push(String(input)); return new Response("{}", { status: 503 }); };
  });
  assert.equal((await f.request([blockTransaction, header])).status, 503);
  assert.deepEqual(dispatched, [urls[0]!.href]);
  assert.deepEqual(f.counts, { authorize: 1, paid: 0, permit: 0 });
});

test("qualified failure cannot reach unqualified endpoints or paid routing even with paid switches", async () => {
  const dispatched: string[] = [];
  const f = await fixture((options) => {
    options.paidFallbackOnFreeFailure = true;
    options.sourcePaidFallbackOnFreeFailure = true;
    options.unifiedSourcePaidPrimary = true;
    options.fetch = async (input) => { dispatched.push(String(input)); return new Response("{}", { status: 503 }); };
  });
  assert.equal((await f.request([header, transaction])).status, 503);
  assert.deepEqual(dispatched, [urls[1]!.href, urls[2]!.href]);
  assert.deepEqual(f.counts, { authorize: 1, paid: 0, permit: 0 });
  assert.equal((await f.metrics()).traffic.freeOnlyFailures, 1);
});

test("legacy and evidence reads retain their ordinary pools", async () => {
  const f = await fixture();
  assert.equal((await f.request(header, "legacy")).status, 200);
  assert.equal(f.seen[0]!.url, urls[0]!.href);
  assert.equal((await f.request(header, "unified_evidence")).status, 200);
  assert.equal(f.seen[1]!.url, urls[0]!.href);
  assert.equal((await f.metrics()).unified.selective.endpoints.reduce((sum: number, row: { successes: number }) => sum + row.successes, 0), 0);
});

test("disabled selective route preserves existing source behavior and metrics shape", async () => {
  const f = await fixture((options) => { delete options.bnbSelectivePrimaryIndices; delete options.bnbSelectivePoolSha256; });
  assert.equal((await f.request([header, transaction])).status, 200);
  assert.equal(f.seen[0]!.url, urls[0]!.href);
  assert.equal((await f.metrics()).unified.selective, undefined);
});

test("normal source policy gates still run before qualified dispatch", async () => {
  const f = await fixture();
  assert.equal((await f.request(header, "unified_source", { [unifiedRpcProfileHeader]: "0x" + "00".repeat(32) })).status, 403);
  assert.equal(f.seen.length, 0);
  assert.equal((await f.request({ ...header, params: ["0x64", false, "invalid"] })).status, 400);
  assert.equal(f.seen.length, 0);
});

test("invalid selective configuration fails closed including changed endpoint order", () => {
  const changes: Array<(options: RpcBudgetProxyOptions) => void> = [
    (o) => { o.bnbSelectivePrimaryIndices = []; },
    (o) => { o.bnbSelectivePrimaryIndices = [1, 1]; },
    (o) => { o.bnbSelectivePrimaryIndices = [-1]; },
    (o) => { o.bnbSelectivePrimaryIndices = [3]; },
    (o) => { o.bnbSelectivePrimaryIndices = [0.5]; },
    (o) => { o.bnbSelectivePrimaryIndices = [Number.MAX_SAFE_INTEGER + 1]; },
    (o) => { o.unifiedPolicy!.chainId = 8453; },
    (o) => { delete o.unifiedPolicy; },
    (o) => { delete o.bnbSelectivePoolSha256; },
    (o) => { delete o.bnbSelectivePrimaryIndices; },
    (o) => { o.freeUpstreams = [...urls].reverse(); },
    (o) => { o.bnbSelectivePoolSha256 = "0".repeat(64); }
  ];
  for (const change of changes) { const { options } = configuration(); change(options); assert.throws(() => createRpcBudgetProxy(options), /Invalid BNB selective/); }
});

test("environment indices use a strict public syntax and ordered pool hash", () => {
  const env = { MARKET_RPC_PROXY_PORT: "19204", MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid", MARKET_RPC_PROXY_FREE_UPSTREAM: urls[0]!.href,
    MARKET_RPC_PROXY_BNB_SELECTIVE_POOL_SHA256: poolSha256 };
  for (const value of ["", "01", " 1", "1,", "-1", "1.1", "1, 2"])
    assert.throws(() => readRpcBudgetProxyEnvironment({ ...env, MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES: value }), /Invalid BNB selective/);
  assert.deepEqual(readRpcBudgetProxyEnvironment({ ...env, MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES: "1,2" }).bnbSelectivePrimaryIndices, [1, 2]);
  assert.notEqual(rpcPrimaryPoolSha256([...urls].reverse()), poolSha256);
});
