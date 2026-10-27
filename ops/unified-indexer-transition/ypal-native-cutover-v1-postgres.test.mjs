// Genuine local PG16, actual registered read-view functions and generation code.
// Fresh synthetic database only; no RPC, production configuration or row exports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const pg = createRequire(
  new URL("../../apps/yunipals-indexer/package.json", import.meta.url)
)("pg");
import {
  publishPreparedCandidate,
  globalPublicationObservation,
  changeReaderLogins
} from "./ypal-native-cutover-v1.mjs";
import { observeGenerationRecovery } from "./ypal-generation-recovery-v1.mjs";

const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const database = `leaderboard_prepare_${randomBytes(5).toString("hex")}_test`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
let db,
  other,
  created = false,
  appPools;
const checks = [];
const reader = "projection_reader_" + randomBytes(4).toString("hex");
let readerCreated = false;
const loginNames = [
  "cutover_main_" + randomBytes(5).toString("hex"),
  "cutover_islands_" + randomBytes(5).toString("hex")
];
const createdLogins = [];
const root = new URL("../../", import.meta.url);
const plan = JSON.parse(
  readFileSync(
    new URL(
      "ops/unified-indexer-transition/ypal-combined-readview-v1.preparation.json",
      root
    )
  )
);
const profile = JSON.parse(
  readFileSync(
    new URL(
      "ops/unified-indexer-transition/ypal-combined-rpc-profile-v1.json",
      root
    )
  )
);
const physical = plan.physicalSchema,
  logical = plan.readSchema;
const hash = (chain, number) =>
  "0x" +
  (BigInt(chain) * 10n ** 18n + BigInt(number)).toString(16).padStart(64, "0");
