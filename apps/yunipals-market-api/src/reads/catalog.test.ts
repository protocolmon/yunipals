import assert from "node:assert/strict";
import { before, after, afterEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { zeroAddress } from "viem";
import {
  marketplaceChains,
  seaportDeployment,
  type MarketplaceChain
} from "@protopals/yunipals-market-core/registry";
import { catalogCurrency } from "@protopals/yunipals-market-core/catalogCurrency";
import { createBnbTestDatabase, testUrl } from "@/bnb/fixtures/database";
import { seller, buyer } from "@/bnb/fixtures/admission";
import { createApp } from "@/app";
import { readEnvironment } from "@/environment";
import { CatalogService } from "@/reads/catalog";
import {
  fetchCatalogBooks,
  fetchCatalogCounts,
  fetchCatalogFirstPage,
  fetchCatalogPage,
  parseCatalogRequest,
  type CatalogSources
} from "@/reads/catalogQuery";

const db = createBnbTestDatabase();
before(db.initialize);
after(db.close);
const ids: string[] = [];
const services: CatalogService[] = [];
let sequence = BigInt(Date.now()) * 10000n;
let orderSequence = 1n;
const marker = randomUUID();
const sources: CatalogSources = {
  statuses: {
    bnb: "available",
    ethereum: "available",
    base: "available",
    polygon: "available"
  },
  provenance: { fixture: true }
};
function service(
  overrides: Partial<CatalogSources["statuses"]> = {},
  lifetimeMs?: number,
  reuseMs?: number,
  directIndexer = process.env.MARKET_TEST_DIRECT_CATALOG === "1",
  projectionMode: "legacy" | "generation" = "legacy"
) {
  const keepers = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
    application_name: "yunipals_catalog_test",
    max: 3,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 95000
  });
  keepers.on("error", () => {});
  const indexerKeepers = directIndexer
    ? new pg.Pool({
        connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
        application_name: "yunipals_catalog_source_test",
        max: 7,
        statement_timeout: 5000,
        idle_in_transaction_session_timeout: 95000
      })
    : undefined;
  indexerKeepers?.on("error", () => {});
  const result = new CatalogService(db.runtime, keepers, {
    indexerKeepers,
    readSources: async () => ({
      ...sources,
      statuses: { ...sources.statuses, ...overrides }
    }),
    lifetimeMs,
    reuseMs,
    projectionMode
  });
  services.push(result);
  return result;
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((item) => item.close()));
  await db.owner.query(
    "DELETE FROM yunipals_market.orders WHERE token_id=ANY($1::numeric[])",
    [ids]
  );
  for (const table of [
    "token_metadata",
    "token_search",
    "token_trait",
    "token_visibility"
  ])
    await db.owner.query(
      `DELETE FROM metadata.${table} WHERE token_id=ANY($1::numeric[])`,
      [ids]
    );
  for (const table of ["transfer_event", "token"])
    await db.owner.query(
      `DELETE FROM yunipals_read_v4.${table} WHERE token_id=ANY($1::text[])`,
      [ids]
    );
  ids.length = 0;
});
function query(extra: Record<string, string> = {}) {
  return new URLSearchParams({ "t.Fixture": marker, ...extra });
}
async function token(
  chain: MarketplaceChain,
  rarity: number,
  traits: Record<string, string> = {},
  id = ++sequence
) {
  const config = marketplaceChains[chain];
  const tokenId = id.toString();
  ids.push(tokenId);
  const attributes = Object.entries({ Fixture: marker, ...traits }).map(
    ([trait_type, value]) => ({ trait_type, value })
  );
  await db.owner.query(
    `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned)
    VALUES($1,$2,$3,$4,$5,0,false)`,
    [
      chain,
      config.chainId,
      config.contractAddress.toLowerCase(),
      tokenId,
      seller.address.toLowerCase()
    ]
  );
  await db.owner.query(
    "INSERT INTO metadata.token_metadata VALUES($1,$2,0,$3,$4,$5,$6)",
    [
      chain,
      tokenId,
      `https://example.com/${tokenId}`,
      `Yuni ${tokenId}`,
      "https://example.com/yuni.png",
      JSON.stringify(attributes)
    ]
  );
  await db.owner.query(
    "INSERT INTO metadata.token_search VALUES($1,$2,0,true,$3,$4)",
    [chain, tokenId, rarity * 2, rarity]
  );
  for (const trait of attributes)
    await db.owner.query(
      "INSERT INTO metadata.token_trait VALUES($1,$2,0,$3,$4)",
      [chain, tokenId, trait.trait_type, trait.value]
    );
  return {
    chain,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId
  };
}
type Asset = Awaited<ReturnType<typeof token>>;
async function listing(
  asset: Asset,
  amount: bigint,
  currencyKey: "native" | "weth" = "native",
  maker = seller.address,
  lifecycle = 0
) {
  const currency = catalogCurrency(asset.chain, currencyKey);
  const hash =
    "0x" +
    (BigInt(Date.now()) * 1000000n + orderSequence++)
      .toString(16)
      .padStart(64, "0");
  const start = Math.floor(Date.now() / 1000) - 30,
    end = start + 3600;
  const source = marketplaceChains[asset.chain].source;
  const summary = {
    asset,
    lifecycle,
    orderHash: hash,
    protocolAddress: seaportDeployment.address,
    source,
    side: "listing",
    maker,
    currency: {
      address: currency.address,
      symbol: currency.symbol,
      decimals: 18
    },
    grossAmount: amount.toString(),
    sellerProceeds: amount.toString(),
    fees: [],
    startTime: String(start),
    endTime: String(end),
    status: "active"
  };
  // Projection fixtures only: they do not claim signature validation, provider
  // acceptance or executable orders, and are never served by a trading adapter.
  await db.owner.query(
    `INSERT INTO yunipals_market.orders(chain_id,protocol_address,order_hash,contract_address,token_id,lifecycle,source,side,maker,currency,
    gross_amount,seller_proceeds,start_time,end_time,counter,components,signature,summary,policy_version,publication_state,provider_ack,accepted_at,state,
    state_observed_at,state_block_number,state_block_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,'listing',$8,$9,$10,$10,$11,$12,0,'{}','0x12',$13,'catalog-fixture','accepted',$14,clock_timestamp(),'active',clock_timestamp(),100,$15)`,
    [
      asset.chainId,
      seaportDeployment.address.toLowerCase(),
      hash,
      asset.contractAddress.toLowerCase(),
      asset.tokenId,
      lifecycle,
      source,
      maker.toLowerCase(),
      currency.address.toLowerCase(),
      amount.toString(),
      start,
      end,
      summary,
      source === "opensea"
        ? {
            fixture: true,
            providerStatus: "ACTIVE",
            remainingQuantity: 1,
            observedAt: new Date().toISOString()
          }
        : null,
      "0x" + "ac".repeat(32)
    ]
  );
  return hash;
}
async function all(catalog: CatalogService, params: URLSearchParams) {
  let page = await catalog.tokens(params);
  const result = [...page.items];
  const first = page;
  while (page.nextCursor) {
    const continuation = new URLSearchParams(params);
    continuation.set("snapshot", page.snapshot.id);
    continuation.set("cursor", page.nextCursor);
    page = await catalog.tokens(continuation);
    assert.deepEqual(page.snapshot, first.snapshot);
    assert.equal(page.total, first.total);
    assert.equal(page.listedTotal, first.listedTotal);
    result.push(...page.items);
  }
  assert.equal(result.length, page.total);
  return { ...page, items: result };
}

