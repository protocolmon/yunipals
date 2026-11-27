import { adventureSourceAbiCrew } from "../../../../packages/yunipals-market-core/src/adventureSourceAbi.crew.js";
import type { AbiEvent, Address } from "viem";
import { evolutionCardsAbi } from "../../../../packages/yunipals-market-core/src/evolutionAbi.js";
import { evolutionSourceAbiV1 } from "../../../../packages/yunipals-market-core/src/evolutionSourceAbi.v1.js";
import type { SourceDefinition } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";

// Collection transfers retain their existing BoosterMonsters source. Only new events subscribe here.
export const evolutionEventAbis = {
  adventures: adventureSourceAbiCrew.filter(
    (v): v is Extract<(typeof adventureSourceAbiCrew)[number], AbiEvent> =>
      v.type === "event"
  ),
  evolution: evolutionSourceAbiV1.filter(
    (v): v is Extract<(typeof evolutionSourceAbiV1)[number], AbiEvent> =>
      v.type === "event"
  ),
  cards: evolutionCardsAbi.filter(
    (
      v
    ): v is Extract<
      (typeof evolutionCardsAbi)[number],
      {
        type: "event";
        name:
          | "FusionMinted"
          | "CardReserved"
          | "CardReleased"
          | "EvolutionConfigured";
      }
    > =>
      v.type === "event" &&
      [
        "FusionMinted",
        "CardReserved",
        "CardReleased",
        "EvolutionConfigured"
      ].includes(v.name)
  )
};
export const evolutionContracts = {
  adventures: "YunipalAdventures",
  evolution: "YunipalEvolution",
  cards: "EvolutionCollection"
} as const;
export type EvolutionEventSource = keyof typeof evolutionContracts;
export function evolutionSources(
  env: Record<string, string | undefined> = process.env
): SourceDefinition[] {
  if (env.UNIFIED_EVOLUTION_JSON === undefined) return [];
  const raw: unknown = JSON.parse(env.UNIFIED_EVOLUTION_JSON);
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).sort().join() !== "adventures,cards,evolution"
  )
    throw new Error("Configure all three evolution sources.");
  const config = raw as Record<string, unknown>;
  const addresses = new Set<string>();
  return (Object.keys(evolutionContracts) as EvolutionEventSource[]).map(
    (kind) => {
      const entry = config[kind];
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw new Error("Invalid evolution source.");
      const row = entry as Record<string, unknown>;
      const address =
        typeof row.address === "string" ? row.address.toLowerCase() : "";
      if (
        Object.keys(row).sort().join() !== "address,startBlock" ||
        !/^0x[0-9a-f]{40}$/.test(address) ||
        /^0x0{40}$/.test(address) ||
        addresses.has(address) ||
        !Number.isSafeInteger(row.startBlock) ||
        Number(row.startBlock) < 1
      )
        throw new Error("Invalid evolution source bounds or address.");
      addresses.add(address);
      return {
        id: `evolution:8453:${kind}`,
        feature: "evolution",
        chainId: 8453,
        contractName: evolutionContracts[kind],
        enabled: true,
        address,
        startBlock: String(row.startBlock),
        endBlock: null,
        abiHash: manifestDigest(evolutionEventAbis[kind]),
        events: evolutionEventAbis[kind].map((v) => v.name).sort(),
        receiptRequirement: "full",
        policies: [
          { kind: "latest" },
          { kind: "depth", subsequentBlocks: 12 },
          { kind: "finalized" }
        ]
      };
    }
  );
}
export function evolutionPonderContracts(
  env: Record<string, string | undefined> = process.env
) {
  const sources = evolutionSources(env);
  const config = (kind: EvolutionEventSource) => {
    const source = sources.find(
      (v) => v.contractName === evolutionContracts[kind]
    );
    return {
      chain: "base" as const,
      address: source ? (source.address as Address) : ([] as Address[]),
      startBlock: Number(source?.startBlock ?? 0)
    };
  };
  return {
    YunipalAdventures: { ...config("adventures"), abi: adventureSourceAbiCrew },
    YunipalEvolution: { ...config("evolution"), abi: evolutionSourceAbiV1 },
    EvolutionCollection: { ...config("cards"), abi: evolutionEventAbis.cards }
  };
}
