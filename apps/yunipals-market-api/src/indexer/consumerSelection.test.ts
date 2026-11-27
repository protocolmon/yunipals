import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { collectionAbi } from "@protopals/yunipals-market-core/collectionAbi";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";
import { seaportEventAbi } from "@protopals/yunipals-market-core/seaportEvents";
import {
  createIndexerReader,
  type IndexerReader
} from "@protopals/yunipals-indexer-server/readers";
import {
  manifestDigest,
  sourceManifestHash,
  transactionEvidenceHash
} from "@protopals/yunipals-indexer-server/identity";
import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import { bnbValidationPolicy } from "@/bnb/validation";
import { migrateIndexerControl } from "../../../yunipals-indexer/lib/unified/control-schema";
import { registerIndexerRelease } from "../../../yunipals-indexer/lib/unified/releases";
import {
  marketplaceConsumerState,
  selectSharedMarketplaceConsumer,
  type MarketplaceConsumerSelection
} from "./consumerSelection";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
type Case = "base" | "ethereum" | "polygon" | "bnb-sales" | "bnb-discovery";
let sequence = 0;

// A disposable PostgreSQL fixture with the same columns as the pinned Ponder
// reader. No RPC, production databases or source-reader mocks are used.
async function fixture(
  kind: Case = "base",
  partial = false,
  candidateStart?: string
) {
  const db = createBnbTestDatabase();
  await db.initialize();
  await migrateIndexerControl(db.owner);
  const chain = kind.startsWith("bnb-")
    ? "bnb"
    : (kind as "base" | "ethereum" | "polygon");
  const chainId = marketplaceChains[chain].chainId;
  const discovery = kind === "bnb-discovery";
  const consumer = kind.startsWith("bnb-") ? kind : `collection-sales:${kind}`;
  const policy =
    chain === "base"
      ? ({ kind: "latest" } as const)
      : ({ kind: "finalized" } as const);
  const selection: MarketplaceConsumerSelection = discovery
    ? { kind: "bnb-discovery", policy: bnbValidationPolicy, launchBlock: 1n }
    : kind === "bnb-sales"
      ? {
          kind: "bnb-sales",
          config: { confirmationPolicy: policy, policy: "handover-test" }
        }
      : {
          kind: "collection-sales",
          config: {
            chain: chain as "base" | "ethereum" | "polygon",
            startBlock: "1",
            confirmations: chain === "base" ? 0 : 1,
            policy: "handover-test",
            confirmationPolicy: policy
          }
        };
  const sourceId = discovery ? "marketplace:bnb:seaport" : `ownership:${chain}`;
  const definition = {
    id: sourceId,
    feature: discovery ? ("marketplace" as const) : ("ownership" as const),
    chainId,
    contractName: discovery ? "BnbSeaport" : "TestCollection",
    address: (discovery
      ? seaportDeployment.address
      : marketplaceChains[chain].contractAddress
    ).toLowerCase(),
    startBlock: "1",
    endBlock: null,
    enabled: true,
    abiHash: manifestDigest(discovery ? seaportEventAbi : collectionAbi),
    events: discovery ? ["OrderValidated", "CounterIncremented"] : ["Transfer"],
    receiptRequirement: "full" as const,
    policies: [policy]
  };
  const manifest: IndexerReader["release"]["manifest"] = {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: [definition]
  };
  const now = Date.now(),
    stamp = Math.floor(now / 1000);
  const prefix = `handover_${process.pid}_${++sequence}`;
  const schemas = [`${prefix}_old`, `${prefix}_new`];
  const releases: string[] = [];
  const snapshotId = randomUUID();
  const checkpointName = kind === "bnb-sales" ? "bnb-sales" : "seaport-sales";
  const savedCheckpoint = (
    await db.owner.query(
      "SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE source='chain' AND chain_id=$1 AND name=$2",
      [chainId, checkpointName]
    )
  ).rows[0]?.value;
  const savedDiscovery = (
    await db.owner.query(
      "SELECT to_jsonb(c) AS value FROM yunipals_market.bnb_discovery_cursor c"
    )
  ).rows[0]?.value;
  const savedPolicy = (
    await db.owner.query(
      "SELECT to_jsonb(p) AS value FROM yunipals_market.sale_replay_config p WHERE chain_id=$1",
      [chainId]
    )
  ).rows[0]?.value;
  const receipt = { transactionHash: hash(9001) },
    block = { number: "50", hash: hash(50) };
  const payloadHash = transactionEvidenceHash(receipt, block);

  async function makeReader(schema: string, extraSource: boolean) {
    const selected = structuredClone(manifest);
    if (extraSource && candidateStart !== undefined)
      selected.sources = [{ ...definition, startBlock: candidateStart }];
    if (extraSource)
      selected.sources = [
        ...selected.sources,
        {
          ...definition,
          id: "boosters:unrelated",
          feature: "boosters",
          contractName: "UnrelatedBooster",
          address: null,
          startBlock: null,
          enabled: false,
          receiptRequirement: "none"
        }
      ];
    await db.owner.query(`CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}._ponder_meta(key text PRIMARY KEY,value jsonb);
      CREATE TABLE ${schema}._ponder_checkpoint(chain_name text,chain_id bigint,latest_checkpoint text,safe_checkpoint text,finalized_checkpoint text);
      CREATE TABLE ${schema}.chain_checkpoint(id text,chain_id integer,block_number bigint,block_hash text,parent_hash text,timestamp bigint);
      CREATE TABLE ${schema}.chain_block(LIKE ${schema}.chain_checkpoint);
      CREATE TABLE ${schema}.indexer_source(id text,chain_id integer,manifest_hash text,definition text);
      CREATE TABLE ${schema}.canonical_event(id text PRIMARY KEY,source_id text,chain_id integer,address text,name text,args text,
        abi_hash text,block_number bigint,block_hash text,timestamp bigint,transaction_hash text,transaction_index integer,log_index integer,topics text,data text);
      CREATE TABLE ${schema}.transaction_candidate(id text,chain_id integer,block_number bigint,block_hash text,transaction_hash text);`);
    await db.owner.query(
      `INSERT INTO ${schema}._ponder_meta VALUES('app',$1)`,
      [
        JSON.stringify({
          version: "6",
          build_id: schema,
          heartbeat_at: now,
          is_ready: 1,
          is_locked: 1,
          is_dev: 0
        })
      ]
    );
    const cp = `${String(stamp).padStart(10, "0")}${String(chainId).padStart(16, "0")}${"100".padStart(16, "0")}${"9".repeat(33)}`;
    await db.owner.query(
      `INSERT INTO ${schema}._ponder_checkpoint VALUES($1,$2,$3,$3,$3)`,
      [chain, chainId, cp]
    );
    await db.owner.query(
      `INSERT INTO ${schema}.chain_checkpoint VALUES('head',$1,100,$2,$3,$4)`,
      [chainId, hash(100), hash(99), stamp]
    );
    for (const n of [0, 49, 50, 100])
      await db.owner.query(
        `INSERT INTO ${schema}.chain_block VALUES($1,$2,$3,$4,$5,$6)`,
        [String(n), chainId, n, hash(n), hash(Math.max(0, n - 1)), stamp]
      );
    for (const s of selected.sources)
      await db.owner.query(
        `INSERT INTO ${schema}.indexer_source VALUES($1,$2,$3,$4)`,
        [s.id, s.chainId, sourceManifestHash(selected), JSON.stringify(s)]
      );
    await db.owner.query(
      `INSERT INTO ${schema}.canonical_event VALUES('event', $1,$2,$3,$4,'{}',$5,50,$6,$7,$8,0,0,'[]','0x')`,
      [
        sourceId,
        chainId,
        definition.address,
        definition.events[0],
        definition.abiHash,
        hash(50),
        stamp,
        hash(9001)
      ]
    );
    await db.owner.query(
      `INSERT INTO ${schema}.transaction_candidate VALUES('event',$1,50,$2,$3)`,
      [chainId, hash(50), hash(9001)]
    );
    const release = await registerIndexerRelease(db.owner, {
      schema,
      buildId: schema,
      manifest: selected
    });
    releases.push(release.id);
    await db.owner.query(
      `INSERT INTO yunipals_indexer_control.chain_status
      (release_id,chain_id,head_number,head_hash,head_timestamp,finalized_number,finalized_hash,witness_number,witness_hash,observed_at_ms,provider_id,anchors)
      VALUES($1,$2,100,$3,$4,100,$3,100,$3,$5,'handover-test',$6)`,
      [
        release.id,
        chainId,
        hash(100),
        stamp,
        now,
        JSON.stringify({
          "100": { number: "100", hash: hash(100), timestamp: String(stamp) }
        })
      ]
    );
    return createIndexerReader(db.owner, {
      releaseId: release.id,
      now: () => now
    });
  }
  try {
    const oldReader = await makeReader(schemas[0]!, false);
    const newReader = await makeReader(schemas[1]!, true);
    if (!kind.startsWith("bnb-"))
      await db.owner.query(
        `INSERT INTO yunipals_market.sale_replay_config(chain_id,start_block,confirmations,policy) VALUES($1,1,$2,'handover-test')
     ON CONFLICT(chain_id) DO UPDATE SET start_block=1,confirmations=$2,policy='handover-test'`,
        [chainId, chain === "base" ? 0 : 1]
      );
    const first = await selectSharedMarketplaceConsumer(
      db.owner,
      oldReader,
      selection,
      undefined,
      { replay: true }
    );
    await selectSharedMarketplaceConsumer(
      db.owner,
      oldReader,
      selection,
      first.reviewHash,
      { replay: true }
    );
    const cursor = {
      version: 1,
      releaseId: oldReader.release.id,
      sourceId,
      policy: policy.kind,
      completed: {
        number: partial ? "49" : "100",
        hash: hash(partial ? 49 : 100)
      },
      target: partial ? { number: "100", hash: hash(100) } : null,
      after: partial
        ? {
            id: "event",
            blockNumber: "50",
            blockHash: hash(50),
            transactionIndex: 0,
            logIndex: 0
          }
        : null
    };
    await db.owner.query(
      "UPDATE yunipals_market.shared_indexer_consumer SET cursor=$2,generation=17 WHERE consumer=$1",
      [consumer, JSON.stringify(cursor)]
    );
    if (discovery) {
      await db.owner.query(
        "UPDATE yunipals_market.bnb_discovery_cursor SET next_block=101,scanned_block_hash=$1,last_error_code=NULL,mode='live'",
        [hash(100)]
      );
      await db.owner.query(
        `INSERT INTO yunipals_market.bnb_discovered_order
      (protocol_address,order_hash,contract_address,token_id,maker,side,currency,gross_amount,start_time,end_time,parameters,
       publication_block,publication_hash,publication_tx,publication_log_index,publication_time)
      VALUES($1,$2,$3,1,$3,'listing',$3,1,1,10000,'{}',50,$4,$5,0,50)`,
        [
          definition.address,
          hash(9020),
          marketplaceChains.bnb.contractAddress.toLowerCase(),
          hash(50),
          hash(9001)
        ]
      );
    } else {
      await db.owner.query(
        `UPDATE yunipals_market.checkpoint SET block_number=100,block_hash=$3,coverage_start=1,state='available',last_error_code=NULL
      WHERE source='chain' AND chain_id=$1 AND name=$2`,
        [chainId, checkpointName, hash(100)]
      );
      await db.owner.query(
        `INSERT INTO yunipals_indexer_control.transaction_evidence
      (chain_id,block_number,block_hash,transaction_hash,receipt,block,payload_hash,provider_id) VALUES($1,50,$2,$3,$4,$5,$6,'handover-test')`,
        [chainId, hash(50), hash(9001), receipt, block, payloadHash]
      );
      await db.owner.query(
        `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
      VALUES($1,$2,$3,$4,$5,'handover-test')`,
        [chainId, hash(50), hash(9001), receipt, block]
      );
      await db.owner.query(
        `INSERT INTO yunipals_market.sale_receipt_qualification
      (chain_id,block_hash,transaction_hash,policy,consumer,release_id,source_id,event_id,proof_hash,source_payload_hash)
      SELECT chain_id,block_hash,transaction_hash,'handover-test',$2,$3,$4,'event',
        '0x'||encode(sha256(convert_to(jsonb_build_object('receipt',receipt,'block',block)::text,'UTF8')),'hex'),$5
      FROM yunipals_market.sale_receipt WHERE chain_id=$1 AND transaction_hash=$6`,
        [
          chainId,
          consumer,
          oldReader.release.id,
          sourceId,
          payloadHash,
          hash(9001)
        ]
      );
    }
    await db.owner.query(
      `INSERT INTO yunipals_market.snapshot(id,kind,query_key,header,observed_at,expires_at,row_count)
    VALUES($1,'activity','handover-test','{}',clock_timestamp(),clock_timestamp()+interval '1 hour',0)`,
      [snapshotId]
    );
    const state = () => marketplaceConsumerState(db.owner, consumer, chainId);
    const review = () =>
      selectSharedMarketplaceConsumer(db.owner, newReader, selection);
    return {
      db,
      consumer,
      chainId,
      selection,
      oldReader,
      newReader,
      schemas,
      snapshotId,
      state,
      review,
      close
    };
  } catch (error) {
    await close();
    throw error;
  }
  async function close() {
    await db.owner.query(
      "DELETE FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
      [consumer]
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.shared_indexer_consumer WHERE consumer=$1",
      [consumer]
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=$1 AND transaction_hash=$2",
      [chainId, hash(9001)]
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.bnb_discovered_order WHERE order_hash=$1",
      [hash(9020)]
    );
    await db.owner.query("DELETE FROM yunipals_market.snapshot WHERE id=$1", [
      snapshotId
    ]);
    await db.owner.query(
      "DELETE FROM yunipals_market.checkpoint WHERE source='chain' AND chain_id=$1 AND name=$2",
      [chainId, checkpointName]
    );
    if (savedCheckpoint)
      await db.owner.query(
        "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
        [JSON.stringify(savedCheckpoint)]
      );
    await db.owner.query("DELETE FROM yunipals_market.bnb_discovery_cursor");
    if (savedDiscovery)
      await db.owner.query(
        "INSERT INTO yunipals_market.bnb_discovery_cursor SELECT * FROM jsonb_populate_record(NULL::yunipals_market.bnb_discovery_cursor,$1)",
        [JSON.stringify(savedDiscovery)]
      );
    await db.owner.query(
      "DELETE FROM yunipals_market.sale_replay_config WHERE chain_id=$1",
      [chainId]
    );
    if (savedPolicy)
      await db.owner.query(
        "INSERT INTO yunipals_market.sale_replay_config SELECT * FROM jsonb_populate_record(NULL::yunipals_market.sale_replay_config,$1)",
        [JSON.stringify(savedPolicy)]
      );
    await db.owner.query(
      "DELETE FROM yunipals_indexer_control.transaction_evidence WHERE provider_id='handover-test'"
    );
    await db.owner.query(
      "DELETE FROM yunipals_indexer_control.chain_status WHERE release_id=ANY($1)",
      [releases]
    );
    await db.owner.query(
      "DELETE FROM yunipals_indexer_control.release WHERE id=ANY($1)",
      [releases]
    );
    for (const schema of schemas)
      await db.owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.close();
  }
}

