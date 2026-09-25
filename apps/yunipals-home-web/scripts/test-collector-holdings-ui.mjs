import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5178" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-collector-holdings-ui.json"
    }
  }
});
const app = new URL(values.url);
assert.ok(
  ["127.0.0.1", "localhost"].includes(app.hostname),
  "Use an isolated local frontend"
);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  headless: true,
  args: ["--no-sandbox"]
});
const owner = "0x0000000000000000000000000000000000000001";
const token = {
  chain: "ethereum",
  chainId: 1,
  contractAddress: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
  tokenId: "10000000001",
  lifecycle: 1,
  name: "Uniair",
  image: null,
  attributes: [],
  rarityPoints: "65.6565",
  rarityPointsCapped: "65.6565",
  hidden: false
};
const tests = [];
try {
  for (const scenario of [
    "missing ranking",
    "failed ranking",
    "slow ranking",
    "ranked collector",
    "empty holdings",
    "failed holdings",
    "holdings catch up"
  ]) {
    const context = await browser.newContext({
      viewport: {
        width:
          scenario === "failed ranking"
            ? 390
            : scenario === "ranked collector"
              ? 710
              : 1440,
        height: 900
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let releaseRanking;
    const rankGate = new Promise((resolve) => {
      releaseRanking = resolve;
    });
    let hasToken = !["empty holdings", "holdings catch up"].includes(scenario);
    if (scenario === "holdings catch up") await page.clock.install();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== app.origin) return route.abort();
      if (url.pathname.startsWith("/__market-test"))
        return route.fulfill({
          status: 503,
          json: { error: "No market data required for holdings" }
        });
      if (!url.pathname.startsWith("/__indexer-test")) return route.continue();
      if (url.pathname.endsWith("/leaderboard")) {
        if (scenario === "slow ranking") await rankGate;
        if (scenario !== "ranked collector")
          return route.fulfill({
            status: scenario === "failed ranking" ? 503 : 404,
            json: {
              error:
                scenario === "failed ranking"
                  ? "database_unavailable"
                  : "owner_not_found"
            }
          });
        return route.fulfill({
          json: {
            owner,
            ownerInput: owner,
            ownerName: null,
            ensName: null,
            resolvedAddresses: { ethereum: owner },
            monsterCount: 1,
            totalRarity: "65.6565",
            uniqueTypes: 1,
            specialCount: 0,
            glitterCount: 0,
            collectorScore: "3507",
            scoreVersion: "collector-score-v1",
            updatedAt: new Date().toISOString(),
            totalRarityRank: 36762,
            monsterCountRank: 36762,
            uniqueTypesRank: 36762,
            specialCountRank: 36762,
            glitterCountRank: 36762,
            collectorScoreRank: 36762
          }
        });
      }
      if (url.pathname.endsWith("/tokens"))
        return route.fulfill(
          scenario === "failed holdings"
            ? { status: 503, json: { error: "database_unavailable" } }
            : {
                json: {
                  owner,
                  ownerInput: owner,
                  ownerName: null,
                  resolvedAddresses: { ethereum: owner },
                  chain: null,
                  chains: ["ethereum"],
                  visibility: "visible",
                  items: hasToken ? [token] : [],
                  nextCursor: null
                }
              }
        );
      return route.fulfill({
        status: 404,
        json: { error: "Unknown fixture request" }
      });
    });
    try {
      await page.goto(`${app.origin}/collector/${owner}`, {
        waitUntil: "domcontentloaded"
      });
      assert.equal(
        await page
          .getByRole("dialog", { name: "Buying and selling on Yunipals" })
          .count(),
        0
      );
      if (scenario === "failed holdings") {
        await page
          .getByText(
            "The Yunipals indexer is temporarily unavailable. Please try again.",
            { exact: true }
          )
          .waitFor();
        assert.equal(
          await page.getByText("No visible Yunipals", { exact: true }).count(),
          0
        );
      } else if (!hasToken) {
        await page.getByText("No visible Yunipals", { exact: true }).waitFor();
        if (scenario === "holdings catch up") {
          hasToken = true;
          await page.clock.fastForward(30_001);
          await page.getByText("Uniair", { exact: true }).waitFor();
        }
      } else {
        await page.getByText("Uniair", { exact: true }).waitFor();
        assert.equal(
          await page.getByText("No active Yunipals", { exact: true }).count(),
          0
        );
        if (scenario === "slow ranking")
          await page.getByText("Loading rankings…", { exact: true }).waitFor();
        if (scenario === "ranked collector") {
          const score = page.getByRole("region", {
            name: "Collector score summary"
          });
          await score.getByText("3,507", { exact: true }).waitFor();
          await score.getByText("#36,762", { exact: true }).waitFor();
          assert.equal(
            await score.getByText("collector-score-v1", { exact: true }).count(),
            0
          );
          assert.equal(
            await score.evaluate(
              (element) => element.scrollWidth <= element.clientWidth
            ),
            true
          );
          await page.screenshot({
            path: "/tmp/yunipals-collector-score-responsive.png"
          });
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          true
        );
      }
      assert.deepEqual(errors, []);
      tests.push({ scenario, status: "passed" });
      console.log(`PASS ${scenario}`);
    } finally {
      releaseRanking();
      await context.close();
    }
  }
  await writeFile(
    values.output,
    JSON.stringify({ status: "passed", tests }, null, 2)
  );
} finally {
  await browser.close();
}