test("SQL joins the complete catalog before price filters, counts and 24-row pages", async () => {
  const assets: Asset[] = [];
  for (let i = 0; i < 61; i++) {
    const asset = await token("bnb", 1000 - i);
    assets.push(asset);
    await listing(asset, BigInt(61 - i) * 10n ** 18n);
  }
  const catalog = service();
  const page = await catalog.tokens(
    query({
      chain: "bnb",
      sale: "listed",
      currency: "native",
      sort: "price-asc"
    })
  );
  assert.equal(page.total, 61);
  assert.equal(page.listedTotal, 61);
  assert.equal(page.items.length, 24);
  assert.equal(page.items[0]!.token.tokenId, assets[60]!.tokenId);
  const complete = await all(
    catalog,
    query({
      chain: "bnb",
      sale: "listed",
      currency: "native",
      sort: "price-asc",
      priceMin: "2",
      priceMax: "59"
    })
  );
  assert.equal(complete.total, 58);
  assert.ok(
    complete.items.every(
      (item, index) =>
        item.market.listings[0]!.grossAmount ===
        (BigInt(index + 2) * 10n ** 18n).toString()
    )
  );
  assert.equal(
    new Set(complete.items.map((item) => item.token.tokenId)).size,
    58
  );
});

test("POL and WETH select distinct cheapest prices before ranking, including stale-owner orders and exact uint256 ties", async () => {
  const assets: Asset[] = [];
  for (let i = 0; i < 30; i++) {
    const asset = await token("polygon", i);
    assets.push(asset);
    await listing(asset, BigInt(i + 1), "native");
    await listing(asset, BigInt(30 - i), "weth");
  }
  await listing(assets[0]!, 1n, "weth", buyer.address);
  await listing(assets[0]!, 2n, "weth", seller.address, 1);
  await listing(assets[0]!, 500n, "weth");
  const catalog = service();
  for (const currency of ["native", "weth"]) {
    const rows = await all(
      catalog,
      query({ chain: "polygon", sale: "listed", currency, sort: "price-asc" })
    );
    assert.equal(rows.total, 30);
    assert.equal(
      rows.items[0]!.token.tokenId,
      assets[currency === "native" ? 0 : 29]!.tokenId
    );
    assert.ok(rows.items.every((item) => item.market.listings.length === 1));
  }
  const unfiltered = await catalog.tokens(query({ chain: "polygon" }));
  assert.ok(
    unfiltered.items.every((item) => item.market.listings.length === 2)
  );
  const a = await token("bnb", 1, {}, 2n ** 255n + 2n),
    b = await token("bnb", 1, {}, 2n ** 255n + 1n);
  await listing(a, 2n ** 255n);
  await listing(b, 2n ** 255n);
  const exact = await all(
    service(),
    query({
      chain: "bnb",
      sale: "listed",
      currency: "native",
      sort: "price-desc",
      limit: "1"
    })
  );
  assert.deepEqual(
    exact.items.map((item) => item.token.tokenId),
    [b.tokenId, a.tokenId]
  );
});

