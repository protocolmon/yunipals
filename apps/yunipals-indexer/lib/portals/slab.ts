import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderAsync } from "@resvg/resvg-js";
import {
  renderPortalSlab,
  renderNamedPortalArtwork
} from "@protopals/yunipals-market-core/portalSlab";
import { portalAssetHash, type PortalAssets } from "./assets.js";
import type { PortalCompletion } from "./chain.js";

const fontFiles = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) =>
  fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))
);
export const portalSlabRenderer = "portal-slab-layout-v2/resvg-js-2.6.2";
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
    cardName?: string;
    naming?: { cardName: string; usage: unknown; model: string };
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
  const renderOptions = {
    fitTo: { mode: "original" as const },
    font: {
      fontFiles,
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans"
    },
    languages: ["en"],
    logLevel: "off" as const
  };
  let displayBytes = bytes;
  let namedArtwork: { hash: `0x${string}`; uri: string } | undefined;
  if (input.cardName) {
    const named = await renderAsync(
      renderNamedPortalArtwork(
        `data:image/png;base64,${bytes.toString("base64")}`,
        input.cardName
      ),
      renderOptions
    );
    displayBytes = Buffer.from(named.asPng());
    namedArtwork = await assets.put(displayBytes, "png");
  }
  const [creativity, harmony, craft, impact] = input.result.scores;
  const svg = renderPortalSlab({
    kindId: input.kindId,
    tokenId: input.tokenId,
    version: input.version,
    title: input.cardName ?? `Card #${input.tokenId}`,
    imageURI: `data:image/png;base64,${displayBytes.toString("base64")}`,
    scores: { creativity, harmony, craft, impact }
  });
  const png = await renderAsync(svg, renderOptions);
  if (png.width !== 720 || png.height !== 1360)
    throw new Error("Unexpected slab dimensions.");
  const display = await assets.put(png.asPng(), "png");
  const manifest = await assets.putJson({
    schema: "yunipals-portal-slab-v2",
    cardName: input.cardName ?? null,
    namedArtwork: namedArtwork ?? null,
    naming: input.naming ?? null,
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
    ...(input.cardName ? { cardName: input.cardName, namedArtwork } : {}),
    manifest,
    renderer: portalSlabRenderer,
    rawArtworkHash: input.result.artwork.hash,
    version: input.version
  };
}
export type PortalPublishedSlab = Awaited<ReturnType<typeof publishPortalSlab>>;
