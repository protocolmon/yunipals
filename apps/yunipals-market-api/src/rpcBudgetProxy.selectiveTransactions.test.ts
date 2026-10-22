import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import type { RpcComputeBudget } from "@/opensea/rpcComputeBudget";
import {
  createRpcBudgetProxy,
  isFreeRpcCall,
  readRpcBudgetProxyEnvironment,
  rpcPrimaryPoolSha256,
  type RpcBudgetProxyOptions
} from "@/rpcBudgetProxy";

import {
  unifiedRpcProfileHeader,
  unifiedRpcProfileId,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

const address = `0x${"ab".repeat(20)}`;
const hash = `0x${"cd".repeat(32)}`;
const urls = [0, 1, 2, 3].map(
  (index) => new URL(`https://primary-${index}.invalid/private-fixture`)
);
const poolSha256 = rpcPrimaryPoolSha256(urls);
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "selective-transactions-test",
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
        contractName: "YunipalsBnb",
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
  limits: { batchCalls: 10, logRange: 10000, addresses: 50, topicValues: 32 }
};
type Call = { jsonrpc: string; id: number; method: string; params: unknown[] };
const transaction: Call = {
  jsonrpc: "2.0",
  id: 1,
  method: "eth_getTransactionByBlockNumberAndIndex",
  params: ["0x64", "0x0"]
};
const last: Call = { ...transaction, id: 2, params: ["0x64", "0x7"] };
const header: Call = {
  jsonrpc: "2.0",
  id: 3,
  method: "eth_getBlockByNumber",
  params: ["0x64", false]
};
const full: Call = { ...header, id: 4, params: ["0x64", true] };
const hashTransaction: Call = {
  jsonrpc: "2.0",
  id: 5,
  method: "eth_getTransactionByHash",
  params: [hash]
};
const logs: Call = {
  jsonrpc: "2.0",
  id: 6,
  method: "eth_getLogs",
  params: [{ address, fromBlock: "0x64", toBlock: "0x65" }]
};
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done())))
  );
});

function reply(body: Call | Call[], result?: (call: Call) => unknown) {
  const item = (call: Call) => ({
    jsonrpc: "2.0",
    id: call.id,
    result: result
      ? result(call)
      : call.method === "eth_getLogs"
        ? []
        : { hash }
  });
  return new Response(
    JSON.stringify(Array.isArray(body) ? body.map(item) : item(body))
  );
}

