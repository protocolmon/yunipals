import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerEvolutionRoutes } from "../lib/evolution/routes.js";
import {
  isUnsupportedEvolutionCard,
  UnsupportedEvolutionCard
} from "../lib/evolution/chain.js";
import type { EvolutionRuntime } from "../lib/evolution/runtime.js";
import type { EvolutionReader } from "../../../packages/yunipals-indexer-server/src/evolution.js";
import { PortalAssets } from "../lib/portals/assets.js";
import { saveHoloLayers } from "../lib/evolution/holo.js";
import geometry from "./fixtures/evolution-holo.json";
import { Resvg } from "@resvg/resvg-js";
import { registerPortalRoutes } from "../lib/portals/routes.js";
import type { PortalRuntime } from "../lib/portals/runtime.js";

const hash = `0x${"1".repeat(64)}`;
const owner = `0x${"2".repeat(40)}`;

describe("evolution owner pagination", () => {
  it("skips missing facts and unsupported artwork but never hides RPC failures", async () => {
    const revert = (reason: string) =>
      new ContractFunctionRevertedError({
        abi: [],
        functionName: "inputArtwork",
        data: encodeErrorResult({
          abi: [
            {
              type: "error",
              name: "Error",
              inputs: [{ type: "string", name: "reason" }]
            }
          ],
          errorName: "Error",
          args: [reason]
        })
      });
    expect(isUnsupportedEvolutionCard(revert("unsupported card"))).toBe(true);
    expect(
      isUnsupportedEvolutionCard(revert("input artwork unavailable"))
    ).toBe(true);
    expect(isUnsupportedEvolutionCard(revert("another error"))).toBe(false);
    expect(isUnsupportedEvolutionCard(new Error("unsupported card"))).toBe(
      false
    );
    let failure = false;
    const card = vi.fn(async (id: bigint) => {
      if (failure) throw new Error("RPC unavailable");
      if (id === 1n) throw revert("unsupported card");
      if (id === 2n) throw new UnsupportedEvolutionCard("facts unavailable");
      return { tokenId: String(id), owner, graded: false, reservedBy: null };
    });
    const context = {
      deployment: "fixture",
      schema: '"fixture"',
      cards: owner,
      release: { id: "fixture" },
      block: 100n,
      hash,
      timestamp: 100
    };
    const db = {
      query: async (_sql: string, params: string[]) => ({
        rows: Array.from({ length: 14 }, (_, i) => ({ token: String(i + 1) }))
          .filter((row) => BigInt(row.token) > BigInt(params[3]))
          .slice(0, 13)
      })
    };
    const runtime = {
      store: { deployment: "fixture" },
      reader: {
        snapshot: async (fn: (db: unknown, context: unknown) => unknown) =>
          fn(db, { ...context })
      },
      chain: {
        card,
        grading: owner,
        client: {
          getBlock: async () => ({ number: 100n, hash, timestamp: 100n }),
          readContract: async () => 1n
        }
      }
    } as unknown as EvolutionRuntime;
    const app = new Hono();
    registerEvolutionRoutes(app, {
      enabled: () => true,
      runtime: async () => runtime
    });
    const first = await app.request(`/v1/evolution/owners/${owner}?portalId=1`);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.cards.map((v: { tokenId: string }) => v.tokenId)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 3))
    );
    expect(
      JSON.parse(Buffer.from(body.nextAfter, "base64url").toString()).id
    ).toBe("12");
    const second = await (
      await app.request(
        `/v1/evolution/owners/${owner}?portalId=1&after=${body.nextAfter}`
      )
    ).json();
    expect(second.cards.map((v: { tokenId: string }) => v.tokenId)).toEqual([
      "13",
      "14"
    ]);
    expect(second.nextAfter).toBeNull();
    failure = true;
    expect((await app.request(`/v1/evolution/owners/${owner}`)).status).toBe(
      503
    );
  });
});

