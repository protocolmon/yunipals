import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  createRpcBudgetProxy,
  isFreeRpcCall,
  isRpcBudgetProxyMain,
  readRpcBudgetProxyEnvironment
} from "@/rpcBudgetProxy";
import { RpcComputeBudgetError } from "@/opensea/rpcComputeBudget";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
});

async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return new URL(`http://127.0.0.1:${address.port}`);
}

test("the proxy charges every batch call before one exact upstream dispatch", async () => {
  let dispatched = 0;
  const upstream = await listen(
    createServer(async (request, output) => {
      dispatched++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      output.setHeader("content-type", "application/json");
      output.end(Buffer.concat(chunks));
    })
  );
  const methods: string[] = [];
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve(method) {
          methods.push(method);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const payload = [
    { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
    { jsonrpc: "2.0", id: 2, method: "eth_getLogs", params: [{}] }
  ];
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), payload);
  assert.deepEqual(methods, ["eth_blockNumber", "eth_getLogs"]);
  assert.equal(dispatched, 1);
});

test("delegated workers use their own workload policy and accounting", async () => {
  let dispatched = 0;
  const upstream = await listen(
    createServer((_request, output) => {
      dispatched++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    })
  );
  const sourceReservations: string[] = [];
  const saleReservations: string[] = [];
  const foregroundReservations: string[] = [];
  const snapshot = (
    workload: string,
    priority: "background" | "foreground" = "background"
  ) => ({
    model: "test",
    workload,
    priority,
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream,
      freeUpstream: upstream,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve(method) {
          sourceReservations.push(method);
        },
        snapshot: () => snapshot("source")
      },
      workloadBudgets: {
        sale: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            saleReservations.push(method);
          },
          snapshot: () => snapshot("sale")
        },
        foreground: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            foregroundReservations.push(method);
          },
          snapshot: () => snapshot("foreground", "foreground")
        }
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "sale"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_feeHistory",
      params: ["0x1", "latest", []]
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(sourceReservations, []);
  assert.deepEqual(saleReservations, ["eth_feeHistory"]);
  assert.equal(dispatched, 1);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.traffic.workloads.sale.paidCalls, 1);
  assert.equal(metrics.traffic.workloads.source.paidCalls, 0);

  const foreground = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "foreground"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(foreground.status, 200);
  assert.deepEqual(foregroundReservations, []);
  assert.equal(dispatched, 2);
  assert.equal(
    (await (await fetch(new URL("/metrics", proxy))).json()).traffic.workloads
      .foreground.freeCalls,
    1
  );
});

test("budget denial and signing methods never reach the upstream", async () => {
  let dispatched = 0;
  const upstream = await listen(
    createServer((_request, output) => {
      dispatched++;
      output.end("{}");
    })
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream,
      budget: {
        async authorizeFreeDispatch() {
          throw new RpcComputeBudgetError(12000);
        },
        async reserve() {
          throw new RpcComputeBudgetError(12000);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 1
        })
      }
    })
  );
  const denied = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call" })
  });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "12");
  const signing = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_sendRawTransaction"
    })
  });
  assert.equal(signing.status, 502);
  assert.equal(dispatched, 0);
});

