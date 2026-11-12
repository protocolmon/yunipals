import type { PortalIntakeSigner } from "../lib/portals/intake.js";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { verifyTypedData, type Hex, type PublicClient } from "viem";
import {
  portalModels,
  rainbowPortalGradingCase,
  portalModelPolicyHash,
  portalSpellCommitment,
  portalSpellSigningData,
  portalAuthorLinkSigningData
} from "@protopals/yunipals-market-core/portals";
import { PortalStore, type PortalJob } from "../lib/portals/store.js";
import { PortalLedgerStore } from "../lib/portals/ledger-store.js";
import { PortalAssets } from "../lib/portals/assets.js";
import { PortalChain, type PortalCompletion } from "../lib/portals/chain.js";
import { PortalWorker } from "../lib/portals/worker.js";
import { registerPortalRoutes } from "../lib/portals/routes.js";
import type { PortalAI } from "../lib/portals/provider.js";
import { applyPortalGradingCase } from "../lib/portals/grading.js";

const db = new PGlite();
const alice = privateKeyToAccount(`0x${"0".repeat(63)}1`);
const bob = "0x2222222222222222222222222222222222222222";
const grading = "0x3333333333333333333333333333333333333333" as const;
const digest = `0x${"a".repeat(64)}` as Hex;
const salt = `0x${"b".repeat(64)}` as Hex;
const now = Math.floor(Date.now() / 1000) + 20;
let store: PortalStore;
let assets: PortalAssets;
let directory: string;
let image: Buffer;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "yunipals-portals-"));
  assets = new PortalAssets(directory, "https://portal.test", ["portal.test"]);
  image = await readFile(
    new URL(
      "../../../docs/boosters/artwork-runtime/assets/7cc78b1050c1c9cadf78b74057c4f059499c123c7217e14ca9efc6c18550d08a.png",
      import.meta.url
    )
  );
  store = new PortalStore(db as never, "test");
  await store.migrate();
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE portal_v1_spell,portal_v1_job,portal_v1_publication,portal_v1_author_link,portal_v1_cursor"
  );
});
afterAll(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

async function privateSpell(
  id = "1",
  submitter = alice.address.toLowerCase(),
  text = "Give it a stained-glass crown."
) {
  const commitment = `0x${id.padStart(64, "0")}`;
  await store.saveSpell({
    commitment,
    submitter,
    tokenId: "1",
    artVersion: "0",
    nonce: "0",
    spell: text,
    salt
  });
  await store.enqueue({
    requestId: id,
    commitment,
    binding: digest,
    acceptedBlock: "20",
    acceptedAt: now
  });
  return commitment;
}

describe("durable portal queue and public archive", () => {
  it("allows only one lease and fences a worker whose lease has been replaced", async () => {
    await privateSpell();
    const first = (await store.claim())!;
    expect(await store.claim()).toBeNull();
    first.progress.embedding = [1, 0];
    await store.save(first);
    await db.exec(
      "UPDATE portal_v1_job SET lease_until=now()-interval '1 second'"
    );
    const second = (await store.claim())!;
    expect(second.progress.embedding).toEqual([1, 0]);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(store.save(first)).rejects.toThrow("lease lost");
    await expect(
      store.publish(first, {
        tokenId: "1",
        submitter: alice.address,
        spell: "stale",
        embedding: [1, 0],
        block: "30",
        timestamp: now,
        result: {},
        artifacts: [digest.slice(2)]
      })
    ).rejects.toThrow("lease lost");
    expect(await store.isPublishedArtifact(digest.slice(2))).toBe(false);
  });
  it("finds exact and similar prior publications, excluding future or later-public attempts", async () => {
    const commitment = await privateSpell();
    const insert = async (
      id: number,
      block: number,
      time: number,
      spell: string,
      owner: string
    ) =>
      db.query(
        `INSERT INTO portal_v1_publication(deployment,request_id,token_id,submitter,spell,normalized,embedding,publication_block,publication_timestamp,result,artifact_hashes)
      VALUES('test',$1,1,$2,$3,$4,ARRAY[1.0,0.0],$5,$6,'{}','{}')`,
        [id, owner, spell, spell.toLowerCase(), block, time]
      );
    await insert(2, 10, now - 10, "Give it a stained-glass crown.", bob);
    await insert(3, 30, now - 10, "Give it a stained-glass crown.", bob);
    await insert(4, 10, now + 1, "Give it a stained-glass crown.", bob);
    await insert(
      5,
      10,
      now - 10,
      "Another glass spell",
      alice.address.toLowerCase()
    );
    const job = (await store.claim())!;
    expect(job.commitment).toBe(commitment);
    const candidates = await store.candidates(
      job,
      "Give it a stained-glass crown.",
      [1, 0]
    );
    expect(candidates.map((c) => c.requestId)).toEqual(["2", "5"]);
    expect(candidates[1].sameAuthor).toBe(true);
  });
  it("keeps artifacts private until a finalized publication is recorded", async () => {
    await privateSpell();
    const job = (await store.claim())!;
    const artifact = await assets.put(image, "png");
    expect(await store.isPublishedArtifact(artifact.hash.slice(2))).toBe(false);
    await store.publish(job, {
      tokenId: "1",
      submitter: alice.address,
      spell: "spell",
      embedding: [1, 0],
      block: "30",
      timestamp: now,
      result: { scores: [90, 90, 90, 90] },
      artifacts: [artifact.hash.slice(2)]
    });
    expect(await store.isPublishedArtifact(artifact.hash.slice(2))).toBe(true);
    expect(await store.claim()).toBeNull();
    expect((await store.publicHistory("1"))[0].requestId).toBe("1");
  });
  it("retains old model-policy jobs for their matching worker", async () => {
    await privateSpell();
    await db.query("UPDATE portal_v1_job SET model_policy=$1", [digest]);
    expect(await store.claim(salt)).toBeNull();
    expect((await store.claim(digest))?.requestId).toBe("1");
  });
});

describe("portal API private spell intake", () => {
  function application(owner = alice.address, intake?: PortalIntakeSigner) {
    const client = {
      getBlock: async () => ({ timestamp: BigInt(now) }),
      verifyTypedData: (input: Parameters<typeof verifyTypedData>[0]) =>
        verifyTypedData(input)
    } as unknown as PublicClient;
    const chain = new PortalChain(client, {
      chainId: 8453,
      grading,
      registry: grading,
      collection: grading,
      cards: grading,
      usdc: grading
    });
    vi.spyOn(chain, "owner").mockResolvedValue(owner);
    vi.spyOn(chain, "nonce").mockResolvedValue(0n);
    const app = new Hono();
    registerPortalRoutes(app, {
      enabled: () => true,
      runtime: async () => ({
        chain,
        store,
        assets,
        ledger: new PortalLedgerStore(db as never, "test"),
        intake,
        close: async () => {}
      })
    });
    return { app, chain };
  }
  async function signed(spell = "Make a glass crown.") {
    const input = {
      chainId: 8453,
      grading,
      submitter: alice.address,
      tokenId: 1n,
      artVersion: 0n,
      nonce: 0n,
      spell,
      salt
    };
    const expiresAt = BigInt(now + 300);
    return {
      submitter: alice.address,
      tokenId: "1",
      artVersion: "0",
      nonce: "0",
      spell,
      salt,
      expiresAt: expiresAt.toString(),
      signature: await alice.signTypedData(
        portalSpellSigningData(input, expiresAt)
      ),
      commitment: portalSpellCommitment(input)
    };
  }
  it("accepts an authenticated owner upload and rejects a changed spell", async () => {
    const { app } = application();
    const { commitment, ...body } = await signed();
    const response = await app.request("/v1/portals/spells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ commitment });
    expect((await store.spell(commitment))?.spell).toBe(body.spell);
    const bad = await app.request("/v1/portals/spells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, spell: "Changed after signing" })
    });
    expect(bad.status).toBe(400);
  });
  it("issues acknowledgement only after storage succeeds and refuses it without a signer", async () => {
    const issue = vi.fn(
      async (_chain, saved: PortalStore, input: { commitment: string }) => {
        expect(await saved.spell(input.commitment)).not.toBeNull();
        return {
          expiresAt: BigInt(now + 300),
          signature: `0x${"12".repeat(65)}`
        };
      }
    );
    const { app } = application(alice.address, {
      issue
    } as unknown as PortalIntakeSigner);
    const { commitment, ...body } = await signed();
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, admissionHash: digest })
    };
    vi.spyOn(store, "saveSpell").mockRejectedValueOnce(
      new Error("Storage write failed")
    );
    expect((await app.request("/v1/portals/spells", request)).status).toBe(503);
    expect(issue).not.toHaveBeenCalled();
    const success = await app.request("/v1/portals/spells", request);
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      commitment,
      receipt: { expiresAt: String(now + 300) }
    });
    expect(issue).toHaveBeenCalledTimes(1);
    const unconfigured = application().app;
    expect(
      (await unconfigured.request("/v1/portals/spells", request)).status
    ).toBe(503);
  });
  it("rejects an upload from a wallet that no longer owns the card", async () => {
    const { app } = application(bob);
    const { commitment: _commitment, ...body } = await signed();
    const response = await app.request("/v1/portals/spells", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(400);
  });
  it("links two consenting wallets regardless of the order used in the request", async () => {
    const other = privateKeyToAccount(`0x${"0".repeat(63)}2`);
    const [left, right] = [alice, other].sort((a, b) =>
      b.address.toLowerCase().localeCompare(a.address.toLowerCase())
    );
    const signed = portalAuthorLinkSigningData(
      8453,
      grading,
      left.address,
      right.address
    );
    const { app } = application();
    const response = await app.request("/v1/portals/authors/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        left: left.address,
        right: right.address,
        leftSignature: await left.signTypedData(signed),
        rightSignature: await right.signTypedData(signed)
      })
    });
    expect(response.status).toBe(200);
    const links = await db.query<{ left_wallet: string; right_wallet: string }>(
      "SELECT left_wallet,right_wallet FROM portal_v1_author_link"
    );
    expect(links.rows[0]).toEqual({
      left_wallet: signed.message.left,
      right_wallet: signed.message.right
    });
  });
  it("does not expose a private artifact or the stored spell through public endpoints", async () => {
    const { app } = application();
    const artifact = await assets.put(image, "png");
    const response = await app.request(
      `/v1/portals/assets/${artifact.hash.slice(2)}.png`
    );
    expect(response.status).toBe(404);
    expect((await app.request("/v1/portals/spells")).status).toBe(404);
  });
});

