import assert from "node:assert/strict";
import pg from "pg";
import { encodeAbiParameters, encodeEventTopics, toHex } from "viem";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import { collections } from "../lib/constants.ts";
import { baseMetadataAbi } from "../lib/metadata/base-abi.ts";
import { archiveMigrations } from "../lib/metadata/source/schema.ts";
import { unifiedMetadataMigrations } from "../lib/metadata/unified-schema.ts";
import {
  baseMetadataState,
  commitBaseMetadataRange
} from "../lib/metadata/source/base-events.ts";
import {
  adoptBaseMetadataConsumer,
  approvedBaseMetadataImplementation,
  consumeBaseMetadataPage,
  decodeBaseMetadataEvent
} from "../lib/metadata/unified-base.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const pool = new pg.Pool({ connectionString, max: 4 });
const sourcePool = new pg.Pool({ connectionString, max: 3 });
const schema = "unified_metadata_test",
  buildId = "unified-metadata-test";
const manifest = buildSourceManifest({});
const source = manifest.sources.find((source) => source.id === "metadata:base");
const start = BigInt(collections.base.deploymentBlock);
const baseHead = 50_000_000n;
let head = baseHead,
  finalityUnavailable = false,
  badHash = null;
let implementation = approvedBaseMetadataImplementation,
  chainId = 8453;
const now = Date.now();
const hash = (number) => toHex(number, { size: 32 });
const wallet = `0x${"12".repeat(20)}`;
const checkpoint = (number) =>
  `0000001000${String(8453).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const block = (number) => ({
  number,
  hash: hash(number + (number === badHash ? 999n : 0n)),
  parentHash: hash(number - 1n),
  timestamp: BigInt(Math.floor(now / 1000))
});
const rpc = {
  providerId: "local-metadata-test",
  chainId: async () => chainId,
  block: async (tag) => {
    if (tag === "finalized" && finalityUnavailable)
      throw new Error("No finalized block");
    return block(
      tag === "latest" ? head : tag === "finalized" ? head - 20n : tag
    );
  }
};
let pointReads = 0;
const points = {
  chainId: rpc.chainId,
  blockHash: async (number) => {
    pointReads++;
    return block(number).hash;
  },
  implementation: async () => {
    pointReads++;
    return implementation;
  }
};
const name = "base_metadata_v1";
const scan = async () =>
  (
    await pool.query(
      "SELECT next_block::text,target_block::text,target_hash,last_scanned_hash,ingestion_mode FROM metadata_source.chain_metadata_scan WHERE name=$1",
      [name]
    )
  ).rows[0];
const storedCursor = async () =>
  (
    await pool.query(
      "SELECT cursor FROM metadata_source.chain_metadata_consumer WHERE name=$1",
      [name]
    )
  ).rows[0]?.cursor;
const count = async () =>
  Number(
    (
      await pool.query(
        "SELECT count(*) FROM metadata_source.chain_metadata_event"
      )
    ).rows[0].count
  );

async function moveWitness() {
  await sourcePool.query(
    `UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1,finalized_checkpoint=$2`,
    [checkpoint(head), checkpoint(head - 30n)]
  );
  await sourcePool.query(
    `INSERT INTO ${schema}.chain_checkpoint VALUES('8453',8453,$1,$2,$3,$4)
    ON CONFLICT(id) DO UPDATE SET block_number=$1,block_hash=$2,parent_hash=$3,timestamp=$4`,
    [String(head), hash(head), hash(head - 1n), String(block(head).timestamp)]
  );
  for (let number = head - 40n; number <= head; number++)
    await sourcePool.query(
      `INSERT INTO ${schema}.chain_block VALUES($1,8453,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
      [
        `8453:${number}`,
        String(number),
        hash(number),
        hash(number - 1n),
        String(block(number).timestamp)
      ]
    );
}

