import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  padHex,
  parseAbi,
  parseAbiParameters
} from "viem";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5197" },
    playwright: { type: "string" },
    chromium: { type: "string" }
  }
});
if (!values.playwright)
  throw new Error("Pass the installed Playwright module path.");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(values.url).hostname));
const root = new URL("../", import.meta.url);
const p = JSON.parse(
  await readFile(
    new URL("public/boosters/engine-batch-upgrade-v1.json", root),
    "utf8"
  )
);
const old = JSON.parse(
  await readFile(
    new URL(
      "../../../contracts/boosters/test/fixtures/BoosterPacks.pre-batch.json",
      import.meta.url
    ),
    "utf8"
  )
);
const oldRefs = JSON.parse(
  await readFile(
    new URL(
      "../../../contracts/boosters/test/fixtures/BoosterPacks.pre-batch.immutable-references.json",
      import.meta.url
    ),
    "utf8"
  )
);
const engineReads = parseAbi([
  "function registry() view returns(address)",
  "function monsters() view returns(address)",
  "function wrapper() view returns(address)",
  "function MAX_OPEN_PACKS() view returns(uint32)"
]);
const proxy = JSON.parse(
  await readFile(
    new URL(
      "../../../contracts/boosters/out-batch/ERC1967Proxy.sol/ERC1967Proxy.json",
      import.meta.url
    ),
    "utf8"
  )
);
const implementation = "0x1111111111111111111111111111111111111111";
const badImplementation = "0x2222222222222222222222222222222222222222";
const blockHash = `0x${"ab".repeat(32)}`;
const deployHash = `0x${"cd".repeat(32)}`;
const upgradeHash = `0x${"ef".repeat(32)}`;
function patch(template, refs, address) {
  let code = template;
  for (const span of Object.values(refs).flat()) {
    const start = 2 + span.start * 2;
    code =
      code.slice(0, start) +
      padHex(address.toLowerCase(), { size: 32 }).slice(2) +
      code.slice(start + span.length * 2);
  }
  return code;
}
const oldCode = patch(
  old.runtimeBytecode,
  oldRefs.immutableReferences,
  p.currentImplementation.address
);
const newCode = patch(
  p.candidate.runtimeBytecodeTemplate,
  p.candidate.immutableReferences,
  implementation
);
assert.equal(keccak256(oldCode), p.currentImplementation.runtimeCodeKeccak256);
assert.equal(
  keccak256(proxy.deployedBytecode.object),
  p.proxyRuntimeCodeKeccak256
);
let deployed = false;
let upgraded = false;
const sends = [];
const unexpected = [];
const unhandledCalls = [];
let deferSimulation = false;
let simulationReached;
let releaseSimulation;
let deploymentReverted = false;
const block = {
  number: "0x64",
  hash: blockHash,
  parentHash: blockHash,
  timestamp: "0x6adabc00",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  baseFeePerGas: "0x3b9aca00",
  miner: implementation,
  difficulty: "0x0",
  totalDifficulty: "0x0",
  nonce: "0x0000000000000000",
  extraData: "0x",
  transactions: [],
  uncles: [],
  sha3Uncles: blockHash,
  logsBloom: `0x${"00".repeat(256)}`,
  receiptsRoot: blockHash,
  stateRoot: blockHash,
  transactionsRoot: blockHash,
  size: "0x1",
  mixHash: blockHash
};
function transaction(hash) {
  const upgrade = hash === upgradeHash;
  return {
    hash,
    from: p.owner,
    to: upgrade ? p.proxy : null,
    input: upgrade ? sends[1]?.data : p.candidate.creationBytecode,
    value: "0x0",
    blockHash,
    blockNumber: "0x64",
    transactionIndex: "0x0",
    nonce: upgrade ? "0x1" : "0x0",
    gas: "0x400000",
    gasPrice: "0x3b9aca00",
    maxFeePerGas: "0x77359400",
    maxPriorityFeePerGas: "0x3b9aca00",
    type: "0x2",
    chainId: "0x2105",
    v: "0x0",
    r: blockHash,
    s: blockHash,
    accessList: []
  };
}
function rpc(method, params = []) {
  if (method === "eth_chainId") return "0x2105";
  if (method === "eth_blockNumber") return "0x64";
  if (method === "eth_getBlockByNumber") return block;
  if (method === "eth_getBalance") return "0x3635c9adc5dea00000";
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
    return "0x3b9aca00";
  if (method === "eth_estimateGas") return "0x200000";
  if (method === "eth_getTransactionCount") return "0x0";
  if (method === "eth_getStorageAt")
    return padHex(upgraded ? implementation : p.currentImplementation.address, {
      size: 32
    });
  if (method === "eth_getCode") {
    const a = params[0].toLowerCase();
    if (a === p.proxy.toLowerCase()) return proxy.deployedBytecode.object;
    if (a === p.currentImplementation.address.toLowerCase()) return oldCode;
    if (a === implementation.toLowerCase() && deployed) return newCode;
    return "0x";
  }
  if (method === "eth_call") {
    const call = params[0];
    const selector = call.data?.slice(0, 10);
    if (selector === "0x82ad56cb") {
      const { args } = decodeFunctionData({
        abi: multicall3Abi,
        data: call.data
      });
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: args[0].map((entry) => ({
          success: true,
          returnData: rpc("eth_call", [
            { to: entry.target, data: entry.callData }
          ])
        }))
      });
    }
    if (selector === "0x4d2301cc")
      return encodeAbiParameters(parseAbiParameters("uint256"), [
        1000n * 10n ** 18n
      ]);
    if (selector === "0x91d14854")
      return encodeAbiParameters(parseAbiParameters("bool"), [true]);
    if (selector === "0x52d1902d") return p.implementationSlot;
    for (const name of ["registry", "monsters", "wrapper"]) {
      if (
        selector ===
        encodeFunctionData({ abi: engineReads, functionName: name }).slice(
          0,
          10
        )
      )
        return encodeAbiParameters(parseAbiParameters("address"), [
          p.unchanged[name]
        ]);
    }
    if (
      selector ===
      encodeFunctionData({
        abi: engineReads,
        functionName: "MAX_OPEN_PACKS"
      }).slice(0, 10)
    )
      return encodeAbiParameters(parseAbiParameters("uint32"), [
        p.capability.maxOpenPacks
      ]);
    if (call.to?.toLowerCase() === "0x420000000000000000000000000000000000000f")
      return encodeAbiParameters(parseAbiParameters("uint256"), [1000n]);
    if (call.to) unhandledCalls.push({ to: call.to, selector });
    return "0x";
  }
  if (method === "eth_sendTransaction") {
    const tx = params[0];
    sends.push(tx);
    assert.equal(tx.from.toLowerCase(), p.owner.toLowerCase());
    assert.equal(tx.value ?? "0x0", "0x0");
    // No guessed nonce is supplied by the UI. Wallet transport remains responsible for transaction preparation.
    assert.equal(tx.nonce, undefined);
    if (sends.length === 1) {
      assert.equal(tx.to, undefined);
      assert.equal(tx.data, p.candidate.creationBytecode);
      deployed = true;
      return deployHash;
    }
    assert.equal(tx.to.toLowerCase(), p.proxy.toLowerCase());
    upgraded = true;
    return upgradeHash;
  }
  if (method === "eth_getTransactionByHash") return transaction(params[0]);
  if (method === "eth_getTransactionReceipt")
    return {
      ...transaction(params[0]),
      transactionHash: params[0],
      status: deploymentReverted && params[0] === deployHash ? "0x0" : "0x1",
      contractAddress: params[0] === deployHash ? implementation : null,
      cumulativeGasUsed: "0x100000",
      gasUsed: "0x100000",
      effectiveGasPrice: "0x3b9aca00",
      logs: [],
      logsBloom: block.logsBloom
    };
  unexpected.push(method);
  throw new Error(`Unexpected synthetic RPC: ${method}`);
}
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 1100 }
});
const outbound = [];
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (
    request.method() === "POST" &&
    (url.pathname === "/__batch-wallet-rpc" ||
      /publicnode\.com|drpc\.org/.test(url.hostname))
  ) {
    const body = request.postDataJSON();
    const calls = Array.isArray(body) ? body : [body];
    if (
      deferSimulation &&
      calls.some(
        (call) =>
          call.method === "eth_call" &&
          !call.params?.[0]?.to &&
          call.params?.[0]?.data === p.candidate.creationBytecode
      )
    ) {
      deferSimulation = false;
      simulationReached();
      await new Promise((resolve) => {
        releaseSimulation = resolve;
      });
    }
    const answer = (call) => {
      try {
        return {
          jsonrpc: "2.0",
          id: call.id,
          result: rpc(call.method, call.params)
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id: call.id,
          error: { code: -32000, message: error.message }
        };
      }
    };
    return route.fulfill({
      json: Array.isArray(body) ? body.map(answer) : answer(body)
    });
  }
  if (url.origin === new URL(values.url).origin) return route.continue();
  outbound.push(`${request.method()} ${url.origin}${url.pathname}`);
  return route.abort();
});
await context.addInitScript(
  ({ owner }) => {
    const listeners = new Map();
    let chainId = "0x2105";
    window.ethereum = {
      isMetaMask: true,
      __setChain(next) {
        chainId = next;
        for (const handler of listeners.get("chainChanged") ?? [])
          handler(next);
      },
      isConnected: () => true,
      on(name, fn) {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      },
      removeListener(name, fn) {
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((v) => v !== fn)
        );
      },
      async request({ method, params }) {
        if (method === "eth_chainId") return chainId;
        if (method === "eth_accounts" || method === "eth_requestAccounts")
          return [owner];
        if (
          method === "wallet_requestPermissions" ||
          method === "wallet_getPermissions"
        )
          return [{ parentCapability: "eth_accounts" }];
        if (method === "wallet_getCapabilities") return {};
        const response = await fetch("/__batch-wallet-rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        const result = await response.json();
        if (result.error) throw new Error(result.error.message);
        return result.result;
      }
    };
  },
  { owner: p.owner }
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
try {
  await page.goto(`${values.url}/boosters/setup/batch`);
  await page
    .getByRole("heading", { name: "Owner batch upgrade", exact: true })
    .waitFor();
  if (
    await page
      .getByRole("button", { name: "Connect owner wallet", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Connect owner wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: /MetaMask|Browser Wallet|Injected/i })
      .first()
      .click();
  }
  await page
    .getByRole("button", { name: "Review deployment", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (v) => v.textContent === "Review deployment"
      )?.disabled
  );
  assert.equal(sends.length, 0);
  await page
    .getByRole("button", { name: "Review deployment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deploy in wallet", exact: true })
    .waitFor();
  assert.equal(sends.length, 0);
  checks.push(
    "owner connects and reviews exact package, roles, proxy and fee quote without automatic wallet writes"
  );
  const deferredSeen = new Promise((resolve) => {
    simulationReached = resolve;
  });
  deferSimulation = true;
  await page
    .getByRole("button", { name: "Deploy in wallet", exact: true })
    .click();
  await Promise.race([
    deferredSeen,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Synthetic simulation was not reached")),
        10000
      )
    )
  ]);
  await page.evaluate(() => window.ethereum.__setChain("0x1"));
  await page
    .getByRole("button", { name: "Switch to Base", exact: true })
    .waitFor();
  releaseSimulation();
  await page
    .getByRole("alert")
    .filter({
      hasText: /wallet or network changed|wallet changed during preflight/
    })
    .waitFor();
  assert.equal(sends.length, 0);
  checks.push(
    "network change during deferred final simulation invalidates the review and sends zero transactions"
  );
  await page.evaluate(() => window.ethereum.__setChain("0x2105"));
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (v) => v.textContent === "Review deployment"
      )?.disabled
  );
  await page
    .getByRole("button", { name: "Review deployment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Deploy in wallet", exact: true })
    .click();
  await page
    .getByText("Implementation deployed and verified.", { exact: false })
    .waitFor();
  assert.equal(sends.length, 1);
  assert.ok(
    await page
      .getByRole("button", { name: "Review atomic upgrade", exact: true })
      .isEnabled()
  );
  checks.push(
    "one explicit deploy signature uses creation bytes and actual receipt address; upgrade is a separate review"
  );
  await page.reload();
  await page
    .getByText(`Selected implementation: ${implementation}`, { exact: true })
    .waitFor();
  assert.equal(sends.length, 1);
  await page
    .getByLabel("Deployed implementation address")
    .fill(badImplementation);
  await page
    .getByRole("button", { name: "Verify implementation", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: /approved UUPS|returned no data|zero data/ })
    .waitFor();
  assert.equal(sends.length, 1);
  checks.push(
    "refresh recovers saved deployment without another signature and wrong manual runtime is rejected"
  );
  await page.getByLabel("Deployment transaction hash").fill(deployHash);
  await page
    .getByRole("button", { name: "Check deployment receipt", exact: true })
    .click();
  await page
    .getByText("The deployed implementation's exact bytecode is verified.", {
      exact: true
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Review atomic upgrade", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Upgrade in wallet", exact: true })
    .waitFor();
  assert.equal(sends.length, 1);
  await page
    .getByRole("button", { name: "Upgrade in wallet", exact: true })
    .click();
  await page.getByText("Batch upgrade complete.", { exact: false }).waitFor();
  assert.equal(sends.length, 2);
  const expected = encodeFunctionData({
    abi: p.abi.upgrade,
    functionName: "upgradeToAndCall",
    args: [implementation, p.configurationCalldata]
  });
  assert.equal(sends[1].data, expected);
  checks.push(
    "second explicit signature upgrades the verified implementation with empty initialization and validates actual slot/max10"
  );
  await page.reload();
  await page.getByText("Batch upgrade complete.", { exact: false }).waitFor();
  assert.equal(sends.length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  checks.push(
    "completed reload has no repeated writes and owner page fits a mobile viewport"
  );
  // A separately saved confirmed failure is resolved explicitly, never by silently retrying.
  upgraded = false;
  deploymentReverted = true;
  await page.evaluate(
    ({ hash, sha }) => {
      localStorage.setItem(
        `yunipals/boosters/batch/v1/${sha}`,
        JSON.stringify({ deploymentHash: hash })
      );
    },
    {
      hash: deployHash,
      sha: "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e"
    }
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Resolve saved deployment", exact: true })
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Review deployment", exact: true })
      .isDisabled()
  );
  await page
    .getByRole("button", { name: "Resolve saved deployment", exact: true })
    .click();
  await page
    .getByText("The saved transaction is confirmed cancelled or reverted.", {
      exact: false
    })
    .waitFor();
  assert.ok(
    await page
      .getByRole("button", { name: "Review deployment", exact: true })
      .isEnabled()
  );
  assert.equal(sends.length, 2);
  checks.push(
    "confirmed reverted deployment requires explicit receipt resolution before a fresh review and never auto resubmits"
  );
  const report = {
    format: "yunipals-booster-batch-owner-browser-v1",
    passed: true,
    packageSha256:
      "bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e",
    checks,
    syntheticWalletTransactions: sends.length,
    realNetworkProviderCalls: 0,
    blockedUnrelatedRequests: outbound.length,
    productionActions: 0
  };
  await writeFile(
    "/tmp/yunipals-booster-batch-owner-browser-20261023.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.message,
      url: page.url(),
      body: (await page.locator("body").innerText()).slice(0, 1800),
      outbound,
      alerts: await page.getByRole("alert").allTextContents(),
      messages: await page.getByRole("status").allTextContents(),
      sends: sends.length,
      unexpected,
      unhandledCalls,
      errors
    })
  );
  throw error;
} finally {
  await browser.close();
}