it("serves published artifacts and bound masks while intake is disabled, never unpublished files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evolution-assets-"));
  try {
    const assets = new PortalAssets(
      directory,
      "https://assets.example",
      [],
      undefined,
      false,
      "/v1/evolution/assets"
    );
    const png = new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"><rect width="100" height="150" fill="purple"/></svg>'
    )
      .render()
      .asPng();
    const image = await assets.put(png, "png");
    const layers = await saveHoloLayers(assets, png, image.hash, geometry);
    const metadata = await assets.putJson({
      image: image.uri,
      yunipals: { holo: layers }
    });
    const portalApp = new Hono();
    const portalRuntime = {
      assets,
      ledger: {
        snapshot: async (next: () => Promise<unknown>) => next(),
        cursor: async () => null
      },
      chain: {
        deployment: { cards: owner },
        card: async () => ({
          historyCount: 0n,
          history: [],
          asOfBlock: 100n,
          evolution: { history: { level: 1, finish: 3 } }
        }),
        owner: async () => owner,
        input: async () => [image, 1n],
        client: { readContract: async () => metadata.uri }
      }
    } as unknown as PortalRuntime;
    registerPortalRoutes(portalApp, {
      enabled: () => true,
      runtime: async () => portalRuntime
    });
    const portalResponse = await portalApp.request("/v1/portals/cards/1.json");
    expect(portalResponse.status).toBe(200);
    const portalMetadata = await portalResponse.json();
    expect(portalMetadata.yunipals.holo).toEqual(layers);
    expect(portalMetadata.yunipals.version).toBe("1");
    expect(portalMetadata.yunipals.historyCount).toBe("0");
    const unpublished = await assets.putJson({ private: true });
    let canonical = true;
    const publications = vi.fn(async (value: string) =>
      canonical && [image.hash, metadata.hash].some((hash) => hash === value)
        ? [{ artworkHash: image.hash, metadataHash: metadata.hash }]
        : []
    );
    const reader = { publications } as unknown as EvolutionReader;
    const runtime = vi.fn(async () => {
      throw new Error("live sources unavailable");
    });
    const app = new Hono();
    registerEvolutionRoutes(app, {
      enabled: () => false,
      runtime,
      assetRuntime: () => ({ assets, reader })
    });
    for (const uri of [image.uri, metadata.uri, ...Object.values(layers)]) {
      const response = await app.request(new URL(uri).pathname);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
    expect(runtime).not.toHaveBeenCalled();
    expect((await app.request(new URL(unpublished.uri).pathname)).status).toBe(
      404
    );
    const rawMask = layers.foreground.split("/").at(-1)!;
    expect((await app.request(`/v1/evolution/assets/${rawMask}`)).status).toBe(
      404
    );
    expect(
      (
        await app.request(
          `/v1/evolution/layers/${image.hash.slice(2)}/${image.hash.slice(2)}.png`
        )
      ).status
    ).toBe(404);
    expect((await app.request("/v1/evolution/config")).status).toBe(503);
    canonical = false;
    expect((await app.request(new URL(image.uri).pathname)).status).toBe(404);
    expect(
      (await app.request(new URL(layers.foreground).pathname)).status
    ).toBe(404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("serum sponsorship quotes", () => {
  function fixture(fee: bigint, used: bigint) {
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (["serumApplicationFee", "fusionFee"].includes(functionName))
          return fee;
        if (
          ["sponsoredSerumsUsed", "sponsoredFusionsUsed"].includes(functionName)
        )
          return used;
        if (functionName === "quoteRandomness") return 100n;
        throw new Error(`Unexpected read: ${functionName}`);
      }
    );
    const runtime = {
      store: { deployment: "fixture" },
      portal: { chain: { deployment: { chainId: 8453, usdc: owner } } },
      reader: {
        snapshot: async (fn: (db: unknown, ctx: unknown) => unknown) =>
          fn(
            {},
            {
              deployment: "fixture",
              evolution: owner,
              block: 100n,
              hash
            }
          )
      },
      chain: {
        client: {
          getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
            number: blockNumber ?? 110n,
            hash,
            timestamp: 1000n
          }),
          estimateFeesPerGas: async () => ({
            maxFeePerGas: 10n,
            maxPriorityFeePerGas: 1n
          }),
          readContract
        },
        fusionLevel: async () => 1,
        card: async (id: bigint) => ({
          tokenId: String(id),
          level: 0,
          sources: [{ originalTokenId: "1", sequence: Number(id) - 1 }],
          owner,
          graded: false,
          reservedBy: null,
          pendingGrade: null,
          localDoses: 0,
          finish: 0,
          effectiveSequence: 0,
          artVersion: "0",
          historyHash: hash,
          unused: { catalogueVersion: 1, serumId: 121, presenceId: 1 }
        })
      }
    } as unknown as EvolutionRuntime;
    const app = new Hono();
    registerEvolutionRoutes(app, {
      enabled: () => true,
      runtime: async () => runtime
    });
    return { app, readContract };
  }
  it.each([0n, 100000n])(
    "binds the live %s fee into the consumption calldata",
    async (fee) => {
      const { app, readContract } = fixture(fee, fee === 0n ? 999n : 1000n);
      const response = await app.request(
        `/v1/evolution/quote?kind=serum&tokenId=1&owner=${owner}`
      );
      expect(response.status).toBe(200);
      const quote = await response.json();
      expect(quote.fee).toBe(String(fee));
      const { decodeFunctionData } = await import("viem");
      const { evolutionAbi } = await import(
        "../../../packages/yunipals-market-core/src/evolutionAbi.js"
      );
      const decoded = decodeFunctionData({
        abi: evolutionAbi,
        data: quote.data
      });
      expect(decoded.functionName).toBe("consumeSerum");
      expect(decoded.args).toHaveLength(6);
      expect(decoded.args?.[3]).toBe(fee);
      expect(quote.value).toBe("125"); // Sponsorship never removes the first-finish VRF fee.
      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "serumApplicationFee",
          blockNumber: 110n
        })
      );
    }
  );
  it.each([0n, 100000n])(
    "binds the live %s fusion fee into capped calldata",
    async (fee) => {
      const { app, readContract } = fixture(fee, fee === 0n ? 999n : 1000n);
      const response = await app.request(
        `/v1/evolution/quote?kind=fusion&tokenId=1&partnerId=2&owner=${owner}`
      );
      expect(response.status).toBe(200);
      const quote = await response.json();
      const { decodeFunctionData } = await import("viem");
      const { evolutionAbi } = await import(
        "../../../packages/yunipals-market-core/src/evolutionAbi.js"
      );
      const decoded = decodeFunctionData({
        abi: evolutionAbi,
        data: quote.data
      });
      expect(decoded.functionName).toBe("fuse");
      expect(decoded.args).toHaveLength(7);
      expect(decoded.args?.[4]).toBe(fee);
      expect(quote.fee).toBe(String(fee));
      expect(quote.value).toBe("125");
      expect(readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "fusionFee",
          blockNumber: 110n
        })
      );
    }
  );
  it("reads the independent fusion sponsorship counter at the confirmed boundary", async () => {
    const { app, readContract } = fixture(0n, 123n);
    const response = await app.request("/v1/evolution/sponsorship?kind=fusion");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      limit: 1000,
      used: 123,
      remaining: 877,
      block: "100"
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "sponsoredFusionsUsed",
        blockNumber: 100n
      })
    );
    readContract.mockRejectedValue(new Error("Upgrade not installed"));
    expect(
      (await app.request("/v1/evolution/sponsorship?kind=fusion")).status
    ).toBe(503);
    expect(
      (
        await app.request(
          `/v1/evolution/quote?kind=fusion&tokenId=1&partnerId=2&owner=${owner}`
        )
      ).status
    ).toBe(503);
  });
  it("reads availability at the canonical confirmed boundary", async () => {
    const { app, readContract } = fixture(0n, 999n);
    const response = await app.request("/v1/evolution/sponsorship");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      limit: 1000,
      used: 999,
      remaining: 1,
      block: "100",
      hash
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "sponsoredSerumsUsed",
        blockNumber: 100n
      })
    );
  });
  it("does not invent free availability when the counter read fails", async () => {
    const { app, readContract } = fixture(0n, 0n);
    readContract.mockRejectedValue(new Error("RPC unavailable"));
    expect((await app.request("/v1/evolution/sponsorship")).status).toBe(503);
  });
});

