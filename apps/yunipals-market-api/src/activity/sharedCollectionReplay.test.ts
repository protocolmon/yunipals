import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc721Abi,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Hex,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { receiptLogsBloom } from "@protopals/yunipals-market-core/receiptEvidence";
import { seaportRuntimeHashes } from "@protopals/yunipals-market-core/seaportRuntime";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  observeCollectionSales,
  type SaleBlock
} from "@protopals/yunipals-market-core/settledSale";
import {
  manifestDigest,
  sourceManifestHash,
  transactionEvidenceHash
} from "@protopals/yunipals-indexer-server/identity";
import {
  createIndexerReader,
  type IndexerReader
} from "@protopals/yunipals-indexer-server/readers";
import { registerIndexerRelease } from "../../../yunipals-indexer/lib/unified/releases";
import {
  decodeSharedCollectionSales,
  type SharedMarketPage
} from "./sharedCollectionSales";
import {
  SharedCollectionSaleReplay,
  sharedCollectionSaleConfiguration
} from "./sharedCollectionReplay";
import { CollectionSaleReplay } from "./collectionReplay";
import { readSharedConsumerEnvironment } from "@/indexer/consumerEnvironment";
import { selectSharedMarketplaceConsumer } from "@/indexer/consumerSelection";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { admissionFixture, buyer, seller } from "@/opensea/fixtures/admission";
import { ActivityReadService, readActivitySources } from "@/reads/activity";
import { assertReady } from "@/db/readiness";

