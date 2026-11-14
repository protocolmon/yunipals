/** Full fixed-size accounting fixture; no external AI calls or public-network transactions. */
import assert from "node:assert/strict";
import { PortalThemeWorker } from "../lib/portals/theme-worker.js";
import {
  portalModels,
  portalSpellCommitment,
  portalAdmissionHash
} from "@protopals/yunipals-market-core/portals";
import { encodeFunctionData, erc20Abi, parseAbi, zeroHash } from "viem";
import {
  portalCompetitionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";

export async function verifyCompetitionBrowser({
  page,
  origin,
  rpc,
  app,
  chain,
  publicClient,
  call,
  engine,
  cards,
  usdc,
  grading,
  bob,
  ledger,
  alice,
  store,
  assets,
  intake
}) {
  const rpcCall = async (method, params = []) => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    });
    const value = await response.json();
    assert(!value.error, `Local competition RPC ${method} failed`);
    return value.result;
  };
  await rpcCall("anvil_impersonateAccount", [bob]);
  await rpcCall("anvil_setBalance", [bob, "0x56bc75e2d63100000"]);
  await call(usdc, "Portals.t:PortalTestUSDC", "mint", [bob, 200000000n]);
  const send = async (to, abi, functionName, args) => {
    const hash = await rpcCall("eth_sendTransaction", [
      { from: bob, to, data: encodeFunctionData({ abi, functionName, args }) }
    ]);
    assert.equal(
      (await publicClient.waitForTransactionReceipt({ hash })).status,
      "success"
    );
  };
  await send(usdc, erc20Abi, "approve", [grading, 200000000n]);
  const active = await chain.active();
  const pool = active.competition.address;
  const fixtureResult = await chain.result(1n);
  let nonce = 0n;
  async function admit(tokenId) {
    const input = await chain.input(tokenId);
    const id = nonce + 2n;
    const spell = {
      chainId: chain.deployment.chainId,
      grading,
      submitter: bob,
      tokenId,
      artVersion: input[1],
      nonce,
      spell: `Local fixture spell ${id}: create a guardian of light with an original gesture.`,
      salt: zeroHash
    };
    const commitment = portalSpellCommitment(spell);
    await store.saveSpell({
      ...spell,
      commitment,
      submitter: bob.toLowerCase(),
      tokenId: tokenId.toString(),
      artVersion: input[1].toString(),
      nonce: nonce.toString()
    });
    const admission = {
      tokenId,
      portalId: active.round.portalId,
      roundId: active.round.id,
      paymentVersion: active.portal.payment.version,
      artVersion: input[1],
      rubricId: active.rubricId,
      maximumFee: 990000n,
      inputHash: input[0].hash,
      spellCommitment: commitment,
      nonce: nonce++
    };
    const current = await chain.active();
    const receipt = await intake.issue(chain, store, {
      ...spell,
      commitment,
      expiresAt: BigInt(current.now + 300),
      admissionHash: portalAdmissionHash(admission)
    });
    await send(grading, portalGradingAbi, "admitCompetition", [
      admission,
      pool,
      current.competition.admissionHash,
      receipt
    ]);
    // Model the ingestor's confirmed accepted-job record; these uploads are no longer unsubmitted.
    const accepted = await chain.request(id);
    await store.enqueue({
      requestId: id.toString(),
      commitment,
      binding: await chain.binding(id),
      acceptedBlock: accepted.acceptedBlock.toString(),
      acceptedAt: Number(accepted.acceptedAt)
    });
    return id;
  }
  async function complete(id, score) {
    await call(grading, "PortalGrading", "complete", [
      id,
      {
        ...fixtureResult,
        requestBinding: await chain.binding(id),
        scores: [score, score, score, score],
        baseCreativity: score,
        copied: false,
        evidenceHash: zeroHash,
        completedAt: 0n
      }
    ]);
  }
  for (let id = 2n; id <= 110n; id++) {
    assert.equal(await admit(1n), id);
    await complete(id, 90);
  }
  assert.equal(await admit(1n), 111n);
  await call(engine, "Portals.t:PortalTestEngine", "original", [
    cards,
    1n,
    bob,
    0
  ]);
  assert.equal((await chain.active()).competition.accepting, false);
  await assert.rejects(chain.quote(2n, bob), /challenge is full/);
  await ledger.tick();
  await page.goto(`${origin}/portals`);
  await page
    .getByText("Challenge full · finishing the grades", { exact: true })
    .waitFor();
  await complete(111n, 100);
  await ledger.tick();
  await page.reload();
  await page
    .getByText("Preparing the next challenge theme", { exact: true })
    .waitFor();
  assert.equal((await chain.active()).competition.accepting, false);
  let extractionCalls = 0,
    publicationCalls = 0;
  const themeWorker = new PortalThemeWorker(
    chain,
    store,
    assets,
    {
      theme: async (sources) => {
        assert.deepEqual(
          sources.map((s) => s.requestId),
          ["111", "1", "2"]
        );
        if (++extractionCalls === 1)
          throw new Error("Local theme provider outage");
        return {
          title: "Guardians of light",
          brief: "Create an original guardian inspired by light.",
          contributions: sources.map((s) => ({
            requestId: s.requestId,
            inspiration: "Local shared inspiration fixture."
          })),
          model: "local-fixture",
          usage: { fixture: true }
        };
      }
    },
    portalModels,
    0n,
    async (theme) => {
      if (++publicationCalls === 1)
        throw new Error("Local publication interruption");
      return (
        await call(pool, "PortalGradingCompetition", "publishTheme", [
          theme.batchId,
          theme.sourcesHash,
          theme.artifactHash,
          theme.modelPolicy,
          theme.title,
          theme.brief,
          theme.uri
        ])
      ).transactionHash;
    }
  );
  await assert.rejects(themeWorker.tick(), /provider outage/);
  assert.equal((await chain.active()).competition.accepting, false);
  await assert.rejects(themeWorker.tick(), /publication interruption/);
  assert.equal((await chain.active()).competition.accepting, false);
  const saved = await store.db.query(
    "SELECT progress FROM portal_v4_theme_job"
  );
  const artifact = saved.rows[0].progress.artifact;
  assert.equal((await app.request(new URL(artifact.uri).pathname)).status, 404);
  // Simulate a broadcaster saving a transaction which disappeared from the mempool.
  await store.db.query(
    "UPDATE portal_v4_theme_job SET progress = progress || $1::jsonb",
    [
      JSON.stringify({
        transaction: `0x${"f".repeat(64)}`,
        transactionSubmittedAt: Date.now() - 180_000
      })
    ]
  );
  await themeWorker.tick();
  assert.equal(
    extractionCalls,
    2,
    "The successful extraction must be reused after interruption"
  );
  assert.equal(
    publicationCalls,
    2,
    "A dropped transaction must be resubmitted"
  );
  assert.equal(await themeWorker.tick(), false);
  await rpcCall("anvil_mine", ["0xc"]);
  await ledger.tick();
  assert.equal((await app.request(new URL(artifact.uri).pathname)).status, 200);
  await page.reload();
  await page
    .getByRole("heading", {
      name: "Challenge #2 · Guardians of light",
      exact: true
    })
    .waitFor();
  assert.equal(await admit(2n), 112n);
  await complete(112n, 100);
  let first;
  first = await publicClient.readContract({
    address: pool,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [1n]
  });
  assert.deepEqual(first.leaders, [111n, 1n, 2n]);
  assert.equal(first.completed, 111);
  await ledger.tick();
  const response = await app.request("/v1/portals/competitions");
  assert.equal(response.status, 200);
  const listing = await response.json();
  assert.equal(listing.batches[0].id, "2");
  assert.equal(listing.batches[1].ready, true);
  assert.equal(
    listing.batches[1].leaders[1].submitter.toLowerCase(),
    alice.address.toLowerCase()
  );
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(`${origin}/portals`);
  await page
    .getByRole("button", { name: "Settle competition", exact: true })
    .waitFor();
  // Other saved actions can show the same pending text. Wait for this exact
  // settlement's receipt/evidence before advancing the deliberately paused ledger.
  const pendingSettlement = page.waitForResponse(async (response) => {
    if (
      !response.url().endsWith("/action-evidence") ||
      response.request().method() !== "POST" ||
      response.status() !== 200
    )
      return false;
    const expected = response.request().postDataJSON();
    return (
      expected.events?.some((event) => event.name === "CompetitionSettled") &&
      (await response.json()).state === "awaiting_indexing"
    );
  });
  await page
    .getByRole("button", { name: "Settle competition", exact: true })
    .click();
  await pendingSettlement;
  await page
    .getByText(
      "Confirmed. The data update is still pending; your transaction is saved.",
      { exact: true }
    )
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("status")
      .filter({ hasText: "Settlement confirmed" })
      .count(),
    0
  );
  await ledger.tick();
  await page
    .getByRole("status")
    .filter({ hasText: "Settlement confirmed" })
    .waitFor({ timeout: 30000 });
  first = await publicClient.readContract({
    address: pool,
    abi: portalCompetitionAbi,
    functionName: "getBatch",
    args: [1n]
  });
  assert.equal(first.settled, true);
  assert.deepEqual(first.paid, [true, true, true]);
  assert.equal(
    await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [alice.address]
    }),
    16905000n
  );
  assert.equal(
    await publicClient.readContract({
      address: pool,
      abi: portalCompetitionAbi,
      functionName: "totalLiability"
    }),
    500000n
  );
  assert.equal(
    await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [pool]
    }),
    500000n
  );
  await page.screenshot({
    path: "/tmp/yunipals-competition-desktop.png",
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  );
  await page.screenshot({
    path: "/tmp/yunipals-competition-mobile.png",
    fullPage: true
  });
  await ledger.tick();
  const health = await app.request("/v1/portals/health");
  assert.equal(health.status, 200);
  const readiness = await health.json();
  assert.equal(readiness.accounting.competitionLiability, "500000");
  assert.equal(readiness.challenge.phase, "open");
  await send(cards, parseAbi(["function burn(uint256)"]), "burn", [1n]);
  const burnedMetadata = await app.request("/v1/portals/cards/1.json");
  assert.equal(burnedMetadata.status, 404);
  const retainedHistory = await app.request("/v1/portals/cards/1?before=1");
  assert.equal(retainedHistory.status, 200);
  assert.equal((await retainedHistory.json()).history[0].id, "1");
  await rpcCall("anvil_stopImpersonatingAccount", [bob]);
}
