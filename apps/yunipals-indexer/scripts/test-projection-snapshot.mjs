// Genuine local PG16, actual registered read-view functions and generation code.
// Fresh synthetic database only; no RPC, production configuration or row exports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const database = `projection_snapshot_${randomBytes(5).toString("hex")}_test`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
let db,
  other,
  created = false,
  appPools;
const checks = [];
const reader = "projection_reader_" + randomBytes(4).toString("hex");
let readerCreated = false;
const root = new URL("../../../", import.meta.url);
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
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
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
    "../lib/unified/control-schema.ts"
  );
  const { migrations } = await import("../lib/offchain/migrations.ts");
  const { projectionSchemaStatements } = await import(
    "../lib/metadata/projection-schema.ts"
  );
  const { collections, collectionSlugs } = await import("../lib/constants.ts");
  const {
    captureProjectionInputs,
    projectionSourceSnapshot,
    preservedProjectionGenerations
  } = await import("../lib/metadata/projection-snapshot.ts");
  const { refreshProjectionGeneration, publishGeneration } = await import(
    "../lib/metadata/projection-refresh.ts"
  );
  appPools = await import("../lib/offchain/db.ts");
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
  const generated = await refreshProjectionGeneration();
  const published = generated.generationId;
  const candidate = (
    await db.query("SELECT * FROM metadata_projection.generation WHERE id=$1", [
      published
    ])
  ).rows[0];
  assert.equal(candidate.state, "ready");
  assert.equal(candidate.validation.search_count, "4");
  const proof = projectionSourceSnapshot(candidate.validation.sourceSnapshot);
  assert.equal(proof.predecessor, predecessor);
  assert.equal(
    (await db.query("SELECT current_id FROM metadata_projection.active"))
      .rows[0].current_id,
    published
  );
  checks.push(
    "actual_full_search_traits_revision_facets_build_persists_four_anchor_proof_and_publishes_matching_stamp"
  );
  const baseline = async () =>
    (
      await db.query(
        "SELECT jsonb_build_object('pointer',(SELECT to_jsonb(a)FROM metadata_projection.active a),'stamp',(SELECT to_jsonb(s)FROM metadata.derived_snapshot s WHERE name='traits'),'published',(SELECT published_at FROM metadata_projection.generation WHERE id=$1))AS value",
        [published]
      )
    ).rows[0].value;
  // Rewind only synthetic fixture pointer/stamp for each publication attempt.
  const reset = async () => {
    await db.query(
      "UPDATE metadata_projection.active SET current_id=$1,previous_id=NULL",
      [predecessor]
    );
    await db.query(
      "UPDATE metadata_projection.generation SET published_at=NULL WHERE id=$1",
      [published]
    );
  };
  const refuse = async (name, change, restore) => {
    await reset();
    await change();
    const before = await baseline();
    await assert.rejects(
      publishGeneration(db, published, "fixture-archive", predecessor)
    );
    assert.deepEqual(await baseline(), before);
    await restore();
    checks.push(name);
  };
  await refuse(
    "canonical_anchor_hash_change_refuses_without_pointer_stamp_or_published_change",
    () =>
      db.query(
        `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE chain_id=1 AND block_number=$2`,
        [hash(1, 999), head]
      ),
    () =>
      db.query(
        `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE chain_id=1 AND block_number=$2`,
        [hash(1, head), head]
      )
  );
  await refuse(
    "canonical_anchor_delete_refuses",
    () =>
      db.query(
        `UPDATE ${physical}.chain_block SET block_number=block_number+100 WHERE chain_id=137 AND block_number=$1`,
        [head]
      ),
    () =>
      db.query(
        `UPDATE ${physical}.chain_block SET block_number=block_number-100 WHERE chain_id=137 AND block_number=$1`,
        [head + 100]
      )
  );
  await refuse(
    "halted_source_refuses",
    () =>
      db.query(
        "UPDATE yunipals_indexer_control.chain_status SET halted=true WHERE chain_id=56"
      ),
    () =>
      db.query(
        "UPDATE yunipals_indexer_control.chain_status SET halted=false WHERE chain_id=56"
      )
  );
  await refuse(
    "stale_source_refuses",
    () =>
      db.query(
        "UPDATE yunipals_indexer_control.chain_status SET observed_at_ms=0 WHERE chain_id=1"
      ),
    () =>
      db.query(
        "UPDATE yunipals_indexer_control.chain_status SET observed_at_ms=$1 WHERE chain_id=1",
        [Date.now()]
      )
  );
  await refuse(
    "changed_read_identity_refuses",
    () =>
      db.query(`UPDATE ${logical}._unified_read_release SET identity=$1`, [
        hash(1, 999)
      ]),
    () =>
      db.query(`UPDATE ${logical}._unified_read_release SET identity=$1`, [
        plan.readIdentity
      ])
  );
  await refuse(
    "archive_release_change_refuses",
    () =>
      db.query("UPDATE metadata_source.archive_release SET state='superseded'"),
    () => db.query("UPDATE metadata_source.archive_release SET state='active'")
  );
  await refuse(
    "native_metadata_frontier_change_refuses_even_with_fresh_approval",
    async () => {
      const id = metadataEvent + "later";
      await db.query(
        `INSERT INTO ${physical}.canonical_event SELECT $1,source_id,chain_id,address,'Update',args,abi_hash,block_number+1,$2,timestamp,transaction_hash,transaction_index,log_index+1,topics,data FROM ${physical}.canonical_event WHERE id=$3`,
        [id, hash(8453, head - 9), metadataEvent]
      );
      await db.query(
        "UPDATE metadata_source.native_base_metadata_state SET frontier=$1,checked_at=now()",
        [id + ":" + hash(8453, head - 9)]
      );
    },
    async () => {
      await db.query(`DELETE FROM ${physical}.canonical_event WHERE id=$1`, [
        metadataEvent + "later"
      ]);
      await db.query(
        "UPDATE metadata_source.native_base_metadata_state SET frontier=$1,checked_at=now()",
        [frontier]
      );
    }
  );
  await refuse(
    "native_checkpoint_regression_refuses",
    () =>
      db.query(
        `UPDATE ${physical}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=137`,
        [checkpoint(137, head - 1)]
      ),
    () =>
      db.query(
        `UPDATE ${physical}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=137`,
        [checkpoint(137, head)]
      )
  );
  await refuse(
    "candidate_snapshot_mutation_refuses",
    () =>
      db.query(
        "UPDATE metadata_projection.generation SET validation=jsonb_set(validation,'{sourceSnapshot,readIdentity}',$2::jsonb)WHERE id=$1",
        [published, JSON.stringify(hash(1, 3))]
      ),
    () =>
      db.query(
        "UPDATE metadata_projection.generation SET validation=jsonb_set(validation,'{sourceSnapshot}',$2::jsonb)WHERE id=$1",
        [published, proof]
      )
  );
  await reset();
  await db.query(
    `UPDATE ${physical}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=8453`,
    [checkpoint(8453, head + 1)]
  );
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET head_number=$1,head_hash=$2,anchors=anchors||$3::jsonb,observed_at_ms=$4 WHERE chain_id=8453",
    [
      head + 1,
      hash(8453, head + 1),
      JSON.stringify({
        [head + 1]: {
          number: String(head + 1),
          hash: hash(8453, head + 1),
          timestamp: String(head + 1)
        }
      }),
      Date.now()
    ]
  );
  await publishGeneration(db, published, "fixture-archive", predecessor);
  assert.equal(
    (await db.query("SELECT current_id FROM metadata_projection.active"))
      .rows[0].current_id,
    published
  );
  checks.push(
    "ordinary_head_advance_preserving_metadata_frontier_and_all_canonical_anchors_succeeds"
  );
  // Exercise the real invoker guards with operational DML but no native UPDATE.
  await admin.query(`CREATE ROLE "${reader}" NOLOGIN`);
  readerCreated = true;
  await db.query(
    `GRANT USAGE ON SCHEMA ${physical},${logical},yunipals_indexer_control,metadata,metadata_source,metadata_projection TO "${reader}"`
  );
  await db.query(
    `GRANT SELECT ON ${physical}._ponder_meta,${physical}._ponder_checkpoint,${physical}.indexer_source,${physical}.chain_block,${physical}.canonical_event TO "${reader}"`
  );
  await db.query(
    `GRANT SELECT ON yunipals_indexer_control.release,yunipals_indexer_control.chain_status TO "${reader}"`
  );
  await db.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${logical},metadata,metadata_source TO "${reader}"`
  );
  await db.query(
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${logical} TO "${reader}"`
  );
  await db.query(
    `GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA metadata_projection TO "${reader}"`
  );
  await db.query(
    `GRANT INSERT,UPDATE ON metadata.derived_snapshot TO "${reader}"`
  );
  await db.query(
    `GRANT UPDATE ON metadata_source.archive_release TO "${reader}"`
  );
  await reset();
  await db.query(`SET ROLE "${reader}"`);
  assert.equal(
    (
      await db.query(
        "SELECT has_table_privilege(current_user,$1,'UPDATE')AS allowed",
        [physical + ".chain_block"]
      )
    ).rows[0].allowed,
    false
  );
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  assert.equal((await captureProjectionInputs(db)).proof.anchors.length, 4);
  await db.query("ROLLBACK");
  await publishGeneration(db, published, "fixture-archive", predecessor);
  await db.query("RESET ROLE");
  checks.push(
    "nonowner_invoker_role_captures_and_publishes_with_zero_native_UPDATE_or_SECDEF_grants"
  );
  // A canonical change committed after preliminary candidate checks is still
  // rejected by the pointer UPDATE's own single statement predicate.
  await reset();
  const beforeRace = await baseline();
  let raced = false;
  const interleaved = {
    query: async (text, values) => {
      if (
        typeof text === "string" &&
        text.startsWith("UPDATE metadata_projection.active") &&
        !raced
      ) {
        raced = true;
        await other.query(
          `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE chain_id=1 AND block_number=$2`,
          [hash(1, 777), head]
        );
      }
      return db.query(text, values);
    }
  };
  // Give the second fixture session its required Ponder notification table.
  await other.query(`SET search_path=${physical},public`);
  await other.query(
    "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)"
  );
  await assert.rejects(
    publishGeneration(interleaved, published, "fixture-archive", predecessor)
  );
  assert(raced);
  assert.deepEqual(await baseline(), beforeRace);
  await db.query(
    `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE chain_id=1 AND block_number=$2`,
    [hash(1, head), head]
  );
  checks.push(
    "canonical_change_after_preliminary_checks_is_refused_inside_pointer_UPDATE"
  );
  for (const invalid of [
    "0",
    "1,1",
    "01",
    "-1",
    "9223372036854775808",
    "1;DROP TABLE x"
  ])
    assert.throws(() => preservedProjectionGenerations(invalid));
  assert.deepEqual(preservedProjectionGenerations("1,2"), ["1", "2"]);
  checks.push("rollback_generation_retention_is_explicit_and_strict");
  const oldIds = [];
  for (let i = 0; i < 2; i++) {
    const row = (
      await db.query(
        "INSERT INTO metadata_projection.generation(source_mode,metadata_release_id,state,started_at)VALUES('archive','fixture-archive','ready',now()-interval '1 hour')RETURNING id"
      )
    ).rows[0];
    oldIds.push(row.id);
    await db.query(
      "INSERT INTO metadata_projection.search(generation_id,collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped,updated_at) SELECT $1,collection,token_id,lifecycle,metadata_available,rarity_points,rarity_points_capped,updated_at FROM metadata_projection.search WHERE generation_id=$2",
      [row.id, published]
    );
  }
  process.env.PROJECTION_PRESERVE_GENERATION_IDS = oldIds[0];
  await refreshProjectionGeneration();
  delete process.env.PROJECTION_PRESERVE_GENERATION_IDS;
  const retention = (
    await db.query(
      "SELECT g.id,g.state,(SELECT count(*)::int FROM metadata_projection.search s WHERE s.generation_id=g.id)AS rows FROM metadata_projection.generation g WHERE id=ANY($1::bigint[])ORDER BY id",
      [oldIds]
    )
  ).rows;
  assert.deepEqual(retention, [
    { id: oldIds[0], state: "ready", rows: 4 },
    { id: oldIds[1], state: "retired", rows: 0 }
  ]);
  checks.push(
    "actual_cleanup_keeps_explicit_capsule_predecessor_payload_and_cleans_unretained_candidate"
  );

  const { refreshLeaderboard } = await import("../lib/leaderboard/refresh.ts");
  const selected = (
    await db.query("SELECT current_id FROM metadata_projection.active")
  ).rows[0].current_id;
  const countGenerations = async () =>
    (
      await db.query(
        "SELECT count(*)::int AS n FROM metadata_projection.generation"
      )
    ).rows[0].n;
  const numberOfGenerations = await countGenerations();
  const completed = await refreshLeaderboard(selected);
  assert.equal(completed.wallets, 1);
  assert.equal(await countGenerations(), numberOfGenerations);
  assert.equal(
    (
      await db.query(
        "SELECT monster_count,total_rarity::text FROM leaderboard.wallet_stats WHERE scope='all'"
      )
    ).rows[0].monster_count,
    4
  );
  const derived = async () =>
    (
      await db.query(
        "SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(s)ORDER BY scope,owner)FROM leaderboard.wallet_stats s),'stamp',(SELECT to_jsonb(s)FROM metadata.derived_snapshot s WHERE name='leaderboard'))AS v"
      )
    ).rows[0].v;
  const beforeWrong = await derived();
  await assert.rejects(
    refreshLeaderboard("999999"),
    /leaderboard_published_generation_changed/
  );
  assert.deepEqual(await derived(), beforeWrong);
  checks.push(
    "native_leaderboard_only_completes_exact_published_generation_without_second_trait_build"
  );
  const interleavedClient = await appPools.pool.connect();
  const originalQuery = interleavedClient.query;
  let leaderboardRace = false;
  interleavedClient.query = async function (text, ...values) {
    if (
      typeof text === "string" &&
      text.startsWith("UPDATE metadata_projection.active a SET") &&
      !leaderboardRace
    ) {
      leaderboardRace = true;
      await other.query(
        `UPDATE ${physical}.chain_block SET block_hash=$1 WHERE chain_id=137 AND block_number=$2`,
        [hash(137, 777), head]
      );
    }
    return originalQuery.call(this, text, ...values);
  };
  interleavedClient.release();
  try {
    await assert.rejects(
      refreshLeaderboard(selected),
      (e) =>
        e.code === "YI001" ||
        e.message === "leaderboard_publication_source_changed"
    );
  } finally {
    interleavedClient.query = originalQuery;
  }
  assert(leaderboardRace);
  assert.deepEqual(await derived(), beforeWrong);
  assert.equal(await countGenerations(), numberOfGenerations);
  checks.push(
    "leaderboard_fresh_publication_rejects_post_compute_reorg_without_replacing_rows_or_stamp"
  );
  await db.query(
    `UPDATE ${physical}._ponder_checkpoint SET latest_checkpoint=$1 WHERE chain_id=137`,
    [checkpoint(137, head + 1)]
  );
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET head_number=$1,head_hash=$2,witness_number=$1,witness_hash=$2,anchors=anchors||$3::jsonb,observed_at_ms=$4 WHERE chain_id=137",
    [
      head + 1,
      hash(137, head + 1),
      JSON.stringify({
        [head + 1]: {
          number: String(head + 1),
          hash: hash(137, head + 1),
          timestamp: String(head + 1)
        }
      }),
      Date.now()
    ]
  );
  // The current frame is independently valid after a reorg, while the already
  // published traits anchor is gone. Completion must require a trait rebuild.
  await db.query(`SELECT * FROM ${logical}.source_boundary('polygon')`);
  await assert.rejects(
    refreshLeaderboard(selected),
    /leaderboard_publication_source_changed/
  );
  assert.deepEqual(await derived(), beforeWrong);
  assert.equal(await countGenerations(), numberOfGenerations);
  checks.push(
    "reorg_before_leaderboard_capture_refuses_even_when_current_frame_is_fresh_and_canonical"
  );

  console.log(
    JSON.stringify({
      format: "yunipals-projection-snapshot-postgres-v1",
      passed: true,
      groups: checks.length,
      checks,
      productionQueries: 0,
      providerCalls: 0,
      publicTtlModified: false,
      nativeWriteGrantsAdded: 0
    })
  );
} finally {
  await appPools?.pool.end();
  await appPools?.apiPool.end();
  await db?.end();
  await other?.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  if (readerCreated) await admin.query(`DROP ROLE "${reader}"`);
  await admin.end();
}