const numeric = [
  "blockNumber",
  "transactionIndex",
  "logIndex",
  "gasUsed",
  "cumulativeGasUsed",
  "effectiveGasPrice"
];
function rpcReceipt(receipt: TransactionReceipt) {
  const raw = JSON.parse(
    JSON.stringify(receipt, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    )
  ) as Record<string, unknown>;
  for (const field of numeric)
    if (raw[field] !== undefined)
      raw[field] = toHex(BigInt(raw[field] as string));
  raw.status = receipt.status === "success" ? "0x1" : "0x0";
  raw.type = "0x2";
  raw.logs = receipt.logs.map((log) => ({
    ...log,
    blockNumber: toHex(log.blockNumber!),
    transactionIndex: toHex(log.transactionIndex!),
    logIndex: toHex(log.logIndex!)
  }));
  raw.logsBloom = receiptLogsBloom(receipt.logs);
  return raw;
}
function evidencePage(
  chain: "ethereum" | "polygon",
  receipt: TransactionReceipt,
  block: SaleBlock
): SharedMarketPage {
  const config = marketplaceChains[chain];
  const events = parseEventLogs({
    abi: erc721Abi,
    eventName: "Transfer",
    logs: receipt.logs,
    strict: true
  })
    .filter(
      (log) =>
        log.address.toLowerCase() === config.contractAddress.toLowerCase()
    )
    .map((log) => ({
      id: `${receipt.transactionHash}:${log.logIndex}`,
      sourceId: `ownership:${chain}`,
      chainId: config.chainId,
      address: log.address.toLowerCase(),
      name: "Transfer",
      args: {
        from: log.args.from.toLowerCase(),
        to: log.args.to.toLowerCase(),
        tokenId: log.args.tokenId.toString()
      },
      abiHash: manifestDigest(collectionAbi),
      blockNumber: block.number.toString(),
      blockHash: block.hash,
      timestamp: block.timestamp.toString(),
      transactionHash: receipt.transactionHash,
      transactionIndex: log.transactionIndex!,
      logIndex: log.logIndex!,
      topics: log.topics,
      data: log.data
    }));
  const raw = rpcReceipt(receipt),
    storedBlock = {
      number: block.number.toString(),
      hash: block.hash,
      parentHash: toHex(1n, { size: 32 }),
      timestamp: block.timestamp.toString(),
      seaportRuntimeHash: seaportRuntimeHashes[config.chainId as 1 | 137]
    };
  return {
    events,
    receipts: [
      {
        chain_id: config.chainId,
        block_hash: block.hash,
        transaction_hash: receipt.transactionHash,
        receipt: raw,
        block: storedBlock,
        payload_hash: transactionEvidenceHash(raw, storedBlock)
      }
    ],
    status: {
      source: {
        chainId: config.chainId,
        address: config.contractAddress.toLowerCase(),
        feature: "ownership"
      }
    }
  } as unknown as SharedMarketPage;
}
test("shared receipts preserve historical partial fills, matched orders and repeated NFT fills", async () => {
  for (const [name, chain] of [
    ["ethereum-partial-fills", "ethereum"],
    ["ethereum-matched-orders", "ethereum"],
    ["polygon-repeated-fills", "polygon"]
  ] as const) {
    const parsed = JSON.parse(
      await readFile(
        new URL(`./fixtures/${name}.json`, import.meta.url),
        "utf8"
      ),
      (key, value: unknown) =>
        typeof value === "string" &&
        [
          "blockNumber",
          "number",
          "timestamp",
          "gasUsed",
          "cumulativeGasUsed",
          "effectiveGasPrice"
        ].includes(key)
          ? BigInt(value)
          : value
    );
    const proofs = (parsed.proofs ?? [parsed]) as Array<{
      receipt: TransactionReceipt;
      block: SaleBlock;
    }>;
    for (const proof of proofs) {
      const page = evidencePage(chain, proof.receipt, proof.block);
      const indices = parseEventLogs({
        abi: seaportEventAbi,
        eventName: "OrderFulfilled",
        logs: proof.receipt.logs,
        strict: true
      }).map((log) => log.logIndex!);
      assert.deepEqual(
        decodeSharedCollectionSales(chain, page).map(({ logIndex, sale }) => ({
          logIndex,
          sale
        })),
        observeCollectionSales(chain, proof.receipt, proof.block, indices)
      );
      const invalid = structuredClone(page);
      const raw = invalid.receipts[0]!.receipt as { logs: unknown[] };
      raw.logs = (raw.logs as Array<{ logIndex: string }>).filter(
        (log) => log.logIndex !== toHex(page.events[0]?.logIndex ?? 0)
      );
      if (page.events.length)
        assert.throws(() => decodeSharedCollectionSales(chain, invalid));
    }
  }
});
test("shared consumer environment rejects incomplete and mixed source selection", () => {
  assert.deepEqual(readSharedConsumerEnvironment({}, "MARKET_SALE_INDEXER"), {
    mode: "legacy"
  });
  const input = {
    MARKET_SALE_INDEXER_MODE: "unified",
    MARKET_SALE_INDEXER_DATABASE_URL: "postgresql://reader@localhost/db",
    MARKET_SALE_INDEXER_RELEASE_ID: `0x${"42".repeat(32)}`
  };
  assert.equal(
    readSharedConsumerEnvironment(input, "MARKET_SALE_INDEXER").mode,
    "unified"
  );
  for (const change of [
    { MARKET_SALE_INDEXER_MODE: "legacy" },
    { MARKET_SALE_INDEXER_RELEASE_ID: undefined },
    { MARKET_SALE_INDEXER_DATABASE_URL: "https://example.com" }
  ])
    assert.throws(() =>
      readSharedConsumerEnvironment(
        { ...input, ...change },
        "MARKET_SALE_INDEXER"
      )
    );
});

