import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, zeroAddress, zeroHash } from "viem";

import {
  activityScopeKey,
  createActivityClient,
  nextActivityPage,
  parseActivityPage,
  type ActivityItem,
  type ActivityScope
} from "./activity";
import { catalogCurrency } from "./catalogCurrency";
import {
  marketFixture,
  testBuyer,
  testSeller,
  testFeeRecipient
} from "./marketplace.testFixtures";
import {
  bnbOfferCurrency,
  marketplaceChains,
  type MarketplaceChain
} from "./registry";

function item(index = 1, chain: MarketplaceChain = "bnb"): ActivityItem {
  const { summary } = marketFixture();
  const config = marketplaceChains[chain];
  const blockHash = `0x${String(index).padStart(64, "0")}` as const;
  return {
    status: "confirmed",
    currentVisibility: "public",
    sale: {
      asset: {
        ...summary.asset,
        chain,
        chainId: config.chainId,
        contractAddress: config.contractAddress
      },
      orderHash: blockHash,
      protocolAddress: summary.protocolAddress,
      kind: "listing-filled",
      seller: testSeller,
      nftRecipient: testBuyer,
      currency: catalogCurrency(chain, chain === "polygon" ? "weth" : "native"),
      grossAmount: summary.grossAmount,
      sellerProceeds: summary.sellerProceeds,
      fees: summary.fees,
      eventId: `${config.chainId}:${blockHash}:2`,
      transactionHash: blockHash,
      blockNumber: String(100 - index),
      blockHash,
      blockTimestamp: String(1000 - index),
      fulfillmentLogIndex: 2,
      transferLogIndex: 1
    }
  };
}
const scope: ActivityScope = {
  kind: "wallet",
  wallet: testSeller,
  view: "sales",
  chain: "bnb"
};
function page(request: ActivityScope = scope, items = [item()]) {
  const selected =
    request.kind === "asset"
      ? [request.asset.chain]
      : request.chain === "all"
        ? Object.keys(marketplaceChains)
        : [request.chain];
  return {
    schemaVersion: 1,
    query: activityScopeKey(request),
    snapshot: { id: "activity_1", observedAt: "2026-09-05T00:00:00.000Z" },
    chains: Object.fromEntries(
      selected.map((chain) => [
        chain,
        {
          status: "available",
          confirmedThrough: {
            blockNumber: "100",
            blockHash: `0x${"99".repeat(32)}`
          }
        }
      ])
    ),
    total: items.length as number | null,
    items,
    nextCursor: null as string | null
  };
}

test("activity binds exact asset or wallet roles, including gifted and no-longer-owned NFTs", () => {
  const record = item();
  record.currentVisibility = "hidden";
  assert.equal(
    parseActivityPage(page(scope, [record]), scope).items[0].currentVisibility,
    "hidden"
  );
  const received: ActivityScope = {
    ...scope,
    wallet: testBuyer,
    view: "received"
  };
  assert.doesNotThrow(() => parseActivityPage(page(received), received));
  assert.throws(() => parseActivityPage(page(received), scope));
  const outsider: ActivityScope = {
    ...scope,
    wallet: testFeeRecipient,
    view: "all"
  };
  assert.throws(() => parseActivityPage(page(outsider), outsider));
  const asset: ActivityScope = { kind: "asset", asset: record.sale.asset };
  assert.doesNotThrow(() => parseActivityPage(page(asset, [record]), asset));
  const other = { ...asset, asset: { ...asset.asset, tokenId: "999" } };
  assert.throws(() => parseActivityPage(page(other, [record]), other));
});

test("activity validates registered currencies, exact proceeds/fees and nonzero proof fields", () => {
  for (const chain of Object.keys(marketplaceChains) as MarketplaceChain[]) {
    const requested: ActivityScope = { ...scope, chain };
    const record = item(1, chain);
    assert.doesNotThrow(() =>
      parseActivityPage(page(requested, [record]), requested)
    );
    record.sale.kind = "offer-accepted";
    record.sale.currency =
      chain === "bnb" ? bnbOfferCurrency : catalogCurrency(chain, "weth");
    assert.doesNotThrow(() =>
      parseActivityPage(page(requested, [record]), requested)
    );
  }
  for (const change of [
    { seller: zeroAddress },
    { nftRecipient: zeroAddress },
    { grossAmount: "1e18" },
    { sellerProceeds: "1" },
    { currency: { address: testBuyer, symbol: "BNB", decimals: 18 } },
    { currency: { address: zeroAddress, symbol: "WETH", decimals: 18 } },
    { protocolAddress: testBuyer },
    { transactionHash: zeroHash },
    { orderHash: zeroHash },
    { blockHash: zeroHash },
    { fulfillmentLogIndex: 1 },
    { eventId: "wrong" },
    { blockTimestamp: "999999999999999999999" }
  ]) {
    const record = item();
    Object.assign(record.sale, change);
    assert.throws(() => parseActivityPage(page(scope, [record]), scope));
  }
});

