import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PortalAssets, portalAssetHash } from "../lib/portals/assets.js";
import { publishPortalSlab, portalSlabRenderer } from "../lib/portals/slab.js";
import type { PortalCompletion } from "../lib/portals/chain.js";

let directory: string;
let assets: PortalAssets;
let image: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "portal-slab-test-"));
  assets = new PortalAssets(directory, "https://portal.example.test", [
    "portal.example.test"
  ]);
  image = await readFile(
    new URL(
      "../../../docs/boosters/artwork-runtime/assets/7cc78b1050c1c9cadf78b74057c4f059499c123c7217e14ca9efc6c18550d08a.png",
      import.meta.url
    )
  );
});
afterAll(() => rm(directory, { recursive: true, force: true }));

describe("confirmed graded slab artifacts", () => {
  it("produces stable PNG and manifest hashes, preserves raw AI input and binds all scores", async () => {
    const artwork = await assets.put(image, "png");
    const result = {
      artwork,
      scores: [91, 87, 90, 95],
      reportHash: `0x${"a".repeat(64)}`
    } as unknown as PortalCompletion;
    const input = {
      chainId: 8453,
      grading: `0x${"1".repeat(40)}`,
      requestId: "3",
      tokenId: "81",
      kindId: "1",
      version: "2",
      spell:
        "Create a crown of stained-glass stars <script>not markup</script>",
      result
    };
    const first = await publishPortalSlab(assets, input);
    const again = await publishPortalSlab(assets, input);
    expect(again).toEqual(first);
    expect(first.hash).not.toBe(artwork.hash);
    expect(first.rawArtworkHash).toBe(artwork.hash);
    expect(first.renderer).toBe(portalSlabRenderer);
    const bytes = await assets.read(first.hash.slice(2), "png");
    expect(bytes.readUInt32BE(16)).toBe(720);
    expect(bytes.readUInt32BE(20)).toBe(1360);
    const manifest = JSON.parse(
      (await assets.read(first.manifest.hash.slice(2), "json")).toString()
    );
    expect(manifest).toMatchObject({
      chainId: 8453,
      tokenId: "81",
      requestId: "3",
      kindId: "1",
      version: "2",
      rawArtworkHash: artwork.hash,
      scores: { creativity: 91, harmony: 87, craft: 90, impact: 95 }
    });
    expect(manifest.fonts).toHaveLength(2);
    expect(await assets.input(artwork.uri, artwork.hash)).toEqual(image);
    const changed = await publishPortalSlab(assets, {
      ...input,
      result: { ...result, scores: [90, 87, 90, 95] }
    });
    expect(changed.hash).not.toBe(first.hash);
    expect(changed.manifest.hash).not.toBe(first.manifest.hash);
  }, 20000);
  it("recovers an interrupted display write without changing original artwork bytes", async () => {
    const artwork = await assets.put(image, "png");
    const input = {
      chainId: 8453,
      grading: `0x${"1".repeat(40)}`,
      requestId: "4",
      tokenId: "82",
      kindId: "1",
      version: "1",
      spell: "A glass star crown",
      result: {
        artwork,
        scores: [80, 80, 80, 80],
        reportHash: `0x${"b".repeat(64)}`
      } as unknown as PortalCompletion
    };
    const slab = await publishPortalSlab(assets, input);
    await rm(join(directory, `${slab.hash.slice(2)}.png`));
    const recovered = await publishPortalSlab(assets, input);
    expect(recovered).toEqual(slab);
    expect(
      portalAssetHash(await assets.read(artwork.hash.slice(2), "png"))
    ).toBe(artwork.hash);
  });
  it("supports explicit API group read while keeping private-mode artifacts private", async () => {
    const privateArtifact = await assets.putJson({ private: true });
    const shared = new PortalAssets(
      directory,
      "https://portal.example.test",
      [],
      undefined,
      true
    );
    const sharedArtifact = await shared.putJson({ shared: true });
    expect(
      (await stat(join(directory, `${privateArtifact.hash.slice(2)}.json`)))
        .mode & 0o777
    ).toBe(0o600);
    expect(
      (await stat(join(directory, `${sharedArtifact.hash.slice(2)}.json`)))
        .mode & 0o777
    ).toBe(0o640);
  });
});
