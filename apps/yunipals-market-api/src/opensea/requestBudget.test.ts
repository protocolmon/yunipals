import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import {
  OpenSeaBudgetError,
  PostgresOpenSeaRequestBudget,
  createOpenSeaRequestBudget
} from "@/opensea/requestBudget";

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
      "opensea_request_metric_minute",
      "opensea_request_reservation",
      "opensea_request_endpoint_window",
      "opensea_request_window",
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

async function setup(all = 100, fulfillment = 5, publication = 30) {
  const scope = `test-${randomUUID()}`;
  scopes.push(scope);
  const sql = readFileSync(
    new URL("../../scripts/configure-opensea-budget.sql", import.meta.url),
    "utf8"
  )
    .replaceAll(":'budget_scope'", `'${scope}'`)
    .replaceAll(":'coordinator_id'", `'${randomUUID()}'`)
    .replaceAll(":'all_per_hour'", String(all))
    .replaceAll(":'fulfillment_per_minute'", String(fulfillment))
    .replaceAll(":'publication_per_hour'", String(publication));
  await db.owner.query(sql);
  return { scope, budget: new PostgresOpenSeaRequestBudget(db.runtime, scope) };
}

function exhausted(error: unknown) {
  return error instanceof OpenSeaBudgetError && error.retryAfterMs > 0;
}

async function advance(scope: string, milliseconds: number) {
  await db.owner.query(
    `UPDATE yunipals_market.opensea_request_budget_state
    SET clock_at=greatest(clock_at,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)+$2 WHERE scope=$1`,
    [scope, milliseconds]
  );
}

test("background fulfillment preserves atomic hourly and minute headroom for foreground requests", async () => {
  const { scope, budget } = await setup(10, 5);
  const background = () =>
    new PostgresOpenSeaRequestBudget(db.runtime, scope, {
      allPerHour: 3,
      fulfillmentPerMinute: 2
    });
  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, () => background().reserve("fulfillment"))
  );
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 3);
  await budget.reserve("fulfillment");
  await budget.reserve("fulfillment");
  await assert.rejects(background().reserve("fulfillment"), exhausted);
  await advance(scope, 60001);
  await background().reserve("fulfillment");
  await background().reserve("fulfillment");
  await assert.rejects(background().reserve("fulfillment"), exhausted);
  for (let i = 0; i < 3; i++) await budget.reserve("read");
  await assert.rejects(budget.reserve("read"), exhausted);
  const count = await db.owner.query(
    "SELECT count(*)::int AS n FROM yunipals_market.opensea_request_reservation WHERE scope=$1",
    [scope]
  );
  assert.equal(
    count.rows[0].n,
    10,
    "Denied background attempts do not consume reservations"
  );
});

test("endpoint windows are isolated while background cannot bypass their own undersized allowance", async () => {
  const { scope, budget } = await setup(10, 5);
  const background = new PostgresOpenSeaRequestBudget(db.runtime, scope, {
    allPerHour: 3,
    fulfillmentPerMinute: 2
  });
  const request = await budget.reserve("read");
  const reset = Math.floor(Date.now() / 1000) + 120;
  await budget.observe(request, {
    status: 200,
    headers: new Headers({
      "x-ratelimit-reset": String(reset),
      "x-ratelimit-remaining": "3",
      "x-ratelimit-limit": "10"
    })
  });
  await background.reserve("fulfillment");
  const fulfillment = await budget.reserve("fulfillment");
  await budget.observe(fulfillment, {
    status: 200,
    headers: new Headers({
      "x-ratelimit-reset": String(reset),
      "x-ratelimit-remaining": "1",
      "x-ratelimit-limit": "5"
    })
  });
  await assert.rejects(background.reserve("fulfillment"), exhausted);
  await advance(scope, 121000);
  await background.reserve("fulfillment");
  const disabled = new PostgresOpenSeaRequestBudget(db.runtime, scope, {
    allPerHour: 10,
    fulfillmentPerMinute: 5
  });
  await assert.rejects(disabled.reserve("fulfillment"), exhausted);
  for (const invalid of [-1, 0.5, NaN, Infinity])
    assert.throws(
      () =>
        new PostgresOpenSeaRequestBudget(db.runtime, scope, {
          allPerHour: invalid,
          fulfillmentPerMinute: 0
        })
    );
});

