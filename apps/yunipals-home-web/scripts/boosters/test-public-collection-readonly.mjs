// Public acceptance: real HTML/assets/OG reads and wallet connection, no signing.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://app.yunipals.com" },
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
assert.equal(new URL(values.url).origin, "https://app.yunipals.com");
const release = JSON.parse(
  await readFile(
    "/tmp/yunipals-collection-booster-live-20261022-v3/RELEASE-MANIFEST.json"
  )
);
const builtIndex = await readFile(
  "/tmp/yunipals-collection-booster-live-20261022-v3/index.html",
  "utf8"
);
const script = builtIndex.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
const owner = "0xB3883Cd96d72B08b8226452305A28D65974a3727";
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 }
});
await context.addInitScript(
  ({ owner }) => {
    let connected =
      sessionStorage.getItem("public-test-wallet-connected") === "true";
    const listeners = new Map();
    window.__readOnlyWalletCalls = JSON.parse(
      sessionStorage.getItem("public-test-wallet-methods") ?? "[]"
    );
    window.ethereum = {
      isMetaMask: true,
      isConnected: () => true,
      on: (name, handler) =>
        listeners.set(name, [...(listeners.get(name) ?? []), handler]),
      removeListener: (name, handler) =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((x) => x !== handler)
        ),
      request: async ({ method, params }) => {
        window.__readOnlyWalletCalls.push(method);
        sessionStorage.setItem(
          "public-test-wallet-methods",
          JSON.stringify(window.__readOnlyWalletCalls)
        );
        if (method === "eth_accounts") return connected ? [owner] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          sessionStorage.setItem("public-test-wallet-connected", "true");
          for (const listener of listeners.get("accountsChanged") ?? [])
            listener([owner]);
          return [owner];
        }
        if (method === "eth_chainId") return "0x2105";
        if (method === "net_version") return "8453";
        if (
          ["wallet_requestPermissions", "wallet_getPermissions"].includes(
            method
          )
        )
          return [{ parentCapability: "eth_accounts" }];
        if (method === "wallet_getCapabilities") return {};
        const reads = [
          "eth_getBalance",
          "eth_getTransactionCount",
          "eth_getCode",
          "eth_call",
          "eth_blockNumber",
          "eth_getBlockByNumber",
          "eth_gasPrice",
          "eth_maxPriorityFeePerGas",
          "eth_getTransactionReceipt"
        ];
        if (!reads.includes(method))
          throw new Error("Read-only test wallet rejects " + method);
        const result = await (
          await fetch("https://mainnet.base.org", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params: params ?? []
            })
          })
        ).json();
        if (result.error) throw new Error(result.error.message);
        return result.result;
      }
    };
  },
  { owner }
);
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [],
  badAssets = [],
  failedRequests = [],
  api = [],
  documents = [],
  pending = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) =>
  failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText
  })
);
page.on("response", (response) => {
  const resource = response.request().resourceType();
  if (
    ["image", "font", "stylesheet", "script"].includes(resource) &&
    response.status() >= 400
  )
    badAssets.push({ url: response.url(), status: response.status() });
  if (resource === "document") {
    const h = response.headers();
    documents.push({
      url: response.url(),
      status: response.status(),
      cacheControl: h["cache-control"],
      cfCacheStatus: h["cf-cache-status"],
      age: h.age,
      location: h.location,
      server: h.server
    });
  }
  if (response.url().startsWith(release.apiOrigin + "/v"))
    pending.push(
      (async () => {
        let body;
        try {
          body = await response.json();
        } catch {
          /* Report status without exporting response bodies. */
        }
        api.push({
          path: response.url().slice(release.apiOrigin.length),
          status: response.status(),
          items: body?.items?.length,
          total: body?.total,
          error: body?.error
        });
      })()
    );
});
const report = {
  scope:
    "Public restored collection, real API/images, desktop/mobile, read-only wallet connection",
  releaseManifestSha256:
    "09661871dfaa6c9d0663ac7426b4499320e19a0ec6ffacbe91d2e7d89581f027",
  checks: []
};
try {
  const response = await page.goto(
    values.url + "/collection?v=public-collection-" + Date.now(),
    { waitUntil: "domcontentloaded" }
  );
  assert.equal(response.status(), 200);
  assert(
    (await response.text()).includes(script),
    "real public HTML must reference the reviewed v3 script"
  );
  await page
    .getByRole("heading", { name: "All active Yunipals", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Yunipal booster packs", exact: true })
    .waitFor();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  const firstCard = page
    .locator("#collection article a[aria-label^='View ']")
    .first();
  await firstCard.waitFor();
  await firstCard.scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#collection article img")].some(
      (img) => img.complete && img.naturalWidth > 0
    )
  );
  const tokenCards = await page.locator("#collection article").count();
  const loadedArt = await page
    .locator("#collection article img")
    .evaluateAll(
      (images) =>
        images.filter((img) => img.complete && img.naturalWidth > 0).length
    );
  assert(tokenCards > 0 && loadedArt > 0);
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(
      () =>
        document.fonts.check('16px "Inter"') &&
        document.fonts.check('16px "Archivo Black"')
    )
  );
  assert(
    await page
      .locator("img[src='/images/yunipals-logo.webp']")
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0)
  );
  report.checks.push({
    desktop: "real OG cards and images rendered from retained public API",
    tokenCards,
    loadedArt
  });
  await page.screenshot({
    path: "/tmp/yunipals-public-collection-desktop.png",
    fullPage: false
  });
  await page.locator("#booster-packs").scrollIntoViewIfNeeded();
  await page
    .getByText("The booster index is catching up. Please try again shortly.", {
      exact: false
    })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Open pack", exact: true }).count(),
    0
  );
  report.checks.push(
    "booster catching-up state is local and honest; no pack purchase is offered"
  );
  await page.screenshot({
    path: "/tmp/yunipals-public-collection-catching-up.png",
    fullPage: false
  });
  const boosterPage = await page.goto(
    values.url + "/boosters?v=public-packs-" + Date.now()
  );
  assert.equal(boosterPage.status(), 200);
  assert.equal(
    new URL(page.url()).pathname,
    "/boosters",
    "the asset directory must not redirect the SPA route"
  );
  await page
    .getByRole("heading", { name: "Yunipal booster packs", exact: true })
    .waitFor();
  await page
    .getByText("The booster index is catching up. Please try again shortly.", {
      exact: false
    })
    .first()
    .waitFor();
  report.checks.push(
    "public /boosters is an HTTP200 SPA route, with no asset-directory redirect/403"
  );
  const ownerTokens = page.waitForResponse((entry) =>
    entry
      .url()
      .toLowerCase()
      .includes("/v2/owners/" + owner.toLowerCase() + "/tokens?")
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: /MetaMask|Browser Wallet|Injected/i })
    .first()
    .click();
  await page.waitForURL(
    /\/collector\/0xb3883cd96d72b08b8226452305a28d65974a3727/i
  );
  await page.getByRole("button", { name: /View my collection for/i }).waitFor();
  const ownerResponse = await ownerTokens;
  assert.equal(ownerResponse.status(), 200);
  report.checks.push({
    wallet: "read-only connection reaches the approved owner's collector page",
    actualOwnerTokensStatus: ownerResponse.status(),
    actualOwnerTokensPath: new URL(ownerResponse.url()).pathname
  });
  const trailing = await page.goto(
    values.url + "/boosters/?v=public-packs-trailing-" + Date.now()
  );
  assert.equal(trailing.status(), 200);
  await page
    .getByRole("heading", { name: "Yunipal booster packs", exact: true })
    .waitFor();
  report.checks.push(
    "public /boosters/ also renders the SPA instead of a directory403"
  );
  const setup = await page.goto(
    values.url + "/boosters/setup?v=owner-readonly-" + Date.now()
  );
  assert.equal(setup.status(), 200);
  await page
    .getByRole("heading", { name: "One-pack mainnet test", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review configuration", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Configure the capped test pack",
      exact: true
    })
    .waitFor();
  assert(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm in wallet", exact: true })
      .isEnabled()
  );
  await page.screenshot({
    path: "/tmp/yunipals-public-owner-setup-readonly.png",
    fullPage: false
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  report.checks.push(
    "public owner setup verifies the exact frozen bundle/art/role and prepares its actual Base fee review; confirmation was not clicked"
  );
  await page.goto(values.url + "/?v=mobile-collection-" + Date.now());
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("heading", { name: "All active Yunipals", exact: true })
    .waitFor();
  await page.locator("#collection article").first().waitFor();
  await page.locator("#collection article").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const visible = [
      ...document.querySelectorAll("#collection article img")
    ].filter((img) => {
      const rectangle = img.getBoundingClientRect();
      return rectangle.bottom > 0 && rectangle.top < innerHeight;
    });
    return (
      visible.length > 0 &&
      visible.every((img) => img.complete && img.naturalWidth > 0)
    );
  });
  await page.locator("#collection article img").evaluateAll(async (images) => {
    await Promise.all(
      images
        .filter((img) => img.complete)
        .map((img) => img.decode().catch(() => {}))
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  });
  const mobileSize = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth
  }));
  assert(
    mobileSize.document <= mobileSize.viewport + 1,
    "mobile collection must not overflow horizontally"
  );
  await page.screenshot({
    path: "/tmp/yunipals-public-collection-mobile.png",
    fullPage: false
  });
  report.checks.push({
    mobile: "real OG collection cards fit the 390px viewport",
    ...mobileSize
  });
  assert.equal(
    await page.getByRole("link", { name: "Race lab", exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  const walletMethods = await page.evaluate(() => window.__readOnlyWalletCalls);
  assert(!walletMethods.some((method) => /send|sign/i.test(method)));
  await Promise.allSettled(pending);
  assert.deepEqual(errors, []);
  assert.deepEqual(badAssets, []);
  assert(
    api.some(
      (entry) =>
        entry.path.startsWith("/v1/tokens") &&
        entry.status === 200 &&
        entry.items > 0
    )
  );
  Object.assign(report, {
    status: "PASSED",
    documents,
    api,
    errors,
    badAssets,
    failedRequests,
    walletMethods,
    mainnetBroadcasts: 0
  });
  await writeFile(
    "/tmp/yunipals-public-collection-acceptance.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: "/tmp/yunipals-public-collection-failed.png",
    fullPage: false
  });
  await Promise.allSettled(pending);
  Object.assign(report, {
    status: "FAILED",
    error: String(error),
    currentUrl: page.url(),
    documents,
    api,
    errors,
    badAssets,
    failedRequests
  });
  await writeFile(
    "/tmp/yunipals-public-collection-acceptance.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.error(
    JSON.stringify(
      { ...report, text: await page.locator("body").innerText() },
      null,
      2
    )
  );
  throw error;
} finally {
  await browser.close();
}
