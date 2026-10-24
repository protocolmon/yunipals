// Exact frozen Client observation and financial-only disable SQL on local PG.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("../../", import.meta.url).pathname;
const require = createRequire(root + "apps/yunipals-indexer/package.json");
const { Pool } = require("pg");
const container = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "inspect",
      "yunipals-unified-indexer-test-20261020"
    ],
    { encoding: "utf8", timeout: 15000 }
  )
)[0];
assert.equal(container.Config.Image, "postgres:16.15");
assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const py = (input) =>
  JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `
import importlib.util,json,sys,types
from pathlib import Path
base=Path(${JSON.stringify(root + "ops/unified-indexer-transition")})
def load(name):
 s=importlib.util.spec_from_file_location(name,base/name);v=importlib.util.module_from_spec(s);s.loader.exec_module(v);return v
f=load('ypal-alchemy-ordinary-plan-v1.test.py');o=load('ypal-alchemy-ordinary-financial-v1.py');client=load('ypal-alchemy-catchup-financial-v1.py');m=f.p.model();inputs=f.fixture();proposal=f.p.plan(*inputs);x=json.load(sys.stdin)
if x['mode']=='fixture':v={'proposal':proposal,'profile':inputs[3],'allocations':inputs[2]['allocations']}
elif x['mode']=='observe':
 lines=[];client.Client.observe(types.SimpleNamespace(send=lines.append,packet=lambda:None),m,x['assignXid']);v=lines[0]
elif x['mode']=='disable':
 expected,sql=o.disable_delta(m,proposal,x['current']);v={'expected':expected,'sql':sql}
else:raise AssertionError('fixed mode')
print(json.dumps(v))
`
      ],
      {
        input: JSON.stringify(input),
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 16000000
      }
    )
  );
const connectionString = (db) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + db;
const db = "ordinary_owner_" + randomBytes(5).toString("hex");
const admin = new Pool({
  connectionString: connectionString("postgres"),
  max: 1
});
const noClock = ({ clockMs, ...rest }) => rest;
const checks = [];
let pool,
  created = false;