test("traits use OR within a type and AND across types; rarity, lifecycle, metadata and public ownership filters agree", async () => {
  const a = await token("bnb", 10, { Color: "Red", Type: "Dragon" });
  await token("bnb", 20, { Color: "Blue", Type: "Dragon" });
  await token("bnb", 30, { Color: "Red", Type: "Cat" });
  const burned = await token("bnb", 40, { Color: "Red", Type: "Dragon" });
  const missing = await token("bnb", 50);
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET burned=true,owner=$1 WHERE token_id=$2",
    [zeroAddress, burned.tokenId]
  );
  await db.owner.query(
    "UPDATE metadata.token_search SET metadata_available=false,rarity_points=NULL,rarity_points_capped=NULL WHERE token_id=$1",
    [missing.tokenId]
  );
  const catalog = service();
  const params = query({
    chain: "bnb",
    "t.Color": "Red",
    "t.Type": "Dragon",
    rarityCappedMax: "20"
  });
  params.append("t.Color", "Blue");
  const page = await catalog.tokens(params);
  assert.equal(page.total, 2);
  const raw = await catalog.tokens(
    query({ chain: "bnb", rarityMin: "20", rarityMax: "20", rarityMode: "raw" })
  );
  assert.equal(raw.total, 1);
  assert.equal(raw.items[0]!.token.tokenId, a.tokenId);
  assert.equal(
    (await catalog.tokens(query({ chain: "bnb", metadata: "missing" })))
      .items[0]!.token.tokenId,
    missing.tokenId
  );
  assert.equal(
    (await catalog.tokens(query({ chain: "bnb", sale: "unlisted" })))
      .listedTotal,
    0
  );
});

test("sparse metadata filters retain false, null and absent search records across source families", async () => {
  const missing: Asset[] = [];
  const available: Asset[] = [];
  for (const chain of ["bnb", "base"] as const) {
    available.push(await token(chain, 1));
    for (const state of [false, null, "absent"] as const) {
      const asset = await token(chain, 2);
      missing.push(asset);
      if (state === "absent")
        await db.owner.query(
          "DELETE FROM metadata.token_search WHERE collection=$1 AND token_id=$2",
          [chain, asset.tokenId]
        );
      else
        await db.owner.query(
          "UPDATE metadata.token_search SET metadata_available=$3 WHERE collection=$1 AND token_id=$2",
          [chain, asset.tokenId, state]
        );
    }
  }
  const catalog = service({ bnb: "unavailable", base: "unavailable" });
  for (const metadata of ["available", "missing"] as const) {
    const expected = metadata === "available" ? available : missing;
    const page = await catalog.tokens(
      query({ metadata, sort: "token-id-asc" })
    );
    assert.equal(page.total, expected.length);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(
      page.items.map(({ token }) => [token.chain, token.tokenId]),
      expected.map((asset) => [asset.chain, asset.tokenId])
    );
    assert.ok(
      page.items.every(
        ({ token }) => token.metadataAvailable === (metadata === "available")
      )
    );
  }
  const empty = await catalog.tokens(
    query({ chain: "polygon", metadata: "missing" })
  );
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, null);
});

