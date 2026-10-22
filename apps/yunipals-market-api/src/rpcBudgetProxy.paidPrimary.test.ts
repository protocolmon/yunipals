import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createRpcBudgetProxy,
  readRpcBudgetProxyEnvironment
} from "@/rpcBudgetProxy";
import {
  RpcComputeBudgetError,
  type RpcComputeBudget
} from "@/opensea/rpcComputeBudget";
import type { UnifiedRpcPolicyGate } from "@/unifiedRpcPolicy";
import {
  unifiedRpcProfileId,
  unifiedRpcProfileHeader,
  unifiedRpcPermitHeader,
  unifiedRpcPaidRange,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

type Call = {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: unknown[];
};
const address = `0x${"ab".repeat(20)}`,
  hash = `0x${"cd".repeat(32)}`,
  permit = `0x${"ef".repeat(32)}`;
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "isolated-paid-primary-test",
  coordinatorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  manifest: {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [
      {
        id: "ownership:bnb",
        feature: "ownership",
        chainId: 56,
        contractName: "Fixture",
        address,
        startBlock: "100",
        endBlock: null,
        enabled: true,
        abiHash: hash,
        events: ["Transfer"],
        receiptRequirement: "full",
        policies: [{ kind: "latest" }]
      }
    ]
  },
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const logs: Call = {
  jsonrpc: "2.0",
  id: 17,
  method: "eth_getLogs",
  params: [{ address, fromBlock: "0x64", toBlock: "0x7d" }]
};
const header: Call = {
  jsonrpc: "2.0",
  id: "header",
  method: "eth_getBlockByNumber",
  params: ["0x64", false]
};
const chain: Call = {
  jsonrpc: "2.0",
  id: 3,
  method: "eth_chainId",
  params: []
};
const servers: ReturnType<typeof createRpcBudgetProxy>[] = [];
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
async function fixture(
  options: {
    enabled?: boolean;
    paidLogs?: boolean;
    expired?: boolean;
    budgetDenied?: boolean;
    budgetDenyAfter?: number;
    paidFailure?: boolean;
    freeFailure?: boolean;
    paidFallback?: boolean;
    ready?: boolean;
  } = {}
) {
  const steps: string[] = [];
  const dispatched: { url: string; body: unknown }[] = [];
  let reservations = 0;
  const budget = (name: string): RpcComputeBudget => ({
    authorizeFreeDispatch: async () => {
      steps.push(`free:${name}`);
    },
    reserve: async (method) => {
      steps.push(`reserve:${name}:${method}`);
      reservations++;
      if (
        options.budgetDenied ||
        (options.budgetDenyAfter !== undefined &&
          reservations > options.budgetDenyAfter)
      )
        throw new RpcComputeBudgetError(1000);
    },
    snapshot: () => ({
      model: "test",
      workload: name,
      priority: "background",
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  });
  const gate: UnifiedRpcPolicyGate = {
    profile,
    chainId: 56,
    ready: async () => {
      steps.push("ready");
      if (options.ready === false) throw new Error("disabled");
    },
    inspect: async () => ({}),
    reservePaid: async (value, calls) => {
      steps.push("permit");
      if (
        value !== permit ||
        options.expired ||
        calls.some((call) => {
          const range = unifiedRpcPaidRange(call);
          return BigInt(range.fromBlock) < 100n || BigInt(range.toBlock) > 200n;
        })
      )
        throw new Error("no bounded permit");
    }
  };
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.invalid/key"),
    freeUpstream: new URL("https://free.invalid"),
    freeLogUpstreams: [new URL("https://logs.invalid")],
    freeMinimumIntervalMs: 0,
    unifiedSourcePaidPrimary: options.enabled,
    unifiedSourcePaidLogs: options.paidLogs,
    sourcePaidFallbackOnFreeFailure: options.paidFallback,
    budget: budget("legacy"),
    workloadBudgets: {
      unified_source: budget("unified_source"),
      unified_evidence: budget("unified_evidence"),
      foreground: budget("foreground"),
      sale: budget("sale"),
      order_projection: budget("order_projection")
    },
    unifiedPolicy: gate,
    fetch: async (url, init) => {
      steps.push("dispatch");
      const body = JSON.parse(Buffer.from(init!.body as Buffer).toString()) as
        | Call
        | Call[];
      dispatched.push({ url: String(url), body });
      assert.equal(
        new Headers(init?.headers).get(unifiedRpcProfileHeader),
        null
      );
      assert.equal(
        new Headers(init?.headers).get(unifiedRpcPermitHeader),
        null
      );
      const reply = (call: Call) => ({
        jsonrpc: "2.0",
        id: call.id,
        result:
          call.method === "eth_getLogs"
            ? []
            : call.method === "eth_chainId"
              ? "0x38"
              : call.method === "eth_blockNumber"
                ? "0x64"
                : { number: "0x64", hash, extra: "exact fixture value" }
      });
      const failed =
        options.paidFailure ||
        (options.freeFailure &&
          !String(url).startsWith("https://paid.invalid/"));
      return new Response(
        JSON.stringify(
          failed
            ? { error: "fixture unavailable" }
            : Array.isArray(body)
              ? body.map(reply)
              : reply(body)
        ),
        {
          status: failed ? 503 : 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });
  servers.push(proxy);
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const bound = proxy.address();
  assert(bound && typeof bound === "object");
  const root = `http://127.0.0.1:${bound.port}`;
  const request = (
    body: unknown = logs,
    workload = "unified_source",
    extra: Record<string, string> = {}
  ) =>
    fetch(root + (workload === "legacy" ? "/" : "/unified"), {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(workload === "legacy"
          ? {}
          : {
              "x-yunipals-rpc-workload": workload,
              [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
            }),
        ...extra
      }
    });
  const delegated = (workload: string) =>
    fetch(root + "/", {
      method: "POST",
      body: JSON.stringify(chain),
      headers: {
        "content-type": "application/json",
        "x-yunipals-rpc-workload": workload
      }
    });
  return {
    steps,
    dispatched,
    request,
    delegated,
    metrics: async () => await (await fetch(root + "/metrics")).json()
  };
}

test("paid-primary configuration is explicit default-off and rejects malformed booleans", () => {
  const env = {
    MARKET_RPC_PROXY_PORT: "19204",
    MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid/key"
  };
  assert.equal(
    readRpcBudgetProxyEnvironment(env).unifiedSourcePaidPrimary,
    false
  );
  for (const value of ["true", "false"])
    assert.equal(
      readRpcBudgetProxyEnvironment({
        ...env,
        MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY: value
      }).unifiedSourcePaidPrimary,
      value === "true"
    );
  for (const value of ["1", "TRUE", "", "false "])
    assert.throws(() =>
      readRpcBudgetProxyEnvironment({
        ...env,
        MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY: value
      })
    );
  assert.throws(() =>
    createRpcBudgetProxy({
      upstream: new URL("https://paid.invalid"),
      budget: {} as RpcComputeBudget,
      unifiedSourcePaidPrimary: true
    })
  );
});

test("default-off retains free-first dispatch even with a valid paid permit", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    200
  );
  assert.deepEqual(f.steps, ["ready", "free:unified_source", "dispatch"]);
  assert.equal(f.dispatched[0]!.url, "https://logs.invalid/");
  assert.equal((await f.metrics()).unified.sourceRouting, "free_first");
});

test("enabled source paid-primary admits and charges every batch call before one exact paid dispatch", async () => {
  const f = await fixture({ enabled: true });
  const batch = [logs, header];
  const result = await f.request(batch, "unified_source", {
    [unifiedRpcPermitHeader]: permit
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "reserve:unified_source:eth_getBlockByNumber",
    "dispatch"
  ]);
  assert.deepEqual(f.dispatched, [
    { url: "https://paid.invalid/key", body: batch }
  ]);
  assert.deepEqual(await result.json(), [
    { jsonrpc: "2.0", id: 17, result: [] },
    {
      jsonrpc: "2.0",
      id: "header",
      result: { number: "0x64", hash, extra: "exact fixture value" }
    }
  ]);
  const metrics = await f.metrics();
  assert.equal(metrics.unified.sourceRouting, "paid_primary");
  assert.deepEqual(metrics.unified.traffic.unified_source, {
    freeCalls: 0,
    paidCalls: 2,
    refused: 0
  });
  assert.equal(metrics.traffic.fallbackBatches, 0);
});

test("missing, wrong, expired or out-of-range permits never dispatch free or paid work", async () => {
  for (const kind of ["missing", "wrong", "expired", "outside"]) {
    const f = await fixture({ enabled: true, expired: kind === "expired" });
    const body =
      kind === "outside"
        ? { ...logs, params: [{ address, fromBlock: "0xc9", toBlock: "0xca" }] }
        : logs;
    const result = await f.request(
      body,
      "unified_source",
      kind === "missing"
        ? {}
        : { [unifiedRpcPermitHeader]: kind === "wrong" ? hash : permit }
    );
    assert.equal(result.status, 403, kind);
    assert.deepEqual(f.steps, ["ready", "permit"], kind);
    assert.equal(f.dispatched.length, 0);
    assert.deepEqual((await f.metrics()).unified.traffic.unified_source, {
      freeCalls: 0,
      paidCalls: 0,
      refused: 1
    });
  }
});

test("disabled profile or invalid mixed batch is rejected before permit and monetary admission", async () => {
  const disabled = await fixture({ enabled: true, ready: false });
  assert.equal((await disabled.request()).status, 502);
  assert.deepEqual(disabled.steps, ["ready"]);
  assert.equal(disabled.dispatched.length, 0);
  for (const [body, expectedStatus] of [
    [
      [
        logs,
        { ...logs, id: 18, params: [{ fromBlock: "0x64", toBlock: "0x7d" }] }
      ],
      400
    ],
    [
      [
        logs,
        { ...chain, id: 19, method: "eth_sendRawTransaction", params: ["0x00"] }
      ],
      502
    ]
  ] as const) {
    const f = await fixture({ enabled: true });
    assert.equal(
      (
        await f.request(body, "unified_source", {
          [unifiedRpcPermitHeader]: permit
        })
      ).status,
      expectedStatus
    );
    assert.deepEqual(f.steps, ["ready"]);
    assert.equal(f.dispatched.length, 0);
  }
  const f = await fixture({ enabled: true });
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcProfileHeader]: hash,
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    403
  );
  assert.deepEqual(f.steps, []);
  assert.equal(f.dispatched.length, 0);
});

