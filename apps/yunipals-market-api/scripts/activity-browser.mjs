import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export async function createActivityBrowser({
  base,
  seller,
  buyer,
  nativeSale,
  wbnbSale
}) {
  const app = new URL(
    process.env.MARKET_TEST_BROWSER_URL ?? "http://127.0.0.1:5177"
  );
  const api = new URL(base);
  for (const url of [app, api])
    assert.ok(
      url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  assert.ok(
    process.env.MARKET_TEST_PLAYWRIGHT,
    "Set the local Playwright module path"
  );
  const { chromium } = await import(
    pathToFileURL(process.env.MARKET_TEST_PLAYWRIGHT).href
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.MARKET_TEST_CHROMIUM,
    args: ["--no-sandbox"]
  });
  const methods = [],
    requests = [],
    errors = [];
  let authorized = false,
    account = seller;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 960 }
    });
    await context.exposeBinding(
      "marketActivityReadWallet",
      async (_, request) => {
        methods.push(request.method);
        if (request.method === "eth_chainId") return "0x38";
        if (request.method === "eth_accounts")
          return authorized ? [account] : [];
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
        throw new Error(`Read-only fixture refuses ${request.method}`);
      }
    );
    await context.addInitScript(() => {
      const listeners = new Map();
      const provider = {
        isConnected: () => true,
        request: (request) => window.marketActivityReadWallet(request),
        on: (event, callback) =>
          listeners.set(event, [...(listeners.get(event) ?? []), callback]),
        removeListener: (event, callback) =>
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((item) => item !== callback)
          )
      };
      window.ethereum = provider;
      window.marketActivityAccounts = (accounts) => {
        for (const callback of listeners.get("accountsChanged") ?? [])
          callback(accounts);
      };
      const detail = {
        provider,
        info: {
          uuid: "018e97b9-2ca7-4dd2-a434-302339dd8b01",
          name: "Yunipals API read wallet",
          rdns: "test.yunipals.api.activity",
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
      if (url.origin === api.origin) {
        assert.ok(["GET", "OPTIONS"].includes(route.request().method()));
        requests.push({
          path: url.pathname,
          query: url.search,
          method: route.request().method()
        });
        return route.continue(); // Actual built HTTP API: no marketplace response fixtures.
      }
      if (url.origin === app.origin) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const records = page
      .getByRole("list", { name: "Confirmed sale records", exact: true })
      .locator(":scope > li");
    async function hashes(expected) {
      const until = Date.now() + 12000;
      while (Date.now() < until) {
        const links = await records
          .getByRole("link", { name: "View transaction", exact: true })
          .evaluateAll((items) =>
            items.map((item) => item.getAttribute("href").split("/").pop())
          );
        if (
          JSON.stringify([...links].sort()) ===
          JSON.stringify([...expected].sort())
        )
          return;
        await delay(100);
      }
      throw new Error(
        `Activity UI did not display the expected actual sale receipts: ${(await page.locator("main").innerText()).slice(0, 1500)}`
      );
    }
    await page.goto(`${app.origin}/orders/activity?chain=bnb&view=all`);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByText("Yunipals API read wallet", { exact: true })
      .last()
      .click();
    await hashes([nativeSale.transactionHash, wbnbSale.transactionHash]);
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await hashes([nativeSale.transactionHash]);
    await page
      .getByRole("button", { name: "Received from sales", exact: true })
      .click();
    await hashes([wbnbSale.transactionHash]);
    account = buyer;
    await page.evaluate(
      (value) => window.marketActivityAccounts([value]),
      buyer
    );
    await hashes([nativeSale.transactionHash]);
    await page.getByRole("button", { name: "Sales", exact: true }).click();
    await hashes([wbnbSale.transactionHash]);
    account = seller;
    await page.evaluate(
      (value) => window.marketActivityAccounts([value]),
      seller
    );
    await page
      .getByRole("button", { name: "All activity", exact: true })
      .click();
    await hashes([nativeSale.transactionHash, wbnbSale.transactionHash]);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1
      ),
      "Mobile activity fits the viewport"
    );
    await page.screenshot({
      path:
        process.env.MARKET_TEST_BROWSER_SCREENSHOT ??
        "/tmp/yunipals-activity-api-mobile.png",
      fullPage: true
    });
    return {
      async afterReorg() {
        await page
          .getByRole("button", { name: "Refresh activity", exact: true })
          .click();
        await hashes([nativeSale.transactionHash]);
        assert.equal(
          await records.getByText("Confirmed", { exact: true }).count(),
          1
        );
      },
      async afterReplay(sale) {
        // Initial API views may reuse a snapshot for five seconds. Wait for a
        // fresh real response before exercising the user's refresh action.
        const until = Date.now() + 12000;
        let visible = false;
        while (Date.now() < until) {
          const response = await fetch(
            `${base}/v1/market/wallets/${seller}/activity?chain=bnb&view=all`
          );
          if (response.ok)
            visible = (await response.json()).items.some(
              (item) => item.sale.eventId === sale.eventId
            );
          if (visible) break;
          await delay(200);
        }
        assert.ok(
          visible,
          "Replayed observation becomes available through the actual API"
        );
        await page
          .getByRole("button", { name: "Refresh activity", exact: true })
          .click();
        await hashes([nativeSale.transactionHash, sale.transactionHash]);
        assert.deepEqual(errors, []);
        assert.ok(
          requests.some((request) => request.path.endsWith("/activity"))
        );
        assert.ok(
          methods.every(
            (method) =>
              !method.includes("sign") && !method.includes("sendTransaction")
          )
        );
        return {
          scope:
            "Chromium through the actual built API and PostgreSQL with actual fork receipts; simulated read-only wallet identity, not a real wallet connector certification.",
          checks: [
            "native and WBNB receipts",
            "seller and NFT-recipient filters",
            "account switch",
            "mobile width",
            "orphaned sale removed after refresh",
            "replayed sale restored"
          ],
          requests,
          walletMethods: methods,
          pageErrors: errors
        };
      },
      close: () => browser.close()
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
