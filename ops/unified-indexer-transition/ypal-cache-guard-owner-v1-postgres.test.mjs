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
import { execute, exactFourReads } from "./ypal-cache-guard-owner-v1.mjs";
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
const { Client } = require("pg");
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

  const collector = {
    name: reader,
    oid: (
      await pool.query("SELECT oid::text FROM pg_roles WHERE rolname=$1", [
        reader
      ])
    ).rows[0].oid
  };
  const outside = new Client({ connectionString: connection(database) });
  await outside.connect();
  try {
    let abortedOpening;
    await outside.query("BEGIN");
    await outside.query(
      "LOCK TABLE metadata.token_metadata IN ACCESS EXCLUSIVE MODE"
    );
    try {
      await assert.rejects(
        execute(
          pool,
          "rehearse",
          null,
          installReadCache,
          () => {
            throw Error("failed_rehearsal_cannot_prepare_commit");
          },
          collector,
          async (db) => {
            // The transaction is already aborted by the lock timeout. An error
            // while capturing diagnostics must never suppress its ROLLBACK.
            await db.query("SELECT 1");
          },
          async (message) => {
            abortedOpening = message;
            assert.equal(message.mode, "rehearse");
            assert.equal(message.event, "transaction-opened");
            assert.equal(
              message.backend.xid,
              String(BigInt(message.xid) % (1n << 32n))
            );
            assert.equal(
              (
                await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
                  message.xid
                ])
              ).rows[0].state,
              "in progress"
            );
          }
        ),
        (error) => error.code === "55P03"
      );
    } finally {
      await outside.query("ROLLBACK");
    }
    assert.equal(
      (
        await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
          abortedOpening.xid
        ])
      ).rows[0].state,
      "aborted"
    );
    assert.deepEqual(await capture(pool), original);
    assert.deepEqual(await data(), originalData);
    checks.push(
      "lock_timeout_after_recorded_actual_XID_always_rolls_back_even_when_diagnostic_capture_fails"
    );
    const scalar = docker([
      "exec",
      container,
      "psql",
      "-XAtq",
      "-U",
      "unified_test",
      "-d",
      database,
      "-c",
      `SELECT COALESCE(to_json(pg_xact_status('${abortedOpening.xid}'::xid8)),'null'::json)`
    ]);
    assert.equal(JSON.parse(scalar), "aborted");
    checks.push(
      "actual_psql_JSON_scalar_contract_parses_aborted_XID_for_readonly_recovery"
    );

    const rollback = await execute(
      pool,
      "rehearse",
      null,
      installReadCache,
      () => {
        throw Error("must_not_prepare_commit");
      },
      collector
    );
    const canonical = (v) =>
      Array.isArray(v)
        ? v.map(canonical)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, canonical(v[k])])
            )
          : v;
    const disk = JSON.parse(JSON.stringify(canonical(rollback)));
    await assert.rejects(
      execute(
        pool,
        "apply",
        disk.result,
        installReadCache,
        () => {
          throw Error("must_not_commit_reordered_plan");
        },
        collector
      )
    );
    const plan = JSON.parse(disk.resultJson);
    assert.equal(rollback.acknowledged, true);
    assert.equal(plan.committed, false);
    assert.deepEqual(await capture(pool), original);
    assert.deepEqual(await data(), originalData);
    exactFourReads(plan, collector);
    checks.push(
      "real_official_rehearsal_exact_four_reads_and_no_commit_callback"
    );
    checks.push(
      "root_sorted_journal_roundtrip_preserves_original_JS_catalog_digest_via_literal_plan_JSON"
    );

    let refused;
    await assert.rejects(
      execute(
        pool,
        "apply",
        plan,
        installReadCache,
        async (message) => {
          refused = message;
          throw Error("root_intent_not_durable");
        },
        collector
      ),
      /root_intent_not_durable/
    );
    assert.equal(
      (
        await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
          refused.xid
        ])
      ).rows[0].state,
      "aborted"
    );
    assert.deepEqual(catalog(await capture(pool)), catalog(original));
    checks.push(
      "missing_root_durable_ACK_aborts_real_transaction_and_all_grants"
    );

    let prepared;
    const first = await execute(
      pool,
      "apply",
      plan,
      installReadCache,
      async (message) => {
        prepared = message;
        assert.equal(message.mode, "apply");
        assert.equal(
          (
            await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
              message.xid
            ])
          ).rows[0].state,
          "in progress"
        );
        assert.equal(
          (
            await outside.query(
              "SELECT has_table_privilege($1,'metadata_projection.read_set','SELECT')AS allowed",
              [reader]
            )
          ).rows[0].allowed,
          false
        );
        assert.deepEqual(message.before, original);
        assert.equal(
          message.afterCatalogSha256,
          digest(catalog(message.after))
        );
        return true;
      },
      collector
    );
    assert.equal(first.result.committed, true);
    assert.equal(
      (
        await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
          first.xid
        ])
      ).rows[0].state,
      "committed"
    );
    assert.deepEqual(catalog(await capture(pool)), catalog(prepared.after));
    assert.deepEqual(await data(), originalData);
    checks.push(
      "one_actual_commit_after_prepared_XID_and_external_precommit_visibility_proof"
    );

    await pool.query(
      "UPDATE metadata_projection.read_epoch SET revision=revision+9"
    );
    const currentEpochs = (await capture(pool)).epochs;
    const undone = await execute(
      pool,
      "inverse",
      first.result,
      installReadCache,
      async (message) => {
        assert.equal(message.mode, "inverse");
        assert.deepEqual(message.before.epochs, currentEpochs);
        return true;
      },
      collector
    );
    assert.equal(undone.result.restored, true);
    assert.deepEqual(catalog(await capture(pool)), catalog(original));
    assert.deepEqual(
      (await capture(pool)).epochs.map((e) => ({
        ...e,
        revision: String(BigInt(e.revision) - 1n)
      })),
      currentEpochs
    );
    assert.deepEqual(await data(), originalData);
    checks.push(
      "real_inverse_preserves_data_and_monotonic_epochs_not_saved_revision_values"
    );

    await outside.query(
      "SELECT pg_advisory_lock(hashtext('yunipals:read-cache'))"
    );
    await assert.rejects(
      execute(
        pool,
        "apply",
        plan,
        installReadCache,
        () => {
          throw Error("must_not_prepare");
        },
        collector
      ),
      /cache_worker_must_be_drained/
    );
    await outside.query(
      "SELECT pg_advisory_unlock(hashtext('yunipals:read-cache'))"
    );
    assert.deepEqual(catalog(await capture(pool)), catalog(original));
    checks.push("live_cache_worker_session_lock_refuses_mutation_before_BEGIN");

    const fresh = (
      await execute(
        pool,
        "rehearse",
        null,
        installReadCache,
        () => false,
        collector
      )
    ).result;
    let lostPrepared;
    const loseCommit = {
      query: async (...args) => {
        const result = await pool.query(...args);
        if (args[0] === "COMMIT") throw Error("simulated_lost_commit_ACK");
        return result;
      }
    };
    await assert.rejects(
      execute(
        loseCommit,
        "apply",
        fresh,
        installReadCache,
        async (message) => {
          lostPrepared = message;
          return true;
        },
        collector
      ),
      /simulated_lost_commit_ACK/
    );
    assert.equal(
      (
        await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
          lostPrepared.xid
        ])
      ).rows[0].state,
      "committed"
    );
    assert.deepEqual(catalog(await capture(pool)), catalog(lostPrepared.after));
    const durablePrepared = JSON.parse(JSON.stringify(canonical(lostPrepared)));
    const reconstructed = {
      ...JSON.parse(JSON.stringify(fresh)),
      before: JSON.parse(durablePrepared.beforeJson),
      after: JSON.parse(durablePrepared.afterJson),
      committed: true,
      epochPolicy: "increment_current_once",
      cacheRowsWritten: 0
    };
    const actualBeforeInverse = (await capture(pool)).epochs;
    let lostInverse;
    await assert.rejects(
      execute(
        loseCommit,
        "inverse",
        reconstructed,
        installReadCache,
        async (message) => {
          lostInverse = message;
          return true;
        },
        collector
      ),
      /simulated_lost_commit_ACK/
    );
    assert.equal(
      (
        await outside.query("SELECT pg_xact_status($1::xid8)AS state", [
          lostInverse.xid
        ])
      ).rows[0].state,
      "committed"
    );
    assert.deepEqual(catalog(await capture(pool)), catalog(original));
    assert.deepEqual(
      (await capture(pool)).epochs.map((e) => ({
        ...e,
        revision: String(BigInt(e.revision) - 1n)
      })),
      actualBeforeInverse
    );
    checks.push(
      "lost_commit_and_inverse_ACKs_reconcile_by_own_XID_and_exact_catalog_without_reexecution"
    );

    await assert.rejects(
      execute(
        pool,
        "inverse",
        reconstructed,
        installReadCache,
        () => {
          throw Error("must_not_prepare_duplicate");
        },
        collector
      ),
      /owned_native_catalog_changed/
    );
    assert.deepEqual(await data(), originalData);
    checks.push(
      "repeating_inverse_after_proven_commit_refuses_without_second_epoch_increment"
    );

    for (const altered of [
      {
        ...fresh,
        addedSelects: [...fresh.addedSelects, fresh.addedSelects[0]]
      },
      {
        ...fresh,
        addedSelects: fresh.addedSelects.map((v, i) =>
          i ? v : { ...v, grantee: "0" }
        )
      },
      {
        ...fresh,
        addedSelects: fresh.addedSelects.map((v, i) =>
          i ? v : { ...v, privilege: "UPDATE" }
        )
      }
    ])
      assert.throws(() => exactFourReads(altered, collector));
    checks.push(
      "broader_fifth_public_or_write_edge_refused_separately_from_143_READ_scope"
    );
  } finally {
    await outside.end();
  }
  console.log(
    JSON.stringify({
      passed: true,
      checks,
      fixture: "synthetic_disposable_PostgreSQL16",
      productionCalls: 0,
      providerCalls: 0
    })
  );
} finally {
  await pool?.end();
  if (created)
    await admin.query(`DROP DATABASE ${quote(database)} WITH(FORCE)`);
  if (readerCreated) await admin.query(`DROP ROLE ${quote(reader)}`);
  await admin.end();
}