test("normal global/allocation budget denial still prevents upstream dispatch after permit admission", async () => {
  const f = await fixture({ enabled: true, budgetDenied: true });
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    429
  );
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs"
  ]);
  assert.equal(f.dispatched.length, 0);
  assert.equal((await f.metrics()).unified.traffic.unified_source.paidCalls, 0);
});

test("the paid-primary switch leaves root, foreground, order, sale and evidence routing unchanged", async () => {
  const f = await fixture({ enabled: true });
  assert.equal((await f.request(chain, "legacy")).status, 200);
  for (const workload of ["foreground", "order_projection", "sale"])
    assert.equal((await f.delegated(workload)).status, 200);
  assert.equal((await f.request(chain, "unified_evidence")).status, 200);
  assert.equal(f.dispatched.length, 5);
  assert.deepEqual(
    f.dispatched.map((row) => row.url),
    [
      "https://free.invalid/",
      "https://free.invalid/",
      "https://free.invalid/",
      "https://logs.invalid/",
      "https://free.invalid/"
    ]
  );
  assert(!f.steps.includes("permit"));
  assert(!f.steps.some((step) => step.startsWith("reserve:")));
  const metrics = await f.metrics();
  assert.deepEqual(metrics.unified.traffic.unified_evidence, {
    freeCalls: 1,
    paidCalls: 0,
    refused: 0
  });
  assert.equal(metrics.unified.traffic.unified_source.paidCalls, 0);
});