test("legacy aggregate provider windows remain readable during a rolling deployment", async () => {
  const { scope, budget } = await setup();
  const columns = await db.owner.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='yunipals_market'
      AND table_name IN ('opensea_request_window','opensea_request_endpoint_window')
      AND column_name='endpoint_class' ORDER BY table_name`
  );
  assert.deepEqual(columns.rows, [
    {
      table_name: "opensea_request_endpoint_window",
      column_name: "endpoint_class"
    }
  ]);
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_request_window(scope,reset_at,remaining)
    VALUES($1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint+120000,0)`,
    [scope]
  );
  await assert.rejects(budget.reserve("read", "listings"), exhausted);
  await advance(scope, 120001);
  await budget.reserve("read", "listings");
});

test("concurrent clients share an exact rolling allowance across restart and lost requests", async () => {
  const { scope } = await setup(7);
  const attempts = await Promise.allSettled(
    Array.from({ length: 30 }, () =>
      new PostgresOpenSeaRequestBudget(db.runtime, scope).reserve("read")
    )
  );
  assert.equal(
    attempts.filter((item) => item.status === "fulfilled").length,
    7
  );
  for (const result of attempts)
    if (result.status === "rejected") assert.ok(exhausted(result.reason));
  const restarted = new PostgresOpenSeaRequestBudget(db.runtime, scope);
  await assert.rejects(restarted.reserve("read"), exhausted);
  const count = await db.owner.query(
    "SELECT count(*)::integer AS count FROM yunipals_market.opensea_request_reservation WHERE scope=$1",
    [scope]
  );
  assert.equal(count.rows[0].count, 7);
  await advance(scope, 3600001);
  await restarted.reserve("read");
  const after = await db.owner.query(
    "SELECT count(*)::integer AS count FROM yunipals_market.opensea_request_reservation WHERE scope=$1",
    [scope]
  );
  assert.equal(after.rows[0].count, 1);
});

test("coordinator identity fences a same-named scope in another database", async () => {
  const { scope } = await setup(3);
  const row = await db.owner.query<{ coordinator_id: string }>(
    "SELECT coordinator_id::text FROM yunipals_market.opensea_request_budget WHERE scope=$1",
    [scope]
  );
  const coordinatorId = row.rows[0]!.coordinator_id;
  await new PostgresOpenSeaRequestBudget(
    db.runtime,
    scope,
    undefined,
    undefined,
    coordinatorId
  ).reserve("read");
  await assert.rejects(
    new PostgresOpenSeaRequestBudget(
      db.runtime,
      scope,
      undefined,
      undefined,
      randomUUID()
    ).reserve("read"),
    /coordinator identity mismatch/
  );
});

test("fulfillment and publication caps also consume the shared account allowance", async () => {
  const { scope, budget } = await setup(5, 2, 1);
  await budget.reserve("fulfillment");
  await budget.reserve("fulfillment");
  await assert.rejects(budget.reserve("fulfillment"), exhausted);
  await budget.reserve("publication");
  await assert.rejects(budget.reserve("publication"), exhausted);
  await budget.reserve("read");
  await advance(scope, 60001);
  await budget.reserve("fulfillment");
  await assert.rejects(budget.reserve("read"), exhausted);
});

test("provider headers tighten all clients, account for in-flight requests and never refill from late responses", async () => {
  const { scope, budget } = await setup();
  const first = await budget.reserve("read");
  const second = await budget.reserve("fulfillment");
  const reset = Math.floor(Date.now() / 1000) + 3600;
  const headers = (remaining: number) =>
    new Headers({
      "x-ratelimit-limit": "600",
      "x-ratelimit-reset": String(reset),
      "x-ratelimit-remaining": String(remaining)
    });
  await budget.observe(second, { status: 200, headers: headers(2) });
  // The pending first request may not yet have reached the provider.
  await budget.reserve("publication");
  await assert.rejects(budget.reserve("read"), exhausted);
  await budget.observe(first, { status: 200, headers: headers(599) });
  const restarted = new PostgresOpenSeaRequestBudget(db.runtime, scope);
  await assert.rejects(restarted.reserve("read"), exhausted);
  // A duplicate observation cannot restore tokens either.
  await budget.observe(second, { status: 200, headers: headers(600) });
  await assert.rejects(restarted.reserve("read"), exhausted);
  await advance(scope, 3601000);
  await restarted.reserve("read");
});

