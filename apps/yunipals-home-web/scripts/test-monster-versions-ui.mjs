import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
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
assert(["127.0.0.1", "localhost"].includes(app.hostname));
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === app.origin
    ? route.continue()
    : route.abort()
);
const page = await context.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("monster-")) requests.push(r.url());
});
const cards = page.locator("main article");
const count = async (n) => {
  await page.waitForFunction(
    (n) => document.querySelectorAll("main article").length === n,
    n
  );
};
try {
  await page.goto(
    `${app.origin}/?edition=og&chain=ethereum&chain=base&view=grouped`
  );
  const browseOnly = page.getByRole("button", {
    name: "Browse only",
    exact: true
  });
  if (await browseOnly.isVisible()) await browseOnly.click();
  await page.getByText("18 groups · 24 NFTs.", { exact: false }).waitFor();
  await count(18);
  const controlId = await cards
    .filter({ has: page.getByRole("button", { name: /View 2 versions/ }) })
    .filter({ hasText: "Ethereum" })
    .first()
    .getByRole("button")
    .first()
    .getAttribute("aria-controls");
  const expand = page.locator(`[aria-controls="${controlId}"]`);
  const pair = cards.filter({ has: expand });
  await expand.focus();
  await page.keyboard.press("Enter");
  assert.equal(await expand.getAttribute("aria-expanded"), "true");
  await pair.getByText("Original", { exact: true }).waitFor();
  await pair.getByText("Base airdrop", { exact: true }).waitFor();
  assert.equal(await pair.getByRole("link", { name: /View #/ }).count(), 2);
  await page.getByRole("button", { name: "All NFTs", exact: true }).click();
  await count(24);
  await page.getByText("Base airdrop", { exact: true }).first().waitFor();
  assert(new URL(page.url()).searchParams.get("view") === "nfts");
  await page.goBack();
  await count(18);
  await page.goto(`${app.origin}/collection/base/1`);
  await page.getByRole("region", { name: "Monster versions" }).waitFor();
  await page
    .getByRole("link", { name: "View Ethereum original #1", exact: true })
    .waitFor();
  await page.goto(
    `${app.origin}/collector/0x0000000000000000000000000000000000000001?view=grouped`
  );
  await page.getByText("20 groups · 24 NFTs.", { exact: false }).waitFor();
  await page
    .getByText("Collector owns 2 matching versions", { exact: true })
    .first()
    .waitFor();
  const solanaMint = "1".repeat(31) + "2";
  const solanaOwner = "1".repeat(31) + "Z";
  await page.goto(
    `${app.origin}/?edition=og&chain=base&chain=polygon&chain=solana&view=grouped`
  );
  await page.getByText("57 groups · 60 NFTs.", { exact: false }).waitFor();
  const three = cards
    .filter({
      has: page.getByRole("button", { name: /(View|Hide) 3 versions/ })
    })
    .first();
  await three.getByRole("button").first().click();
  await three.getByText("Original", { exact: true }).waitFor();
  await three.getByText("Version", { exact: true }).waitFor();
  await three.getByText("Base airdrop", { exact: true }).waitFor();
  assert.equal(
    await three.locator(`a[href="/collection/solana/${solanaMint}"]`).count(),
    1
  );
  await three.locator(`a[href="/collection/solana/${solanaMint}"]`).click();
  const solanaVersions = page.getByRole("region", { name: "Monster versions" });
  await solanaVersions
    .getByRole("link", { name: "View Base airdrop #7", exact: true })
    .waitFor();
  await solanaVersions
    .getByRole("link", { name: "View Polygon version #7", exact: true })
    .waitFor();
  await solanaVersions
    .getByRole("link", { name: "View Base airdrop #7", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Monster versions" })
    .getByRole("link", { name: "View Solana original", exact: true })
    .waitFor();
  await page.goto(`${app.origin}/collector/solana/${solanaOwner}?view=grouped`);
  await page.getByText("18 groups · 18 NFTs.", { exact: false }).waitFor();
  await page
    .getByText("Collector owns 1 matching version", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByText("Collector owns 2 matching versions", { exact: true })
      .count(),
    0
  );
  await page.goto(`${app.origin}/?edition=og&view=grouped`);
  await page.getByText(/groups · .* NFTs/).waitFor();
  await count(24);
  const next = page.getByRole("button", { name: "Next", exact: true });
  assert.equal(await next.isEnabled(), true);
  await next.click();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await count(24);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.goto(
    `${app.origin}/?edition=og&view=grouped&chain=base&sale=listed`
  );
  await page
    .getByText("Sale and price filters show individual NFTs.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Grouped monsters", exact: true })
      .isDisabled(),
    true
  );
  assert.equal(new URL(page.url()).searchParams.get("view"), "nfts");
  await page.route("**/v1/monster-version-capabilities", (route) =>
    route.fulfill({
      json: {
        version: 1,
        enabled: true,
        groupingEnabled: false,
        revision: "a".repeat(64)
      }
    })
  );
  await page.goto(
    `${app.origin}/?edition=og&chain=ethereum&chain=base&view=grouped`
  );
  await count(24);
  await page.getByText("Base airdrop", { exact: true }).first().waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Grouped monsters", exact: true })
      .count(),
    0
  );
  await page.unroute("**/v1/monster-version-capabilities");
  await page.route("**/v1/monster-version-capabilities", (route) =>
    route.fulfill({
      json: {
        version: 1,
        enabled: false,
        groupingEnabled: false,
        revision: null
      }
    })
  );
  await page.goto(
    `${app.origin}/?edition=og&chain=ethereum&chain=base&view=grouped`
  );
  await count(24);
  assert.equal(
    await page.getByText("Base airdrop", { exact: true }).count(),
    0
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "group counts",
        "keyboard expansion",
        "labels",
        "view history",
        "detail links",
        "collector ownership",
        "three-version Solana lineage",
        "Solana and Base detail links",
        "Solana collector counts",
        "mixed Exomon pagination",
        "mobile layout",
        "sale filters",
        "independent grouping rollback",
        "disabled mapping"
      ],
      versionRequests: requests.length
    })
  );
} catch (error) {
  console.log(
    JSON.stringify({
      errors,
      text: (await page.locator("body").innerText()).slice(0, 3000)
    })
  );
  await page.screenshot({ path: "/tmp/yunipals-versions-error.png" });
  throw error;
} finally {
  await browser.close();
}