test("unbounded source identity/tag/hash/receipt and mixed batches remain free-first", async () => {
  const unbounded = [
    chain,
    { ...chain, method: "eth_blockNumber" },
    { ...header, params: ["latest", false] },
    { ...header, params: ["finalized", false] },
    { ...header, method: "eth_getBlockByHash", params: [hash, false] },
    { ...header, method: "eth_getTransactionReceipt", params: [hash] },
    { ...logs, params: [{ blockHash: hash }] }
  ];
  for (const body of [...unbounded, [logs, { ...chain, id: 18 }]]) {
    const f = await fixture({ enabled: true });
    assert.equal((await f.request(body)).status, 200);
    assert.equal(f.dispatched.length, 1);
    assert.notEqual(f.dispatched[0]!.url, "https://paid.invalid/key");
    assert(!f.steps.includes("permit"));
    assert(!f.steps.some((step) => step.startsWith("reserve:")));
    assert.deepEqual((await f.metrics()).unified.traffic.unified_source, {
      freeCalls: Array.isArray(body) ? body.length : 1,
      paidCalls: 0,
      refused: 0
    });
  }
});

test("free-only mixed-batch failure cannot buy its bounded log companion", async () => {
  const f = await fixture({
    enabled: true,
    freeFailure: true,
    paidFallback: true
  });
  const result = await f.request(
    [logs, { ...chain, id: 18 }],
    "unified_source",
    {
      [unifiedRpcPermitHeader]: permit
    }
  );
  assert.equal(result.status, 403);
  assert.equal(f.dispatched.length, 2);
  assert(f.dispatched.every((row) => row.url !== "https://paid.invalid/key"));
  assert(f.steps.includes("free:unified_source"));
  assert(f.steps.includes("permit"));
  assert(!f.steps.some((step) => step.startsWith("reserve:")));
  assert.equal((await f.metrics()).unified.traffic.unified_source.paidCalls, 0);
});