for (const kind of [
  "base",
  "ethereum",
  "polygon",
  "bnb-sales",
  "bnb-discovery"
] as const) {
  test(`${kind}: unrelated release preserves progress, proofs and derived rows`, async () => {
    const f = await fixture(kind, kind === "base");
    try {
      const before = await f.state();
      const review = await f.review();
      assert.equal(review.impact.mode, "preserve");
      assert.equal(review.applyAllowed, true);
      assert.deepEqual(await f.state(), before, "review is read-only");
      await assert.rejects(
        selectSharedMarketplaceConsumer(
          f.db.runtime,
          f.newReader,
          f.selection,
          review.reviewHash
        ),
        /migration owner/
      );
      await selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        review.reviewHash
      );
      const after = await f.state();
      assert.deepEqual(
        "cursor" in before ? after.cursor : after.checkpoint,
        "cursor" in before ? before.cursor : before.checkpoint
      );
      assert.deepEqual(after.common.cursor, {
        ...before.common.cursor,
        releaseId: f.newReader.release.id
      });
      assert.equal(after.common.generation, 18);
      const resumed = await f.newReader.page(
        after.common.source_id,
        after.common.confirmation_policy,
        { cursor: after.common.cursor, includeReceipts: true }
      );
      assert.equal(
        resumed.events.length,
        0,
        "already consumed events are not replayed"
      );
      assert.equal(resumed.cursor.completed?.number, "100");
      await assert.rejects(
        f.oldReader.page(
          after.common.source_id,
          after.common.confirmation_policy,
          { cursor: after.common.cursor }
        ),
        /another release/
      );
      assert.equal(
        (
          await f.db.owner.query(
            "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
            [f.snapshotId]
          )
        ).rows[0].invalidated_at,
        null
      );
      if (kind === "bnb-discovery") {
        assert.equal(
          (
            await f.db.owner.query(
              "SELECT count(*) FROM yunipals_market.bnb_discovered_order WHERE order_hash=$1",
              [hash(9020)]
            )
          ).rows[0].count,
          "1"
        );
      } else {
        const q = (
          await f.db.owner.query(
            "SELECT release_id,source_id,event_id FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
            [f.consumer]
          )
        ).rows;
        assert.deepEqual(q, [
          {
            release_id: f.newReader.release.id,
            source_id: after.common.source_id,
            event_id: "event"
          }
        ]);
      }
      const again = await f.review();
      assert.equal(again.impact.mode, "unchanged");
      await selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        again.reviewHash
      );
      assert.deepEqual(
        await f.state(),
        after,
        "repeating selection is idempotent"
      );
    } finally {
      await f.close();
    }
  });
}

