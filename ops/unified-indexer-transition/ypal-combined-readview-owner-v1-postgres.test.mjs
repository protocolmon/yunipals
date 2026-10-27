// Genuine disposable PostgreSQL16 exercise of the exact owner-generated SQL.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { migrateIndexerControl } from "../../apps/yunipals-indexer/lib/unified/control-schema.ts";
const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(root + "/apps/yunipals-indexer/package.json"), { Pool } = require("pg");
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }, container = "yunipals-unified-indexer-test-20261020";
const docker = (args) => execFileSync("/usr/bin/docker", ["--host=unix:///var/run/docker.sock", ...args], { env, timeout: 15000, encoding: "utf8", maxBuffer: 4e6 });
const info = JSON.parse(docker(["inspect", container]))[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "56967" }]);
const suffix = randomBytes(5).toString("hex"), database = "combined_views_" + suffix, role = database + "_readonly";
const connection = (name) => "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Pool({ connectionString: connection("postgres"), max: 1 });
const file = root + "/ops/unified-indexer-transition/ypal-combined-readview-owner-v1.py";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex"), ownerSha = sha(readFileSync(file));
const plan = JSON.parse(readFileSync(root + "/ops/unified-indexer-transition/ypal-combined-readview-v1.preparation.json"));
const profile = JSON.parse(readFileSync(root + "/ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"));
const python = (mode, before, commit = false, expected) => {
  assert.equal(sha(readFileSync(file)), ownerSha);
  return execFileSync("/usr/bin/python3", ["-I", "-B", "-c", `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('owner',${JSON.stringify(file)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
x=json.load(sys.stdin)
print(m.snapshot_sql(x['plan']) if x['mode']=='snapshot' else m.target_sql(x['plan']) if x['mode']=='target' else m.owner_sql(x['plan'],x['before'],x['commit'],x.get('expected')))
`], { input: JSON.stringify({ mode, plan, before, commit, expected }), encoding: "utf8", env, timeout: 5000 });
};
const semantics = (target) => Object.fromEntries(Object.entries(target).filter(([key]) => key !== "schemaOid").map(([key, value]) => [key, ["relations", "functions"].includes(key) ? value.map(({ oid, ...row }) => row) : value]));
let pool, created = false, roleCreated = false;
const checks = [];
try {
  await admin.query(`CREATE DATABASE "${database}" OWNER unified_test TEMPLATE template0`); created = true;
  pool = new Pool({ connectionString: connection(database), max: 1, statement_timeout: 10000 });
  const dump = docker(["exec", container, "pg_dump", "-U", "unified_test", "-d", "yunipals_ponder_dependency_test", "--schema-only", "--no-owner", "--no-privileges", "--schema", "dependency_check"]);
  await pool.query(dump.replace(/^\\(?:un)?restrict.*$/mg, "").replaceAll("dependency_check", plan.physicalSchema));
  await pool.query(`SET search_path="${plan.physicalSchema}",public`);
  await pool.query("CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)");
  await migrateIndexerControl(pool);
  await pool.query(`INSERT INTO ${plan.physicalSchema}._ponder_meta(key,value) VALUES('app',$1)`, [JSON.stringify({ version: "6", build_id: plan.buildId, is_dev: 0, heartbeat_at: Date.now(), is_locked: 1, is_ready: 0 })]);
  for (const source of profile.manifest.sources) await pool.query(`INSERT INTO ${plan.physicalSchema}.indexer_source VALUES($1,$2,$3,$4)`, [source.id, source.chainId, plan.manifestHash, JSON.stringify(source)]);
  await pool.query("INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5)", [plan.sourceRelease, plan.physicalSchema, plan.buildId, plan.manifestHash, profile.manifest]);
  await pool.query("CREATE SCHEMA yunipals_ownership_prior_fixture; CREATE VIEW yunipals_ownership_prior_fixture.retained AS SELECT 'unchanged'::text AS value");
  // Match the owner transport and transaction deparse context exactly.
  await pool.query("SET search_path=pg_catalog");
  const snapshot = async () => (await pool.query(python("snapshot"))).rows[0].jsonb_build_object;
  const target = async () => (await pool.query(python("target"))).rows[0].jsonb_build_object;
  const execute = async (before, commit = false, expected) => {
    const db = await pool.connect();
    try { return await db.query(python("write", before, commit, expected)); }
    finally { await db.query("ROLLBACK"); db.release(); }
  };
  const before = await snapshot();
  const results = await execute(before);
  const rehearsal = results.flatMap((row) => row.rows).find((row) => row.jsonb_build_object)?.jsonb_build_object;
  assert.ok(rehearsal); assert.equal(rehearsal.relations.length, 10); assert.equal(rehearsal.functions.length, 4);
  assert.equal(rehearsal.nonownerPermissions, 0); assert.equal(rehearsal.marker.identity, plan.readIdentity);
  assert.deepEqual(await snapshot(), before); checks.push("exact_nineteen_official_statements_rollback_all_DDL");
  await assert.rejects(execute({ ...before, nativeOid: "wrong" }, true, semantics(rehearsal)), /reviewed_readview_catalog_changed/);
  assert.deepEqual(await snapshot(), before); checks.push("stale_native_snapshot_refused_before_create");
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`); roleCreated = true;
  await pool.query(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ${role}`);
  await assert.rejects(execute(before, true, semantics(rehearsal)), /rehearsed_read_objects_changed/);
  assert.deepEqual(await snapshot(), before);
  await pool.query(`ALTER DEFAULT PRIVILEGES REVOKE SELECT ON TABLES FROM ${role}`);
  checks.push("unexpected_default_read_grant_refused_before_commit");
  const second = (await execute(before)).flatMap((row) => row.rows).find((row) => row.jsonb_build_object)?.jsonb_build_object;
  assert.deepEqual(semantics(second), semantics(rehearsal), "PostgreSQL definitions changed between rollback rehearsals");
  await execute(before, true, semantics(rehearsal));
  const committed = await target(); assert.deepEqual(semantics(committed), semantics(rehearsal));
  assert.notEqual(committed.schemaOid, rehearsal.schemaOid);
  assert.deepEqual(await snapshot(), { ...before, targetAbsent: false });
  checks.push("commit_reproduces_rehearsed_definitions_and_ACLs_with_actual_new_OIDs");
  assert.match(committed.relations.find((row) => row.name === "base_metadata_event").definition, /jsonb_set.*|rarityScore/s);
  assert.ok(committed.functions.every((row) => row.definer === false && row.configuration.join() === "search_path=pg_catalog"));
  checks.push("normalized_metadata_and_protected_invoker_functions_retained");
  const probe = (await pool.query(`SELECT ${plan.readSchema}.source_probe('base') AS value`)).rows[0].value;
  assert.equal(probe.ready, false); checks.push("new_boundary_fails_closed_before_source_observation");
  assert.deepEqual(semantics(await target()), semantics(rehearsal));
  checks.push("lost_ack_readonly_catalog_reconciliation_matches_exact_rehearsal");
  await assert.rejects(execute(before, true, semantics(rehearsal)), /reviewed_readview_catalog_changed/);
  checks.push("second_creation_refused_without_schema_reassignment");
  assert.equal(sha(readFileSync(file)), ownerSha);
  console.log(JSON.stringify({ passed: true, ownerSha256: ownerSha, database: "disposable_local_PostgreSQL16", checks, providerCalls: 0, productionCalls: 0 }));
} finally {
  await pool?.end(); if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
  if (roleCreated) await admin.query(`DROP ROLE ${role}`);
  await admin.end();
}
