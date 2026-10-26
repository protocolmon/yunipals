import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createPublicClient,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  http
} from "viem";

import { createRpcBudgetProxy } from "@/rpcBudgetProxy";
import { createOpenSeaRequestBudget } from "@/opensea/requestBudget";
import {
  alchemyComputeUnits,
  type RpcComputeBudget
} from "@/opensea/rpcComputeBudget";
import {
  unifiedRpcPaidRange,
  unifiedRpcProfileHeader,
  unifiedRpcProfileId,
  validateUnifiedRpcCalls,
  type UnifiedRpcCall,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";
import { arenaAbi } from "../../../packages/yunipals-market-core/src/arenaAbi";
import { seaportDeployment } from "../../../packages/yunipals-market-core/src/registry";

const address = "0xebd141b6ae36f74fe70b9139b262ee9771b72aca";
const disabled = `0x${"11".repeat(20)}`;
const otherChain = `0x${"22".repeat(20)}`;
const later = `0x${"33".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}` as const;
const profile: UnifiedRpcProfile = {
  version: 1,
  model: "alchemy-2026-09-08",
  scope: "arena-contract-read-test",
  coordinatorId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  manifest: {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [
      {
        id: "arena:base",
        address,
        chainId: 8453,
        enabled: true,
        startBlock: "100"
      },
      {
        id: "arena:disabled",
        address: disabled,
        chainId: 8453,
        enabled: false,
        startBlock: "100"
      },
      {
        id: "arena:other",
        address: otherChain,
        chainId: 56,
        enabled: true,
        startBlock: "100"
      },
      {
        id: "arena:later",
        address: later,
        chainId: 8453,
        enabled: true,
        startBlock: "200"
      }
    ].map((source) => ({
      ...source,
      feature: "arena",
      contractName: "YunipalsArena",
      endBlock: null,
      abiHash: hash,
      events: ["TournamentOpened"],
      receiptRequirement: "full",
      policies: [{ kind: "latest" }]
    }))
  },
  limits: { batchCalls: 10, logRange: 10000, addresses: 50, topicValues: 32 }
};
const tournamentData = encodeFunctionData({
  abi: arenaAbi,
  functionName: "tournament",
  args: [1n]
});
const maskData = encodeFunctionData({
  abi: arenaAbi,
  functionName: "automaticStrategyMask",
  args: [1n]
});
const call: UnifiedRpcCall = {
  method: "eth_call",
  params: [{ to: address, data: tournamentData }, "0x64"]
};

test("RPC budget clients can retain their production connection limit", async () => {
  const environment = {
    MARKET_DEPLOYMENT: "production",
    MARKET_OPENSEA_BUDGET_DATABASE_URL:
      "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
    MARKET_OPENSEA_BUDGET_SCOPE: "synthetic",
    MARKET_OPENSEA_BUDGET_COORDINATOR_ID:
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  };
  const rpc = createOpenSeaRequestBudget(environment, 1);
  const other = createOpenSeaRequestBudget(environment);
  try {
    assert.equal(rpc.pool.options.max, 1);
    assert.equal(other.pool.options.max, 2);
    assert.equal(rpc.pool.totalCount, 0);
    assert.equal(other.pool.totalCount, 0);
  } finally {
    await Promise.all([rpc.pool.end(), other.pool.end()]);
  }
});

test("reviewed contract reads accept real Arena ABI payloads at explicit deployment-bounded heights", () => {
  validateUnifiedRpcCalls(profile, 8453, [
    call,
    { ...call, params: [{ to: address, data: maskData }, "0x64"] }
  ]);
  validateUnifiedRpcCalls(profile, 8453, [
    {
      ...call,
      params: [
        { to: address.toUpperCase(), data: maskData.toUpperCase() },
        "0x64"
      ]
    }
  ]);
  validateUnifiedRpcCalls(profile, 8453, [
    { ...call, params: [{ to: later, data: maskData }, "0xc8"] }
  ]);
  validateUnifiedRpcCalls(profile, 8453, [
    {
      ...call,
      params: [{ to: address, data: "0x" + "ab".repeat(4096) }, "0x64"]
    }
  ]);
  assert.equal(alchemyComputeUnits("eth_call"), 26);
  assert.throws(() => unifiedRpcPaidRange(call));
});

test("contract reads reject disabled, foreign-chain, companion-code and predeployment addresses", () => {
  for (const to of [
    disabled,
    otherChain,
    seaportDeployment.address,
    later,
    `0x${"44".repeat(20)}`,
    "0x1234"
  ]) {
    assert.throws(() =>
      validateUnifiedRpcCalls(profile, 8453, [
        { ...call, params: [{ to, data: maskData }, "0x64"] }
      ])
    );
  }
  assert.throws(() => validateUnifiedRpcCalls(profile, 137, [call]));
  assert.throws(() =>
    validateUnifiedRpcCalls(profile, 8453, [
      { ...call, params: [{ to: address, data: maskData }, "0x63"] }
    ])
  );
});

const invalidParams: unknown[] = [
  [],
  [{ to: address, data: maskData }],
  [{ to: address, data: maskData }, "0x64", {}],
  ...[
    "latest",
    "safe",
    "finalized",
    "pending",
    "earliest",
    "0x064",
    "0x-1",
    "0X64",
    100,
    null,
    { blockHash: hash, requireCanonical: true }
  ].map((block) => [{ to: address, data: maskData }, block]),
  ...[
    "0x",
    "0x123456",
    "0x123456789",
    "0xnothex12",
    "0x" + "ab".repeat(4097),
    0
  ].map((data) => [{ to: address, data }, "0x64"]),
  ...[
    "from",
    "gas",
    "value",
    "input",
    "accessList",
    "stateOverride",
    "nonce",
    "maxFeePerGas"
  ].map((key) => [{ to: address, data: maskData, [key]: "0x0" }, "0x64"]),
  [{ to: address }, "0x64"],
  [{ data: maskData }, "0x64"],
  [[], "0x64"]
];
test("contract reads accept no tags, overrides, extra fields, empty selectors or oversized calldata", () => {
  for (const params of invalidParams) {
    assert.throws(
      () => validateUnifiedRpcCalls(profile, 8453, [{ ...call, params }]),
      JSON.stringify(params)
    );
  }
  assert.throws(() =>
    validateUnifiedRpcCalls(profile, 8453, Array(11).fill(call))
  );
});

type Request = {
  jsonrpc: string;
  id: number | string;
  method: string;
  params: unknown[];
};
const servers: ReturnType<typeof createRpcBudgetProxy>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done())))
  );
});
async function fixture(options: { ready?: boolean; denied?: boolean } = {}) {
  const seen: Array<{ url: string; body: Request | Request[] }> = [];
  const counts = { free: 0, paid: 0, permit: 0 };
  const budget: RpcComputeBudget = {
    authorizeFreeDispatch: async () => {
      counts.free++;
      if (options.denied) throw new Error("fixture budget denied");
    },
    reserve: async () => {
      counts.paid++;
      throw new Error("no new paid allowance");
    },
    snapshot: () => ({
      model: "test",
      workload: "unified_evidence",
      priority: "background",
      grantedCu: 0,
      usedCu: 0,
      remainingCu: 0,
      denied: 0
    })
  };
  const tournament = {
    phase: 1,
    count: 0,
    islandId: 0,
    randomnessReceived: false,
    deadline: 1n,
    islandBeneficiary: getAddress(address),
    treasuryBeneficiary: getAddress(address),
    requestId: 0n,
    randomWord: 0n,
    inputHash: hash,
    resultHash: hash,
    semifinalOneWinner: 0,
    semifinalTwoWinner: 0,
    champion: 0
  } as const;
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.invalid"),
    freeUpstreams: [new URL("https://free.invalid/fixture")],
    freeMinimumIntervalMs: 0,
    freeOrderMinimumIntervalMs: 0,
    budget,
    workloadBudgets: { unified_source: budget, unified_evidence: budget },
    unifiedPolicy: {
      profile,
      chainId: 8453,
      ready: async () => {
        if (options.ready === false)
          throw new Error("fixture profile unavailable");
      },
      inspect: async () => ({}),
      reservePaid: async () => {
        counts.permit++;
        throw new Error("no paid permit");
      }
    },
    fetch: async (url, init) => {
      const body = JSON.parse(Buffer.from(init!.body as Buffer).toString()) as
        | Request
        | Request[];
      seen.push({ url: String(url), body });
      const reply = (request: Request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "eth_blockNumber"
            ? "0x64"
            : request.method === "eth_call"
              ? (request.params[0] as { data: string }).data === tournamentData
                ? encodeFunctionResult({
                    abi: arenaAbi,
                    functionName: "tournament",
                    result: tournament
                  })
                : encodeFunctionResult({
                    abi: arenaAbi,
                    functionName: "automaticStrategyMask",
                    result: 0
                  })
              : []
      });
      return Response.json(Array.isArray(body) ? body.map(reply) : reply(body));
    }
  });
  servers.push(proxy);
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  const bound = proxy.address();
  assert.ok(bound && typeof bound === "object");
  const url = `http://127.0.0.1:${bound.port}/unified`;
  const headers = {
    "x-yunipals-rpc-workload": "unified_evidence",
    [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
  };
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers, ...extra },
      body: JSON.stringify(body)
    });
  return { seen, counts, post, url, headers, tournament };
}

