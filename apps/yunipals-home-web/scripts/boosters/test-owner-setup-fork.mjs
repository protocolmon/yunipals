// The exact production static UI + frozen setup bundle, with all Base writes
// intercepted to a loopback fork. Public artwork checks remain HTTPS reads.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http
} from "viem";
import { base } from "viem/chains";
import { packRegistryAbi } from "../../../../packages/yunipals-market-core/src/boosterAbi.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5190" },
    fork: { type: "string", default: "http://127.0.0.1:8561" },
    kind: { type: "string", default: "smoke" },
    report: { type: "string" },
    artifact: {
      type: "string",
      default: "/tmp/yunipals-collection-booster-live-20261022-v2"
    },
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
assert(["smoke", "standard"].includes(values.kind));
const standard = values.kind === "standard";
const setupRoute = "/boosters/setup" + (standard ? "/standard" : "");
const setupHeading = standard
  ? "Unlimited public pack"
  : "One-pack mainnet test";
const typeId = standard ? "2" : "1";
const reportPath =
  values.report ?? `/tmp/yunipals-${values.kind}-setup-static-fork-report.json`;
assert(reportPath.startsWith("/tmp/yunipals-"));
for (const url of [values.url, values.fork])
  assert(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const releaseBytes = await readFile(values.artifact + "/RELEASE-MANIFEST.json");
const release = JSON.parse(releaseBytes);
assert.equal(release.collectionOnly, true);
assert.equal(release.marketplaceEnabled, false);
assert.equal(release.arenaEnabled, false);
const servedIndex = await (await fetch(values.url)).text();
assert.equal(
  servedIndex,
  await readFile(values.artifact + "/index.html", "utf8")
);
const bundle = JSON.parse(
  await readFile(
    new URL(
      `../../public/boosters/mainnet-${values.kind}-setup.json`,
      import.meta.url
    )
  )
);
const client = createPublicClient({
  chain: base,
  transport: http(values.fork)
});
assert.equal(await client.getChainId(), 8453);
assert.equal(await client.getBlockNumber(), 52945979n);
// Anvil suggests a fixed 1 gwei tip even with --gas-price on a fork. Read
// Base's real public tip, so fee estimation uses the actual network policy
// without changing the forked wallet balance or any production state.
const feeQuoteResponse = await fetch("https://mainnet.base.org", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_maxPriorityFeePerGas",
    params: []
  })
});
assert.equal(feeQuoteResponse.status, 200);
const feeQuote = await feeQuoteResponse.json();
assert.match(feeQuote.result, /^0x[0-9a-f]+$/i);
assert(BigInt(feeQuote.result) <= 100000000n);
const snapshot = await client.request({ method: "evm_snapshot" });
await client.request({
  method: "anvil_impersonateAccount",
  params: [bundle.admin]
});
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1360, height: 1000 }
});
const errors = [],
  failures = [],
  badAssets = [],
  fonts = [],
  interceptedRpc = [];