test("production configuration binds loopback and requires an HTTPS upstream", () => {
  assert.deepEqual(
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://example.invalid/private"
    }),
    {
      host: "127.0.0.1",
      port: 19101,
      upstream: new URL("https://example.invalid/private"),
      freeUpstream: undefined,
      freeLogUpstream: undefined,
      freeUpstreams: [],
      freeLogUpstreams: [],
      freeOrderUpstreams: [],
      freeRecentBlocks: 4096n,
      freeRequestTimeoutMs: 10000,
      freeOrderRequestTimeoutMs: 3000,
      freeOrderMinimumIntervalMs: 1000,
      maximumConcurrentUpstreamRequests: 8,
      paidFallbackOnFreeFailure: false,
      foregroundPaidFallbackOnFreeFailure: false,
      orderPaidFallbackOnFreeFailure: false,
      sourcePaidFallbackOnFreeFailure: false,
      salePaidFallbackOnFreeFailure: false
    }
  );
  assert.deepEqual(
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid/private",
      MARKET_RPC_PROXY_FREE_UPSTREAM: "https://free.invalid/rpc",
      MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS:
        "https://free-backup.invalid/rpc",
      MARKET_RPC_PROXY_FREE_LOG_UPSTREAM: "https://logs.invalid/rpc",
      MARKET_RPC_PROXY_FREE_LOG_FAILOVER_UPSTREAMS:
        "https://logs-backup.invalid/rpc",
      MARKET_RPC_PROXY_FREE_ORDER_UPSTREAMS:
        "https://orders.invalid/rpc,https://orders-backup.invalid/rpc",
      MARKET_RPC_PROXY_FREE_ORDER_MINIMUM_INTERVAL_MS: "500",
      MARKET_RPC_PROXY_FREE_RECENT_BLOCKS: "2048"
    }),
    {
      host: "127.0.0.1",
      port: 19101,
      upstream: new URL("https://paid.invalid/private"),
      freeUpstream: new URL("https://free.invalid/rpc"),
      freeLogUpstream: new URL("https://logs.invalid/rpc"),
      freeUpstreams: [
        new URL("https://free.invalid/rpc"),
        new URL("https://free-backup.invalid/rpc")
      ],
      freeLogUpstreams: [
        new URL("https://logs.invalid/rpc"),
        new URL("https://logs-backup.invalid/rpc")
      ],
      freeOrderUpstreams: [
        new URL("https://orders.invalid/rpc"),
        new URL("https://orders-backup.invalid/rpc")
      ],
      freeRecentBlocks: 2048n,
      freeRequestTimeoutMs: 10000,
      freeOrderRequestTimeoutMs: 3000,
      freeOrderMinimumIntervalMs: 500,
      maximumConcurrentUpstreamRequests: 8,
      paidFallbackOnFreeFailure: false,
      foregroundPaidFallbackOnFreeFailure: false,
      orderPaidFallbackOnFreeFailure: false,
      sourcePaidFallbackOnFreeFailure: false,
      salePaidFallbackOnFreeFailure: false
    }
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_HOST: "0.0.0.0",
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://example.invalid"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_LOG_UPSTREAM: "https://logs.invalid"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://example.invalid/?apiKey=secret"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_UPSTREAM: "https://free.invalid/?key=secret"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_ORDER_UPSTREAMS:
        "https://orders.invalid,https://orders.invalid"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_ORDER_MINIMUM_INTERVAL_MS: "2001"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_TIMEOUT_MS: "999"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_TIMEOUT_MS: "2000",
      MARKET_RPC_PROXY_FREE_ORDER_TIMEOUT_MS: "3000"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_UPSTREAM: "https://free.invalid",
      MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS: "https://free.invalid"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_MAX_IN_FLIGHT: "65"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_PAID_FALLBACK_ON_FREE_FAILURE: "yes"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FOREGROUND_PAID_FALLBACK_ON_FREE_FAILURE: "yes"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_ORDER_PAID_FALLBACK_ON_FREE_FAILURE: "yes"
    })
  );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      MARKET_RPC_PROXY_PORT: "19101",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_SOURCE_PAID_FALLBACK_ON_FREE_FAILURE: "yes"
    })
  );
});

test("order projection uses an independent free endpoint pool", async () => {
  let sourceDispatches = 0;
  let orderDispatches = 0;
  let paidDispatches = 0;
  const endpoint = async (
    request: IncomingMessage,
    output: ServerResponse,
    result: string
  ) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    output.setHeader("content-type", "application/json");
    output.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
  };
  const source = await listen(
    createServer(async (request, output) => {
      sourceDispatches++;
      await endpoint(request, output, "0x1");
    })
  );
  const order = await listen(
    createServer(async (request, output) => {
      orderDispatches++;
      await endpoint(request, output, "0x2");
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const budget = {
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload: "source",
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: [source],
      freeOrderUpstreams: [order],
      freeMinimumIntervalMs: 0,
      budget,
      workloadBudgets: { order_projection: budget }
    })
  );
  const body = (id: number) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "eth_blockNumber",
      params: []
    });
  const sourceResult = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body(1)
  });
  const orderResult = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "order_projection"
    },
    body: body(2)
  });
  assert.deepEqual(await sourceResult.json(), {
    jsonrpc: "2.0",
    id: 1,
    result: "0x1"
  });
  assert.deepEqual(await orderResult.json(), {
    jsonrpc: "2.0",
    id: 2,
    result: "0x2"
  });
  assert.equal(sourceDispatches, 1);
  assert.equal(orderDispatches, 1);
  assert.equal(paidDispatches, 0);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.dedicatedFreeOrderRouting, true);
  assert.equal(metrics.freeEndpoints.primary[0].successes, 1);
  assert.equal(metrics.freeEndpoints.orderProjection[0].successes, 1);
});

test("block identity and bounded recent state calls qualify for free routing", () => {
  assert.equal(
    isFreeRpcCall({ method: "eth_blockNumber", params: [] }, undefined),
    true
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_getBlockByNumber", params: ["latest", false] },
      undefined
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_getBlockByNumber", params: ["0x270f", false] },
      10_000n
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_getBlockByNumber", params: ["0x1", false] },
      10_000n
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_call", params: [{ to: "0x1234" }, "latest"] },
      10_000n
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_getCode", params: ["0x1234", "0x270f"] },
      10_000n
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      {
        method: "eth_call",
        params: [
          { to: "0x1234" },
          { blockHash: `0x${"ab".repeat(32)}`, requireCanonical: true }
        ]
      },
      10_000n
    ),
    true
  );
  assert.equal(
    isFreeRpcCall(
      {
        method: "eth_call",
        params: [
          { to: "0x1234" },
          { blockHash: `0x${"ab".repeat(32)}`, requireCanonical: false }
        ]
      },
      10_000n
    ),
    false
  );
  assert.equal(
    isFreeRpcCall(
      { method: "eth_call", params: [{ to: "0x1234" }, "0x1"] },
      10_000n
    ),
    false
  );
  assert.equal(
    isFreeRpcCall({ method: "eth_call", params: [] }, 10_000n),
    false
  );
});

