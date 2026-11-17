import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5198" },
    playwright: {
      type: "string",
      default: process.env.PLAYWRIGHT_MODULE
    },
    chromium: {
      type: "string",
      default: process.env.CHROMIUM_EXECUTABLE
    }
  }
});
const app = new URL(values.url);
assert.ok(["localhost", "127.0.0.1"].includes(app.hostname));
const api = "http://127.0.0.1:59985";
const collection = "0x105319be2182018c31fb10b1be198c3cf238a146";
const owner = "0xb3883cd96d72b08b8226452305a28d65974a3727";
const other = "0x1111111111111111111111111111111111111111";
const originalContract = "0x98433df878e8c898cb907345c3a7756e5f72240f";
const pack = (id, wallet, color = "3", type = "4") => ({
  id: `8453:${collection}:${id}`,
  collection,
  tokenId: id,
  originalKey: `8453:${collection}:1`,
  requestKey: "8453:engine:1",
  typeKey: "8453:registry:2",
  owner: wallet,
  mintedTo: wallet,
  variantId: "73",
  monsterType: type,
  color,
  horn: "1",
  glitter: "0",
  isOriginal: id === "1",
  burned: false,
  mintBlock: "100",
  metadataUri: `${api}/art/73.json`
});
const packs = [
  pack("1", owner),
  pack("2", other, "4"),
  pack("3", owner, "2", "7")
];
const original = (wallet = owner, chain = "base") => ({
  chain,
  chainId: chain === "base" ? 8453 : 1,
  contractAddress:
    chain === "base"
      ? originalContract
      : "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  tokenId: "1",
  owner: wallet,
  burned: false,
  lifecycle: 0,
  mintBlock: "1",
  lastTransferBlock: "1",
  name: "OG Yunidragon",
  image: `${api}/card.svg`,
  attributes: [
    { trait_type: "Type", value: "Yunidragon" },
    { trait_type: "Color", value: "Blue" }
  ],
  tokenUri: "https://example.test/og/1.json",
  rarityPoints: "200",
  rarityPointsCapped: "150"
});
const snapshot = {
  chainId: 8453,
  collection,
  engine: "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609",
  enabled: true,
  requestsPaused: false,
  indexedBlock: "200",
  indexedBlockHash: `0x${"aa".repeat(32)}`,
  indexedTimestamp: "1792690409"
};
let leak = false;
const requests = [];
const external = [];
const errors = [];
const { chromium } = await import(
  values.playwright ? pathToFileURL(values.playwright).href : "playwright-core"
);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 }
});
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.origin === app.origin) return route.continue();
  if (url.origin !== api) {
    external.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort();
  }
  requests.push(url.pathname + url.search);
  if (url.pathname === "/card.svg")
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#ded2fa"/></svg>'
    });
  if (url.pathname === "/art/73.json")
    return route.fulfill({
      json: {
        name: "Yunidragon",
        image: `${api}/card.svg`,
        attributes: [],
        yunipals: { status: "ready" }
      }
    });
  if (url.pathname.startsWith("/v1/boosters/originals/"))
    return route.fulfill({
      status: 404,
      json: { error: "original_not_found" }
    });
  if (url.pathname.endsWith("/resolve"))
    return route.fulfill({
      json: {
        ownerInput: "collector.eth",
        ownerName: "collector.eth",
        resolvedAddresses: { base: owner }
      }
    });
  if (url.pathname === "/v1/collector-capabilities")
    return route.fulfill({ status: 404, json: { error: "not_found" } });
  if (url.pathname.endsWith("/leaderboard"))
    return route.fulfill({
      status: 404,
      json: { error: "collector_not_ranked" }
    });
  if (url.pathname === "/v1/traits")
    return route.fulfill({
      json: {
        chain: null,
        chains: ["ethereum", "base", "polygon", "bnb"],
        items: [],
        metadata: { available: 1, missing: 0 },
        updatedAt: "2026-10-23T09:00:00Z"
      }
    });
  if (url.pathname === "/v1/boosters/monsters") {
    assert.equal(url.searchParams.get("limit"), "24");
    const after = url.searchParams.get("after");
    return route.fulfill({
      json: {
        ...snapshot,
        items: after ? [packs[2]] : packs.slice(0, 2),
        nextCursor: after ? null : "2"
      }
    });
  }
  const walletPacks = /^\/v1\/owners\/(0x[0-9a-f]+)\/booster-monsters$/.exec(
    url.pathname
  );
  if (walletPacks) {
    const wallet = walletPacks[1];
    const after = url.searchParams.get("after");
    const items = leak
      ? [packs[0]]
      : wallet === owner
        ? [after ? packs[2] : packs[0]]
        : [packs[1]];
    return route.fulfill({
      json: {
        ...snapshot,
        items,
        nextCursor: !leak && wallet === owner && !after ? "1" : null
      }
    });
  }
  const walletTokens = /^\/v1\/owners\/(0x[0-9a-f]+)\/tokens$/.exec(
    url.pathname
  );
  if (url.pathname === "/v1/tokens" || walletTokens) {
    const wallet = walletTokens?.[1] ?? owner;
    const chain = url.searchParams.getAll("chain");
    const items =
      url.searchParams.get("visibility") === "hidden"
        ? []
        : [original(wallet, chain.includes("base") ? "base" : "ethereum")];
    return route.fulfill({
      json: {
        owner: wallet,
        resolvedAddresses: { base: wallet },
        chain: null,
        chains: ["ethereum", "base", "polygon", "bnb"],
        items,
        total: items.length,
        nextCursor: null,
        visibility: url.searchParams.get("visibility") ?? "visible"
      }
    });
  }
  return route.fulfill({ json: { items: [], total: 0, nextCursor: null } });
});
await context.addInitScript(
  ({ owner }) => {
    const listeners = new Map();
    let connected =
      localStorage.getItem("collection-test-connected") === "true";
    window.ethereum = {
      isMetaMask: true,
      on: (name, handler) =>
        listeners.set(name, [...(listeners.get(name) ?? []), handler]),
      removeListener: (name, handler) =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((entry) => entry !== handler)
        ),
      request: async ({ method }) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_accounts") return connected ? [owner] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          localStorage.setItem("collection-test-connected", "true");
          for (const handler of listeners.get("accountsChanged") ?? [])
            handler([owner]);
          return [owner];
        }
        if (
          method === "wallet_requestPermissions" ||
          method === "wallet_getPermissions"
        )
          return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_getBalance") return "0x0";
        if (method === "eth_blockNumber") return "0xc8";
        return null;
      }
    };
  },
  { owner }
);
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const packsVisible = () =>
  page.locator(`main article a[href^="/monsters/${collection}/"]`);
