// Canonical-site acceptance against deployed HTML, APIs, artwork and a read-only wallet.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://www.yunipals.com" },
    release: { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-canonical-www-acceptance.json"
    },
    "protected-vercel": { type: "boolean", default: false },
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
const origin = new URL(values.url).origin;
assert(
  origin === "https://www.yunipals.com" ||
    /^https:\/\/yunipals-[a-z0-9]+-devving\.vercel\.app$/.test(origin)
);
assert(values.release, "Pass the exact reviewed release directory");
const manifestBytes = await readFile(values.release + "/RELEASE-MANIFEST.json");
const release = JSON.parse(manifestBytes);
const builtIndex = await readFile(values.release + "/index.html", "utf8");
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
if (values["protected-vercel"]) {
  assert(origin.endsWith(".vercel.app"));
  // Reuse the already configured automation token, like `vercel curl` does.
  // No new token or access rule is created; never attach it to API/art origins.
  const { token } = JSON.parse(
    await readFile("/root/.local/share/com.vercel.cli/auth.json", "utf8")
  );
  const response = await fetch(
    "https://api.vercel.com/v9/projects/prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE?teamId=team_EHhGsy15b4Z8zOUwpm2usI5y",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(response.status, 200);
  const project = await response.json();
  assert.equal(project.id, "prj_j8Mg0nIBXeXVLylHgSu6OWxa6QgE");
  const bypass = Object.entries(project.protectionBypass ?? {}).find(
    ([, value]) => value.scope === "automation-bypass"
  )?.[0];
  assert(bypass, "Existing deployment automation access required");
  await context.route(origin + "/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-vercel-protection-bypass": bypass
      }
    })
  );
}
await context.addInitScript(
  ({ owner }) => {
    let connected =
      sessionStorage.getItem("public-test-wallet-connected") === "true";
    const listeners = new Map();
    window.__readOnlyWalletCalls = JSON.parse(
      sessionStorage.getItem("public-test-wallet-methods") ?? "[]"
    );
    window.ethereum = {
      isMetaMask: false,
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
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "83e960c2-e92a-4d4f-aeb2-d9480da5dbdb",
              name: "Read-only test wallet",
              icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
              rdns: "com.yunipals.readonly"
            },
            provider: window.ethereum
          }
        })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  },
  { owner }
);
const page = await context.newPage();
page.setDefaultTimeout(45000);
const errors = [],
  badAssets = [],
  api = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  if (
    ["image", "font", "stylesheet", "script"].includes(
      response.request().resourceType()
    ) &&
    response.status() >= 400
  )
    badAssets.push({ url: response.url(), status: response.status() });
  if (response.url().startsWith(release.apiOrigin + "/v"))
    api.push({
      path: new URL(response.url()).pathname,
      status: response.status()
    });
});
const report = {
  origin,
  observedAt: new Date().toISOString(),
  releaseManifestSha256: createHash("sha256")
    .update(manifestBytes)
    .digest("hex"),
  checks: []
};
try {
  const response = await page.goto(
    origin + "/?v=canonical-check-" + Date.now(),
    { waitUntil: "domcontentloaded" }
  );
  assert.equal(response.status(), 200);
  assert((await response.text()).includes(script));
  await page
    .getByRole("link", { name: "Open booster packs", exact: true })
    .waitFor();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  const order = await page.evaluate(() =>
    ["#top", "#booster-packs", "#collection"].map(
      (selector) => document.querySelector(selector).getBoundingClientRect().top
    )
  );
  assert(order[0] < order[1] && order[1] < order[2]);
  await page.getByRole("heading", { name: "Pack #2", exact: true }).waitFor();
  assert(await page.getByText("1 PROTO", { exact: false }).first().isVisible());
  await page.locator("#collection article").first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#collection article img")].some(
      (img) => img.complete && img.naturalWidth > 0
    )
  );
  report.checks.push(
    "Deployed homepage: hero, active public pack #2, and real OG collection/art in order"
  );
  await page
    .getByRole("link", { name: "Open booster packs", exact: true })
    .click();
  await page.waitForURL(origin + "/boosters");
  await page.getByRole("heading", { name: "Pack #2", exact: true }).waitFor();
  await page
    .locator("#booster-packs article")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  report.walletChoices = await page
    .getByRole("dialog")
    .getByRole("button")
    .allTextContents();
  await page
    .getByRole("button", { name: "Read-only test wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /View my collection for/i }).waitFor();
  await page.goto(origin + "/boosters");
  await page
    .locator("#booster-packs article")
    .filter({
      has: page.getByRole("heading", { name: "Pack #2", exact: true })
    })
    .getByRole("button", { name: "Open pack", exact: true })
    .waitFor();
  report.checks.push(
    "Same-app /boosters loads public pack #2; real wallet connection succeeds without signing"
  );
  await page.goto(
    origin + "/monsters/0x105319be2182018c31fb10b1be198c3cf238a146/1"
  );
  await page
    .getByRole("heading", { name: "Yunipal #1", exact: true })
    .waitFor();
  const viewer = page.getByRole("group", {
    name: "Interactive Yunipal card",
    exact: true
  });
  await viewer.waitFor();
  await viewer.locator(".tilt-card > img").evaluate((img) => img.decode());
  assert(
    await viewer
      .locator(".tilt-card > img")
      .evaluate((img) => img.naturalWidth > 0)
  );
  await viewer.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      document
        .querySelector(".tilt-card")
        .style.getPropertyValue("--rotate-y") !== "0deg"
  );
  assert.equal(await viewer.getAttribute("data-live-holo"), "true");
  assert.equal(await viewer.locator(".monster-depth").count(), 1);
  await page.getByRole("button", { name: "Live holo on", exact: true }).click();
  assert.equal(await viewer.getAttribute("data-live-holo"), "false");
  await page
    .getByRole("button", { name: "Live holo off", exact: true })
    .click();
  report.checks.push(
    "Real mainnet original #1 renders its published card; keyboard tilt and live holo controls work"
  );
  await page.screenshot({ path: values.output + ".card.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/");
  await page
    .getByRole("link", { name: "Open booster packs", exact: true })
    .waitFor();
  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: innerWidth
  }));
  assert(width.document <= width.viewport + 1);
  await page.screenshot({ path: values.output + ".mobile.png" });
  await page
    .getByRole("link", { name: "Open booster packs", exact: true })
    .click();
  await page.waitForURL(origin + "/boosters");
  await page.getByRole("heading", { name: "Pack #2", exact: true }).waitFor();
  report.checks.push(
    "390px homepage and internal pack navigation fit without horizontal overflow"
  );
  const missingAssetStatus = await page.evaluate(
    async () => (await fetch("/assets/absent-acceptance-check.js")).status
  );
  assert.equal(missingAssetStatus, 404);
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  assert(canonical?.startsWith("https://www.yunipals.com"));
  const walletMethods = await page.evaluate(() => window.__readOnlyWalletCalls);
  assert(!walletMethods.some((method) => /send|sign/i.test(method)));
  assert.deepEqual(errors, []);
  assert.deepEqual(badAssets, []);
  assert(
    api.some(
      (entry) => entry.path.includes("/boosters/types") && entry.status === 200
    )
  );
  Object.assign(report, {
    status: "PASSED",
    api,
    errors,
    badAssets,
    walletMethods,
    mainnetBroadcasts: 0
  });
} catch (error) {
  Object.assign(report, {
    status: "FAILED",
    error: error.message,
    errors,
    badAssets,
    walletMethods: await page
      .evaluate(() => window.__readOnlyWalletCalls)
      .catch(() => [])
  });
  await page
    .screenshot({ path: values.output + ".failed.png" })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
