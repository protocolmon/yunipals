// Isolated local PG coverage proof. No retained source/control reset or provider calls.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { encodeEventTopics, erc721Abi, toHex, zeroAddress } from "viem";
import { createIndexerReader } from "../../../packages/yunipals-indexer-server/src/readers.ts";
import { migrateIndexerControl } from "../lib/unified/control-schema.ts";
import {
  buildSourceManifest,
  sourceManifestHash
} from "../lib/unified/sources.ts";
import { registerIndexerRelease } from "../lib/unified/releases.ts";
import { observeIndexerChain } from "../lib/unified/observer.ts";
import {
  queueReceiptCandidates,
  claimReceiptJobs,
  enrichReceiptJob
} from "../lib/unified/receipt-worker.ts";
import { receiptLogsBloom } from "../lib/unified/receipt-validation.ts";

const { values } = parseArgs({ options: { output: { type: "string" } } });
assert.ok(values.output, "Explicit output file required.");
const url = new URL(process.env.PONDER_UNIFIED_TEST_DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "56967");
assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
assert.equal(url.username, "unified_test");
assert.equal(url.search, "");
const suffix = randomBytes(6).toString("hex");
const database = `yunipals_receipt_floor_${suffix}`;
const schema = "receipt_floor_source";
const tables = [
  "_ponder_meta",
  "_ponder_checkpoint",
  "indexer_source",
  "canonical_event",
  "transaction_candidate",
  "chain_checkpoint",
  "chain_block"
];
const ident = (value) => {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
};
const admin = new pg.Pool({ connectionString: url.href, max: 2 });
let owner;
let created = false;
const preserved = async () => ({
  releases: (
    await admin.query(
      "SELECT to_jsonb(r) AS value FROM yunipals_indexer_control.release r ORDER BY id"
    )
  ).rows,
  pointer: (
    await admin.query(
      "SELECT to_jsonb(a) AS value FROM yunipals_indexer_control.active_release a ORDER BY name"
    )
  ).rows
});
const now = Date.now();
const stamp = BigInt(Math.floor(now / 1000));
const head = 122090400n;
const floor = head - 22n;
const hash = (number, branch = 0) =>
  toHex(BigInt(number) + BigInt(branch) * 1_000_000_000n, { size: 32 });
