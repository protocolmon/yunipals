import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
export {
  manifestDigest,
  sourceManifestHash
} from "../../../../packages/yunipals-indexer-server/src/identity.js";
import type { Abi, Address } from "viem";
import {
  validateSourceManifest,
  type ConfirmationPolicy,
  type SourceDefinition,
  type SourceFeature,
  type SourceManifest
} from "../../../../packages/yunipals-indexer-client/src/sources.js";
import { arenaAbi } from "../../../../packages/yunipals-market-core/src/arenaAbi.js";
import { arenaV2Abi } from "../../../../packages/yunipals-market-core/src/arenaV2Abi.js";
import { seaportDeployment } from "../../../../packages/yunipals-market-core/src/registry.js";
import { seaportEventAbi } from "../../../../packages/yunipals-market-core/src/seaportEvents.js";
import { collectionAbi, islandsAbi, baseIslandsAbi } from "../abi.js";
import { boosterContracts } from "../boosters/config.js";
import {
  collections,
  islandCollection,
  baseIslandCollection,
  baseIslandLegacyOwnershipPolicy
} from "../constants.js";
import { baseMetadataAbi } from "../metadata/base-abi.js";

import { animeRegistryAbi } from "../../../../packages/yunipals-market-core/src/animeRegistryAbi.js";

type Environment = Record<string, string | undefined>;

export type ArenaSourceDeployment = {
  address: Address;
  startBlock: number;
};

export function sharedArenaSource(env: Environment = process.env) {
  const address = env.UNIFIED_SHARED_ARENA?.toLowerCase();
  const start = env.UNIFIED_SHARED_ARENA_START_BLOCK;
  if (address === undefined && start === undefined) return null;
  if (
    !address ||
    !/^0x[0-9a-f]{40}$/.test(address) ||
    /^0x0{40}$/.test(address) ||
    !start ||
    !/^[1-9][0-9]*$/.test(start) ||
    !Number.isSafeInteger(Number(start)) ||
    arenaSourceDeployments(env).some(
      (deployment) => deployment.address === address
    )
  )
    throw new Error("Invalid or duplicate shared Arena source.");
  return { address: address as Address, startBlock: Number(start) };
}

// Read-only configuration. Never import Arena's encryption/signing runtime.
export function arenaSourceDeployments(
  env: Environment = process.env
): ArenaSourceDeployment[] {
  if (
    env.UNIFIED_ARENA_DEPLOYMENTS &&
    (env.ARENA_CONTRACT || env.ARENA_DEPLOYMENT_BLOCK)
  ) {
    throw new Error("Use one Arena source configuration format.");
  }
  let input: unknown = [];
  if (env.UNIFIED_ARENA_DEPLOYMENTS !== undefined) {
    try {
      input = JSON.parse(env.UNIFIED_ARENA_DEPLOYMENTS);
    } catch {
      throw new Error("Invalid UNIFIED_ARENA_DEPLOYMENTS JSON.");
    }
  } else if (env.ARENA_CONTRACT || env.ARENA_DEPLOYMENT_BLOCK) {
    input = [
      { address: env.ARENA_CONTRACT, startBlock: env.ARENA_DEPLOYMENT_BLOCK }
    ];
  }
  if (!Array.isArray(input))
    throw new Error("Arena source configuration must be an array.");
  const seen = new Set<string>();
  return input
    .map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("Invalid Arena source.");
      const value = row as Record<string, unknown>;
      if (
        Object.keys(value).some(
          (key) => !["address", "startBlock"].includes(key)
        )
      ) {
        throw new Error("Unknown Arena source configuration field.");
      }
      const address =
        typeof value.address === "string" ? value.address.toLowerCase() : "";
      const start = String(value.startBlock);
      if (
        !/^0x[0-9a-f]{40}$/.test(address) ||
        /^0x0{40}$/.test(address) ||
        !/^[1-9][0-9]*$/.test(start) ||
        !Number.isSafeInteger(Number(start)) ||
        seen.has(address)
      ) {
        throw new Error("Invalid or duplicate Arena source deployment.");
      }
      seen.add(address);
      return { address: address as Address, startBlock: Number(start) };
    })
    .sort((a, b) => a.address.localeCompare(b.address));
}

