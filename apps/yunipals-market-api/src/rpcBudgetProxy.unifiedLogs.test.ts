import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import { afterEach, test } from "node:test";
import { createRpcBudgetProxy } from "@/rpcBudgetProxy";
import type { RpcComputeBudget } from "@/opensea/rpcComputeBudget";
import type { UnifiedRpcPolicyGate } from "@/unifiedRpcPolicy";
import {
  unifiedRpcProfileHeader,
  unifiedRpcProfileId,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done())))
  );
});
async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const bound = server.address();
  assert.ok(bound && typeof bound === "object");
  return new URL(`http://127.0.0.1:${bound.port}`);
}
type Call = {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: unknown[];
};
const address = `0x${"ab".repeat(20)}`,
  hash = `0x${"cd".repeat(32)}`;
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "isolated-unified-logs-fixture",
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
  limits: { batchCalls: 10, logRange: 500, addresses: 50, topicValues: 32 }
};
const logs: Call = {
  jsonrpc: "2.0",
  id: 17,
  method: "eth_getLogs",
  params: [{ address, fromBlock: "0x64", toBlock: "0x7d" }]
};
const head: Call = {
  jsonrpc: "2.0",
  id: "header-id",
  method: "eth_getBlockByNumber",
  params: ["0x64", false]
};
const chain: Call = {
  jsonrpc: "2.0",
  id: 5,
  method: "eth_chainId",
  params: []
};
async function fixture(
  options: {
    ready?: boolean;
    dedicatedLogs?: boolean;
    primaryRejectLogs?: boolean;
    logFailures?: number;
    logFailureStatus?: 403 | 413 | 429 | 503;
    sharedLogUrl?: boolean;
    pacingMs?: number;
    logEndpointCount?: number;
    freeRequestTimeoutMs?: number;
    beforeReply?: () => Promise<void>;
  } = {}
) {
  const seen: { pool: string; calls: Call[]; at: number }[] = [];
  const counts = {
    freeAuthorizations: 0,
    paidReservations: 0,
    permitAttempts: 0
  };
  let logFailures = options.logFailures ?? 0;
  const endpoint = (pool: string) =>
    createServer(async (request: IncomingMessage, output: ServerResponse) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as
        | Call
        | Call[];
      const calls = Array.isArray(body) ? body : [body];
      seen.push({ pool, calls, at: Date.now() });
      await options.beforeReply?.();
      assert.equal(request.headers[unifiedRpcProfileHeader], undefined); // proxy strips internal policy headers
      const reject =
        (pool.startsWith("logs") && logFailures-- > 0) ||
        (pool === "primary" &&
          (options.primaryRejectLogs ?? true) &&
          calls.some((call) => call.method === "eth_getLogs"));
      const failureStatus =
        pool.startsWith("logs") ? (options.logFailureStatus ?? 403) : 403;
      output.setHeader("content-type", "application/json");
      const reply = (call: Call) =>
        reject
          ? {
              jsonrpc: "2.0",
              id: call.id,
              error: {
                code: failureStatus === 429 ? 15 : -32602,
                message: "fixture provider rejects logs"
              }
            }
          : {
              jsonrpc: "2.0",
              id: call.id,
              result:
                call.method === "eth_getLogs"
                  ? []
                  : call.method === "eth_chainId"
                    ? "0x2105"
                    : { number: "0x64", hash }
            };
      if (reject) output.statusCode = failureStatus;
      output.end(
        JSON.stringify(
          Array.isArray(body) ? calls.map(reply).reverse() : reply(body)
        )
      );
    });
  const primary = await listen(endpoint("primary")),
    logPool = await listen(endpoint("logs")),
    paid = await listen(endpoint("paid"));
  const logEndpoints = [logPool];
  for (let i = 1; i < (options.logEndpointCount ?? 1); i++) {
    logEndpoints.push(await listen(endpoint(`logs-${i}`)));
  }
  const budget: RpcComputeBudget = {
    authorizeFreeDispatch: async () => {
      counts.freeAuthorizations++;
    },
    reserve: async () => {
      counts.paidReservations++;
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
    profile,
    chainId: 8453,
    ready: async () => {
      if (options.ready === false) throw new Error("fixture policy disabled");
    },
    inspect: async () => ({}),
    reservePaid: async () => {
      counts.permitAttempts++;
      throw new Error("fixture has no paid permit");
    }
  };
  const proxy = await listen(
    createRpcBudgetProxy({
      upstream: paid,
      freeUpstream: primary,
      freeLogUpstreams:
        options.dedicatedLogs === false
          ? []
          : options.sharedLogUrl
            ? [primary, new URL(primary)]
            : logEndpoints,
      freeMinimumIntervalMs: options.pacingMs ?? 0,
      freeRequestTimeoutMs: options.freeRequestTimeoutMs,
      maximumConcurrentUpstreamRequests: 8,
      budget,
      workloadBudgets: { unified_source: budget, unified_evidence: budget },
      unifiedPolicy: gate
    })
  );
  const request = (
    payload: unknown = logs,
    workload = "unified_source",
    extra: Record<string, string> = {}
  ) =>
    fetch(new URL(workload === "legacy" ? "/" : "/unified", proxy), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(workload === "legacy"
          ? {}
          : {
              "x-yunipals-rpc-workload": workload,
              [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
            }),
        ...extra
      },
      body: JSON.stringify(payload)
    });
  const metrics = async () =>
    await (await fetch(new URL("/metrics", proxy))).json();
  return { seen, counts, request, metrics };
}
test("unified source Transfer logs select existing dedicated free log URLs, not the rejecting primary", async () => {
  const f = await fixture();
  const response = await f.request(logs);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: 17,
    result: []
  });
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs"]
  );
  assert.deepEqual(f.seen[0]!.calls, [logs]);
  assert.equal(f.counts.freeAuthorizations, 1);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
  const metrics = await f.metrics();
  assert.deepEqual(metrics.unified.traffic.unified_source, {
    freeCalls: 1,
    paidCalls: 0,
    refused: 0
  });
});
test("mixed validated source logs/header/identity batch stays one exact batch with original IDs on log pool", async () => {
  const f = await fixture();
  const calls = [head, logs, chain];
  const response = await f.request(calls);
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).map((row: Call) => row.id),
    [5, 17, "header-id"]
  );
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0]!.pool, "logs");
  assert.deepEqual(f.seen[0]!.calls, calls);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal((await f.metrics()).unified.traffic.unified_source.freeCalls, 3);
});
test("unified source headers/evidence and legacy routes retain their original primary/log pool choices", async () => {
  const f = await fixture({ primaryRejectLogs: false });
  assert.equal((await f.request([logs, head])).status, 200);
  assert.equal((await f.request(chain)).status, 200);
  assert.equal((await f.request(head, "unified_evidence")).status, 200);
  assert.equal((await f.request(chain, "legacy")).status, 200);
  assert.equal(
    (
      await f.request(
        { ...logs, params: [{ address, blockHash: hash }] },
        "unified_evidence"
      )
    ).status,
    200
  );
  assert.equal(
    (
      await f.request(
        {
          ...logs,
          params: [{ address, fromBlock: "latest", toBlock: "latest" }]
        },
        "legacy"
      )
    ).status,
    200
  );
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary", "primary", "primary", "primary", "logs"]
  );
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
});
test("invalid profile, malformed source/mixed scope, range and batch policy refuse before any provider", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.request(logs, "unified_source", {
        [unifiedRpcProfileHeader]: `0x${"00".repeat(32)}`
      })
    ).status,
    403
  );
  for (const payload of [
    { ...logs, params: [{ fromBlock: "0x64", toBlock: "0x7d" }] },
    [logs, { ...head, method: "eth_getBlockReceipts", params: ["0x64"] }],
    {
      ...logs,
      params: [
        { address: `0x${"ef".repeat(20)}`, fromBlock: "0x64", toBlock: "0x7d" }
      ]
    },
    Array.from({ length: 11 }, (_, id) => ({ ...logs, id }))
  ])
    assert.equal((await f.request(payload)).status, 400);
  const range = await f.request({
    ...logs,
    params: [{ address, fromBlock: "0x64", toBlock: "0xffff" }]
  });
  assert.equal(range.status, 200);
  assert.equal((await range.json()).error.code, -32005);
  assert.equal(f.seen.length, 0);
  assert.equal(f.counts.freeAuthorizations, 0);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
});
test("disabled reviewed profile still blocks configured log pool before authorization or provider work", async () => {
  const f = await fixture({ ready: false });
  assert.equal((await f.request()).status, 502);
  assert.equal(f.seen.length, 0);
  assert.deepEqual(f.counts, {
    freeAuthorizations: 0,
    paidReservations: 0,
    permitAttempts: 0
  });
});
test("failure of all configured free providers retains the original error without paid authority", async () => {
  const f = await fixture({ logFailures: 1 });
  const response = await f.request([logs, head]);
  assert.equal(response.status, 403);
  assert.equal((await response.json())[0].error.code, -32602);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary"]
  );
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
  const metrics = await f.metrics();
  assert.equal(metrics.unified.traffic.unified_source.refused, 0);
  assert.equal(metrics.unified.traffic.unified_source.paidCalls, 0);
  assert.equal(metrics.traffic.freeOnlyFailures, 1);
});
test("empty configured log URL list preserves primary fallback semantics", async () => {
  const f = await fixture({ dedicatedLogs: false, primaryRejectLogs: false });
  assert.equal((await f.request([logs, head])).status, 200);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["primary"]
  );
  assert.equal(f.counts.paidReservations, 0);
});
test("unified source log cooldown is isolated from same-URL legacy logs and evidence/header routes", async () => {
  const f = await fixture({ logFailures: 1 });
  assert.equal((await f.request()).status, 403);
  assert.equal(
    (
      await f.request(
        {
          ...logs,
          params: [{ address, fromBlock: "latest", toBlock: "latest" }]
        },
        "legacy"
      )
    ).status,
    200
  );
  assert.equal((await f.request(chain)).status, 200);
  assert.equal((await f.request(head, "unified_evidence")).status, 200);
  assert.equal((await f.request()).status, 502);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary", "logs", "primary", "primary"]
  );
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
});
test("mixed source log batches retain per-endpoint source pacing", async () => {
  const f = await fixture({ pacingMs: 40 });
  const responses = await Promise.all([
    f.request([logs, head]),
    f.request([logs, head])
  ]);
  assert.deepEqual(
    responses.map((row) => row.status),
    [200, 200]
  );
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "logs"]
  );
  assert.ok(f.seen[1]!.at - f.seen[0]!.at >= 30);
  assert.equal(f.counts.paidReservations, 0);
});

