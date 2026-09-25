import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, afterEach, test } from "node:test";
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
import {
  observeCollectionSale,
  observeCollectionSales,
  UnsupportedCollectionSaleError,
  type SaleBlock
} from "@protopals/yunipals-market-core/settledSale";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import {
  openseaCurrencies,
  type OpenSeaChain
} from "@protopals/yunipals-market-core/openseaRegistry";
import { CollectionSaleReplay } from "@/activity/collectionReplay";
import { RpcResponseLimitError } from "@/opensea/readRpc";
import { ActivityReadService } from "@/reads/activity";
import {
  parseActivityPage,
  type ActivityScope
} from "@protopals/yunipals-market-core/activity";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import {
  admissionFixture,
  buyer,
  seller,
  fixtureNow,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";

const db = createBnbTestDatabase();
const where =
  "source='chain' AND chain_id IN (1,137,8453) AND name='seaport-sales'";
const hashes = (number: bigint, branch = 0) =>
  `0x${(number + BigInt(branch) * 1000000n).toString(16).padStart(64, "0")}` as Hex;
let saved: unknown[] = [];
let ready = false;
before(async () => {
  await db.initialize();
  for (const table of [
    "sale",
    "sale_receipt",
    "sale_exclusion",
    "activity_block",
    "sale_replay_config"
  ])
    assert.equal(
      (
        await db.owner.query(
          `SELECT count(*) FROM yunipals_market.${table} WHERE chain_id IN (1,137,8453)`
        )
      ).rows[0].count,
      "0"
    );
  saved = (
    await db.owner.query(
      `SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE ${where}`
    )
  ).rows.map((r) => r.value);
  await db.owner.query(
    "GRANT SELECT ON yunipals_market.sale_replay_config TO market_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.sale_exclusion TO market_test_runtime"
  );
  ready = true;
});
afterEach(async () => {
  if (!ready) return;
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  for (const table of [
    "sale_exclusion",
    "sale",
    "sale_receipt",
    "activity_block",
    "sale_replay_config"
  ])
    await db.owner.query(
      `DELETE FROM yunipals_market.${table} WHERE chain_id IN (1,137,8453)`
    );
  await db.owner.query(`DELETE FROM yunipals_market.checkpoint WHERE ${where}`);
  for (const row of saved)
    await db.owner.query(
      "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
      [JSON.stringify(row)]
    );
});
after(async () => {
  await db.close();
});
async function fixture(
  chain: OpenSeaChain = "ethereum",
  side: "listing" | "offer" = "listing",
  weth = false
) {
  const item = await admissionFixture(
    chain,
    side,
    123n,
    7n,
    weth ? openseaCurrencies[chain].address : zeroAddress
  );
  const order = item.intent.summary;
  await db.owner.query(
    "INSERT INTO yunipals_market.sale_replay_config(chain_id,start_block,confirmations,policy) VALUES($1,122,20,$2)",
    [marketplaceChains[chain].chainId, `test-${chain}-depth-20`]
  );
  const state = {
    head: 145n,
    timestampOffset: 0n,
    branch: 0,
    forkFrom: 0n,
    saleBlock: 123n,
    rpcFailure: false,
    wrongChain: false,
    code: item.state.code,
    bundle: false,
    receiptFailure: false,
    omitTransfer: false,
    withoutSeaport: false,
    duplicateLog: false,
    blockReads: 0,
    codeReads: 0,
    afterReceipt: async () => {},
    onCode: async () => {},
    beforeLogs: async () => {}
  };
  const block = (number: bigint) => ({
    number,
    hash: hashes(number, number >= state.forkFrom ? state.branch : 0),
    timestamp: fixtureTimestamp + number - 145n + state.timestampOffset
  });
  const receipt = (scan = false): TransactionReceipt => {
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
          (state.bundle
            ? [...item.input.order.offer, item.input.order.offer[0]!]
            : item.input.order.offer
          ).map((entry) => ({
            itemType: entry.itemType,
            token: entry.token,
            identifier: entry.identifierOrCriteria,
            amount: entry.startAmount
          })),
          item.input.order.consideration.map((entry) => ({
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
      logs: state.withoutSeaport
        ? [transfer]
        : state.omitTransfer && !scan
          ? [fulfillment]
          : [transfer, fulfillment]
    };
  };
  const ranges: [bigint, bigint][] = [];
  const client = {
    async getChainId() {
      return state.wrongChain ? 56 : marketplaceChains[chain].chainId;
    },
    async getBlock(args: { blockNumber?: bigint }) {
      if (state.rpcFailure) throw new Error("fixture RPC failure");
      state.blockReads++;
      return block(args.blockNumber ?? state.head);
    },
    async getCode() {
      state.codeReads++;
      await state.onCode();
      return state.code;
    },
    async getLogs(args: { fromBlock: bigint; toBlock: bigint }) {
      await state.beforeLogs();
      ranges.push([args.fromBlock, args.toBlock]);
      if (args.fromBlock > state.saleBlock || args.toBlock < state.saleBlock)
        return [];
      const logs = parseEventLogs({
        abi: erc721Abi,
        eventName: "Transfer",
        logs: receipt(true).logs,
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
    replay: () =>
      new CollectionSaleReplay(db.runtime, client, chain, () => fixtureNow)
  };
}
const checkpoint = async (chain: OpenSeaChain = "ethereum") =>
  (
    await db.owner.query(
      "SELECT *,block_number::text FROM yunipals_market.checkpoint WHERE source='chain' AND name='seaport-sales' AND chain_id=$1",
      [marketplaceChains[chain].chainId]
    )
  ).rows[0];
const sales = async () =>
  (
    await db.owner.query(
      "SELECT * FROM yunipals_market.sale WHERE chain_id IN (1,137,8453) ORDER BY block_hash"
    )
  ).rows;

for (const chain of ["ethereum", "base", "polygon"] as const) {
  for (const [side, weth] of [
    ["listing", false],
    ["listing", true],
    ["offer", true]
  ] as const) {
    test(`${chain} ${side} ${weth ? "wrapped" : "native"} replay stores a sale without admitted or discovered orders and resumes`, async () => {
      const f = await fixture(chain, side, weth);
      const replay = f.replay();
      assert.equal(await replay.tick(), "advanced");
      const rows = await sales();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].observation.asset.chain, chain);
      assert.equal(
        rows[0].observation.grossAmount,
        f.item.intent.summary.grossAmount
      );
      assert.equal(rows[0].canonical, true);
      assert.equal((await checkpoint(chain)).block_number, "125");
      assert.equal((await checkpoint(chain)).state, "available");
      const scope: ActivityScope = {
        kind: "wallet",
        chain,
        wallet: seller.address,
        view: "sales"
      };
      const page = parseActivityPage(
        await new ActivityReadService(db.runtime).wallet(
          seller.address,
          new URLSearchParams({ chain, view: "sales" })
        ),
        scope
      );
      assert.equal(page.total, 1);
      assert.equal(
        page.items[0]!.sale.orderHash.toLowerCase(),
        rows[0].order_hash
      );
      assert.equal(page.chains[chain]?.coverage?.source, "seaport");
      assert.equal(page.chains[chain]?.coverage?.fromBlock, "122");
      const beforeIdle = {
        blocks: f.state.blockReads,
        code: f.state.codeReads,
        ranges: f.ranges.length
      };
      assert.equal(await replay.tick(), "idle");
      assert.equal(f.state.blockReads, beforeIdle.blocks + 1);
      assert.equal(f.state.codeReads, beforeIdle.code);
      assert.equal(f.ranges.length, beforeIdle.ranges);
      assert.equal((await sales()).length, 1);
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.orders WHERE order_hash=$1",
            [rows[0].order_hash]
          )
        ).rows[0].count,
        "0"
      );
    });
  }
}

test("a confirmed sale wakes the exact discovered order projection for delisting", async () => {
  const f = await fixture("ethereum", "listing");
  const order = f.item.intent.summary;
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_discovered_order
      (chain_id,protocol_address,order_hash,contract_address,side,token_id,maker,classification,
        provider_status,components,signature,provider_observation,last_seen_run_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'item','ACTIVE',$8,$9,$10,$11)`,
    [
      order.asset.chainId,
      seaportDeployment.address.toLowerCase(),
      order.orderHash.toLowerCase(),
      order.asset.contractAddress.toLowerCase(),
      order.side,
      order.asset.tokenId,
      order.maker.toLowerCase(),
      JSON.stringify(f.item.draft.order),
      f.item.signature,
      JSON.stringify({ source: "sale-wakeup-test" }),
      randomUUID()
    ]
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.opensea_discovered_state(chain_id,protocol_address,order_hash,next_reconcile_at)
    VALUES($1,$2,$3,clock_timestamp()+interval '1 day')`,
    [
      order.asset.chainId,
      seaportDeployment.address.toLowerCase(),
      order.orderHash.toLowerCase()
    ]
  );
  try {
    assert.equal(await f.replay().tick(), "advanced");
    const due = await db.owner.query<{ due: boolean }>(
      `SELECT next_reconcile_at<=clock_timestamp() AS due
      FROM yunipals_market.opensea_discovered_state WHERE chain_id=$1 AND order_hash=$2`,
      [order.asset.chainId, order.orderHash.toLowerCase()]
    );
    assert.equal(due.rows[0]?.due, true);
  } finally {
    await db.owner.query(
      "DELETE FROM yunipals_market.opensea_discovered_state WHERE chain_id=$1 AND order_hash=$2",
      [order.asset.chainId, order.orderHash.toLowerCase()]
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.opensea_discovered_order WHERE chain_id=$1 AND order_hash=$2",
      [order.asset.chainId, order.orderHash.toLowerCase()]
    );
  }
});

