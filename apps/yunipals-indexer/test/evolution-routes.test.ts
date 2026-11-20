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
