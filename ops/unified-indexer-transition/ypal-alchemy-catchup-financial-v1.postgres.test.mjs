// Genuine disposable PG16 transactions. No production peer/provider invocation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url).pathname;
const require = createRequire(root + "apps/yunipals-indexer/package.json");
const { Pool } = require("pg");
const docker = (args) =>
  execFileSync(
    "/usr/bin/docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { encoding: "utf8", timeout: 15000 }
  );
const container = JSON.parse(
  docker(["inspect", "yunipals-unified-indexer-test-20261020"])
)[0];
assert.equal(container.Config.Image, "postgres:16.15");
assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const fixturePath =
  root +
  "ops/unified-indexer-transition/ypal-alchemy-catchup-financial-v1.test.py";
const py = (input) =>
  JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `import importlib.util,json,sys,types
s=importlib.util.spec_from_file_location('fixture',${JSON.stringify(fixturePath)});f=importlib.util.module_from_spec(s);s.loader.exec_module(f);m=f.m;x=json.load(sys.stdin)
def normalize(v):
 v['identity'].update(database='yunipals_market_production',user='postgres',session='postgres',port='15438',socket=True)
 return v
try:
 if x['mode']=='fixture':v={'before':f.fixture()[0],'profile':f.PROFILE,'snapshotSql':m.snapshot_sql()}
 elif x['mode']=='packetSql':
  spec=importlib.util.spec_from_file_location('owner',${JSON.stringify(root + "ops/unified-indexer-transition/ypal-alchemy-catchup-financial-v1.py")});o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o);packets=[]
  o.Client.observe(types.SimpleNamespace(send=packets.append,packet=lambda:None),m,x['assignXid']);v=packets[0]
 elif x['mode']=='plan':
  before=normalize(x['snapshot']);ranges=f.fixture()[1];ranges['observedAt']=__import__('datetime').datetime.fromtimestamp(before['clockMs']/1000,__import__('datetime').timezone.utc).isoformat()
  for row in ranges['chains'].values():row['headTimestamp']=before['clockMs']//1000
  v=m.plan(before,ranges,'d'*64,before['clockMs'],f.PROFILE)
 elif x['mode']=='writes':v=m.writes(x['plan'],x['phase'],normalize(x['snapshot'])if'snapshot'in x else None)
 elif x['mode']=='validate':v={'newBooked':m.validate_current(normalize(x['before']),normalize(x['current']),x['plan'],x.get('active',True))}
 elif x['mode']=='delta':v={'exact':{k:a for k,a in normalize(x['after']).items()if k!='clockMs'}=={k:a for k,a in m.expected_admitted(normalize(x['before']),x['plan']).items()if k!='clockMs'}}
 elif x['mode']=='closed':v=m.target_closed(normalize(x['before']),normalize(x['current']),x['plan'],x.get('utc',False))
 elif x['mode']=='utc':v=m.target_utc(normalize(x['current']),normalize(x['closed']),x['plan'])
 else:raise AssertionError('mode')
 print(json.dumps(v))
except RuntimeError as e:print(json.dumps({'refused':str(e)}))`
      ],
      {
        input: JSON.stringify(input),
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 16000000
      }
    )
  );