describe("portal worker checkpoint recovery", () => {
  async function setup(failSubmit = false) {
    const original = await assets.put(image, "png");
    const input = {
      chainId: 8453,
      grading,
      submitter: alice.address,
      tokenId: 1n,
      artVersion: 0n,
      nonce: 0n,
      spell: "Make a glass crown.",
      salt
    };
    const commitment = portalSpellCommitment(input);
    await store.saveSpell({
      commitment,
      submitter: alice.address.toLowerCase(),
      tokenId: "1",
      artVersion: "0",
      nonce: "0",
      spell: input.spell,
      salt
    });
    await store.enqueue({
      requestId: "1",
      commitment,
      binding: digest,
      acceptedBlock: "20",
      acceptedAt: now
    });
    const request: Awaited<ReturnType<PortalChain["request"]>> = {
      tokenId: 1n,
      portalId: 1n,
      kindId: 1n,
      submitter: alice.address,
      roundId: 1n,
      acceptedAt: BigInt(now),
      acceptedBlock: 20n,
      artVersion: 0n,
      spellCommitment: commitment,
      rubricId: digest,
      input: original,
      payment: {
        aiFee: 245000n,
        portalFee: 245000n,
        aiRecipient: bob,
        portalRecipient: bob,
        version: 1n
      },
      nonce: 0n,
      completed: false
    };
    let finalized: PortalCompletion | null = null;
    const chain = {
      requestTheme: vi.fn(async () => undefined),
      deployment: { chainId: 8453, grading },
      request: async () => request,
      binding: async () => digest,
      provenance: async () => [
        1n,
        1n,
        80,
        { monsterType: 4, color: 3, horn: 1, glitter: 0 },
        true
      ],
      rubric: async () => ({
        modelPolicy: portalModelPolicyHash(),
        copyCap: 20,
        uri: "ipfs://rubric",
        configured: true
      }),
      result: async () => finalized,
      client: {
        getBlock: async () => ({ number: 30n, timestamp: BigInt(now + 20) })
      }
    } as unknown as PortalChain;
    const ai = {
      embed: vi.fn(async () => [1, 0]),
      edit: vi.fn(async () => ({
        bytes: image,
        usage: {},
        model: portalModels.image
      })),
      originality: vi.fn(async () => ({
        copied: false,
        confidence: "clear" as const,
        meaningfulContribution: true,
        reason: "Original",
        sources: []
      })),
      grade: vi.fn(async () => ({
        ...applyPortalGradingCase(
          rainbowPortalGradingCase,
          { creativity: 95, harmony: 90, craft: 90, impact: 90 },
          {
            creativity: "Distinct idea",
            harmony: "Coherent colors",
            craft: "Spell realized",
            impact: "Strong composition"
          },
          Object.fromEntries(
            rainbowPortalGradingCase.checks.map((check) => [
              check.id,
              {
                outcome: "met" as const,
                evidence: "Visible in this test fixture"
              }
            ])
          )
        ),
        reason: "Strong transformation",
        usage: {},
        model: portalModels.grading
      }))
    } satisfies PortalAI;
    const submit = vi.fn(async (_id: bigint, result: PortalCompletion) => {
      finalized = result;
      request.completed = true;
      if (failSubmit) throw new Error("Connection lost after mining");
      return digest;
    });
    chain.client.waitForTransactionReceipt = vi
      .fn()
      .mockResolvedValue({ status: "success" }) as never;
    const worker = new PortalWorker(
      chain,
      store,
      assets,
      ai,
      portalModels,
      1n,
      0n,
      submit
    );
    return { worker, ai, submit, chain, request };
  }
  it("reuses the saved image after a grading-provider failure", async () => {
    const { worker, ai, submit } = await setup();
    ai.grade.mockRejectedValueOnce(new Error("Provider unavailable"));
    const first = (await store.claim())!;
    await expect(worker.process(first)).rejects.toThrow("Provider unavailable");
    await store.retry(first, "retry");
    await db.exec("UPDATE portal_v1_job SET retry_at=now()");
    const second = (await store.claim())!;
    await worker.process(second);
    expect(ai.edit).toHaveBeenCalledTimes(1);
    expect(ai.grade).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await store.claim()).toBeNull();
  });
  it("rejects a saved grading assessment that bypasses this portal's ceilings", async () => {
    const { worker, ai, submit } = await setup();
    const grading = await ai.grade();
    grading.assessment.checks["rainbow-body"] = {
      outcome: "missed",
      evidence: "Rainbow effect absent"
    };
    ai.grade.mockResolvedValueOnce(grading);
    await expect(worker.process((await store.claim())!)).rejects.toThrow(
      "ceilings"
    );
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects a kind missing from the accepted grading profile before using AI", async () => {
    const { worker, ai, request } = await setup();
    request.kindId = 2n;
    await expect(worker.process((await store.claim())!)).rejects.toThrow(
      "no grading case"
    );
    expect(ai.embed).not.toHaveBeenCalled();
    expect(ai.edit).not.toHaveBeenCalled();
  });
  it("derives the portal context from admitted kind and immutable provenance, and reuses it on retry", async () => {
    const { worker, ai, chain } = await setup();
    const provenance = vi.spyOn(chain, "provenance");
    ai.grade.mockRejectedValueOnce(new Error("Retry visual grading"));
    const first = (await store.claim())!;
    await expect(worker.process(first)).rejects.toThrow("Retry visual grading");
    expect(first.progress.portalContext).toEqual({
      portalKindId: "1",
      baseColor: "Blue"
    });
    await store.retry(first, "retry");
    await db.exec("UPDATE portal_v1_job SET retry_at=now()");
    await worker.process((await store.claim())!);
    expect(provenance).toHaveBeenCalledTimes(1);
    expect(ai.edit).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Uint8Array),
      { portalKindId: "1", baseColor: "Blue" }
    );
    expect(ai.grade).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      { portalKindId: "1", baseColor: "Blue" }
    );
  });
  it("publishes the existing result after a connection failure following finalization", async () => {
    const { worker, ai, submit } = await setup(true);
    const first = (await store.claim())!;
    await expect(worker.process(first)).rejects.toThrow("Connection lost");
    await store.retry(first, "retry");
    await db.exec("UPDATE portal_v1_job SET retry_at=now()");
    const second = (await store.claim())!;
    await worker.process(second);
    expect(ai.edit).toHaveBeenCalledTimes(1);
    expect(ai.grade).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await store.publicHistory("1")).toHaveLength(1);
  });
  it("upgrades old display publications without AI, chain sends or changing copying cutoff timestamps", async () => {
    const { worker, ai, submit, request } = await setup();
    await worker.process((await store.claim())!);
    const original = (
      await db.query(
        "SELECT publication_block,publication_timestamp,published_at FROM portal_v1_publication"
      )
    ).rows;
    await db.exec("UPDATE portal_v1_publication SET result=result-'slab'");
    await store.migrate();
    await store.migrate();
    const job = (await store.claim())!;
    expect(job.progress.displayOnly).toBe(true);
    request.completed = false;
    await expect(worker.process(job)).rejects.toThrow(
      "Display recovery requires"
    );
    request.completed = true;
    delete job.progress.embedding;
    await worker.process(job);
    expect((await store.publicHistory("1"))[0].result).toHaveProperty("slab");
    expect(
      (
        await db.query(
          "SELECT publication_block,publication_timestamp,published_at FROM portal_v1_publication"
        )
      ).rows
    ).toEqual(original);
    for (const stage of [ai.embed, ai.edit, ai.originality, ai.grade, submit])
      expect(stage).toHaveBeenCalledTimes(1);
    await store.migrate();
    expect(await store.claim()).toBeNull();
  }, 20000);
  it("keeps a mined result private until the configured confirmations survive a restart", async () => {
    const { worker, ai, chain, request } = await setup();
    const confirmedWorker = new PortalWorker(
      chain,
      store,
      assets,
      ai,
      portalModels,
      1n,
      1n,
      worker.submit
    );
    const read = vi
      .spyOn(chain, "request")
      .mockImplementation(async (_id, block) =>
        block === 29n ? { ...request, completed: false } : request
      );
    const first = (await store.claim())!;
    await expect(confirmedWorker.process(first)).rejects.toThrow(
      "not finalized"
    );
    expect(await store.publicHistory("1")).toHaveLength(0);
    read.mockImplementation(async () => request);
    await store.retry(first, "confirmations");
    await db.exec("UPDATE portal_v1_job SET retry_at=now()");
    await confirmedWorker.process((await store.claim())!);
    expect(await store.publicHistory("1")).toHaveLength(1);
    expect(ai.edit).toHaveBeenCalledTimes(1);
  });
});