test("source, order projection and sale replay keep independent free routing state", async () => {
  let primaryDispatches = 0;
  let saleDispatches = 0;
  let paidDispatches = 0;
  const endpoint = (counter: () => void) =>
    createServer(async (request, output) => {
      counter();
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { id } = JSON.parse(Buffer.concat(chunks).toString());
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
    });
  const primary = await listen(
    endpoint(() => {
      primaryDispatches++;
    })
  );
  const sale = await listen(
    endpoint(() => {
      saleDispatches++;
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const budget = (workload: "source" | "order_projection" | "sale") => ({
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload,
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: [primary],
      freeLogUpstreams: [sale],
      freeMinimumIntervalMs: 0,
      budget: budget("source"),
      workloadBudgets: {
        order_projection: budget("order_projection"),
        sale: budget("sale")
      }
    })
  );
  const request = (id: number, workload?: "order_projection" | "sale") =>
    fetch(proxy, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(workload ? { "x-yunipals-rpc-workload": workload } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "eth_blockNumber",
        params: []
      })
    });
  assert.equal((await request(1)).status, 200);
  assert.equal((await request(2, "order_projection")).status, 200);
  assert.equal((await request(3, "sale")).status, 200);
  assert.equal(primaryDispatches, 2);
  assert.equal(saleDispatches, 1);
  assert.equal(paidDispatches, 0);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeEndpoints.primary[0].successes, 1);
  assert.equal(metrics.freeEndpoints.orderProjection[0].successes, 1);
  assert.equal(metrics.freeEndpoints.saleReplay[0].successes, 1);
  assert.equal(metrics.traffic.workloads.source.freeCalls, 1);
  assert.equal(metrics.traffic.workloads.order_projection.freeCalls, 1);
  assert.equal(metrics.traffic.workloads.sale.freeCalls, 1);
});

test("current reads use the free endpoint behind a non-consuming policy gate", async () => {
  let freeDispatches = 0;
  let paidDispatches = 0;
  let userAgent: string | undefined;
  const free = await listen(
    createServer((request, output) => {
      freeDispatches++;
      userAgent = request.headers["user-agent"];
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2710" }));
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const reserved: string[] = [];
  let freeAuthorizations = 0;
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      budget: {
        async authorizeFreeDispatch() {
          freeAuthorizations++;
        },
        async reserve(method) {
          reserved.push(method);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 1000,
          usedCu: 1,
          remainingCu: 999,
          denied: 0
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 200);
  assert.equal(
    await result.text(),
    '{"jsonrpc":"2.0","id":1,"result":"0x2710"}'
  );
  assert.deepEqual(reserved, []);
  assert.equal(freeAuthorizations, 1);
  assert.equal(freeDispatches, 1);
  assert.equal(paidDispatches, 0);
  assert.equal(userAgent, "Yunipals-RPC-Proxy/1");
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeRouting, true);
  assert.equal(metrics.observedHead, "10000");
  assert.equal(metrics.traffic.freeCalls, 1);
  assert.equal(metrics.traffic.paidCalls, 0);
});

test("a disabled policy blocks free dispatch without consuming or reaching upstream", async () => {
  let freeDispatches = 0;
  let paidDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      freeDispatches++;
      output.end("{}");
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const reserved: string[] = [];
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      budget: {
        async authorizeFreeDispatch() {
          throw new RpcComputeBudgetError(9000);
        },
        async reserve(method) {
          reserved.push(method);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 1
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get("retry-after"), "9");
  assert.equal(freeDispatches, 0);
  assert.equal(paidDispatches, 0);
  assert.deepEqual(reserved, []);
});

test("current log reads use their method-specific public endpoint", async () => {
  let primaryDispatches = 0;
  let logDispatches = 0;
  let paidDispatches = 0;
  const primary = await listen(
    createServer((_request, output) => {
      primaryDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2710" }));
    })
  );
  const logs = await listen(
    createServer((_request, output) => {
      logDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: [] }));
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: primary,
      freeLogUpstream: logs,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const head = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(head.status, 200);
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_getLogs",
      params: [{ fromBlock: "0x270f", toBlock: "0x2710" }]
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { jsonrpc: "2.0", id: 2, result: [] });
  assert.equal(primaryDispatches, 1);
  assert.equal(logDispatches, 1);
  assert.equal(paidDispatches, 0);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeLogRouting, true);
  assert.equal(metrics.traffic.freeCalls, 2);
  assert.deepEqual(metrics.traffic.methods.free, {
    eth_blockNumber: 1,
    eth_getLogs: 1
  });
});

test("a rejected free response falls back through the paid method budget", async () => {
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "temporary public failure" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    })
  );
  const reserved: string[] = [];
  let freeAuthorizations = 0;
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      paidFallbackOnFreeFailure: true,
      budget: {
        async authorizeFreeDispatch() {
          freeAuthorizations++;
        },
        async reserve(method) {
          reserved.push(method);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(reserved, ["eth_blockNumber"]);
  assert.equal(freeAuthorizations, 1);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.traffic.freeFailures, 1);
  assert.equal(metrics.traffic.fallbackBatches, 1);
  assert.equal(metrics.traffic.paidCalls, 1);
});

