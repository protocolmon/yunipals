import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { zeroAddress } from "viem";
import { parseMarketOrder } from "@protopals/yunipals-market-core/marketOrder";
import {
  marketplaceChains,
  seaportDeployment
} from "@protopals/yunipals-market-core/registry";

import { createApp } from "@/app";
import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";
import { buyer, seller, cursorHash } from "@/bnb/fixtures/admission";
import { BnbRecoveryService } from "@/bnb/recovery";
import { readEnvironment } from "@/environment";
import { OrderReadService, readOrderSources } from "@/reads/orders";
import { readSnapshotPage } from "@/reads/snapshots";

const db = createBnbTestDatabase();
before(db.initialize);
afterEach(async () => {
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
  );
  await db.clear();
});
after(db.close);
const service = new OrderReadService(db.runtime);
const environment = readEnvironment({
  MARKET_DEPLOYMENT: "staging",
  MARKET_DATABASE_URL: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL")
});
const makeApp = () =>
  createApp(environment, async () => {}, {
    reads: new OrderReadService(db.runtime),
    recovery: new BnbRecoveryService(db.runtime)
  });
beforeEach(async () => {
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
  );
  await db.owner.query(
    `INSERT INTO yunipals_market.checkpoint(source,chain_id,name,block_number,block_hash,state,checked_at)
    VALUES('chain',56,'bnb-order-worker',121,$1,'available',clock_timestamp())
    ON CONFLICT(source,chain_id,name) DO UPDATE SET block_number=121,block_hash=$1,state='available',checked_at=clock_timestamp()`,
    [cursorHash]
  );
  await db.owner.query(
    "UPDATE bnb_indexer.sync_state SET last_scanned_block=100,caught_up_at=clock_timestamp(),last_error=NULL,updated_at=clock_timestamp()"
  );
});

async function admitted(
  side: "listing" | "offer" = "listing",
  tokenId?: bigint,
  salt?: bigint
) {
  const item = await db.setup(side, tokenId, salt);
  const prepared = await item.service.prepare(item.draft);
  await item.service.submit({ ...item.request, preparationId: prepared.id });
  return item;
}
function params(
  view = "listings",
  chain = "bnb",
  rest: Record<string, string> = {}
) {
  return new URLSearchParams({ view, chain, limit: "25", ...rest });
}
function items(page: Awaited<ReturnType<OrderReadService["wallet"]>>) {
  return page.items.map((item) => ({
    order: parseMarketOrder(item.order),
    currentAsset: item.currentAsset as {
      owner: string;
      lifecycle: number;
      hidden: boolean;
      burned: boolean;
    }
  }));
}

