// Genuine disposable PostgreSQL16 / actual Solana DDL and retained snapshot SQL.
// All rows are synthetic; no provider, host service, key, restore or production DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { solanaSchemaStatements } from "../../apps/yunipals-indexer/lib/solana/schema.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(root + "apps/yunipals-indexer/package.json");
const { Pool } = require("pg");
const environment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const container = "yunipals-unified-indexer-test-20261020";
const inspected = JSON.parse(
  execFileSync(
    "/usr/bin/docker",
    ["--host=unix:///var/run/docker.sock", "inspect", container],
    { env: environment, encoding: "utf8", timeout: 10000 }
  )
)[0];
assert.equal(inspected.Config.Image, "postgres:16.15");
assert.deepEqual(inspected.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const name = "managed_solana_" + randomBytes(6).toString("hex");
const connection = (database) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" +
  database;
const admin = new Pool({ connectionString: connection("postgres"), max: 1 });
let pool;
let created = false;
const foreignRole = "managed_column_" + randomBytes(6).toString("hex");
let roleCreated = false;
const snapshotSql = readFileSync(
  new URL("ypal-managed-handover-v1.solana.sql", import.meta.url),
  "utf8"
);
assert.equal(
  createHash("sha256").update(snapshotSql).digest("hex"),
  "2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0"
);
const checks = [];
const checksum =
  "f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07";
const python = `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('managed',${JSON.stringify(root + "ops/unified-indexer-transition/ypal-managed-handover-v1.py")})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
v=json.load(sys.stdin);getattr(m,v['function'])(*v['arguments']);print('accepted')`;
const validate = (fn, ...args) =>
  execFileSync("/usr/bin/python3", ["-I", "-B", "-c", python], {
    env: environment,
    input: JSON.stringify({ function: fn, arguments: args }),
    encoding: "utf8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"]
  });
