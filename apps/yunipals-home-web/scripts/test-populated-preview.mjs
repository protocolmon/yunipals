import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-populated-preview-browser.json"
    },
    screenshot: {
      type: "string",
      default: "/tmp/yunipals-populated-preview-mobile.png"
    }
  }
});
assert.ok(values.playwright);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const origin = "http://127.0.0.1:5179";
const report = {
  checkedAt: new Date().toISOString(),
  scope:
    "Real deployed SSH-only frontend, staging marketplace catalog and existing indexer; no response fixtures, wallet connection, publication or transactions. External token artwork loads normally.",
  tests: [],
  api: [],
  errors: []
};
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
// Observe a clone of the real fetch response in the browser. Chromium can omit
// Network.loadingFinished when the app cancels an already-read stream, so CDP
// response.finished() is not a reliable body recorder for this client's reads.
await context.addInitScript(() => {
  window.__yunipalsPreviewReads = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const url = new URL(response.url);
    if (
      url.origin === location.origin &&
      /^\/(market|indexer)\//.test(url.pathname)
    ) {
      void response
        .clone()
        .json()
        .then((body) => {
          window.__yunipalsPreviewReads.push({
            url: url.href,
            status: response.status,
            body
          });
        })
        .catch(() => {});
    }
    return response;
  };
});
const page = await context.newPage();
const requests = [];
const catalogs = [];
const seen = new Set();
page.on("pageerror", (error) => report.errors.push(error.message));
page.on("request", (request) =>
  requests.push({ url: request.url(), method: request.method() })
);
page.on("response", (response) => {
  const url = new URL(response.url());
  if (url.origin === origin && /^\/(market|indexer)\//.test(url.pathname)) {
    report.api.push({
      path: url.pathname,
      query: url.search,
      status: response.status()
    });
  }
});
async function collectReads() {
  const reads = await page.evaluate(() => window.__yunipalsPreviewReads);
  for (const read of reads) {
    if (read.status !== 200) continue;
    const url = new URL(read.url),
      body = read.body;
    if (url.pathname === "/market/v1/market/tokens") {
      const key = read.url + body.snapshot.id;
      if (seen.has(key)) continue;
      seen.add(key);
      catalogs.push({ body, url });
      const row = report.api.findLast(
        (r) => r.path === url.pathname && r.query === url.search
      );
      assert.ok(row);
      Object.assign(row, {
        total: body.total,
        items: body.items.length,
        sources: body.sources
      });
    }
    if (url.pathname === "/market/v1/market/capabilities") {
      assert.ok(
        Object.values(body.chains).every((chain) =>
          Object.values(chain).every((v) => v === false)
        )
      );
      report.capabilitiesDisabled = true;
    }
  }
}
const cards = () => page.locator("main article a[aria-label^='View ']");
async function loaded(count = 24) {
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll("main article a[aria-label^='View ']")
        .length === n,
    count,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    (n) =>
      window.__yunipalsPreviewReads
        .filter(
          (read) =>
            new URL(read.url).pathname === "/market/v1/market/tokens" &&
            read.status === 200
        )
        .reduce((sum, read) => sum + read.body.items.length, 0) >= n,
    count,
    { timeout: 10000 }
  );
  await collectReads();
}
async function visit(path) {
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
}
async function record(name, fn) {
  const started = Date.now();
  await fn();
  report.tests.push({ name, passed: true, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(report.tests.at(-1)));
}
try {
  let first;
  await record(
    "Homepage renders the actual complete catalog with trading disabled",
    async () => {
      await visit("/");
      await loaded();
      first = catalogs.find(({ url }) => !url.searchParams.has("cursor"))?.body;
      assert.ok(first && first.total > 1_000_000);
      assert.equal(first.listedTotal, null);
      assert.ok(
        first.items.every((item) =>
          ["unknown", "unlisted", "listed"].includes(item.market.status)
        )
      );
      const marketStatuses = Object.fromEntries(
        ["unknown", "unlisted", "listed"].map((status) => [
          status,
          first.items.filter((item) => item.market.status === status).length
        ])
      );
      assert.equal(
        Object.values(marketStatuses).reduce((sum, count) => sum + count, 0),
        first.items.length
      );
      const hrefs = await cards().evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      );
      assert.deepEqual(
        hrefs,
        first.items.map(
          ({ token }) => `/collection/${token.chain}/${token.tokenId}`
        )
      );
      assert.ok(
        (await page.locator("main").innerText()).includes(
          `${first.total.toLocaleString("en-US")} Yunipals · 24 loaded`
        )
      );
      assert.equal(
        await page.getByRole("button", { name: "Buy", exact: true }).count(),
        0
      );
      assert.equal(report.capabilitiesDisabled, true);
      report.revision = (await page.request.get(origin)).headers()[
        "x-yunipals-preview-revision"
      ];
      report.catalogTotal = first.total;
      report.marketStatuses = marketStatuses;
      await page
        .getByRole("heading", { name: "All active Yunipals", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: values.screenshot.replace(/\.png$/, "-desktop.png")
      });
    }
  );
  await record(
    "Load more preserves the actual catalog snapshot and distinct assets",
    async () => {
      await page.getByRole("button", { name: "Load more Yunipals" }).click();
      await loaded(48);
      const next = catalogs.find(({ url }) =>
        url.searchParams.has("cursor")
      )?.body;
      assert.ok(next);
      assert.equal(next.snapshot.id, first.snapshot.id);
      assert.equal(next.total, first.total);
      const hrefs = await cards().evaluateAll((links) =>
        links.map((link) => link.getAttribute("href"))
      );
      assert.equal(new Set(hrefs).size, 48);
    }
  );
  await record(
    "Saved collection URL redirects with its real chain and trait filters",
    async () => {
      await visit("/collection?chain=base&t.Type=Unifairy");
      await loaded();
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(new URL(page.url()).searchParams.get("t.Type"), "Unifairy");
      const current = catalogs.findLast(
        ({ url }) => url.searchParams.get("t.Type") === "Unifairy"
      )?.body;
      assert.ok(current && current.total > 24);
      assert.ok(
        current.items.every(
          ({ token }) =>
            token.chain === "base" &&
            token.attributes.some(
              (a) => a.trait_type === "Type" && a.value === "Unifairy"
            )
        )
      );
      assert.ok(
        (
          await cards().evaluateAll((links) =>
            links.map((link) => link.getAttribute("href"))
          )
        ).every((href) => href.startsWith("/collection/base/"))
      );
      report.filteredTotal = current.total;
    }
  );
  await record(
    "Mobile filters open, close with Escape and fit the viewport",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      );
      assert.ok(
        await page.locator("main article p").evaluateAll((nodes) => {
          const names = nodes.filter((node) => node.textContent === "Unifairy");
          return (
            names.length > 0 &&
            names.every((node) => node.scrollWidth <= node.clientWidth)
          );
        }),
        "Rarity values must not squeeze ordinary token names into truncation"
      );
      await cards().first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: values.screenshot });
    }
  );
  await record(
    "An actual token deep link shows indexer details with trading disabled",
    async () => {
      const href = await cards().first().getAttribute("href");
      await visit(href);
      await page
        .getByRole("region", { name: "Listings and offers", exact: true })
        .waitFor();
      await page
        .getByText("Buying and selling are not available on this chain yet.", {
          exact: true
        })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: /^(Buy|List for sale|Make an offer|Accept offer)$/
          })
          .count(),
        0
      );
      assert.ok(
        report.api.some(
          (r) =>
            r.path ===
              `/indexer/v1/tokens/${href.split("/").slice(2).join("/")}` &&
            r.status === 200
        )
      );
      report.tokenPath = href;
    }
  );
  await record(
    "Sale-filter reads render either exact listings or an explicit source error",
    async () => {
      await visit("/?chain=base&sale=listed");
      await page.waitForFunction(
        () =>
          window.__yunipalsPreviewReads.some((read) => {
            const url = new URL(read.url);
            return (
              url.pathname.endsWith("/v1/market/tokens") &&
              url.searchParams.get("sale") === "listed"
            );
          }),
        undefined,
        { timeout: 30000 }
      );
      const saleRead = await page.evaluate(() =>
        window.__yunipalsPreviewReads.findLast((read) => {
          const url = new URL(read.url);
          return (
            url.pathname.endsWith("/v1/market/tokens") &&
            url.searchParams.get("sale") === "listed"
          );
        })
      );
      assert.equal(new URL(page.url()).searchParams.get("sale"), "listed");
      assert.ok([200, 503].includes(saleRead.status));
      if (saleRead.status === 503) {
        await page
          .getByText(
            "Sale and price results are unavailable. Your filters are still applied.",
            { exact: true }
          )
          .waitFor();
        assert.equal(await cards().count(), 0);
        assert.equal(
          await page
            .getByText("No Yunipals match this combination.", { exact: true })
            .count(),
          0
        );
      } else {
        assert.equal(saleRead.body.sources.base, "available");
        assert.ok(
          saleRead.body.items.every(
            ({ market }) =>
              market.status === "listed" &&
              Array.isArray(market.listings) &&
              market.listings.length > 0
          )
        );
        await page.waitForFunction(
          (count) =>
            document.querySelectorAll("main article a[aria-label^='View ']")
              .length === count,
          saleRead.body.items.length
        );
        assert.equal(await cards().count(), saleRead.body.items.length);
      }
      report.saleFilterStatus = saleRead.status;
    }
  );
  await record(
    "Saved orders and recovery routes load with a disconnected wallet",
    async () => {
      await visit("/orders");
      await page
        .getByRole("heading", { name: "My orders", exact: true })
        .waitFor();
      await page
        .getByText("Connect your wallet to review your listings and offers.", {
          exact: true
        })
        .waitFor();
      await visit("/orders/recovery");
      await page
        .getByRole("heading", { name: "Order recovery", exact: true })
        .waitFor();
    }
  );
  for (const [chain, fromBlock] of Object.entries({
    ethereum: "19442152",
    base: "11872655",
    polygon: "54889689"
  })) {
    await record(
      `${chain} activity displays actual replay coverage without claiming complete history`,
      async () => {
        const response = await page.request.get(
          `${origin}/market/v1/market/tokens?chain=${chain}&limit=1`
        );
        assert.equal(response.status(), 200);
        const catalog = await response.json();
        const token = catalog.items[0]?.token;
        assert.ok(token && token.chain === chain);
        await visit(`/collection/${chain}/${token.tokenId}`);
        await page.waitForFunction(
          () =>
            window.__yunipalsPreviewReads.some(
              (read) =>
                new URL(read.url).pathname.endsWith("/activity") &&
                read.status === 200
            ),
          undefined,
          { timeout: 30000 }
        );
        const activity = await page.evaluate(
          () =>
            window.__yunipalsPreviewReads.findLast(
              (read) =>
                new URL(read.url).pathname.endsWith("/activity") &&
                read.status === 200
            ).body
        );
        const checkpoint = activity.chains[chain];
        assert.equal(checkpoint.coverage.source, "seaport");
        assert.equal(checkpoint.coverage.fromBlock, fromBlock);
        assert.ok(
          BigInt(checkpoint.confirmedThrough.blockNumber) >= BigInt(fromBlock)
        );
        const section = page.getByRole("region", {
          name: "Sale history",
          exact: true
        });
        await section
          .getByRole("list", { name: "Sale history coverage" })
          .waitFor();
        assert.ok(
          (await section.innerText()).includes("Seaport settlements since")
        );
        if (checkpoint.status !== "available") {
          assert.equal(activity.total, null);
          assert.ok((await section.innerText()).includes("Partial history"));
          assert.ok(
            (await section.innerText()).includes(
              "Some activity may be missing:"
            )
          );
          assert.equal(
            await section
              .getByText("No confirmed sales in this view.", { exact: true })
              .count(),
            0
          );
        }
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        );
        await section.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: values.screenshot.replace(/\.png$/, `-activity-${chain}.png`)
        });
        report.activity ??= {};
        report.activity[chain] = {
          tokenId: token.tokenId,
          checkpoint,
          total: activity.total,
          items: activity.items.length
        };
      }
    );
  }
  await collectReads();
  assert.deepEqual(report.errors, []);
  assert.equal(
    requests.filter(
      (r) => r.url.startsWith(origin) && !["GET", "HEAD"].includes(r.method)
    ).length,
    0
  );
  assert.equal(
    requests.filter((r) => r.url.startsWith(`${origin}/indexer/v1/tokens?`))
      .length,
    0,
    "Legacy indexer fallback must not masquerade as marketplace catalog success"
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  throw error;
} finally {
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