test("source fallback is separately enabled and remains compute-budgeted", async () => {
  let paidDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "archive unavailable" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }));
    })
  );
  const reserved: string[] = [];
  const delegatedReserved: string[] = [];
  const snapshot = (workload: string) => ({
    model: "test",
    workload,
    priority: "background" as const,
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      sourcePaidFallbackOnFreeFailure: true,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve(method) {
          reserved.push(method);
        },
        snapshot: () => snapshot("source")
      },
      workloadBudgets: {
        sale: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            delegatedReserved.push(method);
          },
          snapshot: () => snapshot("sale")
        }
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }]
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { jsonrpc: "2.0", id: 1, result: [] });
  assert.deepEqual(reserved, ["eth_getLogs"]);
  assert.equal(paidDispatches, 1);
  const delegated = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "sale"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }]
    })
  });
  assert.equal(delegated.status, 200);
  assert.deepEqual(await delegated.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32005, message: "archive unavailable" }
  });
  assert.deepEqual(delegatedReserved, []);
  assert.equal(paidDispatches, 1);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.paidFallbackOnFreeFailure, false);
  assert.equal(metrics.sourcePaidFallbackOnFreeFailure, true);
  assert.equal(metrics.traffic.fallbackBatches, 1);
});

test("foreground fallback cannot spend the background projection budget", async () => {
  let paidDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "rate limited" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    })
  );
  const foregroundReserved: string[] = [];
  const projectionReserved: string[] = [];
  const snapshot = (
    workload: string,
    priority: "background" | "foreground"
  ) => ({
    model: "test",
    workload,
    priority,
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      foregroundPaidFallbackOnFreeFailure: true,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => snapshot("source", "background")
      },
      workloadBudgets: {
        foreground: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            foregroundReserved.push(method);
          },
          snapshot: () => snapshot("foreground", "foreground")
        },
        order_projection: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            projectionReserved.push(method);
          },
          snapshot: () => snapshot("order_projection", "background")
        }
      }
    })
  );
  const invoke = (workload: "foreground" | "order_projection") =>
    fetch(proxy, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yunipals-rpc-workload": workload
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: []
      })
    });
  assert.equal((await invoke("foreground")).status, 200);
  assert.deepEqual(foregroundReserved, ["eth_blockNumber"]);
  assert.equal(paidDispatches, 1);
  assert.equal((await invoke("order_projection")).status, 200);
  assert.deepEqual(projectionReserved, []);
  assert.equal(paidDispatches, 1);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.foregroundPaidFallbackOnFreeFailure, true);
  assert.equal(metrics.traffic.workloads.foreground.paidCalls, 1);
  assert.equal(metrics.traffic.workloads.order_projection.paidCalls, 0);
});

for (const mode of ["enabled", "disabled", "exhausted"] as const)
  test(`a saturated free queue preserves foreground fallback policy: ${mode}`, async () => {
    let freeStarted = 0;
    let releaseFree!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFree = resolve;
    });
    const saturated = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const free = await listen(
      createServer(async (_request, output) => {
        if (++freeStarted === 4) ready();
        await held;
        output.setHeader("content-type", "application/json");
        output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      })
    );
    let paidCalls = 0;
    const paid = await listen(
      createServer((_request, output) => {
        paidCalls++;
        output.setHeader("content-type", "application/json");
        output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
      })
    );
    let reservations = 0;
    const background = {
      async authorizeFreeDispatch() {},
      async reserve() {
        throw new Error("Background budget must not be spent.");
      },
      snapshot: () => ({
        model: "test",
        workload: "order_projection",
        priority: "background" as const,
        grantedCu: 0,
        usedCu: 0,
        remainingCu: 0,
        denied: 0
      })
    };
    const proxy = await listen(
      createRpcBudgetProxy({
        upstream: paid,
        freeUpstream: free,
        freeRequestTimeoutMs: 1000,
        freeMinimumIntervalMs: 0,
        maximumConcurrentUpstreamRequests: 8,
        foregroundPaidFallbackOnFreeFailure: mode !== "disabled",
        budget: background,
        workloadBudgets: {
          order_projection: background,
          foreground: {
            ...background,
            async reserve() {
              reservations++;
              if (mode === "exhausted") throw new RpcComputeBudgetError(1000);
            }
          }
        }
      })
    );
    const invoke = (workload: string) =>
      fetch(proxy, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-yunipals-rpc-workload": workload
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: []
        })
      });
    const blocking = Array.from({ length: 4 }, () =>
      invoke("order_projection")
    );
    try {
      await saturated;
      const [foreground, backgroundResponse] = await Promise.all([
        invoke("foreground"),
        invoke("order_projection")
      ]);
      assert.equal(
        foreground.status,
        mode === "enabled" ? 200 : mode === "exhausted" ? 429 : 503
      );
      assert.equal(backgroundResponse.status, 503);
      assert.equal(paidCalls, mode === "enabled" ? 1 : 0);
      assert.equal(reservations, mode === "disabled" ? 0 : 1);
    } finally {
      releaseFree();
      await Promise.all(blocking);
    }
  });