test("collection transfer discovery covers a sparse 8192-block range without protocol-wide scans", async () => {
  const f = await fixture();
  f.state.head = 10000n;
  f.state.timestampOffset = 145n - f.state.head;
  const getLogs = f.client.getLogs;
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    assert.ok(args);
    assert.equal(args.address, marketplaceChains.ethereum.contractAddress);
    assert.equal(args.event?.name, "Transfer");
    return getLogs(args);
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "advanced");
  assert.deepEqual(f.ranges, [[122n, 8313n]]);
  assert.equal((await checkpoint()).block_number, "8313");
  assert.equal((await sales()).length, 1);
});

test("wire response pressure shrinks collection scans and a single oversized block preserves the cursor", async () => {
  const f = await fixture();
  f.state.head = 10000n;
  f.state.timestampOffset = 145n - f.state.head;
  const getLogs = f.client.getLogs;
  const attempts: bigint[] = [];
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    assert.ok(args && typeof args.toBlock === "bigint");
    attempts.push(args.toBlock);
    if (args.toBlock > 5000n)
      throw new Error("wrapped transport error", {
        cause: new RpcResponseLimitError()
      });
    return getLogs(args);
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "advanced");
  assert.deepEqual(attempts, [8313n, 4217n]);
  assert.equal((await checkpoint()).block_number, "4217");
  f.client.getLogs = (async () => {
    throw new RpcResponseLimitError();
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, "4217");
  assert.equal((await sales()).length, 1);
});

