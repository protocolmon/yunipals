import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { fixtureResponse } from "./fixtures/devServer.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5188" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-analytics-ui.json" }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname)
)
  throw new Error("Use the isolated local analytics test server.");
if (!values.playwright)
  throw new Error("Pass --playwright with a local Playwright module path.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const requests = [];
const payloads = [];
const profiles = [];
let countryRequests = 0;
const errors = [];
const tests = [];
const consentKey = "yunipals.analytics.consent.v2";
const visitorKey = "yunipals.analytics.visitor.v2";
const sensitive = "0x1234567890123456789012345678901234567890";
let blockMixpanel = false;

async function context(init) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  });
  if (init) await ctx.addInitScript(init);
  ctx.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message))
  );
  await ctx.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname.endsWith(".mixpanel.com")) {
      requests.push({ url: url.href, referrer: request.headers().referer });
      assert.equal(url.hostname, "api-eu.mixpanel.com");
      assert.ok(["/track/", "/engage/"].includes(url.pathname));
      assert.equal(url.searchParams.get("ip"), "0");
      const body = request.postData() ?? "";
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        const encoded = new URLSearchParams(body).get("data") ?? "";
        try {
          data = JSON.parse(encoded);
        } catch {
          data = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        }
      }
      const events = Array.isArray(data) ? data : [data];
      for (const event of events) {
        if (url.pathname === "/engage/") {
          assert.equal(event.$token, "analytics-test");
          assert.match(event.$distinct_id, /^wallet:evm:[0-9a-f]{64}$/);
          assert.equal(event.$distinct_id, event.$user_id);
          assert.equal(event.$ip, "0");
          assert.deepEqual(Object.keys(event.$set).sort(), [
            "country",
            "environment",
            "identity_type",
            "schema_version"
          ]);
          assert.equal(event.$set.country, "DE");
          assert.equal(JSON.stringify(event).includes(sensitive), false);
          profiles.push(event);
          continue;
        }
        assert.equal(
          event.properties.token,
          "analytics-test",
          "Never run this test against a real project token."
        );
        assert.equal(JSON.stringify(event).includes(sensitive), false);
        assert.equal(event.properties.$current_url, undefined);
        assert.equal(event.properties.$referrer, undefined);
        payloads.push(event);
      }
      if (blockMixpanel) return route.abort();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "1"
      });
    }
    if (url.origin !== app.origin) return route.abort();
    if (url.pathname === "/api/analytics-country") {
      countryRequests++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ country: "DE" })
      });
    }
    if (url.pathname.startsWith("/__fixtures/")) {
      const result = fixtureResponse(url, request.method());
      return route.fulfill({
        status: result.status,
        contentType: "application/json",
        body: JSON.stringify(result.body)
      });
    }
    return route.continue();
  });
  return ctx;
}
async function settings(page) {
  if (new URL(page.url()).pathname !== "/privacy")
    await page
      .locator("footer")
      .getByRole("link", { name: "Privacy Notice", exact: true })
      .click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "Analytics settings", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Analytics settings", exact: true });
}
async function waitEvents(count) {
  const deadline = Date.now() + 15_000;
  while (payloads.length < count && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(
    payloads.length >= count,
    `Expected ${count} events, got ${payloads.length}`
  );
}
async function settle(page) {
  await page.waitForTimeout(200);
}
try {
  const ctx = await context();
  const page = await ctx.newPage();
  const sdkLoads = [];
  page.on("request", (request) => {
    if (/analytics\/mixpanel|loader-module-core/.test(request.url()))
      sdkLoads.push(request.url());
  });
  await page.goto(`${app.origin}/privacy`);
  await page
    .getByRole("heading", { name: "Optional analytics", exact: true })
    .waitFor();
  await settle(page);
  assert.equal(requests.length, 0);
  assert.equal(countryRequests, 0);
  assert.equal(sdkLoads.length, 0);
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), visitorKey),
    null
  );
  tests.push("No SDK load, network request or identifier before consent");
  await page
    .getByText(
      "Analytics events are retained for 2 years under the Mixpanel project policy.",
      { exact: false }
    )
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "privacy@example.test", exact: true })
      .getAttribute("href"),
    "mailto:privacy@example.test"
  );
  tests.push("Privacy notice uses calendar years and the configured contact");
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.reload();
  await page
    .getByRole("heading", { name: "How Yunipals handles information" })
    .waitFor();
  assert.equal(requests.length, 0);
  assert.equal(countryRequests, 0);
  assert.equal(sdkLoads.length, 0);
  tests.push("Decline persists across reload");
  let dialog = await settings(page);
  await dialog
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await waitEvents(1);
  assert.equal(payloads.length, 1);
  const firstId = payloads[0].properties.distinct_id;
  assert.ok(sdkLoads.length > 0);
  tests.push(
    "Acceptance loads core SDK and sends one pageview under Strict Mode"
  );
  await page.goto(
    `${app.origin}/collector/${sensitive}?utm_source=${sensitive}&owner=${sensitive}`
  );
  await waitEvents(2);
  assert.equal(payloads[1].properties.route, "/collector/:address");
  assert.equal(payloads[1].properties.distinct_id, firstId);
  assert.ok(requests.every((request) => request.referrer === `${app.origin}/`));
  tests.push(
    "Collector address, query parameters and referrer path excluded; identifier survives reload"
  );
  const beforeDetail = payloads.length;
  await page.goto(`${app.origin}/collection/ethereum/1`);
  await page.getByRole("heading", { name: "Sample Water 1" }).waitFor();
  await waitEvents(beforeDetail + 2);
  assert.equal(
    payloads
      .slice(beforeDetail)
      .filter((event) => event.event === "Collectible Viewed").length,
    1
  );
  tests.push("Successful detail view emits one collectible event");
  await page.goto(`${app.origin}/`);
  await page
    .getByLabel("Token ID, wallet, or ENS name", { exact: true })
    .fill(sensitive);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.waitForURL(`**/collector/${sensitive}`);
  await settle(page);
  assert.ok(
    payloads.some(
      (event) =>
        event.event === "Collection Search Submitted" &&
        event.properties.search_type === "collector"
    )
  );
  tests.push("Search emits its category without its value");
  const second = await ctx.newPage();
  await second.goto(`${app.origin}/privacy`);
  await settle(second);
  dialog = await settings(page);
  await settle(page);
  const beforeWithdrawal = payloads.length;
  await dialog
    .getByRole("button", { name: "Turn analytics off", exact: true })
    .click();
  await second.getByRole("link", { name: "Terms of Use", exact: true }).click();
  await settle(second);
  assert.equal(payloads.length, beforeWithdrawal);
  assert.equal(
    await second.evaluate((key) => localStorage.getItem(key), visitorKey),
    null
  );
  tests.push("Withdrawal blocks another open tab and removes identifier");
  dialog = await settings(page);
  await dialog
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await waitEvents(beforeWithdrawal + 1);
  assert.notEqual(payloads.at(-1).properties.distinct_id, firstId);
  tests.push("Regrant generates a fresh browser identifier");
  const requestCount = requests.length;
  blockMixpanel = true;
  await page.getByRole("link", { name: "Terms of Use", exact: true }).click();
  await page.getByRole("heading", { name: "Yunipals Terms of Use" }).waitFor();
  await settle(page);
  assert.ok(requests.length > requestCount);
  tests.push("Blocked analytics requests leave navigation functional");
  blockMixpanel = false;
  await ctx.close();
  const signalCtx = await context(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", {
      get: () => true
    });
  });
  const signal = await signalCtx.newPage();
  await signal.goto(`${app.origin}/privacy`);
  dialog = await settings(signal);
  assert.equal(
    await dialog
      .getByRole("button", { name: "Allow analytics", exact: true })
      .isDisabled(),
    true
  );
  tests.push("GPC prevents analytics consent and SDK initialization");
  await signalCtx.close();
  const storageCtx = await context(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("yunipals.analytics."))
        throw new DOMException("Disabled", "SecurityError");
      return setItem.call(this, key, value);
    };
  });
  const storagePage = await storageCtx.newPage();
  await storagePage.goto(`${app.origin}/privacy`);
  await storagePage
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await storagePage
    .getByRole("alert")
    .filter({ hasText: "could not save" })
    .waitFor();
  assert.equal(
    await storagePage.evaluate((key) => localStorage.getItem(key), consentKey),
    null
  );
  tests.push("Unavailable preference storage keeps analytics off");
  await storageCtx.close();
  const profileCtx = await context();
  const profilePage = await profileCtx.newPage();
  await profilePage.goto(`${app.origin}/privacy`);
  async function setConnectedWallet(wallet) {
    await profilePage.evaluate(async (wallet) => {
      const { walletConfig } = await import("/src/lib/wallet.ts");
      const connector = walletConfig.connectors[0];
      if (!connector)
        throw new Error(
          "Expected a browser connector in the isolated non-fixture app."
        );
      walletConfig.setState((state) => ({
        ...state,
        status: wallet ? "connected" : "disconnected",
        current: wallet ? connector.uid : null,
        connections: wallet
          ? new Map([
              [connector.uid, { accounts: [wallet], chainId: 8453, connector }]
            ])
          : new Map()
      }));
    }, wallet);
  }
  async function waitProfiles(count) {
    const end = Date.now() + 15000;
    while (profiles.length < count && Date.now() < end)
      await profilePage.waitForTimeout(50);
    assert.equal(profiles.length, count);
  }
  const before = {
    requests: requests.length,
    country: countryRequests,
    profiles: profiles.length
  };
  await setConnectedWallet(sensitive);
  await settle(profilePage);
  assert.equal(requests.length, before.requests);
  assert.equal(countryRequests, before.country);
  await profilePage
    .getByRole("button", { name: "Allow analytics", exact: true })
    .click();
  await waitProfiles(before.profiles + 1);
  const firstProfile = profiles.at(-1);
  const firstDevice = firstProfile.$device_id;
  assert.equal(firstProfile.$set.country, "DE");
  tests.push(
    "A connected wallet remains untracked before consent, then creates a sanitized country-bearing profile"
  );
  await setConnectedWallet("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await waitProfiles(before.profiles + 2);
  assert.notEqual(profiles.at(-1).$device_id, firstDevice);
  assert.notEqual(profiles.at(-1).$distinct_id, firstProfile.$distinct_id);
  await setConnectedWallet(null);
  await settle(profilePage);
  await setConnectedWallet(sensitive);
  await waitProfiles(before.profiles + 3);
  assert.equal(profiles.at(-1).$distinct_id, firstProfile.$distinct_id);
  assert.notEqual(profiles.at(-1).$device_id, firstDevice);
  tests.push(
    "Wallet changes and disconnect rotate device identities; reconnecting uses the same stable profile ID"
  );
  const beforeChain = payloads.length;
  await profilePage.evaluate(async () => {
    const { onchainAnalytics } = await import("/src/lib/analytics/onchain.ts");
    onchainAnalytics.submitted(8453, "booster-open", "local-test-hash");
    onchainAnalytics.replace(8453, "local-test-hash", "local-test-replacement");
    onchainAnalytics.confirmed(8453, "local-test-replacement");
    onchainAnalytics.confirmed(8453, "local-test-hash");
  });
  await waitEvents(beforeChain + 2);
  const chainEvents = payloads
    .slice(beforeChain)
    .filter((event) => event.event.startsWith("Onchain Action"));
  assert.deepEqual(
    chainEvents.map((event) => event.event),
    ["Onchain Action Submitted", "Onchain Action Confirmed"]
  );
  assert.ok(
    chainEvents.every(
      (event) =>
        event.properties.$user_id === firstProfile.$distinct_id &&
        event.properties.country === "DE"
    )
  );
  assert.equal(JSON.stringify(chainEvents).includes("local-test-hash"), false);
  tests.push(
    "Actual SDK sends one submitted and confirmed on-chain event with wallet identity and country, without hashes"
  );
  dialog = await settings(profilePage);
  await dialog
    .getByRole("button", { name: "Turn analytics off", exact: true })
    .click();
  const afterWithdrawal = requests.length;
  await setConnectedWallet("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  await settle(profilePage);
  assert.equal(requests.length, afterWithdrawal);
  tests.push("Withdrawal stops profile updates and wallet identity events");
  assert.equal(
    payloads.some((event) => event.event === "$identify"),
    false
  );
  tests.push(
    "SDK automatic identify event is suppressed so default sensitive properties cannot bypass the allowlist"
  );
  await profileCtx.close();
  assert.deepEqual(errors, []);
  await writeFile(
    values.output,
    JSON.stringify(
      {
        tests,
        requests: requests.length,
        eventNames: [...new Set(payloads.map((event) => event.event))],
        errors
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ tests, requests: requests.length, errors }, null, 2)
  );
} finally {
  await browser.close();
}
