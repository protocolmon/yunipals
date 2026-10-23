import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRelease, BUILD, createBoundedFetch, MANIFEST, RELEASE, runnable, SCHEMA, validateConfiguration } from "./support-probe-runner-v6.mjs";

const PROFILE = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728";
const config = () => ({ profileId: PROFILE, task: "worker", chains: [1, 137], queueLimit: 8, receiptLimit: 2, maxRpcCalls: 64, maxSeconds: 180, maxResponseBytes: 2097152 });
const headers = () => ({ "x-yunipals-unified-rpc-profile": PROFILE, "x-yunipals-rpc-workload": "unified_evidence" });
const call = (method = "eth_chainId", params = []) => ({ jsonrpc: "2.0", id: 1, method, params });
const post = (body = call()) => ({ method: "POST", headers: headers(), body: JSON.stringify(body) });
const endpoint = "http://127.0.0.1:19201/unified";
const reply = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));

test("only finite sorted selected EVM chains and strict numeric caps are accepted", () => {
  validateConfiguration(config());
  validateConfiguration({ ...config(), chains: [1, 56, 137, 8453] });
  for (const task of ["observe-once", "receipts-once", "worker"]) validateConfiguration({ ...config(), task });
  assert.throws(() => validateConfiguration({ ...config(), task: "migrate" }));
  assert.throws(() => validateConfiguration({ ...config(), profileId: undefined }));
  for (const chains of [[], [2], [1, 1], [137, 1], [true], [1, 137, 56]]) assert.throws(() => validateConfiguration({ ...config(), chains }));
  for (const [key, value] of [["receiptLimit", 3], ["queueLimit", 9], ["maxRpcCalls", 65], ["maxSeconds", 181], ["maxResponseBytes", 2097153], ["maxSeconds", true]]) {
    assert.throws(() => validateConfiguration({ ...config(), [key]: value }));
  }
  assert.throws(() => validateConfiguration({ ...config(), replayPermit: "new" }));
});

test("bounded actual fetch receives only reviewed endpoint, evidence profile, redirect-error and a signal", async () => {
  const requests = [];
  const bounded = createBoundedFetch(config(), async (...args) => { requests.push(args); return reply(); });
  assert.equal((await (await bounded.fetch(endpoint, post())).json()).result, "0x1");
  assert.equal(bounded.state.rpcCalls, 1);
  assert.equal(requests[0][1].redirect, "error");
  assert.ok(requests[0][1].signal instanceof AbortSignal);
  assert.equal(new Headers(requests[0][1].headers).get("x-yunipals-rpc-workload"), "unified_evidence");
});

test("logical batch requests count every call rather than every HTTP envelope", async () => {
  let sent = 0;
  const bounded = createBoundedFetch({ ...config(), maxRpcCalls: 3 }, async () => { sent++; return reply(); });
  await bounded.fetch(endpoint, post([call(), call()]));
  assert.equal(bounded.state.rpcCalls, 2);
  await assert.rejects(bounded.fetch(endpoint, post([call(), call()])));
  assert.equal(sent, 1);
  await assert.rejects(bounded.fetch(endpoint, post()));
  assert.equal(sent, 1);
});

test("arbitrary hosts, fallback roots, other chains, credentials and replay headers never dispatch", async () => {
  for (const [url, options] of [["https://rpc.example/unified", post()], ["http://127.0.0.1:19201/", post()],
    ["http://127.0.0.1:19204/unified", post()], ["http://user:secret@127.0.0.1:19201/unified", post()],
    [endpoint, { ...post(), headers: { ...headers(), "x-yunipals-unified-rpc-permit": "0x" + "a".repeat(64) } }],
    [endpoint, { ...post(), headers: { ...headers(), authorization: "must-not-dispatch" } }],
    [endpoint, { ...post(), headers: { ...headers(), "x-yunipals-rpc-workload": "unified_source" } }],
    [endpoint, { ...post(), headers: { ...headers(), "x-yunipals-unified-rpc-profile": "0x" + "b".repeat(64) } }]]) {
    let calls = 0;
    const bounded = createBoundedFetch(config(), async () => { calls++; return reply(); });
    await assert.rejects(bounded.fetch(url, options));
    assert.equal(calls, 0);
  }
});

