import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getAddress } from "viem";

import { activityScopeKey } from "../src/lib/marketplace/activity.ts";
import { marketplaceChains } from "../src/lib/marketplace/registry.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5177" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: {
      type: "string",
      default: "/tmp/yunipals-marketplace-activity-ui.json"
    },
    screenshot: {
      type: "string",
      default: "/tmp/yunipals-marketplace-activity-mobile.png"
    }
  }
});
const app = new URL(values.url);
if (
  app.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(app.hostname) ||
  app.username ||
  app.password ||
  app.search ||
  app.hash
)
  throw new Error("Activity UI tests require a loopback HTTP app.");
if (!values.playwright) throw new Error("Pass a local Playwright module path.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const reports = {};
for (const chain of Object.keys(marketplaceChains)) {
  const name = chain === "bnb" ? "bnb-sale-fork" : `opensea-${chain}-sale-fork`;
  reports[chain] = JSON.parse(
    await readFile(
      new URL(
        `./fixtures/${name}.json`,
        import.meta.url
      ),
      "utf8"
    )
  );
}
const template = reports.bnb.saleObservations[0];
const seller = template.seller,
  recipient = template.nftRecipient;
const giftRecipient = "0x0000000000000000000000000000000000000003";
const observedAt = new Date().toISOString();
const now = Math.floor(Date.now() / 1000);
function syntheticSale(index) {
  const blockHash = `0x${String(index + 100).padStart(64, "0")}`;
  return {
    status: "confirmed",
    currentVisibility:
      index === 1
        ? "hidden"
        : index === 2
          ? "burned"
          : index === 3
            ? "unknown"
            : "public",
    sale: {
      ...structuredClone(template),
      blockHash,
      transactionHash: blockHash,
      orderHash: blockHash,
      eventId: `56:${blockHash}:3`,
      blockNumber: String(1000 - index),
      blockTimestamp: String(now - 100 - index),
      fulfillmentLogIndex: 3,
      transferLogIndex: 4,
      nftRecipient: index === 30 ? giftRecipient : recipient
    }
  };
}
const dataset = [
  ...Array.from({ length: 30 }, (_, i) => syntheticSale(i + 1)),
  ...["ethereum", "base", "polygon"].map((chain) => ({
    status: "confirmed",
    currentVisibility: "public",
    sale: structuredClone(
      reports[chain].saleObservations[chain === "polygon" ? 3 : 0]
    )
  }))
];
function compare(left, right) {
  const a = left.sale,
    b = right.sale;
  if (a.blockTimestamp !== b.blockTimestamp)
    return BigInt(a.blockTimestamp) > BigInt(b.blockTimestamp) ? -1 : 1;
  if (a.asset.chainId !== b.asset.chainId)
    return a.asset.chainId - b.asset.chainId;
  if (a.blockNumber !== b.blockNumber)
    return BigInt(a.blockNumber) > BigInt(b.blockNumber) ? -1 : 1;
  return b.fulfillmentLogIndex - a.fulfillmentLogIndex;
}
const report = {
  checkedAt: observedAt,
  scope:
    "Read-only Chromium activity UI with fixture API snapshots, synthetic pagination records and sale shapes from local-fork test fixtures. All external browser requests are blocked. The injected wallet can expose/change accounts only; signing and transaction requests fail. No production API, canonicality/finality service or live chain is used.",
  tests: []
};
let browser,
  page,
  authorized = false,
  account = seller;
let unavailable = false,
  failNext = false,
  reorg = false,
  changedCheckpoint = false,
  partial = false,
  wrongAsset = false,
  invalidIdentity = false;
let snapshotIndex = 0;
const snapshots = new Map(),
  requests = [],
  walletMethods = [],
  pageErrors = [];
const pass = (name) => {
  report.tests.push({ name, status: "passed" });
  process.stdout.write(`PASS ${name}\n`);
};
try {
  browser = await chromium.launch({
    headless: true,
    ...(values.chromium ? { executablePath: values.chromium } : {}),
    args: ["--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 }
  });
  await context.exposeBinding("activityFixtureWallet", async (_, request) => {
    walletMethods.push(request.method);
    if (request.method === "eth_chainId") return "0x38";
    if (request.method === "eth_accounts") return authorized ? [account] : [];
    if (request.method === "eth_requestAccounts") {
      authorized = true;
      return [account];
    }
    if (request.method === "wallet_getPermissions")
      return authorized ? [{ parentCapability: "eth_accounts" }] : [];
    if (request.method === "wallet_requestPermissions") {
      authorized = true;
      return [{ parentCapability: "eth_accounts" }];
    }
    if (request.method === "wallet_getCapabilities") return {};
    throw new Error(
      `Read-only fixture refuses wallet method ${request.method}`
    );
  });
  await context.addInitScript(() => {
    const listeners = new Map();
    const provider = {
      isConnected: () => true,
      request: (request) => window.activityFixtureWallet(request),
      on: (event, callback) =>
        listeners.set(event, [...(listeners.get(event) ?? []), callback]),
      removeListener: (event, callback) =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter(
            (listener) => listener !== callback
          )
        )
    };
    window.ethereum = provider;
    window.activityFixtureAccountsChanged = (accounts) => {
      for (const callback of listeners.get("accountsChanged") ?? [])
        callback(accounts);
    };
    const detail = {
      provider,
      info: {
        uuid: "289b3b04-f2c4-4fb5-8a61-a068919c6310",
        name: "Yunipals read-only wallet",
        rdns: "test.yunipals.activity",
        icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='purple'/></svg>"
      }
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== app.origin) return route.abort();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body)
      });
    if (url.pathname.startsWith("/__indexer-test/")) {
      const match = url.pathname.match(
        /\/tokens\/(ethereum|base|polygon|bnb)\/(\d+)$/
      );
      if (!match) return json({}, 404);
      const [, chain, tokenId] = match;
      return json({
        token: {
          chain,
          chainId: invalidIdentity ? 999 : marketplaceChains[chain].chainId,
          contractAddress: marketplaceChains[chain].contractAddress,
          token_id: tokenId,
          owner: seller,
          burned: false,
          hidden: false,
          lifecycle: 9,
          mint_block: "1",
          last_transfer_block: "2",
          name: "Activity fixture Yunipal",
          image: null,
          attributes: [],
          metadataAvailable: true,
          rarityPoints: "4",
          rarityPointsCapped: "4"
        },
        transfers: [],
        lifecycles: []
      });
    }
    if (!url.pathname.startsWith("/__market-test/")) return route.continue();
    assert.equal(
      route.request().method(),
      "GET",
      "Activity never prepares or submits an order."
    );
    if (url.pathname.endsWith("/capabilities"))
      return json({
        schemaVersion: 1,
        chains: Object.fromEntries(
          Object.keys(marketplaceChains).map((chain) => [
            chain,
            {
              read: false,
              buy: false,
              createListing: false,
              createOffer: false,
              acceptOffer: false,
              cancel: false
            }
          ])
        )
      });
    if (!url.pathname.endsWith("/activity")) return json({}, 404);
    requests.push(url.href);
    if (unavailable || (failNext && url.searchParams.has("cursor")))
      return json({}, 503);
    if (reorg && url.searchParams.has("cursor")) return json({}, 409);
    const wallet = url.pathname.match(
      /\/wallets\/(0x[a-fA-F0-9]{40})\/activity$/
    );
    const asset = url.pathname.match(
      /\/assets\/(ethereum|base|polygon|bnb)\/(0x[a-fA-F0-9]{40})\/(\d+)\/activity$/
    );
    assert.ok(wallet || asset);
    const scope = wallet
      ? {
          kind: "wallet",
          wallet: getAddress(wallet[1]),
          chain: url.searchParams.get("chain"),
          view: url.searchParams.get("view")
        }
      : {
          kind: "asset",
          asset: {
            chain: asset[1],
            chainId: marketplaceChains[asset[1]].chainId,
            contractAddress: asset[2],
            tokenId: asset[3]
          }
        };
    const query = activityScopeKey(scope);
    let snapshot = snapshots.get(url.searchParams.get("snapshot"));
    if (!url.searchParams.has("cursor")) {
      const selected =
        scope.kind === "asset"
          ? [scope.asset.chain]
          : scope.chain === "all"
            ? Object.keys(marketplaceChains)
            : [scope.chain];
      const rows = dataset
        .filter(
          ({ sale }) =>
            selected.includes(sale.asset.chain) &&
            (scope.kind === "asset"
              ? sale.asset.tokenId === scope.asset.tokenId &&
                sale.asset.contractAddress.toLowerCase() ===
                  scope.asset.contractAddress.toLowerCase()
              : scope.view === "sales"
                ? sale.seller === scope.wallet
                : scope.view === "received"
                  ? sale.nftRecipient === scope.wallet
                  : sale.seller === scope.wallet ||
                    sale.nftRecipient === scope.wallet)
        )
        .sort(compare);
      const chains = Object.fromEntries(
        selected.map((chain) => [
          chain,
          {
            status: partial && chain === "bnb" ? "syncing" : "available",
            coverage: {
              source: chain === "bnb" ? "yunipals" : "seaport",
              fromBlock: "0",
              fromTimestamp: "0",
              excludedEvents: partial && chain === "bnb" ? 2 : 0
            },
            confirmedThrough: {
              blockNumber: String(
                Math.max(
                  ...dataset
                    .filter((row) => row.sale.asset.chain === chain)
                    .map((row) => Number(row.sale.blockNumber))
                ) + 1
              ),
              blockHash: `0x${"aa".repeat(32)}`
            }
          }
        ])
      );
      snapshot = {
        id: `activity_${++snapshotIndex}`,
        query,
        rows: structuredClone(rows),
        chains,
        partial: Object.values(chains).some(
          (source) => source.status !== "available"
        )
      };
      snapshots.set(snapshot.id, snapshot);
    }
    assert.ok(snapshot, "Continuation must use an issued snapshot.");
    assert.equal(snapshot.query, query);
    const offset = Number(url.searchParams.get("cursor")?.slice(1) ?? 0);
    const items = structuredClone(snapshot.rows.slice(offset, offset + 25));
    if (wrongAsset && items.length) items[0].sale.asset.tokenId = "999";
    const chains = structuredClone(snapshot.chains);
    if (changedCheckpoint && offset)
      chains.bnb.confirmedThrough.blockNumber = String(
        Number(chains.bnb.confirmedThrough.blockNumber) + 1
      );
    return json({
      schemaVersion: 1,
      query,
      snapshot: { id: snapshot.id, observedAt },
      chains,
      total: snapshot.partial ? null : snapshot.rows.length,
      items,
      nextCursor: offset + 25 < snapshot.rows.length ? `p${offset + 25}` : null
    });
  });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const records = page
    .getByRole("list", { name: "Confirmed sale records", exact: true })
    .locator(":scope > li");
  async function count(expected) {
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll(
          'ul[aria-label="Confirmed sale records"] > li'
        ).length === n,
      expected
    );
  }
  async function links() {
    return records
      .getByRole("link", { name: "View transaction", exact: true })
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  }
  await page.goto(`${app.origin}/orders/activity`);
  assert.equal(
    await page
      .getByRole("dialog", { name: "Buying and selling on Yunipals" })
      .count(),
    0
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByText("Yunipals read-only wallet", { exact: true })
    .last()
    .click();
  await count(25);
  await page.getByText(/33 sales in this view/).waitFor();
  assert.equal(
    await page
      .getByRole("list", { name: "Sale history coverage" })
      .getByText(/Seaport settlements since/)
      .count(),
    3
  );
  await records.first().getByText("Payment details", { exact: true }).click();
  await records
    .first()
    .getByText(/Seller proceeds:/)
    .waitFor();
  assert.equal(
    await records.first().getByRole("link", { name: "View Yunipal" }).count(),
    0
  );
  pass(
    "Wallet activity exposes exact sale prices, payment details and full-query counts while retaining hidden NFT identities"
  );

  const firstLinks = await links();
  dataset.push(syntheticSale(0));
  await page
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await count(33);
  assert.deepEqual((await links()).slice(0, 25), firstLinks);
  assert.equal(new Set(await links()).size, 33);
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await count(25);
  await page.getByText(/34 sales in this view/).waitFor();
  assert.notEqual((await links())[0], firstLinks[0]);
  pass(
    "Stable pagination excludes newly arrived sales until refresh starts a complete new snapshot"
  );

  await page
    .getByRole("combobox", { name: "Network", exact: true })
    .selectOption("bnb");
  await count(25);
  await page
    .getByRole("button", { name: "Received from sales", exact: true })
    .click();
  await page
    .getByText("No confirmed sales in this view.", { exact: true })
    .waitFor();
  account = recipient;
  await page.evaluate(
    (wallet) => window.activityFixtureAccountsChanged([wallet]),
    account
  );
  await count(25);
  await page.getByText(/30 sales in this view/).waitFor();
  await page.reload();
  await count(25);
  assert.match(page.url(), /view=received/);
  assert.match(page.url(), /chain=bnb/);
  assert.equal(
    await records
      .first()
      .getByText(/Received from sale ·/)
      .count(),
    1
  );
  pass(
    "Wallet and role changes isolate activity, preserve URL filters and identify NFT receipt without inventing a payer"
  );

  // Connected wallets expose more header controls than the public catalog.
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      ),
      `Connected activity overflows at ${width}px`
    );
  }
  await records.first().scrollIntoViewIfNeeded();
  await records.first().getByText("Payment details", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await records
    .first()
    .getByText(/Seller proceeds:/)
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({ path: values.screenshot });
  pass(
    "Connected activity fits desktop, tablet and phone widths, and payment details are keyboard operable"
  );

  await page.setViewportSize({ width: 1280, height: 960 });
  failNext = true;
  await page
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await page
    .getByText(
      "More activity could not be loaded. Previously recorded sales are still shown.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await records.count(), 25);
  failNext = false;
  await page
    .getByRole("button", { name: "Retry activity", exact: true })
    .click();
  await count(25);
  reorg = true;
  await page
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await page
    .getByText(
      "This activity view changed or could not be verified. Refresh before viewing these sales.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await records.count(), 0);
  reorg = false;
  await page
    .getByRole("button", { name: "Retry activity", exact: true })
    .click();
  await count(25);
  pass(
    "Temporary later-page outages preserve dated records; an invalidated snapshot removes every confirmed row until refresh"
  );

  changedCheckpoint = true;
  await page
    .getByRole("button", { name: "Load more activity", exact: true })
    .click();
  await page
    .getByText(
      "This activity view changed or could not be verified. Refresh before viewing these sales.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await records.count(), 0);
  changedCheckpoint = false;
  partial = true;
  await page
    .getByRole("button", { name: "Retry activity", exact: true })
    .click();
  await count(25);
  await page.getByText(/Partial history/).waitFor();
  await page.getByText(/Some activity may be missing: BNB Chain/).waitFor();
  const coverage = page.getByRole("list", { name: "Sale history coverage" });
  await coverage.getByText(/Orders recorded by Yunipals since/).waitFor();
  await coverage
    .getByText(/2 events could not be classified as individual sales/)
    .waitFor();
  pass(
    "Checkpoint drift invalidates the view; partial history shows source, start and unclassified-event coverage"
  );

  partial = false;
  await page.goto(`${app.origin}/collection/bnb/${template.asset.tokenId}`);
  await count(25);
  await page
    .getByRole("heading", { name: "Transfer history", exact: true })
    .waitFor();
  await page
    .getByText("No transfers have been indexed for this lifecycle.", {
      exact: true
    })
    .waitFor();
  await page
    .getByText(/Recorded sales for this token ID, including earlier lifecycles/)
    .waitFor();
  pass(
    "Token activity keeps historical sales distinct from the current lifecycle's transfer history"
  );

  wrongAsset = true;
  await page
    .getByRole("button", { name: "Refresh activity", exact: true })
    .click();
  await page
    .getByText(
      "This activity view changed or could not be verified. Refresh before viewing these sales.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await records.count(), 0);
  wrongAsset = false;
  unavailable = true;
  await page
    .getByRole("button", { name: "Retry activity", exact: true })
    .click();
  await page
    .getByText(
      "Sale history could not be loaded. Transfer history does not establish a sale price.",
      { exact: true }
    )
    .waitFor();
  assert.equal(
    await page
      .getByText("No confirmed sales in this view.", { exact: true })
      .count(),
    0
  );
  pass(
    "Foreign NFT responses and unavailable history never become an empty sales claim or inferred transfer price"
  );

  unavailable = false;
  invalidIdentity = true;
  const beforeInvalid = requests.length;
  await page.reload();
  await page
    .getByText(
      "Sale history is unavailable because the NFT or wallet identity could not be verified.",
      { exact: true }
    )
    .waitFor();
  assert.equal(requests.length, beforeInvalid);
  invalidIdentity = false;
  await page.goto(
    `${app.origin}/collection/polygon/${reports.polygon.saleObservations[3].asset.tokenId}`
  );
  await count(1);
  await records.first().getByText(/WETH/, { exact: false }).first().waitFor();
  assert.ok((await links())[0].startsWith("https://polygonscan.com/tx/"));
  pass(
    "Malformed token identities fail locally and Polygon activity retains WETH with the matching explorer"
  );
  assert.deepEqual(pageErrors, []);
  assert.equal(
    walletMethods.some((method) =>
      /sign|send|switch|addEthereum/i.test(method)
    ),
    false
  );
  report.status = "passed";
  report.requestCount = requests.length;
  report.walletMethods = [...new Set(walletMethods)];
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  if (page) {
    report.pageUrl = page.url();
    report.pageText = await page
      .locator("main")
      .innerText()
      .catch(() => "");
    await page.screenshot({ path: values.screenshot }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`);
}
