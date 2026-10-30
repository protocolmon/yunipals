import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ANIME_ASSETS_ORIGIN,
  type AnimeBackground
} from "@protopals/yunipals-market-core/anime";
import type { Island } from "../types";
import { boundedAnimeFetch } from "./animeFighters";

export const ANIME_BACKGROUND_POLICY =
  "reviewed-per-island-or-shared-preview/v1";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export function parseAnimeBackground(value: unknown): AnimeBackground {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Missing anime background.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !==
      [
        "version",
        "mode",
        "file",
        "sha256",
        "w",
        "h",
        "sourceIslandTokenId",
        "sourceProfileSha256"
      ]
        .sort()
        .join(",") ||
    v.version !== "anime-background/v1" ||
    (v.mode !== "shared-preview" && v.mode !== "island") ||
    typeof v.file !== "string" ||
    typeof v.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sha256) ||
    typeof v.sourceProfileSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sourceProfileSha256) ||
    typeof v.sourceIslandTokenId !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(v.sourceIslandTokenId) ||
    ![v.w, v.h].every(
      (n) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 4096
    )
  )
    throw new Error("Invalid anime background metadata.");
  const file = v.file;
  if (
    v.mode === "shared-preview"
      ? !/^engine\/[0-9]+\.[0-9]+\.[0-9]+\/static\/assets\/bg-arena\.webp$/.test(
          file
        )
      : file !==
        `islands/v1/${v.sourceIslandTokenId}/arena.${v.sha256.slice(0, 8)}.webp`
  )
    throw new Error("Invalid anime background path.");
  return v as AnimeBackground;
}

export function compileAnimeBackgroundCatalog(
  value: unknown,
  islands: readonly Island[]
) {
  const v = value as {
    version?: unknown;
    fallback?: unknown;
    islands?: unknown;
  };
  if (
    !v ||
    v.version !== "anime-background-catalog/v1" ||
    !v.islands ||
    typeof v.islands !== "object" ||
    Array.isArray(v.islands)
  )
    throw new Error("Invalid anime background catalog.");
  const fallback = parseAnimeBackground(v.fallback);
  const source = islands.find(
    (i) => i.tokenId === fallback.sourceIslandTokenId
  );
  if (
    fallback.mode !== "shared-preview" ||
    source?.profileSha256 !== fallback.sourceProfileSha256
  )
    throw new Error(
      "Shared backdrop source does not match the island catalog."
    );
  const overrides = new Map<string, AnimeBackground>();
  for (const [id, value] of Object.entries(v.islands)) {
    const background = parseAnimeBackground(value),
      island = islands.find((i) => i.tokenId === id);
    if (
      !island ||
      background.mode !== "island" ||
      background.sourceIslandTokenId !== id ||
      background.sourceProfileSha256 !== island.profileSha256
    )
      throw new Error(
        "Island artwork does not match its frozen terrain profile."
      );
    overrides.set(id, background);
  }
  return islands.map((island) => ({
    ...island,
    animeBackground: overrides.get(island.tokenId) ?? fallback
  }));
}

export function loadAnimeBackgroundCatalog(
  root: string,
  islands: readonly Island[]
) {
  return compileAnimeBackgroundCatalog(
    JSON.parse(
      readFileSync(join(root, "docs/arena/anime-backgrounds-v1.json"), "utf8")
    ),
    islands
  );
}

/** Render the exact asset frozen with this tournament, even after catalog updates. */
export async function frozenAnimeBackground(
  root: string,
  island: Pick<Island, "tokenId" | "profileSha256" | "animeBackground">,
  fetcher: typeof fetch = fetch
) {
  const background = parseAnimeBackground(island.animeBackground);
  if (
    background.mode === "island" &&
    (background.sourceIslandTokenId !== island.tokenId ||
      background.sourceProfileSha256 !== island.profileSha256)
  )
    throw new Error("Frozen island artwork differs from the selected island.");
  let bytes: Buffer | undefined;
  if (background.mode === "shared-preview") {
    const local = await readFile(
      join(root, "apps/yunipals-anime-engine/static/assets/bg-arena.webp")
    );
    if (digest(local) === background.sha256) bytes = local;
  }
  bytes ??= await boundedAnimeFetch(
    `${ANIME_ASSETS_ORIGIN}/${background.file}`,
    10 * 1024 * 1024,
    fetcher
  );
  if (digest(bytes) !== background.sha256)
    throw new Error("Frozen anime background checksum failed.");
  return { background, bytes };
}
