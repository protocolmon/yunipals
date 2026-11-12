import assert from "node:assert/strict";
import { verifyGuidedAirdrop } from "./test-portal-airdrop-browser.mjs";

/** Real local receipts; keep the indexer stopped between each wallet action
 * and its success notice, including both delivery chunks of one mint request. */
export async function verifyPortalAdminBrowser({
  browser,
  visitor,
  origin,
  rpc,
  adminWallet,
  chain,
  wrapper,
  call,
  ledger
}) {
  await visitor.goto(`${origin}/portals/admin`);
  await visitor
    .getByRole("heading", { name: "Portal administration", exact: true })
    .waitFor();
  assert.equal(
    await visitor
      .getByRole("button", { name: "Save portal kind", exact: true })
      .isDisabled(),
    true
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 }
  });
  const page = await context.newPage();
  const owner = adminWallet.account.address;
  const walletBehavior = {
    rejectNext: false,
    forgetNext: false,
    sends: 0,
    lastHash: null
  };
  try {
    await page.exposeFunction(
      "portalAdminWallet",
      async ({ method, params = [] }) => {
        if (["eth_accounts", "eth_requestAccounts"].includes(method))
          return [owner];
        if (method === "eth_chainId") return "0x2105";
        if (
          ["wallet_getPermissions", "wallet_requestPermissions"].includes(
            method
          )
        )
          return [{ parentCapability: "eth_accounts" }];
        if (method === "eth_sendTransaction") {
          assert.equal(params[0].from.toLowerCase(), owner.toLowerCase());
          if (walletBehavior.rejectNext) {
            walletBehavior.rejectNext = false;
            return { fixtureRejected: true };
          }
          walletBehavior.sends++;
          const hash = await adminWallet.sendTransaction({
            to: params[0].to,
            data: params[0].data,
            value: BigInt(params[0].value ?? "0x0"),
            ...(params[0].gas ? { gas: BigInt(params[0].gas) } : {})
          });
          walletBehavior.lastHash = hash;
          if (walletBehavior.forgetNext) {
            walletBehavior.forgetNext = false;
            return { fixtureForgot: true };
          }
          return hash;
        }
        const response = await fetch(rpc, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        const result = await response.json();
        if (result.error) throw new Error("Local admin RPC error.");
        return result.result;
      }
    );
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        isMetaMask: true,
        request: async (input) => {
          const result = await window.portalAdminWallet(input);
          if (result?.fixtureRejected)
            throw Object.assign(new Error("User rejected the request"), {
              code: 4001
            });
          if (result?.fixtureForgot)
            throw new Error("Wallet connection lost after submission");
          return result;
        },
        on: (name, listener) => listeners.set(name, listener),
        removeListener: (name) => listeners.delete(name)
      };
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort()
    );
    await page.goto(`${origin}/portals/admin`);
    await page
      .getByRole("heading", { name: "Portal administration", exact: true })
      .waitFor();
    const connect = page.getByRole("button", {
      name: "Connect admin wallet",
      exact: true
    });
    if (await connect.isVisible()) await connect.click();
    const injected = page
      .getByRole("button", { name: /Browser Wallet|MetaMask|Injected/i })
      .first();
    if (await injected.isVisible().catch(() => false)) await injected.click();
    const kind = page.locator("form").filter({
      has: page.getByRole("heading", { name: "Portal kind", exact: true })
    });
    await kind.getByLabel("Name", { exact: true }).fill("Test Rainbow Portal");
    await kind
      .getByLabel("TCG card image URL", { exact: true })
      .fill("https://portal.example.test/rainbow.png");
    await kind
      .getByLabel("Card image SHA-256 hash", { exact: true })
      .fill(`0x${"1".repeat(64)}`);
    await kind
      .getByLabel("Lifetime cap (up to 1,000)", { exact: true })
      .fill("40");
    const pending = async (label) =>
      page
        .getByRole("listitem")
        .filter({ has: page.getByText(label, { exact: true }) })
        .last()
        .getByText(
          "Confirmed. The data update is still pending; your transaction is saved.",
          { exact: true }
        )
        .waitFor();
    await kind
      .getByRole("button", { name: "Save portal kind", exact: true })
      .click();
    await pending("Configure portal kind");
    assert.equal(
      await page.getByText("Portal kind 2 saved.", { exact: true }).count(),
      0
    );
    await ledger.tick();
    await page.getByText("Portal kind 2 saved.", { exact: true }).waitFor();
    const mint = page.locator("form").filter({
      has: page.getByRole("button", { name: "Request airdrop", exact: true })
    });
    await mint.locator("input").fill("2");
    await mint
      .getByLabel("Recipient wallets", { exact: true })
      .fill(Array(35).fill(owner).join("\n"));
    await mint
      .getByRole("button", { name: "Request airdrop", exact: true })
      .click();
    await pending("Commit portal mint");
    await ledger.tick();
    await page
      .getByText(
        "Airdrop committed. Finish revealing after randomness arrives.",
        { exact: true }
      )
      .waitFor();
    const id = await page
      .getByLabel("Mint request number", { exact: true })
      .inputValue();
    assert.match(id, /^[1-9][0-9]*$/);
    const finish = page.getByRole("button", {
      name: "Reveal next 32 portals",
      exact: true
    });
    assert.equal(await finish.isDisabled(), true);
    await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
      BigInt(id),
      194n
    ]);
    await page.reload();
    await page
      .getByRole("button", {
        name: `Request #${id}: 0 / 35 delivered`,
        exact: true
      })
      .click();
    assert.equal(await finish.isDisabled(), true);
    await ledger.tick();
    await page
      .getByText("0 / 35 portals delivered. Ready for the next delivery.", {
        exact: true
      })
      .waitFor();
    await finish.click();
    await pending("Deliver portal NFTs");
    await ledger.tick();
    await page
      .getByText("32 / 35 portals delivered. Ready for the next delivery.", {
        exact: true
      })
      .waitFor();
    await page.reload();
    await page
      .getByRole("button", {
        name: `Request #${id}: 32 / 35 delivered`,
        exact: true
      })
      .click();
    await page
      .getByText("32 / 35 portals delivered. Ready for the next delivery.", {
        exact: true
      })
      .waitFor();
    await finish.click();
    await pending("Deliver portal NFTs");
    await ledger.tick();
    await page
      .getByText("35 / 35 portals delivered. Airdrop complete.", {
        exact: true
      })
      .waitFor();
    assert.equal(await finish.isDisabled(), true);
    const fees = page.locator("form").filter({
      has: page.getByRole("heading", {
        name: "Fees and AI recipient",
        exact: true
      })
    });
    await fees.getByLabel("Portal kind number", { exact: true }).fill("2");
    await fees.getByLabel("AI recipient wallet", { exact: true }).fill(owner);
    await fees
      .getByRole("button", { name: "Update pricing", exact: true })
      .click();
    await pending("Update future portal fees");
    assert.equal(
      await page
        .getByText("Pricing updated for future submissions.", { exact: true })
        .count(),
      0
    );
    await ledger.tick();
    await page
      .getByText("Pricing updated for future submissions.", { exact: true })
      .waitFor();
    await page.screenshot({
      path: "/tmp/yunipals-portal-admin-desktop.png",
      fullPage: true
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    );
    await page.screenshot({
      path: "/tmp/yunipals-portal-admin-mobile.png",
      fullPage: true
    });
    await page.goto(`${origin}/portals`);
    await page
      .getByRole("button", { name: "Prepare the next portal", exact: true })
      .click();
    await pending("Request next portal");
    const before = await chain.active();
    assert.equal(before.rotation.ready, false);
    await ledger.tick();
    await page
      .getByRole("listitem")
      .filter({ has: page.getByText("Request next portal", { exact: true }) })
      .getByText("Confirmed and indexed.", { exact: true })
      .waitFor();
    await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
      before.rotation.requestId,
      399n
    ]);
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "evm_increaseTime",
        params: [661]
      })
    });
    assert.equal((await response.json()).error, undefined);
    await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "evm_mine",
        params: []
      })
    });
    await page.reload();
    const activate = page.getByRole("button", {
      name: "Open the next portal",
      exact: true
    });
    await activate.waitFor();
    assert.equal(await activate.isDisabled(), true);
    await ledger.tick();
    await activate.click();
    await pending("Activate next portal");
    assert.equal(
      await page
        .getByRole("button", { name: "Wait for an open portal", exact: true })
        .isDisabled(),
      true
    );
    await ledger.tick();
    await page
      .getByRole("listitem")
      .filter({ has: page.getByText("Activate next portal", { exact: true }) })
      .getByText("Confirmed and indexed.", { exact: true })
      .waitFor();
    const after = await chain.active();
    assert.equal(after.round.id, before.round.id + 1n);
    assert.equal(after.round.endsAt - after.round.startsAt, 660n);
    assert.notEqual(after.round.portalId, before.round.portalId);
    await verifyGuidedAirdrop({
      page,
      origin,
      chain,
      call,
      wrapper,
      ledger,
      owner,
      walletBehavior
    });
  } catch (error) {
    console.error(
      "Admin browser alerts:",
      await page.getByRole("alert").allTextContents()
    );
    await page.screenshot({
      path: "/tmp/yunipals-portal-admin-failure.png",
      fullPage: true
    });
    throw error;
  } finally {
    await context.close();
  }
}