function configuration() {
  const seen: Array<{ url: string; body: Call | Call[]; at: number }> = [];
  const counts = { authorize: 0, paid: 0, permit: 0 };
  const budget: RpcComputeBudget = {
    authorizeFreeDispatch: async () => {
      counts.authorize++;
    },
    reserve: async () => {
      counts.paid++;
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
  };
  const options: RpcBudgetProxyOptions = {
    upstream: new URL("https://paid.invalid"),
    freeUpstreams: urls,
    freeLogUpstreams: [new URL("https://logs.invalid")],
    freeMinimumIntervalMs: 0,
    budget,
    workloadBudgets: { unified_source: budget, unified_evidence: budget },
    unifiedPolicy: {
      profile,
      chainId: 56,
      ready: async () => {},
      inspect: async () => ({}),
      reservePaid: async () => {
        counts.permit++;
      }
    },
    bnbSelectivePrimaryIndices: [0],
    bnbSelectivePoolSha256: poolSha256,
    bnbSelectiveTransactionPrimaryIndices: [1, 2],
    fetch: async (input, init) => {
      const body = JSON.parse(Buffer.from(init!.body as Buffer).toString()) as
        | Call
        | Call[];
      seen.push({ url: String(input), body, at: Date.now() });
      return reply(body);
    }
  };
  return { options, seen, counts };
}

async function fixture(change?: (options: RpcBudgetProxyOptions) => void) {
  const f = configuration();
  change?.(f.options);
  const proxy = createRpcBudgetProxy(f.options);
  servers.push(proxy);
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  const bound = proxy.address();
  assert.ok(bound && typeof bound === "object");
  const url = `http://127.0.0.1:${bound.port}`;
  return {
    ...f,
    request: (
      body: unknown,
      workload = "unified_source",
      extra: Record<string, string> = {}
    ) =>
      fetch(url + (workload === "legacy" ? "/" : "/unified"), {
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
      }),
    metrics: async () => (await fetch(url + "/metrics")).json()
  };
}

test("transaction-only batches rotate within their explicit pool without changing header metrics", async () => {
  const f = await fixture();
  const before = (await f.metrics()).unified.selective;
  for (const calls of [[transaction, last], transaction, [transaction, last]])
    assert.equal((await f.request(calls)).status, 200);
  assert.deepEqual(
    f.seen.map((row) => row.url),
    [urls[1]!.href, urls[2]!.href, urls[1]!.href]
  );
  assert.deepEqual(
    f.seen.map((row) => row.body),
    [[transaction, last], transaction, [transaction, last]]
  );
  const metrics = await f.metrics();
  assert.deepEqual(metrics.unified.selective, before);
  assert.deepEqual(metrics.unified.selectiveTransactions, {
    primaryIndices: [1, 2],
    poolSha256,
    preferred: 1,
    endpoints: [
      { primaryIndex: 1, coolingDown: false, failures: 0, successes: 2 },
      { primaryIndex: 2, coolingDown: false, failures: 0, successes: 1 }
    ]
  });
  assert.equal(metrics.unified.traffic.unified_source.freeCalls, 5);
  assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
  assert.ok(!JSON.stringify(metrics).includes("private-fixture"));
});

test("headers and mixed batches stay intact on the header-qualified pool", async () => {
  const f = await fixture();
  const batches = [
    header,
    [transaction, header],
    [transaction, full],
    [logs, transaction],
    [transaction, hashTransaction],
    [logs, full, header, transaction]
  ];
  for (const calls of batches)
    assert.equal((await f.request(calls)).status, 200);
  assert.deepEqual(
    f.seen.map(({ url, body }) => ({ url, body })),
    batches.map((body) => ({ url: urls[0]!.href, body }))
  );
  const metrics = await f.metrics();
  assert.equal(
    metrics.unified.selective.endpoints[0].successes,
    batches.length
  );
  assert.ok(
    metrics.unified.selectiveTransactions.endpoints.every(
      (row: { successes: number }) => row.successes === 0
    )
  );
});

test("null or absent indexed transactions retry only another qualified transaction endpoint", async () => {
  for (const missing of [null, undefined]) {
    const dispatched: string[] = [];
    const f = await fixture((options) => {
      options.fetch = async (input, init) => {
        dispatched.push(String(input));
        const body = JSON.parse(
          Buffer.from(init!.body as Buffer).toString()
        ) as Call[];
        return reply(body, (call) =>
          String(input) === urls[1]!.href && call.id === last.id
            ? missing
            : { hash }
        );
      };
    });
    const response = await f.request([transaction, last]);
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).map((row: { result: unknown }) => row.result),
      [{ hash }, { hash }]
    );
    assert.deepEqual(dispatched, [urls[1]!.href, urls[2]!.href]);
    const metrics = await f.metrics();
    assert.equal(
      metrics.unified.selectiveTransactions.endpoints[0].successes,
      0
    );
    assert.equal(
      metrics.unified.selectiveTransactions.endpoints[0].failures,
      1
    );
    assert.equal(metrics.unified.traffic.unified_source.freeCalls, 2);
    assert.deepEqual(f.counts, { authorize: 1, paid: 0, permit: 0 });
  }
});

test("exhausted transaction endpoints never use the header, unqualified, or paid pools", async () => {
  for (const status of [200, 503]) {
    const dispatched: string[] = [];
    const f = await fixture((options) => {
      options.paidFallbackOnFreeFailure = true;
      options.sourcePaidFallbackOnFreeFailure = true;
      options.unifiedSourcePaidPrimary = true;
      options.fetch = async (input, init) => {
        dispatched.push(String(input));
        return status === 200
          ? reply(
              JSON.parse(Buffer.from(init!.body as Buffer).toString()),
              () => null
            )
          : new Response("{}", { status });
      };
    });
    // Existing exhausted-free semantics retain the failed upstream response.
    assert.equal((await f.request([transaction, last])).status, status);
    assert.deepEqual(dispatched, [urls[1]!.href, urls[2]!.href]);
    assert.deepEqual(f.counts, { authorize: 1, paid: 0, permit: 0 });
    const metrics = await f.metrics();
    assert.equal(metrics.traffic.freeOnlyFailures, 1);
    assert.equal(metrics.unified.traffic.unified_source.freeCalls, 0);
  }
});

