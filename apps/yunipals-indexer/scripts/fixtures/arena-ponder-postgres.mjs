import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { and, eq, isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { decodeEventLog } from "viem";
import { arenaAbi } from "../../../../packages/yunipals-market-core/src/arenaAbi.ts";
import { buildSourceManifest } from "../../lib/unified/sources.ts";
import { migrateIndexerControl } from "../../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../../lib/unified/releases.ts";
import { observeIndexerChain } from "../../lib/unified/observer.ts";

/** Explicit local integration fixture. Real handlers, DDL, reorg triggers and
 * checkpoints are used, with a test-only feed of real Anvil receipts. This does
 * not run Ponder's RPC sync engine or replace any production ingestion code.
 */
export async function createArenaPonderFixture({
  connectionString,
  client,
  contract,
  startBlock
}) {
  const url = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
  assert.equal(url.search, "");
  const schemaName = `native_arena_anvil_${randomBytes(4).toString("hex")}`;
  const changed = {
    DATABASE_URL: connectionString,
    DATABASE_PRIVATE_URL: undefined,
    PONDER_ISLANDS_ONLY: undefined,
    PONDER_BOOSTERS_ONLY: undefined,
    UNIFIED_ARENA_DEPLOYMENTS: undefined,
    ARENA_CONTRACT: contract,
    ARENA_DEPLOYMENT_BLOCK: String(startBlock),
    UNIFIED_BASE_ISLANDS_V2_ENABLED: "false",
    MARKET_BNB_DISCOVERY_START_BLOCK: undefined,
    BOOSTER_REGISTRY: undefined,
    BOOSTER_ENGINE: undefined,
    BOOSTER_MONSTERS: undefined,
    BOOSTER_WRAPPER: undefined,
    BOOSTER_DEPLOYMENT_BLOCK: undefined
  };
  for (const id of [1, 8453, 137, 56])
    changed[`PONDER_RPC_URL_${id}`] = "http://127.0.0.1:1";
  const prior = Object.fromEntries(
    Object.keys(changed).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(changed))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  const pool = new pg.Pool({ connectionString, max: 4 });
  const readPool = new pg.Pool({
    connectionString,
    max: 4,
    options: "-c default_transaction_read_only=on"
  });
  const entry = import.meta.resolve("ponder"),
    internal = (path) => import(new URL(path, entry));
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
  const { getReorgTableName } = await internal("./drizzle/onchain.js");
  const cliOptions = {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    config: "ponder.config.ts",
    command: "start",
    version: "0.17.5",
    schema: schemaName,
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
  let release,
    cursor = startBlock - 1n;
  const unwrap = (result) => {
    if (result.status === "error") throw result.error;
    return result.result;
  };
  const close = async () => {
    await shutdown.kill();
    common.metrics.registry.clear();
    await readPool.end();
    if (release) {
      for (const table of ["chain_anchor", "chain_status", "receipt_discovery"])
        await pool.query(
          `DELETE FROM yunipals_indexer_control.${table} WHERE release_id=$1`,
          [release.id]
        );
      await pool.query(
        "DELETE FROM yunipals_indexer_control.release WHERE id=$1",
        [release.id]
      );
    }
    await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await pool.end();
    for (const [key, value] of Object.entries(prior))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  };
  try {
    const manifest = buildSourceManifest();
    const build = await createBuild({ common, cliOptions });
    const namespace = unwrap(build.namespaceCompile());
    const config = unwrap(await build.executeConfig()).config;
    const preBuild = unwrap(build.preCompile({ config }));
    const schema = unwrap(await build.executeSchema()).schema;
    const schemaBuild = unwrap(build.compileSchema({ schema, preBuild }));
    const handlers = unwrap(
      await build.executeIndexingFunctions()
    ).indexingFunctions;
    assert.equal(preBuild.ordering, "multichain");
    const tables = Object.values(schema).filter(isTable);
    const database = createDatabase({
      common,
      namespace,
      preBuild,
      schemaBuild
    });
    const buildId = "native-arena-anvil-v1";
    await database.migrateSync();
    await database.migrate({
      buildId,
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
    const adapter = (tx) => {
      const condition = (table, key) =>
        and(
          ...Object.entries(key).map(([name, value]) => eq(table[name], value))
        );
      return {
        find: async (table, key) =>
          (
            await tx.wrap((db) =>
              db.select().from(table).where(condition(table, key)).limit(1)
            )
          )[0] ?? null,
        insert: (table) => ({
          values: (row) => {
            const insert = () => tx.wrap((db) => db.insert(table).values(row));
            return {
              then: (resolve, reject) => insert().then(resolve, reject),
              onConflictDoNothing: () =>
                tx.wrap((db) =>
                  db.insert(table).values(row).onConflictDoNothing()
                ),
              onConflictDoUpdate: (values) =>
                tx.wrap((db) =>
                  db
                    .insert(table)
                    .values(row)
                    .onConflictDoUpdate({ target: table.id, set: values })
                )
            };
          }
        }),
        delete: (table, key) =>
          tx.wrap((db) => db.delete(table).where(condition(table, key))),
        update: (table, key) => ({
          set: (values) =>
            tx.wrap((db) =>
              db.update(table).set(values).where(condition(table, key))
            )
        })
      };
    };
    await database.userQB.transaction(async (tx) => {
      await tx.wrap((db) =>
        db.execute(
          "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY) ON COMMIT DROP"
        )
      );
      for (const [name, id] of [
        ["YunipalsEthereum", 1],
        ["YunipalsBase", 8453],
        ["YunipalsPolygon", 137],
        ["YunipalsBnb", 56]
      ]) {
        await handlers
          .find((h) => h.name === `${name}:setup`)
          .fn({ context: { db: adapter(tx), chain: { id } } });
      }
    });
    const checkpoint = (block) =>
      encodeCheckpoint(
        blockToCheckpoint(
          {
            number: `0x${block.number.toString(16)}`,
            timestamp: `0x${block.timestamp.toString(16)}`
          },
          8453,
          "up"
        )
      );
    const pointer = async (block) => {
      const cp = checkpoint(block);
      await pool.query(
        `INSERT INTO ${schemaName}._ponder_checkpoint(chain_name,chain_id,latest_checkpoint,safe_checkpoint,finalized_checkpoint)
        VALUES('base',8453,$1,$1,$2) ON CONFLICT(chain_name) DO UPDATE SET latest_checkpoint=$1,safe_checkpoint=$1`,
        [
          cp,
          encodeCheckpoint(
            blockToCheckpoint({ number: "0x0", timestamp: "0x0" }, 8453, "up")
          )
        ]
      );
      await pool.query(
        `UPDATE ${schemaName}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
        [String(Date.now())]
      );
    };
    const rpc = {
      providerId: "local-anvil-native-arena",
      chainId: () => client.getChainId(),
      block: (tag) =>
        typeof tag === "bigint"
          ? client.getBlock({ blockNumber: tag })
          : client.getBlock({ blockTag: tag })
    };
    const observe = async (expected = "observed") => {
      if (release) {
        const result = await observeIndexerChain(pool, release, 8453, rpc);
        const state =
          result === "observed"
            ? null
            : (
                await pool.query(
                  "SELECT error_code,finality_error_code,witness_number,head_number,finalized_number FROM yunipals_indexer_control.chain_status WHERE release_id=$1 AND chain_id=8453",
                  [release.id]
                )
              ).rows[0];
        assert.equal(result, expected, JSON.stringify(state));
      }
    };
    const sync = async () => {
      const head = await client.getBlockNumber({ cacheTime: 0 });
      for (let number = cursor + 1n; number <= head; number++) {
        const block = await client.getBlock({ blockNumber: number });
        const receipts = [];
        for (const hash of block.transactions)
          receipts.push(await client.getTransactionReceipt({ hash }));
        await database.userQB.transaction(async (tx) => {
          await tx.wrap((db) =>
            db.execute(
              "CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY) ON COMMIT DROP"
            )
          );
          const context = { db: adapter(tx), chain: { id: 8453 } };
          for (const receipt of receipts)
            for (const log of receipt.logs) {
              if (log.address.toLowerCase() !== contract.toLowerCase())
                continue;
              const event = decodeEventLog({
                abi: arenaAbi,
                data: log.data,
                topics: log.topics,
                strict: true
              });
              const handler = handlers.find(
                (h) => h.name === `YunipalsArena:${event.eventName}`
              );
              assert.ok(handler, event.eventName);
              await handler.fn({
                context,
                event: {
                  args: event.args,
                  block,
                  transaction: {
                    hash: receipt.transactionHash,
                    transactionIndex: receipt.transactionIndex
                  },
                  log
                }
              });
            }
          await handlers
            .find((h) => h.name === "BaseCheckpoint:block")
            .fn({ context, event: { block } });
          for (const table of tables)
            await commitBlock(tx, {
              checkpoint: checkpoint(block),
              table,
              preBuild
            });
        });
        await pointer(block);
        cursor = number;
      }
      await pool.query(
        `UPDATE ${schemaName}._ponder_meta SET value=jsonb_set(value,'{heartbeat_at}',$1::jsonb) WHERE key='app'`,
        [String(Date.now())]
      );
      await observe();
      return cursor;
    };
    await sync();
    await migrateIndexerControl(pool);
    release = await registerIndexerRelease(pool, {
      schema: schemaName,
      buildId,
      manifest
    });
    await observe();
    const rewind = async (
      number,
      { expectedObservation = "observed" } = {}
    ) => {
      const block = await client.getBlock({ blockNumber: number });
      const history = (
        await pool.query(
          `SELECT block_number::text,checkpoint,operation_id,operation FROM ${schemaName}."${getReorgTableName(schema.chainCheckpoint)}" ORDER BY operation_id`
        )
      ).rows;
      await database.userQB.transaction(async (tx) => {
        const targets = tables.map((table) => ({
          schema: getTableConfig(table).schema,
          name: getTableConfig(table).name
        }));
        await setReorgTriggersEnabled(tx, targets, namespace.schema, false);
        await revertMultichain(tx, { checkpoint: checkpoint(block), tables });
        await setReorgTriggersEnabled(tx, targets, namespace.schema, true);
      });
      const witness = (
        await pool.query(
          `SELECT block_number::text FROM ${schemaName}.chain_checkpoint WHERE chain_id=8453`
        )
      ).rows[0];
      assert.equal(
        witness?.block_number,
        String(number),
        JSON.stringify({ target: checkpoint(block), history, witness })
      );
      cursor = number;
      await pointer(block);
      await observe(expectedObservation);
    };
    return { pool, readPool, release, schemaName, sync, rewind, close };
  } catch (error) {
    await close();
    throw error;
  }
}
