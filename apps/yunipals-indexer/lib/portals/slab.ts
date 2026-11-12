import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderAsync } from "@resvg/resvg-js";
import { renderPortalSlab } from "@protopals/yunipals-market-core/portalSlab";
import { portalAssetHash, type PortalAssets } from "./assets.js";
import type { PortalCompletion } from "./chain.js";

const fontFiles = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
  fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))
);
export const portalSlabRenderer = "portal-slab-layout-v1/resvg-js-2.6.2";
export async function publishPortalSlab(
  assets: PortalAssets,
  input: {
    chainId: number;
    grading: string;
    requestId: string;
    tokenId: string;
    kindId: string;
    version: string;
    spell: string;
    result: PortalCompletion;
  }
) {
  const image = await assets.input(
    input.result.artwork.uri,
    input.result.artwork.hash
  );
  const bytes = Buffer.from(image);
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) > 4096 ||
    bytes.readUInt32BE(20) > 4096
  )
    throw new Error("Invalid slab source artwork.");
  const [creativity, harmony, craft, impact] = input.result.scores;
  const svg = renderPortalSlab({
    kindId: input.kindId,
    tokenId: input.tokenId,
    version: input.version,
    title: input.spell,
    imageURI: `data:image/png;base64,${bytes.toString("base64")}`,
    scores: { creativity, harmony, craft, impact }
  });
  const png = await renderAsync(svg, {
    fitTo: { mode: "original" },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans"
    },
    languages: ["en"],
    logLevel: "off"
  });
  if (png.width !== 720 || png.height !== 1360)
    throw new Error("Unexpected slab dimensions.");
  const display = await assets.put(png.asPng(), "png");
  const manifest = await assets.putJson({
    schema: "yunipals-portal-slab-v1",
    renderer: portalSlabRenderer,
    fonts: await Promise.all(
      fontFiles.map(async (path) => portalAssetHash(await readFile(path)))
    ),
    svgHash: portalAssetHash(Buffer.from(svg)),
    chainId: input.chainId,
    grading: input.grading.toLowerCase(),
    requestId: input.requestId,
    tokenId: input.tokenId,
    kindId: input.kindId,
    version: input.version,
    rawArtworkHash: input.result.artwork.hash,
    reportHash: input.result.reportHash,
    scores: { creativity, harmony, craft, impact },
    display
  });
  return {
    ...display,
    manifest,
    renderer: portalSlabRenderer,
    rawArtworkHash: input.result.artwork.hash,
    version: input.version
  };
}
export type PortalPublishedSlab = Awaited<ReturnType<typeof publishPortalSlab>>;