const checkpoint = (chain, number) =>
  `0000001000${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const head = 60_000_000;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  db = new pg.Client({ connectionString: base + database });
  other = new pg.Client({ connectionString: base + database });
  await db.connect();
  await other.connect();
  await other.query(
    "CREATE TEMP TABLE IF NOT EXISTS live_query_tables(table_name text PRIMARY KEY)"
  );
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
      .replaceAll("dependency_check", physical)
  );
  await db.query(`SET search_path=${physical},public`);
  await db.query(
    "CREATE TEMP TABLE IF NOT EXISTS live_query_tables(table_name text PRIMARY KEY)"
  );
  Object.assign(process.env, {
    DATABASE_URL: base + database,
    DATABASE_SCHEMA: physical,
    READ_DATABASE_SCHEMA: logical,
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: logical,
    OWNERSHIP_RELEASE_ID: plan.sourceRelease,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native",
    PROJECTION_TEST_BYPASS_CAPACITY: "1",
    OFFCHAIN_DB_POOL_MAX: "2"
  });
  globalThis.fetch = async () => {
    throw Error("No RPC permitted");
  };
  const { migrateIndexerControl } = await import(
    "../../apps/yunipals-indexer/lib/unified/control-schema.ts"
  );
  const { migrations } = await import(
    "../../apps/yunipals-indexer/lib/offchain/migrations.ts"
  );
  const { projectionSchemaStatements } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-schema.ts"
  );
  const { collections, collectionSlugs } = await import(
    "../../apps/yunipals-indexer/lib/constants.ts"
  );
  const {
    captureProjectionInputs,
    projectionSourceSnapshot,
    preservedProjectionGenerations
  } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-snapshot.ts"
  );
  const {
    refreshProjectionGeneration,
    publishGeneration,
    publishGenerationInTransaction
  } = await import(
    "../../apps/yunipals-indexer/lib/metadata/projection-refresh.ts"
  );
  appPools = await import("../../apps/yunipals-indexer/lib/offchain/db.ts");
  const pool = new pg.Pool({ connectionString: base + database, max: 1 });
  await migrateIndexerControl(pool);
  await pool.end();
  for (const sql of migrations) await db.query(sql);
  for (const sql of projectionSchemaStatements) await db.query(sql);
  await db.query(
    `INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5)`,
    [
      plan.sourceRelease,
      physical,
      plan.buildId,
      plan.manifestHash,
      profile.manifest
    ]
  );
  await db.query(
    `INSERT INTO ${physical}._ponder_meta(key,value) VALUES('app',$1)`,
    [
      JSON.stringify({
        version: "6",
        build_id: plan.buildId,
        is_dev: 0,
        is_locked: 1,
        is_ready: 1,
        heartbeat_at: Date.now()
      })
    ]
  );
  for (const source of profile.manifest.sources)
    await db.query(
      `INSERT INTO ${physical}.indexer_source VALUES($1,$2,$3,$4)`,
      [source.id, source.chainId, plan.manifestHash, source]
    );
  for (const chain of [1, 8453, 137, 56]) {
    for (let n = head - 21; n <= head + 1; n++)
      await db.query(
        `INSERT INTO ${physical}.chain_block VALUES($1,$2,$3,$4,$5,$6)`,
        [
          `${chain}:${n}`,
          chain,
          String(n),
          hash(chain, n),
          hash(chain, n - 1),
          String(n)
        ]
      );
    await db.query(
      `INSERT INTO ${physical}._ponder_checkpoint VALUES($1,$2,$3,$3,$3)`,
      [String(chain), chain, checkpoint(chain, head)]
    );
    const anchors = Object.fromEntries(
      Array.from({ length: 22 }, (_, i) => {
        const n = head - 21 + i;
        return [
          String(n),
          { number: String(n), hash: hash(chain, n), timestamp: String(n) }
        ];
      })
    );
    await db.query(
      `INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,head_number,head_hash,witness_number,witness_hash,observed_at_ms,anchors)VALUES($1,$2,$3,$4,$3,$4,$5,$6)`,
      [plan.sourceRelease, chain, head, hash(chain, head), Date.now(), anchors]
    );
  }
  for (const statement of plan.expectedOwnerStatements)
    await db.query(statement.sql, statement.params);
  await db.query(
    "INSERT INTO metadata_source.archive_release(release_id,state)VALUES('fixture-archive','active')"
  );
  await db.query(
    "INSERT INTO metadata_source.chain_metadata_scan(name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash,last_scanned_hash,ingestion_mode)VALUES('base_metadata_v1',8453,$1,22224075,$2::bigint,$2::bigint-1,$3,$3,'native')",
    [collections.base.address, head + 1, hash(8453, head)]
  );
  const metadataEvent = `${8453}:${collections.base.address}:${hash(8453, 100)}:1`;
  const metadataSource = profile.manifest.sources.find(
    (s) => s.id === "metadata:base"
  );
  await db.query(
    `INSERT INTO ${physical}.canonical_event VALUES($1,'metadata:base',8453,$2,'Mint',$3,$4,$5,$6,$5,$7,0,1,'[]','0x')`,
    [
      metadataEvent,
      collections.base.address,
      {
        tokenId: "1",
        to: "0x" + "12".repeat(20),
        yunipal: { rarityScore: 42 }
      },
      metadataSource.abiHash,
      head - 10,
      hash(8453, head - 10),
      hash(8453, 100)
    ]
  );
  const frontier = metadataEvent + ":" + hash(8453, head - 10);
  await db.query(
    "INSERT INTO metadata_source.native_base_metadata_state(release_id,read_identity,state,frontier,implementation,checked_block,checked_hash)VALUES($1,$2,'ready',$3,'0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca',$4,$5)",
    [plan.sourceRelease, plan.readIdentity, frontier, head, hash(8453, head)]
  );
  for (const collection of collectionSlugs) {
    const config = collections[collection],
      mint = head - 15,
      tx = hash(config.chainId, 1000),
      owner = "0x" + "12".repeat(20);
    await db.query(
      `INSERT INTO ${physical}.token VALUES($1,$2,$3,'1',$4,false,1,$5,$5,$5,$5,$6)`,
      [collection, config.chainId, config.address, owner, mint, tx]
    );
    await db.query(
      `INSERT INTO ${physical}.token_lifecycle(collection,token_id,lifecycle,minted_to,mint_block,mint_timestamp,mint_transaction_hash)VALUES($1,'1',1,$2,$3,$3,$4)`,
      [collection, owner, mint, tx]
    );
    await db.query(
      `INSERT INTO ${physical}.transfer_event VALUES($1,$2,$3,$4,'1',1,$5,$6,$7,$7,$8,0,0)`,
      [
        `${collection}:mint`,
        collection,
        config.chainId,
        config.address,
        "0x" + "00".repeat(20),
        owner,
        mint,
        tx
      ]
    );
    await db.query(
      "INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at)VALUES($1,'ready',$2,now())",
      [collection, head]
    );
    const attrs = [
      { trait_type: "Rarity Points", value: "42" },
      { trait_type: "Type", value: "Yuni" }
    ];
    const document = {
      id: "1",
      name: "Synthetic Yuni",
      description: "fixture",
      attributes: attrs,
      rarity: 42
    };
    await db.query(
      "INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,token_uri,uri_provenance,document,attributes,content_hash)VALUES($1,1,1,'fixture:1','fixture',$2,$3,'fixture-hash')",
      [collection, document, JSON.stringify(attrs)]
    );
    await db.query(
      "INSERT INTO metadata.token_publication(collection,token_id,lifecycle,release_id,renderer_version,publication_content_hash,publication_status,mint_transaction_hash,mint_log_index,chain_event_key,chain_event_block_hash)VALUES($1,1,1,'fixture-archive','fixture','fixture-hash','published',$2,0,$3,$4)",
      [
        collection,
        tx,
        collection === "base" ? hash(8453, 100) + ":1" : null,
        collection === "base" ? hash(8453, head - 10) : null
      ]
    );
  }
  const current = await db.query(
    "INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state,ownership_release_id,ownership_read_identity,validation)VALUES('archive','fixture-archive','ready',$1,$2,'{}')RETURNING id",
    [plan.sourceRelease, plan.readIdentity]
  );
  const predecessor = current.rows[0].id;
  await db.query("UPDATE metadata_projection.active SET current_id=$1", [
    predecessor
  ]);
  await db.query(
    "INSERT INTO metadata.derived_snapshot(name,metadata_release_id,ownership_release_id,ownership_read_identity)VALUES('traits','fixture-archive',$1,$2)",
    [plan.sourceRelease, plan.readIdentity]
  );
  await db.query(
    "UPDATE metadata_source.native_base_metadata_state SET checked_at=statement_timestamp()-interval '89 seconds'"
  );
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  const input = await captureProjectionInputs(db);
  assert.equal(input.proof.baseMetadataFrontier, frontier);
  assert.equal(input.proof.anchors.length, 4);
  await other.query(
    "UPDATE metadata_source.native_base_metadata_state SET checked_at=clock_timestamp()"
  );
  await new Promise((r) => setTimeout(r, 2100));
  await db.query("SAVEPOINT stale");
  await assert.rejects(
    db.query(`SELECT * FROM ${logical}.base_metadata_frame(true)`),
    (e) => e.code === "YI001" && e.detail === "base_metadata_approval_pending"
  );
  await db.query("ROLLBACK TO SAVEPOINT stale");
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM ${input.metadataRelation}`))
      .rows[0].n,
    3
  );
  // BNB token mint is after its twenty-block boundary, so it is correctly absent.
  assert.equal(
    (await db.query(`SELECT count(*)::int AS n FROM ${input.tokenRelation}`))
      .rows[0].n,
    3
  );
  assert.equal(
    (
      await db.query(
        `SELECT bool_and(a.grantee=c.relowner)AS private FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))a WHERE c.oid=$1::regclass`,
        [input.metadataRelation]
      )
    ).rows[0].private,
    true
  );
  await db.query("COMMIT");
  assert.equal(
    (
      await db.query(
        "SELECT to_regclass('pg_temp.yunipals_projection_metadata_input')AS r"
      )
    ).rows[0].r,
    null
  );
  checks.push(
    "actual_90s_guard_expires_in_RR_but_single_statement_private_capture_survives_and_drops_at_commit"
  );
  // Put BNB mint before its canonical twenty-block boundary for the full build.
  for (const [table, columns] of [
    ["token", "mint_block=$1,last_transfer_block=$1"],
    ["token_lifecycle", "mint_block=$1"],
    ["transfer_event", "block_number=$1"]
  ])
    await db.query(
      `UPDATE ${physical}.${table} SET ${columns} WHERE collection='bnb'`,
      [head - 21]
    );
  await db.query(
    "UPDATE metadata_projection.generation SET ownership_release_id=NULL,ownership_read_identity=NULL WHERE id=$1",
    [predecessor]
  );
  await db.query(
    "UPDATE metadata.derived_snapshot SET ownership_release_id=NULL,ownership_read_identity=NULL WHERE name='traits'"
  );
  await db.query(
    "INSERT INTO metadata.derived_snapshot(name,metadata_release_id)VALUES('leaderboard','fixture-archive')"
  );
  await db.query(
    "INSERT INTO leaderboard.wallet_stats(scope,owner,monster_count,total_rarity,unique_types,special_count,glitter_count,collector_score,score_version,updated_at)VALUES('all','synthetic-legacy-wallet',1,7,1,0,0,7,'fixture',now())"
  );
  const globalBefore = (
    await db.query(
      "SELECT jsonb_build_object('pointer',(SELECT to_jsonb(a)FROM metadata_projection.active a),'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s),'wallets',(SELECT jsonb_agg(to_jsonb(s)ORDER BY scope,owner)FROM leaderboard.wallet_stats s))AS v"
    )
  ).rows[0].v;
  const staged = await refreshProjectionGeneration({ publish: false });
  assert(staged.prepared);
  const stagedRow = (
    await db.query(
      "SELECT state,published_at,validation FROM metadata_projection.generation WHERE id=$1",
      [staged.generationId]
    )
  ).rows[0];
  assert.equal(stagedRow.state, "ready");
  assert.equal(stagedRow.published_at, null);
  assert.equal(
    stagedRow.validation.sourceSnapshot.readIdentity,
    plan.readIdentity
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT jsonb_build_object('pointer',(SELECT to_jsonb(a)FROM metadata_projection.active a),'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s),'wallets',(SELECT jsonb_agg(to_jsonb(s)ORDER BY scope,owner)FROM leaderboard.wallet_stats s))AS v"
      )
    ).rows[0].v,
    globalBefore
  );
  checks.push(
    "native_candidate_build_and_validation_leave_legacy_global_pointer_wallets_and_stamps_unchanged"
  );

  const { prepareNativeLeaderboardCandidate, stagePreparedNativeLeaderboard } =
    await import(
      "../../apps/yunipals-indexer/lib/leaderboard/native-preparation.ts"
    );

  const digest = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const observed = await globalPublicationObservation(db, staged.generationId);
  const publishPlan = {
    generationId: staged.generationId,
    predecessorGenerationId: predecessor,
    metadataReleaseId: "fixture-archive",
    sourceRelease: plan.sourceRelease,
    readIdentity: plan.readIdentity,
    validationSqlSha256: observed.candidate.validationSha256,
    originalObservationSha256: digest(observed),
    candidateSourceSnapshot: stagedRow.validation.sourceSnapshot,
    boundaryPoints: stagedRow.validation.sourceSnapshot.anchors
      .map((anchor) => ({
        chainId: anchor.chain_id,
        number: String(BigInt(anchor.block_number) - 1n)
      }))
      .sort((a, b) => a.chainId - b.chainId)
  };
  const official = {
    prepareNativeLeaderboardCandidate,
    stagePreparedNativeLeaderboard,
    publishGenerationInTransaction
  };
  for (const name of loginNames) {
    await admin.query(
      `CREATE ROLE "${name}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`
    );
    createdLogins.push(name);
  }
  const loginRoleRows = (
    await db.query(
      "SELECT rolname,oid::text FROM pg_roles WHERE rolname=ANY($1::text[])",
      [loginNames]
    )
  ).rows;
  const loginRoles = Object.fromEntries(
    loginRoleRows.map((row) => [row.rolname, row.oid])
  );
  const catalogSql = `SELECT jsonb_build_object('roles',(SELECT jsonb_agg(jsonb_build_object(
    'name',rolname,'oid',oid::text,'login',rolcanlogin,'limit',rolconnlimit,
    'super',rolsuper,'createRole',rolcreaterole,'createDatabase',rolcreatedb,
    'bypassRls',rolbypassrls)ORDER BY rolname)FROM pg_roles WHERE rolname IN(${loginNames.map((name) => "'" + name + "'").join(",")})),
    'retainedACL',(SELECT relacl::text FROM pg_class WHERE oid='leaderboard.wallet_stats'::regclass))AS value`;
  const roleBefore = (await db.query(catalogSql)).rows[0].value;
  const roleAfter = structuredClone(roleBefore);
  for (const row of roleAfter.roles) row.login = true;
  let refusedRolePacket;
  await assert.rejects(
    changeReaderLogins(
      db,
      { mode: "roles", before: roleBefore, after: roleAfter, catalogSql },
      async (packet) => {
        refusedRolePacket = packet;
        assert.deepEqual(
          (await other.query(catalogSql)).rows[0].value,
          roleBefore
        );
        return false;
      },
      loginRoles
    ),
    /separate_durable_LOGIN_intent_ACK_required/
  );
  assert.deepEqual((await other.query(catalogSql)).rows[0].value, roleBefore);
  assert.equal(
    (
      await other.query("SELECT pg_xact_status($1::xid8)AS state", [
        refusedRolePacket.xid
      ])
    ).rows[0].state,
    "aborted"
  );
  const roleAdmission = await changeReaderLogins(
    db,
    { mode: "roles", before: roleBefore, after: roleAfter, catalogSql },
    async () => true,
    loginRoles
  );
  assert.equal(roleAdmission.committed, true);
  assert.deepEqual((await other.query(catalogSql)).rows[0].value, roleAfter);
  const roleInverse = await changeReaderLogins(
    db,
    { mode: "roles-inverse", before: roleAfter, after: roleBefore, catalogSql },
    async () => true,
    loginRoles
  );
  assert.equal(roleInverse.committed, true);
  assert.deepEqual((await other.query(catalogSql)).rows[0].value, roleBefore);
  checks.push(
    "separate_two_role_LOGIN_admission_requires_its_own_durable_ACK_preserves_other_attributes_and_owned_inverse_restores_NOLOGIN"
  );
  const freshClient = async () => {
    const client = new pg.Client({ connectionString: base + database });
    await client.connect();
    await client.query(`SET search_path=${physical},public`);
    return client;
  };
  const restoreGlobal = async () => {
    await db.query("BEGIN");
    await db.query(
      "UPDATE metadata_projection.active a SET current_id=v.current_id,previous_id=v.previous_id,updated_at=v.updated_at FROM jsonb_populate_record(NULL::metadata_projection.active,$1)v WHERE a.singleton",
      [globalBefore.pointer]
    );
    await db.query("DELETE FROM metadata.derived_snapshot");
    await db.query(
      "INSERT INTO metadata.derived_snapshot SELECT * FROM jsonb_populate_recordset(NULL::metadata.derived_snapshot,$1)",
      [JSON.stringify(globalBefore.stamps)]
    );
    await db.query("DELETE FROM leaderboard.wallet_stats");
    await db.query(
      "INSERT INTO leaderboard.wallet_stats SELECT * FROM jsonb_populate_recordset(NULL::leaderboard.wallet_stats,$1)",
      [JSON.stringify(globalBefore.wallets)]
    );
    await db.query(
      "UPDATE metadata_projection.generation SET published_at=NULL WHERE id=$1",
      [staged.generationId]
    );
    await db.query("COMMIT");
  };
  const snapshotRole = "cutover_snapshot_" + randomBytes(5).toString("hex");
  await admin.query(
    `CREATE ROLE "${snapshotRole}" LOGIN PASSWORD 'synthetic_disposable_snapshot' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2`
  );
  createdLogins.push(snapshotRole);
  for (const schema of [
    physical,
    logical,
    "metadata",
    "metadata_source",
    "metadata_projection",
    "leaderboard",
    "yunipals_indexer_control"
  ]) {
    await db.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${snapshotRole}"`);
    await db.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${snapshotRole}"`
    );
    await db.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA "${schema}" TO "${snapshotRole}"`
    );
  }
  await db.query(
    `GRANT INSERT,UPDATE,DELETE ON leaderboard.wallet_stats,metadata.derived_snapshot,metadata_projection.active,metadata_projection.generation TO "${snapshotRole}"`
  );
  await db.query(
    `GRANT UPDATE ON metadata_source.archive_release TO "${snapshotRole}"`
  );
  const snapshot = new pg.Client({
    host: "127.0.0.1",
    port: 56967,
    database,
    user: snapshotRole,
    password: "synthetic_disposable_snapshot"
  });
  await snapshot.connect();
  try {
    const identity = (
      await snapshot.query(
        "SELECT current_user,session_user,p.usesysid::text AS authenticated_oid,(SELECT oid::text FROM pg_roles WHERE rolname=current_user)AS current_oid,pg_backend_pid()AS pid FROM pg_stat_activity p WHERE p.pid=pg_backend_pid()"
      )
    ).rows[0];
    assert.equal(identity.current_user, snapshotRole);
    assert.equal(identity.session_user, snapshotRole);
    assert.equal(identity.authenticated_oid, identity.current_oid);
    assert.equal(
      (
        await other.query(
          "SELECT usesysid::text AS oid FROM pg_stat_activity WHERE pid=$1",
          [identity.pid]
        )
      ).rows[0].oid,
      identity.authenticated_oid
    );
    await publishPreparedCandidate(snapshot, official, publishPlan, {
      privatePrepared: async () => true,
      beforeCommit: async () => true
    });
    const lineage = await observeGenerationRecovery(snapshot);
    assert.equal(lineage.pointer.current_id, staged.generationId);
    assert.match(lineage.generationBindingSha256, /^[0-9a-f]{64}$/);
    assert.equal(lineage.walletStats.count, "15");
    assert.equal(
      (
        await other.query(
          "SELECT bool_or(has_table_privilege($1,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))AS native_write FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2",
          [snapshotRole, physical]
        )
      ).rows[0].native_write,
      false
    );
    checks.push(
      "one_direct_authenticated_non_super_snapshot_role_owns_private_and_publication_transactions_with_exact_pg_stat_activity_identity_and_no_native_write_grants"
    );
  } finally {
    await snapshot.end();
  }
  await restoreGlobal();
  let client = await freshClient();
  try {
    await assert.rejects(
      publishPreparedCandidate(client, official, publishPlan, {
        privatePrepared: async () => false,
        beforeCommit: async () => {
          throw Error("must_not_stage");
        }
      }),
      /private_preparation_root_ACK_required/
    );
    assert.deepEqual(
      await globalPublicationObservation(other, staged.generationId),
      observed
    );
    checks.push(
      "refused_private_preparation_ACK_leaves_original_global_pointer_wallet_and_both_stamps_visible"
    );
  } finally {
    await client.end();
  }

  client = await freshClient();
  let aborted;
  try {
    await assert.rejects(
      publishPreparedCandidate(client, official, publishPlan, {
        privatePrepared: async (message) => {
          assert.equal(message.walletRows, "15");
          assert.deepEqual(
            await globalPublicationObservation(other, staged.generationId),
            observed
          );
          return true;
        },
        beforeCommit: async (message) => {
          aborted = message;
          assert.deepEqual(
            await globalPublicationObservation(other, staged.generationId),
            observed
          );
          assert.equal(
            (
              await other.query("SELECT pg_xact_status($1::xid8)AS state", [
                message.xid
              ])
            ).rows[0].state,
            "in progress"
          );
          return false;
        }
      }),
      /durable_root_publication_intent_ACK_required/
    );
    assert.equal(
      (
        await other.query("SELECT pg_xact_status($1::xid8)AS state", [
          aborted.xid
        ])
      ).rows[0].state,
      "aborted"
    );
    assert.deepEqual(
      await globalPublicationObservation(other, staged.generationId),
      observed
    );
    checks.push(
      "staged_wallet_and_stamp_remain_invisible_and_missing_root_COMMIT_ACK_rolls_every_global_change_back"
    );
  } finally {
    await client.end();
  }

  client = await freshClient();
  const marker = [];
  let committedPacket;
  const wrapped = {
    query: async (text, args) => {
      marker.push(text === "COMMIT" ? "COMMIT" : "query");
      return client.query(text, args);
    }
  };
  const traced = {
    ...official,
    publishGenerationInTransaction: async (...args) => {
      marker.push("final_CAS_start");
      await official.publishGenerationInTransaction(...args);
      marker.push("final_CAS_end");
    }
  };
  try {
    const result = await publishPreparedCandidate(
      wrapped,
      traced,
      publishPlan,
      {
        privatePrepared: async () => true,
        beforeCommit: async (message) => {
          committedPacket = message;
          assert.deepEqual(
            await globalPublicationObservation(other, staged.generationId),
            observed
          );
          marker.push("root_durable_ACK");
          return true;
        }
      }
    );
    assert.equal(result.published, true);
    assert.equal(
      (
        await other.query("SELECT pg_xact_status($1::xid8)AS state", [
          result.xid
        ])
      ).rows[0].state,
      "committed"
    );
    assert.deepEqual(result.after.pointer, {
      current: staged.generationId,
      previous: predecessor
    });
    assert.deepEqual(result.after.stamps, committedPacket.expectedStamps);
    assert.deepEqual(
      result.after.walletStats,
      committedPacket.staged.walletStats
    );
    const end = marker.indexOf("final_CAS_end");
    assert.equal(marker[end + 1], "COMMIT");
    assert(
      marker.indexOf("root_durable_ACK") < marker.indexOf("final_CAS_start")
    );
    assert.equal(marker.filter((v) => v === "COMMIT").length, 2); // Private-temp and sole-global commits.
    checks.push(
      "actual_private_handle_survives_same_session_and_single_global_commit_publishes_pointer_wallets_and_two_stamps_atomically"
    );
    checks.push(
      "root_ACK_precedes_final_dual_source_CAS_and_its_next_operation_is_the_sole_global_COMMIT"
    );
  } finally {
    await client.end();
  }
  await restoreGlobal();

  client = await freshClient();
  let commits = 0,
    lost;
  const loseACK = {
    query: async (...args) => {
      const value = await client.query(...args);
      if (args[0] === "COMMIT" && ++commits === 2)
        throw Error("simulated_lost_global_COMMIT_ACK");
      return value;
    }
  };
  try {
    await assert.rejects(
      publishPreparedCandidate(loseACK, official, publishPlan, {
        privatePrepared: async () => true,
        beforeCommit: async (packet) => {
          lost = packet;
          return true;
        }
      }),
      /simulated_lost_global_COMMIT_ACK/
    );
    assert.equal(commits, 2);
    assert.equal(
      (await other.query("SELECT pg_xact_status($1::xid8)AS state", [lost.xid]))
        .rows[0].state,
      "committed"
    );
    const current = await globalPublicationObservation(
      other,
      staged.generationId
    );
    assert.deepEqual(current.pointer, lost.expectedPointer);
    assert.deepEqual(current.stamps, lost.expectedStamps);
    assert.deepEqual(current.walletStats, lost.staged.walletStats);
    checks.push(
      "lost_global_COMMIT_ACK_leaves_own_committed_XID_and_exact_tuple_for_readonly_reconcile_with_no_republication"
    );
  } finally {
    await client.end();
  }
  await restoreGlobal();

  client = await freshClient();
  let mutated;
  try {
    await assert.rejects(
      publishPreparedCandidate(client, official, publishPlan, {
        privatePrepared: async () => true,
        beforeCommit: async (packet) => {
          const proof = stagedRow.validation.sourceSnapshot.anchors.find(
            (v) => v.collection === "polygon"
          );
          mutated = (
            await other.query(
              `DELETE FROM ${physical}.chain_block WHERE chain_id=$1 AND block_number=$2 RETURNING *`,
              [proof.chain_id, proof.block_number]
            )
          ).rows[0];
          assert(mutated);
          return true;
        }
      }),
      /projection_publication_source_changed|YI001|source|canonical/
    );
    assert.deepEqual(
      await globalPublicationObservation(other, staged.generationId),
      observed
    );
    checks.push(
      "canonical_reorg_after_root_ACK_is_rechecked_by_actual_final_dual_proof_and_cannot_publish_staged_wallets"
    );
  } finally {
    await client.end();
    if (mutated)
      await db.query(
        `INSERT INTO ${physical}.chain_block SELECT * FROM jsonb_populate_record(NULL::${physical}.chain_block,$1)`,
        [JSON.stringify(mutated)]
      );
  }
  console.log(
    JSON.stringify({
      format: "yunipals-ypal-native-cutover-publication-postgres-v1",
      passed: true,
      groups: checks.length,
      checks,
      productionQueries: 0,
      providerCalls: 0
    })
  );
} finally {
  await appPools?.pool.end();
  await appPools?.apiPool.end();
  await db?.end();
  await other?.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  if (readerCreated) await admin.query(`DROP ROLE "${reader}"`);
  for (const name of createdLogins) await admin.query(`DROP ROLE "${name}"`);
  await admin.end();
}