test("historical topic padding preserves marketplace progress but malformed or changed topics block it", async () => {
  const f = await fixture("bnb-discovery", true);
  try {
    const before = await f.state();
    const topic = `0x${"ab".repeat(32)}`;
    await f.db.owner.query(
      `UPDATE ${f.schemas[0]}.canonical_event SET topics=$1`,
      [JSON.stringify([topic])]
    );
    await f.db.owner.query(
      `UPDATE ${f.schemas[1]}.canonical_event SET topics=$1`,
      [
        JSON.stringify([
          topic.toUpperCase().replace("0X", "0x"),
          null,
          null,
          null
        ])
      ]
    );
    const review = await f.review();
    assert.equal(review.impact.mode, "preserve");
    assert.equal(review.applyAllowed, true);
    assert.deepEqual(await f.state(), before, "review does not reset progress");

    await f.db.owner.query(
      `UPDATE ${f.schemas[1]}.canonical_event SET topics=$1`,
      [JSON.stringify([hash(2), null])]
    );
    assert.equal((await f.review()).impact.reason, "canonical_history_changed");
    for (const invalid of [
      [null, topic],
      [topic, null, topic],
      [topic, null, null, null, null],
      ["0x1234"],
      [42],
      { topic },
      null
    ]) {
      for (const schema of f.schemas)
        await f.db.owner.query(
          `UPDATE ${schema}.canonical_event SET topics=$1`,
          [JSON.stringify(invalid)]
        );
      const blocked = await f.review();
      assert.equal(blocked.impact.reason, "canonical_history_changed");
      assert.equal(blocked.applyAllowed, false);
    }
    assert.deepEqual(await f.state(), before);
  } finally {
    await f.close();
  }
});