const originalVisible = (chain) =>
  page.locator(`main article a[href="/collection/${chain}/1"]`);
const editions = () =>
  page.getByRole("navigation", { name: "Yunipals collections", exact: true });
try {
  await page.goto(app.href);
  const browseOnly = page.getByRole("button", {
    name: "Browse only",
    exact: true
  });
  if (await browseOnly.isVisible()) await browseOnly.click();
  await originalVisible("ethereum").first().waitFor();
  assert.equal(await packsVisible().count(), 0);
  assert.equal(await originalVisible("base").count(), 0);
  await editions()
    .getByRole("link", { name: "OG Base", exact: true })
    .click();
  await originalVisible("base").first().waitFor();
  assert.equal(await packsVisible().count(), 0);
  assert.equal(await originalVisible("ethereum").count(), 0);
  await editions()
    .getByRole("link", { name: "TCG", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .first()
    .waitFor();
  assert.equal(
    await page.locator('main article a[href^="/collection/"]').count(),
    0
  );
  await page.getByRole("button", { name: "Load more pack cards" }).click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .first()
    .waitFor();
  checks.push(
    "public OG, airdrop and TCG membership; same token ID stays distinct; numeric TCG pagination"
  );

  await page.goto(`${app.origin}/?edition=tcg&t.Type=Yuniturtle`);
  await page
    .getByText("No matches in the loaded cards yet.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Load more pack cards" }).click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .first()
    .waitFor();
  checks.push("filtered TCG matches on later pages remain discoverable");

  await page.evaluate(() =>
    localStorage.setItem(
      "yunipals.collector.filters.v1",
      "chain=ethereum&chain=polygon&chain=bnb&rarityMin=200"
    )
  );
  await page.goto(`${app.origin}/collector/${owner}?edition=og`);
  await originalVisible("ethereum").first().waitFor();
  await editions()
    .getByRole("link", { name: "TCG", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .first()
    .waitFor();
  assert.equal(await page.getByText(/rankings/i).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Hidden NFTs", exact: true })
      .count(),
    0
  );
  assert.equal(
    await page.locator('main article a[href^="/collection/"]').count(),
    0
  );
  await page
    .getByRole("searchbox", { name: "Search your TCG collection" })
    .fill("3");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matches in loaded cards", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load more pack cards" }).click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .first()
    .waitFor();
  await editions()
    .getByRole("link", { name: "OG Base", exact: true })
    .click();
  await originalVisible("base").first().waitFor();
  await editions()
    .getByRole("link", { name: "TCG", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("searchbox", { name: "Search your TCG collection" })
      .inputValue(),
    "3"
  );
  await page.goto(`${app.origin}/collector/${owner}`);
  assert.equal(
    await page
      .getByRole("searchbox", { name: "Search your TCG collection" })
      .inputValue(),
    "3"
  );
  await page.getByText("No matches in loaded cards", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Load more pack cards" }).click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get("edition") === "tcg" &&
      !new URL(location.href).searchParams.has("q")
  );
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), []);
  checks.push(
    "TCG-only holdings survive OG ranking 404; independent saved filters and scoped clear"
  );

  await page.goBack();
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("q") === "3"
  );
  await page.goForward();
  await page.waitForFunction(
    () => !new URL(location.href).searchParams.has("q")
  );
  await page.goto(`${app.origin}/collector/collector.eth?edition=tcg`);
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .first()
    .waitFor();
  assert.ok(
    requests.some((request) =>
      request.startsWith("/v1/owners/collector.eth/resolve?chain=base")
    )
  );
  checks.push(
    "browser history and ENS Base resolution independent of OG holdings"
  );

  await page.goto(`${app.origin}/collector/${owner}?edition=tcg`);
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .first()
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await editions().getByRole("link").count(), 4);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page.screenshot({
    path: "/tmp/yunipals-collection-tcg-mobile.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "/tmp/yunipals-collection-tcg-desktop.png",
    fullPage: true
  });
  checks.push(
    "all collection choices visible on mobile without horizontal overflow"
  );

  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser Wallet/i }).click();
  await page
    .getByRole("button", { name: "Account menu", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const menu = page.getByRole("menu", { name: "Account menu" });
  assert.equal(await menu.getByRole("menuitem").count(), 5);
  await menu
    .getByRole("menuitem", { name: "My OG collection", exact: true })
    .click();
  await originalVisible("ethereum").first().waitFor();
  assert.equal(await menu.count(), 0);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await menu
    .getByRole("menuitem", { name: "My TCG collection", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .first()
    .waitFor();
  assert.equal(await menu.count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("edition"), "tcg");
  checks.push(
    "connected wallet menu exposes three destinations and dismisses on same-page edition changes"
  );

  leak = true;
  await page.goto(`${app.origin}/collector/${other}?edition=tcg`);
  await page
    .getByRole("alert")
    .filter({ hasText: /ownership or pagination/ })
    .waitFor();
  assert.equal(await packsVisible().count(), 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  checks.push("another wallet’s cards are rejected before rendering");
  console.log(
    JSON.stringify(
      { checks, externalRequestsBlocked: external.length, errors },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify({
      url: page.url(),
      checks,
      recentRequests: requests.slice(-12),
      body: (await page.locator("main").innerText()).slice(0, 2500)
    })
  );
  await page.screenshot({
    path: "/tmp/yunipals-collection-ui-failure.png",
    fullPage: true
  });
  throw error;
} finally {
  await browser.close();
}
