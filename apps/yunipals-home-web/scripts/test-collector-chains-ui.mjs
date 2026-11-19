import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    playwright: { type: "string", default: process.env.PLAYWRIGHT_MODULE },
    chromium: { type: "string", default: process.env.CHROMIUM_EXECUTABLE }
  }
});
const app = new URL(values.url);
assert.ok(
  app.protocol === "http:" && ["localhost", "127.0.0.1"].includes(app.hostname)
);
const { chromium } = await import(
  values.playwright ? pathToFileURL(values.playwright).href : "playwright-core"
);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const errors = [];
const requests = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  });
  page.setDefaultTimeout(30_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes("/__fixtures/")) requests.push(url);
  });
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === app.origin
      ? route.continue()
      : route.abort()
  );
  const profile = `${app.origin}/collector/0x000000000000000000000000000000000000000c`;
  const expectCards = (count = 24) =>
    page.waitForFunction(
      (count) => document.querySelectorAll("main article").length === count,
      count
    );
  const firstHref = () =>
    page.locator("main article a").first().getAttribute("href");
  const waitChain = (chain) =>
    page.waitForFunction(
      (chain) =>
        document
          .querySelector("main article a")
          ?.getAttribute("href")
          ?.includes(`/${chain}/`),
      chain
    );
  await page.goto(`${profile}?sort=rarity-capped-desc&edition=og`);
  await expectCards();
  console.log("Reported OG URL loads cards");
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), []);
  const first = await firstHref();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.waitForFunction((first) => {
    const href = document.querySelector("main article a")?.getAttribute("href");
    return href && href !== first;
  }, first);
  await expectCards();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.waitForFunction(
    (first) =>
      document.querySelector("main article a")?.getAttribute("href") === first,
    first
  );
  console.log("Pagination passed");
  await page.reload();
  await expectCards();
  const editions = page.getByRole("navigation", {
    name: "Yunipals collections",
    exact: true
  });
  await editions.getByRole("link", { name: "OG Base", exact: true }).click();
  await waitChain("base");
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), []);
  await editions.getByRole("link", { name: "OG", exact: true }).click();
  await page.waitForFunction(() => {
    const href = document.querySelector("main article a")?.getAttribute("href");
    return href && !href.includes("/base/");
  });
  await expectCards();
  console.log("Edition switching passed");
  // Invalid filters still report an error, and clearing them restores valid defaults.
  await page.goto(`${profile}?edition=og&chain=bad`);
  await page.getByText("Choose a supported chain.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expectCards();
  await page.evaluate(() => {
    const saved = "edition=og&chain=bnb&chain=solana&q=32";
    localStorage.setItem("yunipals.collector.filters.v2", saved);
    localStorage.setItem("yunipals.collector.filters.v2.og", saved);
  });
  await page.goto(profile);
  await expectCards(1);
  await waitChain("bnb");
  await page.reload();
  await expectCards(1);
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), ["bnb"]);
  const collectorRequests = requests.filter((url) =>
    /\/v2\/owners\/.*\/tokens$/.test(url.pathname)
  );
  assert.ok(collectorRequests.length > 0);
  for (const url of collectorRequests) {
    const chains = url.searchParams.getAll("chain");
    assert.ok(
      chains.length > 0 &&
        chains.every((chain) =>
          ["ethereum", "polygon", "bnb", "base"].includes(chain)
        )
    );
  }
  assert.ok(
    collectorRequests.some(
      (url) =>
        url.searchParams.getAll("chain").join(",") === "ethereum,polygon,bnb"
    )
  );
  assert.ok(
    collectorRequests.some(
      (url) => url.searchParams.getAll("chain").join(",") === "base"
    )
  );
  // Fixture mode enables Exomon: prove public browsing still requests Solana.
  await page.goto(`${app.origin}/?edition=og`);
  await page.locator("main article").first().waitFor();
  assert.ok(
    requests.some(
      (url) =>
        url.pathname.endsWith("/tokens") &&
        url.searchParams.get("chain") === "solana"
    )
  );
  assert.deepEqual(errors, []);
  console.log(
    "Collector chain regression passed: OG loading, pagination, reload, OG Base, clearing filters, saved preferences and public Solana browsing."
  );
} finally {
  await browser.close();
}