test("one worker retains a smaller scan range through a dense period and probes bounded growth", async () => {
  const f = await fixture();
  f.state.head = 10000n;
  f.state.timestampOffset = 145n - f.state.head;
  const getLogs = f.client.getLogs;
  const spans: bigint[] = [];
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    assert.ok(
      args &&
        typeof args.toBlock === "bigint" &&
        typeof args.fromBlock === "bigint"
    );
    const span = args.toBlock - args.fromBlock + 1n;
    spans.push(span);
    if (span > 64n) throw new RpcResponseLimitError();
    return getLogs(args);
  }) as PublicClient["getLogs"];
  const worker = f.replay();
  assert.equal(await worker.tick(), "advanced");
  assert.equal(spans[0], 8192n);
  assert.equal((await checkpoint()).block_number, "185");
  spans.length = 0;
  assert.equal(await worker.tick(), "advanced");
  assert.deepEqual(spans, [128n, 64n]);
  assert.equal((await checkpoint()).block_number, "249");
  assert.equal((await sales()).length, 1);
});

test("ordinary collection transfers establish scanned coverage without fabricating a sale or exclusion", async () => {
  const f = await fixture();
  f.state.withoutSeaport = true;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await checkpoint()).state, "available");
  assert.equal((await sales()).length, 0);
  for (const table of ["sale_receipt", "sale_exclusion"])
    assert.equal(
      (
        await db.owner.query(
          `SELECT count(*) FROM yunipals_market.${table} WHERE chain_id=1`
        )
      ).rows[0].count,
      "0"
    );
});

test("receipt-count pressure shrinks the range without skipping its unscanned tail", async () => {
  const f = await fixture();
  f.state.head = 10000n;
  f.state.timestampOffset = 145n - f.state.head;
  const getLogs = f.client.getLogs;
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    const logs = await getLogs(args);
    assert.ok(args && typeof args.toBlock === "bigint");
    if (args.toBlock < 6200n) return logs;
    return [
      ...logs,
      ...Array.from({ length: 32 }, (_, i) => ({
        ...logs[0]!,
        blockNumber: 6150n + BigInt(i),
        blockHash: hashes(6150n + BigInt(i)),
        transactionHash: hashes(1000n + BigInt(i)),
        logIndex: i
      }))
    ];
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "advanced");
  assert.deepEqual(f.ranges, [
    [122n, 8313n],
    [122n, 4217n]
  ]);
  assert.equal((await checkpoint()).block_number, "4217");
  assert.equal((await sales()).length, 1);
});

test("a single block exceeding both discovery capacities and duplicated scan logs fail without advancing", async () => {
  const f = await fixture();
  f.state.head = 143n;
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=123 WHERE chain_id=1"
  );
  const getLogs = f.client.getLogs;
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    const logs =
      args?.event?.name === "OrderFulfilled"
        ? parseEventLogs({
            abi: seaportEventAbi,
            eventName: "OrderFulfilled",
            logs: f.receipt(true).logs,
            strict: true
          })
        : await getLogs(args);
    return Array.from({ length: 513 }, (_, i) => ({
      ...logs[0]!,
      logIndex: i
    }));
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  f.client.getLogs = getLogs;
  f.state.duplicateLog = true;
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal((await sales()).length, 0);
});

