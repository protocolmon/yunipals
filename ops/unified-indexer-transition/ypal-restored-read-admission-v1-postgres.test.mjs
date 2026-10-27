// Synthetic fixture only. Exact owner-generated143-edge SQL against disposable PG16.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(root + "/apps/yunipals-indexer/package.json"),
  { Pool } = require("pg");
const docker = (args) =>
  execFileSync(
    "/usr/bin/docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      timeout: 15000,
      encoding: "utf8"
    }
  );
const container = JSON.parse(
  docker(["inspect", "yunipals-unified-indexer-test-20261020"])
)[0];
assert.equal(container.Config.Image, "postgres:16.15");
assert.deepEqual(container.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const suffix = randomBytes(5).toString("hex"),
  dbname = "read_admission_" + suffix;
const url = (db) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + db;
const admin = new Pool({
  connectionString: url("postgres"),
  max: 1,
  statement_timeout: 10000
});
const path =
  root + "/ops/unified-indexer-transition/ypal-restored-read-admission-v1.py";
const fixtures =
  root +
  "/ops/unified-indexer-transition/ypal-combined-read-admission-v2.test.py";
const ownerSha = createHash("sha256").update(readFileSync(path)).digest("hex");
const py = (input) =>
  JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `import importlib.util,json,sys,types
s=importlib.util.spec_from_file_location('fixture',${JSON.stringify(fixtures)});f=importlib.util.module_from_spec(s);s.loader.exec_module(f)
s2=importlib.util.spec_from_file_location('new_owner',${JSON.stringify(path)});m=importlib.util.module_from_spec(s2);s2.loader.exec_module(m)
x=json.load(sys.stdin)
if x['mode']=='fixture':print(json.dumps(f.fixture()[0]))
elif x['mode']=='columns':
 try:print(json.dumps(m.validate_column_overlap(x['plan'],x['before'])))
 except RuntimeError as e:print(json.dumps({'refused':str(e)}))
elif x['mode']=='sql':
 f.m.ROLE_OIDS=x['roles'];h=types.SimpleNamespace(plan=x['plan'],sql=x['catalog'],helpers=f.m);print(json.dumps(m.transaction(h,x['before'],x.get('after'),x.get('commit',False),x.get('inverse',False))))
else:
 a,b=x['before'],x['after']
 for wrapped in [a,b]:
  v=wrapped['read'];v.update(databaseOid='17584',currentUser='postgres',sessionUser='postgres',socket=True,port='5432')
 try:print(json.dumps(m.validate_delta(f.m,x['plan'],a,b)))
 except RuntimeError as e:print(json.dumps({'refused':str(e)}))
`
      ],
      {
        input: JSON.stringify(input),
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 16000000
      }
    )
  );
let pool,
  created = false;
const roleNames = [],
  checks = [];
