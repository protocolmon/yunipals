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
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.url().includes("/__fixtures/")) requests.push(new URL(r.url()));
});
const cards = page.locator("main article");
const count = (n) =>
  page.waitForFunction(
    (n) => document.querySelectorAll("main article").length === n,
    n
  );
try {
  await page.goto(app.origin);
  const browse = page.getByRole("button", { name: "Browse only", exact: true });
  if (await browse.isVisible()) await browse.click();
  await page
    .getByRole("button", { name: "Remove Base exclusion", exact: true })
    .waitFor();
  await count(24);
  await page.getByText("72 OG Yunipals", { exact: false }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("excludeChain"), "base");
  assert.equal(
    await page
      .getByRole("button", { name: "Grouped monsters", exact: true })
      .count(),
    0
  );
  for (const request of requests.filter((u) =>
    /\/v1\/(tokens|traits)$/.test(u.pathname)
  )) {
    assert(!request.searchParams.getAll("chain").includes("base"));
    assert(request.searchParams.has("chain"));
  }
  assert(
    !requests.some((u) => u.pathname.includes("monster-version")),
    "collection must not fetch relationship data"
  );
  await page
    .getByRole("button", { name: "Remove Base exclusion", exact: true })
    .click();
  await count(24);
  assert(!new URL(page.url()).searchParams.has("excludeChain"));
  await page.reload();
  assert(!new URL(page.url()).searchParams.has("excludeChain"));
  await page.goto(app.origin);
  await count(24);
  assert(
    !new URL(page.url()).searchParams.has("excludeChain"),
    "saved All choice survives a bare visit"
  );
  await page.getByRole("button", { name: "Base", exact: true }).click();
  await count(12);
  assert.equal(new URL(page.url()).searchParams.get("chain"), "base");
  await page.getByRole("button", { name: "Exclude Base", exact: true }).click();
  await page
    .getByText("No Yunipals match this combination.", { exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Remove Base exclusion", exact: true })
    .click();
  await count(12);
  await page
    .getByRole("button", { name: "Exclude Solana", exact: true })
    .click();
  await count(12);
  assert.equal(new URL(page.url()).searchParams.get("excludeChain"), "solana");
  await page.goto(`${app.origin}/?edition=og&chain=base&excludeChain=base`);
  await page
    .getByText("No Yunipals match this combination.", { exact: false })
    .waitFor();
  assert.equal(await cards.count(), 0);
  await page.goto(`${app.origin}/?edition=tcg`);
  assert(!new URL(page.url()).searchParams.has("excludeChain"));
  await page.goto(`${app.origin}/collection/base/1`);
  await page
    .getByRole("region", { name: "Original NFT" })
    .getByRole("link", { name: "View Ethereum original #1", exact: true })
    .click();
  assert.equal(new URL(page.url()).pathname, "/collection/ethereum/1");
  await page.goto(`${app.origin}/collection/base/7`);
  await page
    .getByRole("region", { name: "Original NFT" })
    .getByRole("link", { name: "View Solana original", exact: true })
    .click();
  assert.equal(
    new URL(page.url()).pathname,
    `/collection/solana/${"1".repeat(31)}2`
  );
  await page.goto(
    `${app.origin}/collector/0x0000000000000000000000000000000000000001`
  );
  await count(24);
  assert.equal(
    await page
      .getByRole("button", { name: "Grouped monsters", exact: true })
      .count(),
    0
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.origin}/?excludeChain=base&excludeChain=polygon`);
  await count(24);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page
    .getByRole("button", { name: "Remove Base exclusion", exact: true })
    .click();
  assert.deepEqual(new URL(page.url()).searchParams.getAll("excludeChain"), [
    "polygon"
  ]);
  assert(!requests.some((u) => u.pathname.endsWith("/monster-groups")));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "default Not Base",
        "server chain selection",
        "saved All choice",
        "explicit Base view",
        "multiple exclusions",
        "empty selection",
        "TCG unchanged",
        "Ethereum original link",
        "Solana original link",
        "ordinary collector",
        "mobile exclusions",
        "no grouped reads"
      ]
    })
  );
} catch (error) {
  console.log((await page.locator("body").innerText()).slice(0, 3500));
  await page.screenshot({ path: "/tmp/yunipals-simple-versions-error.png" });
  throw error;
} finally {
  await browser.close();
}
