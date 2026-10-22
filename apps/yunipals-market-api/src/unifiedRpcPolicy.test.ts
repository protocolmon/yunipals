import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";

import { testUrl } from "@/bnb/fixtures/database";
import { migrate } from "@/db/migrate";
import { createRpcBudgetProxy } from "@/rpcBudgetProxy";
import {
  unifiedRpcBudgetProxyUrl,
  isProductionUnifiedRpcBudgetProxyUrl,
  isProductionRpcBudgetProxyUrl
} from "@/rpcBudgetProxyRegistry";
import { createUnifiedRpcPolicyGate } from "@/unifiedRpcPolicy";
import { PostgresRpcComputeBudget } from "@/opensea/rpcComputeBudget";
import {
  unifiedRpcProfileId,
  unifiedRpcManifestId,
  unifiedRpcProfileHeader,
  unifiedRpcPermitHeader,
  validateUnifiedRpcCalls,
  type UnifiedRpcProfile
} from "../../../packages/yunipals-indexer-server/src/rpc-policy";
import { seaportDeployment } from "../../../packages/yunipals-market-core/src/registry";

const owner = new pg.Pool({
  connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
  max: 4
});
const runtime = new pg.Pool({
  connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
  max: 8
});
const scopes: string[] = [];
const address = `0x${"ab".repeat(20)}`;
const hash = `0x${"cd".repeat(32)}`;
test.before(async () => {
  await migrate(owner, "staging");
  await owner.query(
    (
      await readFile(
        new URL("../scripts/grant-opensea-budget.sql", import.meta.url),
        "utf8"
      )
    ).replaceAll(':"market_budget_role"', '"market_test_runtime"')
  );
});
test.after(async () => {
  for (const table of [
    "unified_rpc_replay_permit",
    "unified_rpc_profile",
    "rpc_compute_workload_window",
    "rpc_compute_window",
    "rpc_compute_allocation",
    "rpc_compute_budget",
    "opensea_request_budget_state",
    "opensea_request_budget"
  ]) {
    if (table === "unified_rpc_replay_permit")
      await owner.query(
        `DELETE FROM yunipals_market.${table} WHERE profile_id IN (SELECT profile_id FROM yunipals_market.unified_rpc_profile WHERE scope=ANY($1::text[]))`,
        [scopes]
      );
    else
      await owner.query(
        `DELETE FROM yunipals_market.${table} WHERE scope=ANY($1::text[])`,
        [scopes]
      );
  }
  await Promise.all([owner.end(), runtime.end()]);
});
async function setup(maximumCu = 120) {
  const scope = `rpc-${randomUUID()}`;
  scopes.push(scope);
  await owner.query(
    `INSERT INTO yunipals_market.opensea_request_budget(scope,all_per_hour,fulfillment_per_minute,publication_per_hour,enabled) VALUES($1,100,10,10,true)`,
    [scope]
  );
  const coordinatorId = (
    await owner.query(
      "SELECT coordinator_id::text AS id FROM yunipals_market.opensea_request_budget WHERE scope=$1",
      [scope]
    )
  ).rows[0].id;
  await owner.query(
    "INSERT INTO yunipals_market.opensea_request_budget_state(scope) VALUES($1)",
    [scope]
  );
  await owner.query(
    "INSERT INTO yunipals_market.rpc_compute_budget(scope,daily_cu,foreground_reserve_cu,enabled) VALUES($1,10000,1000,true)",
    [scope]
  );
  await owner.query(
    "INSERT INTO yunipals_market.rpc_compute_allocation(scope,workload,priority,daily_cu) VALUES($1,'unified_source','background',5000),($1,'unified_evidence','background',1000)",
    [scope]
  );
  const profile: UnifiedRpcProfile = {
    version: 1,
    model: "alchemy-2026-09-08",
    scope,
    coordinatorId,
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
  const id = unifiedRpcProfileId(profile),
    permit = `0x${randomUUID().replaceAll("-", "").repeat(2)}`;
  await owner.query(
    "INSERT INTO yunipals_market.unified_rpc_profile(profile_id,scope,manifest_hash,policy,enabled,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '1 hour')",
    [id, scope, unifiedRpcManifestId(profile), JSON.stringify(profile)]
  );
  await owner.query(
    "INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES($1,$2,8453,100,1000,$3,true,clock_timestamp()+interval '1 hour')",
    [permit, id, maximumCu]
  );
  return {
    profile,
    permit,
    id,
    gate: createUnifiedRpcPolicyGate(runtime, scope, profile, 8453),
    scope
  };
}
const logs = {
  method: "eth_getLogs",
  params: [{ address, fromBlock: "0x64", toBlock: "0xc8" }]
};
test("reviewed profile preserves native Ponder shapes and rejects unreviewed scope/methods", async () => {
  const { profile } = await setup();
  validateUnifiedRpcCalls(profile, 8453, [
    logs,
    { method: "eth_chainId" },
    { method: "eth_getLogs", params: [{ blockHash: hash }] }
  ]);
  const laterAddress = `0x${"ef".repeat(20)}`;
  const laterProfile: UnifiedRpcProfile = {
    ...profile,
    manifest: {
      ...profile.manifest,
      sources: [
        ...profile.manifest.sources,
        {
          ...profile.manifest.sources[0]!,
          id: "ownership:later",
          address: laterAddress,
          startBlock: "500"
        }
      ]
    }
  };
  assert.throws(() =>
    validateUnifiedRpcCalls(laterProfile, 8453, [
      {
        method: "eth_getLogs",
        params: [{ address: laterAddress, fromBlock: "0x64", toBlock: "0xc8" }]
      }
    ])
  );
  for (const call of [
    { method: "eth_getBlockReceipts", params: [hash] },
    { method: "eth_unreviewedRead", params: [] },
    { method: "eth_getLogs", params: [{ fromBlock: "0x64", toBlock: "0x65" }] },
    {
      method: "eth_getLogs",
      params: [
        { address: `0x${"ef".repeat(20)}`, fromBlock: "0x64", toBlock: "0x65" }
      ]
    },
    {
      method: "eth_getLogs",
      params: [{ address, fromBlock: "0x64", toBlock: "0xffff" }]
    }
  ])
    assert.throws(() => validateUnifiedRpcCalls(profile, 8453, [call]));
});
test("paid permits are durable, atomic, height bound and cannot fund hash lookups", async () => {
  const { gate, permit } = await setup();
  await gate.ready("unified_source");
  await assert.rejects(gate.reservePaid(undefined, [logs]));
  await assert.rejects(
    gate.reservePaid(permit, [
      { method: "eth_getBlockByHash", params: [hash, true] }
    ])
  );
  await assert.rejects(
    gate.reservePaid(permit, [
      {
        method: "eth_getLogs",
        params: [{ address, fromBlock: "0x1", toBlock: "0x64" }]
      }
    ])
  );
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => gate.reservePaid(permit, [logs]))
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    2
  );
  assert.equal(
    (
      await owner.query(
        "SELECT spent_cu::text FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
        [permit]
      )
    ).rows[0].spent_cu,
    "120"
  );
  await assert.rejects(gate.reservePaid(permit, [logs]));
  await assert.rejects(
    runtime.query(
      "UPDATE yunipals_market.unified_rpc_replay_permit SET spent_cu=0 WHERE permit_id=$1",
      [permit]
    )
  );
  await assert.rejects(
    runtime.query("UPDATE yunipals_market.unified_rpc_profile SET enabled=true")
  );
});
test("non-BNB companion Seaport code is allowed only for full-receipt sources and bounded permits", async () => {
  const { profile, scope, permit } = await setup();
  const code = {
    method: "eth_getCode",
    params: [seaportDeployment.address, "0x64"]
  };
  validateUnifiedRpcCalls(profile, 8453, [code]);
  assert.throws(() =>
    validateUnifiedRpcCalls(profile, 8453, [
      {
        method: "eth_getLogs",
        params: [
          {
            address: seaportDeployment.address,
            fromBlock: "0x64",
            toBlock: "0xc8"
          }
        ]
      }
    ])
  );
  assert.throws(() =>
    validateUnifiedRpcCalls(profile, 8453, [
      { ...code, params: [seaportDeployment.address, "0x63"] }
    ])
  );
  const noFull: UnifiedRpcProfile = {
    ...profile,
    manifest: {
      ...profile.manifest,
      sources: profile.manifest.sources.map((source) => ({
        ...source,
        receiptRequirement: "none"
      }))
    }
  };
  assert.throws(() => validateUnifiedRpcCalls(noFull, 8453, [code]));
  await owner.query(
    "INSERT INTO yunipals_market.unified_rpc_profile(profile_id,scope,manifest_hash,policy,enabled,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '1 hour')",
    [
      unifiedRpcProfileId(noFull),
      scope,
      unifiedRpcManifestId(noFull),
      JSON.stringify(noFull)
    ]
  );
  let dispatched = 0;
  for (const selected of [profile, noFull]) {
    const budget = new PostgresRpcComputeBudget(
      runtime,
      scope,
      "unified_evidence",
      "background"
    );
    const proxy = createRpcBudgetProxy({
      upstream: new URL("https://paid.invalid"),
      budget,
      workloadBudgets: { unified_evidence: budget },
      unifiedPolicy: createUnifiedRpcPolicyGate(runtime, scope, selected, 8453),
      async fetch(_url, init) {
        dispatched++;
        const call = JSON.parse(Buffer.from(init!.body as Buffer).toString());
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: call.id, result: "0x6000" }),
          { headers: { "content-type": "application/json" } }
        );
      }
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const location = proxy.address();
    assert.ok(location && typeof location === "object");
    try {
      const call = async (to: string) => {
        const response = await fetch(
          `http://127.0.0.1:${location.port}/unified`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-yunipals-rpc-workload": "unified_evidence",
              [unifiedRpcProfileHeader]: unifiedRpcProfileId(selected),
              [unifiedRpcPermitHeader]: permit
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getCode",
              params: [to, "0x64"]
            })
          }
        );
        await response.arrayBuffer();
        return response.status;
      };
      assert.equal(
        await call(seaportDeployment.address),
        selected === profile ? 200 : 400
      );
      assert.equal(await call(`0x${"ef".repeat(20)}`), 400);
    } finally {
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
  assert.equal(dispatched, 1);
  assert.equal(
    (
      await owner.query(
        "SELECT spent_cu::text FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
        [permit]
      )
    ).rows[0].spent_cu,
    "20"
  );
});
test("expired, disabled, altered-profile and wrong-coordinator policies refuse work", async () => {
  const { gate, profile, permit, id } = await setup();
  await owner.query(
    "UPDATE yunipals_market.unified_rpc_replay_permit SET expires_at=clock_timestamp()-interval '1 second' WHERE permit_id=$1",
    [permit]
  );
  await assert.rejects(gate.reservePaid(permit, [logs]));
  await assert.rejects(
    createUnifiedRpcPolicyGate(
      runtime,
      profile.scope,
      { ...profile, coordinatorId: randomUUID() },
      8453
    ).ready("unified_source")
  );
  await owner.query(
    "UPDATE yunipals_market.unified_rpc_profile SET enabled=false WHERE profile_id=$1",
    [id]
  );
  await assert.rejects(gate.ready("unified_source"));
  await assert.rejects(gate.reservePaid(permit, [logs]));
});
test("review CLI requires the current hash and repeated approval never resets permit spend", async () => {
  const { profile, id, permit, gate } = await setup();
  await owner.query(
    "DELETE FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
    [permit]
  );
  await owner.query(
    "DELETE FROM yunipals_market.unified_rpc_profile WHERE profile_id=$1",
    [id]
  );
  const directory = await mkdtemp("/tmp/yunipals-rpc-review-");
  const path = join(directory, "review.json");
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  await writeFile(
    path,
    JSON.stringify({
      profile,
      expiresAt,
      permits: [
        {
          permitId: permit,
          chainId: 8453,
          fromBlock: "100",
          throughBlock: "1000",
          maximumCu: 120,
          expiresAt
        }
      ]
    })
  );
  const execute = (apply?: string) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/review-unified-rpc-policy.ts",
          "--file",
          path,
          ...(apply ? ["--apply", apply] : [])
        ],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env: {
            PATH: process.env.PATH,
            UNIFIED_RPC_REVIEW_DATABASE_URL: testUrl("MARKET_TEST_DATABASE_URL")
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
  try {
    const review = await execute();
    assert.equal(review.code, 0);
    const reviewHash = JSON.parse(review.output.trim()).reviewHash;
    assert.equal((await execute(`0x${"00".repeat(32)}`)).code, 1);
    assert.equal((await execute(reviewHash)).code, 0);
    await gate.reservePaid(permit, [logs]);
    assert.equal((await execute(reviewHash)).code, 0);
    assert.equal(
      (
        await owner.query(
          "SELECT spent_cu::text FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
          [permit]
        )
      ).rows[0].spent_cu,
      "60"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("opt-in proxy frees reviewed source logs while bounded paid history and distinct budgets persist", async () => {
  const { gate, profile, permit, scope } = await setup(60);
  const routes: string[] = [];
  const source = new PostgresRpcComputeBudget(
    runtime,
    scope,
    "unified_source",
    "background",
    1000
  );
  const evidence = new PostgresRpcComputeBudget(
    runtime,
    scope,
    "unified_evidence",
    "background",
    1000
  );
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.invalid"),
    freeUpstream: new URL("https://free.invalid"),
    freeSourceMinimumIntervalMs: 0,
    freeOrderMinimumIntervalMs: 0,
    budget: source,
    workloadBudgets: { unified_source: source, unified_evidence: evidence },
    unifiedPolicy: gate,
    async fetch(url, init) {
      routes.push(new URL(url instanceof Request ? url.url : url).hostname);
      const call = JSON.parse(Buffer.from(init!.body as Buffer).toString());
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: call.id, result: [] }),
        { headers: { "content-type": "application/json" } }
      );
    }
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const location = proxy.address();
  assert.ok(location && typeof location === "object");
  const root = `http://127.0.0.1:${location.port}`;
  const url = `${root}/unified`;
  const headers = {
    "content-type": "application/json",
    "x-yunipals-rpc-workload": "unified_source",
    [unifiedRpcProfileHeader]: unifiedRpcProfileId(profile)
  };
  const post = async (call: object, extra = {}) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call })
    });
    await response.arrayBuffer();
    return response.status;
  };
  try {
    assert.equal(
      unifiedRpcBudgetProxyUrl("base"),
      "http://127.0.0.1:19202/unified"
    );
    assert.equal(
      isProductionUnifiedRpcBudgetProxyUrl(
        unifiedRpcBudgetProxyUrl("base"),
        "base"
      ),
      true
    );
    assert.equal(
      isProductionUnifiedRpcBudgetProxyUrl("http://127.0.0.1:19202", "base"),
      false
    );
    assert.equal(
      isProductionRpcBudgetProxyUrl("http://127.0.0.1:19202", "base"),
      true
    );
    const omitted = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...logs })
    });
    assert.equal(omitted.status, 403);
    await omitted.arrayBuffer();
    const wrongPath = await fetch(root, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...logs })
    });
    assert.equal(wrongPath.status, 403);
    await wrongPath.arrayBuffer();
    assert.deepEqual(routes, []);
    assert.equal(await post(logs), 200);
    assert.deepEqual(routes, ["free.invalid"]);
    assert.equal(source.snapshot().usedCu, 0);
    const paidHistory = {
      method: "eth_getCode",
      params: [address, "0x64"]
    };
    assert.equal(await post(paidHistory), 403);
    assert.deepEqual(routes, ["free.invalid"]);
    assert.equal(
      await post(
        { method: "eth_getBlockReceipts", params: [hash] },
        { [unifiedRpcPermitHeader]: permit }
      ),
      400
    );
    for (let i = 0; i < 3; i++)
      assert.equal(
        await post(paidHistory, { [unifiedRpcPermitHeader]: permit }),
        200
      );
    assert.deepEqual(routes, [
      "free.invalid",
      "paid.invalid",
      "paid.invalid",
      "paid.invalid"
    ]);
    assert.equal(source.snapshot().usedCu, 60);
    assert.equal(
      await post(paidHistory, { [unifiedRpcPermitHeader]: permit }),
      403
    );
    assert.equal(
      await post({ method: "eth_getLogs", params: [{ blockHash: hash }] }),
      200
    );
    assert.deepEqual(routes, [
      "free.invalid",
      "paid.invalid",
      "paid.invalid",
      "paid.invalid",
      "free.invalid"
    ]);
    const preflight = await fetch(`${root}/unified/preflight`, { headers });
    assert.equal(preflight.status, 200);
    const body = (await preflight.json()) as { chainId: number };
    assert.equal(body.chainId, 8453);
  } finally {
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
