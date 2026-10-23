// Actual finite SQL in the existing local disposable PostgreSQL16 fixture only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = "/root/yunipals";
const { Pool } = createRequire(root + "/apps/yunipals-indexer/package.json")("pg");
const suffix = randomBytes(5).toString("hex");
const database = "feature_handover_" + suffix, reader = "feature_reader_" + suffix;
const old = "yunipals_boosters_launch_v1", target = "unified_shadow_20261020_7e7375b0";
const graph = JSON.parse(await readFile(root + "/ops/unified-indexer-transition/consumer-owned-booster-graph-v1.json", "utf8"));
const names = ["_ponder_meta", "_ponder_checkpoint", "booster_type", "booster_original", "booster_request", "booster_monster", "booster_refund", "booster_engine_state", "booster_checkpoint", "booster_event"];
const admin = new Pool({ connectionString: "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres", max: 1 });
let db, created = false, roleCreated = false;
const bridge = String.raw`
import copy,importlib.util,json,sys
from pathlib import Path
p=Path('/root/yunipals/ops/unified-indexer-transition/booster-feature-handover-v6.py')
s=importlib.util.spec_from_file_location('owner',p);h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
v=json.load(sys.stdin)
if v['action']=='snapshot':print(json.dumps({'sql':h.snapshot_sql()}));raise SystemExit
if v['action']=='fresh':
 p2=p.with_name('booster-source-parity-v2.py');s2=importlib.util.spec_from_file_location('parity',p2);parity=importlib.util.module_from_spec(s2);s2.loader.exec_module(parity)
 host=h.Host.__new__(h.Host);host.parity=parity;queries=[];host.query=lambda text:queries.append(text)or v['result']
 try:host.fresh_event(v['event'],v['boundary']);print(json.dumps({'valid':True,'sql':queries[0]}))
 except RuntimeError as e:print(json.dumps({'valid':False,'code':str(e),'sql':queries[0]if queries else None}))
 raise SystemExit
if v['action']=='routes':
 s2=importlib.util.spec_from_file_location('routes',p.with_name('booster-source-parity-v2.py'));r=importlib.util.module_from_spec(s2);s2.loader.exec_module(r)
 print(json.dumps({'sql':r.route_sql('routes_left','routes_right',v['boundary'])}));raise SystemExit
h.ROLE=v['reader'];h.ROLE_OID=v['readerOid'];h.OWNER_OID=v['ownerOid'];h.TARGET_OID=v['targetOid'];h.TARGET_OIDS=v['targetOids']
if v['action']=='validate':
 current=copy.deepcopy(v['value']);current['identity']={'database':'yunipals_backfill','socket':True}
 try:h.validate_snapshot(current,v['graph'],v['admitted']);print(json.dumps({'valid':True}))
 except RuntimeError as e:print(json.dumps({'valid':False,'code':str(e)}))
else:
 after=h.after_eight_reads(v['before'],v.get('remove',False))
 print(json.dumps({'after':after,'sql':h.grant_sql(v['before'],after,v.get('commit',False),v.get('remove',False))}))
`;
function python(value) {
  const result = spawnSync("python3", ["-c", bridge], { input: JSON.stringify(value), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
try {
  await admin.query(`CREATE DATABASE ${database} OWNER unified_test`); created = true;
  db = new Pool({ connectionString: `postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/${database}`, max: 1 });
  await admin.query(`CREATE ROLE ${reader} LOGIN NOINHERIT CONNECTION LIMIT 6`); roleCreated = true;
  for (const schema of [old, target]) {
    await db.query(`CREATE SCHEMA ${schema}`);
    for (const { name } of graph.tables) await db.query(`CREATE TABLE ${schema}.${name}(id text)`);
  }
  await db.query(`GRANT USAGE ON SCHEMA ${old},${target} TO ${reader};GRANT SELECT ON ${names.map((name) => old + "." + name).join(",")} TO ${reader};GRANT SELECT ON ${target}._ponder_meta,${target}._ponder_checkpoint TO ${reader}`);
  const adapt = (sql) => sql.replaceAll("yunipals_unified_collector", reader);
  const query = adapt(python({ action: "snapshot" }).sql);
  const snapshot = async () => (await db.query(query)).rows[0].jsonb_build_object;
  const before = await snapshot();
  const oldSchema = before.schemas.find((row) => row.name === old), targetSchema = before.schemas.find((row) => row.name === target);
  const fixtureGraph = { ...graph, schemaOid: oldSchema.oid, ownerOid: oldSchema.owner,
    tables: before.tables.filter((row) => row.schema === old).map(({ name, oid, owner }) => ({ name, oid, owner })) };
  const physical = { reader, readerOid: before.role.oid, ownerOid: targetSchema.owner, targetOid: targetSchema.oid,
    targetOids: Object.fromEntries(before.tables.filter((row) => row.schema === target && names.includes(row.name)).map((row) => [row.name, row.oid])), graph: fixtureGraph };
  const validate = (value, admitted) => python({ ...physical, action: "validate", value, admitted });
  assert.deepEqual(validate(before, false), { valid: true });
  const rehearsal = python({ ...physical, action: "compile", before });
  assert.equal((rehearsal.sql.match(/GRANT SELECT ON TABLE/g) || []).length, 8);
  assert(!rehearsal.sql.includes("ALTER ROLE"));
  await db.query(adapt(rehearsal.sql)); assert.deepEqual(await snapshot(), before);
  const commit = python({ ...physical, action: "compile", before, commit: true });
  await db.query(adapt(commit.sql)); const after = await snapshot();
  assert.deepEqual(after, commit.after); assert.deepEqual(validate(after, true), { valid: true });
  assert.equal(after.role.login, true);
  assert.deepEqual(after.tables.filter((row) => row.schema === old), before.tables.filter((row) => row.schema === old));
  assert.equal(after.tables.filter((row) => row.schema === target && row.select).length, 10);
  await assert.rejects(db.query(adapt(commit.sql)), /feature_read_before_graph_changed/); await db.query("ROLLBACK");
  const inverse = python({ ...physical, action: "compile", before: after, commit: true, remove: true });
  await db.query(adapt(inverse.sql)); assert.deepEqual(await snapshot(), before);
  await admin.query(`ALTER ROLE ${reader} NOLOGIN`);
  assert.equal(validate(await snapshot(), false).valid, false);
  await assert.rejects(db.query(adapt(commit.sql)), /feature_read_before_graph_changed/); await db.query("ROLLBACK");
  await admin.query(`ALTER ROLE ${reader} LOGIN`);
  await db.query(`GRANT UPDATE ON ${old}.booster_original TO ${reader}`);
  assert.equal(validate(await snapshot(), false).valid, false);
  await db.query(`REVOKE UPDATE ON ${old}.booster_original FROM ${reader}`);
  await db.query(`REVOKE SELECT ON ${old}.booster_event FROM ${reader}`);
  assert.equal(validate(await snapshot(), false).valid, false);
  await db.query(`GRANT SELECT ON ${old}.booster_event TO ${reader}`);
  assert.deepEqual(await snapshot(), before);
  for (const schema of [old, target]) await db.query(`ALTER TABLE ${schema}.booster_event ADD COLUMN block_number bigint,ADD COLUMN block_hash text,ADD COLUMN transaction_hash text,ADD COLUMN log_index integer`);
  await db.query(`ALTER TABLE ${target}.chain_block ADD COLUMN chain_id bigint,ADD COLUMN block_number bigint,ADD COLUMN block_hash text;ALTER TABLE ${target}._ponder_checkpoint ADD COLUMN chain_id bigint,ADD COLUMN latest_checkpoint text`);
  const event = { blockNumber: 52848560, blockHash: "0x" + "a".repeat(64), transactionHash: "0x" + "b".repeat(64), logIndex: 2 };
  const point = String(Math.floor(Date.now() / 1000)).padStart(10, "0") + "8453".padStart(16, "0") + String(event.blockNumber).padStart(16, "0") + "9".repeat(33);
  for (const schema of [old, target]) await db.query(`INSERT INTO ${schema}.booster_event VALUES('event',$1,$2,$3,$4)`, [event.blockNumber, event.blockHash, event.transactionHash, event.logIndex]);
  await db.query(`INSERT INTO ${target}.chain_block VALUES('header',8453,$1,$2)`, [event.blockNumber, event.blockHash]);
  await db.query(`INSERT INTO ${target}._ponder_checkpoint VALUES('checkpoint',8453,$1)`, [point]);
  const good = { left: 1, right: 1, header: event.blockHash, checkpoint: point };
  const generated = python({ action: "fresh", event, boundary: event.blockNumber - 1, result: good });
  const readEvent = async () => (await db.query(generated.sql)).rows[0].jsonb_build_object;
  assert.deepEqual(await readEvent(), good);
  assert.equal(python({ action: "fresh", event, boundary: event.blockNumber - 1, result: await readEvent() }).valid, true);
  await db.query(`INSERT INTO ${target}.booster_event SELECT * FROM ${target}.booster_event LIMIT 1`);
  assert.equal(python({ action: "fresh", event, boundary: event.blockNumber - 1, result: await readEvent() }).valid, false);
  await db.query(`DELETE FROM ${target}.booster_event WHERE ctid NOT IN(SELECT min(ctid)FROM ${target}.booster_event GROUP BY id)`);
  await db.query(`UPDATE ${target}.chain_block SET block_hash=$1`, ["0x" + "c".repeat(64)]);
  assert.equal(python({ action: "fresh", event, boundary: event.blockNumber - 1, result: await readEvent() }).valid, false);
  assert.equal(python({ action: "fresh", event, boundary: event.blockNumber, result: good }).valid, false);
  for (const schema of ["routes_left", "routes_right"]) {
    await db.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.booster_type(id text,registry text,engine text,metadata_base_uri text,rule_hash text);
      CREATE TABLE ${schema}.booster_original(id text,collection text,engine text,type_key text);
      CREATE TABLE ${schema}.booster_request(id text,engine text,original_key text,rule_hash text,status text,opening boolean);
      CREATE TABLE ${schema}.booster_monster(id text,collection text,token_id text,original_key text,request_key text,type_key text,owner text,variant_id bigint,is_original boolean,burned boolean,mint_block bigint);
      CREATE TABLE ${schema}.booster_event(id text,address text,name text,args text,block_number bigint,timestamp bigint,block_hash text,transaction_hash text,log_index integer)`);
    const collection = "0x105319be2182018c31fb10b1be198c3cf238a146", engine = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609", registry = "0xeaee2da120a398f21729d50672ac5d1dd71d7274";
    const origin = "8453:" + collection + ":1", request = "8453:" + engine + ":95398210973416432093304839780870626144645280554838792215361305546672924156888";
    await db.query(`INSERT INTO ${schema}.booster_type VALUES('type',$1,$2,'https://example.test/art/','rule')`, [registry, engine]);
    await db.query(`INSERT INTO ${schema}.booster_original VALUES($1,$2,$3,'type')`, [origin, collection, engine]);
    await db.query(`INSERT INTO ${schema}.booster_request VALUES($1,$2,$3,'rule','completed',true),('offspring-request',$2,$3,'rule','completed',false)`, [request, engine, origin]);
    await db.query(`INSERT INTO ${schema}.booster_monster VALUES($1,$2,'1',$1,$3,'type','owner',73,true,false,52950000),('offspring',$2,'2',$1,'offspring-request','type','owner',74,false,false,52950001)`, [origin, collection, request]);
    await db.query(`INSERT INTO ${schema}.booster_event VALUES('birth',$1,'MonsterMinted','{"tokenId":"1"}',52950000,1792690409,'block','transaction',0)`, [collection]);
  }
  const routeQuery = python({ action: "routes", boundary: 52950938 }).sql;
  const routes = async () => (await db.query("SELECT " + routeQuery + " AS proof")).rows[0].proof;
  const matched = await routes();
  assert.deepEqual(Object.fromEntries(matched.map((r) => [r.route, r.leftCount])), { globalFirstPage: 2, actualRequestMonsters: 1, actualBirthJournal: 1 });
  assert(matched.every((r) => r.differences === 0 && r.leftSha256 === r.rightSha256));
  await db.query("UPDATE routes_right.booster_monster SET owner='changed' WHERE token_id='1'");
  assert((await routes()).find((r) => r.route === "globalFirstPage").differences > 0);
  assert((await routes()).find((r) => r.route === "actualRequestMonsters").differences > 0);
  await db.query("UPDATE routes_right.booster_monster SET owner='owner' WHERE token_id='1';UPDATE routes_right.booster_event SET timestamp=1792690410");
  assert((await routes()).find((r) => r.route === "actualBirthJournal").differences > 0);
  await db.query("UPDATE routes_right.booster_event SET timestamp=1792690409;UPDATE routes_right.booster_request SET status='pending' WHERE opening");
  assert.equal((await routes()).find((r) => r.route === "actualRequestMonsters").rightCount, 0);
  await db.query("UPDATE routes_right.booster_request SET status='completed';UPDATE routes_right.booster_type SET registry='foreign'");
  assert.equal((await routes()).find((r) => r.route === "globalFirstPage").rightCount, 0);
  await db.query(`UPDATE routes_right.booster_event SET args='{ "tokenId": "1" }'`);
  assert((await routes()).find((r) => r.route === "actualBirthJournal").differences > 0);
  console.log(JSON.stringify({ passed: true, checks: ["actual_8_SELECT_rollback_restores_full_88_table_catalog", "commit_adds_only_eight_reads_preserving_prior_two_old_ten_and_LOGIN", "exact_owned_inverse_restores_all_prior_ACLs", "repeat_before_catalog_CAS_refuses_adoption", "unexpected_LOGIN_refused_in_actual_transaction", "old_source_write_and_missing_event_read_rejected", "actual_unique_event_in_both_sources_and_native_header", "duplicates_wrong_header_and_pre_switch_event_refused", "actual_same_snapshot_global_request_and_birth_journal_SQL", "owner_birth_timestamp_request_status_and_foreign_registry_drift_detected", "semantic_equal_but_noncanonical_birth_JSON_text_is_not_parity"], productionCalls: 0, providerCalls: 0 }));
} finally {
  await db?.end(); if (created) await admin.query(`DROP DATABASE ${database} WITH(FORCE)`);
  if (roleCreated) await admin.query(`DROP ROLE ${reader}`); await admin.end();
}