export function animeRegistrySource(env: Environment = process.env) {
  const address = env.UNIFIED_ANIME_REGISTRY?.toLowerCase();
  const start = env.UNIFIED_ANIME_REGISTRY_START_BLOCK;
  if (address === undefined && start === undefined) return null;
  if (
    !address ||
    !/^0x[0-9a-f]{40}$/.test(address) ||
    /^0x0{40}$/.test(address) ||
    !start ||
    !/^[1-9][0-9]*$/.test(start) ||
    !Number.isSafeInteger(Number(start))
  )
    throw new Error("Invalid anime registry source.");
  return { address: address as Address, startBlock: Number(start) };
}

/** Keep the new arena's log filters independent so Ponder reuses the existing
 * video history and never scans the anime address before its deployment. */
export function arenaContractSources(env: Environment = process.env) {
  const deployments = arenaSourceDeployments(env);
  const address = env.UNIFIED_ANIME_ARENA?.toLowerCase();
  if (address === undefined) return { video: deployments, anime: null };
  const anime = deployments.find(
    (deployment) => deployment.address === address
  );
  if (!anime || !animeRegistrySource(env))
    throw new Error(
      "Anime Arena must be a reviewed deployment with its registry."
    );
  return {
    video: deployments.filter((deployment) => deployment !== anime),
    anime
  };
}

function source(
  id: string,
  feature: SourceFeature,
  chainId: number,
  contractName: string,
  abi: Abi,
  address: string | null,
  startBlock: number | null,
  policies: readonly ConfirmationPolicy[],
  receiptRequirement: "none" | "full" = "none"
): SourceDefinition {
  return {
    id,
    feature,
    chainId,
    contractName,
    address: address?.toLowerCase() ?? null,
    startBlock: startBlock === null ? null : String(startBlock),
    endBlock: null,
    enabled: address !== null && startBlock !== null,
    abiHash: manifestDigest(abi),
    events: abi
      .filter((item) => item.type === "event")
      .map((event) => event.name)
      .sort(),
    receiptRequirement,
    policies
  };
}

