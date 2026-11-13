import {
  portalCollectionAbi,
  portalRegistryAbi,
  portalGradingAbi,
  portalCompetitionAbi
} from "../../../../packages/yunipals-market-core/src/portalAbi.js";
import type { Address } from "viem";
import {
  portalEventAbis,
  type PortalEventSource
} from "../../../../packages/yunipals-market-core/src/portalIndex.js";
import type { SourceDefinition } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";

export const portalContracts = {
  collection: "PortalCollection",
  registry: "PortalRegistry",
  grading: "PortalGrading",
  competition: "PortalCompetition"
} as const;

/** Public deployment configuration only. Never load the signing/AI environment. */
export function portalSources(
  env: Record<string, string | undefined> = process.env
): SourceDefinition[] {
  if (env.UNIFIED_PORTALS_JSON === undefined) return [];
  let input: unknown;
  try {
    input = JSON.parse(env.UNIFIED_PORTALS_JSON);
  } catch {
    throw new Error("Invalid UNIFIED_PORTALS_JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Portal sources must be an object.");
  const config = input as Record<string, unknown>;
  if (
    Object.keys(config).sort().join() !==
    Object.keys(portalContracts).sort().join()
  )
    throw new Error("Configure all four portal sources.");
  const seen = new Set<string>();
  return (Object.keys(portalContracts) as PortalEventSource[]).map((kind) => {
    const row = config[kind];
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("Invalid portal source.");
    const value = row as Record<string, unknown>;
    const address =
      typeof value.address === "string" ? value.address.toLowerCase() : "";
    if (
      Object.keys(value).sort().join() !== "address,startBlock" ||
      !/^0x[0-9a-f]{40}$/.test(address) ||
      /^0x0{40}$/.test(address) ||
      seen.has(address) ||
      !Number.isSafeInteger(value.startBlock) ||
      Number(value.startBlock) < 1
    )
      throw new Error("Invalid or duplicate portal source.");
    seen.add(address);
    return {
      id: `portals:8453:${kind}`,
      feature: "portals",
      chainId: 8453,
      contractName: portalContracts[kind],
      enabled: true,
      address,
      startBlock: String(value.startBlock),
      endBlock: null,
      abiHash: manifestDigest(portalEventAbis[kind]),
      events: portalEventAbis[kind].map((event) => event.name).sort(),
      receiptRequirement: "full",
      policies: [
        { kind: "latest" },
        { kind: "depth", subsequentBlocks: 12 },
        { kind: "finalized" }
      ]
    };
  });
}

export function portalPonderContracts(
  env: Record<string, string | undefined> = process.env
) {
  const sources = portalSources(env);
  const contract = (kind: PortalEventSource) => {
    const source = sources.find(
      (item) => item.contractName === portalContracts[kind]
    );
    return {
      chain: "base" as const,
      abi: portalEventAbis[kind],
      address: source ? (source.address as Address) : ([] as Address[]),
      startBlock: source ? Number(source.startBlock) : 0
    };
  };
  return {
    PortalCollection: { ...contract("collection"), abi: portalCollectionAbi },
    PortalRegistry: { ...contract("registry"), abi: portalRegistryAbi },
    PortalGrading: { ...contract("grading"), abi: portalGradingAbi },
    PortalCompetition: { ...contract("competition"), abi: portalCompetitionAbi }
  };
}
