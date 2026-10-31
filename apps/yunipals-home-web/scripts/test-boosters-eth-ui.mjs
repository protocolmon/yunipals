// Local fork only: no browser wallet request is routed to public Base.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
const { values } = parseArgs({
  options: {
    url: { type: "string" },
    manifest: { type: "string" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    report: { type: "string", default: "/tmp/yunipals-eth-browser.json" }
  }
});
if (!values.url || !values.manifest || !values.playwright || !values.chromium)
  throw new Error("Provide --url, --manifest, --playwright and --chromium.");
const { chromium } = await import(pathToFileURL(values.playwright).href);
const f = JSON.parse(await readFile(values.manifest, "utf8"));
const origin = values.url;
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
assert(["127.0.0.1", "localhost"].includes(new URL(f.rpc).hostname));
const forkCheck = await fetch(f.rpc, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "anvil_nodeInfo",
    params: []
  })
}).then((response) => response.json());
assert(forkCheck.result?.forkConfig, "Disposable Anvil fork required");
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const c = await browser.newContext({
  viewport: { width: 1360, height: 1050 },
  serviceWorkers: "block"
});
await c.route("**/*", async (route) => {
  const r = route.request(),
    u = new URL(r.url());
  if (
    ["https://base-rpc.publicnode.com", "https://base.drpc.org"].includes(
      u.origin
    )
  ) {
    const response = await route.fetch({ url: f.rpc });
    return route.fulfill({ response });
  }
  if (
    u.origin === origin ||
    u.origin === f.rpc ||
    u.origin === "https://api.yunipals.com"
  )
    return route.continue();
  return route.abort("blockedbyclient");
});
await c.routeWebSocket("**/*", (s) => s.close());
await c.addInitScript(
  ({ account, rpc }) => {
    const listeners = new Map();
    let connected = localStorage.getItem("eth-test-connected") === "true";
    window.__ethTest = { sends: [], signatures: 0, cancelNext: false };
    window.ethereum = {
      isMetaMask: true,
      isConnected: () => true,
      on: (n, h) => listeners.set(n, [...(listeners.get(n) || []), h]),
      removeListener: (n, h) =>
        listeners.set(
          n,
          (listeners.get(n) || []).filter((x) => x !== h)
        ),
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return connected ? [account] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          localStorage.setItem("eth-test-connected", "true");
          for (const h of listeners.get("accountsChanged") || []) h([account]);
          return [account];
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
        if (
          ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(
            method
          )
        )
          return null;
        if (method.includes("sign") || method === "personal_sign") {
          window.__ethTest.signatures++;
          throw new Error("Unexpected signature");
        }
        if (method === "eth_sendTransaction") {
          if (window.__ethTest.cancelNext) {
            window.__ethTest.cancelNext = false;
            throw Object.assign(new Error("User rejected request"), {
              code: 4001
            });
          }
          window.__ethTest.sends.push(params[0]);
        }
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params: params || []
          })
        });
        const data = await res.json();
        if (data.error)
          throw Object.assign(new Error(data.error.message), {
            code: data.error.code
          });
        return data.result;
      }
    };
    const detail = {
      info: {
        uuid: "d745aab6-650f-4f87-9642-c99e3d126027",
        name: "ETH checkout test wallet",
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="purple"/></svg>',
        rdns: "test.yunipals.eth"
      },
      provider: window.ethereum
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", { detail })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  },
  { account: f.account, rpc: f.rpc }
);
const p = await c.newPage();
p.setDefaultTimeout(35000);
const report = { checks: [], errors: [], passed: false };
p.on("pageerror", (e) => report.errors.push(e.message));
try {
  await p.goto(origin + "/boosters", { waitUntil: "domcontentloaded" });
  const decline = p.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  await p
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await p
    .getByRole("button", {
      name: /ETH checkout test wallet|Browser Wallet|MetaMask/
    })
    .first()
    .click();
  await p.goto(origin + "/boosters", { waitUntil: "domcontentloaded" });
  await p
    .locator("label")
    .filter({ has: p.getByRole("radio", { name: "ETH", exact: true }) })
    .click();
  await p.getByRole("button", { name: "Choose 3 packs", exact: true }).click();
  await p.getByRole("button", { name: "Open 3 packs", exact: true }).click();
  const d = p.getByRole("dialog", { name: "Review transaction", exact: true });
  await d.waitFor();
  await d.getByText("Estimated ETH pack price", { exact: true }).waitFor();
  await d.getByText("Conversion details", { exact: true }).click();
  assert((await d.innerText()).includes("0.5%"));
  assert.equal(
    await d.getByText("Your YPAL balance", { exact: true }).count(),
    0
  );
  report.checks.push(
    "ETH price, gas and bounded conversion shown without YPAL approval"
  );
  await p.screenshot({ path: "/tmp/yunipals-eth-review.png" });
  await p.evaluate(() => (window.__ethTest.cancelNext = true));
  await d.getByRole("button", { name: "Confirm", exact: true }).click();
  await d
    .getByText("Transaction cancelled in your wallet.", { exact: true })
    .waitFor();
  report.checks.push("Wallet cancellation leaves a recoverable review");
  await d.getByRole("button", { name: "Confirm", exact: true }).click();
  await p
    .getByText(
      /Waiting for randomness|Waiting for the random draw|Waiting for Chainlink|Getting your pack|Transaction confirmed/
    )
    .first()
    .waitFor();
  const wallet = await p.evaluate(() => window.__ethTest);
  assert.equal(wallet.sends.length, 1);
  assert.equal(wallet.signatures, 0);
  assert.equal(wallet.sends[0].to.toLowerCase(), f.adapter);
  report.checks.push(
    "One local transaction, zero approval signatures, immediate opening progress"
  );
  await p.screenshot({ path: "/tmp/yunipals-eth-submitted.png" });
  await p.reload({ waitUntil: "domcontentloaded" });
  const stored = await p.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("yunipals/boosters/v1/")
    )
  );
  assert(stored.some(([, value]) => value.includes('"kind":"open"')));
  report.checks.push("Opening transaction persisted across reload");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.getByRole("radio", { name: "ETH", exact: true }).waitFor();
  assert(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  report.checks.push("Mobile checkout fits viewport");
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.failure = e.stack;
  await p.screenshot({ path: "/tmp/yunipals-eth-browser-failure.png" });
  console.log((await p.locator("body").innerText()).slice(-3500));
} finally {
  await writeFile(values.report, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report));
process.exitCode = report.passed ? 0 : 1;
