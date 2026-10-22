import assert from "node:assert/strict";
import pg from "pg";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, padHex, toEventSelector, toHex } from "viem";
import { baseMetadataAbi } from "../lib/metadata/base-abi.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import { indexerSourceStatus } from "../lib/unified/status.ts";
import {
  readCanonicalPage,
  CanonicalCursorInvalidated
} from "../lib/unified/paging.ts";
import {
  queueReceiptCandidates,
  claimReceiptJobs,
  enrichReceiptJob
} from "../lib/unified/receipt-worker.ts";
import { receiptLogsBloom } from "../lib/unified/receipt-validation.ts";

const connectionString = process.env.PONDER_UNIFIED_TEST_DATABASE_URL;
assert.ok(connectionString, "PONDER_UNIFIED_TEST_DATABASE_URL is required");
const url = new URL(connectionString);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.search, "");
const pool = new pg.Pool({ connectionString, max: 6 });
const schema = "unified_support_test",
  buildId = "unified-support-test";
const head = 50_000_000n,
  now = 1_000_000;
const hash = (number) => toHex(number, { size: 32 });
const wallet = `0x${"12".repeat(20)}`;
const manifest = buildSourceManifest({
  ARENA_CONTRACT: wallet,
  ARENA_DEPLOYMENT_BLOCK: "100"
});
const checkpoint = (chain, number) =>
  `0000001000${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
const arenaSource = `arena:8453:${wallet}`;
const depth = { kind: "depth", subsequentBlocks: 5 };
let forkHeight = null,
  finalityUnavailable = false,
  branchFrom = null;
const branchHash = (number) =>
  hash(
    number +
      (number === forkHeight ? 999n : 0n) +
      (branchFrom !== null && number >= branchFrom ? 2000n : 0n)
  );
const receipts = new Map();
const rpc = {
  providerId: "local-test-provider",
  chainId: async () => 8453,
  block: async (tag) => {
    if (tag === "finalized" && finalityUnavailable)
      throw new Error("provider secret must not be logged");
    const number =
      tag === "latest" ? head : tag === "finalized" ? head - 20n : tag;
    return {
      number,
      hash: branchHash(number),
      parentHash: branchHash(number - 1n),
      timestamp: 1000n
    };
  },
  receipt: async (transaction) => structuredClone(receipts.get(transaction)),
  code: async () => {
    throw new Error("Mint receipts must not require a protocol code read.");
  }
};

try {
  assert.ok(
    (
      await pool.query(
        "SELECT to_regclass('dependency_check.chain_block') AS source"
      )
    ).rows[0].source,
    "Run test:ponder:postgres first to build the actual patched Ponder schema."
  );
  await pool.query("DROP SCHEMA IF EXISTS unified_support_test CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS yunipals_indexer_control CASCADE");
  await pool.query("CREATE SCHEMA unified_support_test");
  for (const table of [
    "_ponder_meta",
    "_ponder_checkpoint",
    "indexer_source",
    "canonical_event",
    "transaction_candidate",
    "chain_checkpoint",
    "chain_block"
  ]) {
    await pool.query(
      `CREATE TABLE ${schema}.${table} (LIKE dependency_check.${table} INCLUDING ALL)`
    );
  }
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
  for (const [chain, name] of [
    [1, "mainnet"],
    [56, "bnb"],
    [137, "polygon"],
    [8453, "base"]
  ]) {
    await pool.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$4)`,
      [name, chain, checkpoint(chain, head), checkpoint(chain, head - 30n)]
    );
    await pool.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES($1,$2,$3,$4,$5,1000)`,
      [String(chain), chain, String(head), hash(head), hash(head - 1n)]
    );
    for (let number = head - 30n; number <= head; number++) {
      await pool.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,1000)`,
        [
          `${chain}:${number}`,
          chain,
          String(number),
          hash(number),
          hash(number - 1n)
        ]
      );
    }
  }
  for (const source of manifest.sources)
    await pool.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        source.id,
        source.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(source)
      ]
    );
  await migrateIndexerControl(pool);
  await migrateIndexerControl(pool);
  const migration = (
    await pool.query(
      "SELECT checksum FROM yunipals_indexer_control.schema_migration WHERE version=1"
    )
  ).rows[0].checksum;
  await pool.query(
    "UPDATE yunipals_indexer_control.schema_migration SET checksum='changed' WHERE version=1"
  );
  await assert.rejects(migrateIndexerControl(pool), /migration history/);
  await pool.query(
    "UPDATE yunipals_indexer_control.schema_migration SET checksum=$1 WHERE version=1",
    [migration]
  );
  const release = await registerIndexerRelease(pool, {
    schema,
    buildId,
    manifest
  });
  assert.equal(
    (await registerIndexerRelease(pool, { schema, buildId, manifest })).id,
    release.id
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM yunipals_indexer_control.active_release"
        )
      ).rows[0].count
    ),
    0
  );
  await pool.query(
    `UPDATE ${schema}.indexer_source SET definition='{}' WHERE id='metadata:base'`
  );
  await assert.rejects(
    registerIndexerRelease(pool, { schema, buildId, manifest }),
    /source definition/
  );
  await pool.query(
    `UPDATE ${schema}.indexer_source SET definition=$1 WHERE id='metadata:base'`,
    [
      JSON.stringify(
        manifest.sources.find((source) => source.id === "metadata:base")
      )
    ]
  );

  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "observed"
  );
  assert.equal(
    (
      await indexerSourceStatus(pool, release, arenaSource, depth, {
        nowMs: now
      })
    ).readiness.availableThroughBlock,
    head - 5n
  );
  assert.equal(
    (
      await indexerSourceStatus(
        pool,
        release,
        "metadata:base",
        { kind: "finalized" },
        { nowMs: now }
      )
    ).readiness.availableThroughBlock,
    head - 20n
  );
  assert.equal(
    (
      await indexerSourceStatus(pool, release, arenaSource, depth, {
        nowMs: now + 180001
      })
    ).readiness.reason,
    "observation_stale"
  );
  finalityUnavailable = true;
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "observed"
  );
  assert.equal(
    (
      await indexerSourceStatus(pool, release, arenaSource, depth, {
        nowMs: now
      })
    ).readiness.ready,
    true
  );
  assert.equal(
    (
      await indexerSourceStatus(
        pool,
        release,
        "metadata:base",
        { kind: "finalized" },
        { nowMs: now }
      )
    ).readiness.reason,
    "finality_unavailable"
  );
  assert.equal(
    (
      await pool.query(
        "SELECT finalized_number::text FROM yunipals_indexer_control.chain_status WHERE chain_id=8453"
      )
    ).rows[0].finalized_number,
    String(head - 20n)
  );
  forkHeight = head - 20n;
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "halted"
  );
  forkHeight = null;
  finalityUnavailable = false;
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "halted"
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
    [release.id]
  );
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "observed"
  );

  await pool.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=$2`,
    [hash(head + 1n), String(head)]
  );
  assert.equal(
    (
      await indexerSourceStatus(pool, release, arenaSource, depth, {
        nowMs: now
      })
    ).readiness.ready,
    false
  );
  await pool.query(
    `UPDATE ${schema}.chain_block SET block_hash=$1 WHERE chain_id=8453 AND block_number=$2`,
    [hash(head), String(head)]
  );
  const blockNumber = head - 10n;
  const insertEvent = async (
    id,
    sourceId,
    transactionHash,
    index,
    topics = [],
    data = "0x",
    blockHash = hash(blockNumber),
    name = null,
    transactionIndex = index
  ) => {
    const source = manifest.sources.find((source) => source.id === sourceId);
    await pool.query(
      `INSERT INTO ${schema}.canonical_event
      (id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data)
      VALUES($1,$2,8453,$3,$4,'{}',$5,$6,$7,1000,$8,$9,$10,$11,$12)`,
      [
        id,
        sourceId,
        source.address,
        name ?? (source.feature === "arena" ? "Entered" : "Transfer"),
        source.abiHash,
        String(blockNumber),
        blockHash,
        transactionHash,
        transactionIndex,
        index,
        JSON.stringify(topics),
        data
      ]
    );
  };
  for (let index = 0; index < 3; index++)
    await insertEvent(`arena-${index}`, arenaSource, hash(700n), index);
  const first = await readCanonicalPage(pool, release, arenaSource, depth, {
    limit: 1,
    nowMs: now
  });
  assert.equal(first.complete, false);
  assert.equal(first.cursor.completed, null);
  assert.equal(first.events[0].id, "arena-0");
  // A boundary may predate the live block subscription. Its observer anchor
  // still carries a retained Ponder witness proving the canonical branch.
  await pool.query(
    `DELETE FROM ${schema}.chain_block WHERE chain_id=8453 AND block_number=$1`,
    [String(head - 5n)]
  );
  const second = await readCanonicalPage(pool, release, arenaSource, depth, {
    limit: 1,
    nowMs: now,
    cursor: first.cursor
  });
  assert.equal(second.events[0].id, "arena-1");
  assert.equal(second.complete, false);
  const third = await readCanonicalPage(pool, release, arenaSource, depth, {
    limit: 1,
    nowMs: now,
    cursor: second.cursor
  });
  assert.equal(third.events[0].id, "arena-2");
  assert.equal(third.complete, true);
  assert.equal(third.cursor.completed.number, String(head - 5n));
  assert.equal(
    (
      await readCanonicalPage(pool, release, arenaSource, depth, {
        nowMs: now,
        cursor: third.cursor
      })
    ).events.length,
    0
  );
  await pool.query(
    "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1 AND chain_id=8453 AND block_number=$2",
    [release.id, String(head - 5n)]
  );
  await assert.rejects(
    readCanonicalPage(pool, release, arenaSource, depth, {
      nowMs: now,
      cursor: third.cursor
    }),
    CanonicalCursorInvalidated
  );
  const verifiedIdle = await readCanonicalPage(
    pool,
    release,
    arenaSource,
    depth,
    {
      nowMs: now,
      cursor: third.cursor,
      verifyOldAnchor: async (anchor, chain) =>
        chain === 8453 &&
        (await rpc.block(BigInt(anchor.number))).hash === anchor.hash
    }
  );
  assert.equal(verifiedIdle.events.length, 0);
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "observed"
  );
  await pool.query(`DELETE FROM ${schema}.canonical_event WHERE id='arena-0'`);
  await assert.rejects(
    readCanonicalPage(pool, release, arenaSource, depth, {
      nowMs: now,
      cursor: first.cursor
    }),
    CanonicalCursorInvalidated
  );

  const ownership = manifest.sources.find(
    (source) => source.id === "ownership:base"
  );
  for (let index = 0; index < 3; index++) {
    const transactionHash = hash(1000n + BigInt(index));
    const topics = [
      toEventSelector("Transfer(address,address,uint256)"),
      padHex("0x00", { size: 32 }),
      padHex(wallet, { size: 32 }),
      toHex(BigInt(index + 1), { size: 32 })
    ];
    await insertEvent(
      `mint-${index}`,
      ownership.id,
      transactionHash,
      200 + index * 2,
      topics,
      "0x",
      hash(blockNumber),
      "Transfer",
      100 + index
    );
    await pool.query(
      `INSERT INTO ${schema}.transaction_candidate VALUES($1,8453,$2,$3,$4)`,
      [transactionHash, String(blockNumber), hash(blockNumber), transactionHash]
    );
    const log = {
      address: ownership.address,
      blockHash: hash(blockNumber),
      blockNumber: toHex(blockNumber),
      transactionHash,
      transactionIndex: toHex(100 + index),
      logIndex: toHex(200 + index * 2),
      removed: false,
      topics,
      data: "0x"
    };
    const mintTopics = encodeEventTopics({
      abi: baseMetadataAbi,
      eventName: "Mint",
      args: { to: wallet, tokenId: BigInt(index + 1) }
    });
    assert.equal(mintTopics.length, 3);
    const mintData = encodeAbiParameters(
      getAbiItem({ abi: baseMetadataAbi, name: "Mint" }).inputs.filter((input) => !input.indexed),
      [{ monsterType: 1, color: 2, horn: 3, background: 0, glitter: 0, rarityScore: 10 }]
    );
    const mintLog = { ...log, topics: mintTopics, data: mintData, logIndex: toHex(201 + index * 2) };
    // Actual Ponder representation differs from RPC: unused topic slots are null.
    await insertEvent(`metadata-mint-${index}`, "metadata:base", transactionHash,
      201 + index * 2, [...mintTopics, null], mintData, hash(blockNumber), "Mint", 100 + index);
    receipts.set(transactionHash, {
      blockHash: hash(blockNumber),
      blockNumber: toHex(blockNumber),
      transactionHash,
      transactionIndex: toHex(100 + index),
      status: "0x1",
      from: wallet,
      to: ownership.address,
      contractAddress: null,
      gasUsed: "0x5208",
      cumulativeGasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      type: "0x2",
      logsBloom: receiptLogsBloom([log, mintLog]),
      logs: [log, mintLog]
    });
  }
  assert.equal(
    (
      await readCanonicalPage(
        pool,
        release,
        ownership.id,
        { kind: "latest" },
        { nowMs: now, includeReceipts: true }
      )
    ).waitingReceipt,
    true
  );
  assert.equal(await queueReceiptCandidates(pool, release, 8453, 2), 2);
  assert.equal(await queueReceiptCandidates(pool, release, 8453, 2), 1);
  const [leaseOne, leaseTwo] = await Promise.all([
    claimReceiptJobs(pool, release, 8453, 1),
    claimReceiptJobs(pool, release, 8453, 2)
  ]);
  const jobs = [...leaseOne, ...leaseTwo];
  assert.equal(jobs.length, 3);
  assert.equal(new Set(jobs.map((job) => job.transaction_hash)).size, 3);
  const badHash = hash(1002n),
    goodReceipt = receipts.get(badHash);
  receipts.set(badHash, { ...goodReceipt, logs: [] });
  for (const job of jobs)
    assert.equal(
      await enrichReceiptJob(pool, release, job, rpc),
      job.transaction_hash === badHash ? "retry" : "stored"
    );
  const pending = await readCanonicalPage(
    pool,
    release,
    ownership.id,
    { kind: "latest" },
    { nowMs: now, includeReceipts: true }
  );
  assert.equal(pending.events.length, 2);
  assert.equal(pending.waitingReceipt, true);
  assert.equal(pending.complete, false);
  assert.equal(pending.cursor.completed, null);
  assert.equal(
    (
      await pool.query(
        "SELECT error_code FROM yunipals_indexer_control.receipt_job WHERE transaction_hash=$1",
        [badHash]
      )
    ).rows[0].error_code,
    "receipt_validation_failed"
  );
  receipts.set(badHash, goodReceipt);
  await pool.query(
    "UPDATE yunipals_indexer_control.receipt_job SET next_attempt_at=clock_timestamp() WHERE transaction_hash=$1",
    [badHash]
  );
  const repaired = await claimReceiptJobs(pool, release, 8453, 1);
  assert.equal(repaired.length, 1);
  assert.equal(
    await enrichReceiptJob(
      pool,
      release,
      jobs.find((job) => job.transaction_hash === badHash),
      rpc
    ),
    "superseded"
  );
  assert.equal(
    await enrichReceiptJob(pool, release, repaired[0], rpc),
    "stored"
  );
  const done = await readCanonicalPage(
    pool,
    release,
    ownership.id,
    { kind: "latest" },
    { nowMs: now, includeReceipts: true, cursor: pending.cursor }
  );
  assert.equal(done.events.length, 1);
  assert.equal(done.complete, true);
  assert.equal(done.cursor.completed.number, String(head));
  const metadataPage = await readCanonicalPage(pool, release, "metadata:base", { kind: "latest" }, { nowMs: now });
  assert.equal(metadataPage.events.length, 3);
  assert.ok(metadataPage.events.every((event) => event.topics.length === 3 && event.topics.every((topic) => typeof topic === "string")));
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM yunipals_indexer_control.transaction_evidence"
        )
      ).rows[0].count
    ),
    3
  );
  assert.equal(await queueReceiptCandidates(pool, release, 8453), 0);
  // Replace a whole block as Ponder would during a reorg. Discovery must rewind
  // its position; old immutable receipts must not count for the new branch.
  branchFrom = blockNumber;
  for (let number = blockNumber; number <= head; number++)
    await pool.query(
      `UPDATE ${schema}.chain_block
    SET block_hash=$3,parent_hash=$4 WHERE chain_id=$1 AND block_number=$2`,
      [8453, String(number), branchHash(number), branchHash(number - 1n)]
    );
  await pool.query(
    `UPDATE ${schema}.chain_checkpoint SET block_hash=$1,parent_hash=$2 WHERE chain_id=8453`,
    [branchHash(head), branchHash(head - 1n)]
  );
  await pool.query(
    `DELETE FROM ${schema}.canonical_event WHERE chain_id=8453 AND block_number=$1`,
    [String(blockNumber)]
  );
  await pool.query(
    `DELETE FROM ${schema}.transaction_candidate WHERE chain_id=8453 AND block_number=$1`,
    [String(blockNumber)]
  );
  const replacementHash = hash(2000n),
    replacementBlockHash = branchHash(blockNumber);
  const replacementLog = {
    ...goodReceipt.logs[0],
    blockHash: replacementBlockHash,
    transactionHash: replacementHash,
    transactionIndex: "0x0",
    logIndex: "0x0"
  };
  receipts.set(replacementHash, {
    ...goodReceipt,
    blockHash: replacementBlockHash,
    transactionHash: replacementHash,
    transactionIndex: "0x0",
    logs: [replacementLog],
    logsBloom: receiptLogsBloom([replacementLog])
  });
  await insertEvent(
    "replacement",
    ownership.id,
    replacementHash,
    0,
    replacementLog.topics,
    "0x",
    replacementBlockHash
  );
  await pool.query(
    `INSERT INTO ${schema}.transaction_candidate VALUES($1,8453,$2,$3,$4)`,
    [
      replacementHash,
      String(blockNumber),
      replacementBlockHash,
      replacementHash
    ]
  );
  assert.equal(
    await observeIndexerChain(pool, release, 8453, rpc, { now: () => now }),
    "observed"
  );
  await assert.rejects(
    readCanonicalPage(
      pool,
      release,
      ownership.id,
      { kind: "latest" },
      { nowMs: now, cursor: done.cursor }
    ),
    CanonicalCursorInvalidated
  );
  assert.equal(await queueReceiptCandidates(pool, release, 8453, 2), 1);
  const replacementJobs = await claimReceiptJobs(pool, release, 8453, 1);
  assert.equal(replacementJobs.length, 1);
  assert.equal(replacementJobs[0].transaction_hash, replacementHash);
  const orphanRpc = {
    ...rpc,
    receipt: async (transaction) => {
      const value = await rpc.receipt(transaction);
      await pool.query(
        `DELETE FROM ${schema}.transaction_candidate WHERE transaction_hash=$1`,
        [transaction]
      );
      await pool.query(
        `DELETE FROM ${schema}.canonical_event WHERE transaction_hash=$1`,
        [transaction]
      );
      return value;
    }
  };
  assert.equal(
    await enrichReceiptJob(pool, release, replacementJobs[0], orphanRpc),
    "orphaned"
  );
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) FROM yunipals_indexer_control.transaction_evidence"
        )
      ).rows[0].count
    ),
    3
  );
  assert.equal(await queueReceiptCandidates(pool, release, 8453, 2), 0);
  console.log(
    JSON.stringify({
      event: "unified_support_postgres_verified",
      checks: [
        "actual Ponder table types",
        "release/source binding",
        "no automatic promotion",
        "source-scoped confirmations/finality",
        "quiet blocks and orphaned witness",
        "retained finalized anchor and halt",
        "partial-block cursor resume/reorg",
        "dense-block receipt queue",
        "queue cursor rewind after reorg and orphaned in-flight fetch",
        "lease fencing",
        "malformed receipt retry",
        "Ponder padded Mint topics match unpadded full receipts and canonical pages",
        "complete receipt-backed coverage"
      ]
    })
  );
} finally {
  await pool.end();
}