const suffix = randomBytes(5).toString("hex");
const dbname = "alchemy_financial_" + suffix;
const connectionString = (db) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + db;
const admin = new Pool({
  connectionString: connectionString("postgres"),
  max: 1
});
let pool;
let created = false;
const groups = [];
try {
  await admin.query(`CREATE DATABASE "${dbname}" TEMPLATE template0`);
  created = true;
  pool = new Pool({ connectionString: connectionString(dbname), max: 2 });
  const client = await pool.connect();
  try {
    const fixture = py({ mode: "fixture" });
    const migration = readFileSync(
      root + "apps/yunipals-market-api/src/db/migrations.ts",
      "utf8"
    );
    const ddl18 = migration.match(/version: 18,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    const ddl28 = migration.match(/version: 28,[\s\S]*?sql: `([\s\S]*?)`/)[1];
    await client.query(`CREATE SCHEMA yunipals_market;
      CREATE DOMAIN yunipals_market.hash AS text;
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
    const profileId = fixture.before.profiles[0].profile_id;
    await client.query(
      "INSERT INTO yunipals_market.unified_rpc_profile VALUES($1,'yunipals-opensea',$2,$3,true,clock_timestamp()+interval '10 days',clock_timestamp())",
      [profileId, fixture.before.profiles[0].manifest_hash, fixture.profile]
    );
    await client.query(
      "INSERT INTO yunipals_market.unified_rpc_replay_permit VALUES($1,$2,56,1,100,19000000,3983000,false,clock_timestamp()-interval '1 day',clock_timestamp()-interval '2 days')",
      [fixture.before.permits[0].permitId, profileId]
    );
    const snapshot = async () =>
      (await client.query(fixture.snapshotSql)).rows[0].jsonb_build_object;
    const before = await snapshot();
    await client.query("BEGIN READ ONLY");
    const actualPacket = (
      await client.query(py({ mode: "packetSql", assignXid: false }))
    ).rows[0].jsonb_build_object;
    assert.equal(actualPacket.backendPid, client.processID);
    assert.equal(actualPacket.xid, null);
    assert.deepEqual(actualPacket.snapshot.permits, before.permits);
    await client.query("ROLLBACK");
    groups.push(
      "actual owner packet SQL/read-only peer qualification without XID allocation"
    );
    const plan = py({ mode: "plan", snapshot: before });
    assert(!plan.refused, plan.refused);
    const sql = py({ mode: "writes", plan, phase: "admit" });
    groups.push("real baseline/profile/counter/catalog capture");
    await client.query("BEGIN");
    const xidRollback = (
      await client.query("SELECT pg_current_xact_id()::text AS xid")
    ).rows[0].xid;
    await client.query(sql);
    const rehearsal = await snapshot();
    assert.deepEqual(py({ mode: "delta", before, after: rehearsal, plan }), {
      exact: true
    });
    await client.query("ROLLBACK");
    assert.equal(
      (await client.query("SELECT pg_xact_status($1::xid8)AS s", [xidRollback]))
        .rows[0].s,
      "aborted"
    );
    const rollback = await snapshot();
    assert.deepEqual(rollback.permits, before.permits);
    assert.deepEqual(rollback.global, before.global);
    assert.deepEqual(rollback.allocations, before.allocations);
    groups.push("four inserts/two updates real ROLLBACK and aborted XID");
    await client.query("BEGIN");
    const xidCommit = (
      await client.query("SELECT pg_current_xact_id()::text AS xid")
    ).rows[0].xid;
    await client.query(sql);
    await client.query("COMMIT");
    assert.equal(
      (await client.query("SELECT pg_xact_status($1::xid8)AS s", [xidCommit]))
        .rows[0].s,
      "committed"
    );
    assert.deepEqual(
      py({ mode: "validate", before, current: await snapshot(), plan }),
      { newBooked: 0 }
    );
    groups.push("single COMMIT/read-only lost-ACK classification");
    const bnb = plan.permits.find((r) => r.chainId === 56);
    await client.query(
      "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,56,$3,$4,60)",
      [bnb.permitId, profileId, bnb.fromBlock, bnb.fromBlock]
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
    const budget = new PostgresRpcComputeBudget(
      pool,
      "yunipals-opensea",
      "unified_source",
      "background",
      1000
    );
    await budget.reserve("eth_getLogs");
    assert.equal(budget.snapshot().grantedCu, 1000);
    assert.equal(budget.snapshot().usedCu, 60);
    assert.deepEqual(
      py({ mode: "validate", before, current: await snapshot(), plan }),
      { newBooked: 1000 }
    );
    groups.push("actual reservation function and durable 1000-CU budget lease");
    for (const [label, mutation] of [
      [
        "foreign column ACL refuses",
        "GRANT SELECT(daily_cu)ON yunipals_market.rpc_compute_budget TO PUBLIC"
      ],
      [
        "other allocation increase refuses",
        "UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=daily_cu+1 WHERE workload='foreground'"
      ],
      [
        "old permit mutation refuses",
        `UPDATE yunipals_market.unified_rpc_replay_permit SET spent_cu=spent_cu+1 WHERE permit_id='${fixture.before.permits[0].permitId}'`
      ],
      [
        "counter refund refuses",
        "UPDATE yunipals_market.rpc_compute_workload_window SET granted_cu=granted_cu-1 WHERE workload='unified_source'AND window_start=current_date-2"
      ]
    ]) {
      await client.query("BEGIN");
      await client.query(mutation);
      assert(
        py({ mode: "validate", before, current: await snapshot(), plan })
          .refused
      );
      await client.query("ROLLBACK");
      groups.push(label);
    }
    await client.query("BEGIN");
    await client.query(
      "UPDATE yunipals_market.unified_rpc_replay_permit SET spent_cu=maximum_cu-10 WHERE permit_id=$1",
      [bnb.permitId]
    );
    await assert.rejects(
      client.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,56,$3,$4,60)",
        [bnb.permitId, profileId, bnb.fromBlock, bnb.fromBlock]
      ),
      /exhausted/
    );
    await client.query("ROLLBACK");
    groups.push("official maximum permit dispatch refuses overspend");
    const spent = await snapshot();
    const close = py({ mode: "writes", phase: "close", snapshot: spent, plan });
    await client.query("BEGIN");
    await client.query(close);
    await client.query("COMMIT");
    const closed = await snapshot();
    assert.equal(closed.global.dailyCu, "1001000");
    assert.equal(closed.global.foregroundReserveCu, "200000");
    assert.equal(
      closed.allocations.find((r) => r.workload === "unified_source").dailyCu,
      "26000"
    );
    assert.deepEqual(closed.windows, spent.windows);
    assert.deepEqual(closed.workloadWindows, spent.workloadWindows);
    assert(closed.permits.every((r) => !r.enabled));
    await assert.rejects(
      client.query(
        "SELECT yunipals_market.reserve_unified_rpc_replay($1,$2,56,$3,$4,60)",
        [bnb.permitId, profileId, bnb.fromBlock, bnb.fromBlock]
      ),
      /exhausted/
    );
    groups.push(
      "close disables only owned authority and preserves booked counters/headroom"
    );
    assert(
      py({ mode: "utc", current: closed, closed, plan }).refused,
      "early UTC restoration must refuse"
    );
    const future = structuredClone(closed);
    future.clockMs = plan.nextUtcMs + 1;
    const utcTarget = py({ mode: "utc", current: future, closed, plan });
    assert(!utcTarget.refused, utcTarget.refused);
    const utcSql = py({ mode: "writes", phase: "utc", snapshot: future, plan });
    await client.query("BEGIN");
    await client.query(utcSql);
    await client.query("COMMIT");
    const restored = await snapshot();
    assert.equal(restored.global.dailyCu, "1000000");
    assert.equal(
      restored.allocations.find((r) => r.workload === "unified_source").dailyCu,
      "25000"
    );
    assert.deepEqual(restored.workloadWindows, closed.workloadWindows);
    groups.push(
      "UTC guard and exact original policy restoration without counter reset"
    );
  } finally {
    client.release();
  }
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${dbname}" WITH(FORCE)`);
  await admin.end();
}
console.log(
  JSON.stringify({
    format: "yunipals-alchemy-financial-local-postgres-v1",
    passed: groups.length,
    groups,
    disposableCleanup: true,
    productionPeerQualified: false,
    productionCalls: 0,
    providerCalls: 0
  })
);