test(
  "actual shared pager projects dense-block sales atomically, preserves policy proofs and recovers reorgs",
  { skip: !process.env.PONDER_UNIFIED_TEST_DATABASE_URL },
  async () => {
    const sourceUrl = process.env.PONDER_UNIFIED_TEST_DATABASE_URL!;
    const url = new URL(sourceUrl);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/yunipals_ponder_dependency_test");
    const db = createBnbTestDatabase(),
      source = new pg.Pool({ connectionString: sourceUrl, max: 4 });
    const schema = `shared_sale_${process.pid}`,
      buildId = "shared-sale-dense-block-proof";
    const now = Date.now(),
      stamp = BigInt(Math.floor(now / 1000));
    const hash = (value: bigint | number) =>
      toHex(BigInt(process.pid) * 100000n + BigInt(value), { size: 32 });
    const block = (number: bigint, branch = 0) => ({
      number,
      hash: hash(number + BigInt(branch) * 10000n),
      timestamp: stamp - 100n + number
    });
    const chain = marketplaceChains.base,
      consumer = "collection-sales:base";
    const config = {
      chain: "base",
      startBlock: "1",
      confirmations: 0,
      policy: "base-latest-shared-test",
      confirmationPolicy: { kind: "latest" }
    } as const;
    const manifest: IndexerReader["release"]["manifest"] = {
      version: 1,
      ponderVersion: "0.17.5",
      ordering: "multichain",
      coverage: "ponder-live-blocks-v1",
      sources: [
        {
          id: "ownership:base",
          feature: "ownership",
          chainId: 8453,
          contractName: "BaseYunipals",
          address: chain.contractAddress.toLowerCase(),
          startBlock: "1",
          endBlock: null,
          enabled: true,
          abiHash: manifestDigest(collectionAbi),
          events: ["Transfer"],
          receiptRequirement: "full",
          policies: [{ kind: "latest" }]
        }
      ]
    };
    let releaseId: string | undefined, saved: unknown;
    let saleRuntime = db.runtime;
    let roleAdmin: pg.Pool | undefined;
    let dedicatedRuntime: pg.Pool | undefined;
    const saleRole = `shared_sale_runtime_${process.pid}`;
    const transfers: Array<{
      receipt: Record<string, unknown>;
      block: Record<string, unknown>;
      event: Record<string, unknown>;
      proof: TransactionReceipt;
    }> = [];
    let onPoint = async () => {};
    const client = {
      async getBlock({ blockNumber }: { blockNumber: bigint }) {
        await onPoint();
        return block(blockNumber);
      },
      async getLogs() {
        throw new Error("Duplicate log scanner is forbidden.");
      },
      async getTransactionReceipt() {
        throw new Error("Duplicate receipt fetch is forbidden.");
      }
    } as unknown as PublicClient;
    try {
      await db.initialize();
      const adminUrl = process.env.MARKET_TEST_ADMIN_DATABASE_URL;
      if (adminUrl) {
        const adminGuard = new URL(adminUrl);
        assert.equal(adminGuard.hostname, url.hostname);
        assert.equal(adminGuard.port, url.port);
        assert.equal(adminGuard.pathname, "/yunipals_market_test");
        roleAdmin = new pg.Pool({ connectionString: adminUrl, max: 2 });
        await roleAdmin.query(
          `CREATE ROLE ${saleRole} LOGIN PASSWORD 'local-disposable-sale-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`
        );
        const grants = (
          await readFile(
            new URL("../../scripts/grant-sale-worker.sql", import.meta.url),
            "utf8"
          )
        ).replaceAll(':"market_runtime_role"', `"${saleRole}"`);
        await roleAdmin.query(grants);
        const runtimeUrl = new URL(adminUrl);
        runtimeUrl.username = saleRole;
        runtimeUrl.password = "local-disposable-sale-only";
        dedicatedRuntime = new pg.Pool({
          connectionString: runtimeUrl.href,
          max: 2
        });
        saleRuntime = dedicatedRuntime;
        await assertReady(saleRuntime, "staging");
      }
      saved = (
        await db.owner.query(
          "SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE chain_id=8453 AND name='seaport-sales'"
        )
      ).rows[0].value;
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=8453"
          )
        ).rows[0].count,
        "0"
      );
      await db.owner.query(
        "GRANT SELECT ON yunipals_market.shared_indexer_consumer TO market_test_runtime; GRANT UPDATE(cursor,generation,updated_at) ON yunipals_market.shared_indexer_consumer TO market_test_runtime; GRANT SELECT,INSERT,UPDATE ON yunipals_market.sale_receipt_qualification TO market_test_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.sale_exclusion TO market_test_runtime"
      );
      await source.query(`CREATE SCHEMA ${schema}`);
      for (const table of [
        "_ponder_meta",
        "_ponder_checkpoint",
        "indexer_source",
        "chain_checkpoint",
        "chain_block",
        "canonical_event",
        "transaction_candidate"
      ])
        await source.query(
          `CREATE TABLE ${schema}.${table}(LIKE dependency_check.${table} INCLUDING ALL)`
        );
      await source.query(
        `INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`,
        [
          JSON.stringify({
            version: "6",
            build_id: buildId,
            heartbeat_at: now,
            is_ready: 1,
            is_locked: 1,
            is_dev: 0
          })
        ]
      );
      const cp = `${stamp.toString().padStart(10, "0")}${"8453".padStart(16, "0")}${"100".padStart(16, "0")}${"9".repeat(33)}`;
      await source.query(
        `INSERT INTO ${schema}._ponder_checkpoint VALUES('8453',8453,$1,$1,$1)`,
        [cp]
      );
      await source.query(
        `INSERT INTO ${schema}.indexer_source VALUES('ownership:base',8453,$1,$2)`,
        [sourceManifestHash(manifest), JSON.stringify(manifest.sources[0])]
      );
      await source.query(
        `INSERT INTO ${schema}.chain_checkpoint VALUES('8453',8453,100,$1,$2,$3)`,
        [block(100n).hash, block(99n).hash, stamp.toString()]
      );
      for (let n = 0n; n <= 100n; n++)
        await source.query(
          `INSERT INTO ${schema}.chain_block VALUES($1,8453,$2,$3,$4,$5)`,
          [
            `8453:${n}`,
            n.toString(),
            block(n).hash,
            block(n - 1n).hash,
            block(n).timestamp.toString()
          ]
        );
      const release = await registerIndexerRelease(source, {
        schema,
        buildId,
        manifest
      });
      releaseId = release.id;
      await source.query(
        `INSERT INTO yunipals_indexer_control.chain_status(release_id,chain_id,head_number,head_hash,head_timestamp,finalized_number,finalized_hash,witness_number,witness_hash,observed_at_ms,provider_id,anchors) VALUES($1,8453,100,$2,$3,100,$2,100,$2,$4,'local-shared-sale-test',$5)`,
        [
          release.id,
          block(100n).hash,
          stamp.toString(),
          now.toString(),
          JSON.stringify({
            "100": {
              number: "100",
              hash: block(100n).hash,
              timestamp: stamp.toString()
            }
          })
        ]
      );
      const reader = await createIndexerReader(source, {
        releaseId: release.id,
        now: () => now
      });
      sharedCollectionSaleConfiguration(reader, config);
      await db.owner.query(
        "INSERT INTO yunipals_market.sale_replay_config VALUES(8453,1,0,$1)",
        [config.policy]
      );
      const selection = { kind: "collection-sales", config } as const;
      const review = await selectSharedMarketplaceConsumer(
        db.owner,
        reader,
        selection
      );
      assert.equal(review.applied, false);
      assert.equal(
        (
          await db.owner.query(
            "SELECT reader_mode FROM yunipals_market.checkpoint WHERE chain_id=8453 AND name='seaport-sales'"
          )
        ).rows[0].reader_mode,
        "legacy"
      );
      await db.owner.query(
        "UPDATE yunipals_market.checkpoint SET generation=generation+1 WHERE chain_id=8453 AND name='seaport-sales'"
      );
      await assert.rejects(
        () =>
          selectSharedMarketplaceConsumer(
            db.owner,
            reader,
            selection,
            review.reviewHash
          ),
        /changed/
      );
      const current = await selectSharedMarketplaceConsumer(
        db.owner,
        reader,
        selection
      );
      await assert.rejects(
        () =>
          selectSharedMarketplaceConsumer(
            db.runtime,
            reader,
            selection,
            current.reviewHash
          ),
        /migration owner/
      );
      assert.equal(
        (
          await selectSharedMarketplaceConsumer(
            db.owner,
            reader,
            selection,
            current.reviewHash
          )
        ).applied,
        true
      );
      const item = await admissionFixture("base", "listing", 123n);
      const abi = seaportEventAbi.find(
        (entry) => entry.name === "OrderFulfilled"
      )!;
      for (let i = 0; i < 40; i++) {
        const b = block(50n),
          tx = hash(1000 + i),
          tokenId = 123n + BigInt(i);
        const meta = {
          blockNumber: b.number,
          blockHash: b.hash,
          transactionHash: tx,
          transactionIndex: i,
          removed: false
        };
        const logs = [
          {
            ...meta,
            address: chain.contractAddress,
            logIndex: i * 2,
            data: "0x" as Hex,
            topics: encodeEventTopics({
              abi: erc721Abi,
              eventName: "Transfer",
              args: { from: seller.address, to: buyer.address, tokenId }
            })
          },
          {
            ...meta,
            address: seaportDeployment.address,
            logIndex: i * 2 + 1,
            topics: encodeEventTopics({
              abi: seaportEventAbi,
              eventName: "OrderFulfilled",
              args: { offerer: seller.address, zone: zeroAddress }
            }),
            data: encodeAbiParameters(
              abi.inputs.filter(
                (input) => !("indexed" in input && input.indexed)
              ),
              [
                hash(2000 + i),
                buyer.address,
                item.input.order.offer.map((entry) => ({
                  itemType: entry.itemType,
                  token: entry.token,
                  identifier: tokenId,
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
          }
        ];
        const proof = {
          ...meta,
          from: buyer.address,
          to: seaportDeployment.address,
          contractAddress: null,
          gasUsed: 100n,
          cumulativeGasUsed: 100n,
          effectiveGasPrice: 1n,
          logsBloom: receiptLogsBloom(logs as TransactionReceipt["logs"]),
          status: "success",
          type: "eip1559",
          logs
        } as TransactionReceipt;
        const raw = rpcReceipt(proof),
          storedBlock = {
            number: "50",
            hash: b.hash,
            parentHash: block(49n).hash,
            timestamp: b.timestamp.toString(),
            seaportRuntimeHash: seaportRuntimeHashes[8453]
          };
        const event = { id: `${schema}:${i}`, transactionHash: tx };
        transfers.push({ receipt: raw, block: storedBlock, event, proof });
        await source.query(
          `INSERT INTO ${schema}.canonical_event VALUES($1,'ownership:base',8453,$2,'Transfer',$3,$4,50,$5,$6,$7,$8,$9,$10,'0x')`,
          [
            event.id,
            chain.contractAddress.toLowerCase(),
            JSON.stringify({
              from: seller.address.toLowerCase(),
              to: buyer.address.toLowerCase(),
              tokenId: tokenId.toString()
            }),
            manifestDigest(collectionAbi),
            b.hash,
            b.timestamp.toString(),
            tx,
            i,
            i * 2,
            JSON.stringify(logs[0]!.topics)
          ]
        );
        await source.query(
          `INSERT INTO ${schema}.transaction_candidate VALUES($1,8453,50,$2,$3)`,
          [event.id, b.hash, tx]
        );
        await source.query(
          "INSERT INTO yunipals_indexer_control.transaction_evidence(chain_id,block_number,block_hash,transaction_hash,receipt,block,payload_hash,provider_id) VALUES(8453,50,$1,$2,$3,$4,$5,'local-shared-sale-test')",
          [
            b.hash,
            tx,
            JSON.stringify(raw),
            JSON.stringify(storedBlock),
            transactionEvidenceHash(raw, storedBlock)
          ]
        );
      }
      const replay = new SharedCollectionSaleReplay(
        saleRuntime,
        reader,
        client,
        config
      );
      assert.equal(await replay.tick(), "rewound");
      assert.equal(await replay.tick(), "advanced");
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=8453 AND canonical"
          )
        ).rows[0].count,
        "16"
      );
      assert.equal(
        (
          await db.owner.query(
            "SELECT block_number FROM yunipals_market.checkpoint WHERE chain_id=8453 AND name='seaport-sales'"
          )
        ).rows[0].block_number,
        null,
        "partial dense block must not establish completed coverage"
      );
      const missing = transfers[20]!;
      await source.query(
        "DELETE FROM yunipals_indexer_control.transaction_evidence WHERE chain_id=8453 AND transaction_hash=$1",
        [missing.event.transactionHash]
      );
      assert.equal(await replay.tick(), "unavailable");
      await source.query(
        "INSERT INTO yunipals_indexer_control.transaction_evidence(chain_id,block_number,block_hash,transaction_hash,receipt,block,payload_hash,provider_id) VALUES(8453,50,$1,$2,$3,$4,$5,'local-shared-sale-test')",
        [
          block(50n).hash,
          missing.event.transactionHash,
          JSON.stringify(missing.receipt),
          JSON.stringify(missing.block),
          transactionEvidenceHash(missing.receipt, missing.block)
        ]
      );
      for (let i = 0; i < 4; i++) await replay.tick();
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=8453 AND canonical"
          )
        ).rows[0].count,
        "40"
      );
      assert.equal(
        (
          await db.owner.query(
            "SELECT block_number::text,state FROM yunipals_market.checkpoint WHERE chain_id=8453 AND name='seaport-sales'"
          )
        ).rows[0].block_number,
        "100"
      );
      assert.equal(await replay.tick(), "idle");
      const beforeOutage = (await db.owner.query("SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1", [consumer])).rows[0].cursor;
      await source.query(`UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','0') WHERE key='app'`);
      assert.equal(await replay.tick(), "unavailable");
      assert.equal((await readActivitySources(db.runtime, ["base"], new Date(now), reader)).chains.base?.confirmedThrough, null);
      assert.deepEqual((await db.owner.query("SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1", [consumer])).rows[0].cursor, beforeOutage);
      await source.query(`UPDATE ${schema}._ponder_meta SET value=jsonb_set(value,'{is_locked}','1') WHERE key='app'`);
      // A retained canonical block hash does not prove coverage when Ponder has
      // temporarily recovered only an earlier complete checkpoint.
      const shorter = `${stamp.toString().padStart(10, "0")}${"8453".padStart(16, "0")}${"99".padStart(16, "0")}${"9".repeat(33)}`;
      await source.query(`UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1,finalized_checkpoint=$1`, [shorter]);
      await source.query("UPDATE yunipals_indexer_control.chain_status SET anchors=anchors||$2::jsonb WHERE release_id=$1 AND chain_id=8453", [release.id, JSON.stringify({ "99": { number: "99", hash: block(99n).hash, timestamp: block(99n).timestamp.toString() } })]);
      assert.equal(await replay.tick(), "unavailable");
      assert.equal((await readActivitySources(db.runtime, ["base"], new Date(now), reader)).chains.base?.confirmedThrough, null);
      await source.query(`UPDATE ${schema}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1,finalized_checkpoint=$1`, [cp]);
      assert.equal(await replay.tick(), "idle");
      // Retain the old policy label; a new canonical proof qualifies the exact
      // same receipt for current policy, and body corruption invalidates it.
      await db.owner.query(
        "UPDATE yunipals_market.sale_receipt SET confirmation_policy='previous-depth-policy' WHERE chain_id=8453"
      );
      const activity = new ActivityReadService(db.runtime, {
        sourceReader: reader
      });
      const activityParams = () =>
        new URLSearchParams({ limit: "10", chain: "base" });
      assert.ok(await activity.wallet(buyer.address, activityParams()));
      await db.owner.query(
        "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
      );
      await db.owner.query(
        "UPDATE yunipals_market.sale_receipt SET receipt=jsonb_set(receipt,'{gasUsed}','\"999\"') WHERE chain_id=8453 AND transaction_hash=$1",
        [transfers[0]!.event.transactionHash]
      );
      await assert.rejects(
        () => activity.wallet(buyer.address, activityParams()),
        /sale_proof_unavailable/
      );
      await db.owner.query(
        "UPDATE yunipals_market.sale_receipt SET receipt=$2 WHERE chain_id=8453 AND transaction_hash=$1",
        [
          transfers[0]!.event.transactionHash,
          JSON.stringify(
            JSON.parse(
              JSON.stringify(transfers[0]!.proof, (_, value: unknown) =>
                typeof value === "bigint" ? value.toString() : value
              )
            )
          )
        ]
      );
      // A disappearing canonical event invalidates a partially applied cursor.
      await db.owner.query(
        "UPDATE yunipals_market.checkpoint SET replay_from=1 WHERE chain_id=8453 AND name='seaport-sales'"
      );
      assert.equal(await replay.tick(), "rewound");
      assert.equal(await replay.tick(), "advanced");
      const cursor = (
        await db.owner.query(
          "SELECT cursor FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1",
          [consumer]
        )
      ).rows[0].cursor;
      await source.query(`DELETE FROM ${schema}.canonical_event WHERE id=$1`, [
        cursor.after.id
      ]);
      assert.equal(await replay.tick(), "rewound");
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=8453 AND canonical"
          )
        ).rows[0].count,
        "0"
      );
      // Mode changes fence old workers before their first RPC and reject runtime selection changes.
      await assert.rejects(
        () =>
          db.runtime.query(
            "UPDATE yunipals_market.checkpoint SET reader_mode='legacy' WHERE chain_id=8453 AND name='seaport-sales'"
          ),
        /table owner/
      );
      await assert.rejects(() => db.runtime.query("DELETE FROM yunipals_market.checkpoint WHERE chain_id=8453 AND name='seaport-sales'"), /table owner/);
      await assert.rejects(() => db.runtime.query("UPDATE yunipals_market.checkpoint SET name='renamed-sale-cursor' WHERE chain_id=8453 AND name='seaport-sales'"), /table owner/);
      assert.equal(
        await new CollectionSaleReplay(db.runtime, client, "base").tick(),
        "superseded"
      );
      let flipped = false;
      onPoint = async () => {
        if (!flipped) {
          flipped = true;
          await db.owner.query(
            "UPDATE yunipals_market.checkpoint SET reader_mode='legacy' WHERE chain_id=8453 AND name='seaport-sales'"
          );
        }
      };
      await db.owner.query(
        "UPDATE yunipals_market.shared_indexer_consumer SET cursor=NULL WHERE consumer=$1",
        [consumer]
      );
      assert.equal(await replay.tick(), "superseded");
      assert.equal(
        (
          await db.owner.query(
            "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=8453 AND canonical"
          )
        ).rows[0].count,
        "0"
      );
    } finally {
      await dedicatedRuntime?.end();
      if (roleAdmin) {
        await roleAdmin.query(
          `DROP OWNED BY ${saleRole}; DROP ROLE ${saleRole}`
        );
        await roleAdmin.end();
      }
      if (saved) {
        for (const table of [
          "sale_receipt_qualification",
          "sale_exclusion",
          "sale",
          "sale_receipt",
          "activity_block",
          "sale_replay_config"
        ])
          await db.owner.query(
            `DELETE FROM yunipals_market.${table} WHERE chain_id=8453`
          );
        await db.owner.query(
          "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1",
          [consumer]
        );
        await db.owner.query(
          "DELETE FROM yunipals_market.checkpoint WHERE chain_id=8453 AND name='seaport-sales'"
        );
        await db.owner.query(
          "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
          [JSON.stringify(saved)]
        );
        await db.owner.query(
          "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
        );
      }
      if (releaseId) {
        await source.query(
          "DELETE FROM yunipals_indexer_control.chain_anchor WHERE release_id=$1",
          [releaseId]
        );
        await source.query(
          "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=$1",
          [releaseId]
        );
        await source.query(
          "DELETE FROM yunipals_indexer_control.release WHERE id=$1",
          [releaseId]
        );
      }
      await source.query(
        "DELETE FROM yunipals_indexer_control.transaction_evidence WHERE provider_id='local-shared-sale-test'"
      );
      await source.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await source.end();
      await db.close();
    }
  }
);
