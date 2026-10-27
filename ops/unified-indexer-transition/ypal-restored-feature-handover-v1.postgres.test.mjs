// Real local PG16.15, actual native Ponder columns and generated owner ACL/CAS SQL.
// No production connections, providers, services, credentials, or migrations.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(root + "/apps/yunipals-indexer/package.json"),
  { Pool } = require("pg");
const docker = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    ["inspect", "yunipals-unified-indexer-test-20261020"],
    { encoding: "utf8" }
  )
)[0];
assert.equal(docker.Config.Image, "postgres:16.15");
assert.deepEqual(docker.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const id = randomBytes(5).toString("hex"),
  db = "feature_" + id,
  reader = "feature_reader_" + id,
  writer = "feature_writer_" + id,
  foreign = "feature_foreign_" + id;
const url = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Pool({ connectionString: url("postgres"), max: 1 });
let pool,
  client,
  created = false,
  roles = false,
  config = {};
const checks = [];
function py(method, args = []) {
  return JSON.parse(
    execFileSync(
      "/usr/bin/python3",
      [
        "-I",
        "-B",
        "-c",
        `import importlib.util,json,sys,types\nfrom pathlib import Path\nr=Path(${JSON.stringify(root)})\ndef mod(name,path):\n s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m\nwrapper=mod('wrapper',r/'ops/unified-indexer-transition/ypal-restored-feature-handover-v1.py');context=mod('context',r/'ops/unified-indexer-transition/ypal-restored-feature-context-v1.py');m=wrapper.assemble((r/'ops/unified-indexer-transition/ypal-feature-handover-v1.py').read_bytes(),context);old=mod('reader',r/'ops/booster-launch/ypal-reader-cutover-v1.py');parity=mod('parity',r/'ops/unified-indexer-transition/ypal-booster-source-parity-v1.py')\nx=json.load(sys.stdin)\nfor k,v in x['config'].items():\n setattr(m,k,v)\n if hasattr(old,k):setattr(old,k,v)\nif x['method']=='sql':out=m.Host.catalog_sql(types.SimpleNamespace(reader=old))\nelif x['method']=='columns':out=parity.COLUMN_FIELDS\nelif x['method']=='fresh_sql':out=context.fresh_native_sql(m,old)\nelif x['method']=='fresh_identity':out=context.fresh_native_identity(m,*x['args'])\nelif x['method']=='restored_collector':\n cache=mod('pure_cache',r/'ops/unified-indexer-transition/ypal-cache-guard-owner-v1.py');cache.COLLECTOR_OID=m.ROLE_OID\n helpers=mod('pure_read',r/'ops/unified-indexer-transition/ypal-combined-read-admission-v2.py')\n out=context.restored_collector_baseline(m,*x['args'],cache,helpers)\nelse:out=getattr(m,x['method'])(*x['args'])\nprint(json.dumps(out))`
      ],
      {
        encoding: "utf8",
        input: JSON.stringify({ config, method, args }),
        maxBuffer: 8000000
      }
    )
  );
}
const N = "unified_ypal_20261023_v1",
  A = "yunipals_boosters_launch_v1",
  B = "yunipals_boosters_ypal_v1";
const capture = async (sql) =>
  (await client.query(sql)).rows[0].jsonb_build_object;
try {
  await admin.query(
    `CREATE ROLE ${writer} NOLOGIN;CREATE ROLE ${reader} LOGIN NOINHERIT CONNECTION LIMIT 6;CREATE ROLE ${foreign} NOLOGIN`
  );
  roles = true;
  await admin.query(
    `CREATE DATABASE ${db} OWNER unified_test TEMPLATE template0`
  );
  created = true;
  pool = new Pool({ connectionString: url(db), max: 1 });
  client = await pool.connect();
  const o = (
    await client.query(
      `SELECT (SELECT oid::text FROM pg_roles WHERE rolname=$1)reader,(SELECT oid::text FROM pg_roles WHERE rolname=$2)writer,(SELECT oid::text FROM pg_database WHERE datname=current_database())db`,
      [reader, writer]
    )
  ).rows[0];
  config = {
    ROLE: reader,
    ROLE_OID: o.reader,
    WRITER_OID: o.writer,
    WRITER_ROLE: writer,
    DATABASE_OID: o.db
  };
  const fields = py("columns");
  for (const schema of [A, B, N]) {
    await client.query(
      `CREATE SCHEMA ${schema} AUTHORIZATION ${writer};SET ROLE ${writer};CREATE TABLE ${schema}._ponder_meta(key text PRIMARY KEY,value jsonb NOT NULL);CREATE TABLE ${schema}._ponder_checkpoint(chain_id bigint PRIMARY KEY,latest_checkpoint varchar(75) NOT NULL);` +
        Object.entries(fields)
          .map(
            ([name, list]) =>
              `CREATE TABLE ${schema}.${name}(` +
              list
                .split(" ")
                .map((field) => {
                  const [n, type] = field.split(":");
                  return (
                    n +
                    " " +
                    {
                      t: "text",
                      n: "numeric(78,0)",
                      i: "integer",
                      b: "boolean"
                    }[type[0]] +
                    (type.endsWith("?") ? "" : " NOT NULL")
                  );
                })
                .join(",") +
              ")"
          )
          .join(";") +
        ";RESET ROLE;"
    );
  }
  const tables = Object.keys(fields).concat([
    "_ponder_meta",
    "_ponder_checkpoint"
  ]);
  await client.query(
    [A, B, N].map((s) => `GRANT USAGE ON SCHEMA ${s} TO ${reader}`).join(";") +
      ";" +
      [A, B]
        .flatMap((s) =>
          tables.map(
            (t) =>
              `SET ROLE ${writer};GRANT SELECT ON ${s}.${t} TO ${reader};RESET ROLE`
          )
        )
        .join(";") +
      `;SET ROLE ${writer};GRANT SELECT ON ${N}._ponder_meta,${N}._ponder_checkpoint TO ${reader};RESET ROLE;`
  );
  const ids = await client.query(
    `SELECT c.relname,c.oid::text,n.oid::text schemaoid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'`,
    [N]
  );
  config.TARGET_OID = ids.rows[0].schemaoid;
  config.TARGET_OIDS = Object.fromEntries(
    ids.rows.map((r) => [r.relname, r.oid])
  );
  await client.query(
    `INSERT INTO ${B}._ponder_meta VALUES('app','{"build_id":"8e88ea2e00"}')`
  );
  const fresh = await capture(py("fresh_sql"));
  config.FRESH_OID = fresh.schemaOid;
  const originalFresh = {
    schemaOid: fresh.schemaOid,
    readTableOids: Object.fromEntries(
      Object.entries(fresh.tables).map(([name, row]) => [name, row.oid])
    )
  };
  assert.deepEqual(py("fresh_identity", [fresh, originalFresh]), fresh);
  const replaced = structuredClone(fresh);
  replaced.tables.booster_event.oid = "1";
  assert.throws(
    () => py("fresh_identity", [replaced, originalFresh]),
    /fresh_native10/
  );
  checks.push(
    "actual temporary native10 schema/build/OID/owner identity and replacement refusal"
  );
  const sql = py("sql");
  await client.query(
    `SET ROLE ${writer};ALTER TABLE ${N}.booster_event ENABLE ROW LEVEL SECURITY;RESET ROLE`
  );
  const filtered = await capture(sql);
  assert.throws(
    () => py("validate_catalog", [filtered, filtered.baseline, false]),
    /eight_new_native_SELECTs/
  );
  await client.query(
    `SET ROLE ${writer};ALTER TABLE ${N}.booster_event DISABLE ROW LEVEL SECURITY;RESET ROLE`
  );
  checks.push(
    "native tables must retain unfiltered ordinary-table semantics before reader switch"
  );
  await client.query(
    `SET ROLE ${writer};GRANT UPDATE(id) ON ${N}.booster_event TO PUBLIC;RESET ROLE`
  );
  const inherited = await capture(sql);
  assert.equal(
    inherited.target.tables.find((r) => r.name === "booster_event").writes,
    false
  );
  assert.equal(
    inherited.target.tables.find((r) => r.name === "booster_event")
      .columnWrites,
    true
  );
  assert.throws(
    () => py("validate_catalog", [inherited, inherited.baseline, false]),
    /column_writes/
  );
  await client.query(
    `SET ROLE ${writer};REVOKE UPDATE(id) ON ${N}.booster_event FROM PUBLIC;RESET ROLE`
  );
  checks.push(
    "real PUBLIC columnUPDATE effective for collector refuses despite no table-level write"
  );
  await client.query(
    `SET ROLE ${writer};GRANT SELECT(id) ON ${N}.booster_event TO ${reader};RESET ROLE`
  );
  const overlap = await capture(sql);
  assert.equal(
    overlap.target.tables.find((r) => r.name === "booster_event").select,
    false
  );
  assert.throws(() => py("after_eight", [overlap]), /column_SELECT/);
  assert.throws(
    () => py("validate_catalog", [overlap, overlap.baseline, false]),
    /column_SELECT/
  );
  await client.query(
    `SET ROLE ${writer};REVOKE SELECT(id) ON ${N}.booster_event FROM ${reader};GRANT SELECT(id) ON ${N}.booster_event TO ${foreign};RESET ROLE`
  );
  checks.push(
    "real preexisting collector columnSELECT refuses before tableGRANT; foreign columnACL retained"
  );
  const before = await capture(sql),
    after = py("after_eight", [before]);
  assert(py("validate_catalog", [before, before.baseline, false]));
  checks.push("actual native column/OID/schema/collector six-slot catalog");
  await client.query(py("grant_sql", [before, after, sql]));
  assert.deepEqual(await capture(sql), before);
  checks.push(
    "actual eight owner-grantor SELECTs rollback leaves exact full prior graph"
  );
  await client.query(
    `SET ROLE ${writer};GRANT UPDATE ON ${N}.booster_monster TO ${reader};RESET ROLE`
  );
  await assert.rejects(
    client.query(py("grant_sql", [before, after, sql, true])),
    /feature_catalog_CAS/
  );
  await client.query("ROLLBACK");
  await client.query(
    `SET ROLE ${writer};REVOKE UPDATE ON ${N}.booster_monster FROM ${reader};RESET ROLE`
  );
  assert.deepEqual(await capture(sql), before);
  checks.push(
    "real concurrent foreign write-grant refuses before eight-read COMMIT"
  );
  await client.query(py("grant_sql", [before, after, sql, true]));
  assert.deepEqual(await capture(sql), after);
  checks.push(
    "actual COMMIT exact eight edges with writer grantor and unchanged role"
  );
  await client.query(
    `SET ROLE ${reader};BEGIN READ ONLY;` +
      tables.map((t) => `SELECT count(*)FROM ${N}.${t}`).join(";") +
      ";ROLLBACK;RESET ROLE"
  );
  await client.query(`SET ROLE ${reader}`);
  await assert.rejects(
    client.query(`DELETE FROM ${N}.booster_event`),
    (e) => e.code === "42501"
  );
  await client.query("RESET ROLE");
  checks.push("real collector can read10 but cannot DELETE events");
  await client.query(py("grant_sql", [after, before, sql, true, true]));
  assert.deepEqual(await capture(sql), before);
  checks.push(
    "actual inverse removes only8 and preserves old20/meta/checkpoint/USAGE"
  );
  // Reproduce the real cross-owner phase: cache4 belong to this SAME collector.
  const cacheNames = ["read_epoch", "read_guard", "read_set", "read_member"];
  await client.query(
    `CREATE SCHEMA metadata_projection AUTHORIZATION ${writer};SET ROLE ${writer};` +
      cacheNames
        .map(
          (name) =>
            `CREATE TABLE metadata_projection.${name}(id integer PRIMARY KEY)`
        )
        .join(";") +
      `;GRANT USAGE ON SCHEMA metadata_projection TO ${reader};RESET ROLE`
  );
  const reader143 = await capture(sql);
  const cacheIds = (
    await client.query(
      "SELECT c.relname,c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='metadata_projection' AND c.relkind='r'"
    )
  ).rows;
  await client.query(
    `SET ROLE ${writer};` +
      cacheNames
        .map(
          (name) =>
            `GRANT SELECT ON TABLE metadata_projection.${name} TO ${reader}`
        )
        .join(";") +
      ";RESET ROLE"
  );
  const reader143plus4 = await capture(sql);
  const cachePlan = {
    addedSelects: cacheNames.map((name) => ({
      name: "metadata_projection." + name,
      role: "yunipals_unified_collector",
      grantee: o.reader,
      grantor: o.writer,
      privilege: "SELECT",
      grantable: false
    })),
    before: { acl: [] },
    after: {
      tables: cacheIds.map((row) => ({
        name: "metadata_projection." + row.relname,
        oid: row.oid
      }))
    }
  };
  const restoredExpected = py("restored_collector", [
    reader143plus4,
    reader143.baseline,
    reader143plus4.baseline,
    cachePlan
  ]);
  await client.query(
    `SET ROLE ${writer};` +
      cacheNames
        .map(
          (name) =>
            `REVOKE SELECT ON TABLE metadata_projection.${name} FROM ${reader}`
        )
        .join(";") +
      ";RESET ROLE"
  );
  const readerRestored = await capture(sql);
  assert.notDeepEqual(readerRestored, reader143plus4); // prior inverse_leaf equality would reject here
  assert.deepEqual(readerRestored, reader143);
  assert.deepEqual(readerRestored, restoredExpected);
  await client.query(
    `SET ROLE ${writer};GRANT SELECT ON TABLE ${N}.booster_monster TO ${reader};RESET ROLE`
  );
  assert.notDeepEqual(await capture(sql), restoredExpected);
  await client.query(
    `SET ROLE ${writer};REVOKE SELECT ON TABLE ${N}.booster_monster FROM ${reader};GRANT UPDATE(credit) ON ${N}.booster_refund TO ${foreign};RESET ROLE`
  );
  assert.notDeepEqual(await capture(sql), restoredExpected);
  await client.query(
    `SET ROLE ${writer};REVOKE UPDATE(credit) ON ${N}.booster_refund FROM ${foreign};RESET ROLE`
  );
  assert.deepEqual(await capture(sql), restoredExpected);
  checks.push(
    "same collector real cache4 removal reproduces old refusal; authenticated143 baseline accepts exact inverse and rejects extra table/foreign column ACL"
  );
  console.log(
    JSON.stringify({
      passed: true,
      postgres: docker.Config.Image,
      groups: checks.length,
      checks,
      productionActions: 0,
      providers: 0
    })
  );
} finally {
  if (client) {
    await client.query("ROLLBACK;RESET ROLE").catch(() => {});
    client.release();
  }
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE ${db} WITH(FORCE)`);
  if (roles)
    await admin.query(
      `DROP ROLE ${reader};DROP ROLE ${writer};DROP ROLE ${foreign}`
    );
  await admin.end();
}