test("actual proxy forwards viem's two Arena readContract calls without changing payload or paid caps", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.post({
        jsonrpc: "2.0",
        id: 0,
        method: "eth_blockNumber",
        params: []
      })
    ).status,
    200
  );
  const client = createPublicClient({
    transport: http(f.url, {
      retryCount: 0,
      fetchOptions: { headers: f.headers }
    })
  });
  assert.deepEqual(
    await client.readContract({
      address,
      abi: arenaAbi,
      functionName: "tournament",
      args: [1n],
      blockNumber: 100n
    }),
    f.tournament
  );
  assert.equal(
    await client.readContract({
      address,
      abi: arenaAbi,
      functionName: "automaticStrategyMask",
      args: [1n],
      blockNumber: 100n
    }),
    0
  );
  assert.deepEqual(
    f.seen.slice(1).map(({ body }) => (body as Request).params),
    [
      [{ data: tournamentData, to: address }, "0x64"],
      [{ data: maskData, to: address }, "0x64"]
    ]
  );
  assert.deepEqual(f.counts, { free: 3, paid: 0, permit: 0 });
  assert.ok(f.seen.every(({ url }) => url === "https://free.invalid/fixture"));
});

test("actual proxy rejects malformed or mixed contract calls before any provider or budget dispatch", async () => {
  const f = await fixture();
  for (const params of invalidParams) {
    assert.equal(
      (await f.post({ jsonrpc: "2.0", id: 1, method: "eth_call", params }))
        .status,
      400
    );
  }
  assert.equal(
    (
      await f.post([
        { jsonrpc: "2.0", id: 1, ...call },
        {
          jsonrpc: "2.0",
          id: 2,
          ...call,
          params: [{ to: disabled, data: maskData }, "0x64"]
        }
      ])
    ).status,
    400
  );
  assert.equal(
    (
      await f.post(
        { jsonrpc: "2.0", id: 1, ...call },
        { [unifiedRpcProfileHeader]: "0x" + "00".repeat(32) }
      )
    ).status,
    403
  );
  assert.equal(f.seen.length, 0);
  assert.deepEqual(f.counts, { free: 0, paid: 0, permit: 0 });
});

test("existing profile and dispatch-budget refusals still block contract reads", async () => {
  const f = await fixture({ ready: false });
  assert.equal((await f.post({ jsonrpc: "2.0", id: 1, ...call })).status, 502);
  assert.equal(f.seen.length, 0);
  const denied = await fixture({ denied: true });
  assert.notEqual(
    (
      await denied.post({
        jsonrpc: "2.0",
        id: 0,
        method: "eth_blockNumber",
        params: []
      })
    ).status,
    200
  );
  assert.equal(denied.seen.length, 0);
  assert.deepEqual(denied.counts, { free: 1, paid: 0, permit: 0 });
});
