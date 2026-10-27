import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRpcBudgetProxy } from "@/rpcBudgetProxy";
import type { RpcComputeBudget } from "@/opensea/rpcComputeBudget";
import type { UnifiedRpcPolicyGate } from "@/unifiedRpcPolicy";
import {
  unifiedRpcProfileHeader,
  unifiedRpcProfileId,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

type Call = {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: unknown[];
};
type Reply = {
  status?: number;
  body?: unknown;
  response?: Response;
  error?: Error;
};
const address = `0x${"ab".repeat(20)}`,
  hash = `0x${"cd".repeat(32)}`;
const logCall: Call = {
  jsonrpc: "2.0",
  id: 17,
  method: "eth_getLogs",
  params: [{ address, fromBlock: "0x64", toBlock: "0x61b" }]
};
const header: Call = {
  jsonrpc: "2.0",
  id: "header",
  method: "eth_getBlockByNumber",
  params: ["0x64", false]
};
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "isolated-unified-range-fixture",
  coordinatorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  manifest: {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [
      {
        id: "ownership:base",
        feature: "ownership",
        chainId: 8453,
        contractName: "YunipalsBase",
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
function rangeError(call: Call = logCall, maximum = 1000) {
  return {
    jsonrpc: "2.0",
    id: call.id,
    error: {
      code: -32602,
      message: "invalid params",
      data: `Block range too large for public access: maximum ${maximum} blocks. Try with this block range [0x64, 0x44c], or use an access key for larger ranges.`
    }
  };
}
const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done())))
  );
});
async function fixture(
  replies: Reply[] = [
    { status: 500, body: { error: "first rejected" } },
    { body: rangeError() }
  ],
  options: {
    paidFallback?: boolean;
    paidPrimary?: boolean;
    paidLogs?: boolean;
    maximum?: number;
  } = {}
) {
  const seen: Array<{ url: string; calls: Call | Call[] }> = [];
  const counts = { authorize: 0, reserve: 0, permit: 0 };
  const selected: UnifiedRpcProfile = {
    ...profile,
    limits: { ...profile.limits, logRange: options.maximum ?? 10000 }
  };
  const budget: RpcComputeBudget = {
    authorizeFreeDispatch: async () => {
      counts.authorize++;
    },
    reserve: async () => {
      counts.reserve++;
    },
    snapshot: () => ({
      model: "fixture",
      workload: "source",
      priority: "background",
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const gate: UnifiedRpcPolicyGate = {
    profile: selected,
    chainId: 8453,
    ready: async () => {},
    inspect: async () => ({}),
    reservePaid: async () => {
      counts.permit++;
    }
  };
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.invalid"),
    freeUpstream: new URL("https://primary.invalid"),
    freeLogUpstreams: [
      new URL("https://first.invalid"),
      new URL("https://second.invalid")
    ],
    freeMinimumIntervalMs: 0,
    unifiedSourcePaidPrimary: options.paidPrimary ?? false,
    unifiedSourcePaidLogs: options.paidLogs ?? false,
    sourcePaidFallbackOnFreeFailure: options.paidFallback ?? false,
    budget,
    workloadBudgets: { unified_source: budget, unified_evidence: budget },
    unifiedPolicy: gate,
    fetch: async (input, init) => {
      seen.push({
        url: String(input),
        calls: JSON.parse(Buffer.from(init!.body as Buffer).toString()) as
          | Call
          | Call[]
      });
      const next = replies.shift() ?? {
        status: 503,
        body: { error: "unexpected extra dispatch" }
      };
      if (next.error) throw next.error;
      if (next.response) return next.response;
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  servers.push(proxy);
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  const bound = proxy.address();
  assert.ok(bound && typeof bound === "object");
  const url = new URL(`http://127.0.0.1:${bound.port}`);
  const request = (body: unknown = logCall, workload = "unified_source") =>
    fetch(new URL(workload === "legacy" ? "/" : "/unified", url), {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(workload === "legacy"
          ? {}
          : {
              "x-yunipals-rpc-workload": workload,
              [unifiedRpcProfileHeader]: unifiedRpcProfileId(selected)
            })
      }
    });
  const metrics = async () =>
    await (await fetch(new URL("/metrics", url))).json();
  return { seen, counts, request, metrics };
}

test("confirmed source log range response takes priority over earlier500 and never buys fallback", async () => {
  const f = await fixture(undefined, { paidFallback: true });
  const reply = await f.request();
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), {
    ...rangeError(),
    error: { ...rangeError().error, code: -32005, message: "Max range: 1000" }
  });
  assert.equal(f.seen.length, 2);
  assert.deepEqual(
    f.seen.map((row) => row.url),
    ["https://first.invalid/", "https://second.invalid/"]
  );
  assert.deepEqual(f.counts, { authorize: 1, reserve: 0, permit: 0 });
  const metrics = await f.metrics();
  assert.deepEqual(metrics.unified.traffic.unified_source, {
    freeCalls: 0,
    paidCalls: 0,
    refused: 0
  });
  assert.equal(metrics.unified.adaptiveRangeRejected.unified_source, 0);
});

test("mixed partial-success batch preserves exact IDs, order, successful values and error data", async () => {
  const short: Call = {
    ...logCall,
    id: 18,
    params: [{ address, fromBlock: "0x64", toBlock: "0x70" }]
  };
  const success = {
    jsonrpc: "2.0",
    id: short.id,
    result: [{ opaque: "0x00123", nested: [false, { untouched: "é" }] }]
  };
  const block = {
    jsonrpc: "2.0",
    id: header.id,
    result: { number: "0x64", hash }
  };
  const upstream = [success, rangeError(), block];
  const original = JSON.stringify(upstream);
  const f = await fixture([{ body: upstream }]);
  const response = await f.request([header, logCall, short]);
  const result = await response.json();
  assert.deepEqual(
    result.map((row: { id: unknown }) => row.id),
    [18, 17, "header"]
  );
  assert.deepEqual(result[0], success);
  assert.deepEqual(result[2], block);
  assert.equal(
    JSON.stringify(result[0].result),
    JSON.stringify(success.result)
  );
  assert.equal(result[1].error.data, rangeError().error.data);
  assert.equal(result[1].error.message, "Max range: 1000");
  assert.equal(JSON.stringify(upstream), original);
  assert.equal(f.seen.length, 1);
});

test("canonical profile rejection is separately counted and sends zero upstream requests", async () => {
  const f = await fixture();
  const oversized = {
    ...logCall,
    params: [{ address, fromBlock: "0x64", toBlock: "0x2774" }]
  };
  const result = await (await f.request(oversized)).json();
  assert.equal(result.error.code, -32005);
  assert.equal(result.error.message, "Max range: 10000");
  assert.equal(f.seen.length, 0);
  assert.deepEqual(f.counts, { authorize: 0, reserve: 0, permit: 0 });
  const metrics = await f.metrics();
  assert.equal(metrics.unified.adaptiveRangeRejected.unified_source, 1);
  assert.equal(metrics.unified.traffic.unified_source.refused, 0);
});

test("oversized malformed address/topic/wildcard/later call cannot hide behind adaptive counter", async () => {
  const f = await fixture();
  const oversized = { address, fromBlock: "0x64", toBlock: "0x2774" };
  const cases = [
    [
      {
        ...logCall,
        params: [{ ...oversized, address: `0x${"ef".repeat(20)}` }]
      }
    ],
    [
      {
        ...logCall,
        params: [{ fromBlock: oversized.fromBlock, toBlock: oversized.toBlock }]
      }
    ],
    [{ ...logCall, params: [{ ...oversized, topics: ["bad"] }] }],
    [{ ...logCall, params: [{ ...oversized, unknown: true }] }],
    [
      { ...logCall, params: [oversized] },
      { ...header, method: "eth_getBlockReceipts", params: [hash] }
    ]
  ];
  for (const calls of cases) {
    const response = await f.request(calls);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32602);
  }
  const metrics = await f.metrics();
  assert.equal(metrics.unified.traffic.unified_source.refused, cases.length);
  assert.equal(metrics.unified.adaptiveRangeRejected.unified_source, 0);
  assert.equal(f.seen.length, 0);
});

