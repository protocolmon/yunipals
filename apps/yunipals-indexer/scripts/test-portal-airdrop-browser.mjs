import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseEventLogs } from "viem";
import { portalCollectionAbi } from "@protopals/yunipals-market-core/portalAbi";

export async function verifyGuidedAirdrop({
  page,
  origin,
  chain,
  call,
  wrapper,
  ledger,
  owner,
  walletBehavior
}) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.route("https://portal.example.test/rainbow.png", (route) =>
    route.fulfill({
      path: new URL(
        "../../yunipals-home-web/public/images/portals/rainbow-portal-card.webp",
        import.meta.url
      ).pathname,
      contentType: "image/webp"
    })
  );
  const collection = chain.deployment.collection;
  const original = await chain.client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "getKind",
    args: [1n]
  });
  await call(collection, "PortalCollection", "configureKind", [
    0n,
    {
      ...original.definition,
      name: "Guided Rainbow",
      imageURI: "https://portal.example.test/rainbow.png",
      cap: 100
    }
  ]);
  const kindId = await chain.client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "kindCount"
  });
  const kind = await chain.client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "getKind",
    args: [kindId]
  });
  await ledger.tick();
  const plan = {
    version: 1,
    title: "Local guided airdrop",
    chainId: 8453,
    collection,
    admin: owner,
    kindId: kindId.toString(),
    kindConfigurationHash: kind.configurationHash,
    snapshotAt: new Date().toISOString(),
    expectedAllocated: 0,
    batches: [
      { recipients: Array(35).fill(owner) },
      { recipients: [owner, owner] }
    ]
  };
  const text = JSON.stringify(plan),
    checksum = createHash("sha256").update(text).digest("hex");
  await page.route(origin + "/test-airdrop.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: text })
  );
  const url =
    origin +
    "/portals/airdrop?manifest=" +
    encodeURIComponent(origin + "/test-airdrop.json") +
    "&sha256=" +
    checksum;
  await page.goto(url);
  await page
    .getByRole("heading", { name: "Portal airdrop", exact: true })
    .waitFor();
  const approve = page.getByRole("checkbox", {
    name: "I reviewed these recipients and quantities for this airdrop."
  });
  const commit1 = page.getByRole("button", {
    name: "Commit batch 1",
    exact: true
  });
  const commit2 = page.getByRole("button", {
    name: "Commit batch 2",
    exact: true
  });
  await commit1.waitFor();
  assert.equal(await commit1.isDisabled(), true);
  await approve.check();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Commit batch 1" && !b.disabled
    )
  );
  assert.equal(await commit2.isDisabled(), true);
  // A known wallet rejection unlocks the same batch without creating a mint.
  walletBehavior.rejectNext = true;
  const count = walletBehavior.sends;
  await commit1.click();
  await page.getByRole("alert").filter({ hasText: "cancelled" }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Commit batch 1" && !b.disabled
    )
  );
  assert.equal(walletBehavior.sends, count);
  // The wallet broadcasts but loses its response: durable intent and allocated
  // range prevent another commitment, even before the event has been indexed.
  walletBehavior.forgetNext = true;
  await commit1.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "The batch is saved" })
    .waitFor();
  assert.equal(walletBehavior.sends, count + 1);
  const firstHash = walletBehavior.lastHash;
  const receipt1 = await chain.client.getTransactionReceipt({
    hash: firstHash
  });
  const request1 = parseEventLogs({
    abi: portalCollectionAbi,
    eventName: "MintCommitted",
    logs: receipt1.logs
  })[0].args.requestId;
  await page.reload();
  await page
    .getByText("Waiting for randomness and indexing", { exact: true })
    .waitFor();
  assert.equal(await commit1.count(), 0);
  assert.equal(await commit2.isDisabled(), true);
  console.log(
    "Guided airdrop: rejected request and interrupted submission recovery passed."
  );
  await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
    request1,
    634n
  ]);
  assert.equal(
    await page
      .getByRole("button", { name: "Deliver next 32 cards", exact: true })
      .count(),
    0
  );
  await ledger.tick();
  await page
    .getByRole("button", { name: "Deliver next 32 cards", exact: true })
    .waitFor();
  const pending = () =>
    page
      .getByRole("listitem")
      .filter({ has: page.getByText("Deliver portal NFTs", { exact: true }) })
      .last()
      .getByText(
        "Confirmed. The data update is still pending; your transaction is saved.",
        { exact: true }
      )
      .waitFor();
  await page
    .getByRole("button", { name: "Deliver next 32 cards", exact: true })
    .click();
  await pending();
  assert.equal(await commit2.isDisabled(), true);
  await ledger.tick();
  await page.getByText("32 / 35 delivered", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Deliver next 3 cards", exact: true })
    .click();
  await pending();
  await ledger.tick();
  await page.getByText("35 / 35 delivered", { exact: true }).waitFor();
  await approve.check();
  await commit2.click();
  await page
    .getByRole("listitem")
    .filter({ has: page.getByText("Commit portal mint", { exact: true }) })
    .last()
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .waitFor();
  const receipt2 = await chain.client.getTransactionReceipt({
    hash: walletBehavior.lastHash
  });
  const request2 = parseEventLogs({
    abi: portalCollectionAbi,
    eventName: "MintCommitted",
    logs: receipt2.logs
  })[0].args.requestId;
  await page.reload();
  await page
    .getByText("Waiting for randomness and indexing", { exact: true })
    .waitFor();
  assert.equal(await commit2.count(), 0);
  await ledger.tick();
  await call(wrapper, "BoosterPacks.t:MockWrapper", "fulfill", [
    request2,
    635n
  ]);
  assert.equal(
    await page
      .getByRole("button", { name: "Deliver next 2 cards", exact: true })
      .isDisabled(),
    true
  );
  await ledger.tick();
  await page
    .getByRole("button", { name: "Deliver next 2 cards", exact: true })
    .click();
  await pending();
  await ledger.tick();
  await page.getByText("2 / 2 delivered", { exact: true }).waitFor();
  const final = await chain.client.readContract({
    address: collection,
    abi: portalCollectionAbi,
    functionName: "getKind",
    args: [kindId]
  });
  assert.equal(final.allocated, 37);
  assert.equal(
    await page.getByRole("button", { name: /Commit batch/ }).count(),
    0
  );
  assert.equal(
    (
      await chain.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "getMintRequest",
        args: [request1]
      })
    ).processed,
    35
  );
  assert.equal(
    (
      await chain.client.readContract({
        address: collection,
        abi: portalCollectionAbi,
        functionName: "getMintRequest",
        args: [request2]
      })
    ).processed,
    2
  );
  await page.screenshot({
    path: "/tmp/yunipals-portal-airdrop-desktop.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    ),
    false
  );
  await page.screenshot({
    path: "/tmp/yunipals-portal-airdrop-mobile.png",
    fullPage: true
  });
  await page.goto(url.replace(checksum, "0".repeat(64)));
  await page.getByRole("alert").filter({ hasText: "does not match" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: /Commit batch/ }).count(),
    0
  );
  console.log(
    "Guided airdrop passed: rejection, lost wallet response, reload, exact recipients, indexed VRF/deliveries, two batches, checksum rejection and mobile."
  );
}
