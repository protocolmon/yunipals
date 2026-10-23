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
  const expected = {
    BOOSTER_REGISTRY: "0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3",
    BOOSTER_ENGINE: "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e",
    BOOSTER_MONSTERS: "0x7d62628806e7eef76a354c7c48787879e3440b16",
    BOOSTER_WRAPPER: "0xb0407dbe851f8318bd31404a49e658143c982f23"
  };
  for (const [key, address] of Object.entries(expected))
    if (env[key]?.toLowerCase() !== address)
      throw new Error("The combined source requires the confirmed fresh YPAL stack.");
  if (startBlock !== 52995007)
    throw new Error("The combined source requires the actual first YPAL proxy block.");
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
  // An empty address list subscribes to no logs; never use undefined (all addresses).
  return {
    BoosterRegistry: {
      chain: "base" as const,
      abi: packRegistryAbi,
      address: deployment ? deployment.registry : ([] as Address[]),
      startBlock: deployment ? 52995007 : 0
    },
    BoosterEngine: {
      chain: "base" as const,
      abi: boosterPacksAbi,
      address: deployment ? deployment.engine : ([] as Address[]),
      startBlock: deployment ? 52995174 : 0
    },
    BoosterMonsters: {
      chain: "base" as const,
      abi: yunipalMonstersAbi,
      address: deployment ? deployment.monsters : ([] as Address[]),
      startBlock: deployment ? 52995029 : 0
    }
  };
}