try {
  await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
  created = true;
  pool = new Pool({ connectionString: connectionString(db), max: 3 });
  const client = await pool.connect();
  try {
    const fixture = py({ mode: "fixture" });
    const source = readFileSync(
      root + "apps/yunipals-market-api/src/db/migrations.ts",
      "utf8"
    );
    const budget = source.match(/version: 18,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    const permits = source.match(/version: 28,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    await client.query(`CREATE SCHEMA yunipals_market;CREATE DOMAIN yunipals_market.hash AS text;
      CREATE TABLE yunipals_market.opensea_request_budget(scope text PRIMARY KEY,coordinator_id uuid,enabled boolean);
      INSERT INTO yunipals_market.opensea_request_budget VALUES('yunipals-opensea','${fixture.profile.coordinatorId}',true);`);
    await client.query(
      budget.slice(
        budget.indexOf("CREATE TABLE yunipals_market.rpc_compute_budget")
      )
    );
    await client.query(permits);
    await client.query(
      "INSERT INTO yunipals_market.rpc_compute_budget VALUES('yunipals-opensea',2000000,200000,true)"
    );
    for (const row of fixture.allocations)
      await client.query(
        "INSERT INTO yunipals_market.rpc_compute_allocation VALUES('yunipals-opensea',$1,$2,$3)",
        [
          row.workload,
          row.priority,
          row.workload === "unified_source" ? "1500000" : row.dailyCu
        ]
      );
    await client.query(
      "INSERT INTO yunipals_market.rpc_compute_window VALUES('yunipals-opensea',current_date,1000,1000);INSERT INTO yunipals_market.rpc_compute_workload_window VALUES('yunipals-opensea','unified_source',current_date,1000)"
    );
    const profile = fixture.proposal.profileId;
    await client.query(
      "INSERT INTO yunipals_market.unified_rpc_profile VALUES($1,'yunipals-opensea',$2,$3,true,'2026-11-19T18:00:00Z',clock_timestamp())",
      [profile, fixture.proposal.manifestHash, fixture.profile]
    );
    for (const p of fixture.proposal.permits)
      await client.query(
        "INSERT INTO yunipals_market.unified_rpc_replay_permit VALUES($1,$2,$3,$4,$5,$6,20,true,to_timestamp($7::numeric/1000),to_timestamp($8::numeric/1000))",
        [
          p.permitId,
          profile,
          p.chainId,
          p.fromBlock,
          p.throughBlock,
          p.maximumCu,
          p.expiresMs,
          p.reviewedMs
        ]
      );
    const prior = "0x" + "f".repeat(64);
    await client.query(
      "INSERT INTO yunipals_market.unified_rpc_replay_permit VALUES($1,$2,56,1,100,10000,1234,false,clock_timestamp()-interval '1 day',clock_timestamp()-interval '2 days')",
      [prior, profile]
    );
    const packetSql = py({ mode: "observe", assignXid: true });
    const readSql = py({ mode: "observe", assignXid: false });
    const observe = async () =>
      (await client.query(readSql)).rows[0].jsonb_build_object;
    await client.query("BEGIN READ ONLY");
    const initial = await observe();
    assert.equal(initial.xid, null);
    await client.query("ROLLBACK");
    checks.push("exact frozen Client read-only observation allocates no XID");
    const delta = py({ mode: "disable", current: initial.snapshot });
    assert.equal(delta.sql.match(/UPDATE/g).length, 1);
    assert(!delta.sql.includes("rpc_compute_"));
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const rehearsal = (await client.query(packetSql)).rows[0]
      .jsonb_build_object;
    await client.query(delta.sql);
    const held = (await client.query(packetSql)).rows[0].jsonb_build_object;
    assert.equal(rehearsal.xid, held.xid);
    assert.equal(held.backendPid, client.processID);
    assert.equal(held.backendStart, rehearsal.backendStart);
    assert.deepEqual(noClock(held.snapshot), noClock(delta.expected));
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM yunipals_market.unified_rpc_replay_permit WHERE enabled"
        )
      ).rows[0].n,
      4
    );
    await client.query("ROLLBACK");
    assert.equal(
      (await client.query("SELECT pg_xact_status($1::xid8)AS s", [held.xid]))
        .rows[0].s,
      "aborted"
    );
    assert.deepEqual(
      noClock((await observe()).snapshot),
      noClock(initial.snapshot)
    );
    checks.push(
      "actual owner disable SQL stays private in one held XID and rolls back exactly"
    );
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const commit = (await client.query(packetSql)).rows[0].jsonb_build_object;
    await client.query(delta.sql);
    const concurrent = await pool.connect();
    try {
      const p = fixture.proposal.permits[0];
      const pending = concurrent.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,$3,$4,$4,20)",
        [p.permitId, profile, p.chainId, p.fromBlock]
      );
      const outcome = pending.then(
        () => ({ accepted: true }),
        (error) => ({ accepted: false, message: error.message })
      );
      let locked = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        locked =
          (
            await pool.query(
              "SELECT wait_event_type='Lock'AS waiting FROM pg_stat_activity WHERE pid=$1",
              [concurrent.processID]
            )
          ).rows[0]?.waiting === true;
        if (locked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(locked, true);
      await client.query("COMMIT");
      const rejected = await outcome;
      assert.equal(rejected.accepted, false);
      assert.match(rejected.message, /unavailable or exhausted/);
    } finally {
      concurrent.release();
    }
    checks.push(
      "concurrent real reservation waits for disable then refuses without spend"
    );
    assert.equal(
      (await client.query("SELECT pg_xact_status($1::xid8)AS s", [commit.xid]))
        .rows[0].s,
      "committed"
    );
    const final = (await observe()).snapshot;
    assert.deepEqual(noClock(final), noClock(delta.expected));
    assert.equal(
      final.permits.find((p) => p.permitId === prior).spentCu,
      "1234"
    );
    assert.equal(final.global.dailyCu, "2000000");
    assert.equal(
      final.allocations.find((r) => r.workload === "unified_source").dailyCu,
      "1500000"
    );
    checks.push(
      "read-only committed-XID reconciliation preserves all budgets, counters, old permits and ACLs"
    );
  } finally {
    client.release();
  }
  console.log(
    JSON.stringify({
      format: "yunipals-alchemy-ordinary-financial-postgres-v1",
      passed: true,
      checks,
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${db}"`);
  await admin.end();
}