test("pending records and records above the canonical confirmation checkpoint are rejected", () => {
  const response = page();
  assert.throws(() =>
    parseActivityPage(
      { ...response, items: [{ ...item(), status: "pending" }] },
      scope
    )
  );
  const future = item();
  future.sale.blockNumber = "101";
  assert.throws(() => parseActivityPage(page(scope, [future]), scope));
  future.sale.blockNumber = "100";
  assert.throws(() => parseActivityPage(page(scope, [future]), scope));
  response.chains.bnb.confirmedThrough = {
    blockNumber: "99",
    blockHash: item().sale.blockHash
  };
  assert.doesNotThrow(() => parseActivityPage(response, scope));
  assert.throws(() =>
    parseActivityPage(
      {
        ...response,
        chains: { bnb: { status: "available", confirmedThrough: null } }
      },
      scope
    )
  );
});

test("partial source coverage keeps confirmed records but cannot claim a complete count or empty history", () => {
  const requested: ActivityScope = { ...scope, chain: "all" };
  const response = page(requested);
  response.chains.ethereum.status = "unavailable";
  response.total = null;
  assert.doesNotThrow(() => parseActivityPage(response, requested));
  assert.throws(() => parseActivityPage({ ...response, total: 1 }, requested));
  assert.throws(() =>
    parseActivityPage(
      { ...response, chains: { bnb: response.chains.bnb } },
      requested
    )
  );
  assert.throws(() => parseActivityPage({ ...page(), total: null }, scope));
  assert.throws(() =>
    parseActivityPage(
      {
        ...page(),
        chains: { bnb: { status: "syncing", confirmedThrough: null } },
        total: null
      },
      scope
    )
  );
});

test("activity coverage binds history bounds, source attribution and unclassified events", () => {
  const response = page();
  const coverage = {
    source: "yunipals",
    fromBlock: "90",
    fromTimestamp: "990",
    excludedEvents: 0
  };
  const withCoverage = (value: object, status = "available") => ({
    ...response,
    total: status === "available" ? 1 : null,
    chains: { bnb: { ...response.chains.bnb, status, coverage: value } }
  });
  assert.doesNotThrow(() => parseActivityPage(withCoverage(coverage), scope));
  assert.doesNotThrow(() =>
    parseActivityPage(
      withCoverage({ ...coverage, excludedEvents: 1 }, "unavailable"),
      scope
    )
  );
  for (const change of [
    { source: "seaport" },
    { fromBlock: "101" },
    { fromBlock: "100" },
    { fromTimestamp: "1000" },
    { fromTimestamp: "99999999999" },
    { excludedEvents: 1 },
    { excludedEvents: -1 },
    { excludedEvents: 0.5 }
  ])
    assert.throws(() =>
      parseActivityPage(withCoverage({ ...coverage, ...change }), scope)
    );
});

test("activity continuations bind the complete snapshot, checkpoints, count and advancing cursors", () => {
  const first = parseActivityPage(
    { ...page(), total: 2, nextCursor: "p2" },
    scope
  );
  const previous = nextActivityPage(first, [first])!;
  const second = { ...page(scope, [item(2)]), total: 2 };
  assert.doesNotThrow(() => parseActivityPage(second, scope, previous));
  for (const change of [
    { query: "wrong" },
    { snapshot: { ...second.snapshot, id: "reorg" } },
    {
      snapshot: { ...second.snapshot, observedAt: "2026-09-05T00:00:01.000Z" }
    },
    { total: 3 },
    {
      chains: {
        bnb: {
          ...second.chains.bnb,
          confirmedThrough: {
            blockNumber: "101",
            blockHash: second.chains.bnb.confirmedThrough.blockHash
          }
        }
      }
    },
    { nextCursor: "p2" },
    { items: [] }
  ])
    assert.throws(() =>
      parseActivityPage({ ...second, ...change }, scope, previous)
    );
});

