import assert from "node:assert/strict";
import test from "node:test";
import { maxUint256, zeroAddress } from "viem";

import {
  clearMarketFilters,
  cloneCollectionFilters,
  collectionFiltersKey,
  collectionFiltersToTokenQuery,
  DEFAULT_COLLECTION_FILTERS,
  parseCollectionFilters,
  priceCurrencyForFilters,
  serializeCollectionFilters,
  updateCollectionChains,
  updateCollectionCurrency,
  type CollectionFilters
} from "@/lib/collectionFilters";
import {
  createCatalogClient,
  nextCatalogPage,
  parseCatalogPage,
  parseCatalogPrice,
  validateCatalogFilters,
  type CatalogItem
} from "@/lib/marketplace/catalog";
import {
  marketFixture,
  testBuyer,
  testSeller
} from "@/lib/marketplace/marketplace.testFixtures";
import { marketplaceChains } from "@/lib/marketplace/registry";
import { catalogCurrency } from "@/lib/marketplace/catalogCurrency";
import {
  openseaCurrencies,
  type OpenSeaChain
} from "@/lib/marketplace/openseaRegistry";

function filters(change: Partial<CollectionFilters> = {}): CollectionFilters {
  return {
    ...cloneCollectionFilters(DEFAULT_COLLECTION_FILTERS),
    chains: ["bnb"],
    ...change
  };
}
function item(tokenId = "123", amount = "1000000000000000000"): CatalogItem {
  const { summary } = marketFixture();
  const asset = { ...summary.asset, tokenId };
  return {
    token: {
      ...asset,
      owner: testSeller,
      burned: false,
      hidden: false,
      lifecycle: 2,
      mintBlock: "1",
      lastTransferBlock: "2",
      name: `Yunipal ${tokenId}`,
      image: null,
      tokenUri: null,
      metadataAvailable: true,
      attributes: [{ trait_type: "Type", value: "Fire" }],
      rarityPoints: "150",
      rarityPointsCapped: "100"
    },
    market: {
      status: "listed",
      listings: [
        {
          ...summary,
          asset,
          grossAmount: amount,
          sellerProceeds: amount,
          fees: []
        }
      ]
    }
  };
}
function page(query = filters(), items = [item()]) {
  const selected = query.chains.length
    ? query.chains
    : (["ethereum", "base", "polygon", "bnb"] as const);
  const listed = items.filter((item) => item.market.status === "listed").length;
  return {
    schemaVersion: 2,
    query: collectionFiltersKey(query),
    snapshot: { id: "catalog_1", observedAt: "1970-01-01T00:02:00.000Z" },
    sources: Object.fromEntries(selected.map((chain) => [chain, "available"])),
    availability: Object.fromEntries(
      selected.map((chain) => [
        chain,
        {
          chain,
          evidence: "current",
          listings: { status: "complete", completedAt: null, revision: "1" },
          offers: { status: "complete", completedAt: null, revision: "1" }
        }
      ])
    ),
    listingCompleteness: "complete",
    total: items.length,
    listedTotal: listed,
    verifiedListedTotal: listed,
    items,
    nextCursor: null as string | null
  };
}

function openSeaItem(
  chain: OpenSeaChain,
  currency: "native" | "weth",
  tokenId = "123",
  amount = "1000000000000000000"
) {
  const row = item(tokenId, amount);
  const config = marketplaceChains[chain];
  const asset = {
    chain,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId
  };
  row.token = { ...row.token, ...asset };
  const { key: _key, ...payment } = catalogCurrency(chain, currency);
  row.market.listings[0] = {
    ...row.market.listings[0],
    asset,
    source: "opensea",
    currency: payment
  };
  return row;
}