test("wallet queries cover accepted maker history beyond current inventory and preserve paused cancellation", async () => {
  const listing = await admitted();
  const offer = await admitted("offer");
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET owner=$1,burned=true,lifecycle=1 WHERE token_id=$2",
    [zeroAddress, listing.input.asset.tokenId]
  );
  const app = makeApp();
  const response = await app.request(
    `/v1/market/wallets/${seller.address}/orders?${params()}`
  );
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].order.orderHash, listing.input.hash);
  assert.equal(page.items[0].currentAsset.burned, true);
  assert.equal(page.items[0].currentAsset.lifecycle, 1);
  assert.equal("provenance" in page, false);
  assert.equal("signature" in page.items[0].order, false);
  const offered = await service.wallet(buyer.address, params("offers-made"));
  assert.equal(items(offered)[0]!.order.orderHash, offer.input.hash);
  const received = await service.wallet(
    seller.address,
    params("offers-received")
  );
  assert.equal(items(received)[0]!.order.orderHash, offer.input.hash);
  const foreign = await service.wallet(
    buyer.address,
    params("offers-received")
  );
  assert.equal(foreign.items.length, 0);
  // Trading remains disabled regardless of readable history.
  assert.equal(
    (await (await app.request("/v1/market/capabilities")).json()).chains.bnb
      .buy,
    false
  );
  const cancellation = await app.request(
    `/v1/market/orders/bnb/${seaportDeployment.address}/${listing.input.hash}/cancellation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: seller.address })
    }
  );
  assert.equal(cancellation.status, 200);
  assert.deepEqual((await cancellation.json()).order, listing.request.order);
});

test("persisted pages bind wallet/view/chain/limit and survive API recreation without changing membership", async () => {
  for (let i = 0; i < 28; i++) await admitted();
  const first = await service.wallet(seller.address, params());
  assert.equal(first.items.length, 25);
  assert.ok(first.nextCursor);
  const reused = await service.wallet(seller.address.toLowerCase(), params());
  assert.equal(reused.snapshot.id, first.snapshot.id);
  await admitted();
  await db.owner.query(
    "UPDATE yunipals_market.orders SET state='cancelled',state_observed_at=clock_timestamp() WHERE maker=$1",
    [seller.address.toLowerCase()]
  );
  const continuation = {
    cursor: first.nextCursor!,
    snapshot: first.snapshot.id
  };
  const app = makeApp();
  const response = await app.request(
    `/v1/market/wallets/${seller.address}/orders?${params("listings", "bnb", continuation)}`
  );
  assert.equal(response.status, 200);
  const second = await response.json();
  assert.equal(second.items.length, 3);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(second.snapshot, first.snapshot);
  assert.equal(
    new Set(
      [...first.items, ...second.items].map(
        (item) => parseMarketOrder(item.order).orderHash
      )
    ).size,
    28
  );
  for (const [wallet, query] of [
    [buyer.address, params("listings", "bnb", continuation)],
    [seller.address, params("history", "bnb", continuation)],
    [seller.address, params("listings", "all", continuation)],
    [
      seller.address,
      params("listings", "bnb", { ...continuation, limit: "10" })
    ]
  ] as const)
    await assert.rejects(
      service.wallet(wallet, query),
      /snapshot_refresh_required/
    );
  await db.owner.query(
    "UPDATE yunipals_market.snapshot SET invalidated_at=clock_timestamp() WHERE id=$1",
    [first.snapshot.id]
  );
  await assert.rejects(
    service.wallet(seller.address, params("listings", "bnb", continuation)),
    /snapshot_refresh_required/
  );
  const refreshed = await service.wallet(seller.address, params("history"));
  assert.equal(refreshed.items.length, 25);
  assert.ok(
    items(refreshed).every((item) => item.order.status === "cancelled")
  );
});

test("stale and future observations remain recoverable without masquerading as current terminal history", async () => {
  const item = await admitted();
  for (const expression of [
    "clock_timestamp()-interval '7 hours 1 second'",
    "clock_timestamp()+interval '31 seconds'"
  ]) {
    await db.owner.query(
      `UPDATE yunipals_market.orders SET state='filled',state_observed_at=${expression} WHERE order_hash=$1`,
      [item.input.hash.toLowerCase()]
    );
    await db.owner.query(
      "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
    );
    assert.equal(
      items(await service.wallet(seller.address, params()))[0]!.order.status,
      "unavailable"
    );
    assert.equal(
      (await service.wallet(seller.address, params("history"))).items.length,
      0
    );
  }
  await db.owner.query(
    "UPDATE yunipals_market.orders SET state_observed_at=clock_timestamp() WHERE order_hash=$1",
    [item.input.hash.toLowerCase()]
  );
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
  );
  assert.equal(
    items(await service.wallet(seller.address, params("history")))[0]!.order
      .status,
    "filled"
  );
  await db.owner.query("DELETE FROM yunipals_read_v4.token WHERE token_id=$1", [
    item.input.asset.tokenId
  ]);
  await db.owner.query(
    "DELETE FROM yunipals_market.snapshot WHERE kind='orders'"
  );
  await assert.rejects(
    service.wallet(seller.address, params("history")),
    /asset_observation_unavailable/
  );
  assert.equal(
    (await new BnbRecoveryService(db.runtime).accepted(item.input.hash))
      .persisted,
    true
  );
});

test("source outages and incomplete providers are explicit and hide executable-looking asset books", async () => {
  const item = await admitted();
  const page = await service.wallet(seller.address, params("listings", "all"));
  assert.deepEqual(
    Object.keys((page as Record<string, unknown>).sources as object).sort(),
    ["base", "bnb", "ethereum", "polygon"]
  );
  assert.equal(
    ((page as Record<string, unknown>).sources as Record<string, string>)
      .polygon,
    "unavailable"
  );
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET state='unavailable' WHERE name='bnb-order-worker'"
  );
  const unavailable = await service.asset(item.input.asset);
  assert.equal(unavailable.sourceStatus, "unavailable");
  assert.deepEqual(unavailable.listings, []);
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET state='available',checked_at=clock_timestamp()-interval '121 seconds' WHERE name='bnb-order-worker'"
  );
  assert.equal(
    (await readOrderSources(db.runtime, new Date())).statuses.bnb,
    "unavailable"
  );
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET checked_at=clock_timestamp() WHERE name='bnb-order-worker'"
  );
  await db.owner.query(
    "UPDATE yunipals_market.checkpoint SET block_number=99 WHERE name='bnb-order-worker'"
  );
  assert.equal(
    (await readOrderSources(db.runtime, new Date())).statuses.bnb,
    "available"
  );
  await db.owner.query("UPDATE bnb_indexer.sync_state SET caught_up_at=NULL");
  assert.equal(
    (await readOrderSources(db.runtime, new Date())).statuses.bnb,
    "syncing"
  );
});

test("visibility is anchored to current ownership and suppressed assets retain identity-only wallet recovery", async () => {
  const item = await admitted();
  const id = randomUUID();
  const token = item.input.asset.tokenId;
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,0,$3,$4,100,0,0)`,
    [id, token, zeroAddress, seller.address.toLowerCase()]
  );
  await db.owner.query(
    `INSERT INTO metadata.token_visibility VALUES('bnb',$1,$2,0,$3,100,0,0)`,
    [token, seller.address.toLowerCase(), id]
  );
  await assert.rejects(service.asset(item.input.asset), /asset_not_found/);
  const page = await service.wallet(seller.address, params());
  assert.equal(items(page)[0]!.currentAsset.hidden, true);
  assert.equal("name" in page.items[0]!, false);
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,0,$3,$4,101,0,0)`,
    [
      randomUUID(),
      token,
      seller.address.toLowerCase(),
      buyer.address.toLowerCase()
    ]
  );
  assert.equal((await service.asset(item.input.asset)).hidden, false);
});

test("available asset books join current lifecycle and maker, and source recovery waits for uncertain orders", async () => {
  // The foundation tests retain a synthetic storage row. Temporarily supply a
  // fresh terminal observation for pre-existing rows, then restore them exactly.
  const saved = await db.owner
    .query(`SELECT chain_id,protocol_address,order_hash,state,state_reason,
    state_observed_at,state_block_number::text,state_block_hash FROM yunipals_market.orders`);
  try {
    await db.owner.query(
      `UPDATE yunipals_market.orders SET state='cancelled',state_reason=NULL,state_observed_at=clock_timestamp(),
      state_block_number=121,state_block_hash=$1`,
      [cursorHash]
    );
    const listing = await admitted();
    const offer = await admitted(
      "offer",
      BigInt(listing.input.asset.tokenId),
      78n
    );
    const asset = await service.asset(listing.input.asset);
    assert.equal(asset.sourceStatus, "available");
    assert.equal(asset.listings.length, 1);
    assert.equal(asset.offers.length, 1);
    assert.equal(asset.listings[0]!.orderHash, listing.input.hash);
    assert.equal(asset.offers[0]!.orderHash, offer.input.hash);
    await db.owner.query(
      "UPDATE yunipals_market.orders SET state='unavailable',state_reason='chain_or_indexer_unavailable' WHERE order_hash=$1",
      [offer.input.hash.toLowerCase()]
    );
    assert.equal(
      (await service.asset(listing.input.asset)).sourceStatus,
      "syncing"
    );
    await db.owner.query(
      "UPDATE yunipals_market.orders SET state_reason='offer_funding_required' WHERE order_hash=$1",
      [offer.input.hash.toLowerCase()]
    );
    const unfunded = await service.asset(listing.input.asset);
    assert.equal(unfunded.sourceStatus, "available");
    assert.equal(unfunded.listings.length, 1);
    assert.equal(unfunded.offers.length, 0);
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET owner=$1 WHERE token_id=$2",
      [buyer.address.toLowerCase(), listing.input.asset.tokenId]
    );
    assert.equal((await service.asset(listing.input.asset)).listings.length, 0);
    await db.owner.query(
      "UPDATE yunipals_read_v4.token SET owner=$1,lifecycle=1 WHERE token_id=$2",
      [seller.address.toLowerCase(), listing.input.asset.tokenId]
    );
    assert.equal((await service.asset(listing.input.asset)).listings.length, 0);
  } finally {
    await db.owner.query(
      `UPDATE yunipals_market.orders o SET state=s.state,state_reason=s.state_reason,
      state_observed_at=s.state_observed_at,state_block_number=s.state_block_number,state_block_hash=s.state_block_hash
      FROM jsonb_to_recordset($1::jsonb) AS s(chain_id integer,protocol_address text,order_hash text,state text,state_reason text,
        state_observed_at timestamptz,state_block_number numeric,state_block_hash text)
      WHERE (o.chain_id,o.protocol_address,o.order_hash)=(s.chain_id,s.protocol_address,s.order_hash)`,
      [JSON.stringify(saved.rows)]
    );
  }
});

test("invalid queries, snapshot expiry and bounded capacity fail explicitly", async () => {
  for (const query of [
    "limit=26",
    "limit=0",
    "chain=bnb&chain=base",
    "view=unknown",
    "cursor=abc",
    "snapshot=abc",
    "unexpected=1"
  ]) {
    const response = await makeApp().request(
      `/v1/market/wallets/${seller.address}/orders?${query}`
    );
    assert.equal(response.status, 400, query);
  }
  assert.equal(
    (
      await makeApp().request(
        `/v1/market/assets/bnb/${marketplaceChains.base.contractAddress}/1`
      )
    ).status,
    400
  );
  const first = await readSnapshotPage(
    db.runtime,
    "orders",
    "test-expiry",
    { limit: 1 },
    async () => ({ header: {}, items: [{ n: 1 }, { n: 2 }] })
  );
  await db.owner.query(
    "UPDATE yunipals_market.snapshot SET observed_at=clock_timestamp()-interval '6 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [first.snapshot.id]
  );
  await assert.rejects(
    readSnapshotPage(
      db.runtime,
      "orders",
      "test-expiry",
      { limit: 1, snapshot: first.snapshot.id, cursor: first.nextCursor! },
      async () => {
        throw new Error("must not build");
      }
    ),
    /snapshot_refresh_required/
  );
  await assert.rejects(
    readSnapshotPage(
      db.runtime,
      "orders",
      "test-capacity",
      { limit: 25 },
      async () => ({
        header: {},
        items: Array.from({ length: 10001 }, () => ({}))
      })
    ),
    /snapshot_capacity/
  );
  assert.equal(
    (
      await db.owner.query(
        "SELECT id FROM yunipals_market.snapshot WHERE query_key='test-capacity'"
      )
    ).rowCount,
    0
  );
  const lock = await db.owner.connect();
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT pg_advisory_xact_lock(732061,4)");
    await assert.rejects(
      readSnapshotPage(
        db.runtime,
        "orders",
        "test-busy",
        { limit: 25 },
        async () => ({ header: {}, items: [] })
      ),
      /snapshot_busy/
    );
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
  }
});
