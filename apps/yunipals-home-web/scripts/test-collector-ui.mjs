import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-collector-ui.json" }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
)
  throw new Error("Use a local fixture server.");
if (!values.playwright)
  throw new Error("Pass --playwright with a local Playwright module path.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();
const errors = [];
const serverErrors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 500 && new URL(response.url()).origin === app.origin)
    serverErrors.push([response.status(), response.url()]);
});
page.on("request", (request) => {
  if (request.url().includes("/v2/owners/")) requests.push(request.url());
});
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === app.origin
    ? route.continue()
    : route.abort()
);
const route = `${app.origin}/collector/0x000000000000000000000000000000000000000c`;
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
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { tests: [], errors, requests: 0 };
try {
  await page.goto(route);
  await page.getByRole("button", { name: "Browse only", exact: true }).click();
  await expectCards(24);
  await page.getByText("Rank #1", { exact: true }).first().waitFor();
  const initial = await hrefs();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction(
    (initial) =>
      document.querySelector("main article a")?.getAttribute("href") !==
      initial,
    initial[0]
  );
  await expectCards(24);
  const next = await hrefs();
  assert.equal(new Set([...initial, ...next]).size, 48);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.waitForFunction(
    (initial) =>
      document.querySelector("main article a")?.getAttribute("href") ===
      initial,
    initial[0]
  );
  assert.deepEqual(await hrefs(), initial);
  report.tests.push("24-card forward/backward pagination");

  await page
    .getByRole("combobox", { name: "Sort collection" })
    .selectOption("rarity-capped-asc");
  await page.waitForURL(/sort=rarity-capped-asc/);
  await page.waitForFunction(
    (initial) =>
      document.querySelector("main article a")?.getAttribute("href") !==
      initial,
    initial[0]
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Previous", exact: true })
      .isDisabled(),
    true
  );
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Filter collection" });
  await dialog.getByRole("checkbox", { name: "Water", exact: true }).check();
  await dialog.getByRole("tab", { name: "Color", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Blue", exact: true }).check();
  await dialog.getByRole("checkbox", { name: /BNB/ }).check();
  await dialog.getByRole("textbox", { name: "Minimum RP" }).fill("110.00");
  await dialog.getByRole("textbox", { name: "Maximum RP" }).fill("130");
  const beforeApply = requests.length;
  await dialog.getByRole("button", { name: "Apply filters" }).click();
  await expectCards(3);
  assert.equal(requests.length - beforeApply, 1);
  assert.ok((await hrefs()).every((href) => href.includes("/bnb/")));
  assert.match(page.url(), /rarityMin=110/);
  assert.match(page.url(), /rarityMax=130/);
  report.tests.push(
    "one request for combined rarity/type/color/chain filters, sort resets pagination"
  );

  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expectCards(24);
  const beforeSearch = requests.length;
  await page
    .getByRole("searchbox", { name: "Search your collection" })
    .pressSequentially("32", { delay: 60 });
  await expectCards(4);
  assert.equal(requests.length - beforeSearch, 1);
  assert.ok((await hrefs()).every((href) => href.endsWith("/32")));
  await page.getByRole("searchbox").fill("no such creature");
  await page.getByText("No matches", { exact: true }).waitFor();
  await page.goBack();
  await expectCards(4);
  assert.equal(await page.getByRole("searchbox").inputValue(), "32");
  report.tests.push("debounced exact ID search, empty state, browser history");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expectCards(24);
  const filterButton = page.getByRole("button", {
    name: "Filters",
    exact: true
  });
  await filterButton.click();
  await dialog.waitFor();
  const typeTab = dialog.getByRole("tab", { name: "Type", exact: true });
  const colorTab = dialog.getByRole("tab", { name: "Color", exact: true });
  await typeTab.click();
  const traitPanel = dialog.getByRole("tabpanel");
  await traitPanel.evaluate((element) => {
    element.scrollTop = 120;
  });
  await typeTab.press("ArrowRight");
  assert.equal(await colorTab.getAttribute("aria-selected"), "true");
  await colorTab.press("ArrowLeft");
  assert.equal(await typeTab.getAttribute("aria-selected"), "true");
  assert.equal(await traitPanel.evaluate((element) => element.scrollTop), 120);
  const scrollLayout = await dialog.evaluate((element) => ({
    dialogOverflow: getComputedStyle(element).overflowY,
    scrollRegions: [...element.querySelectorAll("*")].filter(
      (child) => getComputedStyle(child).overflowY === "auto"
    ).length
  }));
  assert.deepEqual(scrollLayout, {
    dialogOverflow: "hidden",
    scrollRegions: 1
  });
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), false);
  assert.equal(
    await filterButton.evaluate((button) => document.activeElement === button),
    true
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await page.screenshot({
    path: "/tmp/yunipals-collector-mobile.png",
    fullPage: true
  });
  report.tests.push(
    "single-scroll mobile filter tabs, independent position, keyboard navigation, Escape and focus restoration"
  );

  // A canceled slower request must not replace the subsequently selected view.
  await context.route("**/v2/owners/**/tokens?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "water")
      await pause(800);
    await route.continue().catch(() => {});
  });
  await page.getByRole("searchbox").fill("water");
  await page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("q") === "water"
  );
  await page.getByRole("searchbox").fill("32");
  await expectCards(4);
  await pause(900);
  assert.ok((await hrefs()).every((href) => href.endsWith("/32")));
  report.tests.push(
    "superseded slow responses cannot replace the current filters"
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    window.collectorLongTasks = [];
    window.collectorTaskObserver = new PerformanceObserver((list) =>
      window.collectorLongTasks.push(
        ...list.getEntries().map((entry) => entry.duration)
      )
    );
    window.collectorTaskObserver.observe({ type: "longtask", buffered: false });
  });
  await page.getByRole("searchbox").fill("sample fire 32");
  await page.waitForURL(/q=sample/);
  await expectCards(4);
  await pause(500);
  const longTasks = await page.evaluate(() => {
    window.collectorTaskObserver.disconnect();
    return window.collectorLongTasks;
  });
  report.throttledGridLongTasksMs = longTasks;
  assert.ok(longTasks.length <= 1, `Repeated grid long tasks: ${longTasks}`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  report.tests.push("responsive search/grid under 4x CPU throttling");

  const idleRequests = requests.length;
  await pause(31_000);
  assert.equal(requests.length, idleRequests);
  report.tests.push("no 30-second collection polling");

  await page.goto(`${route}?sort=invalid`);
  await page
    .getByText("Choose a supported rarity sort.", { exact: true })
    .waitFor();
  assert.equal(await cards.count(), 0);
  report.tests.push("invalid URLs do not silently broaden results");

  // Old deployed APIs still browse holdings, but cannot pretend to apply filters.
  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  await oldContext.route("**/v1/collector-capabilities", (route) =>
    route.fulfill({ status: 404, json: {} })
  );
  await oldPage.goto(
    `${app.origin}/collector/0x0000000000000000000000000000000000000001`
  );
  await oldPage
    .getByRole("button", { name: "Browse only", exact: true })
    .click();
  await oldPage.waitForFunction(
    () => document.querySelectorAll("main article").length === 24
  );
  assert.equal(
    await oldPage
      .getByRole("searchbox", { name: "Search your collection" })
      .count(),
    0
  );
  await oldPage.goto(
    `${app.origin}/collector/0x0000000000000000000000000000000000000001?q=32`
  );
  await oldPage
    .getByText(/These collection filters are temporarily unavailable/)
    .waitFor();
  assert.equal(await oldPage.locator("main article").count(), 0);
  await oldContext.close();
  report.tests.push("backward-compatible capability gate");
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  report.requests = requests.length;
  await writeFile(values.output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
