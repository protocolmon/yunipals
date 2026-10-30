import { isAddress, zeroAddress, type Address } from "viem";
import {
  boosterPacksAbi,
  packRegistryAbi,
  yunipalMonstersAbi
} from "../../../../packages/yunipals-market-core/src/boosterAbi.js";

export type BoosterDeployment = {
  registry: Address;
  engine: Address;
  monsters: Address;
  wrapper: Address;
  startBlock: number;
};

export function boosterDeployment(
  env: Record<string, string | undefined> = process.env
): BoosterDeployment | null {
  const names = [
    "BOOSTER_REGISTRY",
    "BOOSTER_ENGINE",
    "BOOSTER_MONSTERS",
    "BOOSTER_WRAPPER"
  ] as const;
  if (!names.some((name) => env[name])) return null;
  for (const name of names) {
    if (!isAddress(env[name] ?? "") || env[name]?.toLowerCase() === zeroAddress)
      throw new Error(`${name} must be a nonzero deployed contract address`);
  }
  const startBlock = Number(env.BOOSTER_DEPLOYMENT_BLOCK);
  if (!Number.isSafeInteger(startBlock) || startBlock <= 0)
    throw new Error(
      "BOOSTER_DEPLOYMENT_BLOCK must be the exact positive deployment block"
    );
  return {
    registry: env.BOOSTER_REGISTRY!.toLowerCase() as Address,
    engine: env.BOOSTER_ENGINE!.toLowerCase() as Address,
    monsters: env.BOOSTER_MONSTERS!.toLowerCase() as Address,
    wrapper: env.BOOSTER_WRAPPER!.toLowerCase() as Address,
    startBlock
  };
}

export function boosterContracts(
  env: Record<string, string | undefined> = process.env
) {
  const deployment = boosterDeployment(env);
  const contractStart = (name: "REGISTRY" | "ENGINE" | "MONSTERS") => {
    const configured = env[`BOOSTER_${name}_DEPLOYMENT_BLOCK`];
    if (configured === undefined) return deployment?.startBlock ?? 0;
    if (
      !deployment ||
      !/^[1-9][0-9]*$/.test(configured) ||
      !Number.isSafeInteger(Number(configured))
    )
      throw new Error(`Invalid BOOSTER_${name}_DEPLOYMENT_BLOCK`);
    return Number(configured);
  };
  // An empty address list subscribes to no logs; never use undefined (all addresses).
  return {
    BoosterRegistry: {
      chain: "base" as const,
      abi: packRegistryAbi,
      address: deployment ? deployment.registry : ([] as Address[]),
      startBlock: contractStart("REGISTRY")
    },
    BoosterEngine: {
      chain: "base" as const,
      abi: boosterPacksAbi,
      address: deployment ? deployment.engine : ([] as Address[]),
      startBlock: contractStart("ENGINE")
    },
    BoosterMonsters: {
      chain: "base" as const,
      abi: yunipalMonstersAbi,
      address: deployment ? deployment.monsters : ([] as Address[]),
      startBlock: contractStart("MONSTERS")
    }
  };
}
