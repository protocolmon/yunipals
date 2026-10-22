import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5185" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-islands-ui.json" },
    screenshots: { type: "string", default: "/tmp/yunipals-islands" }
  }
});
if (!values.playwright)
  throw new Error("Pass --playwright with a local Playwright module path.");
const app = new URL(values.url);
if (
  !["http:", "https:"].includes(app.protocol) ||
  app.username ||
  app.password
) {
  throw new Error("Use an HTTP website URL without credentials.");
}
const api =
  "https://api.yunipals.com/yunipals-indexer/v2/collections/ethereum-islands";
const apiJson = async (path) => {
  const response = await fetch(`${api}${path}`);
  assert.equal(response.status, 200);
  return response.json();
};
const [stats, island] = await Promise.all([
  apiJson("/stats"),
  apiJson("/tokens/1")
]);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
const apiErrors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.url().startsWith(api) && response.status() >= 500)
    apiErrors.push([response.status(), response.url()]);
});
const report = {
  url: app.origin,
  tests: [],
  errors,
  apiErrors,
  stats,
  passed: false
};
const cards = page.locator("main article");
const expectCards = (count) =>
  page.waitForFunction(
    (count) => document.querySelectorAll("main article").length === count,
    count
  );
const hrefs = () =>
  cards
    .locator("a")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
const expectedFirst = (tokenId) =>
  page.waitForFunction(
    (tokenId) =>
      document.querySelector("main article a")?.getAttribute("href") ===
      `/collection/ethereum-islands/${tokenId}`,
    tokenId
  );
const collections = page.getByRole("navigation", {
  name: "Collections",
  exact: true
});
try {
  await page.goto(app.origin);
  await collections.getByRole("link", { name: "Islands", exact: true }).click();
  await expectCards(24);
  await expectedFirst("1");
  assert.equal(await page.title(), "Yunipals Islands — Explore the Collection");
  assert.equal(
    await collections
      .getByRole("link", { name: "Islands", exact: true })
      .getAttribute("aria-current"),
    "page"
  );
  for (const [label, count] of [
    ["Islands", stats.activeSupply],
    ["Collectors", stats.holders],
    ["Genesis", stats.genesis],
    ["Personal", stats.personal]
  ]) {
    assert.equal(
      await page
        .locator("main dl div")
        .filter({
          has: page.locator("dt", { hasText: new RegExp(`^${label}$`) })
        })
        .locator("dd")
        .innerText(),
      String(count)
    );
  }
  report.tests.push(
    "collection tab, live supply/holder/edition counts, 24 island cards"
  );
  const first = await hrefs();
  await page
    .getByRole("button", { name: "Load more islands", exact: true })
    .click();
  await expectCards(48);
  assert.equal(new Set(await hrefs()).size, 48);
  assert.deepEqual((await hrefs()).slice(0, 24), first);
  report.tests.push("cursor pagination appends distinct islands");

  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await page.waitForURL(/edition=Personal/);
  await expectedFirst("1001");
  assert.ok(
    (await hrefs()).every((href) => BigInt(href.split("/").at(-1)) > 1000n)
  );
  await page
    .getByRole("combobox", { name: "Sort by" })
    .selectOption("token-id-desc");
  const descending = await apiJson(
    "/tokens?edition=Personal&sort=token-id-desc&limit=1"
  );
  await expectedFirst(descending.items[0].tokenId);
  await page.getByRole("button", { name: "Genesis", exact: true }).click();
  const genesis = await apiJson(
    "/tokens?edition=Genesis&sort=token-id-desc&limit=1"
  );
  await expectedFirst(genesis.items[0].tokenId);
  assert.ok(
    (await hrefs()).every((href) => BigInt(href.split("/").at(-1)) <= 1000n)
  );
  await page.goBack();
  await expectedFirst(descending.items[0].tokenId);
  assert.equal(
    await page
      .getByRole("button", { name: "Personal", exact: true })
      .getAttribute("aria-pressed"),
    "true"
  );
  report.tests.push(
    "Genesis/Personal filtering, numeric sort, browser back restores filters"
  );

  await page
    .getByRole("textbox", { name: "Island token ID or wallet address" })
    .fill("#0001");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForURL(/\/collection\/ethereum-islands\/1$/);
  await page
    .getByRole("heading", { name: island.token.metadata.name, exact: true })
    .waitFor();
  await page.locator("main ol li").first().waitFor();
  const opensea = page.getByRole("link", {
    name: "View on OpenSea",
    exact: true
  });
  assert.equal(
    await opensea.getAttribute("href"),
    `https://opensea.io/assets/ethereum/${island.token.contractAddress}/1`
  );
  const artwork = page.locator("main img").first();
  await artwork.waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector("main img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.screenshot({
    path: `${values.screenshots}-detail.png`,
    fullPage: true
  });
  report.tests.push(
    "exact ID lookup, artwork, ownership, transfer history, correct OpenSea contract"
  );

  const owner = island.token.owner;
  await page
    .locator(`main a[href="/?collection=islands&owner=${owner}"]`)
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Wallet islands", exact: true })
    .waitFor();
  const holdings = await apiJson(`/tokens?owner=${owner}&limit=24`);
  await expectedFirst(holdings.items[0].tokenId);
  assert.deepEqual(
    await hrefs(),
    holdings.items.map(
      (token) => `/collection/ethereum-islands/${token.tokenId}`
    )
  );
  report.tests.push("owner link browses the wallet's current island holdings");
  const input = page.getByRole("textbox", {
    name: "Island token ID or wallet address"
  });
  await input.fill("0x93f5b650d6e7061d802ff80fcae04a8e0b9db113");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByText("No islands found", { exact: true }).waitFor();
  await input.fill("0x0000000000000000000000000000000000000000");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  assert.match(
    await page.getByRole("alert").innerText(),
    /token ID or an Ethereum wallet/
  );
  await input.fill("invalid wallet");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  assert.match(
    await page.getByRole("alert").innerText(),
    /token ID or an Ethereum wallet/
  );
  report.tests.push("empty wallet state and invalid lookup validation");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.origin}/?collection=islands&edition=Personal`);
  await expectedFirst("1001");
  await page.getByRole("button", { name: "Genesis", exact: true }).click();
  await expectedFirst("1");
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth
    ),
    true
  );
  await page.screenshot({
    path: `${values.screenshots}-mobile.png`,
    fullPage: true
  });
  report.tests.push(
    "mobile grid and edition controls have no horizontal overflow"
  );
  await collections
    .getByRole("link", { name: "Yunipals", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("main article a")
      ?.getAttribute("href")
      ?.match(/^\/collection\/(ethereum|base|polygon|bnb)\//)
  );
  assert.ok(
    (await hrefs()).every((href) =>
      /^\/collection\/(ethereum|base|polygon|bnb)\//.test(href)
    )
  );
  report.tests.push(
    "existing Yunipals collection still loads after switching tabs"
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(apiErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  await page.screenshot({
    path: `${values.screenshots}-failure.png`,
    fullPage: true
  });
  throw error;
} finally {
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