test("current trait joins deduplicate OR values and follow additions, removals and lifecycles", async () => {
  const assets: Asset[] = [];
  for (let i = 0; i < 31; i++)
    assets.push(await token("bnb", i, { Color: "Red", Type: "Dragon" }));
  const first = assets[0]!;
  await db.owner.query(
    "INSERT INTO metadata.token_trait VALUES('bnb',$1,0,'Color','Blue')",
    [first.tokenId]
  );
  await db.owner.query(
    `UPDATE metadata.token_metadata SET attributes=attributes||'[{"trait_type":"Color","value":"Blue"}]'::jsonb
      WHERE collection='bnb' AND token_id=$1`,
    [first.tokenId]
  );
  // The same numeric ID must not admit a different chain's nonmatching NFT.
  await token(
    "base",
    1,
    { Color: "Green", Type: "Dragon" },
    BigInt(first.tokenId)
  );
  await db.owner.query(
    `UPDATE metadata.token_metadata SET attributes=(SELECT jsonb_agg(
      CASE WHEN attribute->>'trait_type'='Color' THEN jsonb_set(attribute,'{value}','"Green"') ELSE attribute END)
      FROM jsonb_array_elements(attributes) attribute) WHERE collection='bnb' AND token_id=$1`,
    [assets[28]!.tokenId]
  );
  await db.owner.query(
    "UPDATE yunipals_read_v4.token SET lifecycle=1 WHERE collection='bnb' AND token_id=$1",
    [assets[29]!.tokenId]
  );
  await db.owner.query(
    "DELETE FROM metadata.token_metadata WHERE collection='bnb' AND token_id=$1",
    [assets[30]!.tokenId]
  );
  const newlyMatching = await token("bnb", 32, {
    Color: "Green",
    Type: "Dragon"
  });
  // The periodically rebuilt token_trait row remains Green. The catalog must
  // still admit the new current Red value immediately.
  await db.owner.query(
    `UPDATE metadata.token_metadata SET attributes=(SELECT jsonb_agg(
      CASE WHEN attribute->>'trait_type'='Color' THEN jsonb_set(attribute,'{value}','"Red"') ELSE attribute END)
      FROM jsonb_array_elements(attributes) attribute) WHERE collection='bnb' AND token_id=$1`,
    [newlyMatching.tokenId]
  );
  const catalog = service({ bnb: "unavailable", base: "unavailable" });
  const params = query({
    "t.Color": "Red",
    "t.Type": "Dragon",
    sort: "token-id-asc",
    limit: "7"
  });
  params.append("t.Color", "Blue");
  const result = await all(catalog, params);
  assert.equal(result.total, 29);
  assert.deepEqual(
    result.items.map(({ token }) => [token.chain, token.tokenId]),
    [...assets.slice(0, 28), newlyMatching].map((asset) => [
      asset.chain,
      asset.tokenId
    ])
  );
});

test("source attribute verification preserves numeric text, boolean and null-value semantics", async () => {
  const cases = [
    { filter: "7.00", attribute: '{"trait_type":"Value","value":7.00}' },
    { filter: "7", attribute: '{"trait_type":"Value","value":7}' },
    { filter: "true", attribute: '{"trait_type":"Value","value":true}' },
    { filter: "null", attribute: '{"trait_type":"Value","value":null}' }
  ];
  const expected = new Map<string, string>();
  for (const item of cases) {
    const asset = await token("bnb", 1, { Value: item.filter });
    expected.set(item.filter, asset.tokenId);
    await db.owner.query(
      `UPDATE metadata.token_metadata SET attributes=(SELECT jsonb_agg(attribute)
        FROM jsonb_array_elements(attributes) attribute WHERE attribute->>'trait_type'<>'Value')||$2::jsonb
        WHERE collection='bnb' AND token_id=$1`,
      [asset.tokenId, `[${item.attribute}]`]
    );
  }
  const catalog = service({ bnb: "unavailable" });
  for (const [value, tokenId] of expected) {
    const page = await catalog.tokens(
      query({ chain: "bnb", "t.Value": value })
    );
    assert.equal(page.total, 1);
    assert.equal(page.items[0]!.token.tokenId, tokenId);
  }
});

test("shared MVCC pages preserve prices and counts across arrivals and updates without per-visitor catalog copies", async () => {
  for (let i = 0; i < 30; i++)
    await listing(await token("bnb", i), BigInt(i + 1));
  const catalog = service();
  const params = query({
    chain: "bnb",
    sale: "listed",
    currency: "native",
    sort: "price-asc"
  });
  const first = await catalog.tokens(params);
  const same = await catalog.tokens(params);
  assert.deepEqual(same.snapshot, first.snapshot);
  await listing(await token("bnb", 99), 1n);
  await db.owner.query(
    "UPDATE yunipals_market.orders SET gross_amount=999,seller_proceeds=999,summary=jsonb_set(jsonb_set(summary,'{grossAmount}','\"999\"'),'{sellerProceeds}','\"999\"') WHERE token_id=ANY($1::numeric[])",
    [ids]
  );
  const next = await catalog.tokens(
    new URLSearchParams({
      ...Object.fromEntries(params),
      snapshot: first.snapshot.id,
      cursor: first.nextCursor!
    })
  );
  assert.equal(next.total, 30);
  assert.equal(next.items.length, 6);
  assert.equal(next.items[0]!.market.listings[0]!.grossAmount, "25");
  assert.equal(
    (
      await db.owner.query(
        "SELECT count(*)::int AS count FROM yunipals_market.snapshot WHERE kind='catalog'"
      )
    ).rows[0].count,
    0
  );
  for (const wrong of [
    { chain: "polygon" },
    { currency: "weth" },
    { limit: "10" }
  ] as Record<string, string>[])
    await assert.rejects(
      catalog.tokens(
        new URLSearchParams({
          ...Object.fromEntries(params),
          ...wrong,
          snapshot: first.snapshot.id,
          cursor: first.nextCursor!
        })
      ),
      /invalid_catalog_query|snapshot_refresh_required/
    );
  const cursor = first.nextCursor!;
  const tampered = (cursor[0] === "A" ? "B" : "A") + cursor.slice(1);
  await assert.rejects(
    catalog.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        snapshot: first.snapshot.id,
        cursor: tampered
      })
    ),
    /snapshot_refresh_required/
  );
});

