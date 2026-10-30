/** Private rehearsal staging from reviewed studio publications, never prototype art. */
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir
} from "node:fs/promises";
import { join } from "node:path";
import {
  ANIME_BASE_COLLECTION,
  animeTokenId,
  parseAnimeManifest,
  parseAnimeLoadout,
  type AnimeManifest,
  type AnimeKnownKit
} from "@protopals/yunipals-market-core/anime";
import { AnimeFighters, animeDigest } from "./animeFighters";

export async function stageStudioRehearsal(
  root: string,
  publication: string,
  tokens: string[],
  assets: string
) {
  if (tokens.length !== 4 || new Set(tokens.map(animeTokenId)).size !== 4)
    throw new Error(
      "A studio rehearsal requires four different reviewed v2 tokens."
    );
  const recipe = JSON.parse(
    await readFile(
      join(root, "docs/arena/anime-recipe-v2/recipe-lock.json"),
      "utf8"
    )
  ) as { sha256: string };
  const origin = "https://assets-anime.yunipals.com";
  const factory = new AnimeFighters(
    {} as never,
    `0x${"1".repeat(40)}`,
    origin,
    (async (raw: string) => {
      const url = new URL(raw);
      if (
        url.origin !== origin ||
        !/^\/(fighters\/v1|recipes\/anime-fighter-v2)\/[A-Za-z0-9_./-]+$/.test(
          url.pathname
        ) ||
        url.pathname.split("/").includes("..")
      )
        throw new Error("Unexpected studio rehearsal asset path.");
      return new Response(
        await readFile(join(publication, url.pathname.slice(1)))
      );
    }) as typeof fetch,
    recipe.sha256
  );
  const manifests: Record<
    string,
    { manifest: AnimeManifest; manifestHash: string; loadout: [string, string] }
  > = {};
  const sprites: Record<string, { file: string; sha256: string }> = {};
  const loadouts: Record<string, AnimeKnownKit[]> = {};
  const roster = [];
  await mkdir(assets, { recursive: true, mode: 0o700 });
  for (const tokenId of tokens) {
    const parsed = parseAnimeManifest(
      JSON.parse(
        await readFile(
          join(publication, "fighters/v1", tokenId, "manifest.json"),
          "utf8"
        )
      ),
      tokenId
    );
    if (
      parsed.recipe.id !== "anime-fighter-v2" ||
      parsed.recipe.sha256 !== recipe.sha256 ||
      parsed.kits?.length !== 3
    )
      throw new Error(
        "Studio rehearsals refuse prototype and obsolete fighter kits."
      );
    const manifestHash = animeDigest(parsed);
    const m = await factory.manifest(tokenId, manifestHash, true);
    const snapshot = factory.snapshot(
      { nftChainId: 8453, collection: ANIME_BASE_COLLECTION, tokenId },
      m
    );
    const id = snapshot.id,
      loadout = parseAnimeLoadout(m)!;
    roster.push(snapshot);
    manifests[id] = { manifest: m, manifestHash, loadout };
    loadouts[id] = loadout.map((kitId) => {
      const { id, name, kind, description } = m.kits!.find(
        (k) => k.id === kitId
      )!;
      return { id, name, kind, description };
    });
    for (const [pose, sprite] of [
      ...Object.entries(m.sprites),
      ...m.kits!.map((k) => [`windup-${k.id}`, k.windup] as const)
    ]) {
      const file = `${id}-${sprite.file}`;
      await writeFile(
        join(assets, file),
        await factory.spriteBytes(tokenId, sprite),
        { mode: 0o600 }
      );
      sprites[`${id}-${pose}`] = { file, sha256: sprite.sha256 };
    }
    for (const kit of m.kits!)
      for (const role of ["projectile", "strike", "impact"] as const) {
        const sheet = kit[role];
        if (!sheet) continue;
        const file = `fx-${sheet.sha256}.webp`;
        await writeFile(join(assets, file), await factory.sheetBytes(sheet), {
          mode: 0o600
        });
        sprites[`${id}-kit-${kit.id}-${role}`] = { file, sha256: sheet.sha256 };
      }
  }
  const staticAssets = join(root, "apps/yunipals-anime-engine/static/assets");
  for (const name of await readdir(staticAssets))
    await copyFile(join(staticAssets, name), join(assets, name));
  sprites["bg-arena"] = {
    file: "bg-arena.webp",
    sha256: createHash("sha256")
      .update(await readFile(join(assets, "bg-arena.webp")))
      .digest("hex")
  };
  await writeFile(join(assets, "sprites.json"), JSON.stringify(sprites));
  await writeFile(join(assets, "fighters.json"), JSON.stringify(manifests));
  return {
    roster,
    loadouts,
    manifestHashes: roster.map((f) => f.animeManifestHash!)
  };
}
