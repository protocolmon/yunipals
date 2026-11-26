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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const wallet = "0x000000000000000000000000000000000000000c";
const otherWallet = "0x000000000000000000000000000000000000000d";
const profile = {
  owner: wallet,
  ensName: null,
  ownerInput: wallet,
  ownerName: null,
  resolvedAddresses: { base: wallet },
  collectorScore: "12345",
  collectorScoreRank: 1234,
  totalRarity: "2345.6",
  totalRarityRank: 234,
  monsterCount: 42,
  monsterCountRank: 34,
  uniqueTypes: 12,
  uniqueTypesRank: 4,
  specialCount: 3,
  specialCountRank: 5,
  glitterCount: 0,
  glitterCountRank: 6,
  scoreVersion: "fixture-v1",
  updatedAt: "2026-01-01T00:00:00.000Z"
};
const metrics = [
  ["collector-score", "Collector score", 1234, "12,345"],
  ["total-rarity", "Total rarity", 234, "2,345.6"],
  ["monster-count", "Monster count", 34, "42"],
  ["unique-types", "Unique types", 4, "12"],
  ["special-count", "Special count", 5, "3"],
  ["glitter-count", "Glitter count", 6, "0"]
];
let personalStatus = 200;
let listed = false;
let personalRequests = 0;
let fusionRequests = 0;
const errors = [];
page.on("request", (request) => {
  if (new URL(request.url()).pathname.includes("/v1/evolution/collection"))
    fusionRequests++;
});
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (
    url.pathname.startsWith("/__fixtures/") &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    url.host = app.host;
    if (/\/owners\/[^/]+\/leaderboard$/.test(url.pathname)) {
      personalRequests++;
      return route.fulfill({
        status: personalStatus,
        json:
          personalStatus === 200
            ? profile
            : { error: "unavailable", message: "Sample rank unavailable" }
      });
    }
    if (listed && url.pathname.endsWith("/leaderboards/collector-score")) {
      return route.fulfill({
        json: {
          metric: "collector-score",
          label: "Collector score",
          chain: null,
          scoreVersion: "fixture-v1",
          items: [{ ...profile, rank: 1234, score: profile.collectorScore }],
          nextCursor: null,
          updatedAt: profile.updatedAt
        }
      });
    }
    return route.fulfill({ response: await route.fetch({ url: url.href }) });
  }
  return url.origin === app.origin ? route.continue() : route.abort();
});
async function connect(address) {
  await page.evaluate(async (address) => {
    const { walletConfig } = await import("/src/lib/wallet.ts");
    walletConfig.setState({
      ...walletConfig.state,
      status: address ? "connected" : "disconnected",
      current: address ? "fixture" : null,
      connections: new Map(
        address
          ? [
              [
                "fixture",
                {
                  accounts: [address],
                  chainId: 1,
                  connector: {
                    id: "fixture",
                    name: "Fixture",
                    type: "mock",
                    uid: "fixture",
                    getProvider: async () => ({})
                  }
                }
              ]
            ]
          : []
      )
    });
  }, address);
}
const position = page.getByRole("region", {
  name: "Your leaderboard position"
});
try {
  await page.goto(`${app.origin}/collector/${wallet}?edition=og`);
  const browse = page.getByRole("button", { name: "Browse only", exact: true });
  if (await browse.isVisible()) await browse.click();
  await page.locator("main article").first().waitFor();
  await connect(wallet);
  await page
    .getByRole("heading", { name: "Your OG Collection", exact: true })
    .first()
    .waitFor();
  assert.equal(await page.getByText("My rankings", { exact: true }).count(), 0);
  assert.equal(await page.locator("main summary").count(), 0);
  assert.equal(personalRequests, 0, "Collection does not fetch rankings");
  await page
    .getByRole("link", { name: "Leaderboard", exact: true })
    .first()
    .click();
  for (const [, label, rank, score] of metrics) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await position.getByLabel(`Rank ${rank}`, { exact: true }).waitFor();
    await position.getByText(score, { exact: true }).waitFor();
    assert.equal(await page.getByText("You", { exact: true }).count(), 1);
  }
  await page
    .getByRole("button", { name: "Collector score", exact: true })
    .click();
  await position.getByLabel("Rank 1234", { exact: true }).waitFor();
  await page.setViewportSize({ width: 320, height: 844 });
  await position.scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    ),
    false
  );
  await page.keyboard.press("Tab");
  await position.getByRole("link").focus();
  assert.equal(
    await position
      .getByRole("link")
      .evaluate((el) => el.matches(":focus-visible")),
    true
  );
  console.log(
    "Collection has no rank panel/request; all six metrics, off-page position and mobile keyboard row pass."
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Collector score", exact: true })
    .click();
  listed = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await position.waitFor({ state: "detached" });
  assert.equal(await page.getByText("You", { exact: true }).count(), 1);
  console.log(
    "Loaded personal row is highlighted once without a duplicate pinned row."
  );
  listed = false;
  personalStatus = 404;
  await connect(otherWallet);
  await page.getByText("You’re not ranked yet", { exact: true }).waitFor();
  assert.equal(await page.getByText("You", { exact: true }).count(), 0);
  personalStatus = 503;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByText("Your rank is temporarily unavailable", { exact: true })
    .waitFor();
  personalStatus = 200;
  profile.owner = otherWallet;
  await page
    .getByRole("button", { name: "Retry your rank", exact: true })
    .click();
  await position.getByText("You", { exact: true }).waitFor();
  assert.equal(
    await position.getByRole("link").getAttribute("href"),
    `/collector/${otherWallet}`
  );
  await connect(null);
  await position.waitFor({ state: "detached" });
  assert.equal(await page.getByText("You", { exact: true }).count(), 0);
  await page.goto(`${app.origin}/collector/${wallet}?edition=tcg`);
  await page
    .getByRole("searchbox", { name: "Search your TCG collection" })
    .waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Fusions in this wallet" }).count(),
    0
  );
  assert.equal(fusionRequests, 0);
  await page.getByRole("link", { name: "Open packs", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Wallet change, unranked, transient failure/retry, disconnect and TCG without fusion gallery pass."
  );
} finally {
  await browser.close();
}
