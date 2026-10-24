// Disposable PostgreSQL only. No production, service or provider invocation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url).pathname;
const require = createRequire(root + "apps/yunipals-indexer/package.json");
const { Pool } = require("pg");
const actual = JSON.parse(
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
assert.equal(actual.Config.Image, "postgres:16.15");
assert.deepEqual(actual.NetworkSettings.Ports["5432/tcp"], [
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
import importlib.util,json,sys,datetime,copy
s=importlib.util.spec_from_file_location('fixture',${JSON.stringify(root + "ops/unified-indexer-transition/ypal-alchemy-ordinary-plan-v1.test.py")});f=importlib.util.module_from_spec(s);s.loader.exec_module(f);p=f.p;m=p.model();x=json.load(sys.stdin)
def ranges(clock):
 r=f.fixture()[4];r['observedAt']=datetime.datetime.fromtimestamp(clock/1000,datetime.timezone.utc).isoformat()
 for v in r['chains'].values():v['headTimestamp']=clock//1000
 return r
try:
 if x['mode']=='fixture':v={'before':f.f.fixture()[0],'profile':f.f.PROFILE,'snapshotSql':m.snapshot_sql()}
 elif x['mode']=='oldplan':
  original=m.baseline
  def local_baseline(value,profile):
   t=copy.deepcopy(value);t['identity'].update(database='yunipals_market_production',user='postgres',session='postgres',port='15438',socket=True);return original(t,profile)
  m.baseline=local_baseline
  v=m.plan(x['before'],ranges(x['before']['clockMs']),'d'*64,x['before']['clockMs'],f.f.PROFILE)
 elif x['mode']=='oldsql':v=m.writes(x['plan'],x['phase'],x.get('current'))
 elif x['mode']=='plan':
  prepared={'before':x['before'],'plan':x['oldPlan']};closed={'phase':'close','committed':True,'preparedSha256':p.digest(prepared),'before':x['paid'],'after':x['closed']};r=ranges(x['closed']['clockMs']);b={k:'a'*64 for k in p.BINDINGS};b.update(catchupPreparedSha256=p.digest(prepared),catchupCloseSha256=p.digest(closed),rangeCaptureSha256=p.digest(r));v=p.plan(prepared,closed,x['closed'],f.f.PROFILE,r,b)
 elif x['mode']=='held':v=p.held_packet_sql(x['before'],x['plan'],x.get('phase','admit'),x.get('current'))
 elif x['mode']=='validate':v=p.validate_current(x['before'],x['current'],x['plan'])
 else:raise AssertionError('mode')
 print(json.dumps(v))
except RuntimeError as e:print(json.dumps({'refused':str(e)}))
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
const dbname = "ordinary_financial_" + randomBytes(5).toString("hex");
const connectionString = (db) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + db;
const admin = new Pool({
  connectionString: connectionString("postgres"),
  max: 1
});
let pool,
  created = false;
const checks = [];
const noClock = ({ clockMs, ...rest }) => rest;
try {
  await admin.query(`CREATE DATABASE "${dbname}" TEMPLATE template0`);
  created = true;
  pool = new Pool({ connectionString: connectionString(dbname), max: 3 });
  const client = await pool.connect();
  try {
    const fixture = py({ mode: "fixture" });
    const migration = readFileSync(
      root + "apps/yunipals-market-api/src/db/migrations.ts",
      "utf8"
    );
    const ddl18 = migration.match(/version: 18,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    const ddl28 = migration.match(/version: 28,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    await client.query(`CREATE SCHEMA yunipals_market;CREATE DOMAIN yunipals_market.hash AS text;
      CREATE TABLE yunipals_market.opensea_request_budget(scope text PRIMARY KEY,coordinator_id uuid,enabled boolean);
      INSERT INTO yunipals_market.opensea_request_budget VALUES('yunipals-opensea','${fixture.profile.coordinatorId}',true);`);
    await client.query(
      ddl18.slice(
        ddl18.indexOf("CREATE TABLE yunipals_market.rpc_compute_budget")
      )
    );
    await client.query(ddl28);
    await client.query(
      "INSERT INTO yunipals_market.rpc_compute_budget VALUES('yunipals-opensea',1000000,200000,true)"
    );
    for (const row of fixture.before.allocations)
      await client.query(
        "INSERT INTO yunipals_market.rpc_compute_allocation VALUES('yunipals-opensea',$1,$2,$3)",
        [row.workload, row.priority, row.dailyCu]
      );
    await client.query(
      "INSERT INTO yunipals_market.rpc_compute_window VALUES('yunipals-opensea',current_date-2,4547000,4547000);INSERT INTO yunipals_market.rpc_compute_workload_window VALUES('yunipals-opensea','unified_source',current_date-2,4547000)"
    );
    await client.query(
      "INSERT INTO yunipals_market.unified_rpc_profile VALUES($1,'yunipals-opensea',$2,$3,true,'2026-11-19T18:00:00Z',clock_timestamp())",
      [
        fixture.before.profiles[0].profile_id,
        fixture.before.profiles[0].manifest_hash,
        fixture.profile
      ]
    );
    const snapshot = async () =>
      (await client.query(fixture.snapshotSql)).rows[0].jsonb_build_object;
    const before = await snapshot();
    const oldPlan = py({ mode: "oldplan", before });
    assert(!oldPlan.refused, oldPlan.refused);
    await client.query(py({ mode: "oldsql", plan: oldPlan, phase: "admit" }));
    await client.query(
      "INSERT INTO yunipals_market.rpc_compute_window VALUES('yunipals-opensea',current_date,100000,100000);INSERT INTO yunipals_market.rpc_compute_workload_window VALUES('yunipals-opensea','unified_source',current_date,100000)"
    );
    const paid = await snapshot();
    await client.query(
      py({ mode: "oldsql", plan: oldPlan, phase: "close", current: paid })
    );
    const closed = await snapshot();
    assert.equal(closed.global.dailyCu, "1100000");
    const plan = py({ mode: "plan", before, oldPlan, paid, closed });
    assert(!plan.refused, plan.refused);
    checks.push(
      "actual frozen close produces additive current-day rows; ordinary plan preserves bookings"
    );
    const held = py({ mode: "held", before: closed, plan });
    assert.equal(typeof held, "string");
    assert(!held.includes("COMMIT;"));
    const packet = (await client.query(held)).at(-1).rows[0].jsonb_build_object;
    assert.equal(packet.transactionHeld, true);
    assert.equal(packet.backendPid, client.processID);
    assert.equal(
      (
        await pool.query(
          "SELECT daily_cu::text AS n FROM yunipals_market.rpc_compute_budget"
        )
      ).rows[0].n,
      "1100000"
    );
    await client.query("ROLLBACK");
    assert.equal(
      (await client.query("SELECT pg_xact_status($1::xid8)AS s", [packet.xid]))
        .rows[0].s,
      "aborted"
    );
    assert.deepEqual(noClock(await snapshot()), noClock(closed));
    checks.push(
      "held XID changes are invisible externally and rehearsal fully rolls back"
    );
    await client.query(
      "BEGIN ISOLATION LEVEL SERIALIZABLE;GRANT SELECT(daily_cu)ON yunipals_market.rpc_compute_budget TO PUBLIC"
    );
    await assert.rejects(
      client.query(held.slice(held.indexOf(";") + 1)),
      /ordinary_exact_financial_snapshot_changed/
    );
    await client.query("ROLLBACK");
    assert.deepEqual(noClock(await snapshot()), noClock(closed));
    checks.push(
      "stale complete column ACL blocks the exact generated transaction"
    );
    const committed = (await client.query(held)).at(-1).rows[0]
      .jsonb_build_object;
    await client.query("COMMIT");
    assert.equal(
      (
        await client.query("SELECT pg_xact_status($1::xid8)AS s", [
          committed.xid
        ])
      ).rows[0].s,
      "committed"
    );
    assert.equal(
      py({ mode: "validate", before: closed, current: await snapshot(), plan }),
      true
    );
    await assert.rejects(
      client.query(held),
      /ordinary_exact_financial_snapshot_changed/
    );
    await client.query("ROLLBACK");
    checks.push(
      "one commit, readonly lost-ACK XID classification, repeated admission refused"
    );
    const polygon = plan.permits.find((p) => p.chainId === 137);
    await client.query("BEGIN");
    for (let i = 0; i < 21; i++)
      await client.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,137,$3,$3,100000)",
        [polygon.permitId, polygon.profileId, polygon.fromBlock]
      );
    assert.equal(
      (
        await client.query(
          "SELECT spent_cu::text AS n FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=$1",
          [polygon.permitId]
        )
      ).rows[0].n,
      "2100000"
    );
    await client.query("ROLLBACK");
    checks.push(
      "actual permit function has no old 2M Polygon lifetime partition (daily gate remains separate)"
    );
    registerHooks({
      resolve(specifier, context, next) {
        if (
          specifier === "@/db/pool" &&
          context.parentURL ===
            pathToFileURL(
              root + "apps/yunipals-market-api/src/opensea/rpcComputeBudget.ts"
            ).href
        )
          return next(
            pathToFileURL(root + "apps/yunipals-market-api/src/db/pool.ts")
              .href,
            context
          );
        return next(specifier, context);
      }
    });
    const { PostgresRpcComputeBudget } = await import(
      pathToFileURL(
        root + "apps/yunipals-market-api/src/opensea/rpcComputeBudget.ts"
      )
    );
    for (const chain of [1, 56, 137, 8453]) {
      const budget = new PostgresRpcComputeBudget(
        pool,
        "yunipals-opensea",
        "unified_source",
        "background",
        1000
      );
      await budget.reserve("eth_getBlockByNumber");
      assert.equal(budget.snapshot().grantedCu, 1000);
    }
    assert.equal(
      (
        await client.query(
          "SELECT granted_cu::text AS n FROM yunipals_market.rpc_compute_workload_window WHERE workload='unified_source'AND window_start=current_date"
        )
      ).rows[0].n,
      "104000"
    );
    checks.push(
      "four independent actual proxy budget instances book into one shared source row"
    );
    await client.query(
      "UPDATE yunipals_market.rpc_compute_workload_window SET granted_cu=1499000 WHERE workload='unified_source'AND window_start=current_date;UPDATE yunipals_market.rpc_compute_window SET granted_cu=1499000,background_granted_cu=1499000 WHERE window_start=current_date"
    );
    const first = new PostgresRpcComputeBudget(
      pool,
      "yunipals-opensea",
      "unified_source",
      "background",
      1000
    );
    const second = new PostgresRpcComputeBudget(
      pool,
      "yunipals-opensea",
      "unified_source",
      "background",
      1000
    );
    await first.reserve("eth_getBlockByNumber");
    await assert.rejects(second.reserve("eth_getBlockByNumber"), /budget/i);
    assert.equal(
      (
        await client.query(
          "SELECT granted_cu::text AS n FROM yunipals_market.rpc_compute_workload_window WHERE workload='unified_source'AND window_start=current_date"
        )
      ).rows[0].n,
      "1500000"
    );
    checks.push(
      "aggregate 1.5M daily source ceiling refuses another chain without partitioning"
    );
    const spent = await snapshot();
    assert.equal(
      py({ mode: "validate", before: closed, current: spent, plan }),
      true
    );
    const inverse = py({
      mode: "held",
      before: closed,
      current: spent,
      plan,
      phase: "inverse"
    });
    assert.equal(typeof inverse, "string");
    await client.query(inverse);
    await client.query("COMMIT");
    const restored = await snapshot();
    assert.deepEqual(restored.windows, spent.windows);
    assert.deepEqual(restored.workloadWindows, spent.workloadWindows);
    assert(!restored.permits.some((p) => p.enabled));
    assert.equal(restored.global.dailyCu, "2000000");
    checks.push(
      "inverse disables only owned permits, preserves every booking and cannot enlarge new shared ceiling"
    );
  } finally {
    client.release();
  }
  console.log(
    JSON.stringify({
      format: "yunipals-alchemy-ordinary-plan-postgres-v1",
      passed: true,
      checks,
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${dbname}"`);
  await admin.end();
}