test("no scanner, signer, wildcard log request, empty/oversized batch or malformed envelope dispatches", async () => {
  for (const body of [call("eth_getLogs", [{}]), call("eth_sendRawTransaction", ["secret"]), [], Array.from({ length: 11 }, () => call()),
    { method: "eth_chainId", params: {} }, null]) {
    let sent = 0;
    const bounded = createBoundedFetch(config(), async () => { sent++; return reply(); });
    await assert.rejects(bounded.fetch(endpoint, post(body)));
    assert.equal(sent, 0);
  }
  const bounded = createBoundedFetch(config(), async () => { throw Error("should not dispatch"); });
  await assert.rejects(bounded.fetch(endpoint, { ...post(), body: "not-json" }));
});

test("only one non-provider preflight per selected chain is allowed", async () => {
  let sent = 0;
  const bounded = createBoundedFetch(config(), async () => { sent++; return reply(); });
  await bounded.fetch(endpoint + "/preflight", { headers: headers() });
  assert.equal(bounded.state.preflights, 1);
  assert.equal(bounded.state.rpcCalls, 0);
  await assert.rejects(bounded.fetch(endpoint + "/preflight", { headers: headers() }));
  assert.equal(sent, 1);
});

test("proxy refusal, JSON-RPC failure and network failure latch stop without fallback or retry", async () => {
  for (const fetchImpl of [async () => new Response("refused", { status: 403 }), async () => new Response(JSON.stringify({ error: { code: -1 } })),
    async () => { throw Error("private provider diagnostic"); }]) {
    let sent = 0;
    const bounded = createBoundedFetch(config(), async (...args) => { sent++; return fetchImpl(...args); });
    await assert.rejects(bounded.fetch(endpoint, post()), /bounded_proxy_request_failed/);
    assert.equal(bounded.state.failed, true);
    await assert.rejects(bounded.fetch(endpoint, post()));
    assert.equal(sent, 1);
  }
});

test("response stream cap rejects and cancels without retaining body contents", async () => {
  const bounded = createBoundedFetch({ ...config(), maxResponseBytes: 1024 }, async () => new Response("x".repeat(1025)));
  await assert.rejects(bounded.fetch(endpoint, post()), /bounded_proxy_request_failed/);
  assert.equal(bounded.state.failed, true);
  assert.equal(bounded.state.responseBytes, 0);
});

test("absolute request deadline refuses new dispatch", async () => {
  let now = 0;
  let sent = 0;
  const bounded = createBoundedFetch({ ...config(), maxSeconds: 1 }, async () => { sent++; return reply(); }, { now: () => now });
  now = 1000;
  await assert.rejects(bounded.fetch(endpoint, post()), /probe_stopped_or_deadline/);
  assert.equal(sent, 0);
});

test("exact retained release is required and global frameworkReady is not a per-chain gate", () => {
  const release = { id: RELEASE, schema: SCHEMA, buildId: BUILD, manifestHash: MANIFEST };
  assertRelease(release);
  for (const key of Object.keys(release)) assert.throws(() => assertRelease({ ...release, [key]: "another" }));
  const snapshot = { running: true, frameworkReady: false, observedAtMs: 1000,
    chains: [{ chainId: 1, completeThroughBlock: "99", witnessBlock: "99" }, { chainId: 137, completeThroughBlock: "100", witnessBlock: "100" }] };
  assert.equal(runnable(snapshot, 1100), true);
  assert.equal(runnable({ ...snapshot, running: false }, 1100), false);
  assert.equal(runnable(snapshot, 181001), false);
  assert.equal(runnable({ ...snapshot, chains: [{ chainId: 1, completeThroughBlock: null, witnessBlock: "99" }] }, 1100), false);
});