test("WETH filters bind each chain's token address, exact amount bounds and one selected listing", () => {
  for (const chain of ["ethereum", "base", "polygon"] as const) {
    const query = filters({
      chains: [chain],
      sale: "listed",
      currency: "weth",
      priceMin: "0.000000000000000001",
      priceMax: "1",
      sort: "price-asc"
    });
    const parsed = parseCollectionFilters(serializeCollectionFilters(query));
    assert.equal(collectionFiltersKey(parsed), collectionFiltersKey(query));
    assert.equal(
      validateCatalogFilters(parsed).currency?.address.toLowerCase(),
      openseaCurrencies[chain].address.toLowerCase()
    );
    assert.equal(validateCatalogFilters(parsed).min, 1n);
    assert.doesNotThrow(() =>
      parseCatalogPage(page(query, [openSeaItem(chain, "weth")]), query)
    );
    for (const row of [
      openSeaItem(chain, "native"),
      openSeaItem(chain, "weth", "123", "1000000000000000001"),
      openSeaItem(chain, "weth", "123", "0")
    ])
      assert.throws(() => parseCatalogPage(page(query, [row]), query));
    const both = openSeaItem(chain, "weth");
    both.market.listings.push(openSeaItem(chain, "native").market.listings[0]);
    assert.throws(() => parseCatalogPage(page(query, [both]), query));
    const all = filters({ chains: [chain] });
    assert.equal(
      parseCatalogPage(page(all, [both]), all).items[0].market.listings.length,
      2
    );
    const native = { ...query, currency: "native" as const };
    assert.doesNotThrow(() =>
      parseCatalogPage(page(native, [openSeaItem(chain, "native")]), native)
    );
  }
});

test("unfiltered catalog rejects foreign token addresses and spoofed WETH metadata", () => {
  const query = filters({ chains: ["polygon"] });
  for (const change of [
    { address: testBuyer },
    { address: openseaCurrencies.ethereum.address },
    { symbol: "ETH" },
    { symbol: "POL" },
    { decimals: 6 }
  ]) {
    const row = openSeaItem("polygon", "weth");
    Object.assign(row.market.listings[0].currency, change);
    assert.throws(() => parseCatalogPage(page(query, [row]), query));
  }
});

test("unknown, conflicting, BNB and multichain WETH currency requests never broaden to metadata browsing", () => {
  for (const search of [
    "chain=polygon&currency=USDT",
    "chain=polygon&currency=",
    "chain=polygon&currency=weth&currency=native",
    "chain=polygon&currency=all&currency=weth",
    "chain=bnb&currency=weth&sale=listed",
    "chain=ethereum&chain=polygon&currency=weth&sale=listed"
  ]) {
    const query = parseCollectionFilters(new URLSearchParams(search));
    assert.throws(() => validateCatalogFilters(query));
    assert.throws(() => collectionFiltersToTokenQuery(query));
  }
  assert.equal(
    parseCollectionFilters(new URLSearchParams("currency=weth&currency=weth"))
      .currency,
    "weth"
  );
});

test("currency changes clear prices, preserve explicit price direction and use Polygon WETH by default", () => {
  const query = filters({
    chains: ["polygon"],
    sale: "listed",
    currency: "weth",
    priceMin: "0.1",
    priceMax: "0.2",
    sort: "price-desc",
    traits: { Type: ["Fire"] }
  });
  const native = updateCollectionCurrency(query, "native");
  assert.equal(native.priceMin, "");
  assert.equal(native.priceMax, "");
  assert.equal(native.sort, "price-desc");
  assert.equal(native.sale, "listed");
  assert.deepEqual(native.traits, query.traits);
  assert.equal(priceCurrencyForFilters(native), "native");
  assert.equal(priceCurrencyForFilters(query), "weth");
  assert.equal(
    priceCurrencyForFilters(filters({ chains: ["polygon"] })),
    "weth"
  );
  assert.equal(
    priceCurrencyForFilters(filters({ chains: ["ethereum"] })),
    "native"
  );
  assert.equal(
    priceCurrencyForFilters(filters({ chains: ["base"], currency: "weth" })),
    "weth"
  );
  const all = updateCollectionCurrency(query, "all");
  assert.equal(all.sort, "rarity-capped-desc");
  assert.equal(all.priceMax, "");
  assert.equal(updateCollectionCurrency(query, "weth"), query);
});

test("WETH continuation preserves exact price ordering and numeric token-ID ties", () => {
  const query = filters({
    chains: ["polygon"],
    sale: "listed",
    currency: "weth",
    sort: "price-asc"
  });
  const first = parseCatalogPage(
    {
      ...page(query, [openSeaItem("polygon", "weth", "2")]),
      total: 2,
      listedTotal: 2,
      verifiedListedTotal: 2,
      nextCursor: "p2"
    },
    query
  );
  const previous = nextCatalogPage(first, [first], query)!;
  const second = (row: CatalogItem) => ({
    ...page(query, [row]),
    total: 2,
    listedTotal: 2,
    verifiedListedTotal: 2
  });
  assert.doesNotThrow(() =>
    parseCatalogPage(
      second(openSeaItem("polygon", "weth", "10")),
      query,
      previous
    )
  );
  for (const row of [
    openSeaItem("polygon", "weth", "1"),
    openSeaItem("polygon", "weth", "10", "999999999999999999"),
    openSeaItem("polygon", "native", "10")
  ])
    assert.throws(() => parseCatalogPage(second(row), query, previous));
});

