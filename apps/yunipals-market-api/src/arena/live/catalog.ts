import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Hex } from "viem";
import { loadArenaCatalog } from "../catalog";
import { canonicalJson, poolEntries, sha256 } from "../draw";
import {
  ARENA_FALLBACK_ATTACKS,
  ARENA_NFT_COLLECTIONS
} from "@protopals/yunipals-market-core/arena";
import { IDENTITY_POLICY_HASH, IDENTITY_MODEL } from "./identityAnalysis";
import {
  ANIME_DIRECTOR_MODEL,
  ANIME_DIRECTOR_RESERVE,
  ANIME_DIRECTOR_POLICY
} from "./animeDirection";

export const ARENA_POOL_HASH =
  "0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c" as const;
export const ARENA_ISLANDS =
  "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168" as const;

export function loadLiveArenaCatalog(root: string) {
  const catalog = loadArenaCatalog(root, 3);
  const islands = [...catalog.islands].sort(
    (a, b) => Number(a.tokenId) - Number(b.tokenId)
  );
  const pool = {
    chainId: 8453 as const,
    contract: ARENA_ISLANDS,
    entries: poolEntries(islands)
  };
  if (`0x${sha256(canonicalJson(pool))}` !== ARENA_POOL_HASH)
    throw new Error("Published island pool does not match the contract pool.");
  const rules = {
    ...catalog.rules,
    combat: {
      ...catalog.rules.combat,
      status:
        "Production adapter of the tested v2 combat rules. The island draw uses Base Chainlink VRF; the centralized referee interprets freeform strategies.",
      terrainPolicy: String(catalog.rules.combat.terrainPolicy).replace(
        "This lab uses qualitative geometry",
        "Combat uses qualitative geometry"
      )
    }
  };
  // No new combat math or referee prompt. Version the production envelope separately.
  const manifest = {
    version: "arena-mainnet-input-v1",
    chainId: 8453,
    poolHash: ARENA_POOL_HASH,
    rules,
    outputSchemaSha256: sha256(
      canonicalJson(
        JSON.parse(
          readFileSync(
            join(root, "docs/arena/rules-v2/output-schema.json"),
            "utf8"
          )
        )
      )
    ),
    validatorSha256: sha256(
      readFileSync(join(root, "scripts/arena/referee.py"), "utf8")
    ),
    identityPolicy:
      "reviewed-artwork-v1 or artwork-analysis-v1: exact content-addressed artwork and species/color/horn match; visible functional wings required for flight; ambiguous anatomy blocked before payment; no inferred powers or rarity bonuses",
    artworkAnalysis: {
      model: IDENTITY_MODEL,
      policySha256: IDENTITY_POLICY_HASH,
      candidatePolicy: "one cached analysis; no automatic paid replacement"
    },
    supportedNftCollections: ARENA_NFT_COLLECTIONS,
    reviewedIdentityRegistrySha256: sha256(
      canonicalJson(
        JSON.parse(
          readFileSync(
            join(root, "docs/arena/identity-registry-v1/profiles.json"),
            "utf8"
          )
        )
      )
    ),
    tiePriority:
      "sha256-canonical-json-domain-yunipals-arena/tie/v2-tournament-VRFword-fighterId-ascending",
    inputCompilerVersion: "arena-mainnet-input-v1",
    drawAlgorithm: "keccak256-abi-rejection-weighted-v1",
    referee: {
      provider: "openai",
      model: "gpt-6.1-sol",
      reasoning: "xhigh",
      maxOutputTokens: 32000,
      serviceTier: "default",
      candidatePolicy: "first candidate only"
    },
    economics: {
      entryMicrousd: 2000000,
      winnerMicrousd: 6000000,
      islandMicrousd: 400000,
      operationsMicrousd: 1600000
    },
    timing: {
      joinSeconds: 604800,
      strategySeconds: 86400,
      resolutionSeconds: 86400
    },
    policies: {
      refunds:
        "full on unfilled joining expiry or referee failure; no refund for a missing strategy alone",
      missingStrategy: {
        version: "automatic-attack-v1",
        templates: ARENA_FALLBACK_ATTACKS,
        selection:
          "keccak256 ABI domain, chain, contract, tournament, seat, rules hash and VRF word modulo four",
        transitionRecoverySeconds: 86400,
        behavior:
          "Assign only missing seats after the strategy deadline; retain every accepted player strategy. Server failure to freeze within the fixed recovery window allows full refunds. Referee has 24 hours after input freeze."
      },
      withdrawal: "no early withdrawal",
      seatBeneficiary: "entering wallet",
      islandBeneficiary: "owner at onchain selection",
      settlement:
        "result fixed before video; all payouts unlock once the completed film is published and its hash is confirmed onchain"
    }
  };
  return {
    rules,
    islands,
    pool: { ...pool, sha256: ARENA_POOL_HASH.slice(2) },
    manifest,
    rulesHash: `0x${sha256(canonicalJson(manifest))}` as Hex
  };
}
export type LiveArenaCatalog = ReturnType<typeof loadLiveArenaCatalog>;

/** Only the production envelope differs; combat rules and referee settings are identical. */
export function loadAnimeArenaCatalog(root: string, registry: string) {
  if (!/^0x[0-9a-f]{40}$/.test(registry) || /^0x0{40}$/.test(registry))
    throw new Error("Anime registry address is required.");
  const base = loadLiveArenaCatalog(root);
  const engine = JSON.parse(
    readFileSync(
      join(root, "apps/yunipals-anime-engine/engine-lock.json"),
      "utf8"
    )
  ) as { version: string; sha256: string };
  const recipe = JSON.parse(
    readFileSync(
      join(root, "docs/arena/anime-recipe-v1/recipe-lock.json"),
      "utf8"
    )
  ) as { sha256: string };
  const manifest = {
    ...base.manifest,
    version: "anime-rules-v1",
    identityPolicy:
      "anime-fighter-v1: curator-reviewed identity, current Base traits and SHA-256-verified manifests and sprites; approval follows the token",
    supportedNftCollections: {
      8453: base.manifest.supportedNftCollections[8453]!
    },
    eligibilityRegistry: registry,
    economics: {
      entryMicrousd: 1000000,
      winnerMicrousd: 3200000,
      islandMicrousd: 200000,
      operationsMicrousd: 600000
    },
    media: {
      policy: "anime-engine/v1",
      engineVersion: engine.version,
      engineSha256: engine.sha256,
      recipeId: "anime-fighter-v1",
      recipeSha256: recipe.sha256,
      director: {
        policy: ANIME_DIRECTOR_POLICY,
        provider: "openrouter",
        model: ANIME_DIRECTOR_MODEL,
        reserveMicrousd: ANIME_DIRECTOR_RESERVE
      }
    },
    policies: {
      ...base.manifest.policies,
      approval:
        "art and approval follow the token on transfer; public rejection notes; Base OG only"
    }
  };
  return {
    ...base,
    manifest,
    rulesHash: `0x${sha256(canonicalJson(manifest))}` as Hex
  };
}