test("concurrent unified logs use available dedicated pacing capacity before primary fallback", async (t) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(release);
  const f = await fixture({
    logEndpointCount: 3,
    pacingMs: 200,
    freeRequestTimeoutMs: 3000,
    beforeReply: () => held
  });
  const pending = Array.from({ length: 18 }, (_, id) =>
    f.request({ ...logs, id })
  );
  for (let attempt = 0; f.counts.freeAuthorizations !== 18; attempt++) {
    assert.ok(attempt < 100, "all local requests should reach admission");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  release();
  const responses = await Promise.all(pending);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(f.seen.length, 18);
  for (const pool of ["logs", "logs-1", "logs-2"]) {
    const calls = f.seen.filter((row) => row.pool === pool);
    assert.equal(calls.length, 6);
    for (let i = 1; i < calls.length; i++) {
      assert.ok(calls[i]!.at - calls[i - 1]!.at >= 150);
    }
  }
  assert.equal(f.seen.some((row) => row.pool === "primary"), false);
  // A completed dedicated cycle must not turn the next request into a primary
  // probe merely because the circular preference advanced past the log group.
  assert.equal((await f.request({ ...logs, id: 99 })).status, 200);
  assert.ok(f.seen.at(-1)!.pool.startsWith("logs"));
  const metrics = await f.metrics();
  assert.equal(metrics.traffic.sourcePacingTimeouts, 0);
  assert.ok(metrics.maximumObservedUpstreamRequests <= 8);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
});