test("catalog filters preserve exact price bounds and reject lossy amounts or cross-chain comparisons", () => {
  const query = filters({
    sale: "listed",
    currency: "native",
    priceMin: "0.000000000000000001",
    priceMax: "1",
    sort: "price-asc"
  });
  const parsed = parseCollectionFilters(serializeCollectionFilters(query));
  assert.deepEqual({ ...parsed, traits: {} }, query);
  assert.equal(validateCatalogFilters(parsed).min, 1n);
  assert.equal(parseCatalogPrice("0"), 0n);
  assert.equal(parseCatalogPrice(""), undefined);
  for (const price of [
    "1e-2",
    "-1",
    "01",
    "1.0000000000000000001",
    "Infinity",
    ".1",
    "1,000",
    maxUint256.toString()
  ])
    assert.throws(() => parseCatalogPrice(price));
  for (const change of [
    { chains: [] },
    { chains: ["bnb", "base"] },
    { currency: "all" },
    { sale: "unlisted" },
    { priceMin: "2" }
  ])
    assert.throws(() =>
      validateCatalogFilters({ ...query, ...change } as CollectionFilters)
    );
  assert.equal(
    parseCollectionFilters(new URLSearchParams("priceMax=bad")).priceMax,
    "bad"
  );
});

test("chain changes clear amounts and price sorting, and legacy queries never ignore marketplace filters", () => {
  const query = filters({
    sale: "listed",
    currency: "native",
    priceMin: "0.1",
    sort: "price-asc",
    traits: { Type: ["Fire"] }
  });
  const next = updateCollectionChains(query, { ...query, chains: ["base"] });
  assert.equal(next.priceMin, "");
  assert.equal(next.currency, "all");
  assert.equal(next.sort, "rarity-capped-desc");
  assert.equal(next.sale, "listed");
  assert.deepEqual(next.traits, query.traits);
  assert.throws(() => collectionFiltersToTokenQuery(query));
  assert.doesNotThrow(() =>
    collectionFiltersToTokenQuery(clearMarketFilters(query))
  );
  const special = parseCollectionFilters(
    new URLSearchParams("t.__proto__=Fire&t.constructor=Yes")
  );
  assert.deepEqual(special.traits.__proto__, ["Fire"]);
  assert.doesNotThrow(() => validateCatalogFilters(special));
});

test("catalog pages bind chain, query, snapshot, source status and full-query counts", () => {
  const query = filters();
  const first = parseCatalogPage(
    {
      ...page(query),
      total: 2,
      listedTotal: 2,
      verifiedListedTotal: 2,
      nextCursor: "p2"
    },
    query
  );
  const previous = nextCatalogPage(first, [first], query)!;
  const second = {
    ...page(query, [item("124")]),
    total: 2,
    listedTotal: 2,
    verifiedListedTotal: 2
  };
  assert.doesNotThrow(() => parseCatalogPage(second, query, previous));
  for (const change of [
    { query: "chain=base" },
    { total: 3 },
    { listedTotal: 1 },
    { snapshot: { ...second.snapshot, id: "new_snapshot" } },
    {
      snapshot: { ...second.snapshot, observedAt: "1970-01-01T00:02:01.000Z" }
    },
    { sources: { bnb: "syncing" }, listedTotal: null },
    { items: [{ ...item(), token: { ...item().token, chainId: 1 } }] }
  ])
    assert.throws(() =>
      parseCatalogPage({ ...second, ...change }, query, previous)
    );
});