test("a later batch-call budget denial cannot dispatch its already admitted companion", async () => {
  const f = await fixture({ enabled: true, budgetDenyAfter: 1 });
  const result = await f.request([logs, header], "unified_source", {
    [unifiedRpcPermitHeader]: permit
  });
  assert.equal(result.status, 429);
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "reserve:unified_source:eth_getBlockByNumber"
  ]);
  assert.equal(f.dispatched.length, 0);
  assert.equal((await f.metrics()).unified.traffic.unified_source.paidCalls, 0);
});

test("profile range adaptation remains local and spends no permit or paid budget", async () => {
  const f = await fixture({ enabled: true });
  const result = await f.request(
    { ...logs, params: [{ address, fromBlock: "0x64", toBlock: "0x2bc" }] },
    "unified_source",
    { [unifiedRpcPermitHeader]: permit }
  );
  assert.equal(result.status, 200);
  assert.equal((await result.json()).error.message, "Max range: 500");
  assert.deepEqual(f.steps, ["ready"]);
  assert.equal(f.dispatched.length, 0);
  assert.equal(
    (await f.metrics()).unified.adaptiveRangeRejected.unified_source,
    1
  );
});

test("paid upstream failure is returned without free fallback, retry or additional spending", async () => {
  const f = await fixture({ enabled: true, paidFailure: true });
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    503
  );
  assert.equal(f.dispatched.length, 1);
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "dispatch"
  ]);
  assert.equal((await f.metrics()).unified.traffic.unified_source.paidCalls, 1);
});