describe("daily crew quotes", () => {
  const day = 20000;
  function fixture(drawn = true) {
    let now = BigInt(day * 86400 + 86300);
    const cards = [1, 2, 3].map((id) => ({
      tokenId: String(id),
      owner,
      level: 0,
      sources: [
        {
          tokenId: String(id),
          sequence: id,
          mintedAt: day * 86400 + 1,
          color: 1,
          horn: 2,
          monsterType: 3
        }
      ],
      effectiveSequence: id,
      nextAdventureAt: 0,
      reservedBy: null,
      pendingGrade: null,
      graded: false
    }));
    const readContract = vi.fn(
      async ({ functionName }: { functionName: string }): Promise<unknown> => {
        if (functionName === "crewMode") return true;
        if (functionName === "dailyCrew")
          return drawn ? [1n, 1, 3, true] : [0n, 0, 0, false];
        if (functionName === "quoteRandomness") return 100n;
        throw Error(functionName);
      }
    );
    const runtime = {
      store: { deployment: "fixture" },
      reader: {
        snapshot: async (fn: (db: unknown, ctx: unknown) => unknown) =>
          fn(
            {},
            {
              deployment: "fixture",
              adventures: owner,
              evolution: owner,
              block: 100n,
              hash
            }
          )
      },
      chain: {
        card: async (id: bigint) => cards[Number(id) - 1],
        client: {
          getBlock: async () => ({ number: 110n, hash, timestamp: now }),
          estimateFeesPerGas: async () => ({ maxFeePerGas: 10n }),
          readContract
        }
      },
      portal: { chain: { deployment: { chainId: 8453 } } }
    } as unknown as EvolutionRuntime;
    const app = new Hono();
    registerEvolutionRoutes(app, {
      enabled: () => true,
      runtime: async () => runtime
    });
    return {
      app,
      cards,
      readContract,
      tomorrow: () => {
        now += 86400n;
      }
    };
  }
  it("quotes an undrawn day's capped fee through the API and expires it before midnight", async () => {
    const { app, readContract, tomorrow } = fixture(false);
    const response = await app.request(`/v1/evolution/crew/quote?day=${day}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chainId: 8453,
      adventures: owner,
      day,
      value: "125",
      expiresAt: (day + 1) * 86400 - 1
    });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "quoteRandomness",
        args: [10n],
        blockNumber: 110n
      })
    );
    tomorrow();
    expect(
      (await app.request(`/v1/evolution/crew/quote?day=${day}`)).status
    ).toBe(409);
  });
  it("rejects unavailable draws and fails closed when fee data is unavailable", async () => {
    const { app, readContract } = fixture();
    expect(
      (await app.request(`/v1/evolution/crew/quote?day=${day}`)).status
    ).toBe(409);
    expect((await app.request("/v1/evolution/crew/quote?day=bad")).status).toBe(
      400
    );
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "crewMode") return false;
      if (functionName === "dailyCrew") return [0n, 0, 0, false];
      throw Error("RPC unavailable");
    });
    expect(
      (await app.request(`/v1/evolution/crew/quote?day=${day}`)).status
    ).toBe(409);
    readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "crewMode") return true;
      if (functionName === "dailyCrew") return [0n, 0, 0, false];
      throw Error("RPC unavailable");
    });
    expect(
      (await app.request(`/v1/evolution/crew/quote?day=${day}`)).status
    ).toBe(503);
  });
  it("binds ordered roles, the chosen survivor, guaranteed odds and midnight deadline", async () => {
    const { app } = fixture();
    const response = await app.request(
      `/v1/evolution/quote?kind=adventure&tokenId=2&crew=1,2,3&day=${day}&owner=${owner}`
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const { decodeFunctionData } = await import("viem");
    const { adventureAbi } = await import(
      "../../../packages/yunipals-market-core/src/evolutionAbi.js"
    );
    const call = decodeFunctionData({ abi: adventureAbi, data: body.data });
    expect(call.functionName).toBe("crewAdventure");
    expect(call.args?.slice(0, 3)).toEqual([[1n, 2n, 3n], 2n, BigInt(day)]);
    expect(call.args?.at(-1)).toBe(BigInt((day + 1) * 86400 - 1));
    expect(body.odds.weights[0]).toBe(0);
  });
  it("rejects duplicate cards, missing newborns, foreign ownership and stale days", async () => {
    const { app, cards, tomorrow } = fixture();
    const query = (crew = "1,2,3") =>
      app.request(
        `/v1/evolution/quote?kind=adventure&tokenId=2&crew=${crew}&day=${day}&owner=${owner}`
      );
    expect((await query("1,2,2")).status).toBe(409);
    cards.forEach((card) => {
      card.sources[0].mintedAt -= 86400;
    });
    expect((await query()).status).toBe(409);
    cards[0].sources[0].mintedAt += 86400;
    cards[2].owner = `0x${"3".repeat(40)}`;
    expect((await query()).status).toBe(409);
    cards[2].owner = owner;
    tomorrow();
    expect((await query()).status).toBe(409);
  });
});
