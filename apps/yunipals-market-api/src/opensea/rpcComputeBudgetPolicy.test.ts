import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import {
  PostgresRpcComputeBudget,
  RpcComputeBudgetError
} from "@/opensea/rpcComputeBudget";

function poolWithPolicy(
  enabled: boolean,
  priority: "background" | "foreground" = "background"
) {
  let queries = 0;
  const pool = {
    async query() {
      queries++;
      return {
        rows: [
          {
            enabled,
            configured_priority: priority,
            reset_at: String(Date.now() + 60_000)
          }
        ]
      };
    }
  } as unknown as pg.Pool;
  return { pool, queries: () => queries };
}

test("free dispatch checks policy without leasing paid compute", async () => {
  const source = poolWithPolicy(true);
  const budget = new PostgresRpcComputeBudget(
    source.pool,
    "test-scope",
    "source",
    "background"
  );
  await budget.authorizeFreeDispatch();
  await budget.authorizeFreeDispatch();
  assert.equal(source.queries(), 1);
  assert.deepEqual(budget.snapshot(), {
    model: "alchemy-2026-09-08",
    workload: "source",
    priority: "background",
    grantedCu: 0,
    usedCu: 0,
    remainingCu: 0,
    denied: 0
  });
});

test("free dispatch remains fail-closed when the operator disables RPC", async () => {
  const source = poolWithPolicy(false);
  const budget = new PostgresRpcComputeBudget(
    source.pool,
    "test-scope",
    "source",
    "background"
  );
  await assert.rejects(
    budget.authorizeFreeDispatch(),
    (error: unknown) =>
      error instanceof RpcComputeBudgetError && error.retryAfterMs > 0
  );
  assert.equal(source.queries(), 1);
  assert.equal(budget.snapshot().denied, 1);
});
