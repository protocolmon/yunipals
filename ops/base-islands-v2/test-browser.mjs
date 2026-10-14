import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseSelect } from "../../apps/yunipals-home-web/scripts/ui/select.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const base = process.env.ISLANDS_BROWSER_URL || "http://127.0.0.1:5186";
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
    : {}),
  headless: true,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
if (process.env.ISLANDS_BROWSER_COOKIE_JAR) {
  const jar = await readFile(process.env.ISLANDS_BROWSER_COOKIE_JAR, "utf8");
  const cookies = jar
    .split("\n")
    .filter(
      (line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_"))
    )
    .map((line) => {
      const [domain, , path, secure, expires, name, value] = line
        .replace(/^#HttpOnly_/, "")
        .split("\t");
      return {
        name,
        value,
        url: base,
        httpOnly: line.startsWith("#HttpOnly_"),
        secure: secure === "TRUE",
        sameSite: "Lax"
      };
    });
  await context.addCookies(cookies);
}
if (process.env.ISLANDS_BROWSER_API) {
  await context.route("**/yunipals-indexer/v2/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await fetch(
      process.env.ISLANDS_BROWSER_API +
        url.pathname.replace("/yunipals-indexer", "") +
        url.search
    );
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: await response.text()
    });
  });
}
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const cards = () => page.locator('a[aria-label^="View "]');
try {
  await page.goto(`${base}/?collection=islands`);
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible().catch(() => false)) await decline.click();
  await page.locator('a[href="/collection/base-islands-v2/1"]').waitFor();
  const first = await cards().count();
  assert(first > 0);
  const load = page.getByRole("button", { name: "Load more" });
  if (await load.count()) {
    await load.click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('a[aria-label^="View "]').length > n,
      first
    );
  }
  assert.equal(
    new Set(
      await cards().evaluateAll((items) =>
        items.map((x) => x.getAttribute("href"))
      )
    ).size,
    await cards().count()
  );
  await chooseSelect(
    page,
    page.getByRole("combobox", { name: "Island origin", exact: true }),
    "airdrop"
  );
  await page.waitForURL(/origin=airdrop/);
  await page.locator('a[href="/collection/base-islands-v2/1"]').waitFor();
  assert.equal(
    await page.locator('a[href^="/collection/ethereum-islands/"]').count(),
    0
  );
  await page.locator('a[href="/collection/base-islands-v2/1"]').click();
  await page.getByRole("link", { name: "View Ethereum original #1" }).waitFor();
  assert(
    (await page.locator("main").innerText()).includes("Airdropped · Base")
  );
  assert((await page.locator('a[href*="basescan.org"]').count()) > 0);
  await page.getByText("Revealed Base replacement", { exact: true }).waitFor();
  await page.locator('a[href*="basescan.org/token/0x1058"]').waitFor();
  await page
    .getByRole("region", { name: "Island traits", exact: true })
    .waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector('main img[loading="eager"]');
    return img?.complete && img.naturalWidth > 0;
  });
  await page
    .locator('main img[loading="eager"]')
    .evaluate((img) => img.decode());
  await page.screenshot({
    path: "/tmp/base-island-detail.png",
    fullPage: true
  });
  await page.getByRole("link", { name: "View Ethereum original #1" }).click();
  await page.getByRole("link", { name: "View Base airdrop #1" }).waitFor();
  assert(
    (await page.locator("main").innerText()).includes("Original · Ethereum")
  );
  await page.goto(`${base}/?collection=islands&tokenId=1`);
  await page.locator('a[href="/collection/base-islands-v2/1"]').waitFor();
  assert.equal(
    await page.locator('a[href="/collection/ethereum-islands/1"]').count(),
    1
  );
  assert.equal(await cards().count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('a[href="/collection/base-islands-v2/1"]')
    .scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const img = document.querySelector(
      'a[href="/collection/base-islands-v2/1"] img'
    );
    return img?.complete && img.naturalWidth > 0;
  });
  await page.screenshot({
    path: "/tmp/base-islands-v2-mobile.png",
    fullPage: true
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await page.goto(`${base}/collection/base-islands/1`);
  await page.waitForURL("**/collection/base-islands-v2/1");
  await page.getByText("Revealed Base replacement", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: base,
        pagination: true,
        origins: true,
        counterparts: true,
        sameIdDistinct: true,
        mobile: true,
        pageErrors: errors
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
