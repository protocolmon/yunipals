import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { eq, isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readPonderRuntime } from "../lib/unified/ponder-reader.ts";

// This test resets Ponder's schemas. It must only use its dedicated local DB.
const connectionString = process.env.PONDER_DEPENDENCY_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_DEPENDENCY_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "", "Connection overrides are not allowed");
process.env.DATABASE_URL = connectionString;
delete process.env.DATABASE_PRIVATE_URL;
for (const id of [1, 8453, 137, 56]) {
  process.env[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
}

// Use the installed, patched runtime, including its real Vite build pipeline.
// These internal imports deliberately make Ponder updates require a new check.
const entry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, entry));
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
  schema: "dependency_check",
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
const client = new pg.Client({ connectionString });
let reader;
const resultOf = (result) => {
  if (result.status === "error") throw result.error;
  return result.result;
};
try {
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS dependency_check CASCADE");
  await client.query("DROP SCHEMA IF EXISTS ponder_sync CASCADE");
  const build = await createBuild({ common, cliOptions });
  const namespace = resultOf(build.namespaceCompile());
  const config = resultOf(await build.executeConfig()).config;
  const preBuild = resultOf(build.preCompile({ config }));
  assert.equal(preBuild.ordering, "multichain");
  const schema = resultOf(await build.executeSchema()).schema;
  resultOf(await build.executeIndexingFunctions());
  const schemaBuild = resultOf(build.compileSchema({ schema, preBuild }));
  const tables = Object.values(schema).filter(isTable);
  assert.equal(tables.length, 22);
  assert.ok(tables.some((table) => getTableConfig(table).name === "anime_fighter"));
  const database = createDatabase({ common, namespace, preBuild, schemaBuild });
  await database.migrateSync();
  await database.migrate({
    buildId: "dependency-check",
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

  // Fixture only, in the hard-guarded disposable DB. Validate the SQL reader
  // against Ponder's actual internal DDL and runtime-generated checkpoints.
  const blockEnd = (block) =>
    encodeCheckpoint(
      blockToCheckpoint(
        {
          number: `0x${block.toString(16)}`,
          timestamp: "0x64"
        },
        8453,
        "up"
      )
    );
  await client.query(
    `INSERT INTO dependency_check._ponder_checkpoint
    (chain_name,chain_id,latest_checkpoint,safe_checkpoint,finalized_checkpoint)
    VALUES('base',8453,$1,$2,$3)`,
    [blockEnd(100), blockEnd(90), blockEnd(80)]
  );
  const runtime = await readPonderRuntime(client, "dependency_check");
  assert.equal(runtime.buildId, "dependency-check");
  assert.equal(runtime.chains[0].completeThroughBlock, 100n);
  assert.equal(runtime.chains[0].recoveryThroughBlock, 90n);
  assert.equal(runtime.chains[0].frameworkFinalizedThroughBlock, 80n);

  const checkpoint = (chainId, block) =>
    encodeCheckpoint({
      blockTimestamp: BigInt(100 + block),
      chainId: BigInt(chainId),
      blockNumber: BigInt(block),
      transactionIndex: 0n,
      eventType: 5,
      eventIndex: 0n
    });
  const owner = "0x0000000000000000000000000000000000000001";
  const changedOwner = "0x0000000000000000000000000000000000000002";
  const writeBlock = async (chainId, collection, block) => {
    await database.userQB.transaction(async (tx) => {
      await tx.wrap((db) =>
        db.execute(
          "CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name text PRIMARY KEY) ON COMMIT DROP"
        )
      );
      if (block === 1) {
        await tx.wrap((db) =>
          db.insert(schema.token).values({
            collection,
            chainId,
            tokenId: "1",
            owner,
            burned: false,
            lifecycle: 1,
            contractAddress: owner,
            mintBlock: 1n,
            mintTimestamp: 101n,
            lastTransferBlock: 1n,
            lastTransferTimestamp: 101n,
            lastTransactionHash: `0x${"0".repeat(64)}`
          })
        );
      } else {
        await tx.wrap((db) =>
          db
            .update(schema.token)
            .set({ owner: changedOwner })
            .where(eq(schema.token.collection, collection))
        );
      }
      await commitBlock(tx, {
        checkpoint: checkpoint(chainId, block),
        table: schema.token,
        preBuild
      });
    });
  };
  await writeBlock(1, "ethereum", 1);
  await writeBlock(8453, "base", 1);
  await writeBlock(1, "ethereum", 2);
  await writeBlock(8453, "base", 2);

  reader = new pg.Client({ connectionString });
  await reader.connect();
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const before = await reader.query("SELECT owner FROM dependency_check.token");
  assert.ok(before.rows.every((row) => row.owner === changedOwner));
  const targets = tables.map((table) => ({
    schema: getTableConfig(table).schema,
    name: getTableConfig(table).name
  }));
  const counts = await database.userQB.transaction(async (tx) => {
    await tx.wrap((db) => db.execute("SET LOCAL lock_timeout = '500ms'"));
    await setReorgTriggersEnabled(tx, targets, namespace.schema, false);
    const counts = await revertMultichain(tx, {
      checkpoint: checkpoint(1, 1),
      tables
    });
    await setReorgTriggersEnabled(tx, targets, namespace.schema, true);
    return counts;
  });
  assert.equal(
    counts.reduce((sum, count) => sum + Number(count), 0),
    2
  );
  const after = await client.query("SELECT owner FROM dependency_check.token");
  assert.equal(after.rowCount, 2);
  assert.ok(after.rows.every((row) => row.owner === owner));
  assert.deepEqual(
    (await reader.query("SELECT owner FROM dependency_check.token")).rows,
    before.rows
  );
  await reader.query("ROLLBACK");
  const triggers = await client.query(`
    SELECT tgenabled FROM pg_trigger WHERE tgrelid IN (
      SELECT oid FROM pg_class WHERE relnamespace = 'dependency_check'::regnamespace
    ) AND NOT tgisinternal
  `);
  assert.equal(triggers.rowCount, tables.length * 2 + 1);
  assert.ok(triggers.rows.every((row) => row.tgenabled === "O"));
  await writeBlock(1, "ethereum", 3);
  const journal = await client.query(
    "SELECT count(*) FROM dependency_check._reorg__token"
  );
  assert.equal(Number(journal.rows[0].count), 3);

  // Exercise every new replay-owned table using the real JSON/numeric/hex
  // columns and reorg triggers. Keep the BNB write before the Base writes;
  // multichain rollback may also rewind later interleaved chain operations.
  await writeBlock(56, "bnb", 1);
  const hash = `0x${"ab".repeat(32)}`;
  const deployment = `8453:${owner}`;
  const arenaKey = `${deployment}:1`;
  const arenaState = {
    id: "1",
    phase: "open",
    deadline: 1000,
    rulesHash: hash,
    poolHash: hash,
    treasury: owner,
    islandId: null,
    islandBeneficiary: null,
    requestId: null,
    randomWord: null,
    ticket: null,
    seats: [],
    inputHash: null,
    commitments: null,
    resultHash: null,
    winners: null,
    videoHash: null
  };
  const writeArenaBlock = async (block, initial) => {
    await database.userQB.transaction(async (tx) => {
      await tx.wrap((db) =>
        db.execute(
          "CREATE TEMP TABLE IF NOT EXISTS live_query_tables (table_name text PRIMARY KEY) ON COMMIT DROP"
        )
      );
      await tx.wrap(async (db) => {
        const eventId = `arena-event-${block}`;
        await db.insert(schema.canonicalEvent).values({
          id: eventId,
          sourceId: "arena:base",
          chainId: 8453,
          address: owner,
          name: "Entered",
          args: "{}",
          abiHash: hash,
          blockNumber: BigInt(block),
          blockHash: hash,
          timestamp: BigInt(100 + block),
          transactionHash: hash,
          transactionIndex: 0,
          logIndex: block,
          topics: "[]",
          data: "0x"
        });
        await db.insert(schema.transactionCandidate).values({
          id: `receipt-${block}`,
          chainId: 8453,
          blockNumber: BigInt(block),
          blockHash: hash,
          transactionHash: hash
        });
        const witness = {
          id: "8453",
          chainId: 8453,
          blockNumber: BigInt(block),
          blockHash: hash,
          parentHash: hash,
          timestamp: BigInt(100 + block)
        };
        await db
          .insert(schema.chainCheckpoint)
          .values(witness)
          .onConflictDoUpdate({
            target: schema.chainCheckpoint.id,
            set: witness
          });
        await db
          .insert(schema.chainBlock)
          .values({ ...witness, id: `8453:${block}` });
        if (initial) {
          await db.insert(schema.indexerSource).values({
            id: "arena:base",
            chainId: 8453,
            manifestHash: hash,
            definition: "{}"
          });
          await db.insert(schema.arenaTournament).values({
            id: arenaKey,
            deployment,
            tournamentId: "1",
            state: arenaState,
            openedEventId: eventId,
            openedBlockHash: hash,
            lastEventId: eventId,
            blockNumber: BigInt(block),
            blockHash: hash
          });
          await db.insert(schema.arenaCredit).values({
            id: "arena-credit",
            deployment,
            wallet: owner,
            amount: 2_000_000n,
            lastEventId: eventId,
            blockNumber: BigInt(block),
            blockHash: hash
          });
          await db.insert(schema.arenaSeat).values({
            id: "arena-seat-0",
            tournamentKey: arenaKey,
            seat: 0,
            player: owner,
            nftChainId: 56,
            collection: owner,
            tokenId: "1"
          });
        } else {
          await db
            .update(schema.indexerSource)
            .set({ definition: '{"changed":true}' })
            .where(eq(schema.indexerSource.id, "arena:base"));
          await db
            .update(schema.arenaTournament)
            .set({
              state: { ...arenaState, phase: "expired" },
              lastEventId: eventId,
              blockNumber: BigInt(block)
            })
            .where(eq(schema.arenaTournament.id, arenaKey));
          await db
            .update(schema.arenaCredit)
            .set({
              amount: 4_000_000n,
              lastEventId: eventId,
              blockNumber: BigInt(block),
              blockHash: hash
            })
            .where(eq(schema.arenaCredit.id, "arena-credit"));
          await db.insert(schema.arenaSeat).values({
            id: "arena-seat-1",
            tournamentKey: arenaKey,
            seat: 1,
            player: changedOwner,
            nftChainId: 56,
            collection: owner,
            tokenId: "2"
          });
        }
      });
      for (const table of tables)
        await commitBlock(tx, {
          checkpoint: checkpoint(8453, block),
          table,
          preBuild
        });
    });
  };
  await writeArenaBlock(10, true);
  await writeArenaBlock(11, false);
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const retained = (
    await reader.query("SELECT state FROM dependency_check.arena_tournament")
  ).rows;
  assert.equal(retained[0].state.phase, "expired");
  await database.userQB.transaction(async (tx) => {
    await tx.wrap((db) => db.execute("SET LOCAL lock_timeout = '500ms'"));
    await setReorgTriggersEnabled(tx, targets, namespace.schema, false);
    await revertMultichain(tx, { checkpoint: checkpoint(8453, 10), tables });
    await setReorgTriggersEnabled(tx, targets, namespace.schema, true);
  });
  assert.equal(
    (await client.query("SELECT state FROM dependency_check.arena_tournament"))
      .rows[0].state.phase,
    "open"
  );
  assert.deepEqual(
    (
      await client.query(
        "SELECT amount,last_event_id,block_number::text,block_hash FROM dependency_check.arena_credit"
      )
    ).rows[0],
    {
      amount: "2000000",
      last_event_id: "arena-event-10",
      block_number: "10",
      block_hash: `0x${"ab".repeat(32)}`
    }
  );
  assert.equal(
    (
      await client.query(
        "SELECT definition FROM dependency_check.indexer_source"
      )
    ).rows[0].definition,
    "{}"
  );
  for (const table of [
    "arena_seat",
    "canonical_event",
    "transaction_candidate",
    "chain_block"
  ]) {
    assert.equal(
      Number(
        (await client.query(`SELECT count(*) FROM dependency_check.${table}`))
          .rows[0].count
      ),
      1
    );
  }
  assert.equal(
    (
      await client.query(
        "SELECT owner FROM dependency_check.token WHERE collection='bnb'"
      )
    ).rows[0].owner,
    owner
  );
  assert.deepEqual(
    (await reader.query("SELECT state FROM dependency_check.arena_tournament"))
      .rows,
    retained
  );
  await reader.query("ROLLBACK");
  assert.equal(
    (
      await client.query(
        "SELECT block_number::text FROM dependency_check.chain_checkpoint"
      )
    ).rows[0].block_number,
    "10"
  );
  await writeArenaBlock(11, false);
  assert.deepEqual(
    (
      await client.query(
        "SELECT amount,last_event_id,block_number::text,block_hash FROM dependency_check.arena_credit"
      )
    ).rows[0],
    {
      amount: "4000000",
      last_event_id: "arena-event-11",
      block_number: "11",
      block_hash: `0x${"ab".repeat(32)}`
    }
  );
  console.log(
    JSON.stringify({
      event: "ponder_dependency_compatibility",
      checks: [
        "Vite config/schema/handlers",
        "Kysely sync migrations",
        "read-only pinned checkpoint SQL adapter",
        "Drizzle DDL/indexes/writes",
        "multichain reorg",
        "retained reader",
        "Arena/source/event/receipt tables rollback and replay",
        "triggers reenabled"
      ]
    })
  );
} finally {
  if (reader) await reader.end();
  await shutdown.kill();
  common.metrics.registry.clear();
  await client.end();
}