test("continuity checks every page of a large consumed history", async () => {
  const f = await fixture("base", true);
  try {
    const before = await f.state();
    for (const schema of f.schemas)
      await f.db.owner.query(
        `INSERT INTO ${schema}.canonical_event
         SELECT 'page-'||n,source_id,chain_id,address,name,args,abi_hash,block_number,
           block_hash,timestamp,transaction_hash,n,log_index,topics,data
         FROM ${schema}.canonical_event CROSS JOIN generate_series(1,2001) n
         WHERE id='event'`
      );
    assert.equal((await f.review()).impact.mode, "preserve");
    await f.db.owner.query(
      `UPDATE ${f.schemas[1]}.canonical_event SET data='0x1234' WHERE id='page-2001'`
    );
    assert.equal((await f.review()).impact.reason, "canonical_history_changed");
    await f.db.owner.query(
      `DELETE FROM ${f.schemas[1]}.canonical_event WHERE id='page-2001'`
    );
    assert.equal((await f.review()).impact.reason, "canonical_history_changed");
    assert.deepEqual(
      await f.state(),
      before,
      "review preserves operational state"
    );
    await f.db.owner.query(
      `DELETE FROM ${f.schemas[0]}.canonical_event WHERE id='page-2001'`
    );
    const review = await f.review();
    assert.equal(review.impact.mode, "preserve");
    await selectSharedMarketplaceConsumer(
      f.db.owner,
      f.newReader,
      f.selection,
      review.reviewHash
    );
    const after = await f.state();
    assert("checkpoint" in after && "checkpoint" in before);
    assert.deepEqual(after.checkpoint, before.checkpoint);
    assert.deepEqual(after.common.cursor, {
      ...before.common.cursor,
      releaseId: f.newReader.release.id
    });
  } finally {
    await f.close();
  }
});

