// Disposable local PostgreSQL only. The production selector SQL is unchanged.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const pg = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
)("pg");
const url =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const name = "native_action_" + randomBytes(5).toString("hex") + "_test";
const admin = new pg.Client({ connectionString: url + "postgres" });
let db,
  created = false,
  roleCreated = false;
const role = "native_column_" + randomBytes(5).toString("hex");
const sql = readFileSync(
  new URL("./ypal-native-cutover-v1.action.sql", import.meta.url),
  "utf8"
);
const native = "unified_ypal_20261023_v1";
const blockHash = "0x" + "12".repeat(32),
  tx = "0x" + "34".repeat(32),
  order = "0x" + "56".repeat(32),
  offerer = "0x" + "78".repeat(20);
const checks = [];
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new pg.Client({ connectionString: url + name });
  await db.connect();
  await db.query(`CREATE SCHEMA yunipals_indexer_control;CREATE SCHEMA ${native};
    CREATE TABLE yunipals_indexer_control.transaction_evidence(chain_id integer,block_number bigint,block_hash text,transaction_hash text,payload_hash text);
    CREATE TABLE ${native}.transaction_candidate(id text PRIMARY KEY,chain_id integer,block_number bigint,block_hash text,transaction_hash text);
    CREATE TABLE ${native}.canonical_event(name text,transaction_hash text,block_number bigint,block_hash text,log_index integer,args text,chain_id integer,source_id text);
    CREATE TABLE ${native}.chain_block(chain_id integer,block_number bigint,block_hash text);`);
  const select = async () => {
    await db.query("BEGIN READ ONLY;SET LOCAL statement_timeout='3s'");
    try {
      const result = await db.query(sql);
      return Object.values(result.rows[0])[0];
    } finally {
      await db.query("ROLLBACK");
    }
  };
  assert.equal((await select()).actualFixtureAvailable, false);
  checks.push("no_full_receipt_is_an_explicit_gap_not_a_fabricated_fixture");
  await db.query(
    `INSERT INTO yunipals_indexer_control.transaction_evidence VALUES(56,128816538,$1,$2,$3)`,
    [blockHash, tx, "0x" + "ab".repeat(32)]
  );
  await db.query(
    `INSERT INTO ${native}.transaction_candidate VALUES($1,56,128816538,$2,$3)`,
    ["56:" + blockHash + ":" + tx, blockHash, tx]
  );
  await db.query(`INSERT INTO ${native}.chain_block VALUES(56,128816538,$1)`, [
    blockHash
  ]);
  for (const [index, kind] of [
    [3, "OrderValidated"],
    [9, "OrderCancelled"]
  ]) {
    await db.query(
      `INSERT INTO ${native}.canonical_event VALUES($1,$2,128816538,$3,$4,$5,56,'marketplace:bnb:seaport')`,
      [
        kind,
        tx,
        blockHash,
        index,
        JSON.stringify({
          orderHash: order,
          offerer,
          orderParameters: { offerer }
        })
      ]
    );
  }
  const value = await select();
  assert.equal(value.nativeSchema, native);
  assert.equal(value.request.action.kind, "bnb-cancel");
  assert.equal(value.request.action.orderHash, order);
  assert.equal(value.request.action.offerer, offerer);
  assert.equal(value.request.transactionHash, tx);
  assert.equal(value.request.blockNumber, "128816538");
  checks.push(
    "actual_SQL_joins_exact_full_receipt_candidate_event_header_and_deterministic_last_log"
  );
  await db.query(`DELETE FROM ${native}.chain_block`);
  assert.equal((await select()).actualFixtureAvailable, false);
  await db.query(`INSERT INTO ${native}.chain_block VALUES(56,128816538,$1)`, [
    blockHash
  ]);
  await db.query(
    `UPDATE ${native}.canonical_event SET source_id='foreign:source'`
  );
  assert.equal((await select()).actualFixtureAvailable, false);
  checks.push("missing_header_or_foreign_source_cannot_qualify");
  await db.query(
    `UPDATE ${native}.canonical_event SET source_id='marketplace:bnb:seaport',args=$1`,
    [JSON.stringify({ orderHash: "forged", offerer })]
  );
  assert.equal((await select()).actualFixtureAvailable, false);
  await db.query(`UPDATE ${native}.canonical_event SET args='not-json'`);
  await assert.rejects(select(), (error) => error.code === "22P02");
  checks.push(
    "forged_fields_omit_and_malformed_journal_JSON_fails_closed_readonly"
  );
  await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
  roleCreated = true;
  const roleOid = (
    await admin.query("SELECT oid::text FROM pg_roles WHERE rolname=$1", [role])
  ).rows[0].oid;
  const inspectColumns = execFileSync(
    "/usr/bin/python3",
    [
      "-I",
      "-B",
      "-c",
      "import importlib.util,sys;s=importlib.util.spec_from_file_location('proof',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.column_authority_sql([int(sys.argv[2])]))",
      fileURLToPath(
        new URL("./ypal-native-cutover-proof-v1.py", import.meta.url)
      ),
      roleOid
    ],
    { encoding: "utf8" }
  );
  assert.equal((await db.query(inspectColumns)).rows[0].count, "0");
  await db.query(
    `GRANT UPDATE(id)ON ${native}.transaction_candidate TO PUBLIC`
  );
  assert.equal((await db.query(inspectColumns)).rows[0].count, "1");
  await db.query(
    `GRANT INSERT ON ${native}.transaction_candidate TO "${role}"`
  );
  assert.equal((await db.query(inspectColumns)).rows[0].count, "1");
  await db.query(
    `REVOKE UPDATE(id)ON ${native}.transaction_candidate FROM PUBLIC`
  );
  await db.query(
    `GRANT SELECT(id)ON ${native}.transaction_candidate TO PUBLIC`
  );
  assert.equal((await db.query(inspectColumns)).rows[0].count, "1");
  await db.query(
    `GRANT SELECT ON ${native}.transaction_candidate TO "${role}"`
  );
  assert.equal((await db.query(inspectColumns)).rows[0].count, "0");
  checks.push(
    "actual_production_column_inspector_detects_each_PUBLIC_column_privilege_even_with_an_unrelated_table_write_and_preserves_whole_table_reads"
  );
  console.log(
    JSON.stringify({
      format: "yunipals-native-action-selector-postgres-v1",
      passed: true,
      checks,
      groups: checks.length,
      productionQueries: 0,
      providerCalls: 0
    })
  );
} finally {
  await db?.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
}