test("profile maximum1 retains previous nonadaptive refusal rather than zero-width native sync", async () => {
  const f = await fixture([], { maximum: 1 });
  const response = await f.request(logCall);
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).error.message,
    "eth_getLogs is limited to 1 blocks"
  );
  const metrics = await f.metrics();
  assert.equal(metrics.unified.traffic.unified_source.refused, 1);
  assert.equal(metrics.unified.adaptiveRangeRejected.unified_source, 0);
  assert.equal(f.seen.length, 0);
});

test("unknown error, result-count limit and unconfirmed or nonsensical numeric hints retain previous rejection", async () => {
  for (const error of [
    { ...rangeError().error, data: "query returned more than 1000 results" },
    { ...rangeError().error, data: "maximum 1000 bytes" },
    { ...rangeError().error, message: "other invalid params" },
    { ...rangeError().error, code: -32005 },
    rangeError(logCall, 1).error,
    rangeError(logCall, 2000).error,
    rangeError(logCall, 10001).error
  ]) {
    const f = await fixture([
      { status: 500, body: { error: "first rejected" } },
      { body: { ...rangeError(), error } }
    ]);
    const response = await f.request();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "first rejected" });
  }
});

test("malformed batch envelope IDs and success method shapes never become an adaptive acceptance", async () => {
  for (const body of [
    [rangeError(), rangeError()],
    [
      { ...rangeError(), id: true },
      { jsonrpc: "2.0", id: header.id, result: {} }
    ],
    [
      { ...rangeError(), id: 999 },
      { jsonrpc: "2.0", id: header.id, result: {} }
    ],
    [rangeError(), { jsonrpc: "2.0", id: header.id, result: null }],
    [
      rangeError(),
      {
        jsonrpc: "2.0",
        id: header.id,
        error: { code: -32602, message: "unknown" }
      }
    ],
    [rangeError()],
    { ...rangeError() }
  ]) {
    const f = await fixture([
      { status: 500, body: { error: "first rejected" } },
      { body }
    ]);
    const response = await f.request([logCall, header]);
    assert.equal(response.status, 500);
  }
  const second: Call = {
    ...logCall,
    id: 18,
    params: [{ address, fromBlock: "0x64", toBlock: "0x70" }]
  };
  const f = await fixture([
    { status: 500, body: {} },
    { body: [rangeError(), { jsonrpc: "2.0", id: 18, result: {} }] }
  ]);
  assert.equal((await f.request([logCall, second])).status, 500);
});

