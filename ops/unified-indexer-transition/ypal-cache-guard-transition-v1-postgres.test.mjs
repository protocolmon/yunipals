// Real disposable PG16; synthetic state only. No production or provider calls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  binding,
  relations,
  capture,
  catalog,
  digest,
  guardSql,
  rehearse,
  apply,
  inverse
} from "./ypal-cache-guard-transition-v1.mjs";
import { migrateIndexerControl } from "../../apps/yunipals-indexer/lib/unified/control-schema.ts";

const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(root + "/apps/yunipals-indexer/package.json"),
  { Pool } = require("pg");
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const container = "yunipals-unified-indexer-test-20261020";
const docker = (args) =>
  execFileSync(
    "/usr/bin/docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    {
      env,
      timeout: 15000,
      encoding: "utf8",
      maxBuffer: 4000000
    }
  );
const info = JSON.parse(docker(["inspect", container]))[0];
assert.equal(info.Config.Image, "postgres:16.15");
assert.deepEqual(info.NetworkSettings.Ports["5432/tcp"], [
  { HostIp: "127.0.0.1", HostPort: "56967" }
]);
const suffix = randomBytes(5).toString("hex"),
  database = "ypal_cache_guards_" + suffix;
const connection = (name) =>
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/" + name;
const admin = new Pool({ connectionString: connection("postgres"), max: 1 });
const reader = "ypal_guard_reader_" + suffix;
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
let pool,
  created = false,
  readerCreated = false;
const plan = JSON.parse(
  readFileSync(
    root +
      "/ops/unified-indexer-transition/ypal-combined-readview-v1.preparation.json"
  )
);
const profile = JSON.parse(
  readFileSync(
    root + "/ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json"
  )
);
assert.deepEqual(binding, {
  physicalSchema: plan.physicalSchema,
  readSchema: plan.readSchema,
  sourceRelease: plan.sourceRelease,
  readIdentity: plan.readIdentity
});
const modulePath =
  root + "/ops/unified-indexer-transition/ypal-cache-guard-transition-v1.mjs";
const originalSha = createHash("sha256")
  .update(readFileSync(modulePath))
  .digest("hex");
const officialPins = {
  "lib/metadata/read-cache-schema.ts":
    "1de7856e5fc9253dbc08d6db0b0408516252030d353bcc4409ecdb20a0922757",
  "lib/metadata/read-cache.ts":
    "9668ace2d6e33a0c5813326d2ddf17cff23bebfaea309765e5f08add988e5b39",
  "lib/metadata/read-source.ts":
    "1c80f8ca18c609c8a47e164730aa5409ea2a9a65c2697bac4498c2ab1ba63208",
  "lib/ownership/readiness.ts":
    "bc99f986bb4db425d862901ffadc0cc5b6f09cefedc4724cd199a7560401fe5a",
  "lib/constants.ts":
    "31d4c01cb192d54085e26d18f7d7323c82ef54168f98b9c4c916610fe13e8e7a"
};
for (const [path, pin] of Object.entries(officialPins))
  assert.equal(
    createHash("sha256")
      .update(readFileSync(root + "/apps/yunipals-indexer/" + path))
      .digest("hex"),
    pin
  );