for (const pressure of ["receipts", "logs", "wire"] as const)
  test(`a single block with dense ${pressure} discovers sales through canonical Seaport receipts`, async () => {
    const f = await fixture();
    f.state.head = 143n;
    await db.owner.query(
      "UPDATE yunipals_market.sale_replay_config SET start_block=123 WHERE chain_id=1"
    );
    const scanned: string[] = [];
    let receiptReads = 0;
    const readReceipt = f.client.getTransactionReceipt;
    f.client.getTransactionReceipt = (async (args) => {
      receiptReads++;
      return readReceipt(args);
    }) as PublicClient["getTransactionReceipt"];
    f.client.getLogs = (async (
      args: Parameters<PublicClient["getLogs"]>[0]
    ) => {
      assert.ok(args);
      assert.equal(args.fromBlock, 123n);
      assert.equal(args.toBlock, 123n);
      scanned.push(args.event!.name);
      if (args.event!.name === "OrderFulfilled") {
        assert.equal(args.address, seaportDeployment.address);
        return parseEventLogs({
          abi: seaportEventAbi,
          eventName: "OrderFulfilled",
          logs: f.receipt(true).logs,
          strict: true
        });
      }
      assert.equal(args.address, marketplaceChains.ethereum.contractAddress);
      if (pressure === "wire") throw new RpcResponseLimitError();
      const transfer = f.receipt(true).logs[0]!;
      return Array.from(
        { length: pressure === "receipts" ? 45 : 513 },
        (_, i) => ({
          ...transfer,
          logIndex: i,
          transactionHash:
            pressure === "receipts"
              ? hashes(2000n + BigInt(i))
              : transfer.transactionHash
        })
      );
    }) as PublicClient["getLogs"];
    assert.equal(await f.replay().tick(), "advanced");
    assert.deepEqual(scanned, ["Transfer", "OrderFulfilled"]);
    assert.equal(receiptReads, 1);
    assert.equal((await checkpoint()).block_number, "123");
    assert.equal((await sales()).length, 1);
    assert.equal(await f.replay().tick(), "idle");
    assert.equal((await sales()).length, 1);
  });

test("single-block protocol discovery preserves exclusions and rejects a receipt missing its NFT transfer", async () => {
  const f = await fixture();
  f.state.head = 143n;
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=123 WHERE chain_id=1"
  );
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    assert.ok(args);
    if (args.event!.name === "Transfer") throw new RpcResponseLimitError();
    return parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: f.receipt(true).logs,
      strict: true
    });
  }) as PublicClient["getLogs"];
  f.state.omitTransfer = true;
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal((await sales()).length, 0);
  f.state.omitTransfer = false;
  f.state.bundle = true;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await checkpoint()).block_number, "123");
  assert.equal((await sales()).length, 0);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_exclusion WHERE chain_id=1 AND canonical"
      )
    ).rows[0].count,
    "1"
  );
});

test("dense mint-only blocks advance only after the protocol scan and runtime are verified", async () => {
  const f = await fixture();
  f.state.head = 143n;
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=123 WHERE chain_id=1"
  );
  let protocolFailure = true;
  f.client.getLogs = (async (args: Parameters<PublicClient["getLogs"]>[0]) => {
    assert.ok(args);
    if (args.event!.name === "Transfer") throw new RpcResponseLimitError();
    if (protocolFailure) throw new RpcResponseLimitError();
    return [];
  }) as PublicClient["getLogs"];
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  protocolFailure = false;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await checkpoint()).block_number, "123");
  assert.equal((await sales()).length, 0);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_exclusion WHERE chain_id=1"
      )
    ).rows[0].count,
    "0"
  );
});

test("unconfirmed blocks wait, and wrong-chain/runtime/receipt failures preserve the durable cursor", async () => {
  const f = await fixture();
  f.state.head = 142n;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, "122");
  f.state.head = 145n;
  for (const flag of [
    "wrongChain",
    "receiptFailure",
    "omitTransfer",
    "rpcFailure"
  ] as const) {
    f.state[flag] = true;
    assert.equal(await f.replay().tick(), "unavailable", flag);
    assert.equal((await checkpoint()).block_number, "122");
    f.state[flag] = false;
  }
  const code = f.state.code;
  f.state.code = "0x6001";
  assert.equal(await f.replay().tick(), "unavailable");
  f.state.code = code;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 1);
});

test("reorg retracts orphaned receipts and sales, then replays without losing historical proofs", async () => {
  const f = await fixture();
  f.state.head = 142n;
  assert.equal(await f.replay().tick(), "advanced");
  f.state.head = 145n;
  assert.equal(await f.replay().tick(), "advanced");
  f.state.branch = 1;
  f.state.forkFrom = 123n;
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal((await checkpoint()).block_number, "122");
  assert.equal((await sales())[0].canonical, false);
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).filter((r) => r.canonical).length, 1);
  assert.equal((await sales()).length, 2);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=1"
      )
    ).rows[0].count,
    "2"
  );
});