test("paid-log routing is default-off, policy-bound and exclusive with paid-primary", () => {
  const env = {
    MARKET_RPC_PROXY_PORT: "19204",
    MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid/key"
  };
  assert.equal(readRpcBudgetProxyEnvironment(env).unifiedSourcePaidLogs, false);
  for (const value of ["true", "false"])
    assert.equal(
      readRpcBudgetProxyEnvironment({
        ...env,
        MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS: value
      }).unifiedSourcePaidLogs,
      value === "true"
    );
  for (const value of ["1", "TRUE", "", "false "])
    assert.throws(() =>
      readRpcBudgetProxyEnvironment({
        ...env,
        MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS: value
      })
    );
  assert.throws(() =>
    readRpcBudgetProxyEnvironment({
      ...env,
      MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS: "true",
      MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY: "true"
    })
  );
  const options = {
    upstream: new URL("https://paid.invalid"),
    budget: {} as RpcComputeBudget,
    unifiedSourcePaidLogs: true
  };
  assert.throws(() => createRpcBudgetProxy(options));
  assert.throws(() =>
    createRpcBudgetProxy({ ...options, unifiedSourcePaidPrimary: true })
  );
});

test("mixed route pays for bounded logs and leaves successful full-block batches free", async () => {
  const f = await fixture({ paidLogs: true });
  const paid = await f.request(logs, "unified_source", {
    [unifiedRpcPermitHeader]: permit
  });
  assert.equal(paid.status, 200);
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "dispatch"
  ]);
  const start = f.steps.length;
  const blocks = [
    { ...header, params: ["0x64", true] },
    { ...header, id: "next", params: ["0x65", true] }
  ];
  assert.equal((await f.request(blocks)).status, 200);
  assert.deepEqual(f.steps.slice(start), [
    "ready",
    "free:unified_source",
    "dispatch"
  ]);
  assert.deepEqual(f.dispatched, [
    { url: "https://paid.invalid/key", body: logs },
    { url: "https://free.invalid/", body: blocks }
  ]);
  const metrics = await f.metrics();
  assert.equal(metrics.unified.sourceRouting, "paid_logs_free_blocks");
  assert.deepEqual(metrics.unified.traffic.unified_source, {
    freeCalls: 2,
    paidCalls: 1,
    refused: 0
  });
});