test("foreign indexer rankings and new filter counts keep the same remote snapshot across pages", async () => {
  for (let i = 1; i <= 30; i++) await token("bnb", i);
  const suffix = randomUUID().replaceAll("-", "");
  const server = `catalog_fdw_${suffix}`;
  const backing = `catalog_search_${suffix}`;
  const login = new URL(testUrl("MARKET_TEST_DATABASE_URL"));
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const catalog = service();
  let installed = false;
  try {
    // The isolated fixture PostgreSQL server connects to itself. This exercises
    // a real postgres_fdw transaction, independently of the caller's snapshot.
    // The disposable container trusts loopback; production mappings still
    // require password authentication.
    await db.owner.query(`BEGIN;
      CREATE EXTENSION IF NOT EXISTS postgres_fdw;
      ALTER TABLE metadata.token_search RENAME TO ${backing};
      CREATE SERVER ${server} FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS(host '127.0.0.1',port '5432',dbname 'yunipals_market_test',updatable 'false');
      CREATE USER MAPPING FOR market_test_runtime SERVER ${server}
        OPTIONS(user ${literal(decodeURIComponent(login.username))},password ${literal(decodeURIComponent(login.password))},password_required 'false');
      GRANT USAGE ON FOREIGN SERVER ${server} TO market_test_runtime;
      CREATE FOREIGN TABLE metadata.token_search(collection text,token_id numeric,lifecycle integer,
        metadata_available boolean,rarity_points numeric,rarity_points_capped numeric)
        SERVER ${server} OPTIONS(schema_name 'metadata',table_name '${backing}');
      GRANT SELECT ON metadata.token_search TO market_test_runtime;
      COMMIT;`);
    installed = true;
    const params = query({ chain: "bnb", sort: "rarity-asc" });
    const first = await catalog.tokens(params);
    assert.equal(first.total, 30);
    await db.owner.query(
      `UPDATE metadata.${backing} SET rarity_points=1000 WHERE token_id=ANY($1::numeric[])`,
      [ids]
    );
    const next = await catalog.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        snapshot: first.snapshot.id,
        cursor: first.nextCursor!
      })
    );
    assert.equal(next.items.length, 6);
    assert.deepEqual(
      next.items.map((item) => item.token.rarityPoints),
      ["50", "52", "54", "56", "58", "60"]
    );
    const filtered = await catalog.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        rarityMax: "20"
      })
    );
    assert.equal(filtered.snapshot.id, first.snapshot.id);
    assert.equal(filtered.total, 10);
    assert.equal(filtered.items.length, 10);
    // A new generation must see the update instead of keeping a stale cache.
    const fresh = await service().tokens(params);
    assert.ok(fresh.items.every((item) => item.token.rarityPoints === "1000"));
  } finally {
    await Promise.all(services.splice(0).map((item) => item.close()));
    if (installed)
      await db.owner.query(`BEGIN;
        DROP FOREIGN TABLE metadata.token_search;
        DROP SERVER ${server} CASCADE;
        ALTER TABLE metadata.${backing} RENAME TO token_search;
        COMMIT;`);
  }
});

test("merged source pages keep exact decimal ranks, cross-chain ID ties and missing search rows", async () => {
  const chains = ["bnb", "base", "ethereum", "polygon"] as const;
  const baseId = sequence + 1n;
  const expected: { chainId: number; tokenId: string; group: number }[] = [];
  for (let group = 0; group < 9; group++) {
    for (const chain of chains) {
      const asset = await token(chain, 1, {}, baseId + BigInt(group));
      expected.push({ chainId: asset.chainId, tokenId: asset.tokenId, group });
      if (group === 0)
        await db.owner.query(
          "DELETE FROM metadata.token_search WHERE collection=$1 AND token_id=$2",
          [chain, asset.tokenId]
        );
      else
        await db.owner.query(
          "UPDATE metadata.token_search SET rarity_points=$3::numeric WHERE collection=$1 AND token_id=$2",
          [
            chain,
            asset.tokenId,
            `10000000000000000.${String(group).padStart(3, "0")}`
          ]
        );
    }
  }
  sequence = baseId + 9n;
  const catalog = service();
  for (const sort of ["rarity-desc", "token-id-desc"]) {
    const result = await all(catalog, query({ sort, limit: "7" }));
    assert.equal(result.total, 36);
    expected.sort((a, b) => b.group - a.group || a.chainId - b.chainId);
    assert.deepEqual(
      result.items.map(({ token }) => [token.chainId, token.tokenId]),
      expected.map((item) => [item.chainId, item.tokenId])
    );
    assert.equal(
      new Set(
        result.items.map(({ token }) => `${token.chainId}:${token.tokenId}`)
      ).size,
      36
    );
  }
});

