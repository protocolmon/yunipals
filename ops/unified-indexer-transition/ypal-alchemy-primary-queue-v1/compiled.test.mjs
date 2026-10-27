import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { realpathSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { derive } from "./prepare.mjs";

const here = new URL("./", import.meta.url);
const require = createRequire(new URL("../../../apps/yunipals-market-api/package.json", here));
const candidateURL = new URL("./rpc-budget-proxy.mjs", here).href;
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === candidateURL && specifier === "pg")
      return next(pathToFileURL(require.resolve("pg")).href, context);
    if (context.parentURL === candidateURL && specifier === "viem")
      return next(pathToFileURL(realpathSync(require.resolve("viem")).replace("/_cjs/", "/_esm/")).href, context);
    return next(specifier, context);
  }
});
const actual = await import(candidateURL);
hook.deregister();
const { unifiedRpcProfileId } = await import(
  new URL("../../../packages/yunipals-indexer-server/src/rpc-policy.ts", here)
);

test("actual compiled paid-primary queue reserves only dispatched work", async (t) => {
  const original = readFileSync(new URL("../ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs", here));
  assert.deepEqual(derive(original), readFileSync(new URL("./rpc-budget-proxy.mjs", here)));
  const address = "0x" + "ab".repeat(20), permit = "0x" + "cd".repeat(32);
  const profile = {
    version: 1, model: "alchemy-2026-09-08", scope: "compiled-primary-fixture",
    coordinatorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    manifest: {
      version: 1, ponderVersion: "0.17.5", ordering: "multichain", coverage: "ponder-live-blocks-v1",
      sources: [{ id: "ownership:base", feature: "ownership", chainId: 8453,
        contractName: "YunipalsBase", address, startBlock: "100", endBlock: null,
        enabled: true, abiHash: "0x" + "ef".repeat(32), events: ["Transfer"],
        receiptRequirement: "full", policies: [{ kind: "latest" }] }]
    }, limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
  };
  let unblock;
  const held = new Promise(resolve => { unblock = resolve; });
  t.after(unblock);
  const admitted = [], dispatched = [], charged = [];
  const budget = {
    async authorizeFreeDispatch() { throw Error("unexpected_free_dispatch"); },
    async reserve(method) { charged.push(method); },
    snapshot() { return {}; }
  };
  const server = actual.createRpcBudgetProxy({
    upstream: new URL("https://paid.invalid"), freeUpstream: new URL("https://free.invalid"),
    maximumConcurrentUpstreamRequests: 1, unifiedSourcePaidPrimary: true,
    freeRequestTimeoutMs: 3000, budget, workloadBudgets: { unified_source: budget },
    unifiedPolicy: {
      profile, chainId: 8453, async ready() {}, async inspect() { return {}; },
      async reservePaid(selected, calls) {
        assert.equal(selected, permit);
        admitted.push(...calls.map(c => c.id));
      }
    },
    async fetch(url, options) {
      assert.equal(url.hostname, "paid.invalid");
      const call = JSON.parse(options.body);
      dispatched.push(call.id);
      if (call.id === 0) await held;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: [] }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (id, signal) => fetch(base + "/unified", {
    method: "POST", signal, headers: { "content-type": "application/json",
      "x-yunipals-rpc-workload": "unified_source", "x-yunipals-unified-rpc-profile": unifiedRpcProfileId(profile),
      "x-yunipals-unified-rpc-permit": permit },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "eth_getBlockByNumber", params: ["0x64", false] })
  });
  const metrics = async () => (await fetch(base + "/metrics")).json();
  const until = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("compiled_queue_condition_not_reached");
  };
  const first = request(0);
  await until(() => dispatched.length === 1);
  const second = request(1);
  const abort = new AbortController();
  const cancelled = request(2, abort.signal).catch(error => error);
  await until(async () => (await metrics()).queuedSourceRequests === 2);
  assert.deepEqual(admitted, [0]);
  assert.deepEqual(charged, ["eth_getBlockByNumber"]);
  abort.abort(); await cancelled;
  await until(async () => (await metrics()).queuedSourceRequests === 1);
  assert.deepEqual(admitted, [0]);
  unblock();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  assert.deepEqual(admitted, [0, 1]);
  assert.deepEqual(dispatched, [0, 1]);
  assert.deepEqual(charged, ["eth_getBlockByNumber", "eth_getBlockByNumber"]);
  const end = await metrics();
  assert.equal(end.maximumObservedUpstreamRequests, 1);
  assert.equal(end.queuedSourceBytes, 0);
});
