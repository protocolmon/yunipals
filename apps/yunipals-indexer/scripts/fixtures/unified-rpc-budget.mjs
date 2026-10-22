import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { tsImport } from "tsx/esm/api";
import {
  unifiedRpcManifestId,
  unifiedRpcProfileId
} from "../../../../packages/yunipals-indexer-server/src/rpc-policy.ts";

export async function createBudgetedRpcFixture({
  repository,
  manifest,
  anvilUrl,
  startBlock,
  directory,
  methods,
  forceHistoricalFreeFailure = false
}) {
  const urls = [
    process.env.MARKET_TEST_DATABASE_URL,
    process.env.MARKET_TEST_RUNTIME_DATABASE_URL
  ];
  for (const value of urls) {
    assert.ok(value, "Isolated marketplace owner/runtime URLs are required");
    const url = new URL(value);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/yunipals_market_test");
  }
  const owner = new pg.Pool({ connectionString: urls[0], max: 2 });
  const runtime = new pg.Pool({ connectionString: urls[1], max: 8 });
  const market = join(repository, "apps/yunipals-market-api");
  const policySourceFiles = await Promise.all(
    [
      "apps/yunipals-market-api/src/rpcBudgetProxy.ts",
      "apps/yunipals-market-api/src/unifiedRpcPolicy.ts",
      "apps/yunipals-market-api/src/opensea/rpcComputeBudget.ts",
      "packages/yunipals-indexer-server/src/rpc-policy.ts"
    ].map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(repository, path)))
        .digest("hex")
    }))
  );
  const load = (path) =>
    tsImport(pathToFileURL(join(market, path)).href, {
      parentURL: import.meta.url,
      tsconfig: join(market, "tsconfig.json")
    });
  const [
    { migrate },
    { createRpcBudgetProxy },
    { createUnifiedRpcPolicyGate },
    { PostgresRpcComputeBudget, alchemyComputeUnits }
  ] = await Promise.all([
    load("src/db/migrate.ts"),
    load("src/rpcBudgetProxy.ts"),
    load("src/unifiedRpcPolicy.ts"),
    load("src/opensea/rpcComputeBudget.ts")
  ]);
  await migrate(owner, "staging");
  await owner.query(
    (
      await readFile(join(market, "scripts/grant-opensea-budget.sql"), "utf8")
    ).replaceAll(':"market_budget_role"', '"market_test_runtime"')
  );
  const scope = `rpc-smoke-${randomUUID()}`;
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
    "INSERT INTO yunipals_market.rpc_compute_budget(scope,daily_cu,foreground_reserve_cu,enabled) VALUES($1,100000,10000,true)",
    [scope]
  );
  await owner.query(
    "INSERT INTO yunipals_market.rpc_compute_allocation(scope,workload,priority,daily_cu) VALUES($1,'unified_source','background',70000),($1,'unified_evidence','background',5000)",
    [scope]
  );
  const profile = {
    version: 1,
    model: "alchemy-2026-09-08",
    scope,
    coordinatorId,
    manifest,
    limits: { batchCalls: 10, logRange: 20, addresses: 50, topicValues: 128 }
  };
  const profileId = unifiedRpcProfileId(profile),
    permitId = `0x${randomBytes(32).toString("hex")}`;
  await owner.query(
    "INSERT INTO yunipals_market.unified_rpc_profile(profile_id,scope,manifest_hash,policy,enabled,expires_at) VALUES($1,$2,$3,$4,true,clock_timestamp()+interval '1 hour')",
    [profileId, scope, unifiedRpcManifestId(profile), JSON.stringify(profile)]
  );
  await owner.query(
    "INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES($1,$2,8453,$3,$4,50000,true,clock_timestamp()+interval '1 hour')",
    [permitId, profileId, startBlock, startBlock + 512]
  );
  const profilePath = join(directory, "reviewed-rpc-profile.json");
  await writeFile(profilePath, JSON.stringify(profile, null, 2));
  const routes = { free: 0, paid: 0 };
  const deliberateFallback = {
    enabled: forceHistoricalFreeFailure,
    failures: 0,
    batchCalls: 0,
    expectedPaidCu: 0
  };
  let modeledPaidCu = 0;
  const budgets = {
    unified_source: new PostgresRpcComputeBudget(
      runtime,
      scope,
      "unified_source",
      "background"
    ),
    unified_evidence: new PostgresRpcComputeBudget(
      runtime,
      scope,
      "unified_evidence",
      "background"
    )
  };
  const proxy = createRpcBudgetProxy({
    upstream: new URL("https://paid.local.invalid"),
    freeUpstream: new URL("https://free.local.invalid"),
    budget: budgets.unified_source,
    workloadBudgets: budgets,
    unifiedPolicy: createUnifiedRpcPolicyGate(runtime, scope, profile, 8453),
    freeRecentBlocks: 128n,
    maximumConcurrentUpstreamRequests: 32,
    freeMinimumIntervalMs: 0,
    freeSourceMinimumIntervalMs: 0,
    freeOrderMinimumIntervalMs: 0,
    sourcePaidFallbackOnFreeFailure: forceHistoricalFreeFailure,
    async fetch(url, request) {
      const host = new URL(url).hostname;
      assert.ok(["paid.local.invalid", "free.local.invalid"].includes(host));
      routes[host === "paid.local.invalid" ? "paid" : "free"]++;
      const calls = [
        JSON.parse(Buffer.from(request.body).toString())
      ].flat();
      for (const call of calls)
        methods[call.method] = (methods[call.method] ?? 0) + 1;
      const units = calls.reduce(
        (total, call) => total + alchemyComputeUnits(call.method),
        0
      );
      if (host === "paid.local.invalid") modeledPaidCu += units;
      if (
        forceHistoricalFreeFailure &&
        deliberateFallback.failures === 0 &&
        host === "free.local.invalid" &&
        calls.every(
          (call) =>
            call.method === "eth_getLogs" &&
            /^0x[0-9a-f]+$/i.test(call.params?.[0]?.fromBlock ?? "") &&
            /^0x[0-9a-f]+$/i.test(call.params?.[0]?.toBlock ?? "")
        )
      ) {
        // The real proxy has already validated the entire numeric source-log
        // batch. Fail this free attempt once; its unchanged paid gate must
        // then reserve the existing bounded permit and workload allowance.
        deliberateFallback.failures++;
        deliberateFallback.batchCalls = calls.length;
        deliberateFallback.expectedPaidCu = units;
        return new Response("Deliberate local free-source failure", {
          status: 503
        });
      }
      // Never forward the supplied URL: the sole upstream is guarded local Anvil.
      return fetch(anvilUrl, {
        ...request,
        headers: { "content-type": "application/json" }
      });
    }
  });
  return {
    proxy,
    profilePath,
    profileId,
    permitId,
    profile,
    async evidence() {
      const permit = (
        await owner.query(
          "SELECT chain_id,from_block::text,through_block::text,maximum_cu::text,spent_cu::text FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
          [permitId]
        )
      ).rows[0];
      return {
        policySourceFiles,
        migration28: (
          await owner.query(
            "SELECT version,name,checksum FROM yunipals_market.schema_migration WHERE version=28"
          )
        ).rows[0],
        profileId,
        permitId,
        scope,
        routes,
        deliberateFallback,
        modeledPaidCu,
        fixtureSha256: createHash("sha256")
          .update(await readFile(fileURLToPath(import.meta.url)))
          .digest("hex"),
        permit,
        budgets: Object.fromEntries(
          Object.entries(budgets).map(([key, value]) => [key, value.snapshot()])
        ),
        mode: "actual budget proxy; paid route local Anvil only; no external provider"
      };
    },
    async close() {
      await Promise.all([owner.end(), runtime.end()]);
    }
  };
}
