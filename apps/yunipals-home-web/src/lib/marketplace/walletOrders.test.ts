import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarketClient,
  marketOrderKey,
  parseCancellationOrder,
  parseWalletOrdersPage,
  type WalletOrdersRequest
} from "./marketApi";
import {
  marketFixture,
  testBuyer,
  testSeller
} from "./marketplace.testFixtures";
import { marketplaceChains } from "./registry";

function fixture() {
  const { summary } = marketFixture();
  const request: WalletOrdersRequest = {
    wallet: testSeller,
    chain: "all",
    view: "listings"
  };
  const item = {
    order: summary,
    currentAsset: {
      owner: testBuyer,
      lifecycle: 3,
      hidden: true,
      burned: false
    }
  };
  const page = {
    schemaVersion: 1,
    wallet: request.wallet,
    view: request.view,
    chain: request.chain,
    snapshot: { id: "snapshot-1", observedAt: "2026-09-05T00:00:00Z" },
    sources: {
      ethereum: "unavailable",
      base: "syncing",
      polygon: "unavailable",
      bnb: "available"
    },
    items: [item],
    nextCursor: "page-2"
  };
  return { request, item, page };
}

test("wallet history retains hidden/transferred/lifecycle-changed listings and unavailable source evidence", () => {
  const { request, page } = fixture();
  page.items[0].order.status = "unavailable";
  const result = parseWalletOrdersPage(page, request);
  assert.equal(result.items[0].currentAsset.hidden, true);
  assert.equal(result.items[0].currentAsset.owner, testBuyer);
  assert.equal(result.items[0].order.lifecycle, 2);
  assert.equal(result.items[0].currentAsset.lifecycle, 3);
  assert.equal(result.sources.ethereum, "unavailable");
  assert.throws(() =>
    parseWalletOrdersPage({ ...page, sources: { bnb: "available" } }, request)
  );
});

test("history rejects another wallet, view, chain, snapshot or non-advancing page", () => {
  const { request, page } = fixture();
  for (const change of [
    { wallet: testBuyer },
    { view: "history" },
    { chain: "bnb" },
    { items: [] }
  ])
    assert.throws(() => parseWalletOrdersPage({ ...page, ...change }, request));
  assert.throws(
    () =>
      parseWalletOrdersPage(page, {
        ...request,
        cursor: "page-2",
        snapshot: "snapshot-1"
      }),
    /pagination/
  );
  assert.throws(
    () =>
      parseWalletOrdersPage(
        { ...page, nextCursor: null },
        { ...request, cursor: "page-2", snapshot: "changed" }
      ),
    /history changed/
  );
  assert.throws(
    () => parseWalletOrdersPage(page, { ...request, cursor: "page-2" }),
    /both/
  );
  assert.throws(
    () =>
      parseWalletOrdersPage(page, {
        ...request,
        cursor: "../../other",
        snapshot: "snapshot-1"
      }),
    /page token/
  );
});

test("view membership binds outgoing makers and incoming offers to the observed NFT owner", () => {
  const { request, page, item } = fixture();
  const offer = marketFixture("offer").summary;
  const received = {
    ...page,
    view: "offers-received",
    items: [
      {
        order: offer,
        currentAsset: { ...item.currentAsset, owner: testSeller }
      }
    ]
  };
  assert.doesNotThrow(() =>
    parseWalletOrdersPage(received, { ...request, view: "offers-received" })
  );
  for (const currentAsset of [
    { ...item.currentAsset, owner: testBuyer },
    { ...item.currentAsset, owner: testSeller, burned: true }
  ])
    assert.throws(() =>
      parseWalletOrdersPage(
        { ...received, items: [{ order: offer, currentAsset }] },
        { ...request, view: "offers-received" }
      )
    );
  assert.throws(() =>
    parseWalletOrdersPage(
      {
        ...page,
        items: [{ ...item, order: { ...item.order, maker: testBuyer } }]
      },
      request
    )
  );
  assert.throws(() =>
    parseWalletOrdersPage(
      { ...page, view: "history" },
      { ...request, view: "history" }
    )
  );
  assert.doesNotThrow(() =>
    parseWalletOrdersPage(
      {
        ...page,
        view: "history",
        items: [{ ...item, order: { ...item.order, status: "cancelled" } }]
      },
      { ...request, view: "history" }
    )
  );
});

test("order keys distinguish chains, and bounded pages reject duplicate identities", () => {
  const { request, page, item } = fixture();
  const ethereum = {
    ...item.order,
    source: "opensea" as const,
    asset: {
      ...item.order.asset,
      chain: "ethereum" as const,
      chainId: 1,
      contractAddress: marketplaceChains.ethereum.contractAddress
    }
  };
  assert.notEqual(marketOrderKey(ethereum), marketOrderKey(item.order));
  assert.doesNotThrow(() =>
    parseWalletOrdersPage(
      { ...page, items: [item, { ...item, order: ethereum }] },
      request
    )
  );
  assert.throws(
    () => parseWalletOrdersPage({ ...page, items: [item, item] }, request),
    /duplicate/
  );
  assert.throws(
    () =>
      parseWalletOrdersPage({ ...page, items: Array(26).fill(item) }, request),
    /list/
  );
  assert.throws(
    () =>
      parseWalletOrdersPage(
        { ...page, chain: "bnb", items: [{ ...item, order: ethereum }] },
        { ...request, chain: "bnb" }
      ),
    /unexpected/
  );
});

test("wallet history requests bind URL scope and forward cursor/snapshot without credentials", async () => {
  const { request, page } = fixture();
  const calls: string[] = [];
  const client = createMarketClient(
    "https://example.test",
    async (url, init) => {
      calls.push(String(url));
      assert.equal(init?.credentials, "omit");
      return Response.json({ ...page, chain: "bnb", nextCursor: null });
    }
  );
  await client.walletOrders({
    ...request,
    chain: "bnb",
    cursor: "page-2",
    snapshot: "snapshot-1"
  });
  const url = new URL(calls[0]);
  assert.equal(url.pathname, `/v1/market/wallets/${testSeller}/orders`);
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("view"), "listings");
  assert.equal(url.searchParams.get("chain"), "bnb");
  assert.equal(url.searchParams.get("cursor"), "page-2");
  assert.equal(url.searchParams.get("snapshot"), "snapshot-1");
});

test("cancellation parameters must identify the NFT and side shown in the reviewed row", () => {
  const { summary, order, quote } = marketFixture();
  const response = {
    schemaVersion: 1,
    chainId: 56,
    protocolAddress: summary.protocolAddress,
    orderHash: summary.orderHash,
    order: quote.order
  };
  assert.deepEqual(parseCancellationOrder(response, summary), order);
  assert.throws(
    () =>
      parseCancellationOrder(response, {
        ...summary,
        asset: { ...summary.asset, tokenId: "124" }
      }),
    /do not match/
  );
  assert.throws(
    () => parseCancellationOrder(response, { ...summary, side: "offer" }),
    /do not match/
  );
});
