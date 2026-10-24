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
  globalPublicationObservation
} from "./ypal-native-cutover-v1.mjs";
import {
  observeGenerationRecovery,
  captureGenerationRecovery,
  verifyGenerationRecovery
} from "./ypal-generation-recovery-v1.mjs";
import {
  inspectGenerationLineage,
  validateLineage,
  retainedGenerationSelector,
  generationRecord,
  sealCycle,
  digest as lineageDigest,
  FORMAT as LINEAGE_FORMAT,
  generationIdentity
} from "./ypal-generation-lineage-v1.mjs";
import { restoreGenerationLineageRecovery } from "./ypal-generation-lineage-recovery-v1.mjs";
import {
  runGenerationLineageCycle,
  reconcileGenerationLineageCycle
} from "./ypal-generation-lineage-cycle-v1.mjs";

const base =
  "postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/";
const database = `generation_lineage_${randomBytes(5).toString("hex")}_test`;
const admin = new pg.Pool({ connectionString: base + "postgres", max: 1 });
let db,
  other,
  created = false,
  appPools;
const checks = [];
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
// Public/default fixture has no dependency on a pre-existing private artifact.
// This is the exact cleanup body in source91c2 embedded by the pinned f81 map
// a3ab4315411d0621940cb0e6716f1a93bcb4a4010f836efda65f29fef8de44cd.
const cleanupSource = readFileSync(
  new URL(
    "../../apps/yunipals-indexer/lib/metadata/projection-refresh.ts",
    import.meta.url
  ),
  "utf8"
);
const cleanupBody = cleanupSource.slice(
  cleanupSource.indexOf("async function cleanupGenerations("),
  cleanupSource.indexOf("\n/** Build into stable tables;")
);
assert.equal(
  createHash("sha256").update(cleanupBody).digest("hex"),
  "2d56fedf4a1fae3a3df4e002920608717980a151f4222a5225ad0f480dfa9c54",
  "real fixture must exercise the unchanged installed f81 cleanup body"
);
assert.equal(
  createHash("sha256")
    .update(
      cleanupSource.slice(
        cleanupSource.indexOf(
          "export async function refreshProjectionGeneration("
        )
      )
    )
    .digest("hex"),
  "ef222bf3b29e3feeb1681b7c7d789c609f60908e21e7879424cb264bcd9e56cc",
  "actual preparation through EOF must equal the installed f81 source91c2 body"
);
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
  // Put BNB mint before the actual twenty-block canonical boundary.
  for (const [table, columns] of [
    ["token", "mint_block=$1,last_transfer_block=$1"],
    ["token_lifecycle", "mint_block=$1"],
    ["transfer_event", "block_number=$1"]
  ])
    await db.query(
      `UPDATE ${physical}.${table} SET ${columns} WHERE collection='bnb'`,
      [head - 21]
    );
  // Original capsule fixture: legacy103/prior102, no native identity relabel.
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
        `CREATE TABLE ${old}.${table}(LIKE ${physical}.${table} INCLUDING ALL)`
      );
  }
  const { installReadCache } = await import(
    "../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts"
  );
  await db.query("BEGIN");
  await installReadCache(db);
  await db.query("COMMIT");
  for (const id of [102, 103])
    await db.query(
      "INSERT INTO metadata_projection.generation(id,source_mode,metadata_release_id,state,validation,started_at)OVERRIDING SYSTEM VALUE VALUES($1,'archive','fixture-archive','ready','{}',now()-interval '2 hours')",
      [id]
    );
  await db.query(
    "SELECT setval(pg_get_serial_sequence('metadata_projection.generation','id'),103,true)"
  );
  await db.query(
    "UPDATE metadata_projection.active SET current_id=103,previous_id=102"
  );
  await db.query(
    "INSERT INTO metadata.derived_snapshot(name,metadata_release_id)VALUES('traits','fixture-archive'),('leaderboard','fixture-archive')"
  );
  await db.query(
    "INSERT INTO leaderboard.wallet_stats(scope,owner,monster_count,total_rarity,unique_types,special_count,glitter_count,collector_score,score_version,updated_at)VALUES('all','synthetic-original-wallet',1,7,1,0,0,7,'fixture',now())"
  );
  const original = await observeGenerationRecovery(db),
    external = "ab".repeat(32);
  const capsule = await captureGenerationRecovery(db, external);
  assert.equal(capsule.currentGeneration, "103");
  assert.equal(capsule.previousGeneration, "102");
  checks.push(
    "actual owner-only original103 capsule capture with exact legacy null stamps"
  );
  const { prepareNativeLeaderboardCandidate, stagePreparedNativeLeaderboard } =
    await import(
      "../../apps/yunipals-indexer/lib/leaderboard/native-preparation.ts"
    );
  const official = {
    prepareNativeLeaderboardCandidate,
    stagePreparedNativeLeaderboard,
    publishGenerationInTransaction
  };
  const observedTuple = async () =>
    (
      await other.query(
        "SELECT jsonb_build_object('pointer',(SELECT to_jsonb(a)FROM metadata_projection.active a),'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s),'wallets',(SELECT jsonb_agg(to_jsonb(s)ORDER BY scope,owner)FROM leaderboard.wallet_stats s))AS value"
      )
    ).rows[0].value;
  const ordinaryPoints = [1, 8453, 137, 56].map((chainId) => ({
    chainId,
    number: String(head - 21)
  }));
  const hashObject = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  async function publishNext(ageForCleanup = false) {
    const before = await observedTuple();
    const prepared = await refreshProjectionGeneration({ publish: false });
    assert.deepEqual(await observedTuple(), before);
    const row = await generationRecord(db, prepared.generationId);
    const observation = await globalPublicationObservation(
      db,
      prepared.generationId
    );
    const publishPlan = {
      generationId: prepared.generationId,
      predecessorGenerationId: observation.pointer.current,
      metadataReleaseId: "fixture-archive",
      sourceRelease: plan.sourceRelease,
      readIdentity: plan.readIdentity,
      candidateSourceSnapshot: row.value.validation.sourceSnapshot,
      validationSqlSha256: observation.candidate.validationSha256,
      originalObservationSha256: hashObject(observation),
      boundaryPoints: ordinaryPoints
    };
    const client = new pg.Client({ connectionString: base + database });
    await client.connect();
    let sawPrivate = false,
      sawStaged = false;
    try {
      const publication = await publishPreparedCandidate(
        client,
        official,
        publishPlan,
        {
          privatePrepared: async () => {
            assert.deepEqual(await observedTuple(), before);
            sawPrivate = true;
            return true;
          },
          beforeCommit: async () => {
            assert.deepEqual(await observedTuple(), before);
            sawStaged = true;
            return true;
          }
        }
      );
      assert(sawPrivate && sawStaged);
      assert.equal(publication.after.pointer.current, prepared.generationId);
      assert.equal(publication.after.stamps.length, 2);
      assert(
        publication.after.stamps.every(
          (s) =>
            s.sourceRelease === plan.sourceRelease &&
            s.readIdentity === plan.readIdentity
        )
      );
      // Explicit local clock emulation makes actual f81 cleanup eligible without
      // sleeping15minutes. No public TTL, source guard or production code changes.
      if (ageForCleanup)
        await db.query(
          "UPDATE metadata_projection.generation SET started_at=now()-interval '40 minutes',completed_at=now()-interval '30 minutes',published_at=now()-interval '20 minutes'WHERE id=$1",
          [prepared.generationId]
        );
      const record = await generationRecord(db, prepared.generationId);
      return {
        generationId: prepared.generationId,
        predecessorGenerationId: publishPlan.predecessorGenerationId,
        rowSqlSha256: record.rowSqlSha256,
        immutableSqlSha256: record.immutableSqlSha256,
        sourceSnapshot: record.value.validation.sourceSnapshot,
        publication,
        ownedDerivedObservation: await observeGenerationRecovery(db)
      };
    } finally {
      await client.end();
    }
  }
  const first = await publishNext(true);
  const rootBinding = {
    format: LINEAGE_FORMAT + "-root",
    dataIdentity: generationIdentity,
    manifestHash: plan.manifestHash,
    operationSha256: "cd".repeat(32),
    recurringProducerSha256: "ef".repeat(32),
    initialPublicationSha256: "12".repeat(32),
    capsuleSha256: lineageDigest(capsule),
    capsuleContextSha256: capsule.contextSha256,
    legacyGenerationBindingSha256: capsule.generationBindingSha256,
    archiveRelease: capsule.archiveRelease,
    legacyGenerationId: capsule.currentGeneration,
    legacyPreviousGenerationId: capsule.previousGeneration,
    initial: {
      generationId: first.generationId,
      predecessorGenerationId: first.predecessorGenerationId,
      rowSqlSha256: first.rowSqlSha256,
      immutableSqlSha256: first.immutableSqlSha256,
      sourceSnapshot: first.sourceSnapshot,
      ownedDerivedObservation: first.ownedDerivedObservation
    }
  };
  const cycles = [];
  process.env.PROJECTION_PRESERVE_GENERATION_IDS = retainedGenerationSelector(
    rootBinding,
    cycles
  );
  assert.deepEqual(
    new Set(process.env.PROJECTION_PRESERVE_GENERATION_IDS.split(",")),
    new Set(["103", "102", first.generationId])
  );
  const seal = (value) =>
    sealCycle({
      format: LINEAGE_FORMAT + "-cycle",
      ordinal: cycles.length + 1,
      operationSha256: rootBinding.operationSha256,
      producerSha256: rootBinding.recurringProducerSha256,
      priorReceiptSha256:
        cycles.at(-1)?.sha256 ?? rootBinding.initialPublicationSha256,
      generationId: value.generationId,
      predecessorGenerationId: value.predecessorGenerationId,
      rowSqlSha256: value.rowSqlSha256,
      immutableSqlSha256: value.immutableSqlSha256,
      sourceSnapshot: value.sourceSnapshot,
      xid: value.publication.xid,
      preparedPacketSha256: value.publication.preparedPacketSha256,
      ownedDerivedObservation: value.ownedDerivedObservation
    });
  const one = await publishNext(true);
  cycles.push(seal(one));
  assert.equal(
    (await inspectGenerationLineage(db, rootBinding, cycles))
      .currentGenerationId,
    one.generationId
  );
  checks.push(
    "actual G0 to G1 unpublished build plus atomic pointer wallet and both stamp publication"
  );
  // Model a normal native metadata consumer advancing its frontier within A.
  const nextEvent = `${8453}:${collections.base.address}:${hash(8453, 101)}:1`;
  const nextFrontier = nextEvent + ":" + hash(8453, head - 9);
  await db.query(
    `INSERT INTO ${physical}.canonical_event VALUES($1,'metadata:base',8453,$2,'Mint',$3,$4,$5,$6,$5,$7,0,1,'[]','0x')`,
    [
      nextEvent,
      collections.base.address,
      {
        tokenId: "1",
        to: "0x" + "12".repeat(20),
        yunipal: { rarityScore: 42 }
      },
      metadataSource.abiHash,
      head - 9,
      hash(8453, head - 9),
      hash(8453, 101)
    ]
  );
  await db.query(
    "UPDATE metadata_source.native_base_metadata_state SET frontier=$1,checked_at=clock_timestamp()",
    [nextFrontier]
  );
  let lastCycleRecords;
  async function actualCycle(complete = true, expireAfterPrepared = false) {
    const client = new pg.Client({ connectionString: base + database });
    await client.connect();
    const events = [];
    let built;
    const realDateNow = Date.now;
    lastCycleRecords = {};
    const wire = (value) => ({
      value,
      wireJson: JSON.stringify(value),
      sha256: hashObject(value)
    });
    const cycleExpiry = Date.now() + 60_000;
    const scope = async () => ({
      validated: true,
      currentWriterQualified: true,
      nativeMetadataQualified: true,
      allFourSourcesQualified: true,
      readersAndCacheQualified: true,
      capacityQualified: true,
      exclusiveGenerationWriterQualified: true,
      originalCapsuleQualified: true,
      rollbackRehearsalQualified: true,
      retainedPrivateInputsQualified: true,
      stableBindingSha256: "09".repeat(32),
      observedAtUnixMs: Date.now(),
      expiresAtUnixMs: cycleExpiry,
      paidAuthority: false
    });
    // These callbacks are explicit SYNTHETIC local fixture authorities. No
    // production source/serving/rehearsal/capacity receipt is manufactured.
    try {
      const cycle = await runGenerationLineageCycle({
        db: client,
        root: rootBinding,
        cycles,
        official,
        scope,
        boundaryPoints: ordinaryPoints,
        prepare: async (intent) => {
          events.push("build");
          assert.equal(
            intent.preservedGenerationIds,
            process.env.PROJECTION_PRESERVE_GENERATION_IDS
          );
          const value = await refreshProjectionGeneration({ publish: false });
          return {
            event: "native_generation_prepared",
            prepared: true,
            published: false,
            predecessor: value.predecessor,
            generationId: value.generationId,
            validation: value.validation
          };
        },
        ledger: {
          begin: async (value) => {
            events.push("intent");
            lastCycleRecords["intent.json"] = value;
            return true;
          },
          built: async (value) => {
            built = value;
            lastCycleRecords["built.json"] = value;
            events.push("built");
            return true;
          },
          privatePrepared: async (value) => {
            events.push("private");
            lastCycleRecords["private.json"] = wire(value);
            return true;
          },
          beforeCommit: async (value) => {
            events.push("durable-XID");
            lastCycleRecords["prepared.json"] = wire(value);
            if (expireAfterPrepared) Date.now = () => realDateNow() + 120_000;
            return true;
          },
          complete: async () => {
            events.push("ACK");
            return complete;
          }
        }
      });
      assert.deepEqual(events, [
        "intent",
        "build",
        "built",
        "private",
        "durable-XID",
        "ACK"
      ]);
      return {
        ...cycle.value,
        publication: {
          xid: cycle.value.xid,
          preparedPacketSha256: cycle.value.preparedPacketSha256
        },
        sourceSnapshot: cycle.value.sourceSnapshot,
        cycle,
        built
      };
    } finally {
      Date.now = realDateNow;
      await client.end();
    }
  }
  const two = await actualCycle();
  cycles.push(two.cycle);
  assert.notEqual(
    two.sourceSnapshot.baseMetadataFrontier,
    first.sourceSnapshot.baseMetadataFrontier
  );
  const current = await inspectGenerationLineage(db, rootBinding, cycles);
  assert.equal(current.currentGenerationId, two.generationId);
  assert.equal(current.acknowledgedCycles, 2);
  assert.equal(current.twentyFourHourRefreshQualified, false);
  assert.equal(current.currentCanonicalCoverageQualified, false);
  checks.push(
    "actual G2 captures newer metadata frontier without requiring old ancestors to pretend current"
  );
  checks.push(
    "actual recurring protocol calls one unpublished prepare then one atomic publication in durable-intent order"
  );
  for (const sql of [
    "UPDATE leaderboard.wallet_stats SET collector_score=collector_score+1",
    "UPDATE metadata.derived_snapshot SET updated_at=updated_at+interval '1 second'WHERE name='traits'"
  ]) {
    await db.query("BEGIN");
    await db.query(sql);
    await assert.rejects(
      inspectGenerationLineage(db, rootBinding, cycles),
      /live_wallets_full_stamps/
    );
    await db.query("ROLLBACK");
  }
  checks.push(
    "foreign same-pointer wallet or full derived-stamp mutation refuses before the next owned build"
  );
  const wrong = structuredClone(cycles);
  wrong[1].value.predecessorGenerationId = "103";
  wrong[1] = sealCycle(wrong[1].value);
  assert.throws(
    () => validateLineage(rootBinding, wrong),
    /strict_acknowledged|Expected/
  );
  await assert.rejects(
    inspectGenerationLineage(db, rootBinding, cycles.slice(0, 1)),
    /acknowledged_lineage_head/
  );
  checks.push(
    "unowned head or rewritten parent chain refuses rather than accepting any ready4e generation"
  );
  const immutableBefore = await generationRecord(db, one.generationId);
  await db.query(
    "UPDATE metadata_projection.generation SET validation=validation||'{\"foreign\":true}'::jsonb WHERE id=$1",
    [one.generationId]
  );
  await assert.rejects(inspectGenerationLineage(db, rootBinding, cycles));
  await db.query(
    "UPDATE metadata_projection.generation SET validation=$2 WHERE id=$1",
    [one.generationId, immutableBefore.value.validation]
  );
  checks.push(
    "same parent but foreign generation payload validation rewrite refuses"
  );
  let three = await publishNext();
  cycles.push(seal(three));
  // Next genuine official build executes f81 cleanup. G1 is now an old eligible
  // intermediate, while old103/prior102/G0 must remain ready and retained.
  await refreshProjectionGeneration({ publish: false });
  const cleaned = await generationRecord(db, one.generationId);
  assert.equal(cleaned.value.state, "retired");
  const payloads = (
    await db.query(
      "SELECT count(*)::int AS n FROM metadata_projection.search WHERE generation_id=$1",
      [one.generationId]
    )
  ).rows[0].n;
  assert.equal(payloads, 0);
  for (const id of ["103", "102", first.generationId])
    assert.equal((await generationRecord(db, id)).value.state, "ready");
  assert.equal(
    (await inspectGenerationLineage(db, rootBinding, cycles))
      .currentGenerationId,
    three.generationId
  );
  checks.push(
    "actual official cleanup retires and deletes intermediate payloads while retaining103 prior and first native anchor"
  );
  for (const id of ["103", "102"]) {
    await db.query("BEGIN");
    await db.query(
      "UPDATE metadata_projection.generation SET state='retired',retired_at=now()WHERE id=$1",
      [id]
    );
    await assert.rejects(
      inspectGenerationLineage(db, rootBinding, cycles),
      /original103_prior/
    );
    await db.query("ROLLBACK");
  }
  checks.push(
    "ongoing logical qualification refuses retirement or mutation of original103 and its exact prior capsule anchor"
  );
  await db.query("BEGIN");
  await db.query("DELETE FROM metadata_projection.generation WHERE id=$1", [
    one.generationId
  ]);
  await assert.rejects(
    inspectGenerationLineage(db, rootBinding, cycles),
    /every_owned_lineage/
  );
  await db.query("ROLLBACK");
  checks.push(
    "missing acknowledged intermediate generation row is refused even after legitimate payload cleanup"
  );
  const beforeExpired = await observeGenerationRecovery(db);
  await assert.rejects(actualCycle(true, true), /fresh_owned_epoch_scope/);
  assert.deepEqual(await observeGenerationRecovery(db), beforeExpired);
  checks.push(
    "admitted expiry crossing during durable XID fsync rolls back staged wallets stamps and pointer"
  );
  await assert.rejects(actualCycle(false), /cycle_commit_ACK_missing/);
  await assert.rejects(
    inspectGenerationLineage(db, rootBinding, cycles),
    /acknowledged_lineage_head/
  );
  const reconciled = await reconcileGenerationLineageCycle(
    db,
    rootBinding,
    cycles,
    lastCycleRecords
  );
  assert(
    reconciled.reconciledWithoutBuildOrPublication &&
      reconciled.receiptWritten === false
  );
  cycles.push(reconciled.cycle);
  three = reconciled.cycle.value;
  checks.push(
    "actual lost publication ACK is reconciled by committed XID and exact tuple without a second build or publication"
  );
  const beforeArchive = await observeGenerationRecovery(db);
  await db.query(
    "UPDATE metadata_source.archive_release SET state='superseded'WHERE state='active';INSERT INTO metadata_source.archive_release(release_id,state)VALUES('rotated-archive','active')"
  );
  await assert.rejects(
    inspectGenerationLineage(db, rootBinding, cycles),
    /archive_rotation/
  );
  await assert.rejects(
    restoreGenerationLineageRecovery(
      db,
      capsule,
      three.generationId,
      rootBinding,
      cycles,
      external,
      three.ownedDerivedObservation
    ),
    /archive_rotation/
  );
  await db.query(
    "UPDATE metadata_source.archive_release SET state='superseded'WHERE state='active';UPDATE metadata_source.archive_release SET state='active'WHERE release_id='fixture-archive'"
  );
  assert.deepEqual(await observeGenerationRecovery(db), beforeArchive);
  checks.push(
    "archive rotation suspends epoch and inverse without changing pointer wallets or stamps"
  );
  const beforeInverse = await observeGenerationRecovery(db);
  await assert.rejects(
    restoreGenerationLineageRecovery(
      db,
      capsule,
      three.generationId,
      rootBinding,
      cycles,
      external,
      three.ownedDerivedObservation,
      async () => {
        throw Error("rehearsed_rollback");
      }
    ),
    /rehearsed_rollback/
  );
  assert.deepEqual(await observeGenerationRecovery(db), beforeInverse);
  checks.push(
    "actual descendant recovery body rolls back complete global changes on missing commit acknowledgement"
  );
  const epochsBefore = (
    await db.query(
      "SELECT collection,revision::text FROM metadata_projection.read_epoch ORDER BY collection"
    )
  ).rows;
  const restored = await restoreGenerationLineageRecovery(
    db,
    capsule,
    three.generationId,
    rootBinding,
    cycles,
    external,
    three.ownedDerivedObservation
  );
  assert.equal(restored.currentGeneration, "103");
  assert.equal(restored.previousGeneration, "102");
  assert.equal(restored.initialNativeGenerationRetained, first.generationId);
  assert.equal(restored.acknowledgedCycles, 4);
  assert.equal(restored.allDerivedIdentityColumnsRestored, true);
  assert.deepEqual(await observeGenerationRecovery(db), original);
  const epochsAfter = (
    await db.query(
      "SELECT collection,revision::text FROM metadata_projection.read_epoch ORDER BY collection"
    )
  ).rows;
  assert.deepEqual(
    epochsAfter.map((row) => ({
      ...row,
      revision: String(BigInt(row.revision) - 1n)
    })),
    epochsBefore
  );
  for (const id of [
    first.generationId,
    one.generationId,
    two.generationId,
    three.generationId
  ])
    await generationRecord(db, id);
  await verifyGenerationRecovery(db, capsule);
  checks.push(
    "actual original capsule restores103 prior wallet rows every derived identity column and monotonic epochs after acknowledged descendants"
  );
  await assert.rejects(
    restoreGenerationLineageRecovery(
      db,
      capsule,
      three.generationId,
      rootBinding,
      cycles,
      external,
      three.ownedDerivedObservation
    ),
    /acknowledged_lineage_head/
  );
  checks.push(
    "completed descendant inverse cannot be repeated and does not reactivate any worker"
  );
  console.log(
    JSON.stringify({
      format: LINEAGE_FORMAT + "-postgres",
      passed: true,
      groups: checks.length,
      checks,
      productionQueries: 0,
      providerCalls: 0,
      sourceActions: 0,
      workerActivationQualified: false,
      twentyFourHourRefreshQualified: false
    })
  );
} finally {
  await appPools?.pool.end();
  await appPools?.apiPool.end();
  await db?.end();
  await other?.end();
  if (created) await admin.query(`DROP DATABASE "${database}"WITH(FORCE)`);
  await admin.end();
}
