// Actual migrations and budget runtime in a new database on the retained local PG16 fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";

import { migrate } from "../src/db/migrate.ts";
import {
  PostgresRpcComputeBudget,
  RpcComputeBudgetError
} from "../src/opensea/rpcComputeBudget.ts";
import { configureUnifiedRpcAllocations } from "./configure-unified-rpc-allocations.ts";

const info = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "inspect",
      "yunipals-unified-indexer-test-20261020"
    ],
    { encoding: "utf8", timeout: 10000 }
  )
)[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const database = "unified_allocations_" + randomBytes(5).toString("hex");
const url = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new pg.Client({ connectionString: url("postgres") });
const pool = new pg.Pool({ connectionString: url(database), max: 3 });
const input = { scope: "local-allocations", sourceCu: "100", evidenceCu: "50" };
const checks = [];
let created = false;
try {
  await admin.connect();
  await admin.query(
    `CREATE DATABASE "${database}" OWNER unified_test TEMPLATE template0`
  );
  created = true;
  await migrate(pool, "staging");
  await pool.query(
    `INSERT INTO yunipals_market.opensea_request_budget
    (scope,all_per_hour,fulfillment_per_minute,publication_per_hour,enabled)
    VALUES($1,100,10,10,true)`,
    [input.scope]
  );
  await pool.query(
    `INSERT INTO yunipals_market.rpc_compute_budget
    VALUES($1,1000,200,true)`,
    [input.scope]
  );
  await pool.query(
    `INSERT INTO yunipals_market.rpc_compute_allocation
    VALUES($1,'source','background',200),($1,'foreground','foreground',200)`,
    [input.scope]
  );
  await pool.query(
    `INSERT INTO yunipals_market.rpc_compute_window
    VALUES($1,current_date,37,17)`,
    [input.scope]
  );
  const untouched = async () =>
    (
      await pool.query(
        `SELECT
    (SELECT to_jsonb(b) FROM yunipals_market.rpc_compute_budget b WHERE scope=$1) AS caps,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation a
      WHERE scope=$1 AND workload NOT IN ('unified_source','unified_evidence')) AS other,
    (SELECT jsonb_agg(to_jsonb(w)) FROM yunipals_market.rpc_compute_window w WHERE scope=$1) AS usage`,
        [input.scope]
      )
    ).rows[0];
  const before = await untouched();
  const review = await configureUnifiedRpcAllocations(pool, input);
  assert.equal(review.applied, false);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM yunipals_market.rpc_compute_allocation WHERE scope=$1",
        [input.scope]
      )
    ).rows[0].n,
    2
  );
  checks.push("inspection writes no allocations");
  await assert.rejects(
    configureUnifiedRpcAllocations(pool, input, "0x" + "0".repeat(64))
  );
  await configureUnifiedRpcAllocations(pool, input, review.reviewHash);
  assert.deepEqual(await untouched(), before);
  const rows = (
    await pool.query(
      "SELECT workload,priority,daily_cu::text FROM yunipals_market.rpc_compute_allocation WHERE scope=$1 AND workload LIKE 'unified_%' ORDER BY workload",
      [input.scope]
    )
  ).rows;
  assert.deepEqual(rows, review.allocations);
  checks.push(
    "only two missing rows inserted; all existing caps allocations and counters unchanged"
  );
  const repeat = await configureUnifiedRpcAllocations(pool, input);
  await configureUnifiedRpcAllocations(pool, input, repeat.reviewHash);
  assert.deepEqual(await untouched(), before);
  await assert.rejects(
    configureUnifiedRpcAllocations(pool, { ...input, sourceCu: "101" })
  );
  await assert.rejects(
    configureUnifiedRpcAllocations(pool, { ...input, evidenceCu: "49" })
  );
  await assert.rejects(
    configureUnifiedRpcAllocations(pool, { ...input, sourceCu: "800" })
  );
  checks.push(
    "idempotence and refusal of existing-limit changes or oversized requests"
  );
  const source = new PostgresRpcComputeBudget(
    pool,
    input.scope,
    "unified_source",
    "background",
    20
  );
  const evidence = new PostgresRpcComputeBudget(
    pool,
    input.scope,
    "unified_evidence",
    "background",
    20
  );
  await source.authorizeFreeDispatch();
  await evidence.authorizeFreeDispatch();
  await source.reserve("eth_getLogs");
  await assert.rejects(source.reserve("eth_getLogs"), RpcComputeBudgetError);
  await evidence.reserve("eth_call");
  await assert.rejects(evidence.reserve("eth_call"), RpcComputeBudgetError);
  checks.push(
    "genuine budget runtime authorizes both workloads and enforces both new CU limits"
  );
  await pool.query(
    "UPDATE yunipals_market.rpc_compute_budget SET enabled=false WHERE scope=$1",
    [input.scope]
  );
  await assert.rejects(configureUnifiedRpcAllocations(pool, input));
  await pool.query(
    "UPDATE yunipals_market.rpc_compute_budget SET enabled=true WHERE scope=$1",
    [input.scope]
  );
  const stale = await configureUnifiedRpcAllocations(pool, input);
  await pool.query(
    "UPDATE yunipals_market.rpc_compute_budget SET foreground_reserve_cu=201 WHERE scope=$1",
    [input.scope]
  );
  await assert.rejects(
    configureUnifiedRpcAllocations(pool, input, stale.reviewHash)
  );
  checks.push("disabled policy and changed review refuse");
  console.log(
    JSON.stringify({
      event: "unified_allocation_bootstrap_postgres_verified",
      checks
    })
  );
} finally {
  await pool.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
  await admin.end();
}
