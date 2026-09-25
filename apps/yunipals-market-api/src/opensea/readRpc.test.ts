import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { test } from "node:test";
import { createPublicClient, zeroAddress, type Hex } from "viem";
import {
  createMeasuredOpenSeaReadRpc,
  isRpcResponseLimitError
} from "@/opensea/readRpc";
import { OpenSeaReadEvidenceCache } from "@/opensea/readEvidenceCache";
import {
  RpcComputeBudgetError,
  rpcComputeBudgetError,
  type RpcComputeBudget
} from "@/opensea/rpcComputeBudget";
import { rpcBudgetProxyUrl } from "@/rpcBudgetProxyRegistry";

test("block-pinned cache misses pass through RPC accounting and hits make no wire request", async () => {
  const wire: { method: string; params: unknown[] }[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as {
        id: number;
        method: string;
        params: unknown[];
      };
      wire.push({ method: rpc.method, params: rpc.params });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          ...(rpc.method === "eth_call" && rpc.params[1] === "latest"
            ? { error: { code: -32000, message: "private-provider-error" } }
            : { result: rpc.method === "eth_chainId" ? "0x1" : "0x6001" })
        })
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      `http://127.0.0.1:${address.port}`
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    const cache = new OpenSeaReadEvidenceCache(client);
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const pinned = cache.at(client, { number: 123n, hash });
    const reads = () =>
      Promise.all([
        pinned.getCode({ address: zeroAddress, blockNumber: 123n }),
        pinned.request({
          method: "eth_call",
          params: [{ to: zeroAddress, data: "0xdeadbeef" }, "0x7b"]
        })
      ]);
    await reads();
    await reads();
    assert.equal(
      wire.length,
      2,
      "Cache hits must not contact the HTTP endpoint"
    );
    for (const request of wire)
      assert.deepEqual(request.params[1], {
        blockHash: hash,
        requireCanonical: true
      });
    await pinned.getChainId();
    await assert.rejects(
      pinned.request({
        method: "eth_call",
        params: [{ data: "0xdeadbeef" }, "latest"]
      })
    );
    const final = measured.snapshot();
    assert.equal(
      final.requests,
      wire.length,
      "Count both pinned misses and uncached pass-through requests"
    );
    assert.equal(final.requests, 4);
    assert.equal(final.failed, 1);
    assert.equal(final.inFlight, 0);
    assert.equal(final.methods.eth_call?.requests, 2);
    assert.equal(final.methods.eth_getCode?.requests, 1);
    assert.equal(final.methods.eth_chainId?.requests, 1);
    assert.equal(cache.snapshot().hits, 2);
    assert.equal(JSON.stringify(final).includes("deadbeef"), false);
    assert.equal(
      JSON.stringify(final).includes("private-provider-error"),
      false
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("RPC measurements match concurrent wire requests and failures without retaining private data", async () => {
  const pending: { response: ServerResponse; id: number; method: string }[] =
    [];
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer((request, response) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as { id: number; method: string };
      pending.push({ response, ...rpc });
      if (pending.length === 3) release();
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      `http://127.0.0.1:${address.port}/private-rpc-key`
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    const completed = Promise.allSettled([
      client.getChainId(),
      client.getBlockNumber(),
      client.request({
        method: "eth_call",
        params: [{ data: "0xdeadbeef" }, "latest"]
      })
    ]);
    await arrived;
    const mid = measured.snapshot();
    assert.equal(mid.inFlight, 3);
    assert.equal(mid.maxInFlight, 3);
    for (const request of pending) {
      request.response.setHeader("content-type", "application/json");
      request.response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          ...(request.method === "eth_call"
            ? { error: { code: -32000, message: "private-provider-error" } }
            : { result: request.method === "eth_chainId" ? "0x1" : "0x10" })
        })
      );
    }
    const results = await completed;
    assert.deepEqual(
      results.map((result) => result.status),
      ["fulfilled", "fulfilled", "rejected"]
    );
    assert.equal(
      pending.length,
      3,
      "The instrumented transport must not add retries"
    );
    const final = measured.snapshot();
    assert.equal(final.requests, pending.length);
    assert.equal(final.failed, 1);
    assert.equal(final.inFlight, 0);
    assert.equal(final.methods.eth_call?.failed, 1);
    assert.deepEqual(final.methods.eth_call?.failures, { rpc_server: 1 });
    assert.deepEqual(mid.methods.eth_call?.failures, {});
    assert.equal(
      mid.methods.eth_call?.failed,
      0,
      "Earlier snapshots are immutable"
    );
    for (const secret of [
      "private-rpc-key",
      "deadbeef",
      "private-provider-error",
      "127.0.0.1"
    ])
      assert.equal(JSON.stringify(final).includes(secret), false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("RPC timeout is counted once and drains the in-flight measurement", async () => {
  let requests = 0;
  const server = createServer(() => {
    requests++;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      `http://127.0.0.1:${address.port}`,
      100
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    await assert.rejects(client.getChainId());
    assert.equal(requests, 1);
    const result = measured.snapshot();
    assert.equal(result.requests, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.inFlight, 0);
    assert.deepEqual(result.methods.eth_chainId?.failures, { timeout: 1 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("RPC failover retries infrastructure failures once, cools down the primary and never retries deterministic execution", async () => {
  let primaryAvailable = false;
  let secondaryReverts = false;
  const counts = { primary: 0, secondary: 0 };
  const rpcServer = (endpoint: keyof typeof counts) =>
    createServer((request, response) => {
      void (async () => {
        counts[endpoint]++;
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const rpc = JSON.parse(body) as { id: number; method: string };
        if (endpoint === "primary" && !primaryAvailable) {
          response.statusCode = 503;
          response.end("unavailable");
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id,
            ...(endpoint === "secondary" && secondaryReverts
              ? { error: { code: 3, message: "execution reverted" } }
              : { result: rpc.method === "eth_chainId" ? "0x1" : "0x" })
          })
        );
      })().catch(() => response.destroy());
    });
  const primary = rpcServer("primary");
  const secondary = rpcServer("secondary");
  primary.listen(0, "127.0.0.1");
  secondary.listen(0, "127.0.0.1");
  await Promise.all([once(primary, "listening"), once(secondary, "listening")]);
  const primaryAddress = primary.address();
  const secondaryAddress = secondary.address();
  assert.ok(primaryAddress && typeof primaryAddress === "object");
  assert.ok(secondaryAddress && typeof secondaryAddress === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      [
        `http://127.0.0.1:${primaryAddress.port}/private-primary`,
        `http://127.0.0.1:${secondaryAddress.port}/private-secondary`
      ],
      1000,
      1000
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    assert.equal(await client.getChainId(), 1);
    assert.equal(await client.getChainId(), 1);
    assert.deepEqual(counts, { primary: 1, secondary: 2 });
    let snapshot = measured.snapshot();
    assert.equal(snapshot.failover.configured, true);
    assert.equal(snapshot.failover.preferredEndpoint, 1);
    assert.equal(snapshot.failover.attempts, 1);
    assert.equal(snapshot.failover.successes, 1);
    assert.deepEqual(snapshot.failover.endpoints, [
      { index: 0, requests: 1, failed: 1 },
      { index: 1, requests: 2, failed: 0 }
    ]);

    secondaryReverts = true;
    await assert.rejects(
      client.request({ method: "eth_call", params: [{ data: "0x" }, "latest"] })
    );
    assert.deepEqual(
      counts,
      { primary: 1, secondary: 3 },
      "A deterministic execution result must not reach the other provider"
    );
    assert.equal(measured.snapshot().failover.attempts, 1);

    secondaryReverts = false;
    primaryAvailable = true;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(await client.getChainId(), 1);
    snapshot = measured.snapshot();
    assert.equal(snapshot.failover.preferredEndpoint, 0);
    assert.deepEqual(counts, { primary: 2, secondary: 3 });
    for (const secret of ["private-primary", "private-secondary", "127.0.0.1"])
      assert.equal(JSON.stringify(snapshot).includes(secret), false);
  } finally {
    primary.closeAllConnections();
    secondary.closeAllConnections();
    await Promise.all([
      new Promise<void>((resolve) => primary.close(() => resolve())),
      new Promise<void>((resolve) => secondary.close(() => resolve()))
    ]);
  }
});

test("RPC compute is reserved before every endpoint attempt and exhaustion prevents failover wire traffic", async () => {
  let requests = 0;
  const reserved: string[] = [];
  const server = createServer((_request, response) => {
    requests++;
    response.statusCode = 503;
    response.end("unavailable");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const budget: RpcComputeBudget = {
    async authorizeFreeDispatch() {},
    async reserve(method) {
      reserved.push(method);
      if (reserved.length === 2) throw new RpcComputeBudgetError(1000);
    },
    snapshot() {
      return {
        model: "test",
        workload: "order_projection",
        priority: "background",
        grantedCu: 10,
        usedCu: 10,
        remainingCu: 0,
        denied: 1
      };
    }
  };
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const measured = createMeasuredOpenSeaReadRpc(
      [`${origin}/primary`, `${origin}/failover`],
      1000,
      1000,
      budget
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    await assert.rejects(
      client.getBlockNumber(),
      (error: unknown) => rpcComputeBudgetError(error)?.retryAfterMs === 1000
    );
    assert.deepEqual(reserved, ["eth_blockNumber", "eth_blockNumber"]);
    assert.equal(requests, 1);
    assert.equal(measured.snapshot().requests, 1);
    assert.equal(measured.snapshot().computeUnits, 10);
    assert.equal(measured.snapshot().budget?.denied, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the production loopback proxy owns delegated and source compute accounting", async () => {
  let requests = 0;
  let workload: string | undefined;
  let requestedWorkload = "foreground";
  const batchSizes: number[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      requests++;
      workload = request.headers["x-yunipals-rpc-workload"] as
        | string
        | undefined;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const parsed = JSON.parse(Buffer.concat(chunks).toString()) as
        | { id: number; method: string }
        | Array<{ id: number; method: string }>;
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      batchSizes.push(calls.length);
      const results = calls.map((call) => ({
        jsonrpc: "2.0",
        id: call.id,
        result: call.method === "eth_chainId" ? "0x38" : "0x1"
      }));
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(Array.isArray(parsed) ? results : results[0])
      );
    })().catch(() => response.destroy());
  });
  server.listen(19204, "127.0.0.1");
  await once(server, "listening");
  const budget: RpcComputeBudget = {
    async authorizeFreeDispatch() {},
    async reserve() {
      throw new Error("delegated budget must not reserve in the caller");
    },
    snapshot() {
      return {
        model: "test",
        workload: requestedWorkload,
        priority: "foreground",
        grantedCu: 0,
        usedCu: 0,
        remainingCu: 0,
        denied: 0
      };
    }
  };
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      rpcBudgetProxyUrl("bnb", "production"),
      1000,
      1000,
      budget
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    const [block, chain] = await Promise.all([
      client.getBlockNumber(),
      client.getChainId()
    ]);
    assert.equal(block, 1n);
    assert.equal(chain, 56);
    const snapshot = measured.snapshot();
    assert.equal(snapshot.budgetDelegated, true);
    assert.equal(snapshot.computeUnits, 0);
    assert.equal(snapshot.budget, undefined);
    assert.equal(snapshot.requests, 2);
    assert.equal(requests, 1);
    assert.deepEqual(batchSizes, [2]);
    assert.equal(workload, "foreground");
    requestedWorkload = "source";
    const source = createMeasuredOpenSeaReadRpc(
      rpcBudgetProxyUrl("bnb", "production"),
      1000,
      1000,
      budget
    );
    const sourceClient = createPublicClient({
      transport: source.transport,
      cacheTime: 0
    });
    await Promise.all([sourceClient.getBlockNumber(), sourceClient.getChainId()]);
    assert.equal(requests, 2);
    assert.deepEqual(batchSizes, [2, 2]);
    assert.equal(workload, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("actual HTTP and RPC failures produce bounded diagnostic hints without retaining provider data", async () => {
  const privateText =
    "private-provider-token 0xdeadbeef https://private.invalid/key";
  const cases = [
    { status: 413, kind: "response_limit" },
    { status: 429, kind: "http_rate_limit" },
    { status: 401, kind: "http_auth" },
    { status: 403, kind: "http_auth" },
    { status: 400, kind: "http_client" },
    { status: 503, kind: "http_server" },
    {
      code: -32000,
      hint: "block is not canonical",
      kind: "rpc_noncanonical_block"
    },
    { code: -32000, hint: "header not found", kind: "rpc_missing_block" },
    { code: -32000, hint: "missing trie node", kind: "rpc_missing_state" },
    { code: 3, hint: "execution reverted", kind: "rpc_execution_reverted" },
    { code: -32005, kind: "rpc_rate_limit" },
    { code: -32600, kind: "rpc_invalid_request" },
    { code: -32601, kind: "rpc_method_unavailable" },
    { code: -32602, kind: "rpc_invalid_params" },
    { code: -32603, kind: "rpc_server" },
    { code: -32000, kind: "rpc_server" },
    { code: 123456, kind: "rpc_other" },
    { disconnect: true, kind: "network" }
  ];
  let current = cases[0]!;
  let requests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      requests++;
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const { id } = JSON.parse(body) as { id: number };
      if (current.disconnect) {
        response.destroy();
        return;
      }
      response.statusCode = current.status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: current.code ?? -32000,
            message: `${current.hint ?? "unknown provider response"}: ${privateText}`,
            data: { secret: privateText }
          }
        })
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      `http://127.0.0.1:${address.port}/private-provider-token`
    );
    const client = createPublicClient({ transport: measured.transport });
    const expected: Record<string, number> = {};
    for (const item of cases) {
      current = item;
      const prior = measured.snapshot();
      await assert.rejects(
        client.request({
          method: "eth_call",
          params: [{ data: "0xdeadbeef" }, "latest"]
        })
      );
      assert.deepEqual(prior.methods.eth_call?.failures ?? {}, expected);
      expected[item.kind] = (expected[item.kind] ?? 0) + 1;
      const result = measured.snapshot();
      assert.deepEqual(result.methods.eth_call?.failures, expected, item.kind);
      assert.equal(result.requests, requests);
      assert.equal(result.failed, requests);
      assert.equal(result.inFlight, 0);
      for (const secret of [
        "private-provider-token",
        "deadbeef",
        "private.invalid",
        "127.0.0.1",
        "123456"
      ])
        assert.equal(JSON.stringify(result).includes(secret), false);
    }
    assert.equal(requests, cases.length, "Diagnostics must not add retries");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("RPC body reads remain bounded after headers arrive, for oversized and stalled responses", async () => {
  let oversized = true;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("content-type", "application/json");
    response.flushHeaders();
    response.write('{"jsonrpc":"2.0","id":1,"result":"');
    if (oversized) response.end("x".repeat(4 * 1024 * 1024 + 1) + '"}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const endpoint = `http://127.0.0.1:${address.port}`;
    const measured = createMeasuredOpenSeaReadRpc(endpoint);
    const client = createPublicClient({ transport: measured.transport });
    await assert.rejects(client.getChainId(), isRpcResponseLimitError);
    assert.deepEqual(measured.snapshot().methods.eth_chainId?.failures, {
      response_limit: 1
    });
    oversized = false;
    const timed = createMeasuredOpenSeaReadRpc(endpoint, 100);
    await assert.rejects(
      createPublicClient({ transport: timed.transport }).getChainId()
    );
    assert.deepEqual(timed.snapshot().methods.eth_chainId?.failures, {
      timeout: 1
    });
    assert.equal(timed.snapshot().inFlight, 0);
    assert.equal(measured.snapshot().inFlight, 0);
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("bounded log replay recognizes a provider result-limit error", async () => {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const rpc = JSON.parse(body) as { id: number };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        error: {
          code: -32005,
          message: "query returned more than 10000 results"
        }
      })
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const measured = createMeasuredOpenSeaReadRpc(
      `http://127.0.0.1:${address.port}`
    );
    const client = createPublicClient({
      transport: measured.transport,
      cacheTime: 0
    });
    await assert.rejects(
      client.getLogs({
        address: zeroAddress,
        fromBlock: 1n,
        toBlock: 8192n
      }),
      isRpcResponseLimitError
    );
    assert.deepEqual(measured.snapshot().methods.eth_getLogs?.failures, {
      response_limit: 1
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