test("different, missing or additional events, receipt requirements and reorged anchors require replay", async () => {
  const f = await fixture("base", true);
  try {
    const schema = f.schemas[1]!;
    for (const [change, undo, reason] of [
      [
        `UPDATE ${schema}.canonical_event SET args='{"changed":true}'`,
        `UPDATE ${schema}.canonical_event SET args='{}'`,
        "canonical_history_changed"
      ],
      [
        `UPDATE ${schema}.canonical_event SET source_id='hidden'`,
        `UPDATE ${schema}.canonical_event SET source_id='ownership:base'`,
        "canonical_history_changed"
      ],
      [
        `INSERT INTO ${schema}.canonical_event SELECT 'extra',source_id,chain_id,address,name,args,abi_hash,block_number,block_hash,timestamp,transaction_hash,1,1,topics,data FROM ${schema}.canonical_event`,
        `DELETE FROM ${schema}.canonical_event WHERE id='extra'`,
        "canonical_history_changed"
      ],
      [
        `UPDATE ${schema}.transaction_candidate SET transaction_hash='${hash(1)}'`,
        `UPDATE ${schema}.transaction_candidate SET transaction_hash='${hash(9001)}'`,
        "canonical_history_changed"
      ],
      [
        `UPDATE ${schema}.chain_block SET block_hash='${hash(999)}' WHERE block_number=49`,
        `UPDATE ${schema}.chain_block SET block_hash='${hash(49)}' WHERE block_number=49`,
        "canonical_boundary_unverified"
      ],
      [
        `UPDATE ${schema}.chain_block SET block_number=48 WHERE block_number=49`,
        `UPDATE ${schema}.chain_block SET block_number=49 WHERE block_number=48`,
        "canonical_boundary_unverified"
      ],
      [
        `UPDATE yunipals_indexer_control.transaction_evidence SET receipt='{}' WHERE provider_id='handover-test'`,
        `UPDATE yunipals_indexer_control.transaction_evidence SET receipt='{"transactionHash":"${hash(9001)}"}' WHERE provider_id='handover-test'`,
        "receipt_evidence_unverified"
      ],
      [
        "UPDATE yunipals_market.sale_receipt_qualification SET source_payload_hash='" +
          hash(1) +
          "' WHERE consumer='collection-sales:base'",
        "UPDATE yunipals_market.sale_receipt_qualification SET source_payload_hash='" +
          transactionEvidenceHash(
            { transactionHash: hash(9001) },
            { number: "50", hash: hash(50) }
          ) +
          "' WHERE consumer='collection-sales:base'",
        "receipt_evidence_unverified"
      ]
    ]) {
      await f.db.owner.query(change!);
      const review = await f.review();
      assert.equal(review.impact.mode, "replay");
      assert.equal(review.impact.reason, reason);
      assert.equal(review.applyAllowed, false);
      const before = await f.state();
      await assert.rejects(
        selectSharedMarketplaceConsumer(
          f.db.owner,
          f.newReader,
          f.selection,
          review.reviewHash
        ),
        /cutover blocked/
      );
      assert.deepEqual(
        await f.state(),
        before,
        "blocked cutover preserves the serving consumer"
      );
      assert.equal(
        (
          await f.db.owner.query(
            "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
            [f.snapshotId]
          )
        ).rows[0].invalidated_at,
        null
      );
      assert.equal(
        (
          await f.db.owner.query(
            "SELECT count(*) FROM yunipals_market.marketplace_source_review WHERE review_hash=$1",
            [review.reviewHash]
          )
        ).rows[0].count,
        "0"
      );
      await f.db.owner.query(undo!);
    }
    assert.equal((await f.review()).impact.mode, "preserve");
  } finally {
    await f.close();
  }
});

