// Synthetic dedicated local PG16 database; no production/providers or row export.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  captureGenerationRecovery,
  restoreGenerationRecovery,
  observeGenerationRecovery,
  verifyGenerationRecovery,
  schema
} from "./ypal-generation-recovery-v1.mjs";
import {
  binding,
  capture,
  catalog
} from "./ypal-cache-guard-transition-v1.mjs";
const root = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(root + "/apps/yunipals-indexer/package.json"),
  { Pool, Client } = require("pg");
const endpoint =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const suffix = randomBytes(5).toString("hex"),
  name = "generation_recovery_" + suffix,
  reader = "recovery_reader_" + suffix;
const admin = new Pool({ connectionString: endpoint + "postgres", max: 1 });
let db,
  created = false,
  role = false;
const checks = [];
const code = readFileSync(
  root +
    "/ops/unified-indexer-transition/metadata-normalization-runtime-build-v1.mjs",
  "utf8"
);
assert(
  code.includes(
    "6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801"
  )
);
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const plan = JSON.parse(
  readFileSync(
    root +
      "/ops/unified-indexer-transition/ypal-combined-readview-v1.preparation.json"
  )
);
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new Client({ connectionString: endpoint + name });
  await db.connect();
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
    { env, encoding: "utf8", timeout: 15000, maxBuffer: 4000000 }
  );
  await db.query(
    dump
      .replace(/^\\(?:un)?restrict.*$/gm, "")
      .replaceAll("dependency_check", binding.physicalSchema)
  );
  Object.assign(process.env, {
    DATABASE_URL: endpoint + name,
    DATABASE_SCHEMA: "yunipals_indexer_v3",
    OWNERSHIP_READ_MODE: "legacy",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "rpc"
  });
  const { migrations } = await import(
    "../../apps/yunipals-indexer/lib/offchain/migrations.ts"
  );
  const { projectionSchemaStatements } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-schema.ts"
  );
  for (const sql of migrations) await db.query(sql);
  for (const sql of projectionSchemaStatements) await db.query(sql);
  for (const old of [
    "yunipals_indexer_v3",
    "bnb_indexer",
    "unified_shadow_20261020_7e7375b0"
  ]) {
    await db.query(`CREATE SCHEMA ${old}`);
    for (const table of [
      "token",
      "token_lifecycle",
      "transfer_event",
      ...(old.startsWith("unified_shadow_") ? ["canonical_event"] : [])
    ])
      await db.query(
        `CREATE TABLE ${old}.${table}(LIKE ${binding.physicalSchema}.${table} INCLUDING ALL)`
      );
  }
  const { installReadCache } = await import(
    "../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts"
  );
  await db.query("BEGIN");
  await installReadCache(db);
  await db.query("COMMIT");
  await db.query(
    "INSERT INTO metadata_source.archive_release(release_id,state)VALUES('archive-fixture','active')"
  );
  for (const id of [102, 103])
    await db.query(
      "INSERT INTO metadata_projection.generation(id,source_mode,metadata_release_id,state,validation)OVERRIDING SYSTEM VALUE VALUES($1,'archive','archive-fixture','ready','{}')",
      [id]
    );
  await db.query(
    "UPDATE metadata_projection.active SET current_id=103,previous_id=102"
  );
  await db.query(
    "INSERT INTO metadata.derived_snapshot(name,metadata_release_id)VALUES('traits','archive-fixture'),('leaderboard','archive-fixture')"
  );
  await db.query(
    "INSERT INTO leaderboard.wallet_stats(scope,owner,monster_count,total_rarity,unique_types,special_count,glitter_count,collector_score,score_version,updated_at)VALUES('all','synthetic-wallet',2,42,1,0,0,4242,'fixture',now())"
  );
  const originalRows = await observeGenerationRecovery(db),
    originalGuard = catalog(await capture(db));
  await admin.query(`CREATE ROLE ${reader} NOLOGIN`);
  role = true;
  await db.query(
    `ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ${reader}`
  );
  const defaults = (
    await db.query(
      "SELECT defaclacl::text AS acl FROM pg_default_acl ORDER BY oid"
    )
  ).rows;
  const external = "ab".repeat(32);
  await assert.rejects(
    captureGenerationRecovery(db, external, async () => {
      throw Error("prepared_not_acknowledged");
    }),
    /prepared_not_acknowledged/
  );
  assert.equal(
    (await db.query("SELECT to_regnamespace($1)AS schema", [schema])).rows[0]
      .schema,
    null
  );
  assert.deepEqual(await observeGenerationRecovery(db), originalRows);
  checks.push(
    "missing_root_prepared_ack_rolls_back_capsule_and_preserves_original_state"
  );
  let receipt;
  const captureQuery = db.query;
  db.query = async function (text, ...args) {
    const value = await captureQuery.call(this, text, ...args);
    if (text === "COMMIT") throw Error("synthetic_lost_capture_COMMIT_ACK");
    return value;
  };
  await assert.rejects(
    captureGenerationRecovery(db, external, async (prepared) => {
      receipt = prepared;
    }),
    /synthetic_lost_capture_COMMIT_ACK/
  );
  db.query = captureQuery;
  assert((await verifyGenerationRecovery(db, receipt)).validated);
  checks.push(
    "lost_capsule_COMMIT_ack_reconciles_exact_prepared_catalog_hashes_without_second_creation"
  );
  assert.equal(receipt.currentGeneration, "103");
  assert.equal(receipt.previousGeneration, "102");
  assert.equal(receipt.walletStats.count, "1");
  assert.equal(receipt.derivedStamps.count, "2");
  assert.equal(receipt.rawRowsExported, false);
  assert.equal(
    (
      await db.query(
        "SELECT has_schema_privilege($1,$2,'USAGE')AS schema,has_table_privilege($1,$3,'SELECT')AS table",
        [reader, schema, schema + ".wallet_stats"]
      )
    ).rows[0].table,
    false
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT defaclacl::text AS acl FROM pg_default_acl ORDER BY oid"
      )
    ).rows,
    defaults
  );
  assert.deepEqual(catalog(await capture(db)), originalGuard);
  await assert.rejects(
    captureGenerationRecovery(db, external),
    /fresh_capsule_schema_required/
  );
  checks.push(
    "owner_only_capsule_cleans_new_default_grants_preserves_original_defaults_catalog_and_generations"
  );
  const ownerSource = readFileSync(
    root + "/ops/unified-indexer-transition/ypal-native-generation-v1.py",
    "utf8"
  );
  const bridgeOriginal = ownerSource.match(/BRIDGE=r"""([\s\S]*?)"""/)[1];
  const constructor =
    "host:'/var/run/postgresql',port:5432,user:'postgres',database:'yunipals_backfill'";
  assert.equal(bridgeOriginal.split(constructor).length, 2);
  const bridgeSource = bridgeOriginal
    .replace(constructor, "connectionString:" + JSON.stringify(endpoint + name))
    .replace("who.role!=='postgres'", "who.role!=='unified_test'")
    .replace(
      "who.database!=='yunipals_backfill'",
      "who.database!==" + JSON.stringify(name)
    );
  const readonlyWire = (phase) => {
    const request = {
      phase,
      component: readFileSync(
        root +
          "/ops/unified-indexer-transition/ypal-generation-recovery-v1.mjs",
        "utf8"
      ),
      guard: readFileSync(
        root +
          "/ops/unified-indexer-transition/ypal-cache-guard-transition-v1.mjs",
        "utf8"
      ),
      receipt
    };
    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", bridgeSource],
      {
        cwd: root + "/apps/yunipals-indexer",
        input: JSON.stringify(request) + "\n",
        encoding: "utf8",
        timeout: 15000,
        env
      }
    );
    return JSON.parse(stdout).result;
  };
  assert((await readonlyWire("verify-capsule")).validated);
  assert.deepEqual(await readonlyWire("observe"), originalRows);
  checks.push(
    "actual_peer_child_dataURL_transport_verifies_capsule_and_observes_hashes_without_old_guard_or_private_env"
  );

  const published = async () => {
    await db.query(
      "INSERT INTO metadata_projection.generation(id,source_mode,metadata_release_id,state,ownership_release_id,ownership_read_identity,validation,published_at)OVERRIDING SYSTEM VALUE VALUES(104,'archive','archive-fixture','ready',$1,$2,$3,now())ON CONFLICT(id)DO UPDATE SET state='ready'",
      [
        binding.sourceRelease,
        binding.readIdentity,
        {
          sourceSnapshot: {
            predecessor: "103",
            releaseId: binding.sourceRelease,
            readIdentity: binding.readIdentity
          }
        }
      ]
    );
    await db.query(
      "UPDATE metadata_projection.active SET current_id=104,previous_id=103"
    );
    await db.query(
      "UPDATE leaderboard.wallet_stats SET monster_count=3,total_rarity=100,collector_score=9000"
    );
    await db.query(
      "UPDATE metadata.derived_snapshot SET ownership_release_id=$1,ownership_read_identity=$2,updated_at=clock_timestamp()WHERE name IN('traits','leaderboard')",
      [binding.sourceRelease, binding.readIdentity]
    );
  };
  await published();
  let owned = await observeGenerationRecovery(db);
  const refuse = async (label, change, restore, ext = external) => {
    await change();
    const before = await observeGenerationRecovery(db);
    await assert.rejects(
      restoreGenerationRecovery(db, receipt, "104", ext, owned)
    );
    assert.deepEqual(await observeGenerationRecovery(db), before);
    await restore();
    checks.push(label);
  };
  await refuse(
    "changed_external_consumer_context_refuses_before_rows_or_pointer",
    async () => {},
    async () => {},
    "cd".repeat(32)
  );
  await refuse(
    "foreign_leaderboard_update_after_owned_receipt_refuses",
    () => db.query("UPDATE leaderboard.wallet_stats SET monster_count=99"),
    () => db.query("UPDATE leaderboard.wallet_stats SET monster_count=3")
  );
  await refuse(
    "archive_change_refuses_inverse",
    () =>
      db.query("UPDATE metadata_source.archive_release SET state='superseded'"),
    () => db.query("UPDATE metadata_source.archive_release SET state='active'")
  );
  await refuse(
    "purged_or_changed_old_generation_refuses_inverse",
    () =>
      db.query(
        "UPDATE metadata_projection.generation SET state='retired'WHERE id=102"
      ),
    () =>
      db.query(
        "UPDATE metadata_projection.generation SET state='ready'WHERE id=102"
      )
  );
  await refuse(
    "foreign_capsule_rows_refuse_inverse",
    () => db.query(`UPDATE ${schema}.wallet_stats SET monster_count=9`),
    () => db.query(`UPDATE ${schema}.wallet_stats SET monster_count=2`)
  );
  await refuse(
    "cache_guard_handover_requires_its_owned_inverse",
    () =>
      db.query(
        "UPDATE metadata_projection.read_guard SET relation='foreign'WHERE collection='base'AND relation='metadata.token_metadata'"
      ),
    () =>
      db.query(
        "UPDATE metadata_projection.read_guard SET relation='metadata.token_metadata'WHERE collection='base'AND relation='foreign'"
      )
  );
  // Observed revisions may have advanced from normal guarded writes. Inverse
  // increments current revisions, never restores an old number.
  const epochs = (
    await db.query(
      "SELECT collection,revision::text FROM metadata_projection.read_epoch ORDER BY collection"
    )
  ).rows;
  const beforeNoAck = await observeGenerationRecovery(db);
  await assert.rejects(
    restoreGenerationRecovery(db, receipt, "104", external, owned, async () => {
      throw Error("inverse_prepared_not_acknowledged");
    }),
    /inverse_prepared_not_acknowledged/
  );
  assert.deepEqual(await observeGenerationRecovery(db), beforeNoAck);
  checks.push(
    "missing_inverse_prepared_ack_rolls_back_all_rows_pointer_and_epochs"
  );
  const result = await restoreGenerationRecovery(
    db,
    receipt,
    "104",
    external,
    owned
  );
  assert(result.restored && result.allDerivedIdentityColumnsRestored);
  assert.deepEqual(
    (await observeGenerationRecovery(db)).walletStats,
    originalRows.walletStats
  );
  assert.deepEqual(
    (await observeGenerationRecovery(db)).derivedStamps,
    originalRows.derivedStamps
  );
  assert.deepEqual(
    (await observeGenerationRecovery(db)).pointer,
    originalRows.pointer
  );
  for (const epoch of result.epochs)
    assert(
      BigInt(epoch.revision) >
        BigInt(epochs.find((e) => e.collection === epoch.collection).revision)
    );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM metadata_projection.generation WHERE id IN(102,103,104)AND state='ready'"
      )
    ).rows[0].n,
    3
  );
  assert.deepEqual(catalog(await capture(db)), originalGuard);
  checks.push(
    "atomic_post_publication_inverse_restores_all_null_identity_columns_wallets_pointer_and_monotonic_epochs_keeps_both_generations"
  );
  await published();
  owned = await observeGenerationRecovery(db);
  const realQuery = db.query;
  db.query = async function (text, ...args) {
    const value = await realQuery.call(this, text, ...args);
    if (text === "COMMIT") throw Error("synthetic_lost_COMMIT_ACK");
    return value;
  };
  await assert.rejects(
    restoreGenerationRecovery(db, receipt, "104", external, owned),
    /synthetic_lost_COMMIT_ACK/
  );
  db.query = realQuery;
  const afterLost = await observeGenerationRecovery(db);
  assert.deepEqual(afterLost.pointer, originalRows.pointer);
  assert.deepEqual(afterLost.walletStats, originalRows.walletStats);
  assert.deepEqual(afterLost.derivedStamps, originalRows.derivedStamps);
  await assert.rejects(
    restoreGenerationRecovery(db, receipt, "104", external, owned)
  );
  assert.deepEqual(await observeGenerationRecovery(db), afterLost);
  checks.push(
    "lost_inverse_COMMIT_ACK_is_readonly_reconcilable_and_never_repeats_owned_publication_or_build"
  );
  console.log(
    JSON.stringify({
      format: "yunipals-generation-recovery-postgres-v1",
      passed: true,
      groups: checks.length,
      checks,
      productionQueries: 0,
      providerCalls: 0,
      rawRowsExported: false
    })
  );
} finally {
  await db?.end();
  // The client pool is intentionally not reused outside this fresh fixture.
  if (created) await admin.query(`DROP DATABASE "${name}" WITH(FORCE)`);
  if (role) await admin.query(`DROP ROLE ${reader}`);
  await admin.end();
}
