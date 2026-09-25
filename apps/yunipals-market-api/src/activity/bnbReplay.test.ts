import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc721Abi,
  parseEventLogs,
  zeroAddress,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { seaportDeployment } from "@protopals/yunipals-market-core/registry";

import { BnbSaleReplay } from "@/activity/bnbReplay";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { buyer, code, now, seller, timestamp } from "@/bnb/fixtures/admission";

const db = createBnbTestDatabase();
const where = "source='chain' AND chain_id=56 AND name='bnb-sales'";
const hashes = (number: bigint, branch = 0) =>
  `0x${(number + BigInt(branch) * 1000000n).toString(16).padStart(64, "0")}` as Hex;
let savedCheckpoint: unknown;
let suppressed: { order_hash: string; state: string }[] = [];
let ready = false;
before(async () => {
  await db.initialize();
  for (const table of ["sale", "sale_receipt", "activity_block"])
    assert.equal(
      (
        await db.owner.query(
          `SELECT count(*) FROM yunipals_market.${table} WHERE chain_id=56`
        )
      ).rows[0].count,
      "0",
      "Activity fixtures must be empty before this isolated suite"
    );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.snapshot WHERE kind='activity'"
      )
    ).rows[0].count,
    "0"
  );
  savedCheckpoint = (
    await db.owner.query(
      `SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE ${where}`
    )
  ).rows[0].value;
  // The foundation suite retains a deliberately synthetic storage-only order.
  // Preserve it and temporarily exclude it from this isolated activity fixture.
  suppressed = (
    await db.owner.query(
      "SELECT order_hash,state FROM yunipals_market.orders WHERE chain_id=56 AND publication_state='accepted' AND admission_block_number IS NULL"
    )
  ).rows;
  await db.owner.query(
    "UPDATE yunipals_market.orders SET publication_state='pending',state='unavailable' WHERE chain_id=56 AND order_hash=ANY($1::text[])",
    [suppressed.map((row) => row.order_hash)]
  );
  ready = true;
});
beforeEach(async () => {
  if (!ready) return;
  await db.owner
    .query(`UPDATE yunipals_market.checkpoint SET generation=generation+1,block_number=NULL,block_hash=NULL,
    coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL,state='syncing',last_error_code=NULL WHERE ${where}`);
});
afterEach(async () => {
  if (!ready) return;
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=56");
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.activity_block WHERE chain_id=56"
  );
  await db.clear();
});
after(async () => {
  try {
    if (!ready) return;
    await db.owner.query(
      `UPDATE yunipals_market.orders o SET publication_state='accepted',state=s.state FROM jsonb_to_recordset($1) AS s(order_hash text,state text) WHERE o.chain_id=56 AND o.order_hash=s.order_hash`,
      [JSON.stringify(suppressed)]
    );
    await db.owner.query(
      `DELETE FROM yunipals_market.checkpoint WHERE ${where}`
    );
    await db.owner.query(
      "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
      [JSON.stringify(savedCheckpoint)]
    );
  } finally {
    await db.close();
  }
});

