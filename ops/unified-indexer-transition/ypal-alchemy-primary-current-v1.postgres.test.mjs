// Read-only disposable PG16 regression: no production peer or provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = new URL("../../", import.meta.url).pathname;
const require = createRequire(root + "apps/yunipals-indexer/package.json");
const { Client } = require("pg");
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
const fixture =
  root +
  "ops/unified-indexer-transition/ypal-alchemy-primary-current-v1.test.py";
const actualLeaf = (input) =>
  JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `
import importlib.util,json,sys,unittest
s=importlib.util.spec_from_file_location('actual_fixture',${JSON.stringify(fixture)})
f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
t=unittest.TestCase();x=json.load(sys.stdin)
try:
 a=f.Fixture(t,{'base':'paid-stopped'});statements=[]
 if 'owned' in x:
  p=a.v.BASE/'base-paid-stop-intent.json';i=json.loads(p.read_bytes());i['ownedBackends']=x['owned']
  q=a.v.BASE/'base-paid-stopped.json';j=json.loads(q.read_bytes());j['intentSha256']=a.put(p,i)
  a.quiet['routes']['base']['paidStopResultSha256']=a.put(q,j);a.save_quiet()
 def query(sql):
  statements.append(sql);return x.get('current',[])
 a.m.query=query
 try:r=a.validate()
 except RuntimeError as e:r={'refused':str(e)}
 print(json.dumps({'result':r,'sql':statements}))
finally:t.doCleanups()
`
      ],
      {
        input: JSON.stringify(input),
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 100000
      }
    )
  );
const client = new Client({
  connectionString:
    "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres"
});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SET LOCAL timezone='UTC'");
  const sql = actualLeaf({}).sql[0];
  assert.ok(sql.includes("'backendStart',backend_start::text"));
  // Only the role predicate is adapted to this still-live disposable client.
  const localSql = sql.replace(
    "WHERE usesysid=16394",
    "WHERE pid=pg_backend_pid()"
  );
  assert.notEqual(localSql, sql);
  const current = (await client.query(localSql)).rows[0].coalesce;
  const native = (
    await client.query(localSql.replace("backend_start::text", "backend_start"))
  ).rows[0].coalesce;
  assert.equal(current.length, 1);
  assert.equal(current[0].pid, native[0].pid);
  assert.notEqual(native[0].backendStart, current[0].backendStart);
  assert.match(native[0].backendStart, /^\d{4}-\d\d-\d\dT/);
  assert.match(current[0].backendStart, /^\d{4}-\d\d-\d\d /);
  // Reproduce the old false-negative with genuine server projections, then
  // execute the fixed real leaf against exactly the same live backend epoch.
  assert.equal(
    actualLeaf({ owned: current, current: native }).result.validated,
    true
  );
  assert.match(
    actualLeaf({ owned: current, current }).result.refused,
    /backend_epochs_must_be_drained/
  );
  await client.query("ROLLBACK");
  console.log(
    JSON.stringify({
      passed: true,
      groups: 1,
      genuinePgTimestampMismatch: true,
      actualLeafRefusedLiveTextTuple: true,
      databaseWrites: 0,
      providerCalls: 0,
      hostActions: 0
    })
  );
} finally {
  await client.end();
}
