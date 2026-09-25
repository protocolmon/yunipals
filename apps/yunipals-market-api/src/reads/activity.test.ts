import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import {
  parseActivityPage,
  nextActivityPage,
  type ActivityScope
} from "@protopals/yunipals-market-core/activity";
import type { ObservedMarketSale } from "@protopals/yunipals-market-core/settledSale";

import { ActivityReadService, readActivitySources } from "@/reads/activity";
import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";
import { buyer, seller, timestamp } from "@/bnb/fixtures/admission";
import { createApp } from "@/app";
import { readEnvironment } from "@/environment";

const db = createBnbTestDatabase();
const where = "source='chain' AND chain_id=56 AND name='bnb-sales'";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const gift = getAddress(`0x${"03".repeat(20)}`);
let saved: unknown;
let ready = false;
let sequence = 0;
before(async () => {
  await db.initialize();
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale WHERE chain_id=56"
      )
    ).rows[0].count,
    "0"
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.sale_receipt WHERE chain_id=56"
      )
    ).rows[0].count,
    "0"
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*) FROM yunipals_market.snapshot WHERE kind='activity'"
      )
    ).rows[0].count,
    "0"
  );
  saved = (
    await db.owner.query(
      `SELECT to_jsonb(c) AS value FROM yunipals_market.checkpoint c WHERE ${where}`
    )
  ).rows[0].value;
  ready = true;
});
beforeEach(async () => {
  if (!ready) return;
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET block_number=2000,block_hash=$1,coverage_start=1000,
    coverage_start_time=$2,replay_from=NULL,state='available',last_error_code=NULL,
    checked_at=clock_timestamp(),canonical_generation=canonical_generation+1 WHERE ${where}`,
    [hash(2000), timestamp.toString()]
  );
});
afterEach(async () => {
  if (!ready) return;
  await db.owner.query(
    "UPDATE yunipals_market.deployment SET environment='staging' WHERE singleton"
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=56");
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
  );
  await db.clear();
});
after(async () => {
  try {
    if (ready) {
      await db.owner.query(
        `DELETE FROM yunipals_market.checkpoint WHERE ${where}`
      );
      await db.owner.query(
        "INSERT INTO yunipals_market.checkpoint SELECT * FROM jsonb_populate_record(NULL::yunipals_market.checkpoint,$1)",
        [JSON.stringify(saved)]
      );
    }
  } finally {
    await db.close();
  }
});
const environment = readEnvironment({
  MARKET_DEPLOYMENT: "staging",
  MARKET_DATABASE_URL: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL")
});
const app = () =>
  createApp(environment, async () => {}, {
    activity: new ActivityReadService(db.runtime)
  });
const scope = (
  wallet: Address = seller.address,
  view: "all" | "sales" | "received" = "all",
  chain: "all" | "bnb" = "bnb"
): ActivityScope => ({ kind: "wallet", wallet, view, chain });
const path = (s: ActivityScope) =>
  s.kind === "wallet"
    ? `/v1/market/wallets/${s.wallet}/activity?chain=${s.chain}&view=${s.view}`
    : `/v1/market/assets/${s.asset.chain}/${s.asset.contractAddress}/${s.asset.tokenId}/activity?`;
async function read(s: ActivityScope, suffix = "", status = 200) {
  const response = await app().request(path(s) + suffix);
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

// Projection fixtures exercise the SQL/HTTP contract. The independent replay
// tests and actual fork harness establish receipt verification before persistence.
async function persisted(
  side: "listing" | "offer" = "listing",
  recipient: Address = buyer.address
) {
  const item = await db.setup(side);
  const prepared = await item.service.prepare(item.draft);
  const accepted = await item.service.submit({
    ...item.request,
    preparationId: prepared.id
  });
  const order = accepted.order;
  const number = 1000 + ++sequence;
  const sale: ObservedMarketSale = {
    eventId: `56:${hash(number)}:3`,
    asset: order.asset,
    orderHash: order.orderHash,
    protocolAddress: order.protocolAddress,
    kind: side === "listing" ? "listing-filled" : "offer-accepted",
    seller: seller.address,
    nftRecipient: recipient,
    currency: order.currency,
    grossAmount: order.grossAmount,
    sellerProceeds: order.sellerProceeds,
    fees: order.fees,
    transactionHash: hash(100000 + number),
    blockNumber: String(number),
    blockHash: hash(number),
    blockTimestamp: timestamp.toString(),
    fulfillmentLogIndex: 3,
    transferLogIndex: 2
  };
  const receipt = {
    status: "success",
    blockNumber: sale.blockNumber,
    blockHash: sale.blockHash,
    transactionHash: sale.transactionHash
  };
  await db.owner.query(
    `INSERT INTO yunipals_market.sale_receipt(chain_id,block_hash,transaction_hash,receipt,block,confirmation_policy)
    VALUES(56,$1,$2,$3,$4,'bnb-local-validation-depth-20-v1')`,
    [
      sale.blockHash,
      sale.transactionHash,
      receipt,
      {
        number: sale.blockNumber,
        hash: sale.blockHash,
        timestamp: sale.blockTimestamp
      }
    ]
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.sale(chain_id,block_number,block_hash,log_index,transaction_hash,protocol_address,order_hash,
    contract_address,token_id,seller,nft_recipient,observation,canonical,block_timestamp)
    VALUES(56,$1,$2,3,$3,$4,$5,$6,$7,$8,$9,$10,true,to_timestamp($11))`,
    [
      sale.blockNumber,
      sale.blockHash,
      sale.transactionHash,
      sale.protocolAddress.toLowerCase(),
      sale.orderHash.toLowerCase(),
      sale.asset.contractAddress.toLowerCase(),
      sale.asset.tokenId,
      sale.seller.toLowerCase(),
      sale.nftRecipient.toLowerCase(),
      sale,
      sale.blockTimestamp
    ]
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET state='available',last_error_code=NULL,replay_from=NULL,checked_at=clock_timestamp() WHERE ${where}`
  );
  return { item, sale };
}

test("HTTP activity returns exact seller/recipient roles and includes gifts without inventing a payer", async () => {
  await persisted("listing", gift);
  const offer = await persisted("offer");
  const sales = parseActivityPage(
    await read(scope(seller.address, "sales")),
    scope(seller.address, "sales")
  );
  assert.equal(sales.total, 2);
  const stored = (
    await db.runtime.query(
      "SELECT header FROM yunipals_market.snapshot WHERE id=$1",
      [sales.snapshot.id]
    )
  ).rows[0].header;
  assert.equal(stored.provenance.checkpoints.bnb.coverageStartBlock, "1000");
  assert.equal(
    stored.provenance.checkpoints.bnb.confirmationPolicy,
    "bnb-local-validation-depth-20-v1"
  );
  assert.ok(!("provenance" in (await read(scope(seller.address, "sales")))));
  assert.equal(sales.items[0]?.sale.kind, "offer-accepted");
  const received = parseActivityPage(
    await read(scope(gift, "received")),
    scope(gift, "received")
  );
  assert.equal(received.total, 1);
  assert.equal(received.items[0]?.sale.nftRecipient, gift);
  assert.equal(
    parseActivityPage(await read(scope(gift, "sales")), scope(gift, "sales"))
      .total,
    0
  );
  const asset: ActivityScope = { kind: "asset", asset: offer.sale.asset };
  assert.equal(
    parseActivityPage(await read(asset), asset).items[0]?.sale.eventId,
    offer.sale.eventId
  );
  assert.ok(!JSON.stringify(sales).includes('"payer"'));
});

test("production activity validates and reports the finalized BNB proof policy", async () => {
  const item = await persisted();
  await db.owner.query(
    "UPDATE yunipals_market.sale_receipt SET confirmation_policy='bnb-finalized-tag-v1' WHERE chain_id=56 AND transaction_hash=$1",
    [item.sale.transactionHash.toLowerCase()]
  );
  await db.owner.query(
    "UPDATE yunipals_market.deployment SET environment='production' WHERE singleton"
  );
  const result = parseActivityPage(await read(scope()), scope());
  assert.equal(result.total, 1);
  const stored = (
    await db.runtime.query(
      "SELECT header FROM yunipals_market.snapshot WHERE id=$1",
      [result.snapshot.id]
    )
  ).rows[0].header;
  assert.equal(
    stored.provenance.checkpoints.bnb.confirmationPolicy,
    "bnb-finalized-tag-v1"
  );
});

test("self-sales occur once in all and belong to both role views", async () => {
  await persisted("listing", seller.address);
  for (const view of ["all", "sales", "received"] as const)
    assert.equal(
      parseActivityPage(
        await read(scope(seller.address, view)),
        scope(seller.address, view)
      ).total,
      1
    );
});

test("full count and stable continuation survive a recreated API and later admitted sales", async () => {
  for (let i = 0; i < 4; i++) await persisted();
  const s = scope();
  const first = parseActivityPage(await read(s, "&limit=2"), s);
  assert.equal(first.total, 4);
  const continuation = nextActivityPage(first, [first])!;
  await persisted();
  const second = parseActivityPage(
    await read(
      s,
      `&limit=2&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`
    ),
    s,
    continuation
  );
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  assert.equal(second.total, 4);
  assert.deepEqual(second.chains, first.chains);
  await read(
    scope(buyer.address),
    `&limit=2&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`,
    409
  );
  await read(
    s,
    `&limit=3&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`,
    409
  );
});

test("all-chain and recovering histories distinguish incomplete sources from empty history", async () => {
  await persisted();
  const all = scope(seller.address, "all", "all");
  const partial = parseActivityPage(await read(all), all);
  assert.equal(partial.total, null);
  assert.equal(partial.items.length, 1);
  assert.equal(partial.chains.ethereum?.status, "unavailable");
  assert.equal(partial.chains.bnb?.status, "available");
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET state='syncing',last_error_code='canonical_replay_required' WHERE ${where}`
  );
  const recovering = parseActivityPage(await read(scope()), scope());
  assert.equal(recovering.total, null);
  assert.equal(recovering.items.length, 1);
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='activity'"
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET state='unavailable',last_error_code='sale_replay_failed' WHERE ${where}`
  );
  const unavailable = parseActivityPage(await read(scope()), scope());
  assert.equal(unavailable.total, null);
  assert.equal(unavailable.items.length, 0);
  assert.equal(unavailable.chains.bnb?.confirmedThrough, null);
});

test("temporary source failure rejects later pages and recovery preserves their stable view", async () => {
  await persisted();
  await persisted();
  const first = parseActivityPage(await read(scope(), "&limit=1"), scope());
  const suffix = `&limit=1&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`;
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET state='unavailable',last_error_code='sale_replay_failed' WHERE ${where}`
  );
  await read(scope(), suffix, 503);
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET state='available',last_error_code=NULL WHERE ${where}`
  );
  assert.equal(
    parseActivityPage(
      await read(scope(), suffix),
      scope(),
      nextActivityPage(first, [first])
    ).total,
    2
  );
});

test("reorg epoch invalidates even a snapshot that escaped the bulk invalidation write", async () => {
  await persisted();
  await persisted();
  const first = parseActivityPage(await read(scope(), "&limit=1"), scope());
  // Model a snapshot INSERT committing after a rewind's bulk UPDATE. Its captured
  // epoch still proves it belongs to the old branch, even without invalidated_at.
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET canonical_generation=canonical_generation+1 WHERE ${where}`
  );
  await read(
    scope(),
    `&limit=1&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`,
    409
  );
  assert.ok(
    (
      await db.owner.query(
        "SELECT invalidated_at FROM yunipals_market.snapshot WHERE id=$1",
        [first.snapshot.id]
      )
    ).rows[0].invalidated_at
  );
});