test("source history or consumer configuration changes cannot preserve progress", async () => {
  const f = await fixture("base", false, "0");
  try {
    assert.equal((await f.review()).impact.reason, "source_definition_changed");
    await f.db.owner.query(
      "DELETE FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
      [f.consumer]
    );
    // Registration identities are immutable, including to the owner.
    await assert.rejects(
      f.db.owner.query(
        "UPDATE yunipals_market.shared_indexer_consumer SET configuration_hash=$2 WHERE consumer=$1",
        [f.consumer, hash(1)]
      ),
      /immutable/
    );
    const config =
      f.selection.kind === "collection-sales" ? f.selection.config : null;
    assert.ok(config);
    await f.db.owner.query(
      "UPDATE yunipals_market.sale_replay_config SET policy='changed-policy' WHERE chain_id=$1",
      [f.chainId]
    );
    const changed = await selectSharedMarketplaceConsumer(
      f.db.owner,
      f.newReader,
      {
        kind: "collection-sales",
        config: { ...config, policy: "changed-policy" }
      }
    );
    assert.equal(changed.impact.reason, "consumer_configuration_changed");
  } finally {
    await f.close();
  }
});

test("unverified discovery handover keeps the selected feed and requires a fresh explicit replay review", async () => {
  const f = await fixture("bnb-discovery");
  try {
    await f.db.owner.query(
      `DELETE FROM ${f.schemas[0]}.chain_block WHERE block_number=100`
    );
    const review = await f.review();
    const before = await f.state();
    assert.equal(review.impact.reason, "canonical_boundary_unverified");
    assert.equal(review.applyAllowed, false);
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        review.reviewHash
      ),
      /cutover blocked/
    );
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        review.reviewHash,
        { replay: true }
      ),
      /changed/
    );
    assert.deepEqual(await f.state(), before);
    assert.equal(
      (
        await f.db.owner.query(
          "SELECT count(*) FROM yunipals_market.bnb_discovered_order WHERE order_hash=$1",
          [hash(9020)]
        )
      ).rows[0].count,
      "1"
    );
  } finally {
    await f.close();
  }
});