test("catalog rejects hidden, burned, missing-owner, wrong-lifecycle and foreign NFT joins", () => {
  const query = filters();
  for (const change of [
    { hidden: true },
    { burned: true },
    { owner: zeroAddress },
    { owner: testBuyer },
    { lifecycle: 3 },
    { contractAddress: testBuyer }
  ]) {
    const row = item();
    row.token = { ...row.token, ...change };
    assert.throws(() => parseCatalogPage(page(query, [row]), query));
  }
  const row = item();
  row.market.listings[0].asset.tokenId = "124";
  assert.throws(() => parseCatalogPage(page(query, [row]), query));
});

test("catalog listing summaries must be current, active and unique per currency", () => {
  const query = filters();
  for (const change of [
    { status: "expired" },
    { side: "offer" },
    { startTime: "121" },
    { endTime: "120" },
    { maker: testBuyer }
  ]) {
    const row = item();
    Object.assign(row.market.listings[0], change);
    assert.throws(() => parseCatalogPage(page(query, [row]), query));
  }
  const row = item();
  row.market.listings.push(row.market.listings[0]);
  assert.throws(() => parseCatalogPage(page(query, [row]), query));
  const misleading = item();
  misleading.market.listings[0].currency.symbol = "USD";
  assert.throws(() => parseCatalogPage(page(query, [misleading]), query));
});

test("native price filters validate exact base units, currency metadata and trait/rarity membership", () => {
  const query = filters({
    sale: "listed",
    currency: "native",
    priceMin: "0.5",
    priceMax: "1",
    traits: { Type: ["Fire", "Water"] },
    rarityMin: "90",
    rarityMax: "110",
    metadata: "available"
  });
  assert.doesNotThrow(() => parseCatalogPage(page(query), query));
  assert.throws(() =>
    parseCatalogPage(page(query, [item("123", "499999999999999999")]), query)
  );
  assert.throws(() =>
    parseCatalogPage(page(query, [item("123", "1000000000000000001")]), query)
  );
  for (const change of [
    { symbol: "ETH" },
    { decimals: 6 },
    { address: testBuyer }
  ]) {
    const row = item();
    Object.assign(row.market.listings[0].currency, change);
    assert.throws(() => parseCatalogPage(page(query, [row]), query));
  }
  for (const change of [
    { attributes: [] },
    { rarityPointsCapped: "89" },
    { rarityPointsCapped: null },
    { metadataAvailable: false }
  ]) {
    const row = item();
    Object.assign(row.token, change);
    assert.throws(() => parseCatalogPage(page(query, [row]), query));
  }
});

test("price sorting preserves uint256 precision and ascending NFT ID ties across pages", () => {
  const query = filters({
    sale: "listed",
    currency: "native",
    sort: "price-asc"
  });
  const first = parseCatalogPage(
    {
      ...page(query, [item("2")]),
      total: 2,
      listedTotal: 2,
      verifiedListedTotal: 2,
      nextCursor: "p2"
    },
    query
  );
  const previous = nextCatalogPage(first, [first], query)!;
  assert.doesNotThrow(() =>
    parseCatalogPage(
      {
        ...page(query, [item("10")]),
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2
      },
      query,
      previous
    )
  );
  for (const row of [item("1"), item("10", "999999999999999999")])
    assert.throws(() =>
      parseCatalogPage(
        {
          ...page(query, [row]),
          total: 2,
          listedTotal: 2,
          verifiedListedTotal: 2
        },
        query,
        previous
      )
    );
  const descending = { ...query, sort: "price-desc" as const };
  assert.doesNotThrow(() =>
    parseCatalogPage(
      page(descending, [item("2", "1000000000000000001"), item("10")]),
      descending
    )
  );
  assert.throws(() =>
    parseCatalogPage(
      page(descending, [item("2"), item("10", "1000000000000000001")]),
      descending
    )
  );
});

test("pagination rejects repeat NFTs, cursor cycles, truncated results and incorrect final counts", () => {
  const query = filters();
  const first = parseCatalogPage(
    {
      ...page(query),
      total: 2,
      listedTotal: 2,
      verifiedListedTotal: 2,
      nextCursor: "p2"
    },
    query
  );
  const previous = nextCatalogPage(first, [first], query)!;
  const unlisted = item("124");
  unlisted.market = { status: "unlisted", listings: [] };
  assert.throws(() =>
    parseCatalogPage(
      {
        ...page(query, [unlisted]),
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2
      },
      query,
      previous
    )
  );
  assert.throws(() =>
    parseCatalogPage(
      {
        ...page(query),
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2
      },
      query,
      previous
    )
  );
  assert.throws(() =>
    parseCatalogPage(
      {
        ...page(query, [item("124")]),
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2,
        nextCursor: "p2"
      },
      query,
      previous
    )
  );
  assert.throws(() => parseCatalogPage({ ...page(query), total: 2 }, query));
  assert.throws(() =>
    parseCatalogPage({ ...page(query), nextCursor: "p2" }, query)
  );
  assert.throws(() => parseCatalogPage(page(query, [item(), item()]), query));
  assert.throws(() =>
    parseCatalogPage(
      page(
        query,
        Array.from({ length: 25 }, (_, i) => item(String(i)))
      ),
      query
    )
  );
});