async function fixture(side: "listing" | "offer" = "listing") {
  const item = await db.setup(side);
  const prepared = await item.service.prepare(item.draft);
  const accepted = await item.service.submit({
    ...item.request,
    preparationId: prepared.id
  });
  const order = accepted.order;
  const state = {
    head: 145n,
    branch: 0,
    forkFrom: 0n,
    saleBlock: 123n,
    rpcFailure: false,
    wrongChain: false,
    code,
    receiptFailure: false,
    omitTransfer: false,
    duplicateLog: false,
    afterReceipt: async () => {},
    onCode: async () => {},
    beforeLogs: async () => {}
  };
  const block = (number: bigint) => ({
    number,
    hash: hashes(number, number >= state.forkFrom ? state.branch : 0),
    timestamp: timestamp + number - 121n
  });
  const receipt = (): TransactionReceipt => {
    const b = block(state.saleBlock);
    const meta = {
      blockHash: b.hash,
      blockNumber: b.number,
      transactionHash: hashes(900n, state.branch),
      transactionIndex: 0,
      removed: false
    };
    const abi = seaportEventAbi.find((item) => item.name === "OrderFulfilled")!;
    const fulfillment = {
      ...meta,
      address: seaportDeployment.address,
      logIndex: 3,
      topics: encodeEventTopics({
        abi: seaportEventAbi,
        eventName: "OrderFulfilled",
        args: { offerer: order.maker, zone: zeroAddress }
      }) as TransactionReceipt["logs"][number]["topics"],
      data: encodeAbiParameters(
        abi.inputs.filter((input) => !("indexed" in input && input.indexed)),
        [
          order.orderHash,
          side === "listing" ? buyer.address : seller.address,
          item.order.offer.map((entry) => ({
            itemType: entry.itemType,
            token: entry.token,
            identifier: entry.identifierOrCriteria,
            amount: entry.startAmount
          })),
          item.order.consideration.map((entry) => ({
            itemType: entry.itemType,
            token: entry.token,
            identifier: entry.identifierOrCriteria,
            amount: entry.startAmount,
            recipient: entry.recipient
          }))
        ]
      )
    };
    const transfer = {
      ...meta,
      address: order.asset.contractAddress,
      logIndex: 2,
      data: "0x" as Hex,
      topics: encodeEventTopics({
        abi: erc721Abi,
        eventName: "Transfer",
        args: {
          from: seller.address,
          to: buyer.address,
          tokenId: BigInt(order.asset.tokenId)
        }
      }) as TransactionReceipt["logs"][number]["topics"]
    };
    return {
      ...meta,
      to: seaportDeployment.address,
      from: zeroAddress,
      contractAddress: null,
      cumulativeGasUsed: 100n,
      gasUsed: 100n,
      effectiveGasPrice: 1n,
      logsBloom: "0x",
      status: "success",
      type: "eip1559",
      logs: state.omitTransfer ? [fulfillment] : [transfer, fulfillment]
    };
  };
  const ranges: [bigint, bigint][] = [];
  const client = {
    async getChainId() {
      return state.wrongChain ? 1 : 56;
    },
    async getBlock(args: { blockNumber?: bigint }) {
      if (state.rpcFailure) throw new Error("fixture RPC failure");
      return block(args.blockNumber ?? state.head);
    },
    async getCode() {
      await state.onCode();
      return state.code;
    },
    async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
      await state.beforeLogs();
      ranges.push([args.fromBlock, args.toBlock]);
      if (args.fromBlock > state.saleBlock || args.toBlock < state.saleBlock)
        return [];
      const logs = parseEventLogs({
        abi: seaportEventAbi,
        eventName: "OrderFulfilled",
        logs: receipt().logs,
        strict: true
      });
      return state.duplicateLog ? [...logs, ...logs] : logs;
    },
    async getTransactionReceipt() {
      if (state.receiptFailure) throw new Error("fixture receipt failure");
      const value = receipt();
      await state.afterReceipt();
      return value;
    }
  } as unknown as PublicClient;
  return {
    item,
    state,
    client,
    receipt,
    ranges,
    replay: (
      options: ConstructorParameters<typeof BnbSaleReplay>[3] = {}
    ) => new BnbSaleReplay(db.runtime, client, () => now, options)
  };
}
const checkpoint = async () =>
  (
    await db.owner.query(
      `SELECT *,block_number::text FROM yunipals_market.checkpoint WHERE ${where}`
    )
  ).rows[0];
const sales = async () =>
  (
    await db.owner.query(
      "SELECT observation,canonical FROM yunipals_market.sale WHERE chain_id=56 ORDER BY block_hash"
    )
  ).rows;