test("unsupported collection bundles retain explicit partial coverage instead of invented prices", async () => {
  const f = await fixture();
  f.state.bundle = true;
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).state, "unavailable");
  assert.equal((await checkpoint()).last_error_code, "unsupported_sale_events");
  const partialScope: ActivityScope = {
    kind: "wallet",
    wallet: seller.address,
    chain: "ethereum",
    view: "sales"
  };
  const partial = parseActivityPage(
    await new ActivityReadService(db.runtime).wallet(
      seller.address,
      new URLSearchParams({ chain: "ethereum", view: "sales" })
    ),
    partialScope
  );
  assert.equal(partial.total, null);
  assert.equal(partial.chains.ethereum?.coverage?.excludedEvents, 1);
  assert.equal(partial.chains.ethereum?.status, "unavailable");
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_exclusion WHERE chain_id=1 AND canonical"
      )
    ).rows[0].count,
    "1"
  );
  f.state.branch = 1;
  f.state.forkFrom = 0n;
  f.state.bundle = false;
  assert.equal(await f.replay().tick(), "rewound");
  assert.equal(await f.replay().tick(), "advanced");
  assert.equal((await checkpoint()).state, "available");
  assert.equal((await sales()).filter((r) => r.canonical).length, 1);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_exclusion WHERE chain_id=1 AND canonical"
      )
    ).rows[0].count,
    "0"
  );
});

test("historical matched bid/counter-order events preserve both exclusions and advance without inventing seller proceeds", async () => {
  // Ethereum transaction faa25b9f...3ebda1bb: two matched orders share one NFT
  // transfer, and the creator payment appears only in the counter-order.
  const bigintFields = new Set([
    "blockNumber",
    "number",
    "timestamp",
    "cumulativeGasUsed",
    "gasUsed",
    "effectiveGasPrice"
  ]);
  const proof = JSON.parse(
    await readFile(
      new URL("./fixtures/ethereum-matched-orders.json", import.meta.url),
      "utf8"
    ),
    (key, value: unknown) =>
      typeof value === "string" && bigintFields.has(key) ? BigInt(value) : value
  ) as { receipt: TransactionReceipt; block: SaleBlock };
  for (const index of [234, 235])
    assert.throws(
      () =>
        observeCollectionSale("ethereum", proof.receipt, proof.block, index),
      UnsupportedCollectionSaleError
    );
  const f = await fixture();
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=$1 WHERE chain_id=1",
    [(proof.block.number - 1n).toString()]
  );
  const head = proof.block.number + 21n;
  const client = {
    ...f.client,
    async getBlock({ blockNumber = head }: { blockNumber?: bigint }) {
      return {
        number: blockNumber,
        hash:
          blockNumber === proof.block.number
            ? proof.block.hash
            : hashes(blockNumber),
        timestamp: proof.block.timestamp + blockNumber - proof.block.number
      };
    },
    async getLogs({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      return fromBlock <= proof.block.number && toBlock >= proof.block.number
        ? parseEventLogs({
            abi: erc721Abi,
            eventName: "Transfer",
            logs: proof.receipt.logs,
            strict: true
          })
        : [];
    },
    async getTransactionReceipt() {
      return proof.receipt;
    }
  } as unknown as PublicClient;
  const replay = () =>
    new CollectionSaleReplay(
      db.runtime,
      client,
      "ethereum",
      () => Number(proof.block.timestamp + 21n) * 1000
    );
  assert.equal(await replay().tick(), "advanced");
  assert.equal((await checkpoint()).block_number, (head - 20n).toString());
  assert.equal((await checkpoint()).last_error_code, "unsupported_sale_events");
  assert.equal((await sales()).length, 0);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_exclusion WHERE chain_id=1 AND canonical"
      )
    ).rows[0].count,
    "2"
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=1"
      )
    ).rows[0].count,
    "1"
  );
  assert.equal(await replay().tick(), "idle");
});

