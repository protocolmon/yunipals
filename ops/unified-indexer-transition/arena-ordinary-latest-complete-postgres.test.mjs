// Actual compiled Arena reader against a disposable synthetic PG16 database.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const require = createRequire(
    path.join(root, "apps/yunipals-market-api/package.json")
  ),
  pg = require("pg");
const temporary = mkdtempSync(path.join(os.tmpdir(), "arena-ordinary-pg-"));
const database = "arena_ready_" + randomBytes(5).toString("hex"),
  role = "arena_ready_" + randomBytes(5).toString("hex");
const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const admin = new pg.Client({ connectionString: base + "postgres" });
const physical = "unified_ypal_20261023_v1",
  build = "71e2a7f3b7";
const manifest = JSON.parse(
  readFileSync(
    path.join(
      root,
      "ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"
    )
  )
).manifest;
const stable = (v) =>
  Array.isArray(v)
    ? "[" + v.map(stable).join(",") + "]"
    : v !== null && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + stable(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const digest = (v) =>
  "0x" + createHash("sha256").update(stable(v)).digest("hex");
const manifestHash = digest({
  ...manifest,
  sources: [...manifest.sources].sort((a, b) => a.id.localeCompare(b.id))
});
const release = digest({ schema: physical, buildId: build, manifestHash });
assert.equal(
  release,
  "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
);
const tip = 53050000,
  hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const checkpoint = (n) =>
  "0000001000" +
  String(8453).padStart(16, "0") +
  String(n).padStart(16, "0") +
  "9".repeat(33);
let db,
  pool,
  created = false,
  roleCreated = false;
const checks = [];
try {
  const artifact = path.join(temporary, "artifact");
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        "ops/unified-indexer-transition/arena-ordinary-latest-complete-build-v1.mjs"
      ),
      "--out",
      artifact
    ],
    { timeout: 30000 }
  );
  symlinkSync(
    path.join(root, "apps/yunipals-market-api/node_modules"),
    artifact + "/node_modules",
    "dir"
  );
  const { NativeArenaSource } = await import(
    pathToFileURL(artifact + "/dist/arena-owner-reader.mjs")
  );
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  const password = randomBytes(24).toString("hex");
  await admin.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2`
  );
  roleCreated = true;
  await admin.query(
    `ALTER ROLE "${role}" SET default_transaction_read_only=on`
  );
  db = new pg.Client({ connectionString: base + database });
  await db.connect();
  await db.query(`CREATE SCHEMA ${physical};CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE ${physical}._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE ${physical}._ponder_checkpoint(chain_id bigint,chain_name text,latest_checkpoint varchar(75),safe_checkpoint varchar(75),finalized_checkpoint varchar(75));
    CREATE TABLE ${physical}.chain_checkpoint(chain_id int PRIMARY KEY,block_number bigint,block_hash text,parent_hash text,timestamp bigint);
    CREATE TABLE ${physical}.indexer_source(id text PRIMARY KEY,chain_id int,manifest_hash text,definition text);
    CREATE TABLE ${physical}.chain_block(chain_id int,block_number bigint,block_hash text,PRIMARY KEY(chain_id,block_number));
    CREATE TABLE ${physical}.arena_tournament(deployment text,tournament_id text,state jsonb,opened_event_id text,opened_block_hash text,last_event_id text,block_number bigint,block_hash text);
    CREATE TABLE yunipals_indexer_control.release(id text PRIMARY KEY,physical_schema text,build_id text,manifest_hash text,manifest jsonb);
    CREATE TABLE yunipals_indexer_control.chain_status(release_id text,chain_id int,revision bigint,head_number bigint,head_hash text,head_timestamp bigint,
      finalized_number bigint,finalized_hash text,witness_number bigint,witness_hash text,observed_at_ms bigint,provider_id text,anchors jsonb,halted bool,error_code text,finality_error_code text);
    GRANT USAGE ON SCHEMA ${physical},yunipals_indexer_control TO "${role}";
    GRANT SELECT ON ALL TABLES IN SCHEMA ${physical},yunipals_indexer_control TO "${role}"`);
  await db.query(`INSERT INTO ${physical}._ponder_meta VALUES('app',$1)`, [
    {
      version: "6",
      build_id: build,
      heartbeat_at: Date.now(),
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    }
  ]);
  await db.query(
    `INSERT INTO ${physical}._ponder_checkpoint VALUES(8453,'base',$1,$1,$1)`,
    [checkpoint(tip)]
  );
  await db.query(
    `INSERT INTO ${physical}.chain_checkpoint VALUES(8453,$1,$2,$3,$1)`,
    [tip, hash(tip), hash(tip - 1)]
  );
  for (const row of manifest.sources)
    await db.query(
      `INSERT INTO ${physical}.indexer_source VALUES($1,$2,$3,$4)`,
      [row.id, row.chainId, manifestHash, JSON.stringify(row)]
    );
  await db.query(
    "INSERT INTO yunipals_indexer_control.release VALUES($1,$2,$3,$4,$5)",
    [release, physical, build, manifestHash, manifest]
  );
  await db.query(`INSERT INTO ${physical}.chain_block VALUES(8453,$1,$2)`, [
    tip,
    hash(tip)
  ]);
  await db.query(
    "INSERT INTO yunipals_indexer_control.chain_status VALUES($1,8453,1,$2,$3,$2,NULL,NULL,$4,$5,$6,'synthetic',$7,false,NULL,NULL)",
    [
      release,
      tip + 20,
      hash(tip + 20),
      tip,
      hash(tip),
      Date.now(),
      {
        [tip]: { number: String(tip), hash: hash(tip), timestamp: String(tip) }
      }
    ]
  );
  pool = new pg.Pool({
    host: "127.0.0.1",
    port: 56967,
    database,
    user: role,
    password,
    max: 1,
    options: "-c default_transaction_read_only=on"
  });
  const source = new NativeArenaSource(
    pool,
    release,
    "0xebd141b6ae36f74fe70b9139b262ee9771b72aca",
    52648146n
  );
  const prefix = await source.read("0");
  assert.equal(prefix.tournament, null);
  assert.equal(prefix.indexedThroughBlock, String(tip));
  assert.equal(prefix.observedThroughBlock, String(tip));
  checks.push(
    "actual_built_Arena_reader_serves_verified_complete_prefix_below_live_head"
  );
  await assert.rejects(
    () => source.read("0", { requiredThroughBlock: BigInt(tip + 1) }),
    /required block/
  );
  checks.push("explicit_required_block_above_native_complete_still_refuses");
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='provider_lag'"
  );
  await assert.rejects(() => source.read("0"), /unavailable/);
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code=NULL"
  );
  checks.push("provider_lag_does_not_become_latest_complete_ready");
  await db.query(`UPDATE ${physical}.chain_block SET block_hash=$1`, [hash(1)]);
  await assert.rejects(() => source.read("0"), /unavailable/);
  await db.query(`UPDATE ${physical}.chain_block SET block_hash=$1`, [
    hash(tip)
  ]);
  checks.push("actual_native_chain_block_branch_mismatch_refuses");
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET anchors='{}'::jsonb"
  );
  await assert.rejects(() => source.read("0"), /unavailable/);
  checks.push("missing_verified_boundary_anchor_refuses");
  await assert.rejects(
    () => pool.query(`UPDATE ${physical}._ponder_meta SET value='{}'`),
    /read-only/
  );
  checks.push("dedicated_actual_TCP_reader_has_no_write_authority");
  console.log(
    JSON.stringify({
      passed: true,
      groups: checks.length,
      checks,
      productionActions: 0,
      providerCalls: 0
    })
  );
} finally {
  if (pool) await pool.end();
  if (db) await db.end();
  if (created) await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);
  if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
  rmSync(temporary, { recursive: true, force: true });
}