test("native and WBNB receipt proof commits atomically and resumes without duplicate sales", async () => {
  for (const side of ["listing", "offer"] as const) {
    const f = await fixture(side);
    assert.equal(await f.replay().tick(), "advanced");
    const rows = await sales();
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].observation.kind,
      side === "listing" ? "listing-filled" : "offer-accepted"
    );
    assert.equal(rows[0].observation.nftRecipient, buyer.address);
    assert.equal(rows[0].canonical, true);
    assert.equal((await checkpoint()).state, "available");
    assert.equal((await checkpoint()).block_number, "125");
    assert.equal((await checkpoint()).coverage_start, "120");
    const retained = (
      await db.runtime.query(
        "SELECT receipt,confirmation_policy FROM yunipals_market.sale_receipt"
      )
    ).rows;
    assert.equal(retained.length, 1);
    assert.equal(retained[0].receipt.blockNumber, "123");
    assert.equal(
      retained[0].confirmation_policy,
      "bnb-local-validation-depth-20-v1"
    );
    // Recreating the service has no in-memory cursor to lose.
    assert.equal(await f.replay().tick(), "idle");
    f.state.head = 149n;
    assert.equal(await f.replay().tick(), "advanced");
    assert.equal((await sales()).length, 1);
    assert.deepEqual(f.ranges, [
      [120n, 125n],
      [126n, 129n]
    ]);
    await db.owner.query(
      "DELETE FROM yunipals_market.sale; DELETE FROM yunipals_market.sale_receipt; DELETE FROM yunipals_market.activity_block"
    );
    await db.clear();
    await db.owner.query(
      `UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL WHERE ${where}`
    );
  }
});

test("unconfirmed sales wait for depth and RPC failures preserve the durable cursor", async () => {
  const f = await fixture();
  f.state.head = 142n;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, "122");
  f.state.head = 143n;
  f.state.receiptFailure = true;
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, "122");
  assert.equal((await sales()).length, 0);
  f.state.receiptFailure = false;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 1);
});

test("finalized replay idles after completing its captured boundary while BNB advances", async () => {
  const f = await fixture();
  f.state.beforeLogs = async () => {
    f.state.head += 3n;
  };
  assert.equal(
    await f
      .replay({
        finality: "finalized",
        confirmationPolicy: "bnb-finalized-tag-v1"
      })
      .tick(),
    "idle"
  );
  assert.equal((await checkpoint()).state, "available");
  assert.equal((await checkpoint()).block_number, "145");
  assert.deepEqual(f.ranges, [[120n, 145n]]);
});

test("missing transfer, wrong chain and changed deployment cannot publish sale proof", async () => {
  const f = await fixture();
  f.state.omitTransfer = true;
  assert.equal(await f.replay().tick(), "unavailable");
  f.state.omitTransfer = false;
  f.state.wrongChain = true;
  assert.equal(await f.replay().tick(), "unavailable");
  f.state.wrongChain = false;
  f.state.code = "0x1234";
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, null);
  assert.equal(
    (await db.owner.query("SELECT count(*) FROM yunipals_market.sale_receipt"))
      .rows[0].count,
    "0"
  );
});

test("reorg retracts orphaned records, invalidates pages and replays from a retained canonical anchor", async () => {
  const f = await fixture();
  f.state.head = 142n;
  await f.replay().tick(); // canonical anchor 122, before the sale
  f.state.head = 145n;
  await f.replay().tick();
  await db.runtime.query(
    `INSERT INTO yunipals_market.snapshot(id,kind,query_key,header,observed_at,expires_at,row_count)
    VALUES($1,'activity','fixture','{}',clock_timestamp(),clock_timestamp()+interval '1 minute',1)`,
    [randomUUID()]
  );
  f.state.branch = 1;
  f.state.forkFrom = 123n;
  const epoch = BigInt((await checkpoint()).canonical_generation);
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal(BigInt((await checkpoint()).canonical_generation), epoch + 1n);
  assert.equal((await checkpoint()).block_number, "122");
  assert.equal((await sales())[0].canonical, false);
  assert.ok(
    (
      await db.runtime.query(
        "SELECT invalidated_at FROM yunipals_market.snapshot WHERE kind='activity'"
      )
    ).rows[0].invalidated_at
  );
  assert.equal(await f.replay().tick(), "advanced");
  const rows = await sales();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.canonical).length, 1);
  assert.notEqual(rows[0].observation.eventId, rows[1].observation.eventId);
  assert.equal(
    (
      await db.runtime.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt"
      )
    ).rows[0].count,
    "2"
  );
});