test("eight historical fills of one order in one receipt retain distinct NFT sales and recover together", async () => {
  const bigintFields = new Set([
    "blockNumber",
    "number",
    "timestamp",
    "cumulativeGasUsed",
    "gasUsed",
    "effectiveGasPrice"
  ]);
  const proof = JSON.parse(
    await readFile(
      new URL("./fixtures/polygon-repeated-fills.json", import.meta.url),
      "utf8"
    ),
    (key, value: unknown) =>
      typeof value === "string" && bigintFields.has(key) ? BigInt(value) : value
  ) as { receipt: TransactionReceipt; block: SaleBlock };
  const indices = Array.from({ length: 8 }, (_, i) => 512 + i);
  const parsed = indices.map(
    (index) =>
      observeCollectionSale("polygon", proof.receipt, proof.block, index)!
  );
  assert.equal(new Set(parsed.map((sale) => sale.orderHash)).size, 1);
  assert.equal(new Set(parsed.map((sale) => sale.eventId)).size, 8);
  assert.equal(new Set(parsed.map((sale) => sale.asset.tokenId)).size, 8);
  assert.equal(new Set(parsed.map((sale) => sale.transferLogIndex)).size, 8);
  assert.ok(
    parsed.every(
      (sale) =>
        sale.grossAmount === "100000000000000" &&
        sale.sellerProceeds === "99500000000000" &&
        sale.fees.length === 1 &&
        sale.fees[0]!.amount === "500000000000"
    )
  );
  assert.throws(() =>
    observeCollectionSale("polygon", proof.receipt, proof.block, 520)
  );
  assert.throws(() =>
    observeCollectionSale(
      "polygon",
      {
        ...proof.receipt,
        logs: [
          ...proof.receipt.logs,
          proof.receipt.logs.find((log) => log.logIndex === 512)!
        ]
      },
      proof.block,
      512
    )
  );
  const missingTransfer = {
    ...proof.receipt,
    logs: proof.receipt.logs.filter(
      (log) => log.logIndex !== parsed[0]!.transferLogIndex
    )
  };
  assert.throws(() =>
    observeCollectionSale("polygon", missingTransfer, proof.block, 512)
  );
  const f = await fixture("polygon");
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=$1 WHERE chain_id=137",
    [(proof.block.number - 1n).toString()]
  );
  const head = proof.block.number + 20n;
  let orphan = false;
  const client = {
    ...f.client,
    async getBlock({ blockNumber = head }: { blockNumber?: bigint }) {
      return {
        number: blockNumber,
        hash:
          blockNumber === proof.block.number && !orphan
            ? proof.block.hash
            : hashes(blockNumber, orphan ? 1 : 0),
        timestamp: proof.block.timestamp + blockNumber - proof.block.number
      };
    },
    async getLogs({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      return !orphan &&
        fromBlock <= proof.block.number &&
        toBlock >= proof.block.number
        ? parseEventLogs({
            abi: erc721Abi,
            eventName: "Transfer",
            logs: proof.receipt.logs,
            strict: true
          })
        : [];
    },
    async getTransactionReceipt() {
      return proof.receipt;
    }
  } as unknown as PublicClient;
  const replay = () =>
    new CollectionSaleReplay(
      db.runtime,
      client,
      "polygon",
      () => Number(proof.block.timestamp + 20n) * 1000
    );
  assert.equal(await replay().tick(), "advanced");
  assert.equal((await sales()).length, 8);
  const scope: ActivityScope = {
    kind: "wallet",
    wallet: parsed[0]!.seller,
    chain: "polygon",
    view: "sales"
  };
  const activity = async () =>
    parseActivityPage(
      await new ActivityReadService(db.runtime).wallet(
        scope.wallet,
        new URLSearchParams({ chain: "polygon", view: "sales" })
      ),
      scope
    );
  assert.equal((await activity()).items.length, 8);
  assert.equal(await replay().tick(), "idle");
  assert.equal((await sales()).length, 8);
  orphan = true;
  assert.equal(await replay().tick(), "rewound");
  assert.equal(await replay().tick(), "advanced");
  assert.equal((await sales()).filter((sale) => sale.canonical).length, 0);
  assert.equal((await activity()).items.length, 0);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=137"
      )
    ).rows[0].count,
    "1"
  );
});