test("disabled transaction option preserves original selective route and metrics shape", async () => {
  const f = await fixture((options) => {
    delete options.bnbSelectiveTransactionPrimaryIndices;
  });
  assert.equal((await f.request([transaction, last])).status, 200);
  assert.deepEqual(
    f.seen.map((row) => row.url),
    [urls[0]!.href]
  );
  const metrics = await f.metrics();
  assert.equal(metrics.unified.selectiveTransactions, undefined);
  assert.deepEqual(Object.keys(metrics.unified.selective).sort(), [
    "endpoints",
    "poolSha256",
    "preferred",
    "primaryIndices"
  ]);
});

test("legacy and evidence indexed reads retain their existing ordinary pools", async () => {
  const f = await fixture();
  assert.equal((await f.request(transaction, "legacy")).status, 200);
  assert.equal((await f.request(transaction, "unified_evidence")).status, 200);
  assert.deepEqual(
    f.seen.map((row) => row.url),
    [urls[0]!.href, urls[0]!.href]
  );
  assert.ok(
    (await f.metrics()).unified.selectiveTransactions.endpoints.every(
      (row: { successes: number }) => row.successes === 0
    )
  );
});

test("transaction and header routes share ordinary unified source pacing and endpoint counters", async () => {
  const f = await fixture((options) => {
    options.bnbSelectiveTransactionPrimaryIndices = [0];
    options.freeSourceMinimumIntervalMs = 160;
  });
  assert.equal((await f.request(full)).status, 200);
  const responses = await Promise.all([
    f.request(transaction),
    f.request(header)
  ]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(f.seen.length, 3);
  assert.ok(f.seen.every((row) => row.url === urls[0]!.href));
  for (let i = 1; i < f.seen.length; i++)
    assert.ok(
      f.seen[i]!.at - f.seen[i - 1]!.at >= 120,
      "routes must share the same dispatch reservations"
    );
  const metrics = await f.metrics();
  assert.equal(metrics.unified.selective.endpoints[0].successes, 3);
  assert.equal(metrics.unified.selectiveTransactions.endpoints[0].successes, 3);
  assert.ok(metrics.traffic.freePacingWaitMs >= 120);
  assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
});

test("transaction failure cooldown is shared with the same header endpoint", async () => {
  const dispatched: string[] = [];
  const f = await fixture((options) => {
    options.bnbSelectiveTransactionPrimaryIndices = [0, 1];
    options.freeRateLimitCooldownMs = 5000;
    options.fetch = async (input, init) => {
      dispatched.push(String(input));
      return String(input) === urls[0]!.href
        ? new Response("{}", { status: 429 })
        : reply(JSON.parse(Buffer.from(init!.body as Buffer).toString()));
    };
  });
  assert.equal((await f.request(transaction)).status, 200);
  assert.equal((await f.request(header)).status, 502);
  assert.deepEqual(dispatched, [urls[0]!.href, urls[1]!.href]);
  const metrics = await f.metrics();
  assert.equal(metrics.unified.selective.endpoints[0].coolingDown, true);
  assert.deepEqual(
    metrics.unified.selective.endpoints[0],
    metrics.unified.selectiveTransactions.endpoints[0]
  );
  assert.equal(f.counts.paid, 0);
});

test("transaction pool cannot bypass method parameters, profile, or batch limits", async () => {
  const f = await fixture();
  for (const params of [
    ["latest", "0x0"],
    ["0x064", "0x0"],
    ["0x64", "0x00"],
    ["0x64", "0x80000000"],
    ["0x64", 0],
    ["0x64", "0x0", true]
  ]) {
    const call = { ...transaction, params };
    assert.equal(isFreeRpcCall(call, undefined), false);
    assert.equal((await f.request(call)).status, 400);
  }
  assert.equal(
    (
      await f.request(transaction, "unified_source", {
        [unifiedRpcProfileHeader]: "0x" + "00".repeat(32)
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.request(
        Array.from({ length: 11 }, (_, id) => ({ ...transaction, id }))
      )
    ).status,
    400
  );
  assert.deepEqual(f.counts, { authorize: 0, paid: 0, permit: 0 });
  assert.equal(f.seen.length, 0);
});

test("transaction indices require the same valid BNB selective configuration and ordered pool", () => {
  const changes: Array<(options: RpcBudgetProxyOptions) => void> = [
    (o) => {
      delete o.bnbSelectivePrimaryIndices;
      delete o.bnbSelectivePoolSha256;
    },
    (o) => {
      delete o.bnbSelectivePrimaryIndices;
    },
    (o) => {
      delete o.bnbSelectivePoolSha256;
    },
    (o) => {
      delete o.unifiedPolicy;
    },
    (o) => {
      o.unifiedPolicy!.chainId = 8453;
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [];
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [1, 1];
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [-1];
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [4];
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [1.5];
    },
    (o) => {
      o.bnbSelectiveTransactionPrimaryIndices = [Number.MAX_SAFE_INTEGER + 1];
    },
    (o) => {
      o.freeUpstreams = [...urls].reverse();
    },
    (o) => {
      o.bnbSelectivePoolSha256 = "0".repeat(64);
    }
  ];
  for (const change of changes) {
    const { options } = configuration();
    change(options);
    assert.throws(() => createRpcBudgetProxy(options), /Invalid BNB selective/);
  }
});

test("optional transaction pool environment is strict and absent by default", () => {
  const env = {
    MARKET_RPC_PROXY_PORT: "19204",
    MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
    MARKET_RPC_PROXY_FREE_UPSTREAM: urls[0]!.href,
    MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS: urls
      .slice(1)
      .map((url) => url.href)
      .join(","),
    MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES: "0",
    MARKET_RPC_PROXY_BNB_SELECTIVE_POOL_SHA256: poolSha256
  };
  assert.equal(
    readRpcBudgetProxyEnvironment(env).bnbSelectiveTransactionPrimaryIndices,
    undefined
  );
  for (const value of ["", "01", " 1", "1,", "-1", "1.1", "1, 2"])
    assert.throws(
      () =>
        readRpcBudgetProxyEnvironment({
          ...env,
          MARKET_RPC_PROXY_BNB_SELECTIVE_TRANSACTION_PRIMARY_INDICES: value
        }),
      /Invalid BNB selective/
    );
  assert.deepEqual(
    readRpcBudgetProxyEnvironment({
      ...env,
      MARKET_RPC_PROXY_BNB_SELECTIVE_TRANSACTION_PRIMARY_INDICES: "1,2"
    }).bnbSelectiveTransactionPrimaryIndices,
    [1, 2]
  );
});

test("selective header pacing is absent by default and accepts only the reviewed intervals", () => {
  const env = {
    MARKET_RPC_PROXY_PORT: "19204",
    MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid"
  };
  assert.equal(
    readRpcBudgetProxyEnvironment(env).bnbSelectiveHeaderMinimumIntervalMs,
    undefined
  );
  for (const interval of ["200", "400"])
    assert.equal(
      readRpcBudgetProxyEnvironment({
        ...env,
        MARKET_RPC_PROXY_BNB_SELECTIVE_HEADER_MINIMUM_INTERVAL_MS: interval
      }).bnbSelectiveHeaderMinimumIntervalMs,
      Number(interval)
    );
  for (const interval of ["", "0", "199", "201", "401", "0200", " 200", "200.0"])
    assert.throws(
      () =>
        readRpcBudgetProxyEnvironment({
          ...env,
          MARKET_RPC_PROXY_BNB_SELECTIVE_HEADER_MINIMUM_INTERVAL_MS: interval
        }),
      /Invalid BNB selective header pacing/
    );
  const unqualified = configuration().options;
  delete unqualified.bnbSelectivePrimaryIndices;
  delete unqualified.bnbSelectivePoolSha256;
  unqualified.bnbSelectiveHeaderMinimumIntervalMs = 200;
  assert.throws(
    () => createRpcBudgetProxy(unqualified),
    /Invalid BNB selective/
  );
  const wrongChain = configuration().options;
  wrongChain.unifiedPolicy!.chainId = 8453;
  wrongChain.bnbSelectiveHeaderMinimumIntervalMs = 200;
  assert.throws(() => createRpcBudgetProxy(wrongChain), /Invalid BNB selective/);
  const invalid = configuration().options;
  invalid.bnbSelectiveHeaderMinimumIntervalMs = 0 as 200;
  assert.throws(
    () => createRpcBudgetProxy(invalid),
    /Invalid BNB selective header pacing/
  );
});

test("numeric header batches reserve the explicit 200ms pace; disabled keeps 400ms", async () => {
  for (const enabled of [false, true]) {
    const f = await fixture((options) => {
      options.freeSourceMinimumIntervalMs = 400;
      if (enabled) options.bnbSelectiveHeaderMinimumIntervalMs = 200;
    });
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        f.request([header, { ...header, id: 9 }])
      )
    );
    assert.ok(responses.every((response) => response.status === 200));
    const metrics = await f.metrics();
    // Three concurrent reservations accumulate interval + 2*interval. This
    // checks scheduling itself, without an upper bound on network completion.
    assert.ok(metrics.traffic.freePacingWaitMs >= (enabled ? 450 : 1050));
    assert.ok(metrics.traffic.freePacingWaitMs <= (enabled ? 650 : 1250));
    assert.equal(
      metrics.bnbSelectiveHeaderMinimumIntervalMs,
      enabled ? 200 : undefined
    );
    assert.equal(metrics.freeSourceMinimumIntervalMs, 400);
    assert.equal(f.seen.length, 3);
    assert.ok(f.seen.every((row) => row.url === urls[0]!.href));
    assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
  }
});

test("faster header pacing does not change transaction, mixed, full, log, tag, evidence or legacy requests", async () => {
  for (const [body, workload] of [
    [transaction, "unified_source"],
    [[header, transaction], "unified_source"],
    [full, "unified_source"],
    [logs, "unified_source"],
    [{ ...header, params: ["latest", false] }, "unified_source"],
    [header, "unified_evidence"],
    [header, "legacy"]
  ] as const) {
    const f = await fixture((options) => {
      options.bnbSelectiveHeaderMinimumIntervalMs = 200;
      options.freeSourceMinimumIntervalMs = 400;
      options.freeOrderMinimumIntervalMs = 400;
      options.bnbSelectiveTransactionPrimaryIndices = [0];
      options.freeUpstreams = [urls[0]!];
      options.freeLogUpstreams = [urls[0]!];
      options.bnbSelectivePoolSha256 = rpcPrimaryPoolSha256(
        options.freeUpstreams
      );
    });
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => f.request(body, workload))
    );
    assert.ok(responses.every((response) => response.status === 200));
    const metrics = await f.metrics();
    assert.ok(metrics.traffic.freePacingWaitMs >= 1050, String(workload));
    assert.ok(metrics.traffic.freePacingWaitMs <= 1250, String(workload));
    assert.deepEqual(f.counts, { authorize: 3, paid: 0, permit: 0 });
  }
});