test("combined direct first pages match separate counts and pages across sorts, prices and empty families", async () => {
  for (const chain of ["bnb", "ethereum", "base", "polygon"] as const) {
    for (let i = 0; i < 8; i++) {
      const asset = await token(chain, i % 3, {
        Family: chain,
        Color: i % 2 ? "Red" : "Blue"
      });
      if (i % 2) await listing(asset, BigInt(i + 1));
      if (i === 0)
        await db.owner.query(
          "UPDATE metadata.token_search SET rarity_points=NULL,rarity_points_capped=NULL WHERE collection=$1 AND token_id=$2",
          [chain, asset.tokenId]
        );
    }
  }
  const client = await db.runtime.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const observedAt = new Date();
    const cases: Record<string, string>[] = [
      ...[
        "token-id-asc",
        "token-id-desc",
        "rarity-asc",
        "rarity-desc",
        "rarity-capped-asc",
        "rarity-capped-desc"
      ].map((sort) => ({ sort })),
      { chain: "bnb", sort: "price-asc", currency: "native", sale: "listed" },
      {
        chain: "bnb",
        sort: "price-desc",
        currency: "native",
        sale: "listed",
        priceMin: "0.000000000000000003"
      },
      { sort: "rarity-desc", sale: "unlisted" },
      { "t.Color": "Missing" },
      { "t.Family": "bnb" }
    ];
    for (const extra of cases) {
      const parsed = parseCatalogRequest(query(extra));
      const books = await fetchCatalogBooks(
        client,
        parsed,
        observedAt,
        sources
      );
      const counts = await fetchCatalogCounts(
        client,
        parsed,
        observedAt,
        sources,
        books
      );
      const expected = await fetchCatalogPage(
        client,
        parsed,
        observedAt,
        sources,
        undefined,
        undefined,
        Number(counts.total),
        books
      );
      const actual = await fetchCatalogFirstPage(
        client,
        parsed,
        observedAt,
        sources,
        books
      );
      assert.equal(actual.total, counts.total);
      assert.equal(actual.listed, counts.listed);
      assert.deepEqual(actual.page, expected, JSON.stringify(extra));
    }
    // Unknown source status suppresses eligible prices for that family.
    const parsed = parseCatalogRequest(query({ "t.Color": "Red" }));
    const bnbOnlyBooks = await fetchCatalogBooks(
      client,
      parsed,
      observedAt,
      sources
    );
    const unknown = {
      ...sources,
      statuses: { ...sources.statuses, bnb: "unavailable" as const }
    };
    const actual = await fetchCatalogFirstPage(
      client,
      parsed,
      observedAt,
      unknown,
      bnbOnlyBooks
    );
    assert.ok(
      actual.page.items
        .filter((item) => item.token.chain === "bnb")
        .every((item) => item.market.status === "unknown")
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("direct catalog lanes import one source snapshot and serve concurrent filters from it", async () => {
  await token("bnb", 1, { Lane: "BNB" });
  await token("ethereum", 2, { Lane: "Ethereum" });
  const catalog = service({}, undefined, undefined, true);
  const opened = await catalog.tokens(query({ chain: "polygon" }));
  const snapshots = await db.owner.query<{ backend_xmin: string }>(
    `SELECT backend_xmin::text FROM pg_stat_activity
    WHERE application_name='yunipals_catalog_source_test' ORDER BY pid`
  );
  assert.equal(snapshots.rowCount, 2);
  assert.ok(snapshots.rows.every((row) => row.backend_xmin));
  assert.equal(
    snapshots.rows[0]!.backend_xmin,
    snapshots.rows[1]!.backend_xmin
  );

  await token("bnb", 3, { Lane: "BNB" });
  await token("ethereum", 4, { Lane: "Ethereum" });
  const [bnb, ethereum] = await Promise.all([
    catalog.tokens(query({ chain: "bnb", "t.Lane": "BNB" })),
    catalog.tokens(query({ chain: "ethereum", "t.Lane": "Ethereum" }))
  ]);
  assert.equal(bnb.snapshot.id, opened.snapshot.id);
  assert.equal(ethereum.snapshot.id, opened.snapshot.id);
  assert.equal(bnb.total, 1);
  assert.equal(ethereum.total, 1);
});

test("direct indexer snapshots preserve local books and remote ranks, and source failure retires both connections", async () => {
  for (let i = 0; i < 32; i++)
    await listing(await token("bnb", i), BigInt(i + 1));
  const catalog = service({}, undefined, undefined, true);
  await catalog.assertIndexerReady();
  const params = query({
    chain: "bnb",
    currency: "native",
    sale: "listed",
    sort: "price-asc"
  });
  const first = await catalog.tokens(params);
  assert.equal(first.total, 32);
  await db.owner.query(
    `UPDATE yunipals_market.orders SET gross_amount=999,seller_proceeds=999,
      summary=jsonb_set(jsonb_set(summary,'{grossAmount}','"999"'),'{sellerProceeds}','"999"')
      WHERE token_id=ANY($1::numeric[])`,
    [ids]
  );
  await db.owner.query(
    "UPDATE metadata.token_search SET rarity_points=1000 WHERE token_id=ANY($1::numeric[])",
    [ids]
  );
  const continuation = new URLSearchParams({
    ...Object.fromEntries(params),
    snapshot: first.snapshot.id,
    cursor: first.nextCursor!
  });
  const next = await catalog.tokens(continuation);
  assert.equal(next.total, 32);
  assert.deepEqual(
    next.items.map((item) => item.market.listings[0]!.grossAmount),
    Array.from({ length: 8 }, (_, i) => String(i + 25))
  );
  const sameRanks = await catalog.tokens(
    query({ chain: "bnb", rarityMax: "10" })
  );
  assert.equal(sameRanks.total, 6);
  const fresh = service({}, undefined, undefined, true);
  assert.equal(
    (await fresh.tokens(query({ chain: "bnb", rarityMax: "10" }))).total,
    0
  );
  const killed = await db.owner.query<{ terminated: boolean }>(
    "SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name='yunipals_catalog_source_test'"
  );
  assert.ok(
    killed.rows.length >= 2 && killed.rows.every((row) => row.terminated)
  );
  let held = 1;
  for (let attempt = 0; attempt < 100 && held; attempt++) {
    await delay(10);
    held = (
      await db.owner.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE application_name='yunipals_catalog_test'"
      )
    ).rows[0]!.count;
  }
  assert.equal(held, 0);
  await assert.rejects(
    catalog.tokens(continuation),
    /snapshot_refresh_required/
  );
});

test("direct catalog rejects a source login with write privileges before opening a snapshot", async () => {
  const keepers = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
    max: 1
  });
  const indexerKeepers = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
    max: 1
  });
  const catalog = new CatalogService(db.runtime, keepers, { indexerKeepers });
  services.push(catalog);
  await assert.rejects(
    catalog.tokens(query({ chain: "bnb" })),
    /catalog_indexer_unavailable/
  );
  assert.equal(keepers.totalCount, 0);
});