const wallet = `0x${"34".repeat(20)}`;
let branch = 0;
const point = (number) => ({
  number,
  hash: hash(number, number >= floor ? branch : 0),
  parentHash: hash(number - 1n, number > floor ? branch : 0),
  timestamp: stamp
});
const receipts = new Map();
let calls = 0;
const rpc = {
  providerId: "local-receipt-history-fixture",
  chainId: async () => 56,
  block: async (tag) =>
    point(tag === "latest" ? head : tag === "finalized" ? head - 25n : tag),
  receipt: async (transaction) => {
    calls++;
    return structuredClone(receipts.get(transaction));
  },
  code: async () => {
    throw new Error("Transfer fixture cannot request protocol code.");
  }
};
let baseline;
let proof;
try {
  baseline = await preserved();
  const columns = (
    await admin.query(
      `SELECT c.relname AS table_name,a.attname AS column_name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS sql_type,a.attnotnull AS required,
    pg_get_expr(d.adbin,d.adrelid) AS default_sql FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='dependency_check' AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`,
      [tables]
    )
  ).rows;
  const constraints = (
    await admin.query(
      `SELECT c.relname AS table_name,pg_get_constraintdef(x.oid) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='dependency_check' AND c.relname=ANY($1::text[]) AND x.contype IN ('p','u')`,
      [tables]
    )
  ).rows;
  assert.equal(
    new Set(columns.map((row) => row.table_name)).size,
    tables.length
  );
  await admin.query(`CREATE DATABASE ${ident(database)}`);
  created = true;
  const local = new URL(url);
  local.pathname = `/${database}`;
  owner = new pg.Pool({ connectionString: local.href, max: 4 });
  await owner.query(`CREATE SCHEMA ${schema}`);
  for (const table of tables) {
    const definitions = columns
      .filter((row) => row.table_name === table)
      .map(
        (row) =>
          `${ident(row.column_name)} ${row.sql_type}${row.default_sql ? ` DEFAULT ${row.default_sql}` : ""}${row.required ? " NOT NULL" : ""}`
      );
    definitions.push(
      ...constraints
        .filter((row) => row.table_name === table)
        .map((row) => row.definition)
    );
    await owner.query(
      `CREATE TABLE ${schema}.${ident(table)} (${definitions.join(",")})`
    );
  }
  await migrateIndexerControl(owner);
  const manifest = buildSourceManifest({
    UNIFIED_RECEIPT_HISTORY_JSON: JSON.stringify({
      "ownership:bnb": Number(floor)
    })
  });
  const source = manifest.sources.find((row) => row.id === "ownership:bnb");
  assert.equal(source.receiptStartBlock, floor.toString());
  assert.equal(source.startBlock, "7579197");
  const buildId = `receipt-floor-${suffix}`;
  await owner.query(`INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`, [
    JSON.stringify({
      version: "6",
      build_id: buildId,
      heartbeat_at: now,
      is_ready: 1,
      is_locked: 1,
      is_dev: 0
    })
  ]);
  const checkpoint = (chain, number) =>
    `${String(stamp).padStart(10, "0")}${String(chain).padStart(16, "0")}${String(number).padStart(16, "0")}${"9".repeat(33)}`;
  for (const [chain, name] of [
    [1, "mainnet"],
    [56, "bnb"],
    [137, "polygon"],
    [8453, "base"]
  ]) {
    await owner.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$4)`,
      [name, chain, checkpoint(chain, head), checkpoint(chain, head - 30n)]
    );
    await owner.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES($1,$2,$3,$4,$5,$6)`,
      [
        String(chain),
        chain,
        String(head),
        hash(head),
        hash(head - 1n),
        String(stamp)
      ]
    );
    for (let number = head - 30n; number <= head; number++)
      await owner.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,$6)`,
        [
          `${chain}:${number}`,
          chain,
          String(number),
          hash(number),
          hash(number - 1n),
          String(stamp)
        ]
      );
  }
  for (const item of manifest.sources)
    await owner.query(
      `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
      [
        item.id,
        item.chainId,
        sourceManifestHash(manifest),
        JSON.stringify(item)
      ]
    );
  const release = await registerIndexerRelease(owner, {
    schema,
    buildId,
    manifest
  });
  async function transfer(number, tokenId) {
    const block = point(number),
      transactionHash = hash(2000n + tokenId, branch);
    const args = { from: zeroAddress, to: wallet, tokenId };
    const topics = encodeEventTopics({
      abi: erc721Abi,
      eventName: "Transfer",
      args
    });
    const id = `56:${source.address}:${transactionHash}:0`;
    await owner.query(
      `INSERT INTO ${schema}.canonical_event(id,source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,transaction_index,log_index,topics,data)
      VALUES($1,$2,56,$3,'Transfer',$4,$5,$6,$7,$8,$9,0,0,$10,'0x')`,
      [
        id,
        source.id,
        source.address,
        JSON.stringify({
          from: zeroAddress,
          to: wallet,
          tokenId: tokenId.toString()
        }),
        source.abiHash,
        String(number),
        block.hash,
        String(stamp),
        transactionHash,
        JSON.stringify(topics)
      ]
    );
    if (number >= floor)
      await owner.query(
        `INSERT INTO ${schema}.transaction_candidate VALUES($1,56,$2,$3,$4)`,
        [
          `56:${block.hash}:${transactionHash}`,
          String(number),
          block.hash,
          transactionHash
        ]
      );
    const log = {
      address: source.address,
      topics,
      data: "0x",
      blockNumber: toHex(number),
      blockHash: block.hash,
      transactionHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false
    };
    receipts.set(transactionHash, {
      blockNumber: toHex(number),
      blockHash: block.hash,
      transactionHash,
      transactionIndex: "0x0",
      status: "0x1",
      from: wallet,
      to: source.address,
      contractAddress: null,
      gasUsed: "0x5208",
      cumulativeGasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      type: "0x2",
      logs: [log],
      logsBloom: receiptLogsBloom([log])
    });
    return { id, blockHash: block.hash, transactionHash };
  }
  const before = await transfer(floor - 1n, 1n);
  await transfer(floor, 2n);
  await transfer(floor + 1n, 3n);
  // Prior-release global jobs cannot starve or charge this release: claims join its candidates.
  await owner.query(
    `INSERT INTO yunipals_indexer_control.receipt_job(chain_id,block_number,block_hash,transaction_hash) VALUES(56,$1,$2,$3)`,
    [String(floor - 1n), before.blockHash, before.transactionHash]
  );
  assert.equal(
    await observeIndexerChain(owner, release, 56, rpc, { now: () => now }),
    "observed"
  );
  const reader = await createIndexerReader(owner, {
    releaseId: release.id,
    now: () => now
  });
  const policy = { kind: "latest" };
  const all = await reader.page(source.id, policy);
  assert.equal(all.events.length, 3);
  assert.equal(all.complete, true);
  await assert.rejects(
    reader.page(source.id, policy, { includeReceipts: true }),
    /receipt history floor/
  );
  const cursor = {
    version: 1,
    releaseId: release.id,
    sourceId: source.id,
    policy: "latest",
    completed: { number: String(floor - 1n), hash: hash(floor - 1n) },
    target: null,
    after: null
  };
  const pending = await reader.page(source.id, policy, {
    cursor,
    includeReceipts: true
  });
  assert.equal(pending.waitingReceipt, true);
  assert.equal(pending.events.length, 0);
  assert.deepEqual(pending.cursor.completed, cursor.completed);
  assert.equal(await queueReceiptCandidates(owner, release, 56), 2);
  const jobs = await claimReceiptJobs(owner, release, 56);
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((job) => BigInt(job.block_number) >= floor));
  for (const job of jobs)
    assert.equal(await enrichReceiptJob(owner, release, job, rpc), "stored");
  const first = await reader.page(source.id, policy, {
    cursor,
    includeReceipts: true,
    limit: 1
  });
  assert.equal(first.events.length, 1);
  assert.equal(first.receipts.length, 1);
  assert.equal(first.complete, false);
  const done = await reader.page(source.id, policy, {
    cursor: first.cursor,
    includeReceipts: true
  });
  assert.equal(done.events.length, 1);
  assert.equal(done.receipts.length, 1);
  assert.equal(done.complete, true);
  const stale = {
    ...cursor,
    completed: { number: String(floor - 2n), hash: hash(floor - 2n) }
  };
  await assert.rejects(
    reader.page(source.id, policy, { cursor: stale, includeReceipts: true }),
    /receipt history floor/
  );
  assert.equal(
    await claimReceiptJobs(owner, release, 56).then((rows) => rows.length),
    0
  );
  assert.equal(calls, 2, "No pre-floor global job requested a receipt.");
  // Replace the non-final branch. Old full evidence stays immutable, but old cursors fail.
  branch = 1;
  await owner.query(
    `DELETE FROM ${schema}.canonical_event WHERE block_number>=$1::bigint`,
    [String(floor)]
  );
  await owner.query(`DELETE FROM ${schema}.transaction_candidate`);
  for (let number = floor; number <= head; number++) {
    const block = point(number);
    await owner.query(
      `UPDATE ${schema}.chain_block SET block_hash=$3,parent_hash=$4 WHERE chain_id=$1 AND block_number=$2::bigint`,
      [56, String(number), block.hash, block.parentHash]
    );
  }
  await owner.query(
    `UPDATE ${schema}.chain_checkpoint SET block_hash=$1,parent_hash=$2 WHERE chain_id=56`,
    [point(head).hash, point(head).parentHash]
  );
  await transfer(floor, 2n);
  await transfer(floor + 1n, 3n);
  assert.equal(
    await observeIndexerChain(owner, release, 56, rpc, { now: () => now }),
    "observed"
  );
  await assert.rejects(
    reader.page(source.id, policy, {
      cursor: done.cursor,
      includeReceipts: true
    }),
    /reorged/
  );
  assert.equal(await queueReceiptCandidates(owner, release, 56), 2);
  for (const job of await claimReceiptJobs(owner, release, 56))
    assert.equal(await enrichReceiptJob(owner, release, job, rpc), "stored");
  const replacement = await reader.page(source.id, policy, {
    cursor,
    includeReceipts: true
  });
  assert.equal(replacement.events.length, 2);
  assert.equal(replacement.receipts.length, 2);
  assert.equal(replacement.complete, true);
  assert.equal(
    (
      await owner.query(
        "SELECT count(*)::int AS count FROM yunipals_indexer_control.transaction_evidence"
      )
    ).rows[0].count,
    4
  );
  assert.equal(
    (
      await owner.query(
        `SELECT count(*)::int AS count FROM ${schema}.canonical_event`
      )
    ).rows[0].count,
    3
  );
  proof = {
    format: "yunipals-receipt-history-fixture-v1",
    scope: "unique disposable local PG database; no provider/production calls",
    sourceStartBlock: source.startBlock,
    receiptStartBlock: source.receiptStartBlock,
    canonicalTransfers: 3,
    currentReceiptCandidates: 2,
    storedOriginalAndReplacementReceipts: 4,
    receiptCalls: calls,
    preFloorGlobalReceiptCalls: 0,
    checks: [
      "pre-floor canonical event history retained",
      "receipt-inclusive pre-floor start rejected",
      "below-floor continuation rejected",
      "pending receipts do not advance coverage",
      "post-floor paginated full evidence",
      "prior-release global jobs not claimed",
      "reorg invalidates old full-evidence cursor",
      "replacement branch receipts re-enriched",
      "original receipt evidence retained"
    ],
    productionMutations: false
  };
} finally {
  if (owner) await owner.end();
  if (created) await admin.query(`DROP DATABASE ${ident(database)}`);
  if (baseline)
    assert.deepEqual(
      await preserved(),
      baseline,
      "Retained releases and active pointers remain unchanged."
    );
  await admin.end();
}
proof.retainedReleasesAndActivePointerUnchanged = true;
proof.disposableDatabaseDropped = true;
await writeFile(values.output, `${JSON.stringify(proof, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx"
});
console.log(JSON.stringify(proof, null, 2));