test("header trial retains shared reservations, rate-limit cooldown and no paid fallback", async () => {
  const f = await fixture((options) => {
    options.freeSourceMinimumIntervalMs = 400;
    options.bnbSelectiveHeaderMinimumIntervalMs = 200;
    options.bnbSelectiveTransactionPrimaryIndices = [0];
    options.paidFallbackOnFreeFailure = true;
    options.sourcePaidFallbackOnFreeFailure = true;
  });
  assert.equal((await f.request(full)).status, 200);
  assert.equal((await f.request(header)).status, 200);
  assert.ok(
    f.seen[1]!.at - f.seen[0]!.at >= 350,
    "header preserves the prior full-block reservation"
  );
  const rejected = await fixture((options) => {
    options.bnbSelectiveHeaderMinimumIntervalMs = 200;
    options.paidFallbackOnFreeFailure = true;
    options.sourcePaidFallbackOnFreeFailure = true;
    options.freeRateLimitCooldownMs = 5000;
    options.fetch = async () => new Response("rate limited", { status: 429 });
  });
  assert.equal((await rejected.request(header)).status, 429);
  assert.equal((await rejected.request(header)).status, 502);
  const metrics = await rejected.metrics();
  assert.equal(metrics.unified.selective.endpoints[0].failures, 1);
  assert.equal(metrics.unified.selective.endpoints[0].coolingDown, true);
  assert.equal(metrics.traffic.freeCircuitOpenBatches, 1);
  assert.equal(rejected.counts.paid, 0);
  assert.equal(rejected.counts.permit, 0);
});

