// Exact owner role-catalog SQL in a disposable local PG database; synthetic roles.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
);
const { Pool } = require("pg");
const owner = fileURLToPath(
  new URL("./ypal-combined-ordinary-observer-owner-v1.py", import.meta.url)
);
const sql = execFileSync(
  "/usr/bin/python3",
  [
    "-I",
    "-B",
    "-c",
    "import importlib.util,sys;s=importlib.util.spec_from_file_location('owner',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.role_sql())",
    owner
  ],
  { encoding: "utf8", timeout: 5000 }
);
const suffix = randomBytes(5).toString("hex"),
  database = "observer_owner_" + suffix,
  role = "observer_" + suffix,
  other = "reader_" + suffix;
const url =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const admin = new Pool({ connectionString: url + "postgres", max: 1 });
let db,
  created = false,
  roles = false;
let checks = 0;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  db = new Pool({ connectionString: url + database, max: 1 });
  await db.query(
    `CREATE ROLE "${role}" LOGIN NOINHERIT;CREATE ROLE "${other}" NOLOGIN`
  );
  roles = true;
  const oid = (
    await db.query("SELECT oid::text FROM pg_roles WHERE rolname=$1", [role])
  ).rows[0].oid;
  const query = sql
    .replaceAll("73036832", oid)
    .replaceAll("yunipals_unified_support", role);
  const native = "unified_ypal_20261023_v1",
    control = "yunipals_indexer_control";
  await db.query(`CREATE SCHEMA ${native};CREATE SCHEMA ${control}`);
  const names = [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "chain_checkpoint",
    "chain_block"
  ];
  for (const table of names)
    await db.query(`CREATE TABLE ${native}.${table}(id text)`);
  for (const table of ["release", "chain_status", "chain_anchor"])
    await db.query(`CREATE TABLE ${control}.${table}(id text)`);
  await db.query(
    `GRANT USAGE ON SCHEMA ${native},${control} TO "${role}";GRANT SELECT ON ALL TABLES IN SCHEMA ${native} TO "${role}";GRANT SELECT ON ${control}.release TO "${role}";GRANT SELECT,INSERT,UPDATE ON ${control}.chain_status TO "${role}";GRANT SELECT,INSERT,UPDATE,DELETE ON ${control}.chain_anchor TO "${role}"`
  );
  const current = async () =>
    (await db.query(query)).rows[0].jsonb_build_object;
  const validate = (row) =>
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        "import importlib.util,json,sys;s=importlib.util.spec_from_file_location('owner',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.ROLE=sys.argv[2];m.ROLE_OID=sys.argv[3];m.validate_role(json.load(sys.stdin));print('passed')",
        owner,
        role,
        oid
      ],
      {
        input: JSON.stringify(row),
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"]
      }
    ).trim();
  const baseline = await current();
  assert.equal(validate(baseline), "passed");
  checks++;
  await db.query(
    `ALTER ROLE "${other}" LOGIN;GRANT USAGE ON SCHEMA ${native} TO "${other}";GRANT SELECT ON ALL TABLES IN SCHEMA ${native} TO "${other}"`
  );
  assert.deepEqual(await current(), baseline);
  checks++;
  await db.query(`GRANT UPDATE ON ${native}.chain_block TO "${role}"`);
  const changed = await current();
  assert.notDeepEqual(changed, baseline);
  assert.throws(() => validate(changed));
  checks++;
  await db.query(
    `REVOKE UPDATE ON ${native}.chain_block FROM "${role}";REVOKE DELETE ON ${control}.chain_anchor FROM "${role}"`
  );
  const missing = await current();
  assert.throws(() => validate(missing));
  checks++;
  await db.query(`GRANT DELETE ON ${control}.chain_anchor TO "${role}"`);
  assert.deepEqual(await current(), baseline);
  checks++;
  await db.query(`GRANT UPDATE(id) ON ${native}.chain_block TO "${role}"`);
  const columnWrite = await current();
  assert.equal(columnWrite.nativeWriteAuthority, true);
  assert.equal(
    columnWrite.tables
      .find((t) => t.name === native + ".chain_block")
      .privileges.includes("UPDATE"),
    false
  );
  assert.equal(columnWrite.columnAcl.length, 1);
  assert.throws(() => validate(columnWrite));
  await db.query(`REVOKE UPDATE(id) ON ${native}.chain_block FROM "${role}"`);
  assert.deepEqual(await current(), baseline);
  checks++;
  await db.query(`GRANT "${other}" TO "${role}"`);
  assert.notDeepEqual((await current()).memberships, baseline.memberships);
  checks++;
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      actualPostgres: true,
      productionActions: 0,
      providerCalls: 0
    })
  );
} finally {
  await db?.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
  if (roles) await admin.query(`DROP ROLE "${role}","${other}"`);
  await admin.end();
}