test("rate-limited dedicated logs fall back to an already configured free primary with mixed IDs intact", async () => {
  const f = await fixture({
    logFailures: 1,
    logFailureStatus: 429,
    primaryRejectLogs: false
  });
  const calls = [head, logs, chain];
  const result = await f.request(calls);
  assert.equal(result.status, 200);
  assert.deepEqual(
    (await result.json()).map((call: Call) => call.id),
    [5, 17, "header-id"]
  );
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary"]
  );
  assert.deepEqual(
    f.seen.map((row) => row.calls),
    [calls, calls]
  );
  assert.equal(f.counts.freeAuthorizations, 1);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
  assert.deepEqual((await f.metrics()).unified.traffic.unified_source, {
    freeCalls: 3,
    paidCalls: 0,
    refused: 0
  });
  assert.equal((await f.request(calls)).status, 200);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary", "primary"]
  );
});

test("a duplicate primary/log URL is attempted only once when free providers fail", async () => {
  const f = await fixture({ sharedLogUrl: true });
  assert.equal((await f.request()).status, 403);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["primary"]
  );
  assert.equal((await f.metrics()).traffic.freeFailures, 1);
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
});

test("an oversized dedicated log response remains available to the caller without a wider retry", async () => {
  const f = await fixture({
    logFailures: 1,
    logFailureStatus: 413,
    primaryRejectLogs: false
  });
  assert.equal((await f.request()).status, 413);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs"]
  );
  assert.equal(f.counts.paidReservations, 0);
});

test("rate-limited logs and a rejecting free primary preserve the first provider error without paid authority", async () => {
  const f = await fixture({ logFailures: 1, logFailureStatus: 429 });
  const result = await f.request([logs, head]);
  assert.equal(result.status, 429);
  assert.equal((await result.json())[0].error.code, 15);
  assert.deepEqual(
    f.seen.map((row) => row.pool),
    ["logs", "primary"]
  );
  assert.equal(f.counts.paidReservations, 0);
  assert.equal(f.counts.permitAttempts, 0);
  assert.deepEqual((await f.metrics()).unified.traffic.unified_source, {
    freeCalls: 0,
    paidCalls: 0,
    refused: 0
  });
});