test("actual CLI bootstrap forwards optional transaction configuration to the running proxy", async () => {
  const source = readFileSync(
    new URL("./rpcBudgetProxy.ts", import.meta.url),
    "utf8"
  );
  const parsed = ts.createSourceFile(
    "rpcBudgetProxy.ts",
    source,
    ts.ScriptTarget.ES2022,
    true
  );
  const main = parsed.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "main"
  );
  assert.ok(main);
  const executable = ts.transpileModule(`${main.getText(parsed)}\nmain();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  for (const enabled of [false, true]) {
    const f = configuration();
    const env = {
      MARKET_RPC_PROXY_PORT: "19204",
      MARKET_RPC_PROXY_UPSTREAM: "https://paid.invalid",
      MARKET_RPC_PROXY_FREE_UPSTREAM: urls[0]!.href,
      MARKET_RPC_PROXY_FREE_FAILOVER_UPSTREAMS: urls
        .slice(1)
        .map((url) => url.href)
        .join(","),
      MARKET_RPC_PROXY_BNB_SELECTIVE_PRIMARY_INDICES: "0",
      MARKET_RPC_PROXY_BNB_SELECTIVE_POOL_SHA256: poolSha256,
      ...(enabled
        ? { MARKET_RPC_PROXY_BNB_SELECTIVE_TRANSACTION_PRIMARY_INDICES: "1,2" }
        : {})
    };
    const signals = new EventEmitter();
    let closed = false;
    let proxy: ReturnType<typeof createRpcBudgetProxy> | undefined;
    let ready!: () => void;
    const listening = new Promise<void>((resolve) => {
      ready = resolve;
    });
    // Execute the actual main body and environment parser with only database,
    // upstream responses and process signals substituted. Use an ephemeral
    // local port; startup, HTTP policy/metrics and routing stay real.
    const running = runInNewContext(executable, {
      readRpcBudgetProxyEnvironment: () => ({
        ...readRpcBudgetProxyEnvironment({
          ...env,
          ...(enabled
            ? { MARKET_RPC_PROXY_BNB_SELECTIVE_HEADER_MINIMUM_INTERVAL_MS: "200" }
            : {})
        }),
        port: 0
      }),
      createOpenSeaRequestBudget: () => ({
        pool: {},
        scope: profile.scope,
        rpcBudget: () => f.options.budget,
        close: async () => {
          closed = true;
        }
      }),
      readUnifiedRpcPolicyEnvironment: () => ({ profile, chainId: 56 }),
      createUnifiedRpcPolicyGate: () => f.options.unifiedPolicy,
      createRpcBudgetProxy: (options: RpcBudgetProxyOptions) => {
        proxy = createRpcBudgetProxy({
          ...options,
          fetch: f.options.fetch,
          freeMinimumIntervalMs: 0
        });
        return proxy;
      },
      process: signals,
      console: { log: ready }
    }) as Promise<void>;
    try {
      await Promise.race([listening, running]);
      assert.ok(proxy);
      const bound = proxy.address();
      assert.ok(bound && typeof bound === "object");
      const url = `http://127.0.0.1:${bound.port}`;
      const response = await fetch(url + "/unified", {
        method: "POST",
        body: JSON.stringify([transaction, last]),
        headers: {
          "content-type": "application/json",
          "x-yunipals-rpc-workload": "unified_source",
          [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
        }
      });
      assert.equal(response.status, 200);
      const metrics = await (await fetch(url + "/metrics")).json();
      assert.equal(
        metrics.bnbSelectiveHeaderMinimumIntervalMs,
        enabled ? 200 : undefined
      );
      assert.deepEqual(
        metrics.unified.selectiveTransactions?.primaryIndices,
        enabled ? [1, 2] : undefined
      );
      assert.deepEqual(
        f.seen.map((row) => row.url),
        [urls[enabled ? 1 : 0]!.href]
      );
      assert.deepEqual(f.counts, { authorize: 1, paid: 0, permit: 0 });
    } finally {
      signals.emit("SIGTERM");
      await running;
    }
    assert.equal(closed, true);
  }
});