await context.route(
  /^https:\/\/(?:base-rpc\.publicnode\.com|base\.drpc\.org)\/?$/,
  async (route) => {
    const payload = route.request().postData();
    assert(payload, "Base RPC must remain JSON POST");
    const requests = JSON.parse(payload);
    interceptedRpc.push(requests);
    const response = await fetch(values.fork, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    });
    const replies = await response.json();
    const tipRequests = (Array.isArray(requests) ? requests : [requests])
      .filter((request) => request.method === "eth_maxPriorityFeePerGas")
      .map((request) => request.id);
    for (const reply of Array.isArray(replies) ? replies : [replies])
      if (tipRequests.includes(reply.id)) reply.result = feeQuote.result;
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(replies)
    });
  }
);
await context.addInitScript(
  ({ owner, rpc }) => {
    let connected = false;
    const listeners = new Map();
    window.ethereum = {
      isMetaMask: true,
      isConnected: () => true,
      on: (name, handler) =>
        listeners.set(name, [...(listeners.get(name) ?? []), handler]),
      removeListener: (name, handler) =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((entry) => entry !== handler)
        ),
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return connected ? [owner] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          for (const handler of listeners.get("accountsChanged") ?? [])
            handler([owner]);
          return [owner];
        }
        if (
          method === "wallet_requestPermissions" ||
          method === "wallet_getPermissions"
        )
          return [{ parentCapability: "eth_accounts" }];
        if (method === "wallet_getCapabilities") return {};
        if (
          method === "wallet_switchEthereumChain" ||
          method === "wallet_addEthereumChain"
        )
          return null;
        const response = await fetch(rpc, {
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
  { owner: bundle.admin, rpc: values.fork }
);
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on("pageerror", (error) => errors.push(error.message));
page.on("requestfailed", (request) =>
  failures.push({ url: request.url(), error: request.failure()?.errorText })
);
page.on("response", (response) => {
  const type = response.request().resourceType();
  if (
    ["image", "font", "stylesheet", "script"].includes(type) &&
    response.status() >= 400
  )
    badAssets.push({ url: response.url(), status: response.status() });
  if (type === "font")
    fonts.push({ url: response.url(), status: response.status() });
});
const report = {
  kind: values.kind,
  story:
    "Frozen production setup → approved owner → configure draft → reload → activate exact type",
  checks: []
};
async function connectOwner() {
  const connect = page.getByRole("button", {
    name: "Connect owner wallet",
    exact: true
  });
  if (await connect.count()) {
    await connect.click();
    await page
      .getByRole("button", { name: /MetaMask|Browser Wallet|Injected/i })
      .first()
      .click();
  }
}
let smokeBefore = null;
try {
  await page.goto(values.url + setupRoute);
  await page
    .getByRole("heading", { name: setupHeading, exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review configuration", exact: true })
      .count(),
    0
  );
  await connectOwner();
  if (standard) {
    await page
      .getByText(
        "Complete the capped mainnet smoke test before configuring the public pack.",
        { exact: true }
      )
      .waitFor();
    assert(
      await page
        .getByRole("button", { name: "Review configuration", exact: true })
        .isDisabled()
    );
    report.checks.push(
      "public pack configuration is disabled at actual registry count0; no premature draft can be prepared"
    );
    // Seed the actual reviewed smoke predecessor only on the loopback fork.
    const smoke = JSON.parse(
      await readFile(
        new URL(
          "../../public/boosters/mainnet-smoke-setup.json",
          import.meta.url
        )
      )
    );
    const localWallet = createWalletClient({
      account: bundle.admin,
      chain: base,
      transport: http(values.fork)
    });
    const fees = {
      maxFeePerGas:
        (await client.getBlock()).baseFeePerGas * 2n + BigInt(feeQuote.result),
      maxPriorityFeePerGas: BigInt(feeQuote.result)
    };
    for (const data of [
      smoke.configureData,
      encodeFunctionData({
        abi: packRegistryAbi,
        functionName: "activate",
        args: [1n]
      })
    ]) {
      const tx = await localWallet.sendTransaction({
        to: smoke.registry,
        data,
        value: 0n,
        gas: 1500000n,
        ...fees
      });
      assert.equal(
        (await client.waitForTransactionReceipt({ hash: tx })).status,
        "success"
      );
    }
    smokeBefore = await client.readContract({
      address: bundle.registry,
      abi: packRegistryAbi,
      functionName: "getPack",
      args: [1n]
    });
    assert.equal(smokeBefore.active, true);
    assert.equal(smokeBefore.rules.supplyCap, 1n);
    await page.reload();
    await page
      .getByRole("heading", { name: setupHeading, exact: true })
      .waitFor();
    await connectOwner();
  }
  await page
    .getByRole("button", { name: "Review configuration", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: standard
        ? "Configure the unlimited public pack"
        : "Configure the capped test pack",
      exact: true
    })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review activation", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Configured type ID (restore after a refresh)")
      .inputValue(),
    typeId
  );
  report.checks.push(
    "frozen bundle checksum, actual published artwork and owner CONFIG_ROLE verified; exact configure transaction mined only in local Base fork"
  );
  await page.reload();
  // The synthetic wallet starts disconnected after reload; reconnect explicitly.
  await page
    .getByRole("heading", { name: setupHeading, exact: true })
    .waitFor();
  await connectOwner();
  await page
    .getByRole("button", { name: "Review activation", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review configuration", exact: true })
      .count(),
    0
  );
  report.checks.push(
    "refresh restores confirmed type ID and prevents duplicate configuration"
  );
  await page
    .getByRole("button", { name: "Review activation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: `Activate type #${typeId}`, exact: true })
    .waitFor();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await page
    .getByText(`Type #${typeId} is active.`, { exact: false })
    .first()
    .waitFor();
  const pack = await client.readContract({
    address: bundle.registry,
    abi: packRegistryAbi,
    functionName: "getPack",
    args: [BigInt(typeId)]
  });
  assert.equal(pack.active, true);
  assert.equal(pack.rules.price, 10n ** 18n);
  assert.equal(pack.rules.intervalSeconds, 86400n);
  assert.equal(pack.rules.supplyCap, standard ? 0n : 1n);
  assert.equal(pack.rules.mintsPerInterval, 1);
  assert.equal(pack.totalVariants, 264);
  assert.equal(pack.catalogHash, bundle.catalogHash);
  report.checks.push(
    `actual full onchain rules/catalog verified before activation; ${standard ? "unlimited cap0" : "cap1"},1PROTO,24h,264variants confirmed after local fork activation`
  );
  if (standard) {
    assert.deepEqual(
      await client.readContract({
        address: bundle.registry,
        abi: packRegistryAbi,
        functionName: "getPack",
        args: [1n]
      }),
      smokeBefore
    );
    report.checks.push(
      "the original capped smoke type is unchanged by public pack configuration and activation"
    );
  }
  await page.screenshot({
    path: `/tmp/yunipals-${values.kind}-owner-setup-final-static.png`,
    fullPage: true
  });
  await page.goto(values.url + "/collection");
  await page
    .getByRole("heading", { name: "Yunipal booster packs", exact: true })
    .waitFor();
  await page.waitForFunction(() =>
    [...document.images].some(
      (img) =>
        img.src.includes("yunipals-logo") &&
        img.complete &&
        img.naturalWidth > 0
    )
  );
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('16px "Inter"')));
  assert(
    await page.evaluate(() => document.fonts.check('16px "Archivo Black"'))
  );
  assert(fonts.length > 0, "the real production typography must load");
  assert.equal(
    await page.getByRole("link", { name: "Race lab", exact: true }).count(),
    0
  );
  assert.equal(
    await page.getByRole("link", { name: "My orders", exact: true }).count(),
    0
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(badAssets, []);
  report.checks.push(
    "exact production artifact serves collection SPA, real logo and disabled deferred navigation without runtime errors"
  );
  Object.assign(report, {
    interceptedRpcRequests: interceptedRpc.length,
    errors,
    badAssets,
    failures,
    fonts,
    productionArtifact: values.artifact,
    releaseManifestSha256: createHash("sha256")
      .update(releaseBytes)
      .digest("hex"),
    priorityFee: {
      source: "https://mainnet.base.org eth_maxPriorityFeePerGas",
      wei: BigInt(feeQuote.result).toString(),
      reason: "Anvil otherwise suggests a fixed 1 gwei tip on forks"
    },
    mainnetBroadcasts: 0,
    forkBlock: "52945979"
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: `/tmp/yunipals-${values.kind}-owner-setup-failed.png`,
    fullPage: true
  });
  console.error(
    JSON.stringify({
      text: await page.locator("body").innerText(),
      errors,
      failures,
      badAssets
    })
  );
  throw error;
} finally {
  await browser.close();
  await client.request({ method: "evm_revert", params: [snapshot] });
  await client.request({
    method: "anvil_stopImpersonatingAccount",
    params: [bundle.admin]
  });
}