const checks = [];
try {
  await admin.query(
    `CREATE DATABASE ${quote(database)} OWNER unified_test TEMPLATE template0`
  );
  created = true;
  pool = new Pool({
    connectionString: connection(database),
    max: 1,
    statement_timeout: 15000
  });
  const dump = docker([
    "exec",
    container,
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
  ]);
  await pool.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", binding.physicalSchema)
  );
  await pool.query(`SET search_path=${quote(binding.physicalSchema)},public`);
  await pool.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  await migrateIndexerControl(pool);
  await pool.query(
    `INSERT INTO ${binding.physicalSchema}._ponder_meta(key,value)VALUES('app',$1)`,
    [
      JSON.stringify({
        version: "6",
        build_id: plan.buildId,
        is_dev: 0,
        heartbeat_at: Date.now(),
        is_locked: 0,
        is_ready: 0
      })
    ]
  );
  for (const source of profile.manifest.sources)
    await pool.query(
      `INSERT INTO ${binding.physicalSchema}.indexer_source VALUES($1,$2,$3,$4)`,
      [source.id, source.chainId, plan.manifestHash, JSON.stringify(source)]
    );
  await pool.query(
    "INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest)VALUES($1,$2,$3,$4,$5)",
    [
      binding.sourceRelease,
      binding.physicalSchema,
      plan.buildId,
      plan.manifestHash,
      profile.manifest
    ]
  );
  Object.assign(process.env, {
    DATABASE_URL: connection(database),
    DATABASE_SCHEMA: binding.physicalSchema,
    READ_DATABASE_SCHEMA: binding.readSchema,
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: binding.readSchema,
    OWNERSHIP_RELEASE_ID: binding.sourceRelease,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native"
  });
  globalThis.fetch = async () => {
    throw Error("No providers permitted");
  };
  const { migrations } = await import(
    "../../apps/yunipals-indexer/lib/offchain/migrations.ts"
  );
  const { projectionSchemaStatements } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-schema.ts"
  );
  const { installReadCache } = await import(
    "../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts"
  );
  const { cachedSearchReadRelationFor, cachedTraitReadRelationFor } =
    await import("../../apps/yunipals-indexer/lib/metadata/read-cache.ts");
  for (const sql of migrations) await pool.query(sql);
  for (const sql of projectionSchemaStatements) await pool.query(sql);
  for (const schema of [
    "yunipals_indexer_v3",
    "bnb_indexer",
    "unified_shadow_20261020_7e7375b0"
  ]) {
    await pool.query(`CREATE SCHEMA ${quote(schema)}`);
    const names = [
      "token",
      "token_lifecycle",
      "transfer_event",
      ...(schema.startsWith("unified_shadow_") ? ["canonical_event"] : [])
    ];
    for (const name of names)
      await pool.query(
        `CREATE TABLE ${quote(schema)}.${quote(name)}(LIKE ${quote(binding.physicalSchema)}.${quote(name)} INCLUDING ALL)`
      );
  }
  await admin.query(`CREATE ROLE ${quote(reader)} NOLOGIN`);
  readerCreated = true;
  const guard = async () =>
    (await pool.query(guardSql())).rows[0].jsonb_build_object;
  const legacyCode = `import pg from 'pg';import{installReadCache}from${JSON.stringify(root + "/apps/yunipals-indexer/lib/metadata/read-cache-schema.ts")};
    const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{await db.query('BEGIN');await installReadCache(db);await db.query('COMMIT')}finally{await db.end()}`;
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", legacyCode],
    {
      cwd: root + "/apps/yunipals-indexer",
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...env,
        DATABASE_URL: connection(database),
        DATABASE_SCHEMA: "yunipals_indexer_v3",
        BNB_DATABASE_SCHEMA: "bnb_indexer",
        OWNERSHIP_READ_MODE: "legacy",
        METADATA_SOURCE_MODE: "archive",
        BASE_METADATA_INGESTION: "rpc"
      }
    }
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    `GRANT SELECT ON metadata_projection.search TO ${quote(reader)}`
  );
  await pool.query(
    `GRANT UPDATE ON metadata_projection.read_epoch TO ${quote(reader)}`
  );
  await pool.query(
    "INSERT INTO metadata_projection.generation(source_mode,state)VALUES('archive','ready')"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_set(generation_id,collection,revision,guard_count,source_mode)SELECT 1,'bnb',revision,8,'archive'FROM metadata_projection.read_epoch WHERE collection='bnb'"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_member(generation_id,collection,token_id,lifecycle,has_search,metadata_available)VALUES(1,'bnb',1,1,false,false)"
  );
  const data = async () =>
    (
      await pool.query(`SELECT jsonb_build_object(
    'cacheSets',(SELECT jsonb_agg(x ORDER BY generation_id,collection)FROM metadata_projection.read_set x),
    'cacheMembers',(SELECT jsonb_agg(x ORDER BY generation_id,collection,token_id)FROM metadata_projection.read_member x),
    'sourceCount',(SELECT count(*)FROM ${binding.physicalSchema}.canonical_event))AS value`)
    ).rows[0].value;
  const original = await capture(pool),
    originalData = await data();
  assert(
    relations.includes("unified_shadow_20261020_7e7375b0.canonical_event")
  );
  await pool.query(
    `GRANT SELECT(generation_id)ON metadata_projection.read_set TO ${quote(reader)}`
  );
  const withColumn = await capture(pool);
  assert(
    withColumn.columnAcl.some(
      (row) =>
        row.name === "metadata_projection.read_set" &&
        row.privilege === "SELECT"
    )
  );
  await assert.rejects(
    rehearse(pool, installReadCache),
    /preexisting_column_SELECT_requires_separate_inverse/
  );
  assert.deepEqual(await capture(pool), withColumn);
  const columnRights = (
    await pool.query(
      "SELECT has_column_privilege($1,'metadata_projection.read_set','generation_id','SELECT')AS column_select,has_table_privilege($1,'metadata_projection.read_set','SELECT')AS table_select",
      [reader]
    )
  ).rows[0];
  assert.deepEqual(columnRights, { column_select: true, table_select: false });
  await pool.query(
    `REVOKE SELECT(generation_id)ON metadata_projection.read_set FROM ${quote(reader)}`
  );
  assert.deepEqual(await capture(pool), original);
  checks.push(
    "preexisting_column_select_refuses_table_grant_inverse_and_survives_rollback"
  );
  const review = await rehearse(pool, installReadCache);
  assert.equal(review.committed, false);
  assert.deepEqual(review.binding, binding);
  assert.deepEqual(await capture(pool), original);
  assert.deepEqual(await data(), originalData);
  assert.equal(review.before.guards.length, 35);
  assert.equal(review.after.guards.length, 35);
  assert.equal(review.addedSelects.length, 4);
  assert(
    review.addedSelects.every(
      (x) => x.role === reader && x.privilege === "SELECT"
    )
  );
  checks.push(
    "official_installer_rehearsal_legacy35_to_fresh35_exact_catalog_epoch_restore"
  );
  const wrongRelease = {
    ...review,
    binding: { ...binding, sourceRelease: "0x" + "00".repeat(32) }
  };
  await assert.rejects(
    apply(pool, wrongRelease, installReadCache),
    /fresh_source_binding_required/
  );
  const stale = structuredClone(review);
  stale.before.guards[0].oid = "1";
  stale.beforeCatalogSha256 = digest(catalog(stale.before));
  await assert.rejects(
    apply(pool, stale, installReadCache),
    /reviewed_legacy_catalog_changed/
  );
  assert.deepEqual(await capture(pool), original);
  checks.push("wrong_release_and_stale_review_refused_before_commit");
  const receipt = await apply(pool, review, installReadCache);
  assert.equal(receipt.committed, true);
  assert.deepEqual(await guard(), { valid: true });
  assert.deepEqual(await data(), originalData);
  checks.push(
    "actual_commit_fresh_identity_all35_relation_oids_and_trigger_function_bindings"
  );
  assert.deepEqual(receipt.after.tables, original.tables);
  checks.push(
    "retained_old_and_new_native_table_definitions_owners_indexes_unchanged"
  );
  const beforeTruncate = (await capture(pool)).epochs;
  await pool.query("BEGIN");
  await pool.query(`TRUNCATE ${binding.physicalSchema}.token`);
  assert.deepEqual(
    (await capture(pool)).epochs.map((x) => ({
      ...x,
      revision: String(BigInt(x.revision) - 1n)
    })),
    beforeTruncate
  );
  await pool.query("ROLLBACK");
  assert.deepEqual((await capture(pool)).epochs, beforeTruncate);
  checks.push(
    "real_native_truncate_invalidates_all_four_collections_and_rollback_restores_epochs"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_epoch(collection)VALUES('foreign_fixture')"
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    "DELETE FROM metadata_projection.read_epoch WHERE collection='foreign_fixture'"
  );
  await pool.query(
    "UPDATE metadata_projection.read_epoch SET collection='foreign_fixture'WHERE collection='ethereum'"
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    "UPDATE metadata_projection.read_epoch SET collection='ethereum'WHERE collection='foreign_fixture'"
  );
  await pool.query(
    "INSERT INTO metadata_projection.read_guard(collection,relation,relation_oid)VALUES('foreign_fixture','metadata.token_metadata','metadata.token_metadata'::regclass)"
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    "DELETE FROM metadata_projection.read_guard WHERE collection='foreign_fixture'"
  );
  assert.deepEqual(await guard(), { valid: true });
  checks.push("extra_foreign_guard_epoch_and_replaced_epoch_refused");
  await pool.query(
    `GRANT UPDATE ON metadata_projection.read_member TO ${quote(reader)}`
  );
  await assert.rejects(inverse(pool, receipt), /owned_native_catalog_changed/);
  await pool.query(
    `REVOKE UPDATE ON metadata_projection.read_member FROM ${quote(reader)}`
  );
  checks.push("foreign_acl_change_refuses_inverse_without_revoking_it");
  await pool.query(
    `GRANT SELECT(generation_id)ON metadata_projection.read_set TO ${quote(reader)}`
  );
  await assert.rejects(inverse(pool, receipt), /owned_native_catalog_changed/);
  await pool.query(
    `REVOKE SELECT(generation_id)ON metadata_projection.read_set FROM ${quote(reader)}`
  );
  checks.push("foreign_column_acl_change_refuses_inverse");
  await pool.query(
    "UPDATE metadata_projection.read_epoch SET revision=revision+7"
  );
  const epochs = (await capture(pool)).epochs,
    restored = await inverse(pool, receipt);
  assert.equal(restored.restored, true);
  assert.deepEqual(catalog(await capture(pool)), catalog(original));
  assert.deepEqual(await data(), originalData);
  assert.deepEqual(
    (await capture(pool)).epochs.map((x) => ({
      ...x,
      revision: String(BigInt(x.revision) - 1n)
    })),
    epochs
  );
  checks.push(
    "owned_inverse_retains_existing_update_and_advances_epochs_after_intervening_writes"
  );
  await assert.rejects(inverse(pool, receipt), /owned_native_catalog_changed/);
  checks.push("duplicate_inverse_refused");
  const again = await rehearse(pool, installReadCache);
  await apply(pool, again, installReadCache);
  await pool.query("BEGIN");
  await pool.query(
    "DELETE FROM metadata_projection.read_guard WHERE collection='base'AND relation LIKE '%canonical_event'"
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query("ROLLBACK");
  await pool.query(
    `ALTER TABLE ${binding.physicalSchema}.token DISABLE TRIGGER read_cache_dirty`
  );
  assert.deepEqual(await guard(), { valid: false });
  await pool.query(
    `ALTER TABLE ${binding.physicalSchema}.token ENABLE ALWAYS TRIGGER read_cache_dirty`
  );
  await pool.query(
    "UPDATE metadata_projection.read_guard SET relation_oid='metadata.token_metadata'::regclass WHERE collection='bnb'AND relation LIKE '%.token'"
  );
  assert.deepEqual(await guard(), { valid: false });
  checks.push("missing_mapping_disabled_trigger_and_wrong_oid_refused");
  for (const sql of [
    cachedSearchReadRelationFor(
      '"' + binding.readSchema + '"',
      ["base"],
      "104"
    ),
    cachedTraitReadRelationFor('"' + binding.readSchema + '"', ["base"], "104")
  ]) {
    assert.match(sql, /UNION ALL SELECT original\./);
    assert.match(sql, /WHERE NOT \(SELECT/);
    assert(sql.includes(binding.readSchema));
  }
  checks.push("official_direct_search_and_trait_fallback_keeps_fresh_schema");
  assert.equal(
    createHash("sha256").update(readFileSync(modulePath)).digest("hex"),
    originalSha
  );
  checks.push("exact_retained_official_source_bytes_verified");
  console.log(
    JSON.stringify({
      passed: true,
      moduleSha256: originalSha,
      checks,
      productionCalls: 0,
      providerCalls: 0,
      fixture: "synthetic_disposable_PostgreSQL16"
    })
  );
} finally {
  await pool?.end();
  if (created)
    await admin.query(`DROP DATABASE ${quote(database)} WITH(FORCE)`);
  if (readerCreated) await admin.query(`DROP ROLE ${quote(reader)}`);
  await admin.end();
}
