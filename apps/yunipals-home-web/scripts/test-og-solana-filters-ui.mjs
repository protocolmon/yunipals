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
assert.ok(["localhost", "127.0.0.1"].includes(app.hostname));
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
  const visit = async (query) => {
    await page.goto(`${app.origin}/?${query}`);
    await page.locator("article").first().waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: /^OG(?: Collection)?$/, exact: true })
        .getAttribute("aria-current"),
      "page"
    );
    assert.equal(
      await page.getByText("Browse Exomon on Solana", { exact: true }).count(),
      0
    );
  };
  const waitQuery = async (key, value) =>
    page.waitForFunction(
      ({ key, value }) =>
        new URLSearchParams(location.search).get(key) === value,
      { key, value }
    );
  const select = async (locator, option) => {
    await locator.click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await visit("edition=og");
  assert.ok(
    (await page.getByText("Price unavailable", { exact: true }).count()) > 0
  );
  assert.ok(
    requests.some(
      (url) =>
        url.pathname.endsWith("/tokens") &&
        url.searchParams.get("chain") === "solana"
    )
  );
  assert.ok(
    requests.some(
      (url) =>
        url.pathname.endsWith("/tokens") &&
        url.searchParams.getAll("chain").join(",") === "ethereum,polygon,bnb"
    )
  );
  await page.getByRole("button", { name: "Load more Yunipals" }).click();
  await page
    .locator('article a[href^="/collection/ethereum/"]')
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Solana", exact: true }).click();
  await waitQuery("chain", "solana");
  await page.getByRole("button", { name: "Ethereum", exact: true }).click();
  await page.waitForFunction(
    () =>
      new URLSearchParams(location.search).getAll("chain").join(",") ===
      "ethereum,solana"
  );

  // Cancel leaves both chains intact; applying a range requires explicit review.
  await page
    .getByRole("button", { name: "Choose sale and price filters" })
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "ethereum",
    "solana"
  ]);
  await page
    .getByRole("button", { name: "Choose sale and price filters" })
    .click();
  let dialog = page.locator("dialog[open]");
  await dialog
    .getByRole("textbox", { name: "Minimum listing price" })
    .fill("0.1");
  await dialog
    .getByRole("button", { name: "Apply to supported chains" })
    .click();
  await waitQuery("priceMin", "0.1");
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "ethereum"
  ]);
  await page
    .getByRole("status")
    .filter({ hasText: "Solana excluded" })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Remove sale and price filters" })
    .click();
  await page.waitForFunction(
    () =>
      new URLSearchParams(location.search).getAll("chain").join(",") ===
      "ethereum,solana"
  );

  // All-chain sale filtering and manual overrides of the restore selection.
  await visit("edition=og");
  await page
    .getByRole("button", { name: "Choose sale and price filters" })
    .click();
  await page.getByRole("button", { name: "Apply to supported chains" }).click();
  await waitQuery("sale", "listed");
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "ethereum",
    "polygon",
    "bnb"
  ]);
  await page.getByRole("button", { name: "Ethereum", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove sale and price filters" })
    .click();
  await waitQuery("sale", null);
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "polygon",
    "bnb"
  ]);

  // Price sorting from All asks for one chain, without silently choosing it.
  await visit("edition=og");
  await select(
    page.getByRole("combobox", { name: "Sort collection" }),
    "Price: low to high"
  );
  dialog = page.locator("dialog[open]");
  await dialog
    .getByRole("button", { name: "Apply to supported chains" })
    .click();
  await dialog.getByRole("alert").waitFor();
  await select(
    dialog.getByRole("combobox", { name: "Chains to filter" }),
    "BNB Chain"
  );
  await dialog
    .getByRole("button", { name: "Apply to supported chains" })
    .click();
  await waitQuery("sort", "price-asc");
  assert.equal(new URL(page.url()).searchParams.get("currency"), "native");
  await page
    .getByRole("button", { name: "Remove sale and price filters" })
    .click();
  await waitQuery("chain", null);

  // Mobile: the scope review edits the drawer draft; cancellation changes no URL.
  await page.setViewportSize({ width: 390, height: 844 });
  await visit("edition=og&chain=solana");
  await page.getByRole("button", { name: /^Filters/ }).click();
  const drawer = page.getByRole("dialog", {
    name: "Filter collection",
    exact: true
  });
  await drawer
    .getByRole("button", { name: "Switch to supported chains" })
    .click();
  dialog = page.locator("dialog[open]");
  await page.keyboard.press("Escape");
  assert.equal(await drawer.isVisible(), true);
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "solana"
  ]);
  await drawer
    .getByRole("button", { name: "Switch to supported chains" })
    .click();
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Apply to supported chains" })
    .click();
  assert.deepEqual(new URL(page.url()).searchParams.getAll("chain"), [
    "solana"
  ]);
  await drawer
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await waitQuery("sale", "listed");
  await page
    .getByRole("button", { name: "Remove sale and price filters" })
    .click();
  await waitQuery("chain", "solana");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  assert.deepEqual(errors, []);
  assert.ok(
    requests.some(
      (url) =>
        url.pathname.endsWith("/v2/market/tokens") &&
        url.searchParams.get("priceMin") === "0.1"
    )
  );
  console.log(
    "OG Solana desktop/mobile filtering, explicit price scope, reload restoration and manual chain overrides passed."
  );
} finally {
  await browser.close();
}