for (const mode of ["enabled", "disabled", "exhausted"] as const)
  test(`foreground pacing preserves its short freshness window and budget: ${mode}`, async () => {
    let freeCalls = 0,
      paidCalls = 0,
      reserved = 0;
    const respond = (output: ServerResponse) => {
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    };
    const free = await listen(
      createServer((_request, output) => {
        freeCalls++;
        respond(output);
      })
    );
    const paid = await listen(
      createServer((_request, output) => {
        paidCalls++;
        respond(output);
      })
    );
    const background = {
      async authorizeFreeDispatch() {},
      async reserve() {
        throw new Error("No background spend");
      },
      snapshot: () => ({
        model: "test",
        workload: "order_projection",
        priority: "background" as const,
        grantedCu: 0,
        usedCu: 0,
        remainingCu: 0,
        denied: 0
      })
    };
    const proxy = await listen(
      createRpcBudgetProxy({
        upstream: paid,
        freeUpstream: free,
        freeOrderMinimumIntervalMs: 2000,
        foregroundPaidFallbackOnFreeFailure: mode !== "disabled",
        budget: background,
        workloadBudgets: {
          order_projection: background,
          foreground: {
            ...background,
            async reserve() {
              reserved++;
              if (mode === "exhausted") throw new RpcComputeBudgetError(1000);
            }
          }
        }
      })
    );
    const invoke = (workload: string) =>
      fetch(proxy, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-yunipals-rpc-workload": workload
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: []
        })
      });
    assert.equal((await invoke("order_projection")).status, 200);
    assert.equal(
      (await invoke("foreground")).status,
      mode === "exhausted" ? 429 : 200
    );
    assert.equal(freeCalls, mode === "disabled" ? 2 : 1);
    assert.equal(paidCalls, mode === "enabled" ? 1 : 0);
    assert.equal(reserved, mode === "disabled" ? 0 : 1);
  });

test("order fallback is separately enabled and charged to its bounded projection budget", async () => {
  let paidDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "temporary public failure" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    })
  );
  const reserved: string[] = [];
  const snapshot = (workload: string) => ({
    model: "test",
    workload,
    priority: "background" as const,
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      orderPaidFallbackOnFreeFailure: true,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => snapshot("source")
      },
      workloadBudgets: {
        order_projection: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            reserved.push(method);
          },
          snapshot: () => snapshot("order_projection")
        }
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "order_projection"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(reserved, ["eth_blockNumber"]);
  assert.equal(paidDispatches, 1);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.orderPaidFallbackOnFreeFailure, true);
  assert.equal(metrics.traffic.workloads.order_projection.paidCalls, 1);
  assert.equal(metrics.traffic.workloads.source.paidCalls, 0);
});

test("sale fallback is separately enabled and charged only to its bounded workload", async () => {
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: null
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }));
    })
  );
  const sourceReserved: string[] = [];
  const saleReserved: string[] = [];
  const snapshot = (workload: string) => ({
    model: "test",
    workload,
    priority: "background" as const,
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      salePaidFallbackOnFreeFailure: true,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve(method) {
          sourceReserved.push(method);
        },
        snapshot: () => snapshot("source")
      },
      workloadBudgets: {
        sale: {
          async authorizeFreeDispatch() {},
          async reserve(method) {
            saleReserved.push(method);
          },
          snapshot: () => snapshot("sale")
        }
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "sale"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["0x1234", false]
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    jsonrpc: "2.0",
    id: 1,
    result: "0x1"
  });
  assert.deepEqual(sourceReserved, []);
  assert.deepEqual(saleReserved, ["eth_getBlockByNumber"]);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.paidFallbackOnFreeFailure, false);
  assert.equal(metrics.sourcePaidFallbackOnFreeFailure, false);
  assert.equal(metrics.salePaidFallbackOnFreeFailure, true);
  assert.equal(metrics.traffic.fallbackBatches, 1);
  assert.equal(metrics.traffic.paidCalls, 1);
});