export function buildSourceManifest(
  env: Environment = process.env
): SourceManifest {
  const policies = [{ kind: "latest" }, { kind: "finalized" }] as const;
  const baseIslandsEnabled = env.UNIFIED_BASE_ISLANDS_V2_ENABLED ?? "false";
  if (!["true", "false"].includes(baseIslandsEnabled))
    throw new Error("Invalid UNIFIED_BASE_ISLANDS_V2_ENABLED.");
  const sources: SourceDefinition[] = Object.entries(collections).map(
    ([chain, collection]) =>
      source(
        `ownership:${chain}`,
        "ownership",
        collection.chainId,
        `Yunipals${chain === "bnb" ? "Bnb" : chain[0]!.toUpperCase() + chain.slice(1)}`,
        collectionAbi,
        collection.address,
        collection.deploymentBlock,
        chain === "bnb"
          ? [
              ...policies,
              {
                kind: "depth",
                subsequentBlocks: Number(env.BNB_CONFIRMATIONS ?? 20)
              }
            ]
          : policies,
        "full"
      )
  );
  sources.push(
    source(
      "islands:ethereum",
      "islands",
      1,
      "YunipalsIslands",
      islandsAbi,
      islandCollection.address,
      islandCollection.deploymentBlock,
      policies
    )
  );
  sources.push(
    source(
      "islands:base:v2",
      "islands",
      8453,
      "YunipalsBaseIslandsV2",
      baseIslandsAbi,
      baseIslandsEnabled === "true" ? baseIslandCollection.address : null,
      baseIslandsEnabled === "true"
        ? baseIslandCollection.deploymentBlock
        : null,
      [...policies, baseIslandLegacyOwnershipPolicy]
    ),
    source(
      "metadata:base",
      "base-metadata",
      8453,
      "YunipalsBaseMetadata",
      baseMetadataAbi,
      collections.base.address,
      collections.base.deploymentBlock,
      policies
    )
  );
  for (const [name, contract] of Object.entries(boosterContracts(env))) {
    sources.push(
      source(
        `boosters:${name.toLowerCase()}`,
        "boosters",
        8453,
        name,
        contract.abi,
        typeof contract.address === "string" ? contract.address : null,
        typeof contract.address === "string" ? contract.startBlock : null,
        policies
      )
    );
  }
  const arenas = arenaSourceDeployments(env);
  const arenaPolicies = [
    { kind: "latest" },
    { kind: "depth", subsequentBlocks: 5 }
  ] as const;
  for (const deployment of arenas) {
    sources.push(
      source(
        `arena:8453:${deployment.address}`,
        "arena",
        8453,
        "YunipalsArena",
        arenaAbi,
        deployment.address,
        deployment.startBlock,
        arenaPolicies
      )
    );
  }
  if (!arenas.length)
    sources.push(
      source(
        "arena:base:unconfigured",
        "arena",
        8453,
        "YunipalsArena",
        arenaAbi,
        null,
        null,
        arenaPolicies
      )
    );
  const registry = animeRegistrySource(env);
  const shared = sharedArenaSource(env);
  if (shared)
    sources.push(
      source(
        `arena:8453:${shared.address}`,
        "arena",
        8453,
        "YunipalsArenaV2",
        arenaV2Abi,
        shared.address,
        shared.startBlock,
        arenaPolicies
      )
    );
  if (registry)
    sources.push(
      source(
        "anime-registry:8453",
        "anime-registry",
        8453,
        "AnimeFighterRegistry",
        animeRegistryAbi,
        registry.address,
        registry.startBlock,
        arenaPolicies
      )
    );
  const discovery = env.MARKET_BNB_DISCOVERY_START_BLOCK;
  if (
    discovery !== undefined &&
    (!/^[1-9][0-9]*$/.test(discovery) ||
      !Number.isSafeInteger(Number(discovery)))
  ) {
    throw new Error("Invalid MARKET_BNB_DISCOVERY_START_BLOCK.");
  }
  sources.push(
    source(
      "marketplace:bnb:seaport",
      "marketplace",
      56,
      "BnbSeaport",
      seaportEventAbi,
      discovery === undefined ? null : seaportDeployment.address,
      discovery === undefined ? null : Number(discovery),
      policies,
      "full"
    )
  );
  if (env.UNIFIED_RECEIPT_HISTORY_JSON !== undefined) {
    let input: unknown;
    try {
      input = JSON.parse(env.UNIFIED_RECEIPT_HISTORY_JSON);
    } catch {
      throw new Error("Invalid UNIFIED_RECEIPT_HISTORY_JSON.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Receipt history configuration must be an object.");
    for (const [sourceId, floor] of Object.entries(input)) {
      const definition = sources.find((row) => row.id === sourceId);
      if (
        !definition?.enabled ||
        definition.receiptRequirement !== "full" ||
        definition.startBlock === null ||
        typeof floor !== "number" ||
        !Number.isSafeInteger(floor) ||
        floor < 0 ||
        BigInt(floor) < BigInt(definition.startBlock)
      )
        throw new Error(`Invalid receipt history floor: ${sourceId}.`);
      definition.receiptStartBlock = String(floor);
    }
  }
  const manifest: SourceManifest = {
    version: 1,
    ponderVersion: "0.17.5",
    ordering: "multichain",
    coverage: "ponder-live-blocks-v1",
    sources: sources.sort((a, b) => a.id.localeCompare(b.id))
  };
  validateSourceManifest(manifest);
  return manifest;
}
