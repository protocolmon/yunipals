// Disposable local PostgreSQL verifies the V6 event SQL and acceptance gate.
// Fixture rows are unit evidence only; they never become business receipts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(root + "/apps/yunipals-indexer/package.json");
const { Pool } = require("pg");
const docker = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "inspect",
      "yunipals-unified-indexer-test-20261020"
    ],
    { encoding: "utf8" }
  )
)[0];
assert.equal(docker.Config.Image, "postgres:16.15");
assert.deepEqual(docker.Mounts, []);
assert.deepEqual(docker.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const db = "feature_event_" + randomBytes(5).toString("hex");
const url = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Pool({ connectionString: url("postgres"), max: 1 });
const event = {
  blockNumber: 101,
  blockHash: "0x" + "1".repeat(64),
  transactionHash: "0x" + "2".repeat(64),
  logIndex: 0
};
const row = {
  id: "fixture-event",
  address: "0x" + "3".repeat(40),
  name: "RequestCreated",
  args: '{"opening":true}',
  block_number: event.blockNumber,
  block_hash: event.blockHash,
  timestamp: 1000,
  transaction_hash: event.transactionHash,
  log_index: event.logIndex
};
function gate(responses, identity = event) {
  return JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `import importlib.util,json,sys,types
from pathlib import Path
p=Path(${JSON.stringify(root)})/'ops/unified-indexer-transition/ypal-ordinary-feature-handover-v6.test.py'
s=importlib.util.spec_from_file_location('feature_fixture',p);f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
x=json.load(sys.stdin);answers=iter(x['responses']);queries=[]
def query(sql):queries.append(sql);return next(answers)
h=types.SimpleNamespace(b=f.m,query=query,native=lambda *args:None)
try:
 result=f.context.HostMixin.fresh_event(h,x['event'],100)
 print(json.dumps({'accepted':True,'queries':queries,'event':result}))
except RuntimeError as error:print(json.dumps({'accepted':False,'queries':queries,'code':str(error)}))`
      ],
      { input: JSON.stringify({ responses, event: identity }), encoding: "utf8" }
    )
  );
}
const frozen = { left: 1, right: 1, canonical: event.blockHash };
const generated = gate([{ left: [row], right: [row] }, frozen]);
assert.equal(generated.accepted, true);
assert.equal(generated.queries.length, 2);
const fresh = "yunipals_boosters_ypal_v1";
const target = "unified_ypal_20261023_v1";
let pool;
let created = false;
try {
  await admin.query(`CREATE DATABASE ${db} OWNER unified_test TEMPLATE template0`);
  created = true;
  pool = new Pool({ connectionString: url(db), max: 1 });
  for (const schema of [fresh, target]) {
    await pool.query(`CREATE SCHEMA ${schema};CREATE TABLE ${schema}.booster_event(
      id text PRIMARY KEY,address text NOT NULL,name text NOT NULL,args text NOT NULL,
      block_number numeric(78,0) NOT NULL,block_hash text NOT NULL,timestamp numeric(78,0) NOT NULL,
      transaction_hash text NOT NULL,log_index integer NOT NULL)`);
    await pool.query(
      `INSERT INTO ${schema}.booster_event VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      Object.values(row)
    );
  }
  await pool.query(
    `CREATE TABLE ${target}.chain_block(chain_id bigint,block_number numeric(78,0),block_hash text)`
  );
  await pool.query(`INSERT INTO ${target}.chain_block VALUES(8453,101,$1)`, [
    event.blockHash
  ]);
  const observe = async () => {
    const responses = [];
    for (const sql of generated.queries) {
      responses.push((await pool.query(sql)).rows[0].jsonb_build_object);
    }
    return gate(responses);
  };
  assert.equal((await observe()).accepted, true);
  for (const schema of [fresh, target]) {
    await pool.query(`UPDATE ${schema}.booster_event SET name='RequestCompleted'`);
  }
  assert.equal((await observe()).accepted, true);
  for (const schema of [fresh, target]) {
    await pool.query(`UPDATE ${schema}.booster_event SET name='TypeActivated'`);
  }
  assert.equal((await observe()).accepted, false);
  for (const schema of [fresh, target]) {
    await pool.query(`UPDATE ${schema}.booster_event SET name='RequestCreated'`);
  }
  await pool.query(`UPDATE ${target}.booster_event SET args='{"opening":false}'`);
  assert.equal((await observe()).accepted, false);
  await pool.query(`UPDATE ${target}.booster_event SET args=$1`, [row.args]);
  await pool.query(
    `INSERT INTO ${target}.booster_event SELECT 'duplicate',address,name,args,block_number,block_hash,timestamp,transaction_hash,log_index FROM ${target}.booster_event`
  );
  assert.equal((await observe()).accepted, false);
  await pool.query(`DELETE FROM ${target}.booster_event WHERE id='duplicate'`);
  await pool.query(`UPDATE ${target}.chain_block SET block_hash=$1`, [
    "0x" + "f".repeat(64)
  ]);
  assert.equal((await observe()).accepted, false);
  const preswitch = gate([], { ...event, blockNumber: 100 });
  assert.equal(preswitch.accepted, false);
  assert.deepEqual(preswitch.queries, []);
  console.log(
    JSON.stringify({
      passed: true,
      groups: 7,
      actualV6EventSql: true,
      productionCalls: 0,
      providerCalls: 0,
      genuineBusinessEventEvidence: false
    })
  );
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE ${db}`);
  await admin.end();
}