test("a deep reorg without a retained anchor resets coverage and replays all admitted history", async () => {
  const f = await fixture();
  await f.replay().tick();
  f.state.branch = 2;
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal((await checkpoint()).coverage_start, null);
  assert.equal((await checkpoint()).replay_from, "120");
  assert.equal((await sales())[0].canonical, false);
  assert.equal(await f.replay().tick(), "advanced");
  assert.deepEqual(f.ranges, [
    [120n, 125n],
    [120n, 125n]
  ]);
});

test("admission during receipt verification fences the old scan and forces complete replay", async () => {
  const f = await fixture();
  f.state.afterReceipt = async () => {
    f.state.afterReceipt = async () => {};
    const concurrent = await db.setup("offer");
    const preparation = await concurrent.service.prepare(concurrent.draft);
    await concurrent.service.submit({
      ...concurrent.request,
      preparationId: preparation.id
    });
  };
  assert.equal(await f.replay().tick(), "superseded");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal((await sales()).length, 0);
  assert.equal(await f.replay().tick(), "advanced");
  const later = await db.setup("offer");
  const preparation = await later.service.prepare(later.draft);
  await later.service.submit({
    ...later.request,
    preparationId: preparation.id
  });
  assert.equal((await checkpoint()).replay_from, "121");
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 1);
});

test("legacy orders without original admission evidence cannot yield complete activity", async () => {
  const f = await fixture();
  await db.owner.query(
    "UPDATE yunipals_market.orders SET admission_block_number=NULL,admission_block_hash=NULL WHERE order_hash=$1",
    [f.item.input.hash.toLowerCase()]
  );
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).state, "unavailable");
  assert.equal(
    (await checkpoint()).last_error_code,
    "admission_coverage_missing"
  );
});

test("two concurrent replay workers cannot commit the same checkpoint generation", async () => {
  const f = await fixture();
  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.state.beforeLogs = async () => {
    arrivals++;
    if (arrivals === 2) release();
    await barrier;
  };
  const results = await Promise.all([f.replay().tick(), f.replay().tick()]);
  assert.deepEqual(results.sort(), ["advanced", "superseded"]);
  assert.equal((await sales()).length, 1);
});

test("a reorg during receipt verification discards the entire uncommitted scan", async () => {
  const f = await fixture();
  f.state.afterReceipt = async () => {
    f.state.branch = 1;
  };
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, null);
});

test("duplicate RPC events and conflicting retained proof cannot advance coverage", async () => {
  const f = await fixture();
  f.state.duplicateLog = true;
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  f.state.duplicateLog = false;
  assert.equal(await f.replay().tick(), "advanced");
  await db.owner.query(
    "UPDATE yunipals_market.sale SET canonical=false,observation=jsonb_set(observation,'{grossAmount}','\"1\"') WHERE chain_id=56"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL WHERE ${where}`
  );
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal(
    (await db.owner.query("SELECT count(*) FROM yunipals_market.sale_receipt"))
      .rows[0].count,
    "0",
    "Receipt insertion rolls back with a conflicting sale observation"
  );
});

test("a replacement branch can confirm a fill before its original admission height", async () => {
  const f = await fixture();
  assert.equal(await f.replay().tick(), "advanced");
  f.state.branch = 2;
  f.state.saleBlock = 120n; // original admission observed block 121
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal(await f.replay().tick(), "advanced");
  const current = (await sales()).filter((row) => row.canonical);
  assert.equal(current.length, 1);
  assert.equal(current[0].observation.blockNumber, "120");
  assert.equal((await checkpoint()).state, "available");
});
