import { createHash } from "node:crypto";
import { parseAbi, type Address, type PublicClient } from "viem";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import {
  ANIME_BASE_COLLECTION,
  ANIME_STATUSES,
  animeTokenId,
  canonicalAnimeJson,
  parseAnimeManifest,
  type AnimeTraits,
  type AnimeManifest,
  type AnimeSprite,
  type AnimeSheet
} from "@protopals/yunipals-market-core/anime";
import type { FighterSnapshot } from "./identity";
import type { AdmissionRequest } from "./admission";
import { ArenaRequestError } from "./intake";

export const animeTraitsAbi = parseAbi([
  "function yunipal(uint256 tokenId) view returns ((uint16 monsterType,uint16 color,uint16 horn,uint8 background,uint8 glitter,uint40 rarityScore))"
]);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const animeDigest = (value: unknown) =>
  `0x${hash(canonicalAnimeJson(value))}`;
export function animeTraits(value: AnimeTraits): AnimeTraits {
  return {
    monsterType: value.monsterType,
    color: value.color,
    horn: value.horn,
    background: value.background,
    glitter: value.glitter
  };
}

export async function boundedAnimeFetch(
  url: string,
  maximum: number,
  fetcher: typeof fetch = fetch
): Promise<Buffer> {
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok || !response.body)
    throw new Error("Anime asset unavailable.");
  const reader = response.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw new Error("Anime asset exceeds size limit.");
      parts.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts);
}

