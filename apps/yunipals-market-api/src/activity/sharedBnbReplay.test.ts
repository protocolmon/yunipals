import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc721Abi,
  toHex,
  zeroAddress,
  type Hex,
  type PublicClient
} from "viem";
import type { IndexerReader } from "@protopals/yunipals-indexer-server/readers";
import {
  CanonicalCursorInvalidated,
  CanonicalSourceUnavailable
} from "@protopals/yunipals-indexer-server/readers";
import {
  manifestDigest,
  transactionEvidenceHash
} from "@protopals/yunipals-indexer-server/identity";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import { seaportRuntimeHashes } from "@protopals/yunipals-market-core/seaportRuntime";
import { receiptLogsBloom } from "@protopals/yunipals-market-core/receiptEvidence";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { buyer, now, seller, timestamp } from "@/bnb/fixtures/admission";
import {
  SharedBnbSaleReplay,
  sharedBnbSaleConfiguration
} from "./sharedBnbReplay";
import {
  sharedBnbReceiptCandidates,
  decodeSharedBnbSaleProofs
} from "./sharedBnbReplayProof";
import type { SharedMarketPage } from "./sharedCollectionSales";

const db = createBnbTestDatabase();
const where = "source='chain' AND chain_id=56 AND name='bnb-sales'";
const config = {
  confirmationPolicy: { kind: "finalized" },
  policy: "bnb-shared-test-finalized-v1"
} as const;
const hash = (number: number, branch = 0) =>
  toHex(BigInt(number) + BigInt(branch) * 1_000_000n, { size: 32 });
const sourceDefinition = {
  id: "ownership:bnb",
  feature: "ownership",
  chainId: 56,
  contractName: "BnbCollection",
  address: marketplaceChains.bnb.contractAddress.toLowerCase(),
  startBlock: "100",
  endBlock: null,
  enabled: true,
  abiHash: manifestDigest(collectionAbi),
  events: ["Transfer"],
  receiptRequirement: "full",
  policies: [{ kind: "finalized" }, { kind: "depth", subsequentBlocks: 20 }]
} as const;
let savedCheckpoint: unknown;
let suppressed: Array<{ order_hash: string; state: string }> = [];
let ready = false;
before(async () => {
  await db.initialize();
  await db.owner
    .query(`GRANT SELECT ON yunipals_market.shared_indexer_consumer TO market_test_runtime;
    GRANT UPDATE(cursor,generation,updated_at) ON yunipals_market.shared_indexer_consumer TO market_test_runtime;
    GRANT SELECT,INSERT,UPDATE ON yunipals_market.sale_receipt_qualification TO market_test_runtime`);
  for (const table of [
    "sale",
    "sale_receipt",
    "sale_receipt_qualification",
    "activity_block"
  ])
    assert.equal(
      (
        await db.owner.query(
          `SELECT count(*)::int AS count FROM yunipals_market.${table} WHERE chain_id=56`
        )
      ).rows[0].count,
      0,
      "BNB activity fixtures must be empty before this scoped suite."
    );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS count FROM yunipals_market.snapshot WHERE kind='activity'"
      )
    ).rows[0].count,
    0
  );
  savedCheckpoint = (
    await db.owner.query(
      `SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE ${where}`
    )
  ).rows[0].value;
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
    .query(`UPDATE yunipals_market.checkpoint SET reader_mode='unified',generation=generation+1,
    block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL,
    state='syncing',last_error_code=NULL WHERE ${where}`);
});
afterEach(async () => {
  if (!ready) return;
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=56");
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt_qualification WHERE chain_id=56"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.activity_block WHERE chain_id=56"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
  );
  await db.clear();
});
after(async () => {
  try {
    if (ready) {
      await db.owner.query(
        "UPDATE yunipals_market.orders o SET publication_state='accepted',state=s.state FROM jsonb_to_recordset($1) AS s(order_hash text,state text) WHERE o.chain_id=56 AND o.order_hash=s.order_hash",
        [JSON.stringify(suppressed)]
      );
      await db.owner.query(
        `DELETE FROM yunipals_market.checkpoint WHERE ${where}`
      );
      await db.owner.query(
        "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
        [JSON.stringify(savedCheckpoint)]
      );
    }
  } finally {
    await db.close();
  }
});

async function admitted(side: "listing" | "offer" = "listing") {
  const item = await db.setup(side);
  const prepared = await item.service.prepare(item.draft);
  const accepted = await item.service.submit({
    ...item.request,
    preparationId: prepared.id
  });
  return { item, order: accepted.order };
}

