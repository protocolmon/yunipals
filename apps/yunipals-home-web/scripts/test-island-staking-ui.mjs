import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";
const app = process.env.ISLAND_UI_URL ?? "http://127.0.0.1:5188";
const api = process.env.ISLAND_FIXTURE_API ?? "http://127.0.0.1:18548";
const fork = process.env.ISLAND_FORK_URL ?? "http://127.0.0.1:18547";
for (const value of [app, api, fork])
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(value).hostname));
if (!process.env.PLAYWRIGHT_MODULE)
  throw new Error("Set PLAYWRIGHT_MODULE to a local Playwright module");
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const rpcClient = createPublicClient({ transport: http(fork) });
const rpc = (method, params = []) => rpcClient.request({ method, params });
assert.match(await rpc("web3_clientVersion"), /^anvil\//i);
const snapshot = await rpc("evm_snapshot");
const account = "0x4d294954a76747b34e1087cfe8e9d5fe24f8c0f6";
await rpc("anvil_impersonateAccount", [account]);
await rpc("anvil_setBalance", [account, "0x56bc75e2d63100000"]);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 }
});
let authorized = false,
  chain = "0x38",
  sends = 0,
  rejectNext = true;
let holdReceipts = true;
const errors = [];
await context.exposeBinding("islandWalletRpc", async (_, r) => {
  console.log("Fixture wallet:", r.method);
  if (r.method === "eth_accounts") return authorized ? [account] : [];
  if (r.method === "eth_requestAccounts") {
    authorized = true;
    return [account];
  }
  if (r.method === "eth_chainId") return chain;
  if (
    r.method === "wallet_getPermissions" ||
    r.method === "wallet_requestPermissions"
  ) {
    authorized = true;
    return [{ parentCapability: "eth_accounts" }];
  }
  if (r.method === "wallet_switchEthereumChain") {
    assert.equal(r.params[0].chainId, "0x1");
    chain = "0x1";
    return null;
  }
  if (r.method === "eth_sendTransaction") {
    assert.equal(r.params[0].from.toLowerCase(), account);
    assert.equal(
      r.params[0].to.toLowerCase(),
      "0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8"
    );
    if (rejectNext) {
      rejectNext = false;
      return { rejected: true };
    }
    sends++;
    return rpc(r.method, r.params);
  }
  if (!r.method.startsWith("eth_") || /send|sign/i.test(r.method))
    throw new Error("Unsupported wallet method");
  return rpc(r.method, r.params);
});
await context.addInitScript(() => {
  const listeners = new Map();
  const provider = {
    isMetaMask: true,
    isConnected: () => true,
    request: async (r) => {
      const result = await window.islandWalletRpc(r);
      if (result?.rejected)
        throw Object.assign(new Error("User rejected request"), { code: 4001 });
      if (r.method === "wallet_switchEthereumChain")
        for (const cb of listeners.get("chainChanged") ?? [])
          cb(r.params[0].chainId);
      return result;
    },
    on: (e, cb) => listeners.set(e, [...(listeners.get(e) ?? []), cb]),
    removeListener: (e, cb) =>
      listeners.set(
        e,
        (listeners.get(e) ?? []).filter((x) => x !== cb)
      )
  };
  window.ethereum = provider;
  const detail = {
    provider,
    info: {
      uuid: "822dcac7-d78c-4b28-a1dc-f1c53d0e2cc9",
      name: "Island test wallet",
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      rdns: "io.island.test"
    }
  };
  window.addEventListener("eip6963:requestProvider", () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail })
    )
  );
});
for (const host of [
  "https://ethereum-rpc.publicnode.com/**",
  "https://eth.drpc.org/**",
  "https://bsc-rpc.publicnode.com/**",
  "https://bsc-dataseed-public.bnbchain.org/**"
])
  await context.route(host, async (route) => {
    const body = route.request().postDataJSON();
    const call = async (item) => {
      try {
        return {
          jsonrpc: "2.0",
          id: item.id,
          result:
            item.method === "eth_getTransactionReceipt" &&
            sends > 0 &&
            holdReceipts
              ? null
              : await rpc(item.method, item.params ?? [])
        };
      } catch {
        return {
          jsonrpc: "2.0",
          id: item.id,
          error: { code: -32000, message: "Fork call reverted" }
        };
      }
    };
    await route.fulfill({
      json: Array.isArray(body)
        ? await Promise.all(body.map(call))
        : await call(body)
    });
  });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(60_000);
const report = { tests: [], errors };
try {
  await fetch(`${api}/test/ready`, { method: "POST" });
  await page.goto(`${app}/collector/${account}?collection=islands`);
  await page.waitForFunction(
    () => document.querySelectorAll("main article").length === 2
  );
  await page
    .getByRole("group", { name: "Island holdings" })
    .getByRole("button", { name: "Staked", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("main article").length === 1
  );
  await page
    .getByRole("group", { name: "Island holdings" })
    .getByRole("button", { name: "In wallet", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("main article a")
      ?.getAttribute("href")
      ?.endsWith("/2")
  );
  report.tests.push(
    "Personal collection combines wallet and staked Islands; filters use the actual API and database"
  );
  await fetch(`${api}/test/stale`, { method: "POST" });
  await page
    .getByRole("group", { name: "Island holdings" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await page.reload();
  await page.getByText(/Staking verification is updating/).waitFor();
  report.tests.push("Unavailable verification stays visibly incomplete");
  await fetch(`${api}/test/ready`, { method: "POST" });
  await page.goto(`${app}/collection/ethereum-islands/1`);
  await page
    .getByRole("button", { name: "Connect staking wallet to unstake" })
    .click();
  await page.getByRole("button", { name: /Island test wallet/ }).click();
  await page.getByRole("button", { name: "Review unstake" }).waitFor();
  await page.getByRole("button", { name: "Review unstake" }).click();
  await page.getByText(/Estimated network fee:/).waitFor();
  await page.getByText(/also claims any remaining staking rewards/).waitFor();
  await page.screenshot({
    path: "/tmp/island-staking-review.png",
    fullPage: true
  });
  await page.getByRole("button", { name: "Confirm unstake" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: /rejected/i })
    .waitFor();
  assert.equal(sends, 0);
  assert.equal(chain, "0x1");
  report.tests.push(
    "Ethereum switch, gas estimate, reward disclosure and wallet rejection"
  );
  await page.getByRole("button", { name: "Review unstake" }).click();
  await page.getByRole("button", { name: "Confirm unstake" }).click();
  await page
    .getByRole("link", { name: "View transaction", exact: true })
    .waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Check confirmation" }).waitFor();
  holdReceipts = false;
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await page
    .getByText("Island returned to your wallet. Collection status is updating.")
    .waitFor();
  assert.equal(sends, 1);
  report.tests.push(
    "Reload recovers the pending transaction without sending a second withdrawal"
  );
  await fetch(`${api}/test/refresh`, { method: "POST" });
  await page.goto(
    `${app}/collector/${account}?collection=islands&holding=wallet`
  );
  await page.waitForFunction(
    () => document.querySelectorAll("main article").length === 2
  );
  report.tests.push(
    "Wallet-signed fork withdrawal confirmed; NFT remains in collection as In wallet"
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/island-staking-mobile.png",
    fullPage: true
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
  await writeFile(
    "/tmp/island-staking-ui-report.json",
    JSON.stringify(report, null, 2)
  );
} catch (error) {
  console.error(await page.locator("main").innerText());
  await page.screenshot({
    path: "/tmp/island-staking-ui-failure.png",
    fullPage: true
  });
  throw error;
} finally {
  await browser.close();
  await rpc("evm_revert", [snapshot]);
}