test("134 historical fills use bounded receipt batches and preserve atomic proof-conflict recovery", async () => {
  const bigintFields = new Set([
    "blockNumber",
    "number",
    "timestamp",
    "cumulativeGasUsed",
    "gasUsed",
    "effectiveGasPrice"
  ]);
  const { proofs } = JSON.parse(
    await readFile(
      new URL("./fixtures/ethereum-bulk-fills.json", import.meta.url),
      "utf8"
    ),
    (key, value: unknown) =>
      typeof value === "string" && bigintFields.has(key) ? BigInt(value) : value
  ) as { proofs: { receipt: TransactionReceipt; block: SaleBlock }[] };
  const first = proofs[0]!,
    last = proofs.at(-1)!;
  const batches = proofs.map(({ receipt, block }) => {
    const indices = parseEventLogs({
      abi: seaportEventAbi,
      eventName: "OrderFulfilled",
      logs: receipt.logs,
      strict: true
    }).map((log) => log.logIndex!);
    const batch = observeCollectionSales("ethereum", receipt, block, indices);
    assert.equal(batch.length, indices.length);
    assert.ok(
      batch.every(
        ({ sale }) =>
          sale &&
          sale.grossAmount === "100000000000000" &&
          sale.sellerProceeds === "99000000000000" &&
          sale.fees.length === 1 &&
          sale.fees[0]!.amount === "1000000000000"
      )
    );
    assert.deepEqual(
      batch[0]!.sale,
      observeCollectionSale("ethereum", receipt, block, indices[0]!)
    );
    assert.deepEqual(
      batch.at(-1)!.sale,
      observeCollectionSale("ethereum", receipt, block, indices.at(-1)!)
    );
    assert.throws(() =>
      observeCollectionSales("ethereum", receipt, block, [
        indices[0]!,
        indices[0]!
      ])
    );
    assert.throws(() =>
      observeCollectionSales("ethereum", receipt, block, [999999])
    );
    const finalTransfer = batch.at(-1)!.sale!.transferLogIndex;
    const missing = {
      ...receipt,
      logs: receipt.logs.filter((log) => log.logIndex !== finalTransfer)
    };
    assert.throws(() =>
      observeCollectionSales("ethereum", missing, block, indices)
    );
    const duplicate = {
      ...receipt,
      logs: [
        ...receipt.logs,
        receipt.logs.find((log) => log.logIndex === finalTransfer)!
      ]
    };
    assert.throws(() =>
      observeCollectionSales("ethereum", duplicate, block, indices)
    );
    // A previous successful call must not lend stale decoded evidence to a
    // subsequently altered receipt or an incorrectly bound block.
    assert.throws(() =>
      observeCollectionSales(
        "ethereum",
        receipt,
        { ...block, hash: hashes(999n) },
        indices
      )
    );
    return batch;
  });
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [50, 50, 34]
  );
  assert.equal(
    new Set(
      batches.flatMap((batch) => batch.map(({ sale }) => sale!.asset.tokenId))
    ).size,
    134
  );
  const f = await fixture();
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=$1 WHERE chain_id=1",
    [(first.block.number - 1n).toString()]
  );
  const head = last.block.number + 20n;
  const client = {
    ...f.client,
    async getBlock({ blockNumber = head }: { blockNumber?: bigint }) {
      return (
        proofs.find((proof) => proof.block.number === blockNumber)?.block ?? {
          number: blockNumber,
          hash: hashes(blockNumber),
          timestamp:
            blockNumber < first.block.number
              ? first.block.timestamp - 12n
              : last.block.timestamp + blockNumber - last.block.number
        }
      );
    },
    async getLogs({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      return proofs
        .filter(
          (proof) =>
            proof.block.number >= fromBlock && proof.block.number <= toBlock
        )
        .flatMap((proof) =>
          parseEventLogs({
            abi: erc721Abi,
            eventName: "Transfer",
            logs: proof.receipt.logs,
            strict: true
          })
        );
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      const proof = proofs.find(
        (proof) => proof.receipt.transactionHash === hash
      );
      assert.ok(proof);
      return proof.receipt;
    }
  } as unknown as PublicClient;
  const replay = () =>
    new CollectionSaleReplay(
      db.runtime,
      client,
      "ethereum",
      () => Number(last.block.timestamp + 20n) * 1000
    );
  assert.equal(await replay().tick(), "advanced");
  assert.equal((await sales()).length, 134);
  assert.equal((await checkpoint()).block_number, last.block.number.toString());
  assert.equal(await replay().tick(), "idle");
  const receiptCount = async () =>
    (
      await db.owner.query(
        "SELECT count(*)::int AS count FROM yunipals_market.sale_receipt WHERE chain_id=1"
      )
    ).rows[0].count;
  assert.equal(await receiptCount(), 3);
  // A conflict in the last receipt must roll back earlier writes in this range.
  await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=1");
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=1 AND transaction_hash<>$1",
    [last.receipt.transactionHash]
  );
  await db.owner.query(
    "UPDATE yunipals_market.sale_receipt SET receipt=receipt || '{\"test_conflict\":true}'::jsonb WHERE chain_id=1"
  );
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,state='syncing' WHERE " +
      where
  );
  assert.equal(await replay().tick(), "unavailable");
  assert.equal((await checkpoint()).block_number, null);
  assert.equal((await sales()).length, 0);
  assert.equal(await receiptCount(), 1);
  await db.owner.query(
    "UPDATE yunipals_market.sale_receipt SET receipt=receipt-'test_conflict' WHERE chain_id=1"
  );
  assert.equal(await replay().tick(), "advanced");
  assert.equal((await sales()).length, 134);
  assert.equal(await receiptCount(), 3);
});

