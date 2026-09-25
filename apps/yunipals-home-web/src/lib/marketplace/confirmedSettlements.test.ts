import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { encodeEventTopics, erc721Abi, zeroHash } from "viem";

import { DEFAULT_COLLECTION_FILTERS } from "@/lib/collectionFilters";
import {
  recordSettlement,
  forgetSettlement,
  settlementsKey,
  orderWasSettled,
  orderWasFilled,
  applySettlementsToCatalog,
  applySettlementsToAsset,
  applySettlementsToOwnerTokens,
  optimisticSettlementLifetimeMs,
  syncSettlementsFromOwnerTokens,
  type ConfirmedSettlement
} from "@/lib/marketplace/confirmedSettlements";
import {
  eventLog,
  marketFixture,
  receiptFixture,
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import type { CatalogPage } from "@/lib/marketplace/catalog";
import type { MarketAsset } from "@/lib/marketplace/marketApi";
import type { MarketReceiptExpectation } from "@/lib/marketplace/transactionIntent";
import {
  marketplaceChains,
  seaportDeployment
} from "@/lib/marketplace/registry";

function fixture() {
  const { summary } = marketFixture();
  const client = new QueryClient();
  const receipt = receiptFixture();
  const expectation: MarketReceiptExpectation = {
    kind: "buy",
    chainId: 56,
    account: testBuyer,
    asset: summary.asset,
    orderHash: summary.orderHash,
    order: { offerer: testSeller }
  };
  const token = {
    ...summary.asset,
    owner: testSeller,
    lifecycle: summary.lifecycle,
    lastTransferBlock: "0",
    mintBlock: "0",
    burned: false,
    name: "Test",
    image: null,
    attributes: [],
    tokenUri: null,
    rarityPoints: "1",
    rarityPointsCapped: "1"
  };
  const page: CatalogPage = {
    query: "test",
    snapshot: { id: "before-sale", observedAt: new Date().toISOString() },
    sources: {},
    availability: {},
    listingCompleteness: "complete",
    total: 1,
    listedTotal: 1,
    verifiedListedTotal: 1,
    items: [{ token, market: { status: "listed", listings: [summary] } }],
    nextCursor: null
  };
  const changes = () =>
    client.getQueryData<ConfirmedSettlement[]>(settlementsKey) ?? [];
  return { client, receipt, expectation, summary, page, changes };
}

test("verified receipts suppress sales idempotently; approvals and invalid receipts cannot hide orders", () => {
  const f = fixture();
  assert.throws(() =>
    recordSettlement(f.client, f.expectation, {
      ...f.receipt,
      status: "reverted"
    })
  );
  assert.throws(() =>
    recordSettlement(f.client, f.expectation, { ...f.receipt, logs: [] })
  );
  const approval = {
    ...f.receipt,
    logs: [
      eventLog({
        address: f.summary.asset.contractAddress,
        data: "0x",
        topics: encodeEventTopics({
          abi: erc721Abi,
          eventName: "Approval",
          args: {
            owner: testBuyer,
            spender: seaportDeployment.address,
            tokenId: 123n
          }
        })
      })
    ]
  };
  assert.equal(
    recordSettlement(
      f.client,
      {
        kind: "approve-nft",
        chainId: 56,
        account: testBuyer,
        asset: f.summary.asset
      },
      approval
    ),
    undefined
  );
  assert.equal(f.changes().length, 0);
  recordSettlement(f.client, f.expectation, f.receipt, f.summary.lifecycle);
  assert.equal(recordSettlement(f.client, f.expectation, f.receipt), undefined);
  assert.equal(f.changes().length, 1);
  assert.equal(orderWasSettled(f.summary, f.changes()), true);
  forgetSettlement(f.client, 56, f.receipt.transactionHash);
  assert.equal(orderWasSettled(f.summary, f.changes()), false);
  f.client.clear();
});

test("verified purchases appear in buyer holdings until the ownership index is current", () => {
  const f = fixture();
  f.client.setQueryData(["marketplace", "catalog", "fixture"], {
    pages: [f.page],
    pageParams: [undefined]
  });
  recordSettlement(f.client, f.expectation, f.receipt, f.summary.lifecycle);
  const change = f.changes()[0];
  assert.equal(change.token?.owner, testBuyer);
  assert.equal(change.token?.lastTransferBlock, "1");
  assert.deepEqual(
    applySettlementsToOwnerTokens(
      [],
      f.changes(),
      [testBuyer],
      "visible",
      change.confirmedAt
    ),
    [change.token]
  );
  assert.deepEqual(
    applySettlementsToOwnerTokens(
      [],
      f.changes(),
      [testSeller],
      "visible",
      change.confirmedAt
    ),
    []
  );
  assert.deepEqual(
    applySettlementsToOwnerTokens(
      [],
      f.changes(),
      [testBuyer],
      "visible",
      change.confirmedAt + optimisticSettlementLifetimeMs + 1
    ),
    []
  );
  assert.deepEqual(
    applySettlementsToOwnerTokens(
      [change.token!],
      f.changes(),
      [testBuyer],
      "visible",
      change.confirmedAt
    ),
    [change.token]
  );
  syncSettlementsFromOwnerTokens(f.client, [
    { ...change.token!, owner: testBuyer, lastTransferBlock: "1" }
  ]);
  assert.equal(f.changes()[0].synced, true);
  f.client.setQueryData<ConfirmedSettlement[]>(settlementsKey, [
    { ...change, synced: true }
  ]);
  assert.deepEqual(
    applySettlementsToOwnerTokens(
      [],
      f.changes(),
      [testBuyer],
      "visible",
      change.confirmedAt
    ),
    []
  );
  f.client.clear();
});

test("stale pages never restore a sale, presentation counts adjust once, original cursors remain untouched", () => {
  const f = fixture();
  recordSettlement(f.client, f.expectation, f.receipt, f.summary.lifecycle);
  const raw = { pages: [f.page], pageParams: [undefined] };
  const filters = { ...DEFAULT_COLLECTION_FILTERS, sale: "listed" as const };
  const sold = applySettlementsToCatalog(raw, f.changes(), filters);
  assert.equal(sold.pages[0].items.length, 0);
  assert.equal(sold.pages[0].total, 0);
  assert.equal(sold.pages[0].verifiedListedTotal, 0);
  assert.equal(raw.pages[0].items.length, 1);
  assert.deepEqual(
    applySettlementsToCatalog(structuredClone(raw), f.changes(), filters),
    sold
  );
  assert.deepEqual(applySettlementsToCatalog(sold, f.changes(), filters), sold);
  const all = applySettlementsToCatalog(
    raw,
    f.changes(),
    DEFAULT_COLLECTION_FILTERS
  );
  assert.equal(all.pages[0].total, 1);
  assert.equal(all.pages[0].items[0].market.status, "purchased");
  assert.equal(all.pages[0].items[0].market.listings.length, 0);
  const fresh = {
    ...raw,
    pages: [
      { ...f.page, items: [], total: 0, listedTotal: 0, verifiedListedTotal: 0 }
    ]
  };
  assert.deepEqual(
    applySettlementsToCatalog(fresh, f.changes(), filters),
    fresh
  );
  f.client.clear();
});

test("scope is chain/asset/order aware and permits new owner listings and later lifecycles", () => {
  const f = fixture();
  recordSettlement(f.client, f.expectation, f.receipt, f.summary.lifecycle);
  const other = { ...f.summary, orderHash: zeroHash };
  assert.equal(orderWasSettled(other, f.changes()), true);
  assert.equal(
    orderWasSettled({ ...other, maker: testBuyer }, f.changes()),
    false
  );
  assert.equal(
    orderWasSettled(
      { ...other, lifecycle: f.summary.lifecycle + 1 },
      f.changes()
    ),
    false
  );
  assert.equal(orderWasSettled(other, f.changes(), "2"), false);
  assert.equal(
    orderWasSettled(
      {
        ...f.summary,
        asset: {
          ...f.summary.asset,
          chain: "ethereum",
          chainId: 1,
          contractAddress: marketplaceChains.ethereum.contractAddress
        }
      },
      f.changes()
    ),
    false
  );
  assert.equal(
    orderWasSettled({ ...other, side: "offer" }, f.changes()),
    false
  );
  f.client.clear();
});

test("asset detail hides the filled order while preserving unrelated offers", () => {
  const f = fixture();
  recordSettlement(f.client, f.expectation, f.receipt);
  const offer = { ...f.summary, side: "offer" as const, orderHash: zeroHash };
  const asset: MarketAsset = {
    asset: f.summary.asset,
    lifecycle: f.summary.lifecycle,
    owner: testSeller,
    burned: false,
    hidden: false,
    sourceStatus: "available",
    updatedAt: new Date().toISOString(),
    availability: {
      chain: "bnb",
      evidence: "current",
      listings: { status: "complete", completedAt: null, revision: null },
      offers: { status: "complete", completedAt: null, revision: null }
    },
    listingState: "listed",
    offerAvailability: "complete",
    listings: [f.summary],
    offers: [offer]
  };
  const result = applySettlementsToAsset(asset, f.changes());
  assert.equal(result.listings.length, 0);
  assert.deepEqual(result.offers, [offer]);
  f.client.clear();
});

test("offer acceptance suppresses the filled offer and seller listings without hiding other offers", () => {
  const f = fixture();
  const receipt = {
    ...f.receipt,
    logs: [
      f.receipt.logs[0],
      eventLog({
        address: f.summary.asset.contractAddress,
        data: "0x",
        topics: encodeEventTopics({
          abi: erc721Abi,
          eventName: "Transfer",
          args: { from: testBuyer, to: testSeller, tokenId: 123n }
        })
      })
    ]
  };
  recordSettlement(
    f.client,
    { ...f.expectation, kind: "accept-offer" },
    receipt
  );
  assert.equal(
    orderWasSettled({ ...f.summary, side: "offer" }, f.changes()),
    true
  );
  assert.equal(
    orderWasSettled(
      { ...f.summary, orderHash: zeroHash, maker: testBuyer },
      f.changes()
    ),
    true
  );
  assert.equal(
    orderWasSettled(
      { ...f.summary, orderHash: zeroHash, side: "offer" },
      f.changes()
    ),
    false
  );
  f.client.clear();
});

test("a replacement canonical block updates receipt identity without duplicating the settlement", () => {
  const f = fixture();
  recordSettlement(f.client, f.expectation, f.receipt);
  const replacement = {
    ...f.receipt,
    blockHash: `0x${"b".repeat(64)}` as const,
    blockNumber: 2n
  };
  recordSettlement(f.client, f.expectation, replacement);
  assert.equal(f.changes().length, 1);
  assert.equal(f.changes()[0].blockHash, replacement.blockHash);
  f.client.clear();
});

test("a late multi-page response cannot resurrect a sold NFT or decrement other chains", () => {
  const f = fixture();
  const otherAsset = {
    ...f.summary.asset,
    chain: "ethereum" as const,
    chainId: 1,
    contractAddress: marketplaceChains.ethereum.contractAddress
  };
  const other = {
    token: { ...f.page.items[0].token, ...otherAsset },
    market: {
      status: "listed" as const,
      listings: [{ ...f.summary, asset: otherAsset }]
    }
  };
  const raw = {
    pages: [
      {
        ...f.page,
        items: [other],
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2,
        nextCursor: "second"
      },
      { ...f.page, total: 2, listedTotal: 2, verifiedListedTotal: 2 }
    ],
    pageParams: [undefined, "second"]
  };
  const lateResponse = structuredClone(raw);
  recordSettlement(f.client, f.expectation, f.receipt);
  const displayed = applySettlementsToCatalog(lateResponse, f.changes(), {
    ...DEFAULT_COLLECTION_FILTERS,
    sale: "listed"
  });
  assert.equal(displayed.pages[0].items.length, 1);
  assert.equal(displayed.pages[1].items.length, 0);
  assert.equal(displayed.pages[0].total, 1);
  assert.equal(displayed.pages[1].listedTotal, 1);
  assert.deepEqual(displayed.pageParams, raw.pageParams);
  assert.equal(raw.pages[1].items.length, 1);
  f.client.clear();
});

test("wallet management keeps other signed orders cancellable after ownership changes", () => {
  const f = fixture();
  recordSettlement(f.client, f.expectation, f.receipt);
  assert.equal(orderWasFilled(f.summary, f.changes()), true);
  assert.equal(
    orderWasFilled(
      { ...f.summary, orderHash: zeroHash, status: "unavailable" },
      f.changes()
    ),
    false
  );
  f.client.clear();
});
