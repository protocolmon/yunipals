import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { eq, isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getAddress } from "viem";
import {
  buildSourceManifest,
  sourceManifestHash,
  manifestDigest
} from "../lib/unified/sources.ts";
import { createPortalReadViews } from "../lib/unified/portal-views.ts";
import { SharedPortalLedger } from "../lib/portals/shared-ledger.ts";
import { PortalLedgerStore } from "../lib/portals/ledger-store.ts";
import { comparePortalSources } from "../lib/unified/portal-parity.ts";
import { PortalStore } from "../lib/portals/store.ts";
import { IndexedPortalJobs } from "../lib/portals/indexed-jobs.ts";
import { PortalChain } from "../lib/portals/chain.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";

const connectionString = process.env.PORTAL_SHARED_TEST_DATABASE_URL;
assert.ok(connectionString, "Explicit disposable database required.");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_portal_shared_test");
assert.equal(url.search, "");
process.env.DATABASE_URL = connectionString;
for (const name of [
  "DATABASE_PRIVATE_URL",
  "PONDER_ISLANDS_ONLY",
  "PONDER_BOOSTERS_ONLY",
  "UNIFIED_RPC_PROFILE_FILE"
])
  delete process.env[name];
for (const id of [1, 56, 137, 8453])
  process.env[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
const address = (n) => `0x${String(n).repeat(40)}`;
const contracts = {
  collection: address(1),
  registry: address(2),
  grading: address(3),
  competition: address("d")
};
process.env.UNIFIED_PORTALS_JSON = JSON.stringify(
  Object.fromEntries(
    Object.entries(contracts).map(([kind, address]) => [
      kind,
      { address, startBlock: 1 }
    ])
  )
);
const manifest = buildSourceManifest();
const internal = (path) => import(new URL(path, import.meta.resolve("ponder")));
const { createBuild } = await internal("./build/index.js");
const { createDatabase } = await internal("./database/index.js");
const { createLogger } = await internal("./internal/logger.js");
const { MetricsService } = await internal("./internal/metrics.js");
const { buildOptions } = await internal("./internal/options.js");
const { createShutdown } = await internal("./internal/shutdown.js");
const { encodeCheckpoint, blockToCheckpoint } = await internal(
  "./utils/checkpoint.js"
);
const {
  createIndexes,
  createTriggers,
  createLiveQueryTriggers,
  commitBlock,
  revertMultichain
} = await internal("./database/actions.js");
const { setReorgTriggersEnabled } = await internal(
  "./database/yunipals-reorg-triggers.mjs"
);
const cliOptions = {
  root: fileURLToPath(new URL("../", import.meta.url)),
  config: "ponder.config.ts",
  command: "start",
  version: "0.17.5",
  schema: "portal_shared_check",
  logLevel: "error",
  logFormat: "json"
};
const shutdown = createShutdown();
const common = {
  options: buildOptions({ cliOptions }),
  logger: createLogger({ level: "error", mode: "json" }),
  metrics: new MetricsService(),
  shutdown,
  buildShutdown: shutdown,
  apiShutdown: shutdown
};
const pool = new pg.Pool({ connectionString });
const readerPool = new pg.Pool({
  connectionString,
  max: 4,
  connectionTimeoutMillis: 1000,
  options: "-c role=portal_shared_fixture_reader"
});
const db = await pool.connect();
const result = (value) => {
  if (value.status === "error") throw value.error;
  return value.result;
};
const hash = `0x${"a".repeat(64)}`,
  owner = address("a"),
  buyer = address("b"),
  zero = address(0);
try {
  await db.query("DROP SCHEMA IF EXISTS portal_shared_private CASCADE");
  await db.query("DROP SCHEMA IF EXISTS portal_shared_reads CASCADE");
  await db.query("DROP SCHEMA IF EXISTS portal_shared_check CASCADE");
  await db.query("DROP SCHEMA IF EXISTS yunipals_indexer_control CASCADE");
  await db.query("DROP SCHEMA IF EXISTS ponder_sync CASCADE");
  const build = await createBuild({ common, cliOptions });
  const namespace = result(build.namespaceCompile());
  const config = result(await build.executeConfig()).config;
  const preBuild = result(build.preCompile({ config }));
  const schema = result(await build.executeSchema()).schema;
  const schemaBuild = result(build.compileSchema({ schema, preBuild }));
  const handlers = result(
    await build.executeIndexingFunctions()
  ).indexingFunctions;
  const tables = Object.values(schema).filter(isTable);
  const database = createDatabase({ common, namespace, preBuild, schemaBuild });
  await database.migrateSync();
  await database.migrate({
    buildId: "portal-shared-test",
    chains: Object.entries(config.chains).map(([name, chain]) => ({
      name,
      id: chain.id
    })),
    finalizedBlocks: []
  });
  await createIndexes(database.adminQB, schemaBuild);
  await createTriggers(database.adminQB, { tables });
  await createLiveQueryTriggers(database.adminQB, {
    namespaceBuild: namespace,
    tables
  });
  const checkpoint = (block) =>
    encodeCheckpoint(
      blockToCheckpoint(
        {
          number: `0x${block.toString(16)}`,
          timestamp: `0x${(1000 + block).toString(16)}`
        },
        8453,
        "up"
      )
    );
  let ruleCalls = 0;
  let contribution = 500000n;
  async function dispatch(block, events) {
    await database.userQB.transaction(async (tx) => {
      await tx.wrap((d) =>
        d.execute(
          "CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name text PRIMARY KEY) ON COMMIT DROP"
        )
      );
      await tx.wrap(async (d) => {
        const context = {
          chain: { id: 8453 },
          client: {
            readContract: async ({ functionName }) => {
              ruleCalls++;
              return functionName === "BATCH_SIZE" ? 111n : contribution;
            }
          },
          db: {
            find: async (table, key) =>
              (await d.select().from(table).where(eq(table.id, key.id)))[0] ??
              null,
            delete: (table, key) => d.delete(table).where(eq(table.id, key.id)),
            insert: (table) => ({
              values: (row) => ({
                then: (yes, no) => d.insert(table).values(row).then(yes, no),
                onConflictDoNothing: () =>
                  d.insert(table).values(row).onConflictDoNothing(),
                onConflictDoUpdate: (value) =>
                  d
                    .insert(table)
                    .values(row)
                    .onConflictDoUpdate({ target: table.id, set: value })
              })
            })
          }
        };
        for (const [i, [kind, name, args]] of events.entries()) {
          const label = {
            collection: "PortalCollection",
            registry: "PortalRegistry",
            grading: "PortalGrading",
            competition: "PortalCompetition"
          }[kind];
          const handler = handlers.find((h) => h.name === `${label}:${name}`);
          assert.ok(handler, name);
          const event = {
            args,
            block: {
              number: BigInt(block),
              hash,
              timestamp: BigInt(1000 + block)
            },
            transaction: {
              hash: `0x${block.toString(16).padStart(64, "0")}`,
              transactionIndex: 0
            },
            log: {
              address: contracts[kind],
              logIndex: i,
              data: "0x",
              topics: []
            }
          };
          await handler.fn({ context, event });
          await handler.fn({ context, event }); // idempotent redelivery
        }
      });
      for (const table of tables)
        await commitBlock(tx, {
          checkpoint: checkpoint(block),
          table,
          preBuild
        });
    });
  }
  await dispatch(10, [
    [
      "grading",
      "CompetitionConfigured",
      { competition: contracts.competition }
    ],
    [
      "collection",
      "MintCommitted",
      { requestId: 1n, kindId: 1n, quantity: 2, firstSerial: 0 }
    ],
    ["collection", "Transfer", { tokenId: 1n, from: zero, to: owner }],
    [
      "collection",
      "PortalMinted",
      { requestId: 1n, kindId: 1n, tokenId: 1n, recipient: owner }
    ],
    [
      "grading",
      "GradingRequested",
      {
        requestId: 1n,
        tokenId: 1n,
        submitter: owner,
        portalId: 1n,
        inputVersion: 0n,
        spellCommitment: hash
      }
    ]
  ]);
  await dispatch(11, [
    [
      "grading",
      "PortalFeeAccrued",
      { requestId: 1n, portalId: 1n, amount: 245000n, newBalance: 245000n }
    ],
    ["collection", "Transfer", { tokenId: 1n, from: owner, to: buyer }]
  ]);
  const release = {
    schema: "portal_shared_check",
    buildId: "portal-shared-test",
    manifestHash: sourceManifestHash(manifest),
    manifest
  };
  release.id = manifestDigest({
    schema: release.schema,
    buildId: release.buildId,
    manifestHash: release.manifestHash
  });
  await migrateIndexerControl(pool);
  await db.query(
    "INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5)",
    [
      release.id,
      release.schema,
      release.buildId,
      release.manifestHash,
      manifest
    ]
  );
  await db.query("BEGIN");
  await db.query(
    "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_shared_fixture_reader') THEN CREATE ROLE portal_shared_fixture_reader NOLOGIN; END IF; END $$"
  );
  const role = "portal_shared_fixture_reader";
  await createPortalReadViews(db, release, "portal_shared_reads", [role]);
  await db.query("COMMIT");
  const readAt = async (block) => {
    await db.query("BEGIN READ ONLY");
    try {
      await db.query("SELECT set_config('yunipals.portal_boundary',$1,true)", [
        String(block)
      ]);
      return (
        await db.query("SELECT * FROM portal_shared_reads.portal_v2_token")
      ).rows;
    } finally {
      await db.query("ROLLBACK");
    }
  };
  assert.equal((await readAt(10))[0].owner, owner);
  assert.equal((await readAt(10))[0].balance, "0");
  assert.equal((await readAt(11))[0].owner, buyer);
  assert.equal((await readAt(11))[0].balance, "245000");
  assert.equal(
    (await db.query("SELECT count(*) FROM portal_shared_reads.portal_v2_token"))
      .rows[0].count,
    "0"
  );
  await db.query(
    "CREATE TEMP TABLE live_query_tables (table_name text PRIMARY KEY)"
  );
  // Exercise the real shared status/identity reader against Ponder's native DDL.
  for (const definition of manifest.sources)
    await db.query(
      "INSERT INTO portal_shared_check.indexer_source(id,chain_id,manifest_hash,definition) VALUES($1,$2,$3,$4)",
      [
        definition.id,
        definition.chainId,
        release.manifestHash,
        JSON.stringify(definition)
      ]
    );
  await db.query(
    "INSERT INTO portal_shared_check._ponder_checkpoint(chain_name,chain_id,latest_checkpoint,safe_checkpoint,finalized_checkpoint) VALUES('base',8453,$1,$1,$1)",
    [checkpoint(11)]
  );
  await db.query(
    "UPDATE portal_shared_check._ponder_meta SET value=value || $1::jsonb WHERE key='app'",
    [{ is_ready: 1, is_locked: 1, heartbeat_at: Date.now() }]
  );
  await db.query(
    "INSERT INTO portal_shared_check.chain_block(id,chain_id,block_number,block_hash,parent_hash,timestamp) VALUES('8453:11',8453,11,$1,$1,1011)",
    [hash]
  );
  await db.query(
    "INSERT INTO portal_shared_check.chain_checkpoint(id,chain_id,block_number,block_hash,parent_hash,timestamp) VALUES('8453',8453,11,$1,$1,1011)",
    [hash]
  );
  await db.query(
    "INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,revision,head_number,head_hash,head_timestamp,witness_number,witness_hash,observed_at_ms,anchors) VALUES($1,8453,1,22,$2,1022,11,$2,$3,$4)",
    [
      release.id,
      hash,
      Date.now(),
      {
        10: { number: "10", hash, timestamp: "1010" },
        11: { number: "11", hash, timestamp: "1011" }
      }
    ]
  );
  const chain = new PortalChain(
    { getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash }) },
    { chainId: 8453, ...contracts, cards: address(7), usdc: address(8) }
  );
  const reader = new SharedPortalLedger(
    readerPool,
    {
      releaseId: release.id,
      readSchema: "portal_shared_reads",
      competition: contracts.competition,
      confirmations: 12
    },
    chain
  );
  await reader.snapshot(async () => {
    assert.equal((await reader.cursor()).block, "10");
    assert.equal(
      (await reader.db.query("SELECT owner FROM portal_v2_token")).rows[0]
        .owner,
      owner
    );
  });
  await assert.rejects(
    readerPool.query("DELETE FROM portal_shared_check.canonical_event"),
    /permission denied/
  );
  await assert.rejects(reader.apply(), /Only shared/);
  await assert.rejects(reader.db.query("SELECT 1"), /snapshot/);
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code='fixture_unavailable' WHERE release_id=$1",
    [release.id]
  );
  await reader.validate(); // API startup must not require source readiness.
  await assert.rejects(
    reader.snapshot(async () => {}),
    /unavailable/
  );
  await db.query(
    "UPDATE yunipals_indexer_control.chain_status SET error_code=NULL WHERE release_id=$1",
    [release.id]
  );
  let entered = 0;
  let releaseWait;
  let allEntered;
  const slowRpc = new Promise((resolve) => {
    releaseWait = resolve;
  });
  const ready = new Promise((resolve) => {
    allEntered = resolve;
  });
  const requests = Array.from({ length: 24 }, () =>
    reader.snapshot(async () => {
      await reader.db.query(
        "SELECT token_id FROM portal_v2_token WHERE deployment=$1 AND token_id=1",
        [reader.deployment]
      );
      if (++entered === 24) allEntered();
      await slowRpc;
      return reader.db.query(
        "SELECT token_id FROM portal_v2_token WHERE deployment=$1 AND token_id=1",
        [reader.deployment]
      );
    })
  );
  let timer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Readers held connections during RPC waits")),
          3000
        );
      })
    ]);
    assert.equal(readerPool.waitingCount, 0);
    assert.equal(readerPool.idleCount, readerPool.totalCount);
  } finally {
    clearTimeout(timer);
    releaseWait();
  }
  await Promise.all(requests);
  await assert.rejects(
    reader.snapshot(async () => {
      await db.query(
        "UPDATE portal_shared_check.chain_block SET block_hash=$1 WHERE block_number=11",
        [`0x${"f".repeat(64)}`]
      );
    }),
    /unavailable/
  );
  await db.query(
    "UPDATE portal_shared_check.chain_block SET block_hash=$1 WHERE block_number=11",
    [hash]
  );
  await db.query("CREATE SCHEMA portal_shared_private");
  const privatePool = new pg.Pool({
    connectionString,
    options: "-c search_path=portal_shared_private,pg_catalog"
  });
  try {
    const jobs = new PortalStore(privatePool, `8453:${contracts.grading}`);
    await jobs.migrate();
    const legacy = new PortalLedgerStore(privatePool, reader.deployment);
    await legacy.migrate();
    const journal = await reader.snapshot(
      async () =>
        (
          await reader.db.query(
            `SELECT event_type AS type,token_id::text AS "tokenId",block_number::text AS block,block_hash AS "blockHash",transaction_hash AS "transactionHash",transaction_index AS "transactionIndex",log_index AS "logIndex",source,args FROM portal_v2_ledger_event ORDER BY block_number,transaction_index,log_index`
          )
        ).rows
    );
    assert.equal(
      journal.find((event) => event.type === "GradingRequested").args.submitter,
      getAddress(owner)
    );
    assert.equal(
      journal.find((event) => event.type === "CompetitionConfigured").args
        .competition,
      getAddress(contracts.competition)
    );
    await reader.snapshot(async () => {
      const state = (
        await reader.db.query(
          "SELECT value AS configuration FROM portal_v5_state WHERE component='CompetitionConfigured'"
        )
      ).rows[0];
      assert.equal(
        state.configuration.competition,
        getAddress(contracts.competition)
      );
      assert.equal(
        (await reader.db.query("SELECT owner FROM portal_v2_token")).rows[0]
          .owner,
        owner
      );
    });
    await legacy.apply(
      journal,
      "10",
      hash,
      null,
      false,
      { batchSize: 111n, contribution: 500000n },
      contracts.competition
    );
    assert.equal(
      (await comparePortalSources(privatePool, reader)).matches,
      true
    );
    await privatePool.query("UPDATE portal_v2_token SET balance=1");
    assert.equal(
      (await comparePortalSources(privatePool, reader)).matches,
      false
    );
    await privatePool.query("UPDATE portal_v2_token SET balance=0");
    let requestReads = 0;
    chain.request = async () => {
      requestReads++;
      return {
        acceptedAt: 1010n,
        acceptedBlock: 10n,
        spellCommitment: hash,
        rubricId: hash
      };
    };
    chain.binding = async () => hash;
    chain.rubric = async () => ({ modelPolicy: hash });
    const consumer = new IndexedPortalJobs(reader, privatePool, jobs, chain);
    await privatePool.query(
      `CREATE FUNCTION reject_cursor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture cursor failure'; END $$`
    );
    await privatePool.query(
      "CREATE TRIGGER reject_cursor BEFORE INSERT ON portal_v6_consumer FOR EACH ROW EXECUTE FUNCTION reject_cursor()"
    );
    await assert.rejects(consumer.ingest(), /fixture cursor failure/);
    assert.equal(
      (await privatePool.query("SELECT count(*) FROM portal_v1_job")).rows[0]
        .count,
      "0"
    );
    await privatePool.query("DROP TRIGGER reject_cursor ON portal_v6_consumer");
    await consumer.ingest();
    await privatePool.query(
      `UPDATE portal_v1_job SET progress='{"savedImage":"fixture"}',attempts=4`
    );
    await consumer.ingest();
    await privatePool.query(
      "UPDATE portal_v6_consumer SET identity='previous-release'"
    );
    const beforeHandover = requestReads;
    await consumer.ingest();
    assert.equal(
      requestReads,
      beforeHandover,
      "canonical handover must not rescan historical requests"
    );
    const retainedJob = (
      await privatePool.query("SELECT progress,attempts FROM portal_v1_job")
    ).rows;
    assert.equal(retainedJob.length, 1);
    assert.deepEqual(retainedJob[0], {
      progress: { savedImage: "fixture" },
      attempts: 4
    });
    await privatePool.query("UPDATE portal_v1_job SET completed=true");
    await privatePool.query(
      `INSERT INTO portal_v1_publication(deployment,request_id,token_id,submitter,spell,normalized,embedding,publication_block,publication_timestamp,result,artifact_hashes)
      VALUES($1,1,1,$2,'fixture','fixture','{}',11,1011,'{}','{}')`,
      [jobs.deployment, owner]
    );
    const orphanHash = `0x${"f".repeat(64)}`;
    await privatePool.query("UPDATE portal_v6_consumer SET block_hash=$1", [
      orphanHash
    ]);
    await consumer.ingest();
    assert.equal(
      (await privatePool.query("SELECT completed FROM portal_v1_job")).rows[0]
        .completed,
      false
    );
    assert.equal(
      (await privatePool.query("SELECT count(*) FROM portal_v1_publication"))
        .rows[0].count,
      "0"
    );
    chain.binding = async () => orphanHash;
    await privatePool.query("UPDATE portal_v6_consumer SET block_hash=$1", [
      orphanHash
    ]);
    await consumer.ingest();
    assert.deepEqual(
      (await privatePool.query("SELECT progress FROM portal_v1_job")).rows[0]
        .progress,
      {}
    );
    chain.binding = async () => hash;
    await privatePool.query("UPDATE portal_v6_consumer SET block_hash=$1", [
      orphanHash
    ]);
    await consumer.ingest();
    assert.deepEqual(
      (await privatePool.query("SELECT progress FROM portal_v1_job")).rows[0]
        .progress,
      { savedImage: "fixture" }
    );
    await consumer.verify({ requestId: "1", commitment: hash, binding: hash });
    await assert.rejects(
      consumer.verify({ requestId: "999", commitment: hash, binding: hash }),
      /not present/
    );
  } finally {
    await privatePool.end();
  }
  const targets = tables.map((table) => ({
    schema: getTableConfig(table).schema,
    name: getTableConfig(table).name
  }));
  await database.userQB.transaction(async (tx) => {
    await setReorgTriggersEnabled(tx, targets, namespace.schema, false);
    await revertMultichain(tx, { checkpoint: checkpoint(10), tables });
    await setReorgTriggersEnabled(tx, targets, namespace.schema, true);
  });
  assert.equal((await readAt(11))[0].owner, owner);
  assert.equal((await readAt(11))[0].balance, "0");
  assert.equal(
    (await db.query("SELECT count(*) FROM portal_shared_check.canonical_event"))
      .rows[0].count,
    "5"
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM portal_shared_check.transaction_candidate"
      )
    ).rows[0].count,
    "1"
  );
  await dispatch(11, [
    ["collection", "Transfer", { tokenId: 1n, from: owner, to: buyer }]
  ]);
  assert.equal((await readAt(11))[0].owner, buyer);
  await dispatch(
    12,
    Array.from({ length: 111 }, (_, i) => [
      "competition",
      "CompetitionEntered",
      {
        entryId: BigInt(i + 1),
        batchId: 1n,
        requestId: BigInt(i + 1),
        submitter: owner,
        amount: 500000n
      }
    ])
  );
  await dispatch(
    13,
    Array.from({ length: 111 }, (_, i) => [
      "competition",
      "CompetitionResult",
      {
        entryId: BigInt(i + 1),
        batchId: 1n,
        requestId: BigInt(i + 1),
        score: 100
      }
    ])
  );
  assert.equal(
    ruleCalls,
    2,
    "one constant pair for all 222 competition events"
  );
  contribution = 600000n;
  await dispatch(14, [
    ["competition", "Upgraded", { implementation: buyer }],
    ["competition", "CompetitionPrizeDeferred", { batchId: 1n, rank: 0 }]
  ]);
  assert.equal(ruleCalls, 4);
  await database.userQB.transaction(async (tx) => {
    await setReorgTriggersEnabled(tx, targets, namespace.schema, false);
    await revertMultichain(tx, { checkpoint: checkpoint(13), tables });
    await setReorgTriggersEnabled(tx, targets, namespace.schema, true);
  });
  assert.equal(
    (
      await db.query(
        "SELECT contribution::text FROM portal_shared_check.portal_competition_rules"
      )
    ).rows[0].contribution,
    "500000"
  );
  await dispatch(14, [
    ["competition", "CompetitionPrizeDeferred", { batchId: 1n, rank: 0 }]
  ]);
  assert.equal(
    ruleCalls,
    4,
    "rollback restores the cached rules without another RPC read"
  );
  await db.query("BEGIN");
  await db.query("ANALYZE portal_shared_check.portal_projection_version");
  await db.query("SET LOCAL enable_seqscan=off");
  await db.query("SELECT set_config('yunipals.portal_boundary','14',true)");
  const plan = (
    await db.query(
      "EXPLAIN (ANALYZE,FORMAT JSON) SELECT * FROM portal_shared_reads.portal_v3_competition_entry WHERE deployment=$1 AND entry_id=110",
      [reader.deployment]
    )
  ).rows[0]["QUERY PLAN"][0].Plan;
  const nodes = (p) => [p, ...(p.Plans ?? []).flatMap(nodes)];
  assert.ok(
    nodes(plan).some(
      (p) =>
        /entry_id.*110/.test(p["Index Cond"] ?? "") && p["Actual Rows"] <= 2
    ),
    `point lookup must bound history through the typed key index: ${JSON.stringify(plan)}`
  );
  await db.query("ROLLBACK");
  console.log(
    JSON.stringify({
      event: "portal_shared_ponder_verified",
      checks: [
        "compiled production handlers",
        "duplicate delivery",
        "native DDL and receipt scheduling",
        "confirmed version views",
        "checksummed legacy arguments with normalized ownership columns",
        "shared source binding and outage",
        "real Ponder reorg and replay",
        "atomic job cursor crash recovery",
        "release replay preserves saved AI output",
        "same-boundary full-state parity detects balance corruption",
        "24 concurrent readers release connections during RPC waits",
        "canonical handover avoids historical request RPC reads",
        "reorg reopens completed work and restores saved binding revisions",
        "typed point lookup uses a selective history index",
        "222 competition events reuse two constant reads with upgrade rollback"
      ],
      productionWrites: 0,
      providerCalls: 0
    })
  );
} finally {
  await db.query("ROLLBACK").catch(() => {});
  db.release();
  await shutdown.kill();
  common.metrics.registry.clear();
  await readerPool.end();
  await pool.end();
}