test("a consumer without completed history also needs explicit replay", async () => {
  const f = await fixture();
  try {
    await f.db.owner.query(
      "UPDATE yunipals_market.shared_indexer_consumer SET cursor=NULL WHERE consumer=$1",
      [f.consumer]
    );
    const review = await f.review();
    assert.equal(review.impact.reason, "no_completed_history");
    assert.equal(review.applyAllowed, false);
    const before = await f.state();
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        review.reviewHash
      ),
      /cutover blocked/
    );
    assert.deepEqual(await f.state(), before);
  } finally {
    await f.close();
  }
});

test("a stopped previous release is sufficient, but evidence changes during apply abort atomically", async () => {
  const f = await fixture();
  try {
    await f.db.owner.query(
      `UPDATE ${f.schemas[0]}._ponder_meta SET value=jsonb_set(value,'{is_locked}','0')`
    );
    const review = await f.review();
    assert.equal(review.impact.mode, "preserve");
    assert.equal(review.applyAllowed, true);
    const before = await f.state();
    let snapshots = 0;
    const racingReader: IndexerReader = {
      ...f.newReader,
      snapshot: async (...args) => {
        if (++snapshots === 2)
          await f.db.owner.query(
            `UPDATE ${f.schemas[1]}.canonical_event SET data='0x01'`
          );
        return f.newReader.snapshot(...args);
      }
    };
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        racingReader,
        f.selection,
        review.reviewHash
      ),
      /continuity changed/
    );
    assert.deepEqual(await f.state(), before);
    assert.equal(
      (
        await f.db.owner.query(
          "SELECT count(*) FROM yunipals_market.marketplace_source_review WHERE review_hash=$1",
          [review.reviewHash]
        )
      ).rows[0].count,
      "0"
    );
  } finally {
    await f.close();
  }
});

