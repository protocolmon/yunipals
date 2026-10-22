import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
const { values } = parseArgs({
  options: {
    playwright: { type: "string" },
    chromium: { type: "string" },
    rpc: { type: "string", default: "http://127.0.0.1:8561" },
    url: { type: "string", default: "http://127.0.0.1:5193/deploy/" }
  }
});
assert.ok(["127.0.0.1", "localhost"].includes(new URL(values.rpc).hostname));
assert.ok(["127.0.0.1", "localhost"].includes(new URL(values.url).hostname));
const plan = JSON.parse(
  await readFile(
    new URL(
      "../../../../docs/boosters/mainnet-smoke/deployment.unsigned.json",
      import.meta.url
    ),
    "utf8"
  )
);
const client = createPublicClient({ chain: base, transport: http(values.rpc) });
assert.match(await client.request({ method: "web3_clientVersion" }), /^anvil/i);
const snapshot = await client.request({ method: "evm_snapshot" });
// The local node chooses its own test transaction fee defaults.
await client.request({
  method: "anvil_setBalance",
  params: [plan.admin, "0xde0b6b3a7640000"]
});
await client.request({
  method: "anvil_impersonateAccount",
  params: [plan.admin]
});
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  acceptDownloads: true
});
let forwardedWrites = 0;
const checks = [],
  errors = [];
const receipts = [];
await context.route("https://mainnet.base.org/**", async (route) => {
  const body = route.request().postDataJSON();
  const batch = Array.isArray(body) ? body : [body];
  for (const request of batch) {
    if (
      ["eth_sendTransaction", "eth_sendRawTransaction"].includes(request.method)
    ) {
      assert.equal(request.method, "eth_sendTransaction");
      const tx = request.params[0],
        expected = plan.transactions[forwardedWrites];
      assert.ok(expected);
      assert.equal(tx.from.toLowerCase(), plan.admin.toLowerCase());
      assert.equal(tx.to, undefined);
      assert.equal(tx.data, expected.unsigned.data);
      assert.equal(BigInt(tx.nonce), BigInt(expected.unsigned.nonce));
      forwardedWrites++;
    }
  }
  const response = await fetch(values.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.text();
  await route.fulfill({
    status: 200,
    body: result,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }
  });
});
await context.addInitScript(
  ({ admin }) => {
    window.testWallet = { account: admin, chain: "0x2105", rejectNext: false };
    window.ethereum = {
      request: async ({ method, params }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return [window.testWallet.account];
        if (method === "eth_chainId") return window.testWallet.chain;
        if (method === "wallet_switchEthereumChain") {
          window.testWallet.chain = params[0].chainId;
          return null;
        }
        if (method === "eth_sendTransaction" && window.testWallet.rejectNext) {
          window.testWallet.rejectNext = false;
          throw Object.assign(new Error("User rejected request"), {
            code: 4001
          });
        }
        const response = await fetch("https://mainnet.base.org/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method,
            params: params ?? []
          })
        });
        const result = await response.json();
        if (result.error)
          throw Object.assign(new Error(result.error.message), {
            code: result.error.code
          });
        return result.result;
      }
    };
  },
  { admin: plan.admin }
);
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(e.message));
async function connected() {
  await page
    .getByRole("button", {
      name: /Connect wallet|Wallet connected/,
      exact: true
    })
    .click();
  await page
    .getByRole("button", { name: /Deploy \d of 6/, exact: true })
    .waitFor();
}
try {
  await page.goto(values.url);
  await page.getByText("0 of 6 confirmed", { exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.getElementById("balance").textContent.includes("ETH")
  );
  assert.equal(forwardedWrites, 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Deploy 1 of 6", exact: true })
      .isDisabled(),
    true
  );
  checks.push("page load makes no wallet or transaction request");
  await page.evaluate(
    () =>
      (window.testWallet.account = "0x1111111111111111111111111111111111111111")
  );
  await connected();
  await page.getByRole("alert").filter({ hasText: "Select 0xB3883" }).waitFor();
  assert.equal(forwardedWrites, 0);
  checks.push("wrong wallet cannot deploy");
  await page.evaluate((admin) => {
    window.testWallet.account = admin;
    window.testWallet.chain = "0x1";
  }, plan.admin);
  await connected();
  assert.equal(await page.evaluate(() => window.testWallet.chain), "0x2105");
  checks.push("wallet network switches to Base before signing");
  await page.evaluate(() => (window.testWallet.rejectNext = true));
  await page
    .getByRole("button", { name: "Deploy 1 of 6", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: /rejected|denied/i })
    .waitFor();
  assert.equal(forwardedWrites, 0);
  checks.push("wallet rejection preserves the unsigned next deployment");
  for (let i = 0; i < 6; i++) {
    await page
      .getByRole("button", { name: `Deploy ${i + 1} of 6`, exact: true })
      .click();
    await page.getByText(`${i + 1} of 6 confirmed`, { exact: true }).waitFor();
    assert.equal(forwardedWrites, i + 1);
    if (i === 1) {
      await page.reload();
      await page.getByText("2 of 6 confirmed", { exact: true }).waitFor();
      await connected();
      checks.push(
        "reload resumes from verified onchain code after two deployments"
      );
    }
  }
  await page
    .getByRole("heading", { name: "Contracts are ready.", exact: true })
    .waitFor();
  checks.push(
    "six exact payloads create expected code and verified admin/config/pause/upgrade roles and dependencies"
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download deployment record", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs("/tmp/yunipals-mainnet-wallet-test-record.json");
  const record = JSON.parse(
    await readFile("/tmp/yunipals-mainnet-wallet-test-record.json", "utf8")
  );
  assert.equal(record.verified, true);
  assert.equal(Object.keys(record.transactionHashes).length, 6);
  for (const hash of Object.values(record.transactionHashes)) {
    const receipt = await client.getTransactionReceipt({ hash });
    receipts.push({
      transactionHash: hash,
      gasUsed: String(receipt.gasUsed),
      contractAddress: receipt.contractAddress
    });
  }
  await page.screenshot({
    path: "/tmp/yunipals-booster-wallet-deployment.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  assert.deepEqual(errors, []);
  checks.push("receipt download, mobile layout and no browser exceptions");
  await writeFile(
    "/tmp/yunipals-booster-wallet-signing-test.json",
    JSON.stringify(
      {
        status: "passed",
        mainnetBroadcast: false,
        localForkOnly: true,
        simulatedBalanceOverride: true,
        checks,
        receipts,
        consoleErrors: errors
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        mainnetBroadcast: false,
        checks,
        consoleErrors: errors
      },
      null,
      2
    )
  );
} catch (e) {
  console.error(await page.locator("body").innerText());
  await page.screenshot({
    path: "/tmp/yunipals-booster-wallet-failure.png",
    fullPage: true
  });
  throw e;
} finally {
  await browser.close();
  await client.request({ method: "evm_revert", params: [snapshot] });
}