test("two historical partial fills of one order retain separate sales, activity and canonical recovery", async () => {
  const bigintFields = new Set([
    "blockNumber",
    "number",
    "timestamp",
    "cumulativeGasUsed",
    "gasUsed",
    "effectiveGasPrice"
  ]);
  const { proofs } = JSON.parse(
    await readFile(
      new URL("./fixtures/ethereum-partial-fills.json", import.meta.url),
      "utf8"
    ),
    (key, value: unknown) =>
      typeof value === "string" && bigintFields.has(key) ? BigInt(value) : value
  ) as {
    proofs: {
      receipt: TransactionReceipt;
      block: SaleBlock;
      status: unknown[];
    }[];
  };
  const [first, second] = proofs;
  assert.ok(first && second);
  assert.deepEqual(first.status, [true, false, "1", "2"]);
  assert.deepEqual(second.status, [true, false, "2", "2"]);
  const f = await fixture();
  await db.owner.query(
    "UPDATE yunipals_market.sale_replay_config SET start_block=$1 WHERE chain_id=1",
    [(first.block.number - 1n).toString()]
  );
  const head = second.block.number + 20n;
  let orphanSecond = false;
  const client = {
    ...f.client,
    async getBlock({ blockNumber = head }: { blockNumber?: bigint }) {
      const original = proofs.find(
        (p) => p.block.number === blockNumber
      )?.block;
      return {
        number: blockNumber,
        hash:
          orphanSecond && blockNumber === second.block.number
            ? hashes(blockNumber, 1)
            : (original?.hash ?? hashes(blockNumber)),
        timestamp:
          original?.timestamp ??
          (blockNumber >= second.block.number
            ? second.block.timestamp + blockNumber - second.block.number
            : first.block.timestamp + (blockNumber - first.block.number) * 12n)
      };
    },
    async getLogs({
      fromBlock,
      toBlock
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) {
      return proofs
        .filter(
          (p) =>
            p.block.number >= fromBlock &&
            p.block.number <= toBlock &&
            !(orphanSecond && p === second)
        )
        .flatMap((p) =>
          parseEventLogs({
            abi: erc721Abi,
            eventName: "Transfer",
            logs: p.receipt.logs,
            strict: true
          })
        );
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      const proof = proofs.find((p) => p.receipt.transactionHash === hash);
      assert.ok(proof);
      return proof.receipt;
    }
  } as unknown as PublicClient;
  const replay = () =>
    new CollectionSaleReplay(
      db.runtime,
      client,
      "ethereum",
      () => Number(second.block.timestamp + 20n) * 1000
    );
  for (let i = 0; i < 7; i++) assert.equal(await replay().tick(), "advanced");
  assert.equal(
    (await checkpoint()).block_number,
    second.block.number.toString()
  );
  let rows = await sales();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].order_hash, rows[1].order_hash);
  assert.equal(new Set(rows.map((r) => r.observation.eventId)).size, 2);
  assert.deepEqual(rows.map((r) => r.token_id).sort(), [
    "1000195033",
    "1001298581"
  ]);
  assert.ok(
    rows.every(
      (r) => r.canonical && r.observation.grossAmount === "110000000000000"
    )
  );
  const wallet = rows[0].seller;
  const activity = () =>
    new ActivityReadService(db.runtime).wallet(
      wallet,
      new URLSearchParams({ chain: "ethereum", view: "sales" })
    );
  const page = parseActivityPage(await activity(), {
    kind: "wallet",
    chain: "ethereum",
    wallet,
    view: "sales"
  });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 2);
  assert.equal(new Set(page.items.map((item) => item.sale.eventId)).size, 2);
  assert.equal(await replay().tick(), "idle");
  assert.equal((await sales()).length, 2);
  orphanSecond = true;
  assert.equal(await replay().tick(), "rewound");
  assert.equal(await replay().tick(), "advanced");
  rows = await sales();
  assert.equal(rows.filter((r) => r.canonical).length, 1);
  assert.equal(
    rows.find((r) => r.block_number === second.block.number.toString())
      ?.canonical,
    false
  );
  assert.equal((await activity()).items.length, 1);
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=1"
      )
    ).rows[0].count,
    "2"
  );
});

test("competing replay and a reorg during receipt retrieval cannot commit stale observations", async () => {
  const f = await fixture();
  f.state.afterReceipt = async () => {
    f.state.branch = 1;
    f.state.forkFrom = 0n;
    f.state.afterReceipt = async () => {};
  };
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  f.state.beforeLogs = async () => {
    f.state.beforeLogs = async () => {};
    assert.equal(await f.replay().tick(), "advanced");
  };
  assert.equal(await f.replay().tick(), "superseded");
  assert.equal((await sales()).length, 1);
});

test("runtime cannot change the operator's history/depth policy", async () => {
  await fixture();
  await assert.rejects(
    db.runtime.query(
      "UPDATE yunipals_market.sale_replay_config SET confirmations=1 WHERE chain_id=1"
    )
  );
});

test("confirmed blocks ahead of wall time do not publish unusable future history", async () => {
  const f = await fixture();
  f.state.timestampOffset = 21n;
  assert.equal(await f.replay().tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, null);
  f.state.timestampOffset = 0n;
  assert.equal(await f.replay().tick(), "advanced");
});

test("a worker pinned to another policy cannot start or change the checkpoint", async () => {
  const f = await fixture();
  const before = await checkpoint();
  await assert.rejects(
    new CollectionSaleReplay(
      db.runtime,
      f.client,
      "ethereum",
      () => fixtureNow,
      "wrong-policy"
    ).tick(),
    /configuration/
  );
  assert.deepEqual(await checkpoint(), before);
  assert.equal(f.ranges.length, 0);
});

test("a policy change during RPC fences the old observation without granting runtime configuration writes", async () => {
  const f = await fixture();
  f.state.beforeLogs = async () => {
    f.state.beforeLogs = async () => {};
    await db.owner.query(
      "UPDATE yunipals_market.sale_replay_config SET confirmations=19,policy='new-depth-19' WHERE chain_id=1"
    );
  };
  assert.equal(await f.replay().tick(), "superseded");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).state, "unavailable");
  assert.equal(await f.replay().tick(), "advanced");
});