test("failed free block batch uses one exact paid fallback after permit and every monetary reservation", async () => {
  const f = await fixture({ paidLogs: true, freeFailure: true });
  const blocks = [header, { ...header, id: "next", params: ["0x65", true] }];
  const result = await f.request(blocks, "unified_source", {
    [unifiedRpcPermitHeader]: permit
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.steps, [
    "ready",
    "free:unified_source",
    "dispatch",
    "permit",
    "reserve:unified_source:eth_getBlockByNumber",
    "reserve:unified_source:eth_getBlockByNumber",
    "dispatch"
  ]);
  assert.deepEqual(f.dispatched, [
    { url: "https://free.invalid/", body: blocks },
    { url: "https://paid.invalid/key", body: blocks }
  ]);
  const metrics = await f.metrics();
  assert.equal(metrics.traffic.fallbackBatches, 1);
  assert.deepEqual(metrics.unified.traffic.unified_source, {
    freeCalls: 0,
    paidCalls: 2,
    refused: 0
  });
});

test("mixed-route paid fallback cannot bypass missing, wrong, expired or out-of-range permits", async () => {
  for (const kind of ["missing", "wrong", "expired", "outside"]) {
    const f = await fixture({
      paidLogs: true,
      freeFailure: true,
      expired: kind === "expired"
    });
    const body =
      kind === "outside" ? { ...header, params: ["0xc9", true] } : header;
    const result = await f.request(
      body,
      "unified_source",
      kind === "missing"
        ? {}
        : { [unifiedRpcPermitHeader]: kind === "wrong" ? hash : permit }
    );
    assert.equal(result.status, 403, kind);
    assert.deepEqual(f.steps, [
      "ready",
      "free:unified_source",
      "dispatch",
      "permit"
    ]);
    assert.equal(f.dispatched.length, 1);
    assert.equal(f.dispatched[0]!.url, "https://free.invalid/");
    assert.equal(
      (await f.metrics()).unified.traffic.unified_source.paidCalls,
      0
    );
  }
});

test("mixed-route fallback honors global/workload denial and partial batch reservation failure", async () => {
  for (const denyAfter of [0, 1]) {
    const f = await fixture({
      paidLogs: true,
      freeFailure: true,
      budgetDenyAfter: denyAfter
    });
    const result = await f.request(
      [header, { ...header, id: "next", params: ["0x65", true] }],
      "unified_source",
      { [unifiedRpcPermitHeader]: permit }
    );
    assert.equal(result.status, 429);
    assert.equal(f.steps.filter((step) => step === "permit").length, 1);
    assert.equal(
      f.steps.filter((step) => step.startsWith("reserve:")).length,
      denyAfter + 1
    );
    assert.equal(f.dispatched.length, 1);
    assert.equal(f.dispatched[0]!.url, "https://free.invalid/");
    assert.equal(
      (await f.metrics()).unified.traffic.unified_source.paidCalls,
      0
    );
  }
});

test("mixed route keeps bounded log/block batches intact and validates ranges before spending", async () => {
  const f = await fixture({ paidLogs: true });
  const batch = [logs, header];
  assert.equal(
    (
      await f.request(batch, "unified_source", {
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    200
  );
  assert.deepEqual(f.dispatched, [
    { url: "https://paid.invalid/key", body: batch }
  ]);
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "reserve:unified_source:eth_getBlockByNumber",
    "dispatch"
  ]);
  const range = await fixture({ paidLogs: true });
  const reply = await range.request({
    ...logs,
    params: [{ address, fromBlock: "0x64", toBlock: "0x2bc" }]
  });
  assert.equal(reply.status, 200);
  assert.equal((await reply.json()).error.message, "Max range: 500");
  assert.deepEqual(range.steps, ["ready"]);
  assert.equal(range.dispatched.length, 0);
});

test("mixed route does not add fallback to unbounded source reads or other workloads", async () => {
  const f = await fixture({ paidLogs: true });
  assert.equal((await f.request(chain, "legacy")).status, 200);
  for (const workload of ["foreground", "order_projection", "sale"])
    assert.equal((await f.delegated(workload)).status, 200);
  assert.equal((await f.request(chain, "unified_evidence")).status, 200);
  for (const body of [chain, { ...header, params: ["latest", true] }])
    assert.equal((await f.request(body)).status, 200);
  assert(!f.steps.includes("permit"));
  assert(!f.steps.some((step) => step.startsWith("reserve:")));
  assert(f.dispatched.every((row) => row.url !== "https://paid.invalid/key"));
  const failure = await fixture({ paidLogs: true, freeFailure: true });
  for (const [body, workload] of [
    [header, "legacy"],
    [header, "unified_evidence"],
    [chain, "unified_source"],
    [{ ...header, params: ["latest", true] }, "unified_source"]
  ] as const)
    assert.equal((await failure.request(body, workload)).status, 503);
  assert(!failure.steps.includes("permit"));
  assert(!failure.steps.some((step) => step.startsWith("reserve:")));
});

test("mixed-route paid failure returns once without retrying paid or falling back to free logs", async () => {
  const f = await fixture({ paidLogs: true, paidFailure: true });
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcPermitHeader]: permit
      })
    ).status,
    503
  );
  assert.equal(f.dispatched.length, 1);
  assert.equal(f.dispatched[0]!.url, "https://paid.invalid/key");
  assert.deepEqual(f.steps, [
    "ready",
    "permit",
    "reserve:unified_source:eth_getLogs",
    "dispatch"
  ]);
});