test("visibility changes invalidate every old catalog view and new snapshots suppress hidden assets", async () => {
  const asset = await token("bnb", 1);
  await token("bnb", 2);
  const catalog = service();
  const first = await catalog.tokens(
    query({ chain: "bnb", limit: "1", sort: "token-id-asc" })
  );
  const anchor = randomUUID();
  await db.owner.query(
    "INSERT INTO yunipals_read_v4.transfer_event VALUES($1,'bnb',$2,0,$3,$4,100,0,0)",
    [anchor, asset.tokenId, zeroAddress, seller.address.toLowerCase()]
  );
  await db.owner.query(
    "INSERT INTO metadata.token_visibility VALUES('bnb',$1,$2,0,$3,100,0,0)",
    [asset.tokenId, seller.address.toLowerCase(), anchor]
  );
  await assert.rejects(
    catalog.tokens(
      query({
        chain: "bnb",
        limit: "1",
        sort: "token-id-asc",
        snapshot: first.snapshot.id,
        cursor: first.nextCursor!
      })
    ),
    /snapshot_refresh_required/
  );
  const fresh = await catalog.tokens(query({ chain: "bnb" }));
  assert.equal(fresh.total, 1);
  assert.notEqual(fresh.snapshot.id, first.snapshot.id);
});

test("unknown sources retain public catalog metadata but reject financial filters; invalid requests never broaden the query", async () => {
  const bnb = await token("bnb", 1),
    polygon = await token("polygon", 2);
  await listing(bnb, 1n);
  await listing(polygon, 1n);
  const catalog = service({ polygon: "unavailable" });
  const app = createApp(
    readEnvironment({
      MARKET_DEPLOYMENT: "staging",
      MARKET_DATABASE_URL: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL")
    }),
    async () => {},
    { catalog }
  );
  const response = await app.request(`/v1/market/tokens?${query()}`);
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.total, 2);
  assert.equal(page.listedTotal, null);
  assert.equal(
    page.items.find(
      (item: { token: { chain: string } }) => item.token.chain === "polygon"
    ).market.status,
    "unknown"
  );
  for (const financial of [
    { sale: "listed" },
    { sale: "unlisted" },
    { sale: "listed", chain: "polygon", currency: "native", priceMin: "0" }
  ] as Record<string, string>[])
    await assert.rejects(
      catalog.tokens(query(financial)),
      /catalog_source_unavailable/
    );
  for (const invalid of [
    "chain=bad",
    "priceMin=NaN",
    "rarityMin=0x10",
    "rarityMin=nope",
    "rarityMin=1&rarityCappedMin=2",
    "currency=native&currency=weth",
    "sale=listed&currency=weth&chain=bnb",
    "limit=25",
    "sort=bad",
    "t.Color=",
    "unknown=1"
  ])
    assert.throws(
      () => parseCatalogRequest(new URLSearchParams(invalid)),
      /invalid_catalog_query/
    );
});