test("a rejected free response cannot spend paid RPC by default", async () => {
  let paidDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "rate limited" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const reserved: string[] = [];
  let freeAuthorizations = 0;
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      budget: {
        async authorizeFreeDispatch() {
          freeAuthorizations++;
        },
        async reserve(method) {
          reserved.push(method);
        },
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32005, message: "rate limited" }
  });
  assert.deepEqual(reserved, []);
  assert.equal(freeAuthorizations, 1);
  assert.equal(paidDispatches, 0);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.paidFallbackOnFreeFailure, false);
  assert.equal(metrics.traffic.freeFailures, 1);
  assert.equal(metrics.traffic.freeOnlyFailures, 1);
  assert.equal(metrics.traffic.fallbackBatches, 0);
  assert.equal(metrics.traffic.paidCalls, 0);
});

test("a failed free request returns 502 without reaching paid RPC", async () => {
  let paidDispatches = 0;
  let freeDispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      freeDispatches++;
      output.destroy();
    })
  );
  const paid = await listen(
    createServer((_request, output) => {
      paidDispatches++;
      output.end("{}");
    })
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: "free_rpc_unavailable" });
  const retry = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(retry.status, 502);
  assert.equal(freeDispatches, 2);
  assert.equal(paidDispatches, 0);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.traffic.freeFailures, 2);
  assert.equal(metrics.traffic.freeOnlyFailures, 2);
  assert.equal(metrics.traffic.freeCircuitOpenBatches, 0);
  assert.equal(metrics.traffic.paidCalls, 0);
});

test("an adaptive range response returns without probing equivalent endpoints", async () => {
  let primaryDispatches = 0;
  let failoverDispatches = 0;
  const primary = await listen(
    createServer((_request, output) => {
      primaryDispatches++;
      output.statusCode = 413;
      output.end("range too large");
    })
  );
  const failover = await listen(
    createServer((_request, output) => {
      failoverDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "rate limited" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: [primary, failover],
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "sale",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const result = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }]
    })
  });
  assert.equal(result.status, 413);
  assert.equal(await result.text(), "range too large");
  const retry = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }]
    })
  });
  assert.equal(retry.status, 413);
  assert.equal(primaryDispatches, 2);
  assert.equal(failoverDispatches, 0);
});

test("concurrent source requests are paced across compatible endpoints", async () => {
  const dispatches = [0, 0];
  const free = await Promise.all(
    dispatches.map((_, index) =>
      listen(
        createServer(async (request, output) => {
          dispatches[index] = (dispatches[index] ?? 0) + 1;
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const id = JSON.parse(Buffer.concat(chunks).toString()).id;
          output.setHeader("content-type", "application/json");
          output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
        })
      )
    )
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: free,
      freeMinimumIntervalMs: 500,
      maximumConcurrentUpstreamRequests: 8,
      budget: {
        async authorizeFreeDispatch() {
          await Promise.resolve();
        },
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      fetch(proxy, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index,
          method: "eth_blockNumber",
          params: []
        })
      })
    )
  );
  assert.ok(responses.every((item) => item.status === 200));
  assert.deepEqual(dispatches, [4, 4]);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeSourceMinimumIntervalMs, 500);
  assert.equal(metrics.freeMinimumIntervalMs, 500);
  assert.ok(metrics.traffic.freePacingWaitMs >= 1);
});

test("a bounded source pacing backlog absorbs an indexer block burst", async () => {
  const dispatches = [0, 0];
  const free = await Promise.all(
    dispatches.map((_, index) =>
      listen(
        createServer(async (request, output) => {
          dispatches[index] = (dispatches[index] ?? 0) + 1;
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const id = JSON.parse(Buffer.concat(chunks).toString()).id;
          output.setHeader("content-type", "application/json");
          output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
        })
      )
    )
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: free,
      freeMinimumIntervalMs: 100,
      maximumConcurrentUpstreamRequests: 8,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const responses = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      fetch(proxy, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index,
          method: "eth_getBlockByNumber",
          params: ["latest", true]
        })
      })
    )
  );
  assert.ok(responses.every((item) => item.status === 200));
  assert.deepEqual(dispatches, [25, 25]);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.sourcePacingQueueWaitMs, 8000);
  assert.equal(metrics.traffic.sourcePacingTimeouts, 0);
  assert.equal(metrics.traffic.overloadedBatches, 0);
});

test("order projections retain the preferred state endpoint", async () => {
  const dispatches = [0, 0];
  let active = 0;
  let maximumActive = 0;
  const free = await Promise.all(
    dispatches.map((_, index) =>
      listen(
        createServer(async (request, output) => {
          dispatches[index] = (dispatches[index] ?? 0) + 1;
          active++;
          maximumActive = Math.max(maximumActive, active);
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const id = JSON.parse(Buffer.concat(chunks).toString()).id;
          await new Promise((resolve) => setTimeout(resolve, 20));
          active--;
          output.setHeader("content-type", "application/json");
          output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
        })
      )
    )
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const budget = {
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload: "order_projection",
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: free,
      freeMinimumIntervalMs: 0,
      budget,
      workloadBudgets: { order_projection: budget }
    })
  );
  const responses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      fetch(proxy, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-yunipals-rpc-workload": "order_projection"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index,
          method: "eth_blockNumber",
          params: []
        })
      })
    )
  );
  assert.ok(responses.every((item) => item.status === 200));
  assert.deepEqual(dispatches, [4, 0]);
  assert.equal(maximumActive, 4);
});

