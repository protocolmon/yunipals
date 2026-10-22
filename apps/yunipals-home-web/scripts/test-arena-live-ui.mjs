import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:53913" },
    playwright: { type: "string" },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-arena-live-ui" }
  }
});
if (!values.playwright) throw new Error("Pass an installed Playwright module.");
let mediaState = "videos";
let mediaUnavailable = false;
let mediaOrigin = `0x${"a".repeat(64)}`;
const mediaPublication = `0x${"d".repeat(64)}`;
let payoutsReleased = false;
let slowLoads = true;
let trackingState = "indexing";
let trackingFinalized = false;
let claimable = "6000000";
let transactionPosts = 0;
const origin = new URL(values.url);
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(origin.hostname)
)
  throw new Error("Use a local preview.");
const root = fileURLToPath(new URL("../../..", import.meta.url));
const pilot = resolve(root, "docs/islands/arena-freeform-tournament-v7");
const roster = JSON.parse(
  await readFile(resolve(pilot, "roster.json"), "utf8")
);
const published = resolve(
  root,
  "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public"
);
const assignment = JSON.parse(
  await readFile(
    resolve(root, "docs/islands/arena-reveal-results-v1/assignments.json"),
    "utf8"
  )
).assignments[0];
const metadata = JSON.parse(
  await readFile(
    resolve(published, "metadata", `${assignment.tokenId}.json`),
    "utf8"
  )
);
const profile = JSON.parse(
  await readFile(
    resolve(published, "profiles", `${assignment.profileSha256}.json`),
    "utf8"
  )
);
const rules = JSON.parse(
  await readFile(resolve(root, "docs/arena/rules-v2/rules.json"), "utf8")
);
const addr = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;
const transactionHash = `0x${"e".repeat(64)}`;
const tournament = {
  id: "1",
  incarnation: hash,
  phase: "strategies",
  deadline: Math.floor(Date.now() / 1000) + 86400,
  rulesHash: hash,
  poolHash: hash,
  treasury: addr,
  islandId: assignment.tokenId,
  islandBeneficiary: addr,
  requestId: "1",
  randomWord: "42",
  ticket: 1,
  seats: roster.map((f, seat) => ({
    seat,
    player: addr,
    nftChainId: 1,
    collection: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
    tokenId: f.tokenId
  })),
  inputHash: null,
  commitments: null,
  resultHash: null,
  winners: null,
  submittedSeats: [0, 1],
  strategies: null
};
const { chromium } = await import(pathToFileURL(values.playwright).href);
const browser = await chromium.launch({
  executablePath: values.chromium,
  args: ["--no-sandbox"]
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 }
});
const page = await context.newPage();
await context.addInitScript(
  ({ address, hash }) => {
    const listeners = new Map();
    window.__arenaSentTransactions = [];
    let connected =
      localStorage.getItem("arena-test-wallet-connected") === "yes";
    window.ethereum = {
      isMetaMask: true,
      isConnected: () => true,
      on: (event, fn) => {
        listeners.set(event, [...(listeners.get(event) || []), fn]);
      },
      removeListener: (event, fn) => {
        listeners.set(
          event,
          (listeners.get(event) || []).filter((f) => f !== fn)
        );
      },
      request: async ({ method, params }) => {
        if (method === "eth_accounts") return connected ? [address] : [];
        if (method === "eth_requestAccounts") {
          connected = true;
          localStorage.setItem("arena-test-wallet-connected", "yes");
          return [address];
        }
        if (method === "eth_chainId") return "0x2105";
        if (method === "net_version") return "8453";
        if (method === "wallet_getCapabilities") return {};
        if (
          method === "wallet_switchEthereumChain" ||
          method === "wallet_requestPermissions"
        )
          return null;
        if (method === "eth_sendTransaction") {
          window.__arenaSentTransactions.push(params);
          return hash;
        }
        if (method === "personal_sign") return `0x${"1".repeat(130)}`;
        throw new Error(`Unexpected mock-wallet method ${method}`);
      }
    };
  },
  { address: addr, hash: transactionHash }
);
const errors = [];
let tokenMetadataReads = 0;
let resultReads = 0;
page.on("pageerror", (e) => errors.push(e.message));
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  const json = (value) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(value)
    });
  if (url.pathname.startsWith("/__arena-test")) {
    const path = url.pathname.slice("/__arena-test".length);
    if (path === "/config")
      return json({
        chainId: 8453,
        contract: addr,
        paymentToken: addr,
        entryFee: "2000000",
        strategyMaxLength: 2400,
        entriesEnabled: false,
        confirmationPolicy: "finalized"
      });
    if (path === "/tournaments") {
      if (slowLoads) await new Promise((resolve) => setTimeout(resolve, 800));
      return json({ items: [tournament] });
    }
    if (path === "/tournaments/1") return json(tournament);
    if (path === "/tournaments/1/media") {
      if (mediaUnavailable)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Source unavailable." })
        });
      return json({
        state: mediaState,
        payoutsReleased,
        incarnation: mediaOrigin,
        publication: mediaState === "ready" ? mediaPublication : null
      });
    }
    if (path === "/tournaments/1/result") {
      resultReads++;
      return json({
        incarnation: tournament.incarnation,
        outcome: {
          matches: [
            {
              id: "FINAL",
              winnerId: roster[0].id,
              verdict: "knockout",
              whyWinner:
                "The shield blocked the water strike; the counterattack connected during recovery."
            }
          ]
        }
      });
    }
    if (path === "/tournaments/1/context") {
      if (slowLoads) await new Promise((resolve) => setTimeout(resolve, 1500));
      return json({
        rules,
        island: { ...assignment, ...metadata, profile },
        roster,
        tiePriority: roster.map((f) => f.id),
        ready: true
      });
    }
    if (path === "/me") return json({ wallet: addr, claimable });
    if (
      path === "/transactions" ||
      path === `/transactions/${transactionHash}`
    ) {
      if (route.request().method() === "POST") transactionPosts++;
      return json({
        hash: transactionHash,
        action: { kind: "claim" },
        state: trackingState,
        finalized: trackingFinalized,
        receiptBlockHash: hash,
        indexedThroughBlock: trackingState === "indexed" ? "10" : null,
        result:
          trackingState === "indexed"
            ? {
                event: "Claimed",
                amount: "6000000",
                blockNumber: "10",
                logIndex: 0
              }
            : null
      });
    }
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: '{"error":"Sign in"}'
    });
  }
  const token = roster.find((f) =>
    url.pathname.endsWith(`/tokens/ethereum/${f.tokenId}`)
  );
  if (token) {
    tokenMetadataReads++;
    return json({
      token: {
        token_id: token.tokenId,
        chain: "ethereum",
        name: token.name,
        image: token.image,
        owner: addr,
        burned: false,
        lifecycle: 1,
        attributes: []
      }
    });
  }
  const fighter = roster.find((f) => f.image === url.href);
  if (fighter)
    return route.fulfill({
      contentType: "image/png",
      body: await readFile(resolve(pilot, fighter.localImage))
    });
  if (url.href === metadata.image)
    return route.fulfill({
      contentType: "image/png",
      body: await readFile(
        resolve(published, "images", `${assignment.tokenId}.png`)
      )
    });
  if (
    route.request().method() === "POST" &&
    /rpc|publicnode|drpc/.test(url.hostname)
  ) {
    const body = route.request().postDataJSON();
    const response = (request) => {
      let result;
      if (request.method === "eth_chainId") result = "0x2105";
      else if (request.method === "eth_blockNumber") result = "0xa";
      else if (request.method === "eth_getBalance")
        result = "0xde0b6b3a7640000";
      else if (request.method === "eth_call") result = `0x${"0".repeat(63)}0`;
      else if (request.method === "eth_getTransactionReceipt")
        result = {
          transactionHash,
          transactionIndex: "0x0",
          blockHash: hash,
          blockNumber: "0xa",
          from: addr,
          to: addr,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          type: "0x2"
        };
      else if (request.method === "eth_estimateGas") result = "0x5208";
      else
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: "Unsupported test RPC" }
        };
      return { jsonrpc: "2.0", id: request.id, result };
    };
    return json(Array.isArray(body) ? body.map(response) : response(body));
  }
  if (url.origin === origin.origin) return route.continue();
  return route.abort();
});
await mkdir(values.output, { recursive: true });
try {
  await page.goto(`${origin.origin}/arena/1`, {
    waitUntil: "domcontentloaded"
  });
  await page.getByRole("heading", { name: "Tournament #1" }).waitFor();
  await page.getByRole("status", { name: "Loading arena details" }).waitFor();
  await page.getByRole("heading", { name: metadata.name }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("main img")].every(
      (i) => i.complete && i.naturalWidth > 0
    )
  );
  assert.equal(await page.locator("main article").count(), 4);
  slowLoads = false;
  assert.equal(
    tokenMetadataReads,
    0,
    "Roster must use saved server snapshots, not current token metadata"
  );
  await page.getByText("Rules and exact-tie priority", { exact: true }).click();
  assert.equal(await page.locator("main ol li").count(), 4);
  assert.equal(
    await page.getByText("Revealed strategies", { exact: true }).count(),
    0
  );
  assert.equal(await page.getByRole("textbox").count(), 0);
  await page.screenshot({
    path: resolve(values.output, "desktop.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: resolve(values.output, "mobile.png"),
    fullPage: true
  });
  tournament.phase = "settled";
  tournament.winners = [0, 2, 0];
  tournament.resultHash = hash;
  await page.reload();
  await page
    .getByText(
      "Your film is being prepared. Payouts unlock after the completed film is published.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await page.locator("video").count(), 0);
  mediaState = "needs-attention";
  await page.reload();
  await page
    .getByText(
      "The film needs a technical fix. The result is fixed; payouts remain held until the completed film is published.",
      { exact: true }
    )
    .waitFor();
  mediaState = "ready";
  await page.reload();
  await page
    .getByText("Video published. Payouts are unlocking on Base…", {
      exact: true
    })
    .waitFor();
  const filmUrl = new URL(await page.locator("video").getAttribute("src"));
  assert.equal(filmUrl.searchParams.get("origin"), tournament.incarnation);
  assert.equal(filmUrl.searchParams.get("publication"), mediaPublication);
  mediaOrigin = `0x${"b".repeat(64)}`;
  await page.reload();
  await page
    .getByText(
      "Your film is being prepared. Payouts unlock after the completed film is published.",
      { exact: true }
    )
    .waitFor();
  assert.equal(await page.locator("video").count(), 0);
  mediaOrigin = tournament.incarnation;
  await page.reload();
  await page.locator("video").waitFor();
  const reveal = page.getByRole("button", { name: "Show result", exact: true });
  await reveal.waitFor();
  assert.equal(await page.getByText(/Champion: Yunipal/).count(), 0);
  assert.equal(resultReads, 0);
  assert.equal(await page.locator("video[controls][preload=none]").count(), 1);
  assert.equal(
    await page.getByText("Why each fighter won", { exact: true }).count(),
    0
  );
  await reveal.focus();
  await page.keyboard.press("Enter");
  await page
    .getByText(`Champion: Yunipal #${roster[0].tokenId}`, { exact: true })
    .waitFor();
  await page
    .getByText(
      "The shield blocked the water strike; the counterattack connected during recovery.",
      { exact: true }
    )
    .waitFor();
  assert.equal(resultReads, 1);
  payoutsReleased = true;
  await page.reload();
  await page
    .getByText("Payouts are unlocked. Recipients can claim their USDC.", {
      exact: true
    })
    .waitFor();
  await page.screenshot({
    path: resolve(values.output, "settled-mobile.png"),
    fullPage: true
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  assert.deepEqual(errors, []);
  mediaUnavailable = true;
  await page.reload();
  await page
    .getByText("Video status is temporarily unavailable.", { exact: true })
    .waitFor();
  assert.equal(await page.locator("video").count(), 0);
  mediaUnavailable = false;
  await page.reload();
  await page.locator("video").waitFor();
  // Use the actual injected-wallet connector and hook. All provider/RPC traffic
  // is intercepted above; no real wallet, chain transaction or generation.
  await page
    .locator("main")
    .getByRole("button", { name: /Connect Wallet/i })
    .first()
    .click();
  await page
    .getByRole("button", { name: /MetaMask|Browser Wallet|Injected Wallet/i })
    .first()
    .click();
  const claim = page.getByRole("button", { name: "Claim USDC", exact: true });
  await claim.waitFor();
  await claim.click();
  await page
    .getByText("Transaction confirmed. Updating tournament data…", {
      exact: true
    })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    1
  );
  assert.equal(await claim.isDisabled(), true);
  assert.equal(
    await page
      .getByText(
        "USDC claimed. Your balance and withdrawal history are updated.",
        { exact: true }
      )
      .count(),
    0
  );
  await page.reload();
  await page
    .getByText("Transaction confirmed. Updating tournament data…", {
      exact: true
    })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    0,
    "Refresh resumes indexing without another wallet transaction"
  );
  trackingState = "indexed";
  claimable = "0";
  await page
    .getByText(
      "USDC claimed. Your balance and withdrawal history are updated.",
      { exact: true }
    )
    .waitFor({ timeout: 20000 });
  await page.getByText("Claimable: 0 USDC", { exact: true }).waitFor();
  assert.ok(transactionPosts >= 2);
  await page.screenshot({
    path: resolve(values.output, "indexed-claim-mobile.png"),
    fullPage: true
  });
  // Previously accepted latest results must resume auditing after reload.
  await page.reload();
  await page
    .getByText(
      "USDC claimed. Your balance and withdrawal history are updated.",
      { exact: true }
    )
    .waitFor();
  trackingState = "reorged";
  claimable = "6000000";
  await page
    .getByText(
      "The chain changed. Your transaction is retained while we check its new result.",
      { exact: true }
    )
    .waitFor({ timeout: 20000 });
  await page.getByText("Claimable: 6 USDC", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Claim USDC", exact: true })
      .isDisabled(),
    true
  );
  trackingState = "indexed";
  trackingFinalized = true;
  claimable = "0";
  await page
    .getByText(
      "USDC claimed. Your balance and withdrawal history are updated.",
      { exact: true }
    )
    .waitFor({ timeout: 20000 });
  await page.getByText("Claimable: 0 USDC", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    0,
    "Reorg recovery never sends a second wallet transaction"
  );
  assert.deepEqual(errors, []);
  const report = {
    passed: 26,
    checks: [
      "Native film URL pins both tournament opening and publication",
      "A mismatched opening cannot render a cached film",
      "Native source unavailability removes the film player",
      "Payouts visibly held while the film is being prepared",
      "Technical video failure keeps payouts pending",
      "Published video waits for onchain payout confirmation",
      "Confirmed release displays unlocked USDC",
      "Four distinct NFT identities and island rendered",
      "No private prompts or anonymous submission controls",
      "390px viewport has no horizontal overflow",
      "Result hidden until explicit keyboard activation",
      "No browser exceptions",
      "Saved roster displayed without independent metadata requests",
      "Public tie priority accessible before strategy submission",
      "24-second film player has controls and does not preload or autoplay",
      "Referee explanation fetched only after result reveal",
      "Settled mobile view has no horizontal overflow",
      "Slow arena details display a layout-preserving loading skeleton",
      "Successful wallet receipt remains pending until the actual indexed result",
      "Claim button stays disabled while indexing; no premature success",
      "Reload recovers the pending transaction without another send",
      "Indexed success waits for the refreshed available balance",
      "Reload resumes auditing a successful nonfinal transaction",
      "Reorg withdraws success and refreshes the available balance",
      "Claim remains disabled while the retained hash recovers",
      "Re-inclusion recovers success without a new wallet transaction"
    ],
    scope:
      "Mock API/RPC and injected wallet only; no real payment or generation",
    screenshots: ["desktop.png", "mobile.png"]
  };
  await writeFile(
    resolve(values.output, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