export class AnimeFighters {
  constructor(
    readonly client: PublicClient,
    readonly registry: Address,
    readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly recipeSha256?: string
  ) {}
  async status(tokenId: string, blockNumber?: bigint) {
    const [status, recipeVersion, applications, manifestHash] =
      await this.client.readContract({
        address: this.registry,
        abi: animeRegistryAbi,
        functionName: "fighters",
        args: [BigInt(animeTokenId(tokenId))],
        blockNumber
      });
    return {
      tokenId,
      status: ANIME_STATUSES[status],
      recipeVersion,
      applications,
      manifestHash
    };
  }
  async manifest(
    tokenId: string,
    manifestHash: string,
    sprites = false
  ): Promise<AnimeManifest> {
    const root = `${this.origin}/fighters/v1/${animeTokenId(tokenId)}/`;
    let bytes: Buffer;
    try {
      bytes = await boundedAnimeFetch(
        root + `manifest.${manifestHash.slice(2)}.json`,
        65536,
        this.fetcher
      );
    } catch {
      bytes = await boundedAnimeFetch(
        root + "manifest.json",
        65536,
        this.fetcher
      );
    }
    const m = parseAnimeManifest(JSON.parse(bytes.toString("utf8")), tokenId);
    if (animeDigest(m) !== manifestHash.toLowerCase())
      throw new ArenaRequestError(
        409,
        "This fighter's published art differs from its approval. Curator review is required."
      );
    if (sprites) {
      for (const sprite of Object.values(m.sprites))
        await this.spriteBytes(tokenId, sprite);
      const sheets = new Map<string, AnimeSheet>();
      for (const kit of m.kits ?? []) {
        await this.spriteBytes(tokenId, kit.windup);
        for (const sheet of [kit.projectile, kit.strike, kit.impact])
          if (sheet) sheets.set(sheet.sheet, sheet);
      }
      for (const sheet of sheets.values()) await this.sheetBytes(sheet);
    }
    return m;
  }
  async spriteBytes(tokenId: string, sprite: AnimeSprite) {
    if (
      !/^(?:[a-z]+|windup-[a-z][a-z0-9-]{0,39})\.[a-f0-9]{8}\.webp$/.test(
        sprite.file
      ) ||
      !/^[a-f0-9]{64}$/.test(sprite.sha256)
    )
      throw new Error("Invalid anime sprite reference.");
    const bytes = await boundedAnimeFetch(
      `${this.origin}/fighters/v1/${animeTokenId(tokenId)}/${sprite.file}`,
      16 * 1024 * 1024,
      this.fetcher
    );
    if (hash(bytes) !== sprite.sha256)
      throw new Error("Anime sprite checksum mismatch.");
    return bytes;
  }
  async sheetBytes(sheet: AnimeSheet) {
    if (
      !/^recipes\/anime-fighter-v2\/species\/[a-z][a-z0-9-]*\/(?:[a-z][a-z0-9-]*\.)?(?:projectile|strike|impact)\.[a-f0-9]{8}\.webp$/.test(
        sheet.sheet
      ) ||
      !/^[a-f0-9]{64}$/.test(sheet.sha256)
    )
      throw new Error("Invalid anime sheet reference.");
    const bytes = await boundedAnimeFetch(
      `${this.origin}/${sheet.sheet}`,
      16 * 1024 * 1024,
      this.fetcher
    );
    if (hash(bytes) !== sheet.sha256)
      throw new Error("Anime sheet checksum mismatch.");
    return bytes;
  }
  async eligible(nft: AdmissionRequest, blockNumber: bigint) {
    if (
      nft.nftChainId !== 8453 ||
      nft.collection.toLowerCase() !== ANIME_BASE_COLLECTION
    )
      throw new ArenaRequestError(
        400,
        "The anime arena accepts Base OG Yunipals only."
      );
    const state = await this.status(nft.tokenId, blockNumber);
    if (state.status !== "Approved" || state.recipeVersion !== 2)
      throw new ArenaRequestError(
        409,
        "This Base Yunipal needs curator approval before entering the anime arena."
      );
    const manifest = await this.manifest(nft.tokenId, state.manifestHash);
    if (
      manifest.recipe.id !== "anime-fighter-v2" ||
      (this.recipeSha256 && manifest.recipe.sha256 !== this.recipeSha256)
    )
      throw new ArenaRequestError(
        409,
        "This fighter uses an unsupported recipe. Curator review is required."
      );
    const current = await this.client.readContract({
      address: ANIME_BASE_COLLECTION,
      abi: animeTraitsAbi,
      functionName: "yunipal",
      args: [BigInt(nft.tokenId)],
      blockNumber
    });
    if (
      animeDigest(animeTraits(current)) !== manifest.traitsHash ||
      animeDigest(manifest.traits) !== manifest.traitsHash
    )
      throw new ArenaRequestError(
        409,
        "This Yunipal's traits changed after approval. The curator needs to revoke and review its fighter art."
      );
    return manifest;
  }
  snapshot(
    nft: AdmissionRequest,
    m: AnimeManifest,
    manifestHash = animeDigest(m)
  ): FighterSnapshot {
    return {
      id: `nft-8453-${ANIME_BASE_COLLECTION}-${nft.tokenId}`,
      name: `${m.identity.species} #${nft.tokenId}`,
      tokenId: nft.tokenId,
      chain: "base",
      chainId: 8453,
      collection: ANIME_BASE_COLLECTION,
      species: m.identity.species,
      color: m.identity.color,
      horn: m.identity.horn,
      identity: m.identity.text,
      locomotion: m.identity.locomotion,
      image: m.artwork.url,
      imageSha256: m.artwork.sha256,
      sourcePage: `https://www.yunipals.com/collection/base/${nft.tokenId}`,
      metadataSha256: m.traitsHash.slice(2),
      identityProfileSha256: hash(canonicalAnimeJson(m.identity)),
      identityVersion: "anime-fighter-v1",
      animeManifestHash: manifestHash,
      animeRecipeHash: m.recipe.sha256,
      ...(m.kits
        ? {
            animeKits: m.kits.map((k) => ({
              id: k.id,
              name: k.name,
              kind: k.kind,
              description: k.description
            })),
            animeDefaultLoadout: m.defaultLoadout!
          }
        : {})
    };
  }
}