test("historical receipt-only work needs fresh complete coverage but no live callback witness", () => {
  const snapshot = { running: true, frameworkReady: false, observedAtMs: 1000,
    chains: [{ chainId: 8453, completeThroughBlock: "52930345", witnessBlock: null }] };
  assert.equal(runnable(snapshot, 1100, "receipts-once"), true);
  for (const task of ["observe-once", "worker", "unknown"]) assert.equal(runnable(snapshot, 1100, task), false);
  for (const value of [null, undefined, "-1", "1.1", "01", NaN, Infinity])
    assert.equal(runnable({ ...snapshot, chains: [{ ...snapshot.chains[0], completeThroughBlock: value }] }, 1100, "receipts-once"), false);
  assert.equal(runnable({ ...snapshot, running: false }, 1100, "receipts-once"), false);
  assert.equal(runnable(snapshot, 181001, "receipts-once"), false);
  assert.equal(runnable(snapshot, 999, "receipts-once"), false);
  assert.equal(runnable({ ...snapshot, observedAtMs: NaN }, 1100, "receipts-once"), false);
  assert.equal(runnable({ ...snapshot, chains: [] }, 1100, "receipts-once"), false);
});


test("actual Viem client can omit chainId params without weakening point-method bounds", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../../apps/yunipals-indexer/package.json", import.meta.url));
  const { createPublicClient, http } = require("viem");
  const seen = [];
  const bounded = createBoundedFetch(config(), async (_url, options) => {
    const value = JSON.parse(options.body);
    seen.push(value);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: value.id, result: "0x1" }));
  });
  const client = createPublicClient({ transport: http(endpoint, {
    retryCount: 0, fetchFn: bounded.fetch, fetchOptions: { headers: headers() }
  }) });
  assert.equal(await client.getChainId(), 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "eth_chainId");
  assert.equal(seen[0].params, undefined);
  assert.equal(bounded.state.rpcCalls, 1);
  assert.equal(bounded.state.failed, false);
  for (const body of [{ method: "eth_getTransactionReceipt" }, { method: "eth_getBlockByNumber" }, { method: "eth_getCode" }, { method: "eth_chainId", params: null }, { method: "eth_chainId", params: {} }]) {
    let sent = 0;
    const refused = createBoundedFetch(config(), async () => { sent++; return reply(); });
    await assert.rejects(refused.fetch(endpoint, post(body)));
    assert.equal(sent, 0);
    assert.equal(refused.state.rpcCalls, 0);
  }
});


test("actual peer validator accepts only empty groups or the existing primary963 and retains all other fences", async () => {
  const { readFileSync } = await import("node:fs");
  const old = readFileSync(new URL("./support-probe-runner-v5.mjs", import.meta.url), "utf8");
  const next = readFileSync(new URL("./support-probe-runner-v6.mjs", import.meta.url), "utf8");
  assert.equal(next, old.replace('status.Groups !== "" ||', '(status.Groups !== "" && status.Groups !== "963") ||'));
  const fragment = next.slice(next.indexOf("export function assertPeer()"), next.indexOf("export async function runProbe"));
  const status = { Uid: "969 969 969 969", Gid: "963 963 963 963", Groups: "963", NoNewPrivs: "1", CapInh: "0000", CapPrm: "0000", CapEff: "0000", CapAmb: "0000" };
  const invoke = (change = {}, processChange = {}) => {
    const value = { ...status, ...change };
    const runtime = { env: { YUNIPALS_SUPPORT_UID: "969", YUNIPALS_SUPPORT_GID: "963" }, getuid: () => 969, getgid: () => 963, ...processChange };
    const reader = () => Object.entries(value).map(([k, v]) => `${k}: ${v}`).join("\n");
    return new Function("readFileSync", "process", fragment.replace("export ", "") + "; return assertPeer;")(reader, runtime)();
  };
  invoke(); invoke({ Groups: "" });
  for (const change of [{ Groups: "0" }, { Groups: "963 964" }, { Groups: "963 963" }, { NoNewPrivs: "0" }, { CapEff: "1" }, { CapAmb: "1" }]) {
    assert.throws(() => invoke(change), /restricted_support_os_identity_required/);
  }
  assert.throws(() => invoke({}, { getuid: () => 0 }), /restricted_support_os_identity_required/);
  assert.throws(() => invoke({}, { getgid: () => 0 }), /restricted_support_os_identity_required/);
});
