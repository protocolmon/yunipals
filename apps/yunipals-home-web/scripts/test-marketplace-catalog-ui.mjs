import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseUnits, zeroAddress } from "viem";

import {
  collectionFiltersKey,
  parseCollectionFilters
} from "../src/lib/collectionFilters.ts";
import {
  marketplaceChains,
  seaportDeployment
} from "../src/lib/marketplace/registry.ts";
import { openseaCurrencies } from "../src/lib/marketplace/openseaRegistry.ts";
import {
  tradingInformationStorageKey,
  tradingTermsStorageKey,
  tradingTermsVersion
} from "../src/lib/marketplace/tradingInformation.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-marketplace-catalog-ui-report.json"
    },
    screenshot: {
      type: "string",
      default: "/tmp/yunipals-marketplace-catalog-mobile.png"
    }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname) ||
  app.username ||
  app.password ||
  app.search ||
  app.hash
)
  throw new Error("Catalog UI tests require a loopback HTTP app.");
if (!values.playwright) throw new Error("Pass a local Playwright module path.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const report = {
  checkedAt: new Date().toISOString(),
  scope:
    "Read-only Chromium catalog UI with a 61-NFT in-memory fixture catalog, including 30 Polygon NFTs with opposing POL/WETH prices. All external browser requests are blocked. No wallet, signing, chain transactions, real orderbook, OpenSea API or production backend is used.",
  tests: []
};
const seller = "0x0000000000000000000000000000000000000001";
const observedAt = new Date().toISOString();
function row(tokenId, chain = "bnb") {
  const config = marketplaceChains[chain];
  const asset = {
    chain,
    chainId: config.chainId,
    contractAddress: config.contractAddress,
    tokenId: String(tokenId)
  };
  const amount =
    chain === "ethereum"
      ? "116999000000000"
      : (BigInt(31 - tokenId) * 10n ** 16n).toString();
  const listed = chain !== "bnb" || tokenId !== 7;
  return {
    token: {
      ...asset,
      name: `Catalog ${chain} ${tokenId}`,
      owner: seller,
      burned: false,
      hidden: false,
      lifecycle: 1,
      mintBlock: "1",
      lastTransferBlock: "1",
      image: null,
      tokenUri: null,
      metadataAvailable: true,
      attributes: [
        { trait_type: "Type", value: tokenId % 2 ? "Water" : "Fire" }
      ],
      rarityPoints: String(100 + tokenId),
      rarityPointsCapped: String(100 + tokenId)
    },
    market: {
      status: listed ? "listed" : "unlisted",
      listings: listed
        ? [
            {
              asset,
              lifecycle: 1,
              orderHash: `0x${String(tokenId).padStart(64, "0")}`,
              protocolAddress: seaportDeployment.address,
              source: config.source,
              side: "listing",
              maker: seller,
              currency: {
                address: zeroAddress,
                symbol: config.nativeSymbol,
                decimals: 18
              },
              grossAmount: amount,
              sellerProceeds: amount,
              fees: [],
              startTime: "100",
              endTime: "4102444800",
              status: "active"
            }
          ]
        : []
    }
  };
}
const dataset = [
  ...Array.from({ length: 30 }, (_, index) => row(index + 1)),
  row(1, "ethereum"),
  ...Array.from({ length: 30 }, (_, index) => {
    const item = row(index + 1, "polygon");
    const native = item.market.listings[0];
    const weth = {
      ...native,
      currency: {
        address: openseaCurrencies.polygon.address,
        symbol: "WETH",
        decimals: 18
      }
    };
    // Deliberately rank native POL in the opposite direction. Selecting WETH
    // must choose its listing before filtering, sorting and counting.
    native.grossAmount = native.sellerProceeds = (
      BigInt(index + 1) *
      10n ** 18n
    ).toString();
    native.orderHash = `0x${String(100 + index).padStart(64, "0")}`;
    item.market.listings.push(weth);
    return item;
  })
];
const requests = [];
const snapshots = new Map();
let unavailable = false;
let sourceUnavailable = false;
let incompleteEmptyCoverage = null;
let failNext = false;
let wrongSnapshot = false;
let snapshotCounter = 0;
let browser;
let page;
function pass(name) {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
}
function filteredRows(filters) {
  const eligible = dataset.map((item) => {
    if (filters.currency === "all") return item;
    const address =
      filters.currency === "native"
        ? zeroAddress
        : openseaCurrencies[item.token.chain]?.address;
    const listings = item.market.listings.filter(
      (order) => order.currency.address.toLowerCase() === address?.toLowerCase()
    );
    return {
      ...item,
      market: { status: listings.length ? "listed" : "unlisted", listings }
    };
  });
  const matches = eligible.filter((item) => {
    const order = item.market.listings[0];
    return (
      (!filters.chains.length || filters.chains.includes(item.token.chain)) &&
      (filters.sale === "all" || filters.sale === item.market.status) &&
      (!filters.priceMin ||
        (order &&
          BigInt(order.grossAmount) >= parseUnits(filters.priceMin, 18))) &&
      (!filters.priceMax ||
        (order &&
          BigInt(order.grossAmount) <= parseUnits(filters.priceMax, 18))) &&
      Object.entries(filters.traits).every(([name, selected]) =>
        item.token.attributes.some(
          (attribute) =>
            attribute.trait_type === name && selected.includes(attribute.value)
        )
      ) &&
      (!filters.rarityMin ||
        Number(item.token.rarityPointsCapped) >= Number(filters.rarityMin)) &&
      (!filters.rarityMax ||
        Number(item.token.rarityPointsCapped) <= Number(filters.rarityMax))
    );
  });
  matches.sort((a, b) => {
    if (filters.sort.startsWith("price")) {
      const left = BigInt(a.market.listings[0].grossAmount),
        right = BigInt(b.market.listings[0].grossAmount);
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      if (comparison)
        return filters.sort === "price-desc" ? -comparison : comparison;
    }
    if (filters.sort.startsWith("rarity")) {
      const comparison =
        Number(a.token.rarityPointsCapped) - Number(b.token.rarityPointsCapped);
      if (comparison)
        return filters.sort.endsWith("desc") ? -comparison : comparison;
    }
    const comparison = Number(a.token.tokenId) - Number(b.token.tokenId);
    return filters.sort === "token-id-desc" ? -comparison : comparison;
  });
  return structuredClone(matches);
}
try {
  browser = await chromium.launch({
    executablePath: values.chromium,
    headless: true,
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }
  });
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== app.origin) return route.abort();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
    if (url.pathname.startsWith("/__market-test")) {
      assert.equal(
        route.request().method(),
        "GET",
        "The catalog fixture never accepts a trade or signature."
      );
      requests.push(url.href);
      if (url.pathname.endsWith("/capabilities"))
        return json({
          schemaVersion: 1,
          chains: Object.fromEntries(
            Object.keys(marketplaceChains).map((chain) => [
              chain,
              {
                read: true,
                buy: chain === "bnb" || chain === "ethereum",
                createListing: false,
                createOffer: false,
                cancel: false,
                acceptOffer: false
              }
            ])
          )
        });
      // Token navigation is covered here; order/activity contents have their
      // own harnesses. An unavailable panel must not break the deep link.
      if (url.pathname.includes("/assets/"))
        return json({ error: "outside catalog fixture scope" }, 503);
      assert.ok(
        url.pathname.endsWith("/tokens"),
        `Unexpected market request: ${url.pathname}`
      );
      if (unavailable || (failNext && url.searchParams.has("cursor")))
        return json({ error: "fixture unavailable" }, 503);
      const filters = parseCollectionFilters(url.searchParams);
      const query = collectionFiltersKey(filters);
      const selected = filters.chains.length
        ? filters.chains
        : Object.keys(marketplaceChains);
      let snapshot = snapshots.get(url.searchParams.get("snapshot"));
      if (!url.searchParams.has("cursor")) {
        snapshot = {
          id: `catalog_${++snapshotCounter}`,
          observedAt,
          query,
          rows: incompleteEmptyCoverage ? [] : filteredRows(filters),
          sources: Object.fromEntries(
            selected.map((chain) => [
              chain,
              sourceUnavailable && chain === "bnb" ? "unavailable" : "available"
            ])
          )
        };
        if (sourceUnavailable)
          for (const item of snapshot.rows)
            if (item.token.chain === "bnb")
              item.market = { status: "unavailable", listings: [] };
        snapshots.set(snapshot.id, snapshot);
      }
      assert.ok(snapshot, "Continuation requires an issued snapshot.");
      assert.equal(query, snapshot.query, "Snapshot cannot cross filters.");
      const offset = Number(url.searchParams.get("cursor")?.slice(1) ?? 0);
      const items = snapshot.rows.slice(offset, offset + 24);
      const listingCompleteness =
        incompleteEmptyCoverage ??
        (Object.values(snapshot.sources).some(
          (status) => status !== "available"
        )
          ? "unavailable"
          : "complete");
      const verifiedListedTotal = snapshot.rows.filter(
        (item) => item.market.status === "listed"
      ).length;
      return json({
        schemaVersion: 2,
        query,
        snapshot: {
          id: wrongSnapshot && offset ? "wrong_snapshot" : snapshot.id,
          observedAt: snapshot.observedAt
        },
        sources: snapshot.sources,
        availability: Object.fromEntries(
          selected.map((chain) => {
            const available = snapshot.sources[chain] === "available";
            const coverage = {
              status:
                incompleteEmptyCoverage ??
                (available ? "complete" : "unavailable"),
              completedAt: available ? snapshot.observedAt : null,
              revision: available ? "fixture" : null
            };
            return [
              chain,
              {
                chain,
                evidence: available ? "current" : "unavailable",
                listings: coverage,
                offers: coverage
              }
            ];
          })
        ),
        listingCompleteness,
        total: snapshot.rows.length,
        listedTotal:
          listingCompleteness === "complete" ? verifiedListedTotal : null,
        verifiedListedTotal,
        items,
        nextCursor:
          offset + 24 < snapshot.rows.length ? `p${offset + 24}` : null
      });
    }
    if (url.pathname.startsWith("/__indexer-test")) {
      requests.push(url.href);
      const chains = url.searchParams.getAll("chain");
      const selection = {
        chains,
        chain: chains.length === 1 ? chains[0] : null
      };
      const rows = dataset.filter(
        (item) => !chains.length || chains.includes(item.token.chain)
      );
      const tokenMatch = url.pathname.match(/\/v1\/tokens\/([^/]+)\/(\d+)$/);
      if (tokenMatch) {
        const item = dataset.find(
          (item) =>
            item.token.chain === tokenMatch[1] &&
            item.token.tokenId === tokenMatch[2]
        );
        return item
          ? json({
              token: { ...item.token, token_id: item.token.tokenId },
              transfers: [],
              lifecycles: []
            })
          : json({ error: "Unknown fixture token" }, 404);
      }
      if (url.pathname.endsWith("/traits"))
        return json({
          ...selection,
          items: [
            {
              traitType: "Type",
              kind: "categorical",
              values: [
                {
                  value: "Fire",
                  count: rows.filter(
                    (row) => Number(row.token.tokenId) % 2 === 0
                  ).length
                },
                {
                  value: "Water",
                  count: rows.filter(
                    (row) => Number(row.token.tokenId) % 2 !== 0
                  ).length
                }
              ]
            },
            {
              traitType: "Rarity Points",
              kind: "numeric",
              min: "101",
              max: "130"
            }
          ],
          metadata: { available: rows.length, missing: 0 },
          updatedAt: observedAt
        });
      if (url.pathname.endsWith("/tokens")) {
        const rows = dataset.filter(
          (item) => !chains.length || chains.includes(item.token.chain)
        );
        return json({
          ...selection,
          items: rows.slice(0, 24).map((item) => item.token),
          total: rows.length,
          nextCursor: rows.length > 24 ? "legacy24" : null
        });
      }
      return json({}, 404);
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(12_000);
  const cards = page.locator("main article");
  async function count(expected) {
    await page.waitForFunction(
      (n) => document.querySelectorAll("main article").length === n,
      expected
    );
  }
  async function ids() {
    return cards
      .locator('a[aria-label^="View Catalog"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  }

  const homeResponse = await page.goto(`${app.origin}/`);
  const notice = page.getByRole("dialog", {
    name: "Buying and selling on Yunipals"
  });
  assert.equal(await notice.count(), 0);
  await page
    .getByRole("heading", { name: "Yunipals across chains." })
    .waitFor();
  await count(24);
  const tradingInfoButton = page
    .locator("footer")
    .getByRole("button", { name: "Buying and selling information" });
  await tradingInfoButton.click();
  await notice.waitFor();
  assert.match(
    await notice.innerText(),
    /Sellers publish BNB Chain orders in on-chain Seaport/
  );
  assert.equal(await notice.getByRole("checkbox").count(), 1);
  assert.equal(
    await notice
      .getByRole("button", { name: "Accept and continue", exact: true })
      .isDisabled(),
    true
  );
  await notice
    .getByRole("link", { name: "Yunipals Terms of Use", exact: true })
    .focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await notice
      .getByRole("button", { name: "Close buying and selling information" })
      .evaluate((button) => button === document.activeElement),
    true
  );
  await page.keyboard.press("Escape");
  assert.equal(await notice.count(), 0);
  assert.equal(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      tradingInformationStorageKey
    ),
    "dismissed"
  );
  const gatedBuy = cards
    .first()
    .getByRole("button", { name: "Buy", exact: true });
  await gatedBuy.click();
  await notice.waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "Review purchase" }).count(),
    0
  );
  await notice
    .getByRole("button", { name: "Browse only", exact: true })
    .click();
  assert.equal(
    await gatedBuy.evaluate((button) => button === document.activeElement),
    true
  );
  await tradingInfoButton.click();
  await notice.waitFor();
  await notice.getByRole("checkbox").check();
  await notice
    .getByRole("button", { name: "Accept and continue", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      ({ key, version }) =>
        JSON.parse(localStorage.getItem(key)).version === version,
      { key: tradingTermsStorageKey, version: tradingTermsVersion }
    ),
    true
  );
  assert.equal(
    await tradingInfoButton.evaluate(
      (button) => button === document.activeElement
    ),
    true
  );
  pass(
    "Collection browsing opens directly; buying and selling information gates Buy, records versioned acceptance and restores focus"
  );
  const homeTitle = "Yunipals — Explore the Collection";
  const homeDescription =
    "Explore Yunipals across Ethereum, Base, Polygon, and BNB Chain. Discover traits, rarity, token histories, and collector profiles.";
  assert.equal(await page.title(), homeTitle);
  const html = await homeResponse.text();
  assert.ok(html.includes("Yunipals — Explore the Collection"));
  assert.ok(html.includes(homeDescription));
  assert.ok(!html.includes("official collections across"));
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  assert.equal(
    await nav
      .getByRole("link", { name: "Collection", exact: true })
      .getAttribute("aria-current"),
    "page"
  );
  assert.equal(
    await nav.getByRole("link", { name: "Marketplaces", exact: true }).count(),
    0
  );
  const islands = page
    .locator("footer")
    .getByRole("link", { name: /Islands.*Grassland Archipelago/ });
  assert.equal(
    await islands.getAttribute("href"),
    "https://opensea.io/collection/yunipals-islands"
  );
  assert.equal(await islands.getAttribute("target"), "_blank");
  assert.ok((await page.locator("footer").innerText()).includes("BNB Chain"));
  const sitemap = await page.request.get(`${app.origin}/sitemap.xml`, {
    maxRedirects: 0
  });
  assert.equal(sitemap.status(), 200);
  assert.ok(!(await sitemap.text()).includes("/collection</loc>"));
  await page.screenshot({
    path: values.screenshot.replace(/\.png$/, "-home.png")
  });
  pass(
    "The home page opens the catalog directly, preserves Islands discovery and serves updated static metadata and sitemap"
  );

  await page.goto(`${app.origin}/?chain=ethereum&sale=listed`);
  await count(1);
  assert.equal(
    await cards.first().getByText("≈ 0.000117 ETH", { exact: true }).count(),
    1
  );
  const attribution = cards
    .first()
    .getByRole("link", { name: /View listing for #1 on OpenSea/ });
  assert.equal(
    (await attribution.getAttribute("href")).toLowerCase(),
    `https://opensea.io/assets/ethereum/${marketplaceChains.ethereum.contractAddress}/1`
  );
  assert.equal(await attribution.getAttribute("target"), "_blank");
  assert.equal(
    await cards.first().getByText("OpenSea", { exact: true }).count(),
    0
  );
  await cards.first().getByRole("button", { name: "Buy", exact: true }).click();
  const exactReview = page.getByRole("dialog", { name: "Review purchase" });
  await exactReview.waitFor();
  assert.match(await exactReview.innerText(), /≈ 0\.000117 ETH/);
  await exactReview.getByRole("button", { name: "Show exact amounts" }).click();
  assert.match(await exactReview.innerText(), /0\.000116999 ETH/);
  assert.ok(!(await exactReview.innerText()).includes("≈"));
  await exactReview
    .getByRole("button", { name: "Show rounded amounts" })
    .click();
  assert.match(await exactReview.innerText(), /≈ 0\.000117 ETH/);
  await page.keyboard.press("Escape");
  pass(
    "OpenSea cards and purchase review use rounded prices with an exact-amount toggle"
  );

  const legacySearch =
    "?chain=bnb&chain=polygon&trait.Type=Water&sort=token-id-asc&future=value%2Bkept";
  await page.goto(`${app.origin}/collection${legacySearch}#collection`);
  await page.waitForURL(`${app.origin}/${legacySearch}#collection`);
  await count(24);
  assert.equal(new URL(page.url()).search, legacySearch);
  await page.reload();
  await count(24);
  assert.equal(await notice.count(), 0);
  pass("Buying and selling information stays closed during collection navigation and reload");
  assert.equal(new URL(page.url()).search, legacySearch);
  for (const hash of ["#marketplaces", "#ethereum-collection"]) {
    await page.goto(`${app.origin}/${hash}`);
    await page.waitForFunction(() => {
      const top = document
        .getElementById("collection")
        ?.getBoundingClientRect().top;
      return top !== undefined && top >= 0 && top < 150;
    });
  }
  pass(
    "Legacy collection links retain repeated filters, opaque query values and hashes through redirect and reload; former home anchors reach the catalog"
  );

  await page.goto(`${app.origin}/collection?chain=bnb&sort=token-id-asc`);
  await count(24);
  assert.equal(
    await cards.getByRole("link", { name: /on OpenSea/ }).count(),
    0
  );
  await count(24);
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(
    await page.getByText(/^Prices checked /).count(),
    0,
    "Healthy catalog freshness is internal monitoring data."
  );
  assert.equal(
    await page.getByRole("button", { name: "Refresh prices" }).count(),
    0,
    "A healthy, automatically refreshed catalog has no manual price control."
  );
  assert.equal((await ids())[0], "/collection/bnb/1");
  assert.ok(!(await ids()).includes("/collection/bnb/30"));
  await page
    .getByRole("combobox", { name: "Sort collection" })
    .selectOption("price-asc");
  await page.waitForFunction(
    () =>
      document
        .querySelector('main article a[aria-label^="View Catalog"]')
        ?.getAttribute("href") === "/collection/bnb/30"
  );
  assert.match(page.url(), /sale=listed/);
  assert.match(page.url(), /currency=native/);
  assert.equal(
    await cards.first().getByText("0.01 BNB", { exact: true }).count(),
    1
  );
  assert.ok(
    (await page.locator("main").innerText()).includes(
      "29 Yunipals · 29 for sale"
    )
  );
  assert.equal(await page.locator("a button, a a").count(), 0);
  pass(
    "Price sort finds the cheapest NFT beyond the previous 24-card page and displays full-query counts"
  );

  await cards.first().getByRole("button", { name: "Buy", exact: true }).click();
  await page.getByRole("dialog", { name: "Review purchase" }).waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /0\.01 BNB/);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(
    await cards
      .first()
      .getByRole("button", { name: "Buy", exact: true })
      .evaluate((button) => button === document.activeElement),
    true
  );
  pass(
    "A catalog Buy button opens exact-price review and Escape restores card focus without wallet calls"
  );

  const firstRequest = requests
    .filter(
      (url) => url.includes("/market/tokens") && url.includes("sort=price-asc")
    )
    .at(-1);
  assert.ok(firstRequest);
  await page.getByRole("button", { name: "Load more Yunipals" }).click();
  await count(29);
  const nextRequest = new URL(
    requests
      .filter(
        (url) => url.includes("/market/tokens") && url.includes("cursor=")
      )
      .at(-1)
  );
  assert.equal(nextRequest.searchParams.get("cursor"), "p24");
  assert.ok(nextRequest.searchParams.get("snapshot"));
  assert.equal(new Set(await ids()).size, 29);
  assert.equal((await ids()).at(-1), "/collection/bnb/1");
  pass(
    "Load more keeps the catalog snapshot and appends distinct NFTs in global price order"
  );

  const aside = page.locator("aside");
  await aside
    .getByRole("textbox", { name: "Minimum listing price" })
    .fill("0.01");
  await aside
    .getByRole("textbox", { name: "Maximum listing price" })
    .fill("0.07");
  await aside.getByRole("button", { name: "Apply price range" }).click();
  await count(7);
  await aside.getByRole("checkbox", { name: /Fire/ }).click();
  await count(4);
  assert.equal(
    await aside.getByRole("checkbox", { name: /Fire/ }).isChecked(),
    true
  );
  assert.deepEqual(
    await ids(),
    [30, 28, 26, 24].map((id) => `/collection/bnb/${id}`)
  );
  await page.reload();
  await count(4);
  assert.equal(
    await page
      .locator("aside")
      .getByRole("textbox", { name: "Maximum listing price" })
      .inputValue(),
    "0.07"
  );
  pass(
    "Price range and traits combine across the full catalog and survive URL reload"
  );

  await page
    .locator("aside")
    .getByRole("button", { name: "Base", exact: true })
    .click();
  await count(15);
  const changed = new URL(page.url());
  assert.equal(changed.searchParams.has("priceMax"), false);
  assert.equal(changed.searchParams.has("currency"), false);
  assert.equal(changed.searchParams.has("sort"), false);
  assert.equal(
    await page
      .getByRole("combobox", { name: "Sort collection" })
      .locator('option[value="price-asc"]')
      .isDisabled(),
    true
  );
  pass(
    "Changing selected chains clears numeric amounts and prevents cross-chain price sorting"
  );

  await page.goto(`${app.origin}/collection?chain=bnb&sort=token-id-asc`);
  await count(24);
  wrongSnapshot = true;
  const beforeRecovery = snapshotCounter;
  const recoveredResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/v2/market/tokens") &&
      !new URL(response.url()).searchParams.has("cursor")
  );
  await page.getByRole("button", { name: "Load more Yunipals" }).click();
  await recoveredResponse;
  await count(24);
  assert.ok(snapshotCounter > beforeRecovery);
  assert.equal(new URL(page.url()).searchParams.get("sort"), "token-id-asc");
  wrongSnapshot = false;
  failNext = true;
  await page.getByRole("button", { name: "Load more Yunipals" }).click();
  await page
    .getByText(
      "The next page could not be loaded. Existing results are still shown."
    )
    .waitFor();
  assert.equal(await cards.count(), 24);
  failNext = false;
  pass(
    "Changed snapshots recover automatically; generic pagination failures retain cards and manual retry"
  );

  unavailable = true;
  await page.goto(
    `${app.origin}/collection?chain=bnb&sale=listed&currency=native&priceMax=0.07`
  );
  await page
    .getByText(
      "Sale and price results are unavailable. Your filters are still applied."
    )
    .waitFor();
  assert.equal(await cards.count(), 0);
  const beforeFallback = requests.filter((url) =>
    url.includes("/__indexer-test/v1/tokens")
  ).length;
  assert.equal(beforeFallback, 0);
  await page
    .getByRole("button", { name: "Remove sale and price filters" })
    .click();
  await page
    .getByText("Prices are unavailable. Showing collection details only.")
    .waitFor();
  await count(24);
  assert.ok(
    requests.filter((url) => url.includes("/__indexer-test/v1/tokens")).length >
      beforeFallback
  );
  assert.equal(
    await cards
      .getByText("Prices temporarily unavailable", { exact: true })
      .count(),
    24
  );
  pass(
    "An API outage never drops financial filters; clearing them allows clearly marked metadata-only fallback"
  );

  unavailable = false;
  sourceUnavailable = true;
  await page.goto(`${app.origin}/collection?chain=bnb`);
  await count(24);
  assert.equal(
    await cards
      .getByText("Prices temporarily unavailable", { exact: true })
      .count(),
    24
  );
  assert.equal(await cards.getByText("Not listed", { exact: true }).count(), 0);
  await page
    .locator("aside")
    .getByRole("combobox", { name: "Sale availability" })
    .selectOption("unlisted");
  await page
    .getByText(
      "Sale and price results are unavailable. Your filters are still applied."
    )
    .waitFor();
  assert.equal(await cards.count(), 0);
  sourceUnavailable = false;
  pass(
    "Unavailable marketplace sources remain unknown and cannot be mistaken for unlisted NFTs"
  );

  for (const coverage of ["partial", "unavailable"]) {
    incompleteEmptyCoverage = coverage;
    await page.goto(`${app.origin}/collection?chain=ethereum&sale=listed`);
    await page
      .getByText("Listings are temporarily unavailable.", { exact: true })
      .waitFor();
    assert.equal(await cards.count(), 0);
    assert.equal(
      await page.getByText("No Yunipals match this combination.").count(),
      0
    );
    assert.equal(
      await page
        .getByText(
          /0 Yunipals|0 verified listings|Verified listings remain available/
        )
        .count(),
      0
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Clear all filters", exact: true })
        .count(),
      0
    );
    await page
      .getByText("Please try again shortly. Your filters are still applied.")
      .waitFor();
    incompleteEmptyCoverage = null;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await count(1);
    assert.equal(new URL(page.url()).searchParams.get("chain"), "ethereum");
    assert.equal(new URL(page.url()).searchParams.get("sale"), "listed");
  }
  pass(
    "Empty incomplete listing feeds show an outage, preserve filters, and recover on retry"
  );

  await page.goto(
    `${app.origin}/collection?chain=ethereum&sale=listed&rarityMin=999999`
  );
  await page.getByText("No Yunipals match this combination.").waitFor();
  assert.equal(
    await page
      .getByText("Listings are temporarily unavailable.", { exact: true })
      .count(),
    0
  );
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .waitFor();
  pass("A complete listing feed still shows the genuine no-matches state");

  await page.goto(
    `${app.origin}/collection?chain=bnb&sale=listed&currency=native&priceMin=0.001e2`
  );
  await page
    .getByText("Enter a price with up to 18 decimal places, such as 0.1.")
    .waitFor();
  assert.equal(await cards.count(), 0);
  pass(
    "Malformed price URLs show a corrective error without a broadened search"
  );

  await page.goto(`${app.origin}/collection?chain=polygon&sort=token-id-asc`);
  await count(24);
  assert.equal((await ids())[0], "/collection/polygon/1");
  await page
    .getByRole("combobox", { name: "Sort collection" })
    .selectOption("price-asc");
  await page.waitForFunction(
    () =>
      document
        .querySelector('main article a[aria-label^="View Catalog"]')
        ?.getAttribute("href") === "/collection/polygon/30"
  );
  assert.equal(new URL(page.url()).searchParams.get("currency"), "weth");
  await cards.first().getByText("0.01 WETH", { exact: true }).waitFor();
  assert.equal(
    await cards.first().getByText("30 POL", { exact: true }).count(),
    0
  );
  await page.getByRole("button", { name: "Load more Yunipals" }).click();
  await count(30);
  assert.deepEqual(
    await ids(),
    Array.from({ length: 30 }, (_, i) => `/collection/polygon/${30 - i}`)
  );
  pass(
    "Polygon price sorting defaults to WETH and paginates all 30 NFTs without ranking POL amounts"
  );

  const sidebar = page.locator("aside");
  await sidebar
    .getByRole("textbox", { name: "Minimum listing price" })
    .fill("0.01");
  await sidebar
    .getByRole("textbox", { name: "Maximum listing price" })
    .fill("0.07");
  await sidebar.getByRole("button", { name: "Apply price range" }).click();
  await count(7);
  await sidebar.getByRole("checkbox", { name: /Fire/ }).click();
  await count(4);
  assert.deepEqual(
    await ids(),
    [30, 28, 26, 24].map((id) => `/collection/polygon/${id}`)
  );
  await page.reload();
  await count(4);
  assert.equal(
    await sidebar
      .getByRole("combobox", { name: "Listing currency" })
      .inputValue(),
    "weth"
  );
  assert.equal(
    await sidebar
      .getByRole("textbox", { name: "Maximum listing price" })
      .inputValue(),
    "0.07"
  );
  pass(
    "WETH ranges combine with traits and survive a URL reload with the exact currency"
  );

  await sidebar
    .getByRole("textbox", { name: "Maximum listing price" })
    .fill("999");
  await sidebar
    .getByRole("combobox", { name: "Listing currency" })
    .selectOption("native");
  await count(15);
  assert.equal(new URL(page.url()).searchParams.has("priceMax"), false);
  assert.equal(new URL(page.url()).searchParams.has("priceMin"), false);
  assert.equal(new URL(page.url()).searchParams.get("sort"), "price-asc");
  assert.equal(
    await sidebar
      .getByRole("textbox", { name: "Maximum listing price" })
      .inputValue(),
    ""
  );
  assert.equal((await ids())[0], "/collection/polygon/2");
  await cards.first().getByText("2 POL", { exact: true }).waitFor();
  await sidebar
    .getByRole("combobox", { name: "Listing currency" })
    .selectOption("weth");
  await page.waitForFunction(
    () =>
      document
        .querySelector('main article a[aria-label^="View Catalog"]')
        ?.getAttribute("href") === "/collection/polygon/30"
  );
  await page
    .getByRole("combobox", { name: "Sort collection" })
    .selectOption("price-desc");
  await page.waitForFunction(
    () =>
      document
        .querySelector('main article a[aria-label^="View Catalog"]')
        ?.getAttribute("href") === "/collection/polygon/2"
  );
  assert.equal(new URL(page.url()).searchParams.get("currency"), "weth");
  await cards.first().getByText("0.29 WETH", { exact: true }).waitFor();
  pass(
    "Switching POL/WETH clears applied and unsaved bounds; changing sort direction preserves WETH"
  );

  const beforeInvalid = requests.filter(
    (url) =>
      url.includes("/v1/market/tokens") ||
      url.includes("/__indexer-test/v1/tokens")
  ).length;
  for (const query of [
    "chain=polygon&currency=USDT",
    "chain=polygon&sale=listed&currency=weth&currency=native",
    "chain=bnb&sale=listed&currency=weth"
  ]) {
    await page.goto(`${app.origin}/collection?${query}`);
    await page
      .getByText("Choose a supported listing currency for this chain.")
      .waitFor();
    assert.equal(await cards.count(), 0);
  }
  assert.equal(
    requests.filter(
      (url) =>
        url.includes("/v1/market/tokens") ||
        url.includes("/__indexer-test/v1/tokens")
    ).length,
    beforeInvalid
  );
  pass(
    "Unknown, conflicting and BNB WETH currency URLs block catalog requests and metadata fallback"
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `${app.origin}/collection?chain=bnb&sort=price-asc&sale=listed&currency=native`
  );
  await count(24);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const drawer = page.getByRole("dialog", { name: "Filter collection" });
  await drawer
    .getByRole("textbox", { name: "Maximum listing price" })
    .fill("0.02");
  await drawer
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await count(2);
  assert.deepEqual(await ids(), ["/collection/bnb/30", "/collection/bnb/29"]);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await cards.first().evaluate((card) =>
    window.scrollTo({
      top: card.getBoundingClientRect().top + window.scrollY - 200
    })
  );
  await page.screenshot({ path: values.screenshot });
  assert.deepEqual(errors, []);
  pass(
    "Mobile sale and price filters apply with two-column cards, no horizontal overflow and no page errors"
  );

  await page.goto(
    `${app.origin}/collection?chain=polygon&sort=price-asc&sale=listed&currency=weth`
  );
  await count(24);
  const beforeDraft = requests.filter((url) =>
    url.includes("/v2/market/tokens")
  ).length;
  await page.getByRole("button", { name: /^Filters/ }).click();
  await drawer.getByText("Price in WETH", { exact: true }).waitFor();
  await drawer
    .getByRole("textbox", { name: "Maximum listing price" })
    .fill("0.02");
  assert.equal(
    requests.filter((url) => url.includes("/v2/market/tokens")).length,
    beforeDraft
  );
  await drawer
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await count(2);
  assert.deepEqual(await ids(), [
    "/collection/polygon/30",
    "/collection/polygon/29"
  ]);
  assert.equal(
    requests.filter((url) => url.includes("/v2/market/tokens")).length,
    beforeDraft + 1
  );
  await cards.first().getByText("0.01 WETH", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  assert.match(
    await page
      .getByRole("button", { name: "Remove sale and price filters" })
      .innerText(),
    /0–0.02 WETH/
  );
  await cards.first().evaluate((card) =>
    window.scrollTo({
      top: card.getBoundingClientRect().top + window.scrollY - 200
    })
  );
  await page.screenshot({
    path: values.screenshot.replace(/\.png$/, "-weth.png")
  });
  assert.deepEqual(errors, []);
  pass(
    "Mobile WETH filters stay draft until Apply, request once and show exact WETH prices without overflow"
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app.origin}/?chain=bnb&sort=token-id-asc`);
  await count(24);
  await cards.first().getByRole("link", { name: "View Catalog bnb 1" }).click();
  await page
    .getByRole("heading", { name: "Catalog bnb 1", exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/collection/bnb/1");
  assert.equal(
    await nav
      .getByRole("link", { name: "Collection", exact: true })
      .getAttribute("aria-current"),
    "page"
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    "https://www.yunipals.com/collection/bnb/1"
  );
  assert.equal(
    await page.locator('meta[property="og:url"]').getAttribute("content"),
    "https://www.yunipals.com/collection/bnb/1"
  );
  assert.equal(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
    await page.title()
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await count(24);
  assert.equal(new URL(page.url()).search, "?chain=bnb&sort=token-id-asc");
  await page.goto(`${app.origin}/collection/1?ref=legacy#top`);
  await page.waitForURL(`${app.origin}/collection/ethereum/1?ref=legacy#top`);
  await page
    .getByRole("heading", { name: "Catalog ethereum 1", exact: true })
    .waitFor();
  pass(
    "Existing chain/token links keep their identity and metadata; Back preserves home filters and legacy Ethereum token links retain query and hash"
  );

  assert.equal(
    await nav.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  await page.goto(`${app.origin}/orders`);
  await page.getByRole("heading", { name: "My orders", exact: true }).waitFor();
  assert.equal(
    await page.locator('meta[name="robots"]').getAttribute("content"),
    "noindex, follow"
  );
  assert.equal(
    await nav.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  await page.getByRole("link", { name: "Order recovery", exact: true }).click();
  assert.equal(
    await nav.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  await nav.getByRole("link", { name: "Collection", exact: true }).click();
  await count(24);
  assert.equal(await page.title(), homeTitle);
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]'
  ])
    assert.equal(
      await page.locator(selector).getAttribute("content"),
      homeDescription
    );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    "https://www.yunipals.com/"
  );
  assert.equal(
    await page.locator('meta[name="robots"]').getAttribute("content"),
    "index, follow"
  );
  pass(
    "Orders stay out of primary navigation; returning home resets canonical, social descriptions and indexing metadata"
  );

  for (const width of [768, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      `Home overflows at ${width}px`
    );
  }
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  assert.equal(
    await mobileNav.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  await mobileNav.getByRole("link", { name: "Collection", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "All active Yunipals" }).waitFor();
  assert.equal(await mobileNav.count(), 0);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await mobileNav
    .getByRole("textbox", { name: "Collector wallet address or ENS name" })
    .fill(seller);
  await mobileNav.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForURL(`${app.origin}/collector/${seller}`);
  assert.equal(await mobileNav.count(), 0);
  await page.getByRole("link", { name: "Yunipals home", exact: true }).click();
  await count(24);
  await page.screenshot({
    path: values.screenshot.replace(/\.png$/, "-home-mobile.png")
  });
  await islands.scrollIntoViewIfNeeded();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({
    path: values.screenshot.replace(/\.png$/, "-home-footer.png")
  });
  assert.deepEqual(errors, []);
  pass(
    "Home and footer fit tablet and phone widths; mobile primary navigation excludes orders and keyboard navigation closes the menu"
  );
  const fallbackPage = await context.newPage();
  fallbackPage.on("pageerror", (error) => errors.push(error.message));
  await fallbackPage.addInitScript(
    ({ noticeKey, termsKey }) => {
      for (const method of ["getItem", "setItem"]) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (
            this === window.localStorage &&
            [noticeKey, termsKey].includes(key)
          )
            throw new DOMException("Notice storage blocked", "SecurityError");
          return original.call(this, key, ...args);
        };
      }
    },
    {
      noticeKey: tradingInformationStorageKey,
      termsKey: tradingTermsStorageKey
    }
  );
  await fallbackPage.goto(`${app.origin}/?chain=bnb&sale=listed`);
  const fallbackNotice = fallbackPage.getByRole("dialog", {
    name: "Buying and selling on Yunipals"
  });
  assert.equal(await fallbackNotice.count(), 0);
  await fallbackPage
    .locator("footer")
    .getByRole("button", { name: "Buying and selling information" })
    .click();
  await fallbackNotice
    .getByRole("button", { name: "Browse only", exact: true })
    .click();
  await fallbackPage.reload();
  await fallbackPage.locator("main article").first().waitFor();
  assert.equal(await fallbackNotice.count(), 0);
  await fallbackPage.close();
  pass(
    "Collection browsing stays free of the notice when local storage operations fail"
  );

  const privatePage = await context.newPage();
  privatePage.on("pageerror", (error) => errors.push(error.message));
  await privatePage.setViewportSize({ width: 390, height: 844 });
  await privatePage.addInitScript(
    ({ noticeKey, termsKey }) => {
      for (const method of ["getItem", "setItem"]) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if ([noticeKey, termsKey].includes(key))
            throw new DOMException("Notice storage blocked", "SecurityError");
          return original.call(this, key, ...args);
        };
      }
    },
    {
      noticeKey: tradingInformationStorageKey,
      termsKey: tradingTermsStorageKey
    }
  );
  await privatePage.goto(`${app.origin}/collection/ethereum/1`);
  const privateNotice = privatePage.getByRole("dialog", {
    name: "Buying and selling on Yunipals"
  });
  assert.equal(await privateNotice.count(), 0);
  await privatePage
    .locator("footer")
    .getByRole("button", { name: "Buying and selling information" })
    .click();
  await privateNotice.waitFor();
  const bounds = await privateNotice.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await privatePage.screenshot({
    path: values.screenshot.replace(/\.png$/, "-trading-information.png")
  });
  await privateNotice
    .getByRole("button", { name: "Close buying and selling information" })
    .click();
  await privatePage
    .getByRole("heading", { name: "Catalog ethereum 1", exact: true })
    .waitFor();
  assert.equal(await privateNotice.count(), 0);
  assert.equal(new URL(privatePage.url()).pathname, "/collection/ethereum/1");
  await privatePage.close();
  assert.deepEqual(errors, []);
  pass(
    "The on-demand notice fits mobile deep links and stays dismissible when both storage adapters fail"
  );
  assert.equal(
    requests.some(
      (url) => new URL(url).pathname === "/__indexer-test/v1/collection"
    ),
    false,
    "Collection navigation must not fetch the removed statistics row"
  );
  pass("Collection navigation and filters do not request collection statistics");
  report.status = "passed";
  report.requestCount = requests.length;
} catch (error) {
  report.status = "failed";
  if (page) {
    report.pageUrl = page.url();
    report.pageText = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    await page.screenshot({ path: values.screenshot }).catch(() => {});
  }
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await browser?.close();
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