test("visibility changes invalidate all pages while hidden/burned/missing wallet identities retain sale history", async () => {
  const hidden = await persisted();
  const burned = await persisted();
  const missing = await persisted();
  const first = parseActivityPage(await read(scope(), "&limit=1"), scope());
  const tokenId = hidden.sale.asset.tokenId;
  const anchor = randomUUID();
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.transfer_event(id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index)
    VALUES($1,'bnb',$2,0,$3,$4,100,0,0)`,
    [anchor, tokenId, buyer.address.toLowerCase(), seller.address.toLowerCase()]
  );
  await db.owner.query(
    `INSERT INTO metadata.token_visibility(collection,token_id,owner,lifecycle,anchor_event_id,anchor_block,anchor_transaction_index,anchor_log_index)
    VALUES('bnb',$1,$2,0,$3,100,0,0)`,
    [tokenId, seller.address.toLowerCase(), anchor]
  );
  await read(
    scope(),
    `&limit=1&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`,
    409
  );
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET burned=true WHERE collection='bnb' AND token_id=$1",
    [burned.sale.asset.tokenId]
  );
  await db.owner.query(
    "DELETE FROM yunipals_read_v4.token WHERE collection='bnb' AND token_id=$1",
    [missing.sale.asset.tokenId]
  );
  const fresh = parseActivityPage(await read(scope()), scope());
  assert.equal(fresh.total, 3);
  assert.deepEqual(
    fresh.items.map((item) => item.currentVisibility),
    ["unknown", "burned", "hidden"]
  );
  await read({ kind: "asset", asset: hidden.sale.asset }, "", 404);
  await read({ kind: "asset", asset: missing.sale.asset }, "", 404);
  assert.equal(
    parseActivityPage(await read({ kind: "asset", asset: burned.sale.asset }), {
      kind: "asset",
      asset: burned.sale.asset
    }).total,
    1
  );
  assert.ok(!JSON.stringify(fresh).includes('"image"'));
});

test("missing proof and inconsistent checkpoint boundary fail rather than erase a sale", async () => {
  const one = await persisted();
  await db.owner.query(
    "DELETE FROM yunipals_market.sale_receipt WHERE chain_id=56"
  );
  await read(scope(), "", 503);
  await db.owner.query("DELETE FROM yunipals_market.sale WHERE chain_id=56");
  await db.clear();
  const two = await persisted();
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET block_number=$1,block_hash=$2 WHERE ${where}`,
    [two.sale.blockNumber, hash(99999)]
  );
  await read(scope(), "", 503);
  assert.notEqual(one.sale.eventId, two.sale.eventId);
});

test("invalid scope/duplicate parameters, expired snapshots and stale confirmation checks fail explicitly", async () => {
  await persisted();
  await persisted();
  for (const suffix of [
    "&chain=bnb",
    "&limit=0",
    "&limit=26",
    "&view=offers",
    "&unknown=true",
    "&cursor=abc"
  ])
    await read(scope(), suffix, 400);
  await read(scope(`0x${"00".repeat(20)}`), "", 400);
  const first = parseActivityPage(await read(scope(), "&limit=1"), scope());
  await db.owner.query(
    "UPDATE yunipals_market.snapshot SET expires_at=observed_at+interval '1 millisecond',observed_at=observed_at-interval '1 hour' WHERE id=$1",
    [first.snapshot.id]
  );
  await read(
    scope(),
    `&limit=1&snapshot=${first.snapshot.id}&cursor=${first.nextCursor}`,
    409
  );
  await db.owner.query(
    `UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp()-interval '7 minutes' WHERE ${where}`
  );
  const sources = await readActivitySources(db.runtime, ["bnb"], new Date());
  assert.equal(sources.chains.bnb?.status, "unavailable");
  assert.equal(sources.chains.bnb?.confirmedThrough, null);
});