test("shared 429 backoff persists and is never shortened by a later response", async () => {
  const { scope, budget } = await setup();
  const first = await budget.reserve("read");
  const second = await budget.reserve("read");
  const reset = Math.floor(Date.now() / 1000) + 7200;
  await budget.observe(first, {
    status: 429,
    headers: new Headers({
      "retry-after": "2",
      "x-ratelimit-reset": String(reset)
    })
  });
  await budget.observe(second, {
    status: 429,
    headers: new Headers({ "retry-after": "1" })
  });
  await assert.rejects(
    new PostgresOpenSeaRequestBudget(db.runtime, scope).reserve("fulfillment"),
    (error: unknown) =>
      error instanceof OpenSeaBudgetError && error.retryAfterMs > 7100000
  );
  await advance(scope, 7201000);
  await budget.reserve("read");
});

test("minute and hourly provider windows expire independently without losing the longer allowance", async () => {
  const { scope, budget } = await setup();
  const now = Math.floor(Date.now() / 1000);
  const hourly = await budget.reserve("read");
  await budget.observe(hourly, {
    status: 200,
    headers: new Headers({
      "x-ratelimit-reset": String(now + 3600),
      "x-ratelimit-remaining": "3"
    })
  });
  const minute = await budget.reserve("fulfillment");
  await budget.observe(minute, {
    status: 200,
    headers: new Headers({
      "x-ratelimit-reset": String(now + 60),
      "x-ratelimit-remaining": "0"
    })
  });
  await assert.rejects(
    budget.reserve("read"),
    (error: unknown) =>
      error instanceof OpenSeaBudgetError && error.retryAfterMs <= 60000
  );
  await advance(scope, 60001);
  await budget.reserve("read");
  await budget.reserve("read");
  await assert.rejects(budget.reserve("read"), exhausted);
});

test("HTTP-date and missing-header backoffs fail closed while completed requests remain charged", async () => {
  for (const headers of [
    new Headers(),
    new Headers({ "retry-after": new Date(Date.now() + 120000).toUTCString() })
  ]) {
    const { budget } = await setup();
    const id = await budget.reserve("read");
    await budget.observe(id, { status: 429, headers });
    await assert.rejects(
      budget.reserve("read"),
      (error: unknown) =>
        error instanceof OpenSeaBudgetError && error.retryAfterMs > 59000
    );
  }
  const { budget } = await setup(1);
  const id = await budget.reserve("publication");
  await budget.observe(id, { status: 500, headers: new Headers() });
  await assert.rejects(budget.reserve("read"), exhausted);
});

test("missing, disabled and reduced budgets cannot be expanded by runtime clients", async () => {
  const { scope, budget } = await setup();
  await budget.reserve("read");
  await db.owner.query(
    "UPDATE yunipals_market.opensea_request_budget SET all_per_hour=1 WHERE scope=$1",
    [scope]
  );
  await assert.rejects(budget.reserve("read"), exhausted);
  await db.owner.query(
    "UPDATE yunipals_market.opensea_request_budget SET enabled=false WHERE scope=$1",
    [scope]
  );
  await assert.rejects(budget.reserve("read"), exhausted);
  await assert.rejects(
    db.runtime.query(
      "UPDATE yunipals_market.opensea_request_budget SET enabled=true WHERE scope=$1",
      [scope]
    ),
    /permission denied/
  );
  await assert.rejects(
    new PostgresOpenSeaRequestBudget(db.runtime, "missing-account").reserve(
      "read"
    ),
    /not provisioned/
  );
  assert.throws(() => createOpenSeaRequestBudget({}), /Configure/);
  assert.throws(
    () =>
      createOpenSeaRequestBudget({
        MARKET_OPENSEA_BUDGET_DATABASE_URL: "https://example.com",
        MARKET_OPENSEA_BUDGET_SCOPE: scope
      }),
    /Invalid/
  );
  assert.throws(
    () =>
      createOpenSeaRequestBudget({
        MARKET_DEPLOYMENT: "production",
        MARKET_OPENSEA_BUDGET_DATABASE_URL:
          "postgresql://budget:test@127.0.0.1:5432/market",
        MARKET_OPENSEA_BUDGET_SCOPE: scope
      }),
    /coordinator identity/
  );
});
