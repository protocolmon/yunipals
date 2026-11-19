import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5194" },
    playwright: { type: "string", default: process.env.PLAYWRIGHT_MODULE },
    chromium: { type: "string", default: process.env.CHROMIUM_EXECUTABLE }
  }
});
const { chromium } = await import(
  values.playwright ? pathToFileURL(values.playwright).href : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(values.url).origin
      ? route.continue()
      : route.abort()
  );
  await page.goto(values.url, { waitUntil: "networkidle" });
  await page.waitForSelector("#root main");
  const image = () =>
    page.locator('meta[property="og:image"]').getAttribute("content");
  const first = await image();
  assert.match(first, /collection\.[a-f0-9]+\.png/);
  async function navigate(path) {
    await page.evaluate((path) => {
      history.pushState({}, "", path);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  }
  await navigate("/?edition=tcg");
  await page.waitForFunction(() =>
    document
      .querySelector('meta[property="og:image"]')
      .content.includes("/tcg.")
  );
  assert.notEqual(await image(), first);
  await navigate("/boosters");
  await page.waitForFunction(() =>
    document
      .querySelector('meta[property="og:image"]')
      .content.includes("/boosters.")
  );
  await navigate("/proposals/pack-opening");
  await page.waitForFunction(() => document.title.includes("new way to open"));
  assert.match(await image(), /proposal-pack-opening/);
  await navigate("/terms");
  await page.waitForFunction(() =>
    document
      .querySelector('meta[property="og:image"]')
      .content.includes("/utility.")
  );
  assert.equal(await page.locator('meta[property="og:image"]').count(), 1);
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    values.url + "/terms"
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate("/?edition=airdrop");
  await page.waitForFunction(() =>
    document
      .querySelector('meta[property="og:image"]')
      .content.includes("/airdrop.")
  );
  const response = await page.request.get(values.url + "/?edition=tcg");
  assert.match(
    await response.text(),
    /property="og:image" content="[^\"]*\/tcg\./
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS initial HTML, edition changes, page navigation, proposal cards, mobile and metadata uniqueness"
  );
} finally {
  await browser.close();
}