test("one-element batch retains array shape and source-only behavior does not alter legacy", async () => {
  const f = await fixture([{ body: [rangeError()] }]);
  const result = await (await f.request([logCall])).json();
  assert.ok(Array.isArray(result));
  assert.equal(result[0].error.message, "Max range: 1000");
  const legacy = await fixture([
    { status: 500, body: {} },
    { body: rangeError() }
  ]);
  const recent = {
    ...logCall,
    params: [{ address, fromBlock: "latest", toBlock: "latest" }]
  };
  assert.equal((await legacy.request(recent, "legacy")).status, 500);
});

test("unified evidence retains refusal counter and does not use source adaptive transport", async () => {
  const f = await fixture();
  const oversized = {
    ...logCall,
    params: [{ address, fromBlock: "0x64", toBlock: "0x2774" }]
  };
  assert.equal((await f.request(oversized, "unified_evidence")).status, 200);
  const metrics = await f.metrics();
  assert.equal(metrics.unified.traffic.unified_evidence.refused, 1);
  assert.equal(metrics.unified.adaptiveRangeRejected.unified_evidence, 0);
  assert.equal(f.seen.length, 0);
});

async function installedLogRetryHelper() {
  const ponderPackage = realpathSync(
    fileURLToPath(
      new URL(
        "../../yunipals-indexer/node_modules/ponder/package.json",
        import.meta.url
      )
    )
  );
  assert.equal(
    JSON.parse(readFileSync(ponderPackage, "utf8")).version,
    "0.17.5"
  );
  const require = createRequire(ponderPackage);
  const utilsEntry = require.resolve("@ponder/utils");
  assert.equal(
    JSON.parse(
      readFileSync(
        new URL("../package.json", pathToFileURL(utilsEntry)),
        "utf8"
      )
    ).version,
    "0.3.0"
  );
  const module = (await import(pathToFileURL(utilsEntry).href)) as {
    getLogsRetryHelper(input: unknown): {
      shouldRetry: boolean;
      ranges?: Array<{ fromBlock: string; toBlock: string }>;
    };
  };
  return module;
}

test("known paid response-header byte cap returns matching singleton source hints usable by installed Ponder", async () => {
  const module = await installedLogRetryHelper();
  for (const [count, batch] of [
    [4, false],
    [3355, true]
  ] as const) {
    const from = 100n,
      to = from + BigInt(count) - 1n;
    const call: Call = {
      ...logCall,
      id: "sized-log",
      params: [{ address, fromBlock: "0x64", toBlock: `0x${to.toString(16)}` }]
    };
    const f = await fixture(
      [
        {
          response: new Response("", {
            headers: { "content-length": String(32 * 1024 * 1024 + 1) }
          })
        }
      ],
      { paidPrimary: count === 4, paidLogs: count === 3355 }
    );
    const response = await f.request(batch ? [call] : call);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(Array.isArray(body), batch);
    const reply = batch ? body[0] : body;
    assert.deepEqual(reply, {
      jsonrpc: "2.0",
      id: call.id,
      error: {
        code: -32005,
        message: `Max range: ${Math.ceil(count / 2)}`,
        data: {
          maximumResponseBytes: 32 * 1024 * 1024,
          maximumBlockRange: Math.ceil(count / 2)
        }
      }
    });
    const retry = module.getLogsRetryHelper({
      params: call.params,
      error: reply.error
    });
    assert.equal(retry.shouldRetry, true);
    assert.ok(retry.ranges);
    let cursor = from;
    for (const range of retry.ranges) {
      assert.equal(BigInt(range.fromBlock), cursor);
      assert.ok(
        BigInt(range.toBlock) - cursor + 1n <= BigInt(Math.ceil(count / 2))
      );
      cursor = BigInt(range.toBlock) + 1n;
    }
    assert.equal(cursor, to + 1n);
    assert.ok(
      BigInt(retry.ranges[0]!.toBlock) > BigInt(retry.ranges[0]!.fromBlock)
    );
    assert.equal(f.seen.length, 1);
    assert.deepEqual(f.counts, { authorize: 0, reserve: 1, permit: 1 });
    const metrics = await f.metrics();
    assert.equal(metrics.traffic.paidCalls, 1);
    assert.equal(metrics.unified.traffic.unified_source.refused, 0);
  }
});