test("chronological pagination rejects repeats and reorg duplicates rather than silently deduplicating", () => {
  const first = parseActivityPage(
    { ...page(scope, [item(2)]), total: 2, nextCursor: "p2" },
    scope
  );
  const previous = nextActivityPage(first, [first])!;
  for (const record of [item(1), item(2)])
    assert.throws(() =>
      parseActivityPage({ ...page(scope, [record]), total: 2 }, scope, previous)
    );
  const duplicateOrder = item(3);
  duplicateOrder.sale.orderHash = item(2).sale.orderHash;
  assert.throws(() =>
    parseActivityPage(
      { ...page(scope, [duplicateOrder]), total: 2 },
      scope,
      previous
    )
  );
  assert.throws(() =>
    parseActivityPage(
      page(
        scope,
        Array.from({ length: 26 }, (_, i) => item(i + 1))
      ),
      scope
    )
  );
  assert.throws(() => parseActivityPage({ ...page(), total: 2 }, scope));
});

test("partial Seaport fills of one order remain distinct across activity pages", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const requested: ActivityScope = { ...scope, chain };
    const firstFill = item(1, chain);
    const secondFill = item(2, chain);
    secondFill.sale.orderHash = firstFill.sale.orderHash;
    secondFill.sale.asset.tokenId = "2000";
    const together = parseActivityPage(
      page(requested, [firstFill, secondFill]),
      requested
    );
    assert.equal(together.items.length, 2);
    const first = parseActivityPage(
      { ...page(requested, [firstFill]), total: 2, nextCursor: "p2" },
      requested
    );
    const previous = nextActivityPage(first, [first])!;
    const next = parseActivityPage(
      { ...page(requested, [secondFill]), total: 2 },
      requested,
      previous
    );
    assert.equal(next.items[0]!.sale.orderHash, first.items[0]!.sale.orderHash);
    assert.notEqual(next.items[0]!.sale.eventId, first.items[0]!.sale.eventId);
    assert.throws(() =>
      parseActivityPage(
        { ...page(requested, [firstFill]), total: 2 },
        requested,
        previous
      )
    );
  }
});

test("simultaneous chain events use chain, block and log ties while preserving distinct identities", () => {
  const requested: ActivityScope = { ...scope, chain: "all" };
  const ethereum = item(1, "ethereum"),
    bnb = item(1, "bnb"),
    polygon = item(1, "polygon"),
    base = item(1, "base");
  assert.equal(
    parseActivityPage(
      page(requested, [ethereum, bnb, polygon, base]),
      requested
    ).items.length,
    4
  );
  assert.throws(() =>
    parseActivityPage(page(requested, [base, ethereum]), requested)
  );
});

test("activity HTTP scopes, cursor forwarding and snapshot failures use bounded credential-free reads", async () => {
  const requests: URL[] = [];
  const first = parseActivityPage(
    { ...page(), total: 2, nextCursor: "p2" },
    scope
  );
  const previous = nextActivityPage(first, [first])!;
  const client = createActivityClient(
    "https://example.test/indexer",
    async (url, init) => {
      requests.push(new URL(String(url)));
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.cache, "no-store");
      assert.equal(init?.redirect, "error");
      return Response.json({ ...page(scope, [item(2)]), total: 2 });
    }
  );
  await client.activity(scope, previous);
  await assert.rejects(
    client.activity({ ...scope, wallet: testBuyer }, previous)
  );
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].pathname,
    `/indexer/v1/market/wallets/${testSeller}/activity`
  );
  assert.equal(requests[0].searchParams.get("view"), "sales");
  assert.equal(requests[0].searchParams.get("chain"), "bnb");
  assert.equal(requests[0].searchParams.get("cursor"), "p2");
  assert.equal(requests[0].searchParams.get("snapshot"), "activity_1");
  assert.equal(requests[0].searchParams.get("limit"), "25");
  await assert.rejects(
    client.activity(scope, { ...previous, cursor: "../bad" })
  );
  const asset: ActivityScope = { kind: "asset", asset: item().sale.asset };
  const assetClient = createActivityClient(
    "https://example.test",
    async (url) => {
      assert.ok(
        String(url).includes(
          `/assets/bnb/${getAddress(asset.asset.contractAddress)}/123/activity`
        )
      );
      return Response.json(page(asset));
    }
  );
  await assetClient.activity(asset);
});
