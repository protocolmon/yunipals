import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  portalModels,
  rainbowPortalGradingCase
} from "@protopals/yunipals-market-core/portals";
import {
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import { decodeFunctionData } from "viem";
import { PortalWorker } from "../lib/portals/worker.js";
import { resolvePortalGradingCase } from "../lib/portals/prompts.js";
import { applyPortalGradingCase } from "../lib/portals/grading.js";

export async function verifyPortalBrowser(context) {
  const {
    page,
    origin,
    rpc,
    app,
    image,
    root,
    alice,
    aliceWallet,
    publicClient,
    chain,
    assets,
    store,
    ledger,
    collection,
    registry,
    wrapper,
    adminWallet,
    call,
    cards,
    usdc,
    grading,
    bob
  } = context;
  const errors = [];
  let rejectNextClaim = true;
  let claimTransactions = 0;
  let approvalTransactions = 0;
  const localRpc = async (method, params = []) => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    const value = await response.json();
    assert(!value.error, `Local RPC ${method} failed`);
    return value.result;
  };
  page.on("response", (response) => {
    if (response.url().includes("action-evidence") && response.status() !== 200)
      console.error("Evidence API status:", response.status());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction(
    "portalTestWallet",
    async ({ method, params = [] }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [alice.address];
      if (method === "eth_chainId") return "0x2105";
      if (
        method === "wallet_getPermissions" ||
        method === "wallet_requestPermissions"
      )
        return [{ parentCapability: "eth_accounts" }];
      if (method === "eth_signTypedData_v4") {
        const value = JSON.parse(params[1]);
        delete value.types.EIP712Domain;
        return alice.signTypedData(value);
      }
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        assert.equal(tx.from.toLowerCase(), alice.address.toLowerCase());
        if (tx.to.toLowerCase() === grading.toLowerCase()) {
          const decoded = decodeFunctionData({
            abi: portalGradingAbi,
            data: tx.data
          });
          if (decoded.functionName === "burnAndClaim") {
            assert.equal(BigInt(tx.value ?? "0x0"), 0n);
            if (rejectNextClaim) {
              rejectNextClaim = false;
              throw new Error("User rejected the request.");
            }
            claimTransactions++;
          }
        }
        if (tx.to.toLowerCase() === usdc.toLowerCase()) approvalTransactions++;
        const transaction = {
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value ?? "0x0"),
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {})
        };
        return aliceWallet.sendTransaction(transaction);
      }
      if (method === "wallet_switchEthereumChain") {
        assert.equal(params[0].chainId, "0x2105");
        return null;
      }
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      const value = await response.json();
      if (value.error) throw new Error("Local wallet RPC failed.");
      return value.result;
    }
  );
  await page.addInitScript(() => {
    const listeners = new Map();
    window.ethereum = {
      isMetaMask: true,
      request: async (input) => {
        try {
          return await window.portalTestWallet(input);
        } catch (error) {
          if (/reject/i.test(error.message))
            throw Object.assign(new Error("User rejected the request."), {
              code: 4001
            });
          throw error;
        }
      },
      on: (name, fn) => listeners.set(name, fn),
      removeListener: (name) => listeners.delete(name)
    };
  });
  const rainbow = await readFile(
    join(
      root,
      "apps/yunipals-home-web/public/images/portals/rainbow-portal-card-v2.png"
    )
  );
  await page.route("https://portal.test/**", async (route) => {
    if (route.request().url().endsWith("/rainbow.png"))
      return route.fulfill({ contentType: "image/png", body: rainbow });
    // Registered original artwork is shared; graded artifacts use the public API boundary.
    if (
      route.request().url() === (await chain.input(1n))[0].uri &&
      (await chain.input(1n).then((result) => result[1] === 0n))
    )
      return route.fulfill({ contentType: "image/png", body: image });
    const response = await app.request(route.request().url());
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer())
    });
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "portal.test"].includes(url.hostname))
      return route.fallback();
    return route.abort();
  });
  await page.goto(`${origin}/portals`);
  await page.getByRole("heading", { name: "Cast your next chapter" }).waitFor();
  await page.getByText("Portal open", { exact: true }).waitFor();
  assert.equal(await page.getByText("0.99 USDC", { exact: true }).count(), 1);
  await page
    .getByRole("heading", { name: "111 spells · grading competition" })
    .waitFor();
  const connect = page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .last();
  if (await connect.isVisible()) await connect.click();
  const injected = page
    .getByRole("button", { name: /Browser Wallet|MetaMask|Injected/i })
    .first();
  if (await injected.isVisible().catch(() => false)) await injected.click();
  await page
    .getByRole("button", { name: "Review your spell", exact: true })
    .waitFor();
  await page.getByLabel("Card number", { exact: true }).fill("1");
  await page
    .getByLabel("Your spell", { exact: true })
    .fill(
      "Create a crown of stained-glass stars, keeping the dragon's friendly face."
    );
  await page
    .getByRole("button", { name: "Review your spell", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("button", { name: "Pay and cast spell", exact: true })
    .click();
  await page
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .first()
    .waitFor();
  assert.equal(
    await page.getByText("Your spell was accepted", { exact: true }).count(),
    0
  );
  await ledger.tick();
  await page
    .getByText("Your spell was accepted", { exact: true })
    .waitFor({ timeout: 30000 })
    .catch(async (error) => {
      console.error(
        "Local portal browser alerts:",
        await page.getByRole("alert").allTextContents()
      );
      console.error(
        "Local portal browser status:",
        await page.getByRole("status").allTextContents()
      );
      await page.screenshot({
        path: "/tmp/yunipals-portals-failure.png",
        fullPage: true
      });
      throw error;
    });
  const request = await chain.request(1n);
  const { parseAbi: metadataAbi } = await import("viem");
  const tokenURI = await publicClient.readContract({
    address: chain.deployment.collection,
    abi: metadataAbi(["function tokenURI(uint256) view returns(string)"]),
    functionName: "tokenURI",
    args: [request.portalId]
  });
  assert(tokenURI.startsWith("data:application/json;base64,"));
  const portalMetadata = JSON.parse(
    Buffer.from(tokenURI.split(",")[1], "base64").toString("utf8")
  );
  assert.equal(portalMetadata.name, `Rainbow Portal #${request.portalId}`);
  assert.equal(
    portalMetadata.attributes.find((trait) => trait.trait_type === "Card type")
      .value,
    "Portal"
  );
  assert.equal(portalMetadata.image, "https://portal.test/rainbow.png");
  assert.match(portalMetadata.description, /Yunipals TCG portal card/);
  assert.equal(request.submitter.toLowerCase(), alice.address.toLowerCase());
  assert.equal(request.payment.aiFee, 245000n);
  assert.equal(request.payment.portalFee, 245000n);
  assert(await store.spell(request.spellCommitment));
  assert.equal((await store.publicHistory("1")).length, 0);
  // Transfer the funded portal to the browser wallet. Its accrued balance follows the NFT.
  assert.equal((await chain.active()).portal.claimable, 245000n);
  await call(collection, "PortalCollection", "transferFrom", [
    adminWallet.account.address,
    alice.address,
    request.portalId
  ]);
  await ledger.tick();
  await page.goto(`${origin}/portals/mine`);
  await page
    .getByRole("heading", { name: "My portals", exact: true })
    .waitFor();
  await page.getByText("0.245 USDC", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Burn portal & claim", exact: true })
    .click();
  const claimDialog = page.getByRole("dialog");
  await claimDialog.waitFor();
  const claimButton = claimDialog.getByRole("button", {
    name: "Burn portal & claim 0.245 USDC",
    exact: true
  });
  assert.equal(await claimButton.isDisabled(), true);
  await claimDialog.getByRole("checkbox").check();
  await claimButton.click();
  await claimDialog
    .getByRole("alert")
    .waitFor()
    .catch(async (error) => {
      console.error(
        "Claim rejection alerts:",
        await page.getByRole("alert").allTextContents()
      );
      console.error(
        "Claim rejection statuses:",
        await page.getByRole("status").allTextContents()
      );
      console.error("Claim dialog:", await claimDialog.allTextContents());
      throw error;
    });
  assert.match(
    await claimDialog.getByRole("alert").textContent(),
    /cancelled|reject/i
  );
  assert.equal(claimTransactions, 0);
  // Keep the second attempt pending, reload, then mine: receipt recovery must survive navigation.
  await localRpc("evm_setAutomine", [false]);
  await claimButton.click();
  await page
    .getByText("Waiting for the burn transaction…", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByText("Waiting for the burn transaction…", { exact: true })
    .waitFor();
  await localRpc("evm_mine");
  await localRpc("evm_setAutomine", [true]);
  await page
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByText(
        `Portal #${request.portalId} burned. You received 0.245 USDC.`,
        { exact: true }
      )
      .count(),
    0
  );
  await page.reload();
  await page
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .first()
    .waitFor();
  await ledger.tick();
  await page
    .getByText(`Portal #${request.portalId} burned. You received 0.245 USDC.`, {
      exact: true
    })
    .waitFor({ timeout: 30000 });
  assert.equal(claimTransactions, 1);
  assert.equal(approvalTransactions, 1);
  assert.equal((await chain.active()).open, false);
  assert.equal((await chain.active()).portal.retired, true);
  assert.equal((await chain.active()).escrow.liability, 0n);
  assert.equal((await chain.active()).supply.live, 2n);
  await ledger.tick();
  const retired = await (
    await app.request(`/v1/portals/tokens/${request.portalId}`)
  ).json();
  assert.equal(retired.token.retired, true);
  assert.equal(retired.totals.claimed, "245000");
  await page.goto(`${origin}/portals/tokens/${request.portalId}`);
  await page
    .getByRole("heading", { name: "Portal redeemed", exact: true })
    .waitFor();
  await page
    .getByText("Burned and claimed 0.245 USDC", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "/tmp/yunipals-portal-claim-desktop.png",
    fullPage: true
  });
  // The accepted job follows the NFT after its owner changes and its portal closes.
  const transfer = await aliceWallet.sendTransaction({
    to: cards,
    data: (await import("viem")).encodeFunctionData({
      abi: (await import("viem")).parseAbi([
        "function transferFrom(address,address,uint256)"
      ]),
      functionName: "transferFrom",
      args: [alice.address, bob, 1n]
    })
  });
  await publicClient.waitForTransactionReceipt({ hash: transfer });
  await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_increaseTime",
      params: [661]
    })
  });
  await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_mine",
      params: []
    })
  });
  assert.equal((await chain.active()).open, false);
  let edits = 0;
  const ai = {
    embed: async () => [1, 0],
    edit: async () => {
      edits++;
      return {
        bytes: image,
        model: portalModels.image,
        usage: { fixture: true }
      };
    },
    originality: async () => ({
      copied: false,
      confidence: "clear",
      meaningfulContribution: true,
      reason: "An original transformation.",
      sources: []
    }),
    grade: async (_spell, _before, _after, context) => ({
      ...applyPortalGradingCase(
        resolvePortalGradingCase(portalModels, context),
        { creativity: 91, harmony: 88, craft: 93, impact: 90 },
        {
          creativity: "Local mock",
          harmony: "Local mock",
          craft: "Local mock",
          impact: "Local mock"
        },
        Object.fromEntries(
          resolvePortalGradingCase(portalModels, context).checks.map(
            (check) => [
              check.id,
              {
                outcome: "met",
                evidence: "Local mock; not a visual quality assessment."
              }
            ]
          )
        )
      ),
      reason: "A coherent star crown.",
      usage: { fixture: true },
      model: portalModels.grading
    })
  };
  const worker = new PortalWorker(
    chain,
    store,
    assets,
    ai,
    portalModels,
    0n,
    0n,
    (id, result) => chain.submit(id, result, adminWallet)
  );
  await worker.tick();
  assert.equal(edits, 1);
  assert.equal((await chain.request(1n)).completed, true);
  assert.equal((await chain.owner(1n)).toLowerCase(), bob.toLowerCase());
  assert.equal((await app.request("/v1/portals/cards/1.json")).status, 503);
  const pendingHistory = await (
    await app.request("/v1/portals/cards/1")
  ).json();
  assert.equal(pendingHistory.history.length, 0);
  assert.equal(pendingHistory.publicationPending, true);
  await ledger.tick();
  const metadata = await (await app.request("/v1/portals/cards/1.json")).json();
  assert.notEqual(metadata.image, metadata.yunipals.rawArtworkURI);
  assert.equal(
    metadata.yunipals.slab.rawArtworkHash,
    metadata.yunipals.artworkHash
  );
  const slabImage = await app.request(metadata.image);
  assert.equal(slabImage.status, 200);
  assert.equal(slabImage.headers.get("content-type"), "image/png");
  assert((await slabImage.arrayBuffer()).byteLength > 10000);
  assert.equal(
    metadata.attributes.find((trait) => trait.trait_type === "Creativity")
      .value,
    91
  );
  assert.equal(metadata.yunipals.version, "1");
  // Existing card detail receives its ordinary ownership projection, while
  // artwork switches to the same canonical slab used by portal history.
  await page.route(`**/v1/boosters/monsters/${cards}/1`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: {
          id: `${cards}:1`,
          collection: cards,
          tokenId: "1",
          originalKey: `${cards}:1`,
          owner: bob,
          mintedTo: alice.address,
          isOriginal: true,
          burned: false,
          monsterType: "1",
          color: "1",
          horn: "1",
          glitter: "0",
          variantId: "0",
          mintBlock: "1",
          metadataUri: "https://portal.test/original-card.json"
        }
      })
    })
  );
  await page.goto(`${origin}/monsters/${cards}/1`);
  await page
    .getByRole("heading", { name: "Yunipal #1", exact: true })
    .waitFor();
  const currentDisplay = page.locator(".booster-card-viewer img").first();
  await currentDisplay.waitFor();
  assert.equal(await currentDisplay.getAttribute("src"), metadata.image);
  await page
    .getByRole("link", { name: "Cast a spell with this card", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Card number", { exact: true }).inputValue(),
    "1"
  );
  await page.goto(`${origin}/monsters/${cards}/1`);
  await page
    .getByRole("link", { name: "Artwork and grading history", exact: true })
    .click();
  assert.equal(new URL(page.url()).pathname, "/portals/cards/1");
  await page.goto(`${origin}/portals/cards/1`);
  await page
    .getByRole("heading", { name: "Artwork version 1", exact: true })
    .waitFor();
  assert.equal(await page.getByText("91 / 100", { exact: true }).count(), 1);
  await page.getByText("Spell and grading notes", { exact: true }).click();
  await page.getByText("A coherent star crown.", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/yunipals-portals-desktop.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/portals`);
  await page.getByText("Portal closed", { exact: true }).waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({
    path: "/tmp/yunipals-portals-mobile.png",
    fullPage: true
  });
  // Surviving portals rotate normally. A second zero-value exit needs explicit confirmation.
  await call(
    registry,
    "PortalRegistry",
    "requestRotation",
    [100000000000000n],
    100000000000000n
  );
  const pendingRotation = (await chain.active()).rotation.requestId;
  await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
    pendingRotation,
    17n
  ]);
  await call(registry, "PortalRegistry", "activateNext");
  const nextActive = await chain.active();
  assert.equal(nextActive.open, true);
  assert.notEqual(nextActive.round.portalId, request.portalId);
  const spare = [1n, 2n, 3n].find(
    (id) => id !== request.portalId && id !== nextActive.round.portalId
  );
  await call(collection, "PortalCollection", "transferFrom", [
    adminWallet.account.address,
    alice.address,
    spare
  ]);
  await ledger.tick();
  await page.goto(`${origin}/portals/mine`);
  await page
    .getByRole("button", { name: "Burn portal & claim", exact: true })
    .click();
  await claimDialog
    .getByText(
      "This portal has no accumulated fees. You will receive 0 USDC.",
      { exact: true }
    )
    .waitFor();
  await claimDialog.getByRole("checkbox").check();
  await claimDialog
    .getByRole("button", { name: "Burn portal & claim 0 USDC", exact: true })
    .click();
  await page
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .first()
    .waitFor();
  await ledger.tick();
  await page
    .getByText(`Portal #${spare} burned. You received 0 USDC.`, { exact: true })
    .waitFor({ timeout: 30000 });
  assert.equal(claimTransactions, 2);
  assert.equal(approvalTransactions, 1);
  await ledger.tick();
  assert.equal((await chain.active()).supply.live, 1n);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({
    path: "/tmp/yunipals-portal-claim-mobile.png",
    fullPage: true
  });
  assert.deepEqual(errors, []);
  // Confirm the actual token transfers, independent of the quote and request fields.
  const { parseAbi } = await import("viem");
  const erc20 = parseAbi(["function balanceOf(address) view returns(uint256)"]);
  const competition = await publicClient.readContract({
    address: grading,
    abi: portalGradingAbi,
    functionName: "competition"
  });
  const batch = await publicClient.readContract({
    address: competition,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [1n]
  });
  assert.equal(batch.funded, 1);
  assert.equal(batch.completed, 1);
  assert.equal(batch.settled, false);
  assert.equal(
    await publicClient.readContract({
      address: usdc,
      abi: erc20,
      functionName: "balanceOf",
      args: [competition]
    }),
    500000n
  );
  assert.equal(
    await publicClient.readContract({
      address: usdc,
      abi: erc20,
      functionName: "balanceOf",
      args: [alice.address]
    }),
    255000n
  );
  assert.equal(
    await publicClient.readContract({
      address: usdc,
      abi: erc20,
      functionName: "balanceOf",
      args: [bob]
    }),
    0n
  );
}
