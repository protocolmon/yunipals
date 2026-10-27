// Disposable local PG16 only. Actual observer, status and generated read views;
// synthetic headers, no provider requests or production inputs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createOwnershipReadViews } from "../lib/unified/ownership-views.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import { prepareReadViewV5 } from "../../../ops/unified-indexer-transition/ypal-combined-readview-v5-plan.mjs";
import { manifestDigest } from "../../../packages/yunipals-indexer-server/src/identity.ts";
import { readIndexerSourceStatus } from "../../../packages/yunipals-indexer-server/src/status.ts";

const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const database = `latest_complete_${randomBytes(5).toString("hex")}_test`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
const schema = "unified_ypal_20261023_v1";
const latestSchema = "latest_complete_read";
const depthSchema = "latest_depth_read";
const finalizedSchema = "latest_finalized_read";
const oldSchema = "latest_old_read";
const role = `latest_complete_reader_${randomBytes(5).toString("hex")}`;
const head = 60_000_000n;
const complete = head - 40n;
const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const checkpoint = (number) =>
  `0000001000${"56".padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
let created = false,
  roleCreated = false,
  pool,
  db;
const checks = [];
const fetchBefore = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Provider requests forbidden");
};
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  pool = new pg.Pool({ connectionString: base + database, max: 2 });
  db = await pool.connect();
  const dump = execFileSync(
    "/usr/bin/docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "yunipals-unified-indexer-test-20261020",
      "pg_dump",
      "-U",
      "unified_test",
      "-d",
      "yunipals_ponder_dependency_test",
      "--schema-only",
      "--no-owner",
      "--no-privileges",
      "--schema",
      "dependency_check"
    ],
    {
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 4000000
    }
  );
  await db.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", schema)
  );
  await db.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  await db.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: "71e2a7f3b7",
      heartbeat_at: Date.now(),
      is_dev: 0,
      is_locked: 1,
      is_ready: 1
    })
  ]);
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../ops/unified-indexer-transition/ypal-combined-source-manifest-v1.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  for (const source of manifest.sources)
    await db.query(`INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`, [
      source.id,
      source.chainId,
      manifestDigest(manifest),
      JSON.stringify(source)
    ]);
  await db.query(
    `INSERT INTO ${schema}._ponder_checkpoint VALUES('bnb',56,$1,$1,$1)`,
    [checkpoint(complete)]
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  await db.query(
    `INSERT INTO ${schema}.chain_checkpoint VALUES('56',56,$1,$2,$3,$4)`,
    [String(complete), hash(complete), hash(complete - 1n), timestamp]
  );
  await db.query(
    `INSERT INTO ${schema}.chain_block VALUES('56:complete',56,$1,$2,$3,$4)`,
    [String(complete), hash(complete), hash(complete - 1n), timestamp]
  );
  await migrateIndexerControl(pool);
  const release = await registerIndexerRelease(pool, {
    schema,
    buildId: "71e2a7f3b7",
    manifest
  });
  const definition = {
    collection: "bnb",
    sourceId: "ownership:bnb",
    policy: { kind: "latest" }
  };
  const rpc = {
    providerId: "synthetic-local-only",
    chainId: async () => 56,
    block: async (tag) => {
      const number =
        tag === "latest" ? head : tag === "finalized" ? head - 30n : tag;
      return {
        number,
        hash: hash(number),
        parentHash: hash(number - 1n),
        timestamp: BigInt(Math.floor(Date.now() / 1000))
      };
    }
  };
  assert.equal(await observeIndexerChain(pool, release, 56, rpc), "observed");
  const result = await createOwnershipReadViews(pool, release, latestSchema, [
    definition
  ]);
  await createOwnershipReadViews(pool, release, depthSchema, [
    { ...definition, policy: { kind: "depth", subsequentBlocks: 20 } }
  ]);
  await createOwnershipReadViews(pool, release, finalizedSchema, [
    { ...definition, policy: { kind: "finalized" } }
  ]);
  const status = (options = {}, policy = { kind: "latest" }) =>
    readIndexerSourceStatus(db, release, definition.sourceId, policy, options);
  const probe = async (name = latestSchema) =>
    (await db.query(`SELECT ${name}.source_probe('bnb') AS value`)).rows[0]
      .value;
  const initial = await status();
  assert.equal(initial.snapshot.frameworkReady, true);
  assert.equal(initial.readiness.ready, true);
  assert.equal(initial.readiness.availableThroughBlock, complete);
  assert.equal(initial.anchor.hash, hash(complete));
  assert.equal((await probe()).block_number, String(complete));
  assert.equal((await probe()).ready, true);
  checks.push(
    "actual_observer_verified_prefix_ready_below_live_head_in_TS_and_SQL"
  );

  assert.equal(
    (await status({ requiredThroughBlock: complete })).readiness.ready,
    true
  );
  assert.equal(
    (await status({ requiredThroughBlock: complete + 1n })).readiness.ready,
    false
  );
  assert.equal((await probe(depthSchema)).ready, false);
  assert.equal((await probe(finalizedSchema)).ready, false);
  assert.equal(
    (await status({}, { kind: "depth", subsequentBlocks: 20 })).readiness
      .requiredThroughBlock,
    head - 20n
  );
  assert.equal(
    (await status({}, { kind: "finalized" })).readiness.requiredThroughBlock,
    head - 30n
  );
  checks.push("explicit_fixed_boundary_and_depth_finalized_remain_exact");

  await db.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_ready}','0') WHERE key='app'`
  );
  assert.equal((await status()).readiness.ready, false);
  assert.equal((await probe()).ready, false);
  assert.equal((await probe()).available, true);
  await db.query(
    `UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_ready}','1') WHERE key='app'`
  );
  checks.push("framework_catchup_required_before_latest_serving");

  const source = manifest.sources.find(
    (value) => value.id === definition.sourceId
  );
  const priorIdentity = manifestDigest({
    version: 3,
    releaseId: release.id,
    configs: [{ ...definition, source }],
    nativeBase: null
  });
  assert.notEqual(result.identity, priorIdentity);
  assert.equal(
    result.identity,
    manifestDigest({
      version: 5,
      releaseId: release.id,
      configs: [{ ...definition, source }],
      nativeBase: null
    })
  );
  await db.query(
    `CREATE SCHEMA ${oldSchema}; CREATE TABLE ${oldSchema}._unified_read_release(singleton boolean, identity text)`
  );
  await db.query(
    `INSERT INTO ${oldSchema}._unified_read_release VALUES(true,$1)`,
    [priorIdentity]
  );
  await assert.rejects(
    createOwnershipReadViews(pool, release, oldSchema, [definition]),
    /cannot be reassigned/
  );
  assert.equal(
    (await db.query(`SELECT identity FROM ${oldSchema}._unified_read_release`))
      .rows[0].identity,
    priorIdentity
  );
  checks.push(
    "version5_identity_cannot_relabel_or_rewrite_existing_read_schema"
  );

  const nativeDefinitions = [
    {
      collection: "base",
      sourceId: "ownership:base",
      policy: { kind: "latest" }
    },
    definition
  ];
  const nativeConfigs = nativeDefinitions.map((value) => ({
    ...value,
    source: manifest.sources.find((entry) => entry.id === value.sourceId)
  }));
  const nativeBase = manifest.sources.find(
    (value) => value.id === "metadata:base"
  );
  const oldNativeIdentity = manifestDigest({
    version: 4,
    releaseId: release.id,
    configs: nativeConfigs,
    nativeBase
  });
  await db.query(
    "CREATE SCHEMA latest_native_v4; CREATE TABLE latest_native_v4._unified_read_release(singleton boolean, identity text)"
  );
  await db.query(
    "INSERT INTO latest_native_v4._unified_read_release VALUES(true,$1)",
    [oldNativeIdentity]
  );
  await assert.rejects(
    createOwnershipReadViews(
      pool,
      release,
      "latest_native_v4",
      nativeDefinitions
    ),
    /cannot be reassigned/
  );
  const newNative = await createOwnershipReadViews(
    pool,
    release,
    "latest_native_v5",
    nativeDefinitions
  );
  assert.equal(
    newNative.identity,
    manifestDigest({
      version: 5,
      releaseId: release.id,
      configs: nativeConfigs,
      nativeBase
    })
  );
  assert.notEqual(newNative.identity, oldNativeIdentity);
  assert.equal(
    (
      await db.query(
        "SELECT identity FROM latest_native_v4._unified_read_release"
      )
    ).rows[0].identity,
    oldNativeIdentity
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::integer AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='latest_native_v5' AND NOT p.prosecdef"
      )
    ).rows[0].count,
    4
  );
  checks.push(
    "native_metadata_V4_identity_preserved_and_distinct_V5_four_INVOKER_functions_created"
  );
  const prepared = await prepareReadViewV5();
  assert.equal(prepared.sourceRelease, release.id);
  assert.equal(prepared.expectedOwnerStatements.length, 19);
  await db.query("BEGIN");
  for (const statement of prepared.expectedOwnerStatements)
    await db.query(statement.sql, statement.params);
  await db.query("COMMIT");
  assert.equal(
    (
      await db.query(
        `SELECT identity FROM ${prepared.readSchema}._unified_read_release`
      )
    ).rows[0].identity,
    prepared.readIdentity
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::integer AS count FROM pg_class WHERE relnamespace=$1::regnamespace",
        [prepared.readSchema]
      )
    ).rows[0].count,
    10
  );
  checks.push(
    "exact_recorded_six_collection_V5_plan_executes_19_statements_in_real_PG"
  );

  await db.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=56`,
    [hash(999n)]
  );
  assert.equal((await status()).errorCode, "indexer_witness_unverified");
  assert.equal((await status()).readiness.ready, false);
  assert.equal((await probe()).available, false);
  await db.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=56`,
    [hash(complete)]
  );
  checks.push("orphaned_native_witness_refuses_TS_and_SQL");

  for (const [field, value] of [
    ["error_code", "provider_lag"],
    ["halted", true],
    ["observed_at_ms", String(Date.now() - 180001)]
  ]) {
    await db.query(
      `UPDATE yunipals_indexer_control.chain_status SET ${field}=$1 WHERE release_id=$2 AND chain_id=56`,
      [value, release.id]
    );
    assert.equal((await status()).readiness.ready, false);
    assert.equal((await probe()).available, false);
    await db.query(
      `UPDATE yunipals_indexer_control.chain_status SET error_code=NULL,halted=false,observed_at_ms=$1 WHERE release_id=$2 AND chain_id=56`,
      [String(Date.now()), release.id]
    );
  }
  checks.push("provider_lag_halt_and_stale_observation_still_refuse");

  const saved = (
    await db.query(
      "SELECT anchors FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
      [release.id]
    )
  ).rows[0].anchors;
  const invalid = { wrong_key: saved[String(complete)] };
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET anchors=$1 WHERE release_id=$2",
    [JSON.stringify(invalid), release.id]
  );
  assert.equal((await status()).readiness.ready, false);
  assert.equal((await status()).errorCode, "indexer_anchor_unverified");
  assert.equal((await probe()).available, false);
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET anchors=$1 WHERE release_id=$2",
    [JSON.stringify(saved), release.id]
  );
  checks.push("absent_exact_anchor_cannot_become_ready");

  await admin.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  roleCreated = true;
  await db.query(
    `GRANT USAGE ON SCHEMA ${schema},${latestSchema},yunipals_indexer_control TO ${role}`
  );
  await db.query(
    `GRANT SELECT ON ${schema}._ponder_meta,${schema}._ponder_checkpoint,${schema}.chain_checkpoint,${schema}.chain_block,${schema}.indexer_source,yunipals_indexer_control.release,yunipals_indexer_control.chain_status TO ${role}`
  );
  await db.query(
    `GRANT EXECUTE ON FUNCTION ${latestSchema}.source_probe(text),${latestSchema}.source_boundary(text) TO ${role}`
  );
  await db.query(`SET ROLE ${role}`);
  assert.equal((await status()).readiness.ready, true);
  assert.equal((await probe()).ready, true);
  await assert.rejects(
    db.query(`UPDATE ${schema}._ponder_meta SET value=value`),
    (error) => error.code === "42501"
  );
  await db.query("RESET ROLE");
  assert.equal(
    (
      await db.query(
        "SELECT bool_and(NOT p.prosecdef) AS invoker FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1",
        [latestSchema]
      )
    ).rows[0].invoker,
    true
  );
  checks.push(
    "native_SELECT_only_reader_and_INVOKER_functions_no_write_authority"
  );
  console.log(
    JSON.stringify({
      event: "latest_complete_readiness_postgres_verified",
      checks,
      passed: checks.length,
      providerCalls: 0
    })
  );
} finally {
  globalThis.fetch = fetchBefore;
  db?.release();
  await pool?.end();
  if (created) {
    // pg.Pool.end() can resolve just before the server sees socket closure.
    // Observe that closure rather than terminating the fixture's idle sockets.
    let remaining = 1;
    for (let attempt = 0; attempt < 40 && remaining; attempt++) {
      remaining = Number(
        (
          await admin.query(
            "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1",
            [database]
          )
        ).rows[0].count
      );
      if (remaining) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(remaining, 0, "Fixture connections must close before cleanup");
    await admin.query(`DROP DATABASE "${database}"`);
  }
  if (roleCreated) await admin.query(`DROP ROLE ${role}`);
  await admin.end();
}
