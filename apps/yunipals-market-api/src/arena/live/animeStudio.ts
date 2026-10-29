import { animeRepository } from "./animeRepository";
/** Read-only studio preparation and unsigned calldata. Never imports signing runtime. */
import { readFileSync } from "node:fs";
import { encodeFunctionData, isAddress, type Hex } from "viem";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import {
  ANIME_BASE_COLLECTION,
  animeTokenId,
  parseAnimeManifest,
  canonicalAnimeJson
} from "@protopals/yunipals-market-core/anime";
import { arenaRpcClients } from "./config";
import {
  indexerMetadata,
  identityMetadata,
  loadIdentityProfiles
} from "./identity";
import {
  animeTraitsAbi,
  animeDigest,
  animeTraits,
  boundedAnimeFetch
} from "./animeFighters";
import { createHash } from "node:crypto";
const [operation, arg] = process.argv.slice(2);
if (operation === "prepare") {
  const tokenId = animeTokenId(arg!);
  const nft = { nftChainId: 8453, collection: ANIME_BASE_COLLECTION, tokenId };
  const base = arenaRpcClients().get(8453)!;
  const block = await base.getBlock({ blockTag: "finalized" });
  const traits = animeTraits(
    await base.readContract({
      address: ANIME_BASE_COLLECTION,
      abi: animeTraitsAbi,
      functionName: "yunipal",
      args: [BigInt(tokenId)],
      blockNumber: block.number
    })
  );
  const payload = await indexerMetadata()(nft);
  const metadata = identityMetadata(nft, payload);
  const bytes = await boundedAnimeFetch(metadata.image, 16 * 1024 * 1024);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const profile = loadIdentityProfiles(animeRepository()).find(
    (p) =>
      p.imageSha256 === sha256 &&
      p.species === metadata.species &&
      p.color === metadata.color &&
      p.horn === metadata.horn
  );
  console.log(
    JSON.stringify({
      tokenId,
      chainId: 8453,
      collection: ANIME_BASE_COLLECTION,
      traits,
      traitsHash: animeDigest(traits),
      artwork: { url: metadata.image, sha256 },
      identity: {
        species: metadata.species,
        color: metadata.color,
        horn: metadata.horn,
        text:
          profile?.identity ??
          `${metadata.color} ${metadata.species} with ${metadata.horn} horn. Curator must describe the visible anatomy before approval.`,
        locomotion: profile?.locomotion ?? "ground",
        identityVersion: "anime-fighter-v1"
      },
      identityDraft: !profile,
      block: { number: String(block.number), hash: block.hash }
    })
  );
} else if (operation === "validate") {
  const value = JSON.parse(readFileSync(arg!, "utf8"));
  parseAnimeManifest(value, String(value.tokenId));
  console.log(
    JSON.stringify({
      manifestHash: animeDigest(value),
      canonical: canonicalAnimeJson(value)
    })
  );
} else if (operation === "encode") {
  const input = JSON.parse(readFileSync(arg!, "utf8")) as {
    registry: string;
    functionName: "approve" | "reject";
    ids: string[];
    hashes?: Hex[];
    codes?: number[];
    notes?: string[];
    recipeVersion?: number;
  };
  if (!isAddress(input.registry) || /^0x0{40}$/i.test(input.registry))
    throw new Error("Registry address required");
  const ids = input.ids.map((id) => BigInt(animeTokenId(id)));
  const recipeVersion = input.recipeVersion ?? 1;
  if (![1, 2].includes(recipeVersion))
    throw new Error("Unsupported approval recipe");
  const data =
    input.functionName === "approve"
      ? encodeFunctionData({
          abi: animeRegistryAbi,
          functionName: "approve",
          args: [ids, input.hashes!, recipeVersion]
        })
      : encodeFunctionData({
          abi: animeRegistryAbi,
          functionName: "reject",
          args: [ids, input.codes!, input.notes!]
        });
  console.log(
    JSON.stringify({
      chainId: 8453,
      to: input.registry,
      data,
      value: "0",
      functionName: input.functionName,
      tokenIds: input.ids
    })
  );
} else throw new Error("Usage: anime-studio prepare TOKEN | encode BATCH.json");