test("a failure while restoring proven qualifications rolls back the entire replacement", async () => {
  const f = await fixture();
  try {
    const review = await f.review(),
      before = await f.state();
    await f.db.owner
      .query(`CREATE FUNCTION yunipals_market.handover_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test handover failure'; END $$;
      CREATE TRIGGER handover_test_failure BEFORE INSERT ON yunipals_market.sale_receipt_qualification
      FOR EACH ROW EXECUTE FUNCTION yunipals_market.handover_test_failure()`);
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        review.reviewHash
      ),
      /test handover failure/
    );
    assert.deepEqual(await f.state(), before);
    assert.equal(
      (
        await f.db.owner.query(
          "SELECT release_id FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
          [f.consumer]
        )
      ).rows[0].release_id,
      f.oldReader.release.id
    );
    assert.equal(
      (
        await f.db.owner.query(
          "SELECT count(*) FROM yunipals_market.marketplace_source_review WHERE review_hash=$1",
          [review.reviewHash]
        )
      ).rows[0].count,
      "0"
    );
  } finally {
    await f.db.owner.query(
      "DROP TRIGGER IF EXISTS handover_test_failure ON yunipals_market.sale_receipt_qualification; DROP FUNCTION IF EXISTS yunipals_market.handover_test_failure()"
    );
    await f.close();
  }
});

test("stale cursor or evidence reviews cannot apply; explicit replay retains the reset path", async () => {
  const f = await fixture();
  try {
    const initial = await f.review();
    await f.db.owner.query(
      "UPDATE yunipals_market.shared_indexer_consumer SET generation=generation+1 WHERE consumer=$1",
      [f.consumer]
    );
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        initial.reviewHash
      ),
      /changed/
    );
    const next = await f.review();
    await f.db.owner.query(
      `UPDATE ${f.schemas[1]}.canonical_event SET data='0x01'`
    );
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        next.reviewHash
      ),
      /changed/
    );
    assert.equal((await f.state()).common.release_id, f.oldReader.release.id);
    const reset = await selectSharedMarketplaceConsumer(
      f.db.owner,
      f.newReader,
      f.selection,
      undefined,
      { replay: true }
    );
    assert.equal(reset.impact.reason, "explicit_replay");
    await assert.rejects(
      selectSharedMarketplaceConsumer(
        f.db.owner,
        f.newReader,
        f.selection,
        reset.reviewHash
      ),
      /changed/
    );
    await selectSharedMarketplaceConsumer(
      f.db.owner,
      f.newReader,
      f.selection,
      reset.reviewHash,
      { replay: true }
    );
    assert.equal((await f.state()).common.cursor, null);
    assert.equal((await f.state()).checkpoint.state, "unavailable");
    assert.equal(
      (
        await f.db.owner.query(
          "SELECT count(*) FROM yunipals_market.sale_receipt_qualification WHERE consumer=$1",
          [f.consumer]
        )
      ).rows[0].count,
      "0"
    );
    assert.ok(
      (
        await f.db.owner.query(
          "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
          [f.snapshotId]
        )
      ).rows[0].invalidated_at
    );
  } finally {
    await f.close();
  }
});