test("expired snapshots, service restart and killed keeper sessions demand refresh and release held transactions", async () => {
  await token("bnb", 1);
  await token("bnb", 2);
  const catalog = service({}, 1000, 500);
  const params = query({ chain: "bnb", limit: "1" });
  const first = await catalog.tokens(params);
  await delay(1050);
  await assert.rejects(
    catalog.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        snapshot: first.snapshot.id,
        cursor: first.nextCursor!
      })
    ),
    /snapshot_refresh_required/
  );
  const second = await catalog.tokens(params);
  const restarted = service();
  await assert.rejects(
    restarted.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        snapshot: second.snapshot.id,
        cursor: second.nextCursor!
      })
    ),
    /snapshot_refresh_required/
  );
  await catalog.close();
  services.splice(services.indexOf(catalog), 1);
  const fresh = await restarted.tokens(params);
  assert.equal(fresh.total, 2);
  const killed = await db.owner.query(
    "SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE application_name='yunipals_catalog_test' AND state='idle in transaction'"
  );
  assert.equal(killed.rowCount, 1);
  assert.equal(killed.rows[0].killed, true);
  await delay(20);
  await assert.rejects(
    restarted.tokens(
      new URLSearchParams({
        ...Object.fromEntries(params),
        snapshot: fresh.snapshot.id,
        cursor: fresh.nextCursor!
      })
    ),
    /snapshot_refresh_required/
  );
  assert.equal((await restarted.tokens(params)).total, 2);
});

test("missing metadata does not suppress an indexed NFT, and null rarity is ordered last", async () => {
  const missing = await token("base", 99);
  await token("base", 1);
  const knownNull = await token("base", 2);
  await db.owner.query(
    "UPDATE metadata.token_search SET rarity_points=NULL,rarity_points_capped=NULL WHERE collection='base' AND token_id=$1",
    [knownNull.tokenId]
  );
  for (const table of ["token_metadata", "token_search", "token_trait"])
    await db.owner.query(
      `DELETE FROM metadata.${table} WHERE collection='base' AND token_id=$1`,
      [missing.tokenId]
    );
  const page = await all(
    service(),
    new URLSearchParams({ chain: "base", limit: "1" })
  );
  assert.equal(page.total, 3);
  assert.equal(page.items[1]!.token.tokenId, missing.tokenId);
  assert.equal(page.items[2]!.token.tokenId, knownNull.tokenId);
  assert.equal(page.items[1]!.token.metadataAvailable, false);
  assert.equal(page.items[1]!.token.attributes, null);
  assert.equal(page.items[1]!.token.name, null);
});

test("generation catalog snapshots retain search scores across pointer publication", async () => {
  const asset = await token("bnb", 3);
  await db.owner.query(`CREATE SCHEMA IF NOT EXISTS metadata_projection;
    CREATE TABLE IF NOT EXISTS metadata_projection.active(singleton boolean PRIMARY KEY,current_id bigint);
    CREATE TABLE IF NOT EXISTS metadata_projection.search(
      generation_id bigint,collection text,token_id numeric,lifecycle integer,
      metadata_available boolean,rarity_points numeric,rarity_points_capped numeric);
    GRANT USAGE ON SCHEMA metadata_projection TO market_test_runtime;
    GRANT SELECT ON metadata_projection.active,metadata_projection.search TO market_test_runtime`);
  await db.owner.query(`INSERT INTO metadata_projection.active VALUES(true,1)
    ON CONFLICT(singleton) DO UPDATE SET current_id=1`);
  await db.owner.query(`INSERT INTO metadata_projection.search VALUES
    (1,'bnb',$1,0,true,7,7),(2,'bnb',$1,0,true,17,17)`, [asset.tokenId]);
  const catalog = service({}, undefined, undefined, true, "generation");
  const first = await catalog.tokens(query({ chain: "bnb", sort: "rarity-desc" }));
  assert.equal(first.total, 1);
  assert.equal(first.items[0]?.token.rarityPoints, "7");
  await db.owner.query("UPDATE metadata_projection.active SET current_id=2 WHERE singleton");
  const retained = await catalog.tokens(query({ chain: "bnb", sort: "rarity-desc", rarityMax: "10" }));
  assert.equal(retained.snapshot.id, first.snapshot.id);
  assert.equal(retained.total, 1);
  assert.equal(retained.items[0]?.token.rarityPoints, "7");
  const fresh = service({}, undefined, undefined, true, "generation");
  assert.equal((await fresh.tokens(query({ chain: "bnb", rarityMax: "10" }))).total, 0);
  await db.owner.query("DELETE FROM metadata_projection.search WHERE token_id=$1", [asset.tokenId]);
});