test("order projections remember a free failover after a bounded timeout", async () => {
  const dispatches = [0, 0];
  const budget = {
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload: "order_projection",
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: new URL("https://paid.invalid"),
      freeUpstreams: [
        new URL("https://slow-free.invalid"),
        new URL("https://fast-free.invalid")
      ],
      freeRequestTimeoutMs: 10000,
      freeOrderRequestTimeoutMs: 1000,
      freeMinimumIntervalMs: 0,
      budget,
      workloadBudgets: { order_projection: budget },
      fetch: async (input, init) => {
        const endpoint = new URL(String(input)).hostname.startsWith("slow")
          ? 0
          : 1;
        dispatches[endpoint] = (dispatches[endpoint] ?? 0) + 1;
        if (endpoint === 0)
          await new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true }
            );
          });
        assert.ok(Buffer.isBuffer(init?.body));
        const id = JSON.parse(init.body.toString()).id;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id, result: "0x1" }),
          {
            headers: { "content-type": "application/json" }
          }
        );
      }
    })
  );
  const request = (id: number) =>
    fetch(proxy, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-yunipals-rpc-workload": "order_projection"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "eth_blockNumber",
        params: []
      })
    });
  assert.equal((await request(1)).status, 200);
  assert.equal((await request(2)).status, 200);
  assert.deepEqual(dispatches, [1, 2]);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeOrderRequestTimeoutMs, 1000);
  assert.equal(metrics.preferredFreeEndpoints.orderProjection, 1);
  assert.equal(metrics.traffic.workloads.order_projection.paidCalls, 0);
});

test("order projection traffic serializes and retries a brief provider limit", async () => {
  const dispatches = [0, 0];
  let active = 0;
  let maximumActive = 0;
  const free = await Promise.all(
    dispatches.map((_, index) =>
      listen(
        createServer(async (request, output) => {
          dispatches[index] = (dispatches[index] ?? 0) + 1;
          active++;
          maximumActive = Math.max(maximumActive, active);
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const id = JSON.parse(Buffer.concat(chunks).toString()).id;
          await new Promise((resolve) => setTimeout(resolve, 10));
          active--;
          output.setHeader("content-type", "application/json");
          output.end(
            dispatches[index] === 1
              ? JSON.stringify({
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32005, message: "rate limited" }
                })
              : JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" })
          );
        })
      )
    )
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const budget = {
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload: "order_projection",
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: free,
      freeRateLimitCooldownMs: 20,
      maximumConcurrentUpstreamRequests: 1,
      budget,
      workloadBudgets: { order_projection: budget }
    })
  );
  const responses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      fetch(proxy, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-yunipals-rpc-workload": "order_projection"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: index,
          method: "eth_blockNumber",
          params: []
        })
      })
    )
  );
  assert.ok(responses.every((item) => item.status === 200));
  assert.equal(maximumActive, 1);
  assert.equal(dispatches[0]! + dispatches[1]!, 6);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.traffic.queuedOrderRouteBatches, 3);
  assert.equal(metrics.traffic.orderRouteTimeouts, 0);
  assert.equal(metrics.traffic.freeRateLimitRetries, 1);
  assert.ok(metrics.traffic.freeRateLimitWaitMs >= 1);
});

test("a failed free endpoint immediately uses its failover and remains cooled down", async () => {
  let primaryDispatches = 0;
  let failoverDispatches = 0;
  const primary = await listen(
    createServer((_request, output) => {
      primaryDispatches++;
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "rate limited" }
        })
      );
    })
  );
  const failover = await listen(
    createServer(async (request, output) => {
      failoverDispatches++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const id = JSON.parse(Buffer.concat(chunks).toString()).id;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: [primary, failover],
      freeFailureCooldownMs: 1000,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const first = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    jsonrpc: "2.0",
    id: 1,
    result: "0x2710"
  });
  const second = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    jsonrpc: "2.0",
    id: 2,
    result: "0x2710"
  });
  assert.equal(primaryDispatches, 1);
  assert.equal(failoverDispatches, 2);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeEndpoints.primary[0].coolingDown, true);
  assert.equal(metrics.freeEndpoints.primary[0].failures, 1);
  assert.equal(metrics.freeEndpoints.primary[1].successes, 2);
});

test("one transient provider failure does not open the whole route circuit", async () => {
  let dispatches = 0;
  const free = await listen(
    createServer((_request, output) => {
      dispatches++;
      output.statusCode = 503;
      output.end("unavailable");
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const request = (id: number) =>
    fetch(proxy, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "eth_blockNumber",
        params: []
      })
    });
  assert.equal((await request(1)).status, 503);
  assert.equal((await request(2)).status, 503);
  let metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeEndpoints.primary[0].coolingDown, false);
  assert.equal(metrics.freeEndpoints.primary[0].consecutiveFailures, 2);
  assert.equal((await request(3)).status, 503);
  assert.equal((await request(4)).status, 502);
  assert.equal(dispatches, 3);
  metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.freeEndpoints.primary[0].coolingDown, true);
  assert.equal(metrics.freeEndpoints.primary[0].consecutiveFailures, 3);
});

