import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import {
  alchemyComputeUnits,
  PostgresRpcComputeBudget,
  RpcComputeBudgetError
} from "@/opensea/rpcComputeBudget";

const db = createBnbTestDatabase();
const scopes: string[] = [];

test.before(async () => {
  await db.initialize();
  const grant = readFileSync(
    new URL("../../scripts/grant-opensea-budget.sql", import.meta.url),
    "utf8"
  ).replaceAll(':"market_budget_role"', '"market_test_runtime"');
  await db.owner.query(grant);
});

test.after(async () => {
  try {
    for (const table of [
      "rpc_compute_workload_window",
      "rpc_compute_window",
      "rpc_compute_allocation",
      "rpc_compute_budget",
      "opensea_request_budget_state",
      "opensea_request_budget"
    ])
      await db.owner.query(
        `DELETE FROM yunipals_market.${table} WHERE scope=ANY($1::text[])`,
        [scopes]
      );
  } finally {
    await db.close();
  }
});

async function setup(enabled = true) {
  const scope = `test-${randomUUID()}`;
  scopes.push(scope);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_request_budget
      (scope,all_per_hour,fulfillment_per_minute,publication_per_hour,enabled)
    VALUES($1,100,10,10,true)`,
    [scope]
  );
  await db.owner.query(
    "INSERT INTO yunipals_market.opensea_request_budget_state(scope) VALUES($1)",
    [scope]
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.rpc_compute_budget
      (scope,daily_cu,foreground_reserve_cu,enabled) VALUES($1,100,30,$2)`,
    [scope, enabled]
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.rpc_compute_allocation(scope,workload,priority,daily_cu)
    VALUES($1,'order_projection','background',70),($1,'foreground','foreground',30)`,
    [scope]
  );
  return scope;
}

const exhausted = (error: unknown) =>
  error instanceof RpcComputeBudgetError && error.retryAfterMs > 0;

test("Alchemy method weights match the pinned cost model", () => {
  assert.equal(alchemyComputeUnits("eth_chainId"), 1);
  assert.equal(alchemyComputeUnits("eth_blockNumber"), 10);
  assert.equal(alchemyComputeUnits("eth_getBlockByNumber"), 20);
  assert.equal(alchemyComputeUnits("eth_call"), 26);
  assert.equal(alchemyComputeUnits("eth_getLogs"), 60);
  assert.equal(alchemyComputeUnits("unreviewed_method"), 1000);
});

test("durable grants enforce workload allocation and preserve foreground reserve", async () => {
  const scope = await setup();
  const first = new PostgresRpcComputeBudget(
    db.runtime,
    scope,
    "order_projection",
    "background",
    20
  );
  const second = new PostgresRpcComputeBudget(
    db.runtime,
    scope,
    "order_projection",
    "background",
    20
  );
  await first.reserve("eth_call");
  await second.reserve("eth_call");
  await assert.rejects(first.reserve("eth_call"), exhausted);
  const foreground = new PostgresRpcComputeBudget(
    db.runtime,
    scope,
    "foreground",
    "foreground",
    20
  );
  await foreground.reserve("eth_getBlockByNumber");
  assert.equal(first.snapshot().usedCu, 26);
  assert.equal(first.snapshot().grantedCu, 26);
  const rows = await db.owner.query<{
    granted: string;
    background: string;
  }>(
    `SELECT granted_cu::text AS granted,background_granted_cu::text AS background
    FROM yunipals_market.rpc_compute_window WHERE scope=$1`,
    [scope]
  );
  assert.deepEqual(rows.rows[0], { granted: "72", background: "52" });
});

test("concurrent processes cannot cross the global background ceiling", async () => {
  const scope = await setup();
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      new PostgresRpcComputeBudget(
        db.runtime,
        scope,
        "order_projection",
        "background",
        20
      ).reserve("eth_getBlockByNumber")
    )
  );
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    3
  );
  const value = await db.owner.query<{ granted: string }>(
    "SELECT granted_cu::text AS granted FROM yunipals_market.rpc_compute_window WHERE scope=$1",
    [scope]
  );
  assert.equal(value.rows[0]!.granted, "60");
});

test("disabled policies block even provider-zero-cost methods", async () => {
  const disabled = await setup(false);
  await assert.rejects(
    new PostgresRpcComputeBudget(
      db.runtime,
      disabled,
      "order_projection",
      "background"
    ).reserve("eth_chainId"),
    exhausted
  );
});

test("free-provider authorization enforces the kill switch without granting CU", async () => {
  const scope = await setup();
  const budget = new PostgresRpcComputeBudget(
    db.runtime,
    scope,
    "order_projection",
    "background"
  );
  await budget.authorizeFreeDispatch();
  assert.deepEqual(budget.snapshot(), {
    model: "alchemy-2026-09-08",
    workload: "order_projection",
    priority: "background",
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
  const value = await db.owner.query(
    "SELECT count(*)::integer AS count FROM yunipals_market.rpc_compute_window WHERE scope=$1",
    [scope]
  );
  assert.equal(value.rows[0]!.count, 0);

  const disabled = await setup(false);
  await assert.rejects(
    new PostgresRpcComputeBudget(
      db.runtime,
      disabled,
      "order_projection",
      "background"
    ).authorizeFreeDispatch(),
    exhausted
  );
});

test("mismatched policy priorities fail before granting compute", async () => {
  const scope = await setup();
  await assert.rejects(
    new PostgresRpcComputeBudget(
      db.runtime,
      scope,
      "order_projection",
      "foreground"
    ).reserve("eth_call"),
    /priority differs/
  );
});

test("unused crash grants remain spent while a new UTC window starts independently", async () => {
  const scope = await setup();
  const crashed = new PostgresRpcComputeBudget(
    db.runtime,
    scope,
    "order_projection",
    "background",
    60
  );
  await crashed.reserve("eth_getBlockByNumber");
  assert.equal(crashed.snapshot().remainingCu, 40);
  await assert.rejects(
    new PostgresRpcComputeBudget(
      db.runtime,
      scope,
      "order_projection",
      "background",
      20
    ).reserve("eth_getBlockByNumber"),
    exhausted
  );

  const rolloverScope = await setup();
  await db.owner.query(
    `INSERT INTO yunipals_market.rpc_compute_window
      (scope,window_start,granted_cu,background_granted_cu)
    VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date-1,100,70)`,
    [rolloverScope]
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.rpc_compute_workload_window
      (scope,workload,window_start,granted_cu)
    VALUES($1,'order_projection',(clock_timestamp() AT TIME ZONE 'UTC')::date-1,70)`,
    [rolloverScope]
  );
  const current = new PostgresRpcComputeBudget(
    db.runtime,
    rolloverScope,
    "order_projection",
    "background",
    20
  );
  await current.reserve("eth_getBlockByNumber");
  assert.equal(current.snapshot().usedCu, 20);
});
