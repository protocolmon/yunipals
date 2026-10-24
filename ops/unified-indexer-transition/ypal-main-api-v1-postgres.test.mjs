// Built MAIN HTTP app against a fresh synthetic PG16 database and SELECT-only role.
// The public known transaction hash identifies the scenario; every inserted row,
// event argument, block hash and readiness witness below is synthetic.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
  path.join(root, "apps/yunipals-indexer/package.json")
);
const pg = require("pg");
const { encodeEventTopics, encodeAbiParameters } = await import(
  pathToFileURL(
    path.join(root, "apps/yunipals-indexer/node_modules/viem/_esm/index.js")
  )
);
const { manifestDigest } = await import(
  pathToFileURL(
    path.join(root, "packages/yunipals-indexer-server/src/identity.ts")
  )
);
const profile = JSON.parse(
  readFileSync(
    path.join(
      root,
      "ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"
    )
  )
);
const manifest = profile.manifest;
const physical = "unified_ypal_20261023_v1";
const logical = "yunipals_ownership_4e77f52b_v4";
const manifestHash = manifestDigest(manifest);
const buildId = "71e2a7f3b7";
const releaseId = manifestDigest({ schema: physical, buildId, manifestHash });
const identity =
  "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67";
assert.equal(
  releaseId,
  "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
);
const engine = "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e";
const monsters = "0x7d62628806e7eef76a354c7c48787879e3440b16";
const source = manifest.sources.find((s) => s.id === "boosters:boosterengine");
const knownTx =
  "0x62e4c5d0792f1dc955b28601debabaa9240d9aeb596479a9e1f297adcb03e8a7";
assert.equal(source.address, engine);
const hash = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const number = 53000660,
  tip = 53000665,
  blockHash = hash(number),
  tipHash = hash(tip);
const payer = "0x" + "a".repeat(40);
const request = {
  version: 1,
  releaseId,
  readIdentity: identity,
  chainId: 8453,
  transactionHash: knownTx,
  blockNumber: String(number),
  blockHash,
  action: {
    kind: "booster-request-created",
    requestId: "11",
    originalId: "1",
    packTypeId: "1",
    payer,
    quantity: 1,
    opening: true,
    paid: "1000000000000000000",
    ruleHash: hash(23),
    callbackGas: 500000
  }
};
const checkpoint = (n) =>
  `0000001000${String(8453).padStart(16, "0")}${String(n).padStart(16, "0")}${"9".repeat(33)}`;
const database = "main_action_" + randomBytes(5).toString("hex"),
  role = "main_action_" + randomBytes(5).toString("hex");
const password = randomBytes(24).toString("hex");
const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const admin = new pg.Client({ connectionString: base + "postgres" });
const temporary = mkdtempSync(
  path.join(os.tmpdir(), "ypal-main-action-bundle-")
);
let db,
  created = false,
  roleCreated = false;
const pools = [],
  queries = [],
  checks = [];