test("log endpoint cooldown does not block current-state traffic on the same URL", async () => {
  let sharedRequests = 0;
  const shared = await listen(
    createServer(async (request, output) => {
      sharedRequests++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify(
          payload.method === "eth_getLogs"
            ? {
                jsonrpc: "2.0",
                id: payload.id,
                error: { code: -32005, message: "rate limited" }
              }
            : { jsonrpc: "2.0", id: payload.id, result: "0x2105" }
        )
      );
    })
  );
  const failingLogs = await listen(
    createServer((_request, output) => {
      output.setHeader("content-type", "application/json");
      output.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32005, message: "rate limited" }
        })
      );
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstreams: [shared],
      freeLogUpstreams: [failingLogs, shared],
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const logs = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{ fromBlock: "latest", toBlock: "latest" }]
    })
  });
  assert.equal(logs.status, 200);
  assert.equal((await logs.json()).error.code, -32005);

  const chain = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_chainId",
      params: []
    })
  });
  assert.equal(chain.status, 200);
  assert.deepEqual(await chain.json(), {
    jsonrpc: "2.0",
    id: 2,
    result: "0x2105"
  });
  assert.equal(sharedRequests, 2);
});

test("upstream concurrency is bounded while local health remains responsive", async () => {
  let started!: () => void;
  let release!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const free = await listen(
    createServer(async (_request, output) => {
      started();
      await blocked;
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2710" }));
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      freeMinimumIntervalMs: 0,
      maximumConcurrentUpstreamRequests: 1,
      budget: {
        async authorizeFreeDispatch() {},
        async reserve() {},
        snapshot: () => ({
          model: "test",
          workload: "source",
          priority: "background",
          grantedCu: 0,
          usedCu: 0,
          remainingCu: 0,
          denied: 0
        })
      }
    })
  );
  const first = fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_blockNumber",
      params: []
    })
  });
  await dispatched;
  const health = await fetch(new URL("/health", proxy));
  assert.equal(health.status, 200);
  const busy = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "eth_blockNumber",
      params: []
    })
  });
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "1");
  assert.deepEqual(await busy.json(), { error: "rpc_proxy_rate_limited" });
  release();
  assert.equal((await first).status, 200);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.maximumObservedUpstreamRequests, 1);
  assert.equal(metrics.traffic.overloadedBatches, 1);
});

test("priority marketplace work waits behind a saturated source slot", async () => {
  let firstStarted!: () => void;
  let releaseFirst!: () => void;
  let requests = 0;
  const dispatched = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const free = await listen(
    createServer(async (request, output) => {
      requests++;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const id = JSON.parse(Buffer.concat(chunks).toString()).id;
      if (requests === 1) {
        firstStarted();
        await blocked;
      }
      output.setHeader("content-type", "application/json");
      output.end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x2710" }));
    })
  );
  const paid = await listen(
    createServer((_request, output) => output.end("{}"))
  );
  const budget = {
    async authorizeFreeDispatch() {},
    async reserve() {},
    snapshot: () => ({
      model: "test",
      workload: "source",
      priority: "background" as const,
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: free,
      freeMinimumIntervalMs: 0,
      maximumConcurrentUpstreamRequests: 1,
      budget,
      workloadBudgets: { order_projection: budget }
    })
  );
  const body = (id: number) =>
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "eth_blockNumber",
      params: []
    });
  const first = fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body(1)
  });
  await dispatched;
  const priority = fetch(proxy, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-yunipals-rpc-workload": "order_projection"
    },
    body: body(2)
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const queuedMetrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(queuedMetrics.activeUpstreamRequests, 1);
  assert.equal(queuedMetrics.queuedPriorityRequests, 1);
  releaseFirst();
  assert.equal((await first).status, 200);
  const priorityResult = await priority;
  assert.equal(priorityResult.status, 200);
  assert.equal((await priorityResult.json()).id, 2);
  const metrics = await (await fetch(new URL("/metrics", proxy))).json();
  assert.equal(metrics.maximumObservedUpstreamRequests, 1);
  assert.equal(metrics.maximumQueuedPriorityRequests, 1);
  assert.equal(metrics.traffic.queuedPriorityBatches, 1);
  assert.equal(metrics.traffic.priorityQueueTimeouts, 0);
  assert.equal(metrics.traffic.overloadedBatches, 0);
});

test("the executable main check follows an immutable-release symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rpc-proxy-main-"));
  try {
    const target = join(directory, "release.mjs");
    const current = join(directory, "current.mjs");
    await writeFile(target, "");
    await symlink(target, current);
    assert.equal(isRpcBudgetProxyMain(current, target), true);
  } finally {
    await rm(directory, { recursive: true });
  }
});