async function fixture(
  side: "listing" | "offer" = "listing",
  receiptStartBlock?: string
) {
  const source = {
    ...sourceDefinition,
    ...(receiptStartBlock === undefined ? {} : { receiptStartBlock })
  };
  const known = await admitted(side);
  let saleBlock = 123,
    forkFrom = 123;
  let boundary = 125,
    branch = 0,
    fail = false,
    invalidated = false,
    pendingReceipt = false;
  let proofMutation: ((raw: Record<string, unknown>) => void) | undefined;
  let sideEffect: (() => Promise<void>) | undefined;
  const sourcePages: Array<{ from: string | null; includeReceipts?: boolean }> =
    [];
  const block = (number: bigint) => ({
    number,
    hash: hash(Number(number), number >= BigInt(forkFrom) ? branch : 0),
    parentHash: hash(
      Number(number) - 1,
      number > BigInt(forkFrom) ? branch : 0
    ),
    timestamp: timestamp + number - 121n
  });
  const rawProof = () => {
    const point = block(BigInt(saleBlock)),
      transactionHash = hash(900, branch);
    const meta = {
      blockHash: point.hash,
      blockNumber: toHex(saleBlock),
      transactionHash,
      transactionIndex: "0x0",
      removed: false
    };
    const transfer = {
      ...meta,
      address: known.order.asset.contractAddress.toLowerCase(),
      logIndex: "0x2",
      data: "0x",
      topics: encodeEventTopics({
        abi: erc721Abi,
        eventName: "Transfer",
        args: {
          from: seller.address,
          to: buyer.address,
          tokenId: BigInt(known.order.asset.tokenId)
        }
      }) as readonly Hex[]
    };
    const fulfillmentAbi = seaportEventAbi.find(
      (event) => event.name === "OrderFulfilled"
    )!;
    const fulfillment = {
      ...meta,
      address: seaportDeployment.address.toLowerCase(),
      logIndex: "0x3",
      topics: encodeEventTopics({
        abi: seaportEventAbi,
        eventName: "OrderFulfilled",
        args: { offerer: known.order.maker, zone: zeroAddress }
      }) as readonly Hex[],
      data: encodeAbiParameters(
        fulfillmentAbi.inputs.filter(
          (input) => !("indexed" in input && input.indexed)
        ),
        [
          known.order.orderHash,
          side === "listing" ? buyer.address : seller.address,
          known.item.order.offer.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifier: item.identifierOrCriteria,
            amount: item.startAmount
          })),
          known.item.order.consideration.map((item) => ({
            itemType: item.itemType,
            token: item.token,
            identifier: item.identifierOrCriteria,
            amount: item.startAmount,
            recipient: item.recipient
          }))
        ]
      )
    };
    const raw: Record<string, unknown> = {
      blockHash: point.hash,
      blockNumber: toHex(saleBlock),
      transactionHash,
      transactionIndex: "0x0",
      from: buyer.address.toLowerCase(),
      to: seaportDeployment.address.toLowerCase(),
      contractAddress: null,
      gasUsed: "0x64",
      cumulativeGasUsed: "0x64",
      effectiveGasPrice: "0x1",
      type: "0x2",
      status: "0x1",
      logs: [transfer, fulfillment],
      logsBloom: receiptLogsBloom([transfer, fulfillment])
    };
    proofMutation?.(raw);
    const event = {
      id: `56:${source.address}:${transactionHash}:2`,
      sourceId: source.id,
      chainId: 56,
      address: source.address,
      name: "Transfer",
      args: {
        from: seller.address.toLowerCase(),
        to: buyer.address.toLowerCase(),
        tokenId: known.order.asset.tokenId
      },
      abiHash: source.abiHash,
      blockNumber: saleBlock.toString(),
      blockHash: point.hash,
      timestamp: point.timestamp.toString(),
      transactionHash,
      transactionIndex: 0,
      logIndex: 2,
      topics: transfer.topics,
      data: "0x"
    };
    const rawBlock = {
      number: saleBlock.toString(),
      hash: point.hash,
      parentHash: point.parentHash,
      timestamp: point.timestamp.toString(),
      seaportRuntimeHash: seaportRuntimeHashes[56]
    };
    const evidence = {
      chain_id: 56,
      block_hash: point.hash,
      transaction_hash: transactionHash,
      receipt: raw,
      block: rawBlock,
      payload_hash: transactionEvidenceHash(raw, rawBlock)
    };
    return { event, evidence };
  };
  const reader = {
    release: {
      id: hash(999),
      schema: "shared_bnb_sale_fixture",
      buildId: "shared-bnb-sale-fixture",
      manifestHash: hash(1000),
      manifest: {
        version: 1,
        ponderVersion: "0.17.5",
        ordering: "multichain",
        coverage: "ponder-live-blocks-v1",
        sources: [source]
      }
    },
    status: async () => {
      if (fail) throw new CanonicalSourceUnavailable("fixture source outage");
      return {
        source,
        readiness: {
          reason: "ready",
          ready: true,
          availableThroughBlock: BigInt(boundary)
        },
        anchor: {
          number: boundary.toString(),
          hash: block(BigInt(boundary)).hash
        }
      };
    },
    page: async (
      _source: string,
      _policy: unknown,
      options: { cursor: SharedMarketPage["cursor"]; includeReceipts?: boolean }
    ) => {
      if (fail) throw new CanonicalSourceUnavailable("fixture source outage");
      const cursor = options.cursor;
      if (invalidated) {
        invalidated = false;
        throw new CanonicalCursorInvalidated("fixture source fork");
      }
      if (
        cursor.completed &&
        !(await (async () =>
          block(BigInt(cursor.completed!.number)).hash ===
          cursor.completed!.hash)())
      )
        throw new CanonicalCursorInvalidated("fixture previous anchor changed");
      sourcePages.push({
        from: cursor.completed?.number ?? null,
        includeReceipts: options.includeReceipts
      });
      const target = cursor.target ?? {
        number: boundary.toString(),
        hash: block(BigInt(boundary)).hash
      };
      const proof = rawProof();
      const hasEvent =
        (!cursor.completed ||
          BigInt(cursor.completed.number) < BigInt(saleBlock)) &&
        BigInt(target.number) >= BigInt(saleBlock);
      const waitingReceipt =
        pendingReceipt && hasEvent && options.includeReceipts;
      const events = hasEvent && !waitingReceipt ? [proof.event] : [];
      const next = waitingReceipt
        ? { ...cursor, target }
        : { ...cursor, completed: target, target: null, after: null };
      if (options.includeReceipts) {
        await sideEffect?.();
        sideEffect = undefined;
      }
      return {
        events,
        receipts:
          hasEvent && !waitingReceipt && options.includeReceipts
            ? [proof.evidence]
            : [],
        cursor: next,
        complete: !waitingReceipt,
        waitingReceipt
      };
    }
  } as unknown as IndexerReader;
  const client = {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) =>
      block(blockNumber),
    getLogs: async () => {
      throw new Error("Native BNB sale replay must not scan RPC logs.");
    },
    getTransactionReceipt: async () => {
      throw new Error("Native BNB sale replay must use the shared receipt.");
    }
  } as unknown as PublicClient;
  const registered = sharedBnbSaleConfiguration(reader, config);
  await db.owner.query(
    `INSERT INTO yunipals_market.shared_indexer_consumer
    (consumer,chain_id,release_id,source_id,confirmation_policy,configuration_hash)
    VALUES($1,56,$2,$3,$4::jsonb,$5)`,
    [
      registered.consumer,
      reader.release.id,
      registered.definition.sourceId,
      JSON.stringify(config.confirmationPolicy),
      registered.configurationHash
    ]
  );
  return {
    ...known,
    reader,
    client,
    sourcePages,
    replay: new SharedBnbSaleReplay(
      db.runtime,
      reader,
      client,
      config,
      250,
      () => now
    ),
    boundary: (number: number) => {
      boundary = number;
    },
    saleBlock: (number: number) => {
      saleBlock = number;
    },
    fork: (from = 123) => {
      branch++;
      forkFrom = from;
      invalidated = true;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    pendingReceipt: (value: boolean) => {
      pendingReceipt = value;
    },
    mutate: (mutation: (raw: Record<string, unknown>) => void) => {
      proofMutation = mutation;
    },
    sideEffect: (effect: () => Promise<void>) => {
      sideEffect = effect;
    },
    page: async () => {
      const result = await reader.page(source.id, config.confirmationPolicy, {
        cursor: {
          version: 1,
          releaseId: reader.release.id,
          sourceId: source.id,
          policy: "finalized",
          completed: null,
          target: null,
          after: null
        },
        includeReceipts: true
      });
      return {
        ...result,
        status: await reader.status(source.id, config.confirmationPolicy)
      };
    }
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

test("native BNB sale replay retains native and WBNB proofs, resumes, and qualifies the selected source", async () => {
  for (const side of ["listing", "offer"] as const) {
    const f = await fixture(side);
    assert.equal(await f.replay.tick(), "rewound");
    assert.equal(await f.replay.tick(), "advanced");
    assert.equal(
      (await sales())[0].observation.kind,
      side === "listing" ? "listing-filled" : "offer-accepted"
    );
    assert.equal((await sales())[0].canonical, true);
    assert.equal((await checkpoint()).coverage_start, "120");
    assert.equal(
      (await checkpoint()).coverage_start_time,
      (timestamp - 1n).toString()
    );
    assert.equal((await checkpoint()).block_number, "125");
    assert.equal((await checkpoint()).state, "available");
    assert.equal(
      (
        await db.owner.query(
          "SELECT consumer,policy,release_id FROM yunipals_market.sale_receipt_qualification WHERE chain_id=56"
        )
      ).rows[0].consumer,
      "bnb-sales"
    );
    assert.equal(await f.replay.tick(), "idle");
    assert.equal((await sales()).length, 1);
    await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=56");
    await db.owner.query(
      "DELETE FROM yunipals_market.sale_receipt_qualification WHERE chain_id=56"
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
    );
    await db.clear();
    await db.owner.query(
      `UPDATE yunipals_market.checkpoint SET block_number=NULL,block_hash=NULL,coverage_start=NULL,coverage_start_time=NULL,replay_from=NULL WHERE ${where}`
    );
  }
});

test("native BNB replay rejects an admission earlier than the receipt floor without consuming a page", async () => {
  const f = await fixture("listing", "122");
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal(f.sourcePages.length, 0);
  assert.equal((await checkpoint()).coverage_start, null);
  assert.equal((await sales()).length, 0);
});

test("native BNB replay rejects earlier signed history even when admission meets the receipt floor", async () => {
  const f = await fixture("listing", "121");
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal(f.sourcePages.length, 0);
  assert.equal((await checkpoint()).coverage_start, null);
  assert.equal((await sales()).length, 0);
});

test("native BNB receipt-floor coverage resumes and reorgs, while stale history remains unavailable", async () => {
  const f = await fixture("listing", "120");
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal((await checkpoint()).coverage_start, "120");
  f.fork();
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal((await sales()).filter((row) => row.canonical).length, 1);
  const cursor = (
    await db.owner.query(
      "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
    )
  ).rows[0].cursor;
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET coverage_start=119 WHERE ${where}`
  );
  assert.equal(await f.replay.tick(), "unavailable");
  assert.deepEqual(
    (
      await db.owner.query(
        "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
      )
    ).rows[0].cursor,
    cursor
  );
});

test("native BNB receipt pending and source outages retain proofs/cursor without claiming coverage", async () => {
  const f = await fixture();
  assert.equal(await f.replay.tick(), "rewound");
  f.pendingReceipt(true);
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal((await checkpoint()).last_error_code, "shared_receipt_pending");
  assert.equal((await checkpoint()).block_number, null);
  f.pendingReceipt(false);
  assert.equal(await f.replay.tick(), "advanced");
  const cursor = (
    await db.owner.query(
      "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
    )
  ).rows[0].cursor;
  f.fail(true);
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal((await sales()).length, 1);
  assert.deepEqual(
    (
      await db.owner.query(
        "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer='bnb-sales'"
      )
    ).rows[0].cursor,
    cursor
  );
});

test("native BNB reorg retracts prior sales and invalidates cached activity snapshots", async () => {
  const f = await fixture();
  f.boundary(122);
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "advanced");
  f.boundary(125);
  assert.equal(await f.replay.tick(), "advanced");
  const snapshotId = randomUUID();
  await db.owner.query(
    `INSERT INTO yunipals_market.snapshot(id,kind,query_key,header,observed_at,expires_at,row_count)
    VALUES($1,'activity','native-bnb','{}',clock_timestamp(),clock_timestamp()+interval '1 minute',1)`,
    [snapshotId]
  );
  f.fork();
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal((await checkpoint()).block_number, "122");
  assert.equal((await sales())[0].canonical, false);
  assert.ok(
    (
      await db.owner.query(
        "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
        [snapshotId]
      )
    ).rows[0].invalidated_at
  );
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal((await sales()).length, 2);
  assert.equal((await sales()).filter((sale) => sale.canonical).length, 1);
});

test("new admission during shared receipt work fences the old batch and schedules historical replay", async () => {
  const f = await fixture();
  assert.equal(await f.replay.tick(), "rewound");
  f.sideEffect(async () => {
    await admitted("offer");
  });
  assert.equal(await f.replay.tick(), "superseded");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).replay_from, "121");
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal((await sales()).length, 1);
});

test("missing original admission evidence prevents complete native BNB activity", async () => {
  const f = await fixture();
  await db.owner.query(
    "UPDATE yunipals_market.orders SET admission_block_number=NULL,admission_block_hash=NULL WHERE chain_id=56 AND order_hash=$1",
    [f.order.orderHash.toLowerCase()]
  );
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal(
    (await checkpoint()).last_error_code,
    "admission_coverage_missing"
  );
  assert.equal((await sales()).length, 0);
});

test("malformed full receipts reject atomically and unaccepted orders do not get sales", async () => {
  const f = await fixture();
  const page = await f.page();
  const candidates = sharedBnbReceiptCandidates(page);
  assert.equal(decodeSharedBnbSaleProofs(candidates, []).length, 0);
  assert.equal(await f.replay.tick(), "rewound");
  f.mutate((raw) => {
    raw.logsBloom = `0x${"00".repeat(256)}`;
  });
  assert.equal(await f.replay.tick(), "unavailable");
  assert.equal((await sales()).length, 0);
  assert.equal((await checkpoint()).block_number, null);
});

test("native BNB policy identity and explicit source selection fence all work", async () => {
  const f = await fixture();
  assert.throws(
    () =>
      sharedBnbSaleConfiguration(f.reader, {
        ...config,
        confirmationPolicy: { kind: "latest" }
      }),
    /policy requires review/
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET reader_mode='legacy' WHERE ${where}`
  );
  assert.equal(await f.replay.tick(), "superseded");
  assert.equal(f.sourcePages.length, 0);
});

test("shared qualification preserves an existing receipt's historical policy label", async () => {
  const f = await fixture();
  assert.equal(await f.replay.tick(), "rewound");
  const page = await f.page();
  const known = (
    await db.owner.query(
      "SELECT order_hash,summary,components FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1",
      [f.order.orderHash.toLowerCase()]
    )
  ).rows;
  const proof = decodeSharedBnbSaleProofs(
    sharedBnbReceiptCandidates(page),
    known
  )[0]!;
  await db.owner.query(
    `INSERT INTO yunipals_market.sale_receipt
    (chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy) VALUES(56,$1,$2,$3,$4,'legacy-bnb-depth-20-v1')`,
    [proof.blockHash, proof.transactionHash, proof.receipt, proof.block]
  );
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal(
    (
      await db.owner.query(
        "SELECT confirmation_policy FROM yunipals_market.sale_receipt WHERE chain_id=56"
      )
    ).rows[0].confirmation_policy,
    "legacy-bnb-depth-20-v1"
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT policy FROM yunipals_market.sale_receipt_qualification WHERE chain_id=56"
      )
    ).rows[0].policy,
    config.policy
  );
});

test("a shared checkpoint behind the first possible sale keeps coverage incomplete", async () => {
  const f = await fixture();
  f.boundary(110);
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "idle");
  assert.equal((await checkpoint()).coverage_start, null);
  assert.equal((await checkpoint()).state, "syncing");
  f.boundary(125);
  assert.equal(await f.replay.tick(), "advanced");
  assert.equal((await checkpoint()).state, "available");
  assert.equal((await sales()).length, 1);
});

test("a replacement branch can retain a native sale before the original admission height", async () => {
  const f = await fixture();
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal(await f.replay.tick(), "advanced");
  f.fork(120);
  f.saleBlock(120);
  assert.equal(await f.replay.tick(), "rewound");
  assert.equal((await checkpoint()).coverage_start, null);
  assert.equal(await f.replay.tick(), "advanced");
  const current = (await sales()).filter((sale) => sale.canonical);
  assert.equal(current.length, 1);
  assert.equal(current[0].observation.blockNumber, "120");
  assert.equal(
    (
      await db.owner.query(
        "SELECT admission_block_number::text AS admission FROM yunipals_market.orders WHERE chain_id=56 AND order_hash=$1",
        [f.order.orderHash.toLowerCase()]
      )
    ).rows[0].admission,
    "121"
  );
});
