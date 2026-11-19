import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import type { Hex } from "viem";
import { portalModels } from "@protopals/yunipals-market-core/portals";
import {
  evolutionPrompt,
  evolutionRenderingHash,
  validateEvolutionHistory,
  type EvolutionHistory
} from "../lib/evolution/art.js";
import {
  EvolutionStore,
  evolutionWorkerSchema
} from "../lib/evolution/store.js";
import { EvolutionWorker } from "../lib/evolution/worker.js";
import { PortalAssets } from "../lib/portals/assets.js";
import { OpenAIPortalAI } from "../lib/portals/provider.js";
import type { EvolutionChain } from "../lib/evolution/chain.js";
import type { EvolutionReader } from "../../../packages/yunipals-indexer-server/src/evolution.js";
import {
  portalImagePrompt,
  portalGradingInstructions
} from "../lib/portals/prompts.js";

const hash = `0x${"1".repeat(64)}` as Hex;
const otherHash = `0x${"2".repeat(64)}` as Hex;
const dose = { catalogueVersion: 1, serumId: 121, presenceId: 1 };
const leaf = (id: string): EvolutionHistory => ({
  tokenId: id,
  level: 0,
  presence: 1,
  doses: [dose],
  parents: []
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64"
);

describe("evolution generation", () => {
  it("preserves all 77 ordered doses, bounds ancestry, and distinguishes latest Presence", () => {
    let next = 0;
    const tree = (level: number): EvolutionHistory => ({
      tokenId: String(++next),
      level,
      presence: 1,
      doses: Array.from({ length: 11 }, () => ({ ...dose })),
      parents: level ? [tree(level - 1), tree(level - 1)] : []
    });
    const history = tree(2);
    expect(validateEvolutionHistory(history)).toBe(77);
    expect(() =>
      validateEvolutionHistory({ ...history, doses: [...history.doses, dose] })
    ).toThrow();
    expect(() =>
      validateEvolutionHistory({
        ...history,
        parents: [history.parents[0], history.parents[0]]
      })
    ).toThrow();
    const prompt = JSON.parse(evolutionPrompt([leaf("1"), leaf("2")], 0));
    expect(prompt.resultingPresence).toBe("Neutral");
    expect(prompt.inputImageOrder).toEqual(["1", "2"]);
    expect(prompt.background).toContain("No bottle");
    expect(evolutionPrompt([leaf("1")], 1, dose)).toContain("Holy");
    expect(() => evolutionPrompt([leaf("1")], 2, dose)).toThrow();
    expect(evolutionRenderingHash(portalModels)).not.toBe(
      evolutionRenderingHash({ ...portalModels, imageQuality: "changed" })
    );
  });
  it("sends both parent images through the existing portal image configuration", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: [{ b64_json: png.toString("base64") }] })
        )
    );
    const ai = new OpenAIPortalAI("fixture-only", portalModels, request);
    await ai.editImages("trusted fusion", [png, png]);
    const body = request.mock.calls[0][1]!.body as FormData;
    expect(body.getAll("image[]")).toHaveLength(2);
    expect(body.get("model")).toBe(portalModels.image);
    expect(body.get("prompt")).toBe("trusted fusion");
    await expect(ai.editImages("bad", [])).rejects.toThrow();
  });
  it("keeps leases exclusive and preserves paid output per binding across replay", async () => {
    const db = new PGlite();
    try {
      await db.exec(evolutionWorkerSchema);
      const store = new EvolutionStore(
        db as unknown as Pick<Pool, "query">,
        "8453:test"
      );
      const a = await store.claim("1", hash, hash);
      expect(a).not.toBeNull();
      expect(await store.claim("1", hash, hash)).toBeNull();
      a!.progress.image = {
        uri: "https://example.invalid/a.png",
        hash,
        model: "fixture",
        usage: null
      };
      await store.save(a!);
      await store.release(a!);
      await expect(store.save(a!)).rejects.toThrow("lease lost");
      const replacement = await store.claim("1", otherHash, hash);
      expect(replacement?.progress).toEqual({});
      const saved = (
        await db.query<{ progress: { image: { hash: string } } }>(
          "SELECT progress FROM evolution_v1_job WHERE binding=$1",
          [hash]
        )
      ).rows[0];
      expect(saved.progress.image.hash).toBe(hash);
      await db.query(
        "UPDATE evolution_v1_job SET retry_at=now()-interval '1 second'"
      );
      expect((await store.claim("1", hash, hash))?.progress.image?.hash).toBe(
        hash
      );
    } finally {
      await db.close();
    }
  });
  it("resumes saved artwork after submission failure and refuses changed branches before AI", async () => {
    const db = new PGlite();
    const directory = await mkdtemp(join(tmpdir(), "evolution-worker-"));
    try {
      await db.exec(evolutionWorkerSchema);
      const store = new EvolutionStore(
        db as unknown as Pick<Pool, "query">,
        "8453:evolution"
      );
      const assets = new PortalAssets(
        directory,
        "https://example.invalid",
        [],
        undefined,
        false,
        "/v1/evolution/assets"
      );
      const input = await assets.put(png, "png");
      let binding = hash;
      const request = {
        parentA: 1n,
        parentB: 2n,
        ready: true,
        completed: false,
        inputA: input,
        inputB: input,
        resultPresence: 0
      };
      const chain = {
        cards: "cards",
        adventures: "adventures",
        request: async () => request,
        binding: async () => binding,
        client: { getBlock: async () => ({ hash }) },
        history: async (id: bigint) => leaf(id.toString()),
        sources: async () => []
      } as unknown as EvolutionChain;
      const reader = {
        snapshot: async (fn: (db: unknown, ctx: unknown) => Promise<unknown>) =>
          fn(null, {
            deployment: store.deployment,
            cards: "cards",
            adventures: "adventures",
            block: 100n,
            hash
          })
      } as unknown as EvolutionReader;
      const ai = {
        policy: portalModels,
        editImages: vi.fn(async () => ({
          bytes: png,
          usage: null,
          model: portalModels.image
        }))
      };
      const submit = vi.fn(async () => otherHash);
      submit.mockRejectedValueOnce(new Error("temporary RPC failure"));
      const worker = new EvolutionWorker(
        reader,
        chain,
        store,
        assets,
        ai,
        submit
      );
      const job = (await store.claim("1", hash, worker.policy))!;
      await expect(worker.process(job)).rejects.toThrow("RPC failure");
      expect(ai.editImages).toHaveBeenCalledTimes(1);
      expect(job.progress.artifact?.metadataHash).toBeTruthy();
      await worker.process(job);
      expect(ai.editImages).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledTimes(2);
      const next = (await store.claim("2", hash, worker.policy))!;
      binding = otherHash;
      await expect(worker.process(next)).rejects.toThrow("binding changed");
      expect(ai.editImages).toHaveBeenCalledTimes(1);
    } finally {
      await db.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("retries saved VRF settlement without creating fresh randomness", async () => {
    const settle = vi.fn(async () => otherHash);
    const reader = {
      unsettled: async (domain: string) => ({
        rows:
          domain === "adventure"
            ? [{ value: { requestId: "7" } }, { value: { requestId: "8" } }]
            : [{ value: { requestId: "9", randomnessId: "19" } }],
        block: 100n,
        hash
      }),
      jobs: async () => ({ rows: [], block: 100n, hash })
    } as unknown as EvolutionReader;
    const reads = vi.fn(async ({ args }: { args: readonly bigint[] }) => [
      0n,
      true,
      args[0] !== 8n
    ]);
    const chain = {
      adventures: "adventures",
      evolution: "evolution",
      assertBindings: async () => {},
      client: { getBlock: async () => ({ hash }), readContract: reads }
    } as unknown as EvolutionChain;
    const ai = { policy: portalModels, editImages: vi.fn() };
    const worker = new EvolutionWorker(
      reader,
      chain,
      {} as EvolutionStore,
      {} as PortalAssets,
      ai,
      undefined,
      settle
    );
    await worker.tick();
    expect(settle.mock.calls).toEqual([
      ["adventure", 7n],
      ["fusion", 19n]
    ]);
    expect(ai.editImages).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(3);
  });
  it("portal edits preserve evolved features and use the real gate witness", () => {
    const prompt = portalImagePrompt(portalModels, "Add a constellation", {
      portalKindId: "1",
      baseColor: "Black",
      evolution: { witnessTokenId: "2", sources: [], history: leaf("1") }
    });
    expect(prompt).toContain("Holy eyes");
    expect(prompt).toContain("matching gate witness");
    expect(prompt).toContain("fused ancestry");
    const context = {
      portalKindId: "1",
      baseColor: "Black" as const,
      evolution: { witnessTokenId: "2", sources: [], history: leaf("1") }
    };
    for (const policy of [
      portalModels,
      { ...portalModels, portalGradingCases: undefined }
    ]) {
      const grading = portalGradingInstructions(policy, context);
      expect(grading).toContain("all ancestral colors and species");
      expect(grading).toContain("earn no automatic score bonus");
      expect(grading).toContain("not evidence of copying");
    }
  });
});