test("known free payload byte cap returns a hint without provider rotation or paid fallback", async () => {
  const f = await fixture(
    [{ response: new Response("x".repeat(32 * 1024 * 1024 + 1)) }],
    { paidFallback: true }
  );
  const response = await f.request();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, logCall.id);
  assert.equal(body.error.message, "Max range: 732");
  assert.equal(f.seen.length, 1);
  assert.deepEqual(f.counts, { authorize: 1, reserve: 0, permit: 0 });
  const metrics = await f.metrics();
  assert.equal(metrics.traffic.freeFailures, 1);
  assert.equal(metrics.traffic.fallbackBatches, 0);
  assert.equal(metrics.traffic.paidCalls, 0);
});

test("one through three blocks and multi-call source batches retain fail-closed size behavior", async () => {
  for (const body of [
    ...[1, 2, 3].map((count) => ({
      ...logCall,
      params: [
        {
          address,
          fromBlock: "0x64",
          toBlock: `0x${(99 + count).toString(16)}`
        }
      ]
    })),
    [logCall, { ...logCall, id: 18 }]
  ]) {
    const f = await fixture(
      [
        {
          response: new Response("", {
            headers: { "content-length": String(32 * 1024 * 1024 + 1) }
          })
        }
      ],
      { paidPrimary: true }
    );
    const response = await f.request(body);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "rpc_proxy_failed" });
    assert.equal(f.seen.length, 1);
  }
});

test("other methods, workloads and lookalike errors never become response-size hints", async () => {
  const tooLarge = () =>
    new Response("", {
      headers: { "content-length": String(32 * 1024 * 1024 + 1) }
    });
  for (const [body, workload] of [
    [header, "unified_source"],
    [logCall, "unified_evidence"],
    [logCall, "legacy"]
  ] as const) {
    const f = await fixture(
      [
        { response: tooLarge() },
        { response: tooLarge() },
        { response: tooLarge() }
      ],
      { paidPrimary: true }
    );
    const response = await f.request(body, workload);
    assert.equal(response.status, 502);
    assert.equal(
      JSON.stringify(await response.json()).includes("Max range"),
      false
    );
  }
  for (const reply of [
    { error: new Error("response_too_large") },
    { status: 502, body: { error: "response_too_large" } }
  ]) {
    const f = await fixture([reply], { paidPrimary: true });
    const response = await f.request();
    assert.equal(response.status, 502);
    assert.equal(
      JSON.stringify(await response.json()).includes("Max range"),
      false
    );
  }
});

test("actual installed Ponder utility uses canonical hints with inclusive complete bounded chunks", async () => {
  const module = await installedLogRetryHelper();
  for (const [count, maximum] of [
    [1464, 1000],
    [10001, 10000],
    [13, 2]
  ]) {
    const from = 22270050n,
      to = from + BigInt(count!) - 1n;
    const result = module.getLogsRetryHelper({
      params: [
        { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }
      ],
      error: { code: -32005, message: `Max range: ${maximum}` }
    });
    assert.equal(result.shouldRetry, true);
    assert.ok(result.ranges);
    let cursor = from;
    for (const range of result.ranges) {
      const start = BigInt(range.fromBlock),
        end = BigInt(range.toBlock);
      assert.equal(start, cursor);
      assert.ok(end >= start);
      assert.ok(end - start + 1n <= BigInt(maximum!));
      cursor = end + 1n;
    }
    assert.equal(cursor, to + 1n);
    // Native historical sync stores first chunk's end-start, not its count.
    assert.ok(
      BigInt(result.ranges[0]!.toBlock) - BigInt(result.ranges[0]!.fromBlock) >
        0n
    );
  }
});