function event(index, eventName, number, tokenId = "10", color = 1) {
  const traits = {
    monsterType: 3,
    color,
    horn: 1,
    background: 0,
    glitter: 1,
    rarityScore: 42n
  };
  const definition = baseMetadataAbi.find(
    (item) => item.type === "event" && item.name === eventName
  );
  return {
    id: `8453:${source.address}:${hash(BigInt(index + 100))}:${index}`,
    sourceId: source.id,
    chainId: 8453,
    address: source.address,
    name: eventName,
    args: { to: wallet, tokenId, yunipal: { ...traits, rarityScore: 42 } },
    abiHash: source.abiHash,
    blockNumber: String(number),
    blockHash: hash(number),
    timestamp: "1000",
    transactionHash: hash(BigInt(index + 100)),
    transactionIndex: index,
    logIndex: index,
    topics: encodeEventTopics({
      abi: baseMetadataAbi,
      eventName,
      args: { to: wallet, tokenId: BigInt(tokenId) }
    }),
    data: encodeAbiParameters(
      definition.inputs.filter((input) => !input.indexed),
      [traits]
    )
  };
}
async function insert(event) {
  await sourcePool.query(
    `INSERT INTO ${schema}.canonical_event
    (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      event.id,
      event.sourceId,
      event.chainId,
      event.address,
      event.name,
      JSON.stringify(event.args),
      event.abiHash,
      event.blockNumber,
      event.blockHash,
      event.timestamp,
      event.transactionHash,
      event.transactionIndex,
      event.logIndex,
      JSON.stringify(event.topics),
      event.data
    ]
  );
}

try {
  assert.ok(
    (
      await pool.query(
        "SELECT to_regclass('dependency_check.chain_block') AS source"
      )
    ).rows[0].source,
    "Run test:ponder:postgres before this check."
  );
  await pool.query("DROP SCHEMA IF EXISTS unified_metadata_test CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS metadata_source CASCADE");
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "canonical_event",
    "chain_checkpoint",
    "chain_block",
    "transaction_candidate"
  ])
    await pool.query(
      `CREATE TABLE ${schema}.${table} (LIKE dependency_check.${table} INCLUDING ALL)`
    );
  await pool.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: buildId,
      heartbeat_at: now,
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  await pool.query(
    `INSERT INTO ${schema}._ponder_checkpoint VALUES('base',8453,$1,$1,$2)`,
    [checkpoint(head), checkpoint(head - 30n)]
  );
  for (const definition of manifest.sources)
    await pool.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        definition.id,
        definition.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(definition)
      ]
    );
  for (const sql of [...archiveMigrations, ...unifiedMetadataMigrations])
    await pool.query(sql);
  await migrateIndexerControl(pool);
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [schema]
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=(SELECT id FROM yunipals_indexer_control.release WHERE physical_schema=$1)",
    [schema]
  );
  const release = await registerIndexerRelease(pool, {
    schema,
    buildId,
    manifest
  });
  await moveWitness();
  assert.equal(
    await observeIndexerChain(sourcePool, release, 8453, rpc, {
      now: () => now
    }),
    "observed"
  );
  const reader = await createIndexerReader(sourcePool, {
    releaseId: release.id,
    now: () => now
  });
  assert.equal(reader.release.id, release.id);
  await assert.rejects(createIndexerReader(sourcePool), /No selected/);
  await assert.rejects(
    reader.snapshot(source.id, { kind: "finalized" }, (db) =>
      db.query(`UPDATE ${schema}._ponder_meta SET value=value WHERE key='app'`)
    ),
    (error) => error.code === "25006"
  );

  const first = event(0, "Mint", baseHead - 30n);
  const update = event(1, "Update", baseHead - 30n, "10", 2);
  const third = event(2, "Mint", baseHead - 30n, "11");
  const pending = event(3, "Update", baseHead - 2n, "10", 3);
  for (const value of [first, update, third, pending]) await insert(value);
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /not been adopted/
  );
  implementation = wallet;
  await assert.rejects(
    adoptBaseMetadataConsumer(pool, reader, points),
    /ABI review/
  );
  assert.equal(await scan(), undefined);
  implementation = approvedBaseMetadataImplementation;
  chainId = 1;
  await assert.rejects(
    adoptBaseMetadataConsumer(pool, reader, points),
    /chain mismatch/
  );
  chainId = 8453;
  assert.equal(
    (await adoptBaseMetadataConsumer(pool, reader, points)).adopted,
    true
  );
  assert.equal(
    (await adoptBaseMetadataConsumer(pool, reader, points)).adopted,
    false
  );

  const lock = await pool.connect();
  try {
    await lock.query(
      "SELECT pg_advisory_lock(hashtext('metadata:base-replay'))"
    );
    const reads = pointReads;
    assert.deepEqual(await consumeBaseMetadataPage(pool, reader, points), {
      busy: true
    });
    assert.equal(pointReads, reads);
  } finally {
    await lock.query(
      "SELECT pg_advisory_unlock(hashtext('metadata:base-replay'))"
    );
    lock.release();
  }
  let result = await consumeBaseMetadataPage(pool, reader, points, {
    limit: 1
  });
  assert.equal(result.applied, 1);
  assert.equal(result.complete, false);
  assert.equal((await scan()).next_block, String(start));
  assert.equal((await baseMetadataState(pool, "10")).event, null);
  const cursorBefore = await storedCursor();
  await pool.query(`CREATE FUNCTION metadata_source.reject_consumer_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected_destination_failure'; END $$;
    CREATE TRIGGER fail_consumer_commit BEFORE UPDATE ON metadata_source.chain_metadata_consumer
      FOR EACH ROW EXECUTE FUNCTION metadata_source.reject_consumer_commit()`);
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points, { limit: 1 }),
    /injected_destination_failure/
  );
  assert.equal(await count(), 1);
  assert.deepEqual(await storedCursor(), cursorBefore);
  assert.equal((await scan()).next_block, String(start));
  await pool.query(
    "DROP TRIGGER fail_consumer_commit ON metadata_source.chain_metadata_consumer"
  );
  result = await consumeBaseMetadataPage(pool, reader, points, { limit: 1 });
  assert.equal(result.applied, 1);
  assert.equal(result.complete, false);
  result = await consumeBaseMetadataPage(pool, reader, points, { limit: 1 });
  assert.equal(result.applied, 1);
  assert.equal(result.complete, true);
  assert.equal(await count(), 3);
  assert.equal((await baseMetadataState(pool, "10")).event.traits.color, 2);
  assert.equal((await scan()).next_block, String(baseHead - 19n));
  assert.equal(
    (await consumeBaseMetadataPage(pool, reader, points)).applied,
    0
  );
  assert.equal(await count(), 3);
  await assert.rejects(
    commitBaseMetadataRange(
      pool,
      name,
      baseHead - 19n,
      baseHead - 19n,
      hash(baseHead - 19n),
      []
    ),
    /checkpoint/
  );

  // A later finalized boundary includes the former pending update. Persisted
  // data remains unchanged when its raw and decoded evidence disagree.
  head = baseHead + 30n;
  await moveWitness();
  assert.equal(
    await observeIndexerChain(sourcePool, release, 8453, rpc, {
      now: () => now
    }),
    "observed"
  );
  const before = await storedCursor();
  await sourcePool.query(
    `UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`,
    [pending.id, JSON.stringify(first.args)]
  );
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /differs from raw/
  );
  assert.deepEqual(await storedCursor(), before);
  assert.equal(await count(), 3);
  await sourcePool.query(
    `UPDATE ${schema}.canonical_event SET args=$2 WHERE id=$1`,
    [pending.id, JSON.stringify(pending.args)]
  );
  implementation = wallet;
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /ABI review/
  );
  assert.deepEqual(await storedCursor(), before);
  implementation = approvedBaseMetadataImplementation;
  badHash = baseHead - 20n;
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /checkpoint changed/
  );
  assert.deepEqual(await storedCursor(), before);
  badHash = null;
  finalityUnavailable = true;
  assert.equal(
    await observeIndexerChain(sourcePool, release, 8453, rpc, {
      now: () => now
    }),
    "observed"
  );
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /finality_unavailable/
  );
  finalityUnavailable = false;
  await observeIndexerChain(sourcePool, release, 8453, rpc, { now: () => now });
  assert.equal(
    (await consumeBaseMetadataPage(pool, reader, points)).applied,
    1
  );
  assert.equal((await baseMetadataState(pool, "10")).event.traits.color, 3);
  assert.equal(await count(), 4);

  // Adopt a previously completed legacy prefix without replaying it into a
  // different lifecycle or losing the existing published watermark.
  await pool.query(
    "TRUNCATE metadata_source.chain_metadata_consumer,metadata_source.chain_metadata_scan,metadata_source.chain_metadata_event"
  );
  await pool.query(
    `INSERT INTO metadata_source.chain_metadata_scan
    (name,chain_id,contract_address,deployment_block,next_block,target_block,target_hash)
    VALUES($1,8453,$2,$3,$3,$4,$5)`,
    [name, source.address, String(start), String(head - 20n), hash(head - 20n)]
  );
  await commitBaseMetadataRange(
    pool,
    name,
    start,
    baseHead - 30n,
    hash(baseHead - 30n),
    [first, update, third].map(decodeBaseMetadataEvent)
  );
  const previous = await scan();
  await adoptBaseMetadataConsumer(pool, reader, points);
  assert.equal((await scan()).next_block, previous.next_block);
  assert.equal(
    (await consumeBaseMetadataPage(pool, reader, points)).applied,
    1
  );
  assert.equal(await count(), 4);
  assert.equal((await baseMetadataState(pool, "10")).event.traits.color, 3);
  const otherReleaseReader = {
    ...reader,
    release: { ...reader.release, id: hash(999n) }
  };
  await assert.rejects(
    consumeBaseMetadataPage(pool, otherReleaseReader, points),
    /explicit release adoption/
  );

  // Actual finalized contradictions halt the source and preserve application
  // data/cursors rather than rewriting a new checkpoint over it.
  const finalCursor = await storedCursor();
  badHash = head - 20n;
  assert.equal(
    await observeIndexerChain(sourcePool, release, 8453, rpc, {
      now: () => now
    }),
    "halted"
  );
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /checkpoint changed/
  );
  assert.deepEqual(await storedCursor(), finalCursor);
  assert.equal(await count(), 4);
  badHash = null;
  await assert.rejects(
    consumeBaseMetadataPage(pool, reader, points),
    /finalized_history_changed/
  );

  console.log(
    JSON.stringify({
      event: "unified_metadata_postgres_verified",
      checks: [
        "packaged read-only reader and explicit release selection",
        "explicit adoption and legacy-writer fencing",
        "no log-scanning RPC interface",
        "finalized-only publication and same-block resume",
        "atomic destination failure/restart",
        "raw/decoded ABI consistency and implementation review",
        "idle polling and canonical checkpoint preservation",
        "legacy prefix adoption without duplicates",
        "finality outage, finalized contradiction halt, and release isolation"
      ]
    })
  );
} finally {
  await sourcePool.end();
  await pool.end();
}
