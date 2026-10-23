import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5198" },
    playwright: {
      type: "string",
      default: "/tmp/yunipals-foundry/node_modules/playwright-core/index.mjs"
    },
    chromium: {
      type: "string",
      default: "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
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
const original = (wallet = owner) => ({
  chain: "base",
  chainId: 8453,
  contractAddress: originalContract,
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
const { chromium } = await import(pathToFileURL(values.playwright).href);
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
      chain.length && !chain.includes("base")
        ? []
        : url.searchParams.get("visibility") === "hidden"
          ? []
          : [original(wallet)];
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
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const packLinks = () =>
  page.locator(`main article a[href^="/monsters/${collection}/"]`);
const noSeparateGallery = async () => {
  assert.equal(
    await page
      .getByRole("heading", { name: "Booster Yunipals", exact: true })
      .count(),
    0
  );
  assert.equal(
    await page
      .getByText("This wallet has no revealed booster Yunipals yet.", {
        exact: true
      })
      .count(),
    0
  );
};
try {
  await page.goto(app.href);
  await page.locator(`main article a[href="/collection/base/1"]`).waitFor();
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .waitFor();
  await page
    .locator(`main article a[href="/monsters/${collection}/2"]`)
    .waitFor();
  await noSeparateGallery();
  assert.equal(
    await page.evaluate(
      ({ collection }) => {
        const a = document
          .querySelector('main article a[href="/collection/base/1"]')
          ?.closest("article")?.parentElement;
        const b = document
          .querySelector(`main article a[href="/monsters/${collection}/1"]`)
          ?.closest("article")?.parentElement;
        return a === b && a?.classList.contains("grid");
      },
      { collection }
    ),
    true
  );
  assert.ok(requests.some((p) => p.startsWith("/v1/boosters/monsters?")));
  assert.ok(!requests.some((p) => p.includes("/booster-monsters")));
  assert.equal(
    await page
      .locator(`article[data-collection-contract="${collection}"]`)
      .filter({ hasText: /\bRP\b|Buy|Arena/ })
      .count(),
    0
  );
  checks.push(
    "disconnected global collection combines all-owner pack cards and OG token1 in the same normal grid without identity collision, rank or trade controls"
  );
  await page
    .getByRole("button", { name: "Load more pack cards", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .waitFor();
  assert.equal(await packLinks().count(), 3);
  assert.equal(
    await page.locator(`main article a[href="/collection/base/1"]`).count(),
    1
  );
  checks.push(
    "independent bounded pack continuation adds cards once and preserves OG results"
  );
  await page.goto(`${app.origin}/?chain=base&t.Color=Green`);
  await page
    .getByRole("button", { name: "Load more pack cards", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .waitFor();
  assert.equal(await packLinks().count(), 1);
  await page.goto(`${app.origin}/?chain=base&t.Special=Yes`);
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .waitFor();
  assert.ok((await packLinks().count()) >= 2);
  await page.goto(`${app.origin}/?chain=ethereum`);
  await page
    .getByRole("heading", { name: "The original collection.", exact: true })
    .waitFor();
  assert.equal(await packLinks().count(), 0);
  checks.push(
    "shared color and chain filters apply while unrelated OG special/ranking filters do not silently hide pack cards"
  );
  await context.addInitScript(
    ({ owner }) => {
      const listeners = new Map();
      window.ethereum = {
        isMetaMask: true,
        isConnected: () => true,
        on(name, handler) {
          listeners.set(name, [...(listeners.get(name) ?? []), handler]);
        },
        removeListener() {},
        async request({ method }) {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [owner];
          if (method === "eth_chainId") return "0x2105";
          if (
            method === "wallet_requestPermissions" ||
            method === "wallet_getPermissions"
          )
            return [{ parentCapability: "eth_accounts" }];
          if (method === "wallet_getCapabilities") return {};
          throw new Error(
            "No chain calls are used by this collection fixture."
          );
        }
      };
    },
    { owner }
  );
  await page.goto(`${app.origin}/collector/${owner}`);
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .waitFor();
  assert.equal(
    await page
      .locator(`main article a[href="/monsters/${collection}/2"]`)
      .count(),
    0
  );
  await noSeparateGallery();
  await page
    .getByRole("button", { name: "Load more pack cards", exact: true })
    .click();
  await page
    .locator(`main article a[href="/monsters/${collection}/3"]`)
    .waitFor();
  assert.equal(await packLinks().count(), 2);
  checks.push(
    "collector uses only the resolved profile owner endpoint and follows that owner's cursor without exposing another owner's cards"
  );
  await page
    .getByRole("button", { name: "Hidden NFTs", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Hidden NFTs", exact: true }).click();
  await page
    .getByRole("heading", { name: "Hidden NFTs", exact: true })
    .waitFor();
  assert.equal(await packLinks().count(), 0);
  await page.getByRole("button", { name: "Visible NFTs", exact: true }).click();
  await page
    .locator(`main article a[href="/monsters/${collection}/1"]`)
    .waitFor();
  checks.push(
    "hidden-only profile view excludes public pack cards and restoring visible view returns them without a separate gallery"
  );
  leak = true;
  await page.goto(`${app.origin}/collector/${other}`);
  await page
    .getByRole("alert")
    .filter({ hasText: /ownership or pagination/ })
    .waitFor();
  assert.equal(await packLinks().count(), 0);
  assert.equal(
    await page.locator(`main article a[href="/collection/base/1"]`).count(),
    1
  );
  checks.push(
    "wrong-owner API response is refused while the owner's OG grid remains usable"
  );
  await noSeparateGallery();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  assert.deepEqual(errors, []);
  const report = {
    format: "yunipals-normal-collection-pack-grid-ui-v1",
    passed: true,
    checks,
    externalProviderCalls: 0,
    blockedUnrelatedRequests: external.length,
    runtimeErrors: errors,
    productionActions: 0
  };
  await writeFile(
    "/tmp/yunipals-collection-pack-grid-ui-20261023.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      alerts: await page.getByRole("alert").allTextContents(),
      text: (await page.locator("main").innerText()).slice(-3000),
      requests,
      errors
    })
  );
  throw error;
} finally {
  await browser.close();
}