test("source outages remain explicit while filtered v2 results stay safely empty", () => {
  const query = filters();
  const row = item();
  row.market = { status: "unavailable", listings: [] };
  const response = {
    ...page(query, [row]),
    sources: { bnb: "unavailable" },
    availability: {
      bnb: {
        chain: "bnb",
        evidence: "unavailable",
        listings: { status: "unavailable", completedAt: null, revision: "1" },
        offers: { status: "unavailable", completedAt: null, revision: "1" }
      }
    },
    listingCompleteness: "unavailable",
    listedTotal: null,
    verifiedListedTotal: 0
  };
  assert.doesNotThrow(() => parseCatalogPage(response, query));
  assert.throws(() => parseCatalogPage({ ...response, listedTotal: 0 }, query));
  assert.throws(() =>
    parseCatalogPage({ ...response, items: [item()] }, query)
  );
  for (const sale of ["listed", "unlisted"] as const) {
    const requested = { ...query, sale };
    assert.doesNotThrow(() =>
      parseCatalogPage(
        {
          ...response,
          query: collectionFiltersKey(requested),
          total: 0,
          items: []
        },
        requested
      )
    );
  }
  const available = { ...response, sources: { bnb: "available" } };
  assert.doesNotThrow(() => parseCatalogPage(available, query));
});

test("catalog supports separate chain-native currencies without mixing their price ranking", () => {
  const query = filters({ chains: [] });
  const bnb = item();
  const eth = item();
  eth.token = {
    ...eth.token,
    chain: "ethereum",
    chainId: 1,
    contractAddress: marketplaceChains.ethereum.contractAddress
  };
  eth.market.listings[0] = {
    ...eth.market.listings[0],
    asset: {
      chain: "ethereum",
      chainId: 1,
      tokenId: eth.token.tokenId,
      contractAddress: eth.token.contractAddress
    },
    source: "opensea",
    currency: { address: zeroAddress, symbol: "ETH", decimals: 18 }
  };
  const response = {
    ...page(query, [bnb, eth]),
    sources: {
      bnb: "available",
      ethereum: "available",
      base: "available",
      polygon: "available"
    }
  };
  assert.equal(parseCatalogPage(response, query).items.length, 2);
});

test("catalog HTTP requests bind all filters and forward snapshot/cursor with the shared response guard", async () => {
  const query = filters({
    sale: "listed",
    currency: "native",
    priceMin: "0.5",
    traits: { Type: ["Fire"] }
  });
  const first = parseCatalogPage(
    {
      ...page(query),
      total: 2,
      listedTotal: 2,
      verifiedListedTotal: 2,
      nextCursor: "p2"
    },
    query
  );
  const previous = nextCatalogPage(first, [first], query)!;
  let request: URL | undefined;
  const client = createCatalogClient(
    "https://example.test/indexer",
    async (url, init) => {
      request = new URL(String(url));
      assert.equal(init?.credentials, "omit");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      return Response.json({
        ...page(query, [item("124")]),
        total: 2,
        listedTotal: 2,
        verifiedListedTotal: 2
      });
    }
  );
  await client.catalog(query, previous);
  assert.equal(request?.pathname, "/indexer/v2/market/tokens");
  assert.equal(request?.searchParams.get("priceMin"), "0.5");
  assert.equal(request?.searchParams.get("t.Type"), "Fire");
  assert.equal(request?.searchParams.get("limit"), "24");
  assert.equal(request?.searchParams.get("cursor"), "p2");
  assert.equal(request?.searchParams.get("snapshot"), "catalog_1");
  assert.throws(() => createCatalogClient("http://example.test"));
});
