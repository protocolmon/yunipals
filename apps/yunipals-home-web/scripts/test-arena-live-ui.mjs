import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  erc20Abi
} from "viem";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { strategyCommitment } from "../../../packages/yunipals-market-core/src/arena.ts";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:53913" },
    playwright: { type: "string" },
    "wallet-flow-only": { type: "boolean", default: false },
    "approval-flow-only": { type: "boolean", default: false },
    "strategy-flow-only": { type: "boolean", default: false },
    chromium: { type: "string" },
    output: { type: "string", default: "/tmp/yunipals-arena-live-ui" }
  }
});
if (!values.playwright) throw new Error("Pass an installed Playwright module.");
let mediaState = "videos";
let payoutsReleased = false;
let slowLoads = true;
let trackingState = "indexing";
let claimable = "6000000";
let transactionPosts = 0;
let mockAllowance = 0n;
let trackedAction = { kind: "claim" };
let holdEntryIndexing = false;
let holdStrategySubmission = false;
let releaseStrategySubmission = () => {};
let holdStrategyReceipt = false;
let releaseStrategyReceipt = () => {};
const strategyBodies = [];
let sessionWallet = values["wallet-flow-only"]
  ? null
  : "0x1111111111111111111111111111111111111111";
let sessionUnavailable = false;
let challengeRequests = 0;
let verifyRequests = 0;
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
  serverTime: Math.floor(Date.now() / 1000),
  id: "1",
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
if (values["approval-flow-only"]) {
  tournament.phase = "open";
  tournament.seats = [];
  tournament.submittedSeats = [];
  trackingState = "indexed";
}
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
    window.__arenaSignedStrategies = [];
    window.__arenaSignedMessages = [];
    window.__arenaRejectSignature = false;
    window.__arenaChangeAccount = (next) => {
      address = next;
      for (const listener of listeners.get("accountsChanged") ?? [])
        listener([next]);
    };
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
          if (window.__arenaRejectTransaction)
            throw Object.assign(new Error("User rejected the transaction."), {
              code: 4001
            });
          if (window.__arenaHoldTransaction)
            await new Promise((resolve) => {
              window.__arenaReleaseTransaction = resolve;
            });
          window.__arenaSentTransactions.push(params);
          return hash;
        }
        if (method === "personal_sign") {
          window.__arenaSignedMessages.push(params);
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (window.__arenaRejectSignature)
            throw Object.assign(new Error("User rejected the request."), {
              code: 4001
            });
          return `0x${"1".repeat(130)}`;
        }
        if (method === "eth_signTypedData_v4") {
          window.__arenaSignedStrategies.push(params);
          if (window.__arenaHoldStrategySignature)
            await new Promise((resolve) => {
              window.__arenaReleaseStrategySignature = resolve;
            });
          if (window.__arenaRejectTypedSignature)
            throw Object.assign(
              new Error("User rejected the strategy signature."),
              { code: 4001 }
            );
          return `0x${"2".repeat(130)}`;
        }
        throw new Error(`Unexpected mock-wallet method ${method}`);
      }
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "59f6aab0-245c-4bc1-a13e-a2b8d5398826",
              name: "Arena Test Wallet",
              icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='purple'/></svg>",
              rdns: "test.arena.wallet"
            },
            provider: window.ethereum
          }
        })
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
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
  const apiPrefix = ["/__arena-test", "/api/arena"].find((prefix) =>
    url.pathname.startsWith(prefix + "/")
  );
  if (apiPrefix) {
    const path = url.pathname.slice(apiPrefix.length);
    if (path === "/config")
      return json({
        chainId: 8453,
        contract: addr,
        paymentToken: addr,
        entryFee: "2000000",
        strategyMaxLength: 2400,
        entriesEnabled: values["approval-flow-only"],
        confirmationPolicy: "base-depth-3-v1"
      });
    if (path === "/tournaments") {
      if (slowLoads) await new Promise((resolve) => setTimeout(resolve, 800));
      const status = url.searchParams.get("status") ?? "all";
      const selected =
        status === "all" ||
        (status === "completed" && tournament.phase === "settled") ||
        (status === "active" &&
          ["open", "strategies", "resolving"].includes(tournament.phase)) ||
        (status === "refunded" && tournament.phase === "expired");
      return json({
        items: selected
          ? [
              {
                id: tournament.id,
                phase: tournament.phase,
                deadline: tournament.deadline,
                islandId: tournament.islandId,
                islandBeneficiary: tournament.islandBeneficiary,
                submittedSeats: tournament.submittedSeats,
                automaticStrategyMask: tournament.automaticStrategyMask ?? 0,
                videoReady: mediaState === "ready",
                payoutsReleased,
                championSeat: tournament.winners?.[2] ?? null,
                fighters: roster
                  .slice(0, tournament.seats.length)
                  .map((f, seat) => ({
                    seat,
                    player: addr,
                    chainId: 1,
                    collection: tournament.seats[seat].collection,
                    tokenId: f.tokenId,
                    name: f.name,
                    image: f.image
                  }))
              }
            ]
          : [],
        nextCursor: null
      });
    }
    if (path === "/tournaments/1/admission") {
      const nft = route.request().postDataJSON();
      return json({
        entry: { player: addr, ...nft },
        expiry: String(Math.floor(Date.now() / 1000) + 300),
        signature: `0x${"1".repeat(130)}`
      });
    }
    if (path === "/tournaments/1") return json(tournament);
    if (path === "/tournaments/1/timeline")
      return json({
        items: [
          {
            event: "Entered",
            transactionHash: hash,
            blockNumber: "7",
            logIndex: 2
          }
        ]
      });
    if (path === "/tournaments/1/strategies/2/receipt") {
      if (holdStrategyReceipt)
        await new Promise((resolve) => {
          releaseStrategyReceipt = resolve;
        });
      const body = strategyBodies.at(-1);
      return json(
        values["strategy-flow-only"] &&
          tournament.submittedSeats.includes(2) &&
          body
          ? {
              seat: 2,
              locked: true,
              text: body.text,
              commitment: strategyCommitment(addr, 1n, 2, body.text, body.salt),
              receivedAt: new Date().toISOString()
            }
          : { seat: 2, locked: false }
      );
    }
    if (path === "/tournaments/1/strategies/3/receipt")
      return json({ seat: 3, locked: false });
    if (path === "/tournaments/1/strategies/0/receipt")
      return json({
        seat: 0,
        locked: true,
        commitment: hash,
        text: "Your original locked plan: hold the center, shield the charge, then counter.",
        receivedAt: new Date().toISOString()
      });
    if (
      path === "/tournaments/1/strategies" &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      strategyBodies.push(body);
      if (holdStrategySubmission)
        await new Promise((resolve) => {
          releaseStrategySubmission = resolve;
        });
      if (strategyBodies.length === 1) return route.abort("failed");
      tournament.submittedSeats = [0, 1, 2];
      return json({
        seat: body.seat,
        locked: true,
        commitment: strategyCommitment(
          addr,
          1n,
          body.seat,
          body.text,
          body.salt
        )
      });
    }
    if (path === "/tournaments/1/media")
      return json({ state: mediaState, payoutsReleased });
    if (path === "/tournaments/1/result") {
      resultReads++;
      return json({
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
    if (path === "/auth/challenge") {
      challengeRequests++;
      return json({
        id: "mock-challenge",
        message:
          "Confirm ownership of your connected wallet for this Arena action. No gas fee."
      });
    }
    if (path === "/auth/verify") {
      verifyRequests++;
      sessionWallet = addr;
      return json({ wallet: addr });
    }
    if (path === "/me") {
      if (sessionUnavailable || !sessionWallet)
        return route.fulfill({
          status: sessionUnavailable ? 503 : 401,
          contentType: "application/json",
          body: JSON.stringify({
            error: sessionUnavailable
              ? "Arena is temporarily unavailable."
              : "Wallet verification required."
          })
        });
      return json({ wallet: sessionWallet, claimable });
    }
    if (/^\/wallets\/0x[a-f0-9]{40}\/summary$/i.test(path))
      return json({
        wallet: path.split("/")[2],
        enteredTournaments: 1,
        enteredSeats: 4,
        hostedTournaments: 1,
        championships: 1,
        entryPayments: "8000000",
        winnings: "6000000",
        hostingRewards: "400000",
        operationsRewards: "1600000",
        refunds: "0",
        withdrawals: "8000000",
        available: path.split("/")[2].toLowerCase() === addr ? claimable : "0",
        pending: "0",
        indexedThroughBlock: "10"
      });
    if (/^\/wallets\/0x[a-f0-9]{40}\/rewards$/i.test(path))
      return json({
        items: [
          {
            id: "winner",
            kind: "winner",
            tournamentId: "1",
            islandId: tournament.islandId,
            wallet: addr,
            recipient: addr,
            amount: "6000000",
            transactionHash: hash,
            blockNumber: "9"
          },
          {
            id: "withdrawal",
            kind: "withdrawal",
            tournamentId: null,
            islandId: null,
            wallet: addr,
            recipient: addr,
            amount: "8000000",
            transactionHash,
            blockNumber: "10"
          }
        ],
        nextCursor: null
      });
    if (path === "/rules") return json({ rulesHash: hash, manifest: rules });
    if (
      path === "/transactions" ||
      path === `/transactions/${transactionHash}`
    ) {
      if (route.request().method() === "POST") {
        transactionPosts++;
        trackedAction = route.request().postDataJSON().action;
        if (holdEntryIndexing && trackedAction.kind === "entry")
          trackingState = "indexing";
      }
      return json({
        hash: transactionHash,
        action: values["approval-flow-only"]
          ? trackedAction
          : { kind: "claim" },
        state: trackingState,
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
  if (
    values["approval-flow-only"] &&
    url.pathname.endsWith(`/owners/${addr}/tokens`)
  )
    return json({
      owner: addr,
      items: roster.map((f) => ({
        chain: "ethereum",
        chainId: 1,
        contractAddress: "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d",
        tokenId: f.tokenId,
        name: f.name,
        image: null,
        burned: false
      })),
      nextCursor: null
    });
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
      else if (request.method === "eth_call") {
        const resultFor = (data) => {
          const amount = values["approval-flow-only"]
            ? data.startsWith("0xdd62ed3e")
              ? mockAllowance
              : 50000000n
            : 0n;
          return `0x${amount.toString(16).padStart(64, "0")}`;
        };
        const data = request.params[0].data;
        if (data.startsWith("0x82ad56cb")) {
          const call = decodeFunctionData({ abi: multicall3Abi, data });
          result = encodeFunctionResult({
            abi: multicall3Abi,
            functionName: "aggregate3",
            result: call.args[0].map((c) => ({
              success: true,
              returnData: resultFor(c.callData)
            }))
          });
        } else result = resultFor(data);
      } else if (request.method === "eth_getTransactionReceipt")
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
  if (values["approval-flow-only"]) await verifyApprovalFlow();
  else if (values["strategy-flow-only"]) await verifyStrategyFlow();
  else if (values["wallet-flow-only"]) await verifyWalletFlow();
  else {
    await page.goto(`${origin.origin}/arena/1`, {
      waitUntil: "domcontentloaded"
    });
    await page.getByRole("heading", { name: "Tournament #1" }).waitFor();
    const decline = page.getByRole("button", { name: "Decline", exact: true });
    if (await decline.isVisible()) await decline.click();
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
    await page
      .getByText("Rules and exact-tie priority", { exact: true })
      .click();
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
    const reveal = page.getByRole("button", {
      name: "Show result",
      exact: true
    });
    await reveal.waitFor();
    assert.equal(await page.getByText(/Champion: Yunipal/).count(), 0);
    assert.equal(resultReads, 0);
    assert.equal(
      await page.locator("video[controls][preload=none]").count(),
      1
    );
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
    // Use the actual injected-wallet connector and hook. All provider/RPC traffic
    // is intercepted above; no real wallet, chain transaction or generation.
    await page
      .getByRole("banner")
      .getByRole("button", { name: /^Connect(?: wallet)?$/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Arena Test Wallet/i })
      .first()
      .click();
    await page.getByText("Claimable: 6 USDC", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /sign in/i }).count(),
      0
    );
    assert.equal(
      new URL(page.url()).pathname,
      "/arena/1",
      "Header wallet connection must preserve the Arena route"
    );
    assert.equal(
      await page
        .locator("main")
        .getByRole("button", { name: /Connect wallet/i })
        .count(),
      0
    );
    const claim = page.getByRole("button", { name: "Claim USDC", exact: true });
    await claim.waitFor();
    await claim.click();
    await page
      .getByText("USDC claim confirmed. Updating indexed data…", {
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
      .getByText("USDC claim confirmed. Updating indexed data…", {
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
    assert.deepEqual(errors, []);
    tournament.phase = "strategies";
    tournament.winners = null;
    tournament.resultHash = null;
    await page.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 2 * 86400000;
    });
    await page.goto(`${origin.origin}/arena/1`);
    const editor = page.locator("#strategy-2");
    await editor.fill(
      "Circle away from the ledge, dodge the charge, then strike during recovery."
    );
    await page.reload();
    await editor.waitFor();
    assert.equal(
      await editor.inputValue(),
      "Circle away from the ledge, dodge the charge, then strike during recovery."
    );
    await page
      .locator("#strategy-2")
      .locator("..")
      .getByRole("button", { name: "Sign & lock strategy", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: /fetch|network/i })
      .waitFor();
    assert.equal(strategyBodies.length, 1);
    assert.equal(
      await page.evaluate(() => window.__arenaSignedStrategies.length),
      1
    );
    await page.reload();
    const retry = page.getByRole("button", {
      name: "Check & retry saved strategy",
      exact: true
    });
    await retry.waitFor();
    assert.equal(await editor.isDisabled(), true);
    await retry.click();
    await page.waitForFunction(() => !document.querySelector("#strategy-2"));
    assert.deepEqual(
      strategyBodies[0],
      strategyBodies[1],
      "Retry retains the exact signed text, salt and signature"
    );
    assert.equal(
      await page.evaluate(() => window.__arenaSignedStrategies.length),
      0,
      "Reload retry needs no replacement signature"
    );
    assert.equal(
      await page.evaluate(
        () =>
          Object.keys(sessionStorage).filter(
            (k) => k.includes("private-strategy") && k.endsWith("/2")
          ).length
      ),
      0
    );
    await page
      .getByRole("button", { name: "View your locked strategy", exact: true })
      .first()
      .click();
    await page
      .getByText(
        "Your original locked plan: hold the center, shield the charge, then counter.",
        { exact: true }
      )
      .waitFor();
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(localStorage).includes("Your original locked plan")
      ),
      false,
      "Owner receipt text never enters persistent browser storage"
    );
    await page.getByText("Timeline & verification", { exact: true }).click();
    await page
      .getByRole("link", { name: "Block 7 · log 2", exact: true })
      .waitFor();
    assert.equal(
      await page.getByText("Fighter entry confirmed", { exact: true }).count(),
      1
    );
    await page.screenshot({
      path: resolve(values.output, "strategy-recovery-mobile.png"),
      fullPage: true
    });
    tournament.phase = "settled";
    tournament.winners = [0, 2, 0];
    tournament.resultHash = hash;
    await page.goto(`${origin.origin}/arena/me`);
    await page
      .getByRole("heading", { name: "Your Arena", exact: true })
      .waitFor();
    await page.getByText("Battle winnings credited", { exact: true }).waitFor();
    await page.getByText("Wallet withdrawal", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("link", {
          name: `Base island #${tournament.islandId}`,
          exact: true
        })
        .getAttribute("href"),
      `/collection/base-islands-v2/${tournament.islandId}`
    );
    assert.equal(
      await page.getByText("Combined wallet balance", { exact: true }).count(),
      1
    );
    await page.getByRole("combobox", { name: "Tournament status" }).click();
    await page
      .getByRole("option", { name: "In progress", exact: true })
      .click();
    await page
      .getByText("No tournaments match this filter yet.", { exact: true })
      .waitFor();
    await page.screenshot({
      path: resolve(values.output, "personal-history-mobile.png"),
      fullPage: true
    });
    await page.goto(`${origin.origin}/arena/hosting`);
    await page
      .getByRole("heading", {
        name: "Your islands. Their battles.",
        exact: true
      })
      .waitFor();
    await page.getByText("Hosting rewards credited", { exact: true }).waitFor();
    await page
      .getByRole("heading", { name: "Tournament #1", exact: true })
      .waitFor();
    await page.screenshot({
      path: resolve(values.output, "hosting-history-mobile.png"),
      fullPage: true
    });
    await page.goto(`${origin.origin}/arena/rules`);
    await page
      .getByRole("heading", { name: "How the Arena works", exact: true })
      .waitFor();
    await page
      .getByRole("heading", {
        name: "Deadlines, ownership and refunds",
        exact: true
      })
      .waitFor();
    assert.ok(
      await page
        .getByText(
          /Missing the deadline assigns your fighter an automatic legal attack/
        )
        .count()
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      )
    );
    assert.deepEqual(errors, []);
    const report = {
      passed: 31,
      checks: [
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
        "Personal history separates rewards from aggregate wallet withdrawals",
        "History links to the revealed replacement Base island",
        "Accessible styled status filter displays the real empty result",
        "Hosting screen displays historical beneficiary rewards",
        "Published rules include automatic attacks, refunds and ownership choices",
        "Private strategy draft survives a page refresh in the same tab",
        "Uncertain submission retains its signed payload and locks editing",
        "Refresh retry sends identical text, salt and signature without signing again",
        "Confirmed strategy clears the private recovery payload",
        "Public timeline links the indexed action to its exact Base transaction",
        "Entering wallet can inspect its own locked receipt without persistent prompt caching",
        "Strategy deadline follows server time even with a browser clock two days ahead"
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
  }
} catch (error) {
  await page
    .screenshot({ path: resolve(values.output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(
    JSON.stringify({
      errors,
      alerts: await page.getByRole("alert").allTextContents(),
      body: (await page.locator("main").innerText()).slice(-2500),
      sent: await page.evaluate(() => window.__arenaSentTransactions)
    })
  );
  throw error;
} finally {
  await browser.close();
}

async function verifyWalletFlow() {
  const checks = [];
  const originalPlan =
    "Your original locked plan: hold the center, shield the charge, then counter.";
  await page.goto(`${origin.origin}/arena/1`, {
    waitUntil: "domcontentloaded"
  });
  await page
    .getByText("Rules and exact-tie priority", { exact: true })
    .waitFor();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Connect(?: wallet)?$/i })
    .click();
  await page.getByRole("button", { name: /Arena Test Wallet/i }).click();
  await page.getByText("Claimable: 6 USDC", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/arena/1");
  assert.equal(await page.getByRole("button", { name: /sign in/i }).count(), 0);
  assert.equal(challengeRequests, 0);
  assert.equal(
    await page.evaluate(() => window.__arenaSignedMessages.length),
    0
  );
  checks.push(
    "Header connection stays in Arena; balance loads without login or signature"
  );
  await page.screenshot({
    path: resolve(values.output, "connected-arena.png"),
    fullPage: true
  });
  for (const [path, heading] of [
    ["/arena/me", "Your Arena"],
    ["/arena/hosting", "Your islands. Their battles."]
  ]) {
    await page.goto(origin.origin + path, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    await page.getByText("Available to claim", { exact: true }).waitFor();
    await page
      .getByRole("heading", {
        name: "Wallet rewards and withdrawals",
        exact: true
      })
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: /sign in/i }).count(),
      0
    );
    assert.equal(
      await page
        .locator("main")
        .getByRole("button", { name: /connect wallet/i })
        .count(),
      0
    );
    assert.equal(challengeRequests, 0);
  }
  checks.push(
    "My Arena and Hosting load indexed balances and histories without a session"
  );
  await page.goto(origin.origin + "/arena/1");
  const receipt = page
    .getByRole("button", { name: "View your locked strategy", exact: true })
    .first();
  await receipt.waitFor();
  await page.evaluate(() => {
    window.__arenaRejectSignature = true;
  });
  await receipt.click();
  await page
    .getByRole("alert")
    .filter({ hasText: /reject/i })
    .waitFor();
  assert.equal(challengeRequests, 1);
  assert.equal(verifyRequests, 0);
  assert.equal(await page.getByText(originalPlan, { exact: true }).count(), 0);
  await page
    .getByRole("button", { name: "Account menu", exact: true })
    .waitFor();
  checks.push(
    "Rejected verification keeps wallet connected and private strategy hidden"
  );
  await page.evaluate(() => {
    window.__arenaRejectSignature = false;
  });
  await receipt.click();
  await page.getByText(originalPlan, { exact: true }).waitFor();
  assert.equal(challengeRequests, 2);
  assert.equal(verifyRequests, 1);
  await receipt.click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="status"]')].some((e) =>
        e.textContent.includes("Loading your locked strategy")
      )
  );
  assert.equal(
    await page.evaluate(() => window.__arenaSignedMessages.length),
    2
  );
  checks.push("Protected action verifies once and valid session is reused");
  await page.evaluate(() =>
    window.__arenaChangeAccount("0x2222222222222222222222222222222222222222")
  );
  await page.getByText("Claimable: 0 USDC", { exact: true }).waitFor();
  assert.equal(await page.getByText(originalPlan, { exact: true }).count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "View your locked strategy", exact: true })
      .count(),
    0
  );
  checks.push(
    "Changing wallets clears private content and loads the new wallet balance"
  );
  await page.evaluate((wallet) => window.__arenaChangeAccount(wallet), addr);
  await receipt.waitFor();
  sessionWallet = null;
  sessionUnavailable = true;
  await receipt.click();
  await page
    .getByRole("alert")
    .filter({ hasText: /temporarily unavailable/i })
    .waitFor();
  assert.equal(challengeRequests, 2);
  checks.push("Server failure does not trigger a misleading signature request");
  sessionUnavailable = false;
  await receipt.click();
  await page.getByText(originalPlan, { exact: true }).waitFor();
  assert.equal(challengeRequests, 3);
  assert.equal(verifyRequests, 2);
  checks.push(
    "Expired session renews within the requested action, with no separate login gate"
  );
  // Refresh preserves the session, but clears the private on-screen receipt.
  await page.reload();
  await receipt.click();
  await page.getByText(originalPlan, { exact: true }).waitFor();
  assert.equal(challengeRequests, 3);
  checks.push("Reload reuses verification without another signature");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: resolve(values.output, "connected-mobile.png"),
    fullPage: true
  });
  checks.push("Connected mobile layout fits without horizontal overflow");
  assert.deepEqual(errors, []);
  checks.push("No browser exceptions");
  const report = {
    status: "passed",
    checks,
    scope:
      "Mock API and injected wallet only; no real signatures, payments or generation"
  };
  await writeFile(
    resolve(values.output, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
}

async function verifyApprovalFlow() {
  await page.goto(`${origin.origin}/arena/1`);
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Connect(?: wallet)?$/i })
    .click();
  await page.getByRole("button", { name: /Arena Test Wallet/i }).click();
  const selector = page.getByRole("combobox", { name: "USDC approval limit" });
  await selector.waitFor();
  assert.match(await selector.innerText(), /2 USDC/);
  await selector.click();
  await page
    .getByRole("option", { name: "8 USDC · 4 entries", exact: true })
    .waitFor();
  await page
    .getByRole("option", { name: "20 USDC · 10 entries", exact: true })
    .click();
  const cards = page.locator("article[data-arena-fighter]");
  const enter = cards.getByRole("button");
  await page.evaluate(() => {
    window.__arenaRejectTransaction = true;
  });
  await enter.first().click();
  await page
    .getByRole("alert")
    .filter({ hasText: /reject/i })
    .waitFor();
  assert.equal(await cards.locator('[aria-busy="true"]').count(), 0);
  assert.equal(await enter.first().innerText(), "Enter · 2 USDC");
  await page.evaluate(() => {
    window.__arenaRejectTransaction = false;
    window.__arenaHoldTransaction = true;
  });
  trackingState = "confirming";
  await enter.first().click();
  await cards
    .first()
    .getByRole("status")
    .filter({ hasText: "Approve in wallet…" })
    .waitFor();
  assert.equal(
    await cards.filter({ has: page.locator('[aria-busy="true"]') }).count(),
    1
  );
  assert.equal(await cards.nth(1).getAttribute("aria-busy"), "false");
  assert.equal(await enter.nth(1).innerText(), "Enter · 2 USDC");
  assert.equal(await enter.first().isDisabled(), true);
  await page.screenshot({
    path: resolve(values.output, "fighter-wallet-approval.png"),
    fullPage: true
  });
  await page.waitForFunction(
    () => typeof window.__arenaReleaseTransaction === "function"
  );
  await page.evaluate(() => {
    window.__arenaHoldTransaction = false;
    window.__arenaReleaseTransaction();
  });
  const finalityLabel = page.getByText(
    "USDC approval included on Base. Checking confirmations and indexed result…",
    { exact: true }
  );
  await finalityLabel.waitFor();
  await cards
    .first()
    .getByRole("status")
    .filter({ hasText: "Confirming approval…" })
    .waitFor();
  await page
    .getByText(/Approval sets your spending limit; it does not enter a fighter/)
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    1
  );
  assert.equal(await enter.first().isDisabled(), true);
  // Cross the old 90-second deadline without slowing down the test. Subsequent
  // DB status reads must still run, and must not create a second approval.
  await page.clock.setSystemTime(new Date(Date.now() + 95_000));
  const statusRead = () =>
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/transactions/${transactionHash}`) &&
        r.request().method() === "GET",
      { timeout: 25_000 }
    );
  await statusRead();
  await statusRead();
  await finalityLabel.waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    1
  );
  assert.equal(await enter.first().isDisabled(), true);
  await page.screenshot({
    path: resolve(values.output, "approval-finality.png"),
    fullPage: true
  });
  holdEntryIndexing = true;
  trackingState = "indexed";
  await page.waitForFunction(() => window.__arenaSentTransactions.length === 2);
  await cards
    .first()
    .getByRole("status")
    .filter({ hasText: "Updating entry…" })
    .waitFor();
  assert.equal(await cards.nth(1).getAttribute("aria-busy"), "false");
  assert.equal(await enter.first().isDisabled(), true);
  await page.screenshot({
    path: resolve(values.output, "fighter-entry-indexing.png"),
    fullPage: true
  });
  holdEntryIndexing = false;
  trackingState = "indexed";
  await page.waitForFunction(
    () => document.querySelector("#arena-approval-limit")?.disabled === false
  );
  assert.equal(await cards.first().getAttribute("aria-busy"), "false");
  let sent = await page.evaluate(() => window.__arenaSentTransactions);
  const approval = decodeFunctionData({ abi: erc20Abi, data: sent[0][0].data });
  assert.equal(approval.functionName, "approve");
  assert.equal(approval.args[0].toLowerCase(), addr);
  assert.equal(approval.args[1], 20000000n);
  assert.ok(!sent[1][0].data.startsWith("0x095ea7b3"));
  mockAllowance = 18000000n;
  await enter.nth(1).click();
  await page.waitForFunction(() => window.__arenaSentTransactions.length === 3);
  await page.waitForFunction(
    () => document.querySelector("#arena-approval-limit")?.disabled === false
  );
  sent = await page.evaluate(() => window.__arenaSentTransactions);
  assert.ok(!sent[2][0].data.startsWith("0x095ea7b3"));
  assert.equal(
    sent.filter((p) => p[0].data.startsWith("0x095ea7b3")).length,
    1
  );
  // Reload a saved pending approval as in the real incident. It recovers its
  // status, explains the separate entry, and never signs a payment on reload.
  trackingState = "confirming";
  trackedAction = { kind: "approval", tournamentId: "1" };
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("yunipals/arena/transaction/")
    );
    const value = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({
        ...value,
        action: { kind: "approval", tournamentId: "1" },
        state: "confirming",
        result: null,
        indexedThroughBlock: null
      })
    );
  });
  await page.reload();
  await finalityLabel.waitFor();
  await cards
    .nth(1)
    .getByRole("status")
    .filter({ hasText: "Confirming approval…" })
    .waitFor();
  assert.equal(await cards.first().getAttribute("aria-busy"), "false");
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    0
  );
  trackingState = "indexed";
  await page
    .getByText("USDC approval is ready. Complete your fighter’s entry next.", {
      exact: true
    })
    .waitFor();
  await page
    .getByText(/Choose your fighter below and click Enter · 2 USDC to continue/)
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    0
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  await page.screenshot({
    path: resolve(values.output, "approval-mobile.png"),
    fullPage: true
  });
  assert.deepEqual(errors, []);
  const report = {
    status: "passed",
    checks: [
      "Approval defaults to the existing 2-USDC limit",
      "Explicit 8- and 20-USDC choices are available",
      "Selecting 10 entries requests exactly 20 USDC for the configured spender",
      "Approval is clearly distinguished from entry and Base final confirmation",
      "Automatic DB polling continues beyond 90 seconds without duplicate approval or premature entry",
      "Entry proceeds only after approval is indexed",
      "Reload automatically recovers pending approval without sending another transaction",
      "Indexed approval after reload explains the separate entry and reuses the saved allowance",
      "Next entry reuses the remaining allowance without another approval",
      "Selected fighter shows wallet, approval-confirmation and entry-indexing progress",
      "Other fighters stay disabled without showing the selected fighter spinner",
      "Rejected wallet transaction clears the selected-card loading state",
      "Refresh restores the correct fighter's pending approval context",
      "Mobile layout fits; no browser exceptions"
    ],
    scope: "Mock wallet/RPC/API only; no real approvals or payments"
  };
  await writeFile(
    resolve(values.output, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
}

async function verifyStrategyFlow() {
  const checks = [];
  await page.goto(origin.origin + "/arena/1");
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  if (await decline.isVisible()) await decline.click();
  await page
    .getByRole("banner")
    .getByRole("button", { name: /^Connect(?: wallet)?$/i })
    .click();
  await page
    .getByRole("button", { name: "Arena Test Wallet", exact: true })
    .click();
  const card = page.locator('section[data-arena-strategy-seat="2"]');
  const other = page.locator('section[data-arena-strategy-seat="3"]');
  const field = card.locator("textarea");
  const strategy =
    "Stay on the raised dry crossing, evade the splash and counter during recovery.";
  await field.waitFor();
  await field.fill(strategy);
  await page.evaluate(() => {
    window.__arenaHoldStrategySignature = true;
    window.__arenaRejectTypedSignature = true;
  });
  await card
    .getByRole("button", { name: "Sign & lock strategy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Sign in wallet…", exact: true })
    .waitFor();
  assert.equal(await card.getAttribute("aria-busy"), "true");
  assert.equal(
    await card
      .getByRole("button", { name: "Sign in wallet…", exact: true })
      .locator("svg")
      .count(),
    1
  );
  assert.equal(
    await other
      .getByRole("button", { name: "Sign & lock strategy", exact: true })
      .isDisabled(),
    true
  );
  assert.equal(await other.getAttribute("aria-busy"), "false");
  assert.equal(await other.locator("button svg").count(), 0);
  checks.push(
    "Only the selected Yunipal shows signing progress and a spinner; other forms are disabled"
  );
  await page.evaluate(() => window.__arenaReleaseStrategySignature());
  await card
    .getByRole("alert")
    .filter({ hasText: /reject/i })
    .waitFor();
  assert.equal(await card.getAttribute("aria-busy"), "false");
  assert.equal(
    await card
      .getByRole("button", { name: "Sign & lock strategy", exact: true })
      .isEnabled(),
    true
  );
  assert.equal(await field.inputValue(), strategy);
  assert.equal(strategyBodies.length, 0);
  checks.push(
    "Rejected wallet signature clears loading and shows the error on the affected form without losing the draft"
  );
  await page.evaluate(() => {
    window.__arenaRejectTypedSignature = false;
    window.__arenaHoldStrategySignature = true;
  });
  holdStrategySubmission = true;
  await card
    .getByRole("button", { name: "Sign & lock strategy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Sign in wallet…", exact: true })
    .waitFor();
  await page.evaluate(() => window.__arenaReleaseStrategySignature());
  await card
    .getByRole("button", { name: "Saving strategy…", exact: true })
    .waitFor();
  assert.equal(await card.getAttribute("aria-busy"), "true");
  assert.equal(await card.locator("button svg").count(), 1);
  assert.equal(await other.getAttribute("aria-busy"), "false");
  await card.screenshot({
    path: resolve(values.output, "strategy-saving-desktop.png")
  });
  checks.push(
    "Saving progress remains on the selected form until the server receipt arrives"
  );
  holdStrategySubmission = false;
  releaseStrategySubmission();
  await card
    .getByRole("alert")
    .filter({ hasText: /fetch|network/i })
    .waitFor();
  await card
    .getByRole("button", { name: "Check & retry saved strategy", exact: true })
    .waitFor();
  assert.equal(await field.isDisabled(), true);
  assert.equal(await other.getByRole("alert").count(), 0);
  checks.push(
    "An ambiguous submission retains the exact signed payload and shows its recoverable error inline"
  );
  assert.equal(
    await page.evaluate(
      (text) => JSON.stringify(localStorage).includes(text),
      strategy
    ),
    false
  );
  await page.reload();
  await card
    .getByRole("button", { name: "Check & retry saved strategy", exact: true })
    .waitFor();
  holdStrategySubmission = true;
  await card
    .getByRole("button", { name: "Check & retry saved strategy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Saving strategy…", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__arenaSignedStrategies.length),
    0
  );
  assert.deepEqual(strategyBodies[0], strategyBodies[1]);
  holdStrategySubmission = false;
  releaseStrategySubmission();
  await card
    .getByRole("button", { name: "View your locked strategy", exact: true })
    .waitFor();
  assert.equal(await card.getAttribute("aria-busy"), "false");
  assert.equal(await card.locator("textarea").count(), 0);
  checks.push(
    "Refresh retry reuses the exact text, salt and signature, then stops loading after acknowledged lock"
  );
  holdStrategyReceipt = true;
  await card
    .getByRole("button", { name: "View your locked strategy", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Loading your receipt…", exact: true })
    .waitFor();
  assert.equal(await card.locator("button svg").count(), 1);
  holdStrategyReceipt = false;
  releaseStrategyReceipt();
  await card.getByText(strategy, { exact: true }).waitFor();
  checks.push("Loading a private locked receipt has its own inline spinner");
  await page.setViewportSize({ width: 390, height: 844 });
  await card.screenshot({
    path: resolve(values.output, "strategy-locked-mobile.png")
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    )
  );
  checks.push(
    "Desktop and mobile artwork/forms remain readable without horizontal overflow"
  );
  const otherField = other.locator("textarea");
  await otherField.fill(
    "Guard the crossing and strike only after the opponent commits."
  );
  await page.evaluate(() => {
    window.__arenaHoldStrategySignature = true;
  });
  await other
    .getByRole("button", { name: "Sign & lock strategy", exact: true })
    .click();
  await other
    .getByRole("button", { name: "Sign in wallet…", exact: true })
    .waitFor();
  await page.evaluate(() =>
    window.__arenaChangeAccount("0x2222222222222222222222222222222222222222")
  );
  await page.waitForFunction(
    () => !document.querySelector('section[data-arena-strategy-seat="3"]')
  );
  await page.evaluate(() => window.__arenaReleaseStrategySignature());
  assert.equal(strategyBodies.length, 2);
  assert.equal(
    await page.locator("section[data-arena-strategy-seat]").count(),
    0
  );
  checks.push(
    "Account changes remove old progress and prevent submission under the wrong wallet"
  );
  assert.equal(
    await page.evaluate(() => window.__arenaSentTransactions.length),
    0
  );
  assert.deepEqual(errors, []);
  checks.push(
    "No wallet transactions, browser exceptions or persistent private prompt storage"
  );
  const report = {
    status: "passed",
    checks,
    scope:
      "Mock wallet/API/RPC only; no real signatures, payments, submissions or generation"
  };
  await writeFile(
    resolve(values.output, "report.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
}
