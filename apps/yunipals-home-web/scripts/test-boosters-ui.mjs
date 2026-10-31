import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  parseAbiParameters
} from "viem";
import { base } from "viem/chains";
import {
  boosterPacksAbi,
  yunipalMonstersAbi
} from "../../../packages/yunipals-market-core/src/boosterAbi.ts";

const { values } = parseArgs({
  options: {
    playwright: { type: "string" },
    chromium: { type: "string" },
    "collection-only": { type: "boolean", default: false },
    url: { type: "string", default: "http://127.0.0.1:5189" }
  }
});
if (!values.playwright)
  throw new Error("Pass --playwright PATH to the installed Playwright module.");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(values.url).hostname));
const manifest = JSON.parse(
  await readFile("/tmp/yunipals-boosters-local.json", "utf8")
);
const client = createPublicClient({
  chain: base,
  transport: http(manifest.rpc)
});
if (manifest.initialSnapshot) {
  assert.equal(
    await client.request({
      method: "evm_revert",
      params: [manifest.initialSnapshot]
    }),
    true
  );
  manifest.initialSnapshot = await client.request({ method: "evm_snapshot" });
  await writeFile(
    "/tmp/yunipals-boosters-local.json",
    JSON.stringify(manifest, null, 2)
  );
}
const wallet = createWalletClient({
  account: manifest.account,
  chain: base,
  transport: http(manifest.rpc)
});
const wrapper = JSON.parse(
  await readFile(
    new URL(
      "../../../contracts/boosters/out/BoosterPacks.t.sol/MockWrapper.json",
      import.meta.url
    ),
    "utf8"
  )
);
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
const marketRequests = [];
await context.route("http://127.0.0.1:59999/**", async (route) => {
  marketRequests.push(route.request().url());
  await route.abort();
});
// This fixture exercises actual booster handlers/SQL and wallet transactions.
// OG collection reads belong to the retained legacy API, represented here by
// explicit empty read fixtures so the collection landing page also renders.
await context.route("http://127.0.0.1:9019/v1/**", async (route) => {
  const url = new URL(route.request().url());
  if (
    url.pathname.includes("/boosters/") ||
    /\/booster-(originals|monsters|requests|refunds)$/.test(url.pathname)
  ) {
    await route.continue();
    return;
  }
  const common = {
    chain: null,
    chains: ["ethereum", "base", "polygon", "bnb"],
    items: [],
    nextCursor: null,
    total: 0
  };
  if (url.pathname === "/v1/traits") {
    await route.fulfill({
      json: {
        ...common,
        metadata: { available: 0, missing: 0 },
        updatedAt: new Date().toISOString()
      }
    });
  } else if (/\/owners\/[^/]+\/leaderboard$/.test(url.pathname)) {
    await route.fulfill({
      status: 404,
      json: { error: "collector_not_ranked" }
    });
  } else if (/\/owners\/[^/]+\/tokens$/.test(url.pathname)) {
    const owner = url.pathname.split("/")[3];
    await route.fulfill({ json: { ...common, owner, visibility: "visible" } });
  } else {
    await route.fulfill({ json: common });
  }
});
await context.addInitScript(
  ({ account, rpc }) => {
    let connected = localStorage.getItem("booster-test-connected") === "true";
    const listeners = new Map();
    window.ethereum = {
      isMetaMask: true,
      isConnected: () => true,
      on: (name, handler) => {
        const entries = listeners.get(name) ?? [];
        entries.push(handler);
        listeners.set(name, entries);
      },
      removeListener: (name, handler) =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((entry) => entry !== handler)
        ),
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return connected ? [account] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          localStorage.setItem("booster-test-connected", "true");
          for (const handler of listeners.get("accountsChanged") ?? [])
            handler([account]);
          return [account];
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
          headers: { "Content-Type": "application/json" },
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
  { account: manifest.account, rpc: manifest.rpc }
);
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const report = {
  story:
    "Open → approve → burn → VRF reveal → accrue → claim → transfer pending rights → callback to new owner → burn forfeiture",
  checks: []
};
const confirm = async (text) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: text, exact: true })
    .click();
};
const poll = async (check) => {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.fail("Timed out waiting for local index state");
};
const send = async (
  account,
  address,
  abi,
  functionName,
  args,
  options = {}
) => {
  const hash = await createWalletClient({
    account,
    chain: base,
    transport: http(manifest.rpc)
  }).writeContract({ address, abi, functionName, args, ...options });
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
};
try {
  await page.goto(`${values.url}/collection`);
  await page.getByRole("heading", { name: "Pack #1", exact: true }).waitFor();
  await page
    .locator("article")
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const walletButton = page
    .getByRole("button", { name: /MetaMask|Browser Wallet|Injected/i })
    .first();
  await walletButton.click();
  await page
    .locator("article")
    .getByRole("button", { name: "Open pack", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Booster Yunipals", exact: true })
    .waitFor();
  if (values["collection-only"]) {
    assert.equal(
      await page.getByRole("link", { name: "Race lab", exact: true }).count(),
      0
    );
    assert.equal(
      await page.getByRole("link", { name: "My orders", exact: true }).count(),
      0
    );
  }
  await page
    .locator("article")
    .getByRole("button", { name: "Open pack", exact: true })
    .click();
  await page.getByRole("heading", { name: "Approve pack payment" }).waitFor();
  await confirm("Approve payment");
  await page
    .getByRole("heading", { name: "Review transaction", exact: true })
    .waitFor();
  await page
    .getByText("The full pack price is burned", { exact: false })
    .waitFor();
  await confirm("Confirm");
  await page.getByText("Awaiting randomness", { exact: true }).waitFor();
  report.checks.push(
    "wallet connection, exact approval, fee review, successful opening request"
  );
  const token = JSON.parse(
    await readFile(
      new URL(
        "../../../contracts/boosters/out/BoosterPacks.t.sol/MockProto.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  assert.equal(
    await client.readContract({
      address: manifest.proto,
      abi: token.abi,
      functionName: "totalSupply"
    }),
    99n * 10n ** 18n
  );
  assert.equal(await client.getBalance({ address: manifest.engine }), 0n);
  await page.reload();
  await page.getByText("Awaiting randomness", { exact: true }).waitFor();
  report.checks.push(
    "refresh restores pending request; all PROTO burned and ETH change returned"
  );
  // Pick a deterministic mock seed for the approved holo turtle. This is a
  // local oracle fixture only; live VRF randomness is never controlled.
  const opening = await client.readContract({
    address: manifest.engine,
    abi: boosterPacksAbi,
    functionName: "getRequest",
    args: [1n]
  });
  let artSeed = 0n;
  while (
    BigInt(
      keccak256(
        encodeAbiParameters(
          parseAbiParameters(
            "uint256,uint256,address,uint256,uint256,bytes32,uint256"
          ),
          [artSeed, 8453n, manifest.engine, 1n, 1n, opening.ruleHash, 0n]
        )
      )
    ) %
      264n !==
    149n
  )
    artSeed++;
  await send(manifest.account, manifest.wrapper, wrapper.abi, "fulfill", [
    1n,
    artSeed
  ]);
  await page.getByText("Revealed", { exact: true }).waitFor();
  assert.equal(
    (
      await client.readContract({
        address: manifest.monsters,
        abi: yunipalMonstersAbi,
        functionName: "ownerOf",
        args: [1n]
      })
    ).toLowerCase(),
    manifest.account.toLowerCase()
  );
  await client.request({ method: "evm_increaseTime", params: [3 * 86400] });
  await client.request({ method: "evm_mine" });
  await page.goto(`${values.url}/collection`);
  await page.getByRole("link", { name: "Original #1", exact: true }).waitFor();
  await page.getByText(/3 unused mints/).waitFor();
  report.checks.push(
    "collection landing page shows connected owner's original, revealed cards and accrued claim controls"
  );
  await page.goto(`${values.url}/monsters/${manifest.monsters}/1`);
  await page.getByText(/3 unused mints/).waitFor();
  await page.locator(".booster-card-viewer .tilt-card > img").waitFor();
  await page.waitForFunction(() => {
    const img = document.querySelector(".booster-card-viewer .tilt-card > img");
    return img?.complete && img.naturalWidth === 1024;
  });
  const card = page.getByRole("group", {
    name: "Interactive Yunipal card",
    exact: true
  });
  assert.equal(await page.getByLabel("Card viewer controls").count(), 0);
  assert.equal(await card.getAttribute("data-live-holo"), "true");
  const expectAutoTilt = async () => {
    const rotation = await card
      .locator(".tilt-card")
      .evaluate((el) => el.style.getPropertyValue("--rotate-y"));
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector(".tilt-card")
          .style.getPropertyValue("--rotate-y") !== previous,
      rotation
    );
  };
  await expectAutoTilt();
  const bounds = await card.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.35
  );
  await page.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector(".tilt-card")
          .style.getPropertyValue("--rotate-y")
      ) > 0
  );
  await page.screenshot({
    path: "/tmp/yunipals-booster-integrated-artwork.png",
    fullPage: true
  });
  const metadata = await fetch(
    "http://127.0.0.1:9019/v1/boosters/art/base-standard-v1-demo/149.json"
  ).then((r) => r.json());
  assert.equal(
    metadata.yunipals.artworkSha256,
    "45709a6ac84f0e183a8de46cdab2a76afb0c44d2acafc033a65e248c8d6d8fdd"
  );
  report.checks.push(
    "real revealed traits resolve to the approved green turtle, full-resolution image and calibrated tilt masks"
  );
  await card.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector(".tilt-card")
          .style.getPropertyValue("--rotate-y")
      ) > 0
  );
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector(".tilt-card")
          .style.getPropertyValue("--rotate-y")
      ) === 0
  );
  const cdp = await page.context().newCDPSession(page);
  const touch = {
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.4
  };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touch]
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touch, x: touch.x + bounds.width * 0.15 }]
  });
  await page.waitForFunction(
    () =>
      parseFloat(
        document
          .querySelector(".tilt-card")
          .style.getPropertyValue("--rotate-y")
      ) > 0
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: []
  });
  await expectAutoTilt();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      document
        .querySelector(".tilt-card")
        .style.getPropertyValue("--rotate-y") === "0deg"
  );
  assert.equal(
    await card
      .locator(".tilt-card")
      .evaluate((el) => getComputedStyle(el).transform),
    "none"
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expectAutoTilt();
  await cdp.detach();
  report.checks.push(
    "integrated viewer supports mouse, touch, keyboard, automatic tilt and reduced motion without settings"
  );

  await page.getByLabel("Mints in this batch").fill("3");
  await page.getByRole("button", { name: "Claim 3", exact: true }).click();
  await page.getByText("Mints requested", { exact: true }).waitFor();
  await confirm("Confirm");
  await poll(
    async () =>
      (
        await client.readContract({
          address: manifest.engine,
          abi: boosterPacksAbi,
          functionName: "getRequest",
          args: [2n]
        })
      ).status === 1
  );
  report.checks.push("rolling daily accrual and three-credit batch claim");
  await send(
    manifest.account,
    manifest.monsters,
    yunipalMonstersAbi,
    "transferFrom",
    [manifest.account, manifest.otherAccount, 1n]
  );
  await send(manifest.account, manifest.wrapper, wrapper.abi, "fulfill", [
    2n,
    5n
  ]);
  for (const tokenId of [1n, 2n, 3n, 4n])
    assert.equal(
      (
        await client.readContract({
          address: manifest.monsters,
          abi: yunipalMonstersAbi,
          functionName: "ownerOf",
          args: [tokenId]
        })
      ).toLowerCase(),
      manifest.otherAccount.toLowerCase()
    );
  await poll(
    async () =>
      (
        await fetch(
          `http://127.0.0.1:9019/v1/owners/${manifest.otherAccount}/booster-monsters`
        ).then((response) => response.json())
      ).items.length === 4
  );
  await page.goto(`${values.url}/collector/${manifest.otherAccount}`);
  await page
    .getByRole("heading", { name: "Booster Yunipals", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Original #1", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Claim / }).count(), 0);
  report.checks.push(
    "pending offspring follow transferred original; collector API/UI shows new owner"
  );
  await page.goto(`${values.url}/monsters/${manifest.monsters}/2`);
  await page
    .getByRole("heading", { name: "Yunipal #2", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator("main")
      .getByRole("button", { name: /buy|sell|arena|claim|list/i })
      .count(),
    0
  );
  await page
    .getByText("Your Yunipal is revealed. Its artwork is being prepared.", {
      exact: true
    })
    .waitFor();
  report.checks.push(
    "unpublished variants show preparation state without broken images"
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/yunipals-boosters-mobile.png",
    fullPage: true
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  report.checks.push(
    "offspring detail has no mint/trade/arena actions and fits a mobile viewport"
  );
  await client.request({ method: "evm_increaseTime", params: [86400] });
  await client.request({ method: "evm_mine" });
  await send(
    manifest.otherAccount,
    manifest.engine,
    boosterPacksAbi,
    "claim",
    [
      1n,
      1,
      100000000000000n,
      BigInt(Math.floor(Date.now() / 1000) + 100000000)
    ],
    { value: 100000000000000n }
  );
  // Burn directly through the standard collection interface; callback and API must agree.
  await send(
    manifest.otherAccount,
    manifest.monsters,
    yunipalMonstersAbi,
    "burn",
    [1n]
  );
  const pending = await client.readContract({
    address: manifest.engine,
    abi: boosterPacksAbi,
    functionName: "getRequest",
    args: [3n]
  });
  assert.equal(pending.status, 4);
  await send(manifest.account, manifest.wrapper, wrapper.abi, "fulfill", [
    3n,
    9n
  ]);
  await poll(
    async () =>
      (
        await fetch(
          `http://127.0.0.1:9019/v1/owners/${manifest.otherAccount}/booster-originals`
        ).then((response) => response.json())
      ).items.length === 0
  );
  assert.equal(
    await client.readContract({
      address: manifest.monsters,
      abi: yunipalMonstersAbi,
      functionName: "balanceOf",
      args: [manifest.otherAccount]
    }),
    3n
  );
  report.checks.push(
    "burn removes original rights and leaves already minted offspring"
  );
  assert.deepEqual(errors, []);
  report.consoleErrors = errors;
  assert.deepEqual(marketRequests, []);
  report.marketRequests = marketRequests;
  if (values["collection-only"])
    report.checks.push(
      "booster purchase, cards and claims work with marketplace unavailable and collection-only routes enabled"
    );
  await writeFile(
    "/tmp/yunipals-boosters-browser-report.json",
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: "/tmp/yunipals-boosters-failure.png",
    fullPage: true
  });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