const capture = async (through = 0, client = pool) => {
  assert(Number.isSafeInteger(through) && through >= 0);
  const result = await client.query(
    snapshotSql.replaceAll(":'ledger_max_id'", String(through))
  );
  const row = result.flatMap((part) => part.rows).find(Boolean);
  assert.deepEqual(Object.keys(row), ["jsonb_build_object"]);
  const value = row.jsonb_build_object;
  validate("check_solana", value);
  return value;
};
try {
  await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
  created = true;
  pool = new Pool({ connectionString: connection(name), max: 4 });
  for (const sql of solanaSchemaStatements) await pool.query(sql);
  await pool.query(
    "INSERT INTO solana_indexer.manifest(singleton,release_id,checksum,asset_count) VALUES(true,'fixture',$1,10000)",
    [checksum]
  );
  await pool.query(
    "INSERT INTO solana_indexer.manifest_asset(mint,legacy_alias,asset_key,source_hash,release_id) VALUES($1,'fixture','fixture','fixture','fixture')",
    ["1".repeat(32)]
  );
  await pool.query(
    "INSERT INTO solana_indexer.scan_run(id,manifest_checksum,state,next_batch,asset_count,batch_size,request_count,missing_count,started_at,completed_at) VALUES(10,$1,'published',10,10000,1000,10,0,'2026-10-23T01:00Z','2026-10-23T01:05Z'),(11,$1,'running',4,10000,1000,4,0,'2026-10-24T03:00Z',NULL)",
    [checksum]
  );
  await pool.query(
    "UPDATE solana_indexer.sync_state SET published_run_id=10,next_scan_at='2026-10-24T05:00Z',last_error=NULL; INSERT INTO solana_indexer.rpc_usage(id,method,credits,outcome,run_id)VALUES(30,'getAssetBatch',10000,'reserved',11)"
  );
  await pool.query(
    "INSERT INTO solana_indexer.scan_stage(run_id,mint,status,owner,burnt,observed_at)VALUES(11,$1,'observed','synthetic-owner',false,'2026-10-24T03:01Z')",
    ["1".repeat(32)]
  );
  const live = await capture();
  assert.equal(live.runningRunStates[0].next_batch, 4);
  assert.equal(live.stage.rows, 1);
  assert.equal(live.readOnly, true);
  assert.equal(live.isolation, "repeatable read");
  checks.push(
    "actual_DDL_single_RR_snapshot_includes_resumable_stage_and_schedule"
  );

  await pool.query(
    "UPDATE solana_indexer.rpc_usage SET outcome='success' WHERE id=30"
  );
  const stopped = await capture();
  assert.notEqual(stopped.ledgerPrefix.sha256, live.ledgerPrefix.sha256);
  assert.throws(() => validate("prefix_preserved", live, stopped));
  validate("stopped_solana", stopped, await capture(30));
  checks.push(
    "stopped_prefix_taken_after_reserved_outcome_finish_not_live_baseline"
  );

  await pool.query(
    "INSERT INTO solana_indexer.rpc_usage(id,method,credits,outcome,run_id)VALUES(31,'getAssetBatch',10000,'success',11)"
  );
  const continued = await capture(30);
  validate("prefix_preserved", stopped, continued);
  assert.equal(continued.ledgerPrefix.sha256, stopped.ledgerPrefix.sha256);
  assert.equal(continued.ledgerCurrent.credits, "20000");
  checks.push("new_legitimate_external_usage_preserved_without_prefix_rewrite");

  await pool.query(
    "UPDATE solana_indexer.rpc_usage SET reserved_at=reserved_at+interval '1second' WHERE id=30"
  );
  const changedPrefix = await capture(30);
  assert.throws(() => validate("prefix_preserved", stopped, changedPrefix));
  await pool.query(
    "UPDATE solana_indexer.rpc_usage SET reserved_at=reserved_at-interval '1second' WHERE id=30"
  );
  checks.push(
    "full_row_digest_detects_same_count_same_credit_historical_mutation"
  );

  await pool.query(
    "UPDATE solana_indexer.scan_stage SET owner='different-synthetic-owner' WHERE run_id=11"
  );
  assert.throws(() => validate("stopped_solana", continued, changedPrefix));
  const stageChanged = await capture(30);
  assert.throws(() => validate("stopped_solana", continued, stageChanged));
  checks.push("stopped_stage_payload_change_refuses_even_when_count_unchanged");

  const holder = await pool.connect();
  const competing = await pool.connect();
  try {
    await holder.query(
      "SELECT pg_advisory_lock(hashtext('solana:indexer:worker'))"
    );
    const lockState = await capture(30);
    assert.equal(lockState.workerLock.granted, 1);
    assert.equal(
      (
        await competing.query(
          "SELECT pg_try_advisory_lock(hashtext('solana:indexer:worker')) AS locked"
        )
      ).rows[0].locked,
      false
    );
    assert.throws(() => validate("stopped_solana", lockState, lockState));
  } finally {
    await holder.query(
      "SELECT pg_advisory_unlock(hashtext('solana:indexer:worker'))"
    );
    holder.release();
    competing.release();
  }
  checks.push(
    "actual_exclusive_advisory_lock_prevents_competing_Solana_writer"
  );

  const rr = await pool.connect();
  try {
    const select = snapshotSql.slice(
      snapshotSql.indexOf("WITH boundary"),
      snapshotSql.lastIndexOf("ROLLBACK;")
    );
    await rr.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const first = (await rr.query(select.replaceAll(":'ledger_max_id'", "30")))
      .rows[0].jsonb_build_object;
    await pool.query(
      "UPDATE solana_indexer.scan_run SET next_batch=5 WHERE id=11"
    );
    const second = (await rr.query(select.replaceAll(":'ledger_max_id'", "30")))
      .rows[0].jsonb_build_object;
    assert.deepEqual(first.runningRunStates, second.runningRunStates);
    await assert.rejects(
      rr.query("UPDATE solana_indexer.sync_state SET next_scan_at=now()"),
      { code: "25006" }
    );
    await rr.query("ROLLBACK");
    assert.equal((await capture(30)).runningRunStates[0].next_batch, 5);
  } finally {
    await rr.query("ROLLBACK");
    rr.release();
  }
  checks.push("snapshot_RR_preserves_one_view_and_rejects_SQL_writes");

  const baseline = await capture(30);
  await pool.query(
    "INSERT INTO solana_indexer.scan_run(id,manifest_checksum,state,next_batch,asset_count,batch_size,request_count,missing_count,started_at,completed_at) VALUES(12,$1,'published',10,10000,1000,10,1,now()+interval '1second',now()+interval '2seconds')",
    [checksum]
  );
  await pool.query(
    "UPDATE solana_indexer.sync_state SET published_run_id=12,next_scan_at=now()+interval '1hour'"
  );
  const publication = await capture(30);
  validate("prefix_preserved", baseline, publication);
  assert.equal(publication.state.publishedRunId, 12);
  assert.equal(publication.ledgerCurrent.credits, "20000");
  checks.push(
    "inverse_observation_keeps_new_publication_and_all_credits_no_DB_restore"
  );
  // This new supplement is deliberately separate from the old seven-role
  // catalog. token is outside feature10/Arena9, and the grantee is unmanaged.
  await admin.query(`CREATE ROLE "${foreignRole}" NOLOGIN`);
  roleCreated = true;
  await pool.query(
    "CREATE SCHEMA unified_ypal_20261023_v1; CREATE SCHEMA yunipals_ownership_4e77f52b_v4; CREATE SCHEMA yunipals_indexer_control; CREATE TABLE unified_ypal_20261023_v1.token(token_id bigint,owner text)"
  );
  const columnSql = readFileSync(
    new URL("ypal-managed-handover-v1.columns.sql", import.meta.url),
    "utf8"
  );
  const columns = async () =>
    (await pool.query(columnSql)).rows[0].jsonb_build_object;
  const initialColumns = await columns();
  validate("columns_preserved", initialColumns, initialColumns);
  const tokenOwner = (value) =>
    value.columns.find((c) => c.relation === "token" && c.name === "owner");
  assert.deepEqual(tokenOwner(initialColumns).acl, []);
  assert.equal(tokenOwner(initialColumns).attnum, 2);
  await pool.query(
    `GRANT UPDATE(owner) ON unified_ypal_20261023_v1.token TO "${foreignRole}"`
  );
  const foreignUpdate = await columns();
  const rights = (
    await pool.query(
      "SELECT has_table_privilege($1,'unified_ypal_20261023_v1.token','UPDATE') AS table_write,has_column_privilege($1,'unified_ypal_20261023_v1.token','owner','UPDATE') AS column_write",
      [foreignRole]
    )
  ).rows[0];
  assert.deepEqual(rights, { table_write: false, column_write: true });
  assert.equal(tokenOwner(foreignUpdate).acl[0].privilege, "UPDATE");
  assert.throws(() =>
    validate("columns_preserved", initialColumns, foreignUpdate)
  );
  await pool.query(
    `REVOKE UPDATE(owner) ON unified_ypal_20261023_v1.token FROM "${foreignRole}"`
  );
  validate("columns_preserved", initialColumns, await columns());
  checks.push(
    "unmanaged_column_UPDATE_on_non_feature_non_Arena_native_table_refused"
  );
  await pool.query(
    "GRANT UPDATE(owner) ON unified_ypal_20261023_v1.token TO PUBLIC"
  );
  const publicUpdate = await columns();
  assert(
    tokenOwner(publicUpdate).acl.some(
      (e) => e.grantee === "0" && e.privilege === "UPDATE"
    )
  );
  assert.throws(() =>
    validate("columns_preserved", initialColumns, publicUpdate)
  );
  await pool.query(
    "REVOKE UPDATE(owner) ON unified_ypal_20261023_v1.token FROM PUBLIC"
  );
  checks.push(
    "PUBLIC_column_WRITE_is_captured_and_rejected_without_table_grant"
  );
  await pool.query(
    `GRANT SELECT(token_id) ON unified_ypal_20261023_v1.token TO "${foreignRole}" WITH GRANT OPTION`
  );
  const granted = await columns();
  assert(granted.columns.some((c) => c.acl.some((e) => e.grantable === true)));
  await pool.query(
    `REVOKE GRANT OPTION FOR SELECT(token_id) ON unified_ypal_20261023_v1.token FROM "${foreignRole}"`
  );
  const withoutGrantOption = await columns();
  assert.throws(() =>
    validate("columns_preserved", granted, withoutGrantOption)
  );
  checks.push("complete_column_grantor_grantee_and_grant_option_preservation");
  const beforeColumn = await columns();
  await pool.query(
    "ALTER TABLE unified_ypal_20261023_v1.token ADD COLUMN new_column integer"
  );
  const afterColumn = await columns();
  assert.throws(() => validate("columns_preserved", beforeColumn, afterColumn));
  checks.push("column_object_identity_attnum_and_type_scope_changes_refuse");
  console.log(
    JSON.stringify({
      status: "passed",
      postgres: (await pool.query("SHOW server_version")).rows[0]
        .server_version,
      groups: checks.length,
      checks,
      fixture: "synthetic_actual_Solana_DDL",
      productionActions: 0,
      providerCalls: 0
    })
  );
} finally {
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH(FORCE)`);
  if (roleCreated) await admin.query(`DROP ROLE "${foreignRole}"`);
  await admin.end();
}
