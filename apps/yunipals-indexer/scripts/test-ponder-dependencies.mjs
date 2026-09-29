import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { eq, isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

// This test resets Ponder's schemas. It must only use its dedicated local DB.
const connectionString = process.env.PONDER_DEPENDENCY_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_DEPENDENCY_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "", "Connection overrides are not allowed");
process.env.DATABASE_URL = connectionString;
delete process.env.DATABASE_PRIVATE_URL;
for (const id of [1, 8453, 137]) {
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
const { encodeCheckpoint } = await internal("./utils/checkpoint.js");
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
  assert.equal(tables.length, 4);
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
  assert.equal(triggers.rowCount, 9);
  assert.ok(triggers.rows.every((row) => row.tgenabled === "O"));
  await writeBlock(1, "ethereum", 3);
  const journal = await client.query(
    "SELECT count(*) FROM dependency_check._reorg__token"
  );
  assert.equal(Number(journal.rows[0].count), 3);
  console.log(
    JSON.stringify({
      event: "ponder_dependency_compatibility",
      checks: [
        "Vite config/schema/handlers",
        "Kysely sync migrations",
        "Drizzle DDL/indexes/writes",
        "multichain reorg",
        "retained reader",
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