const quote = (v) => '"' + v.replaceAll('"', '""') + '"';
try {
  const fixture = py({ mode: "fixture" }),
    roleMap = {};
  for (const original of [
    ...new Set(fixture.missingPermissions.map((v) => v.role))
  ]) {
    const role = "r_" + suffix + "_" + Object.keys(roleMap).length;
    await admin.query(
      `CREATE ROLE ${quote(role)} ${["yunipals", "yunipals_unified_collector", "yunipals_unified_support"].includes(original) ? "LOGIN" : "NOLOGIN"} NOINHERIT`
    );
    roleNames.push(role);
    roleMap[original] = role;
  }
  const writer = "writer_" + suffix;
  await admin.query(`CREATE ROLE ${quote(writer)} NOLOGIN`);
  roleNames.push(writer);
  await admin.query(
    `CREATE DATABASE ${quote(dbname)} OWNER unified_test TEMPLATE template0`
  );
  created = true;
  pool = new Pool({
    connectionString: url(dbname),
    max: 1,
    statement_timeout: 15000
  });
  const N = "unified_ypal_20261023_v1",
    R = "yunipals_ownership_4e77f52b_v4",
    C = "yunipals_indexer_control";
  for (const name of [
    N,
    R,
    C,
    "metadata",
    "metadata_source",
    "solana_indexer",
    "yunipals_boosters_launch_v1",
    "yunipals_boosters_ypal_v1"
  ])
    await pool.query(
      `CREATE SCHEMA ${quote(name)} AUTHORIZATION ${quote([N, C].includes(name) ? writer : name === "metadata" ? roleMap.yunipals : "unified_test")}`
    );
  const objects = [
    ...new Map(
      fixture.missingPermissions.map((v) => [v.kind + ":" + v.name, v])
    ).values()
  ];
  for (const v of objects.filter((v) => v.kind === "relation")) {
    const [schema, name] = v.name.split("."),
      target = `${quote(schema)}.${quote(name)}`;
    if (schema === R && name !== "_unified_read_release")
      await pool.query(`CREATE VIEW ${target} AS SELECT 1::integer AS id`);
    else {
      await pool.query(`CREATE TABLE ${target}(id integer PRIMARY KEY)`);
      if (schema !== R)
        await pool.query(`ALTER TABLE ${target} OWNER TO ${quote(writer)}`);
    }
  }
  for (const v of objects.filter((v) => v.kind === "function")) {
    const [, name, args] = v.name.match(/\.([^.(]+)\((.*)\)/);
    await pool.query(
      `CREATE FUNCTION ${quote(R)}.${quote(name)}(${args}) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS 'SELECT 1'; REVOKE ALL ON FUNCTION ${quote(R)}.${quote(name)}(${args}) FROM PUBLIC`
    );
  }
  await pool.query(
    "CREATE TABLE metadata_source.native_base_metadata_state(release_id text); CREATE TABLE yunipals_indexer_control.active_release(name text PRIMARY KEY,release_id text)"
  );
  // Retain real oldTCG20 reads,9Solana reads and existing metadata operational writes.
  for (let i = 0; i < 20; i++)
    await pool.query(
      `CREATE TABLE yunipals_boosters_ypal_v1.retained_${i}(id integer); GRANT SELECT ON yunipals_boosters_ypal_v1.retained_${i} TO ${quote(roleMap.yunipals_unified_collector)}`
    );
  for (let i = 0; i < 9; i++)
    await pool.query(
      `CREATE TABLE solana_indexer.retained_${i}(id integer); GRANT SELECT ON solana_indexer.retained_${i} TO ${quote(roleMap.yunipals_unified_api)}`
    );
  await pool.query(
    `CREATE TABLE metadata.retained_write(id integer); ALTER TABLE metadata.retained_write OWNER TO ${quote(roleMap.yunipals)}`
  );
  const existingColumnRole = "existing_column_" + suffix;
  await admin.query(`CREATE ROLE ${quote(existingColumnRole)} NOLOGIN`);
  roleNames.push(existingColumnRole);
  await pool.query(
    `GRANT SELECT(id) ON metadata.retained_write TO ${quote(existingColumnRole)}`
  );
  let catalog = readFileSync(
    root +
      "/ops/unified-indexer-transition/ypal-combined-read-admission-v1.catalog.sql",
    "utf8"
  ).trim();
  for (const [original, role] of Object.entries(roleMap))
    catalog = catalog.replaceAll("'" + original + "'", "'" + role + "'");
  const snapshot = async (readonly = true) => {
    const client = await pool.connect();
    try {
      await client.query(readonly ? "BEGIN READ ONLY" : "BEGIN");
      await client.query("SET LOCAL search_path=pg_catalog");
      return (await client.query(catalog)).rows[0].jsonb_build_object;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  };
  const columns = readFileSync(
    root +
      "/ops/unified-indexer-transition/ypal-restored-read-admission-v1.columns.sql",
    "utf8"
  );
  catalog =
    "SELECT jsonb_build_object('read',(" +
    catalog +
    "),'allColumnAcl',(" +
    columns +
    "))";
  const before = await snapshot();
  assert.equal(Object.hasOwn(before.read, "readOnly"), false);
  const roles = Object.fromEntries(
    before.read.roles.map((v) => [v.name, v.oid])
  );
  const lookup = (v) =>
    v.kind === "schema"
      ? before.read.schemas.find((r) => r.name === v.name)
      : v.kind === "relation"
        ? before.read.relations.find((r) => r.schema + "." + r.name === v.name)
        : before.read.functions.find(
            (r) => r.schema + "." + r.name + "(" + r.arguments + ")" === v.name
          );
  const plan = {
    missingCount: fixture.missingCount,
    missingPermissions: fixture.missingPermissions.map((v) => ({
      ...v,
      role: roleMap[v.role],
      grantee: roles[roleMap[v.role]],
      object: lookup(v).oid,
      grantor: lookup(v).owner
    }))
  };
  assert.equal(py({ mode: "columns", plan, before }), true);
  assert(before.allColumnAcl.some((v) => v.name === "metadata.retained_write"));
  checks.push("existing_unrelated_column_ACL_is_retained_in_real_baseline");
  const overlapRole = roleMap.yunipals_unified_api;
  await pool.query(
    `GRANT SELECT(id) ON ${N}.booster_request TO ${quote(overlapRole)}`
  );
  const overlap = await snapshot();
  assert.match(
    py({ mode: "columns", plan, before: overlap }).refused,
    /noninvertible/
  );
  await pool.query("BEGIN");
  await pool.query(
    `GRANT SELECT ON ${N}.booster_request TO ${quote(overlapRole)}`
  );
  await pool.query(
    `REVOKE SELECT ON ${N}.booster_request FROM ${quote(overlapRole)}`
  );
  assert.equal(
    (
      await pool.query(
        `SELECT has_column_privilege($1,'${N}.booster_request','id','SELECT') AS present`,
        [overlapRole]
      )
    ).rows[0].present,
    false
  );
  await pool.query("ROLLBACK");
  assert.equal(
    (
      await pool.query(
        `SELECT has_column_privilege($1,'${N}.booster_request','id','SELECT') AS present`,
        [overlapRole]
      )
    ).rows[0].present,
    true
  );
  await pool.query(
    `REVOKE SELECT(id) ON ${N}.booster_request FROM ${quote(overlapRole)}`
  );
  assert.deepEqual(await snapshot(), before);
  checks.push(
    "overlap_refused_before_plan_and_actual_REVOKE_column_semantics_proven"
  );
  const sql = (a, b, commit = false, inverse = false) =>
    py({
      mode: "sql",
      roles,
      plan,
      catalog,
      before: a,
      after: b,
      commit,
      inverse
    });
  const execute = async (text) => {
    const client = await pool.connect();
    try {
      return (await client.query(text))
        .flatMap((r) => r.rows)
        .find((v) => v.jsonb_build_object)?.jsonb_build_object;
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  };
  const rehearsed = await execute(sql(before));
  assert.equal(py({ mode: "delta", plan, before, after: rehearsed }), true);
  assert.deepEqual(await snapshot(), before);
  checks.push(
    "actual_readonly_baseline_to_readwrite_143grant_rehearsal_rollback"
  );
  assert.deepEqual(await snapshot(false), before);
  checks.push("transaction_readonly_flag_is_not_a_catalog_identity");
  const extra = `GRANT SELECT ON ${N}.booster_request TO ${quote(roleMap.yunipals_islands_staking)};\n`;
  const bad = sql(before, rehearsed, true);
  const postIndex = bad.lastIndexOf("DO $guard$");
  await assert.rejects(
    execute(bad.slice(0, postIndex) + extra + bad.slice(postIndex)),
    /current_read_catalog_changed/
  );
  assert.deepEqual(await snapshot(), before);
  checks.push("foreign_extra_read_aborts_before_commit");
  const committed = await execute(sql(before, rehearsed, true));
  assert.deepEqual(committed, rehearsed);
  assert.equal(py({ mode: "delta", plan, before, after: committed }), true);
  checks.push("single_commit_exact_all_seven_roles_and_grantors");
  assert.equal(
    committed.read.roles.find(
      (r) => r.name === roleMap.yunipals_unified_collector
    ).login,
    true
  );
  const collector = committed.read.effective.find(
      (v) => v.role === roleMap.yunipals_unified_collector
    ),
    api = committed.read.effective.find(
      (v) => v.role === roleMap.yunipals_unified_api
    );
  assert.equal(
    Object.entries(collector.relations).filter(
      ([k, v]) =>
        k.startsWith("yunipals_boosters_ypal_v1.retained_") && v.select
    ).length,
    20
  );
  assert.equal(
    Object.entries(api.relations).filter(
      ([k, v]) => k.startsWith("solana_indexer.retained_") && v.select
    ).length,
    9
  );
  assert.equal(
    committed.read.effective.find((v) => v.role === roleMap.yunipals).relations[
      "metadata.retained_write"
    ].writes,
    true
  );
  assert.equal(
    Object.values(collector.relations).filter((v) => v.writes).length,
    0
  );
  checks.push(
    "collector_login_tcg20_solana9_and_existing_metadata_writes_preserved"
  );
  const publicExtra = `GRANT SELECT ON ${N}.booster_request TO PUBLIC`;
  await pool.query(publicExtra);
  const foreign = await snapshot();
  assert.equal(
    typeof py({ mode: "delta", plan, before, after: foreign }).refused,
    "string"
  );
  await pool.query(`REVOKE SELECT ON ${N}.booster_request FROM PUBLIC`);
  assert.deepEqual(await snapshot(), rehearsed);
  checks.push("public_permission_drift_refused");
  const foreignRole = "unmanaged_" + suffix;
  await admin.query(`CREATE ROLE ${quote(foreignRole)} NOLOGIN`);
  roleNames.push(foreignRole);
  await pool.query(
    `GRANT SELECT(id) ON metadata.retained_write TO ${quote(foreignRole)}`
  );
  const foreignColumn = await snapshot();
  assert.deepEqual(foreignColumn.read, rehearsed.read);
  assert.match(
    py({ mode: "delta", plan, before, after: foreignColumn }).refused,
    /all_grantee_column/
  );
  await pool.query(
    `REVOKE SELECT(id) ON metadata.retained_write FROM ${quote(foreignRole)}`
  );
  assert.deepEqual(await snapshot(), rehearsed);
  checks.push("unmanaged_column_grant_outside_native_scope_refused");
  await pool.query(`GRANT SELECT(id) ON metadata.retained_write TO PUBLIC`);
  assert.match(
    py({ mode: "delta", plan, before, after: await snapshot() }).refused,
    /all_grantee_column/
  );
  await pool.query(`REVOKE SELECT(id) ON metadata.retained_write FROM PUBLIC`);
  assert.deepEqual(await snapshot(), rehearsed);
  checks.push("PUBLIC_column_grant_refused_without_normalization");
  assert.deepEqual(await snapshot(), rehearsed);
  checks.push("unknown_commit_ACK_can_be_reconciled_readonly_without_regrant");
  const release =
    "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3";
  await pool.query(
    "INSERT INTO metadata_source.native_base_metadata_state VALUES($1)",
    [release]
  );
  await assert.rejects(
    execute(sql(rehearsed, before, true, true)),
    /current_read_catalog_changed/
  );
  await pool.query(
    "DELETE FROM metadata_source.native_base_metadata_state WHERE release_id=$1",
    [release]
  );
  await pool.query(
    "INSERT INTO yunipals_indexer_control.active_release VALUES('owned-selection',$1)",
    [release]
  );
  await assert.rejects(
    execute(sql(rehearsed, before, true, true)),
    /current_read_catalog_changed/
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.active_release WHERE name='owned-selection'"
  );
  assert.deepEqual(await snapshot(), rehearsed);
  checks.push("inverse_refuses_after_metadata_adoption_or_source_selection");
  const inversed = await execute(sql(rehearsed, before, true, true));
  assert.deepEqual(inversed, before);
  assert.deepEqual(await snapshot(), before);
  checks.push(
    "owned_inverse_restores_canonical_default_ACLs_without_catalog_writes"
  );
  await assert.rejects(
    execute(sql(rehearsed, before, true, true)),
    /current_read_catalog_changed/
  );
  checks.push("duplicate_inverse_refused_before_any_revoke");
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    ownerSha
  );
  console.log(
    JSON.stringify({
      passed: true,
      ownerSha256: ownerSha,
      checks,
      edgeCount: 143,
      database: "disposable_local_PostgreSQL16",
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  await pool?.end();
  if (created) await admin.query(`DROP DATABASE ${quote(dbname)} WITH(FORCE)`);
  for (const role of roleNames.reverse())
    await admin.query(`DROP ROLE ${quote(role)}`);
  await admin.end();
}