const OriginalPool = pg.Pool;
try {
  execFileSync(
    process.execPath,
    [
      path.join(
        root,
        "ops/unified-indexer-transition/ypal-main-api-build-v1.mjs"
      ),
      "--out",
      path.join(temporary, "artifact")
    ],
    { cwd: root, timeout: 30000 }
  );
  symlinkSync(
    path.join(root, "apps/yunipals-indexer/node_modules"),
    path.join(temporary, "artifact/node_modules"),
    "dir"
  );
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  created = true;
  await admin.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2`
  );
  roleCreated = true;
  await admin.query(
    `ALTER ROLE "${role}" SET default_transaction_read_only=on`
  );
  db = new pg.Client({ connectionString: base + database });
  await db.connect();
  await db.query(`CREATE SCHEMA ${physical};CREATE SCHEMA ${logical};CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE ${physical}._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE ${physical}._ponder_checkpoint(chain_id bigint,chain_name text,latest_checkpoint varchar(75),safe_checkpoint varchar(75),finalized_checkpoint varchar(75));
    CREATE TABLE ${physical}.chain_checkpoint(chain_id int PRIMARY KEY,block_number bigint,block_hash text,parent_hash text,timestamp bigint);
    CREATE TABLE ${physical}.indexer_source(id text PRIMARY KEY,chain_id int,manifest_hash text,definition text);
    CREATE TABLE ${physical}.chain_block(chain_id int,block_number bigint,block_hash text,PRIMARY KEY(chain_id,block_number));
    CREATE TABLE ${physical}.canonical_event(id text PRIMARY KEY,source_id text,chain_id int,address text,abi_hash text,name text,
      block_number bigint,block_hash text,transaction_hash text,transaction_index int,log_index int,args text,topics text,data text);
    CREATE INDEX canonical_point ON ${physical}.canonical_event(chain_id,transaction_hash,source_id,log_index);
    CREATE TABLE ${physical}.booster_request(id text PRIMARY KEY,engine text,request_id text,original_key text,payer text,quantity int,opening bool,
      paid text,rule_hash text,callback_gas int,transaction_hash text);
    CREATE TABLE ${logical}._unified_read_release(singleton bool PRIMARY KEY,identity text,release_id text,manifest_hash text);
    CREATE TABLE yunipals_indexer_control.release(id text PRIMARY KEY,physical_schema text,build_id text,manifest_hash text,manifest jsonb);
    CREATE TABLE yunipals_indexer_control.chain_status(release_id text,chain_id int,revision bigint,head_number bigint,head_hash text,head_timestamp bigint,
      finalized_number bigint,finalized_hash text,witness_number bigint,witness_hash text,observed_at_ms bigint,provider_id text,anchors jsonb,
      halted bool,error_code text,finality_error_code text);
    GRANT USAGE ON SCHEMA ${physical},${logical},yunipals_indexer_control TO "${role}";
    GRANT SELECT ON ALL TABLES IN SCHEMA ${physical},${logical},yunipals_indexer_control TO "${role}"`);
  await db.query(`INSERT INTO ${physical}._ponder_meta VALUES('app',$1)`, [
    {
      version: "6",
      build_id: buildId,
      heartbeat_at: Date.now(),
      is_ready: 0,
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
    [tip, tipHash, hash(tip - 1)]
  );
  for (const row of manifest.sources)
    await db.query(
      `INSERT INTO ${physical}.indexer_source VALUES($1,$2,$3,$4)`,
      [row.id, row.chainId, manifestHash, JSON.stringify(row)]
    );
  await db.query(
    `INSERT INTO ${logical}._unified_read_release VALUES(true,$1,$2,$3)`,
    [identity, releaseId, manifestHash]
  );
  await db.query(
    "INSERT INTO yunipals_indexer_control.release VALUES($1,$2,$3,$4,$5)",
    [releaseId, physical, buildId, manifestHash, manifest]
  );
  await db.query(
    `INSERT INTO ${physical}.chain_block VALUES(8453,$1,$2),(8453,$3,$4)`,
    [number, blockHash, tip, tipHash]
  );
  await db.query(
    `INSERT INTO yunipals_indexer_control.chain_status VALUES($1,8453,1,$2,$3,$2,NULL,NULL,$2,$3,$4,'synthetic', $5,false,NULL,NULL)`,
    [
      releaseId,
      tip,
      tipHash,
      Date.now(),
      { [tip]: { number: String(tip), hash: tipHash, timestamp: String(tip) } }
    ]
  );
  const topics = encodeEventTopics({
    abi: [
      {
        type: "event",
        name: "RequestCreated",
        inputs: [
          { type: "uint256", name: "requestId", indexed: true },
          { type: "uint256", name: "originalId", indexed: true },
          { type: "uint256", name: "packTypeId", indexed: true },
          { type: "address", name: "payer", indexed: false },
          { type: "uint32", name: "quantity", indexed: false },
          { type: "bool", name: "opening", indexed: false },
          { type: "uint256", name: "paid", indexed: false },
          { type: "bytes32", name: "ruleHash", indexed: false },
          { type: "uint32", name: "callbackGas", indexed: false }
        ]
      }
    ],
    eventName: "RequestCreated",
    args: { requestId: 11n, originalId: 1n, packTypeId: 1n }
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint32" },
      { type: "bool" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "uint32" }
    ],
    [payer, 1, true, 10n ** 18n, hash(23), 500000]
  );
  const args = { ...request.action };
  delete args.kind;
  const key = `8453:${engine}:11`,
    original = `8453:${monsters}:1`;
  await db.query(
    `INSERT INTO ${physical}.canonical_event VALUES($1,$2,8453,$3,$4,'RequestCreated',$5,$6,$7,5,17,$8,$9,$10)`,
    [
      `8453:${engine}:${knownTx}:17`,
      source.id,
      engine,
      source.abiHash,
      number,
      blockHash,
      knownTx,
      JSON.stringify(args),
      JSON.stringify(topics),
      data
    ]
  );
  await db.query(
    `INSERT INTO ${physical}.booster_request VALUES($1,$2,'11',$3,$4,1,true,$5,$6,500000,$7)`,
    [
      key,
      engine,
      original,
      payer,
      request.action.paid,
      request.action.ruleHash,
      knownTx
    ]
  );
  pg.Pool = class extends OriginalPool {
    constructor(...args) {
      super(...args);
      pools.push(this);
      this.on("connect", (client) => {
        const original = client.query;
        client.query = function (sql, ...args) {
          queries.push(typeof sql === "string" ? sql : sql.text);
          return original.call(this, sql, ...args);
        };
      });
    }
  };
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://${role}:${password}@127.0.0.1:56967/${database}`,
    DATABASE_SCHEMA: physical,
    READ_DATABASE_SCHEMA: logical,
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: logical,
    OWNERSHIP_RELEASE_ID: releaseId,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native",
    API_DB_POOL_MAX: "1",
    OFFCHAIN_DB_POOL_MAX: "1"
  });
  globalThis.fetch = async () => {
    throw Error("Provider calls forbidden");
  };
  const { app } = await import(
    pathToFileURL(path.join(temporary, "artifact/dist/main-api.mjs"))
  );
  async function post(value = request) {
    const response = await app.request("/v1/indexer/action-evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return { status: response.status, body: await response.json() };
  }
  const selected = await app.request("/v1/indexer/action-evidence");
  assert.equal(selected.status, 200);
  assert.deepEqual((await selected.json()).identity, {
    releaseId,
    readIdentity: identity,
    manifestHash,
    buildId
  });
  checks.push(
    "built_main_selection_reads_registered_manifest_runtime_and_marker_as_SELECT_only_role"
  );
  const good = await post();
  assert.equal(good.status, 200);
  assert.equal(good.body.state, "indexed");
  assert.deepEqual(good.body.application, {
    state: "applied",
    component: "booster_request"
  });
  assert.equal(good.body.proof.kind, "canonical_event");
  assert.equal(good.body.proof.receiptRequirement, "none");
  checks.push(
    "synthetic_known_hash_event_uses_exact_historical_ABI_chain_qualified_request_and_original_without_global_framework_ready"
  );
  for (const [column, bad, old] of [
    ["id", `${engine}:11`, key],
    ["original_key", `${monsters}:1`, original],
    ["engine", payer, engine]
  ]) {
    await db.query(`UPDATE ${physical}.booster_request SET ${column}=$1`, [
      bad
    ]);
    const failed = await post();
    assert.equal(failed.status, 503);
    assert.equal(failed.body.reason, "projection_inconsistent");
    await db.query(`UPDATE ${physical}.booster_request SET ${column}=$1`, [
      old
    ]);
  }
  checks.push(
    "unqualified_request_original_and_foreign_engine_projection_refuse"
  );
  await db.query(`UPDATE ${physical}.canonical_event SET abi_hash=$1`, [
    hash(9)
  ]);
  assert.equal((await post()).body.reason, "canonical_event_invalid");
  await db.query(`UPDATE ${physical}.canonical_event SET abi_hash=$1`, [
    source.abiHash
  ]);
  checks.push("unknown_full_ABI_hash_refuses_without_compatibility_guess");
  await db.query(`UPDATE ${physical}.canonical_event SET args=$1`, [
    JSON.stringify({ ...args, paid: "0" })
  ]);
  assert.equal((await post()).body.reason, "canonical_event_invalid");
  await db.query(`UPDATE ${physical}.canonical_event SET args=$1`, [
    JSON.stringify(args)
  ]);
  checks.push("raw_event_arguments_must_match_exact_decoded_log");
  await db.query(
    `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE block_number=$2`,
    [hash(8), number]
  );
  assert.equal((await post()).body.state, "inclusion_changed");
  await db.query(
    `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE block_number=$2`,
    [blockHash, number]
  );
  checks.push("canonical_inclusion_conflict_refuses_positive");
  await db.query(`UPDATE ${logical}._unified_read_release SET identity=$1`, [
    hash(7)
  ]);
  assert.equal((await post()).status, 409);
  await db.query(`UPDATE ${logical}._unified_read_release SET identity=$1`, [
    identity
  ]);
  checks.push("foreign_read_selection_returns_conflict");
  await db.query(
    `UPDATE ${physical}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',to_jsonb(0::bigint))`
  );
  const stale = await post();
  assert.equal(stale.status, 503);
  assert.equal(stale.body.reason, "source_unavailable");
  await db.query(
    `UPDATE ${physical}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',to_jsonb($1::bigint))`,
    [Date.now()]
  );
  checks.push("stale_native_runtime_cannot_be_reported_indexed");
  assert.equal((await post()).body.state, "indexed");
  assert(queries.some((sql) => /^BEGIN .*READ ONLY$/i.test(sql)));
  assert(
    !queries.some((sql) =>
      /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql)
    )
  );
  checks.push(
    "every_actual_HTTP_read_runs_without_data_writes_and_can_recover_after_fixture_restore"
  );
  console.log(
    JSON.stringify({
      format: "yunipals-main-api-built-action-synthetic-postgres-v1",
      passed: true,
      groups: checks.length,
      checks,
      fixture:
        "synthetic_SQL_event_and_readiness_witnesses_public_known_transaction_hash_only",
      productionAcceptanceClaimed: false,
      providerCalls: 0,
      productionCalls: 0
    })
  );
} finally {
  pg.Pool = OriginalPool;
  for (const pool of pools) if (!pool.ended) await pool.end();
  await db?.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
  await admin.end();
  rmSync(temporary, { recursive: true, force: true });
}
