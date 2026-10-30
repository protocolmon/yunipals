import { z } from "zod";
import {
  encodeDeployData,
  getContractAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { animeArenaAbi } from "@protopals/yunipals-market-core/animeArenaAbi";
import { animeRegistryAbi } from "@protopals/yunipals-market-core/animeRegistryAbi";
import {
  canonicalAnimeJson,
  ANIME_ASSETS_ORIGIN
} from "@protopals/yunipals-market-core/anime";

export const animeDeploymentPackagePath = "/arena/anime-deployment-v1.json";
export const animeDeploymentPackageSha256 =
  "550fd2e6dfc454a533f9cbb5e78d4fd6e298159d6314ab473e975a8b40d87d85";
export const animeLaunchSteps = ["registry", "arena"] as const;
export type AnimeLaunchStep = (typeof animeLaunchSteps)[number];
export type AnimeLaunchReceipts = Partial<Record<AnimeLaunchStep, Hex>>;
const hex = z
  .string()
  .regex(/^0x(?:[a-f0-9]{2})+$/i)
  .transform((v) => v as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .refine((v) => !/^0x0{40}$/i.test(v))
  .transform((v) => v as Address);
const code = z
  .object({
    creation: hex,
    runtime: hex,
    immutableRanges: z.array(
      z
        .object({
          start: z.number().int().nonnegative(),
          length: z.number().int().positive()
        })
        .strict()
    )
  })
  .strict();
const schema = z
  .object({
    version: z.literal("anime-browser-deployment/v1"),
    chainId: z.literal(8453),
    roles: z
      .object({
        admissionSigner: address,
        referee: address,
        lobbyOperator: address
      })
      .strict(),
    maxVrfCostWei: z.literal("10000000000000"),
    registry: code,
    arena: code,
    rulesTemplate: z.record(z.unknown())
  })
  .strict();
export type AnimeDeploymentPackage = z.infer<typeof schema>;
export async function animeSha256(bytes: Uint8Array) {
  const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(result), (v) =>
    v.toString(16).padStart(2, "0")
  ).join("");
}
export async function readAnimeDeploymentPackage(signal?: AbortSignal) {
  const response = await fetch(animeDeploymentPackagePath, {
    signal,
    cache: "no-cache"
  });
  if (!response.ok)
    throw Error("The reviewed deployment package could not be loaded.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length > 300000 ||
    (await animeSha256(bytes)) !== animeDeploymentPackageSha256
  )
    throw Error("The deployment package differs from the reviewed release.");
  return schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}
export async function animeLaunchAction(
  bundle: AnimeDeploymentPackage,
  step: AnimeLaunchStep,
  owner: Address,
  registry?: Address
) {
  if (step === "registry")
    return {
      data: encodeDeployData({
        abi: animeRegistryAbi,
        bytecode: bundle.registry.creation,
        args: [owner, owner, `${ANIME_ASSETS_ORIGIN}/fighters/v1/`]
      }),
      rulesHash: null
    };
  if (!registry) throw Error("Verify the fighter registry deployment first.");
  const manifest = {
    ...bundle.rulesTemplate,
    eligibilityRegistry: registry.toLowerCase()
  };
  const rulesHash =
    `0x${await animeSha256(new TextEncoder().encode(canonicalAnimeJson(manifest)))}` as Hex;
  const config = {
    admin: owner,
    treasury: owner,
    ...bundle.roles,
    islands: "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168" as Address,
    vrfWrapper: "0xb0407dbe851f8318bd31404a49e658143c982f23" as Address,
    eligibility: registry,
    paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    entryFee: 1000000n,
    winnerBps: 8000,
    islandBps: 500,
    joinWindow: 604800,
    strategyWindow: 86400,
    resolutionWindow: 86400,
    maxVrfCost: BigInt(bundle.maxVrfCostWei),
    rulesHash
  };
  return {
    data: encodeDeployData({
      abi: animeArenaAbi,
      bytecode: bundle.arena.creation,
      args: [config]
    }),
    rulesHash
  };
}
function maskedRuntime(
  runtime: Hex,
  ranges: AnimeDeploymentPackage["arena"]["immutableRanges"]
) {
  const chars = runtime.slice(2).split("");
  const used = new Set<number>();
  for (const { start, length } of ranges) {
    if (start + length > chars.length / 2)
      throw Error("Invalid runtime comparison range.");
    for (let i = start * 2; i < (start + length) * 2; i++) {
      if (used.has(i)) throw Error("Overlapping runtime comparison ranges.");
      used.add(i);
      chars[i] = "0";
    }
  }
  return `0x${chars.join("")}` as Hex;
}
export async function readAnimeLaunch(
  client: PublicClient,
  bundle: AnimeDeploymentPackage,
  owner: Address,
  hashes: AnimeLaunchReceipts
) {
  const verified: Partial<
    Record<
      AnimeLaunchStep,
      {
        address: Address;
        transactionHash: Hex;
        blockNumber: string;
        blockHash: Hex;
      }
    >
  > = {};
  if ((await client.getChainId()) !== 8453) throw Error("Use Base mainnet.");
  for (const step of animeLaunchSteps) {
    const hash = hashes[step];
    if (!hash) return { verified, next: step, pending: null, failed: null };
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "TransactionReceiptNotFoundError"
      )
        return { verified, next: null, pending: step, failed: null };
      throw error;
    }
    if (receipt.status !== "success")
      return { verified, next: null, pending: null, failed: step };
    const transaction = await client.getTransaction({ hash });
    const expected = await animeLaunchAction(
      bundle,
      step,
      owner,
      verified.registry?.address
    );
    if (
      receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      transaction.from.toLowerCase() !== owner.toLowerCase() ||
      transaction.to !== null ||
      transaction.value !== 0n ||
      transaction.input.toLowerCase() !== expected.data.toLowerCase() ||
      !receipt.contractAddress ||
      getContractAddress({
        from: owner,
        nonce: BigInt(transaction.nonce)
      }).toLowerCase() !== receipt.contractAddress.toLowerCase()
    )
      throw Error(
        `The ${step} transaction differs from this wallet's reviewed deployment.`
      );
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash)
      throw Error("The deployment receipt is no longer canonical.");
    const deployed = await client.getCode({
      address: receipt.contractAddress,
      blockNumber: receipt.blockNumber
    });
    if (
      !deployed ||
      keccak256(maskedRuntime(deployed, bundle[step].immutableRanges)) !==
        keccak256(
          maskedRuntime(bundle[step].runtime, bundle[step].immutableRanges)
        )
    )
      throw Error("Deployed code differs from the reviewed contract.");
    // Read initial state at the deployment block, so later pilot activation remains valid.
    if (step === "registry") {
      const open = await client.readContract({
        address: receipt.contractAddress,
        abi: animeRegistryAbi,
        functionName: "applicationsOpen",
        blockNumber: receipt.blockNumber
      });
      if (open) throw Error("The new registry must start closed.");
    } else {
      const paused = await client.readContract({
        address: receipt.contractAddress,
        abi: animeArenaAbi,
        functionName: "entriesPaused",
        blockNumber: receipt.blockNumber
      });
      if (!paused) throw Error("The new arena must start paused.");
    }
    verified[step] = {
      address: receipt.contractAddress,
      transactionHash: hash,
      blockNumber: receipt.blockNumber.toString(),
      blockHash: receipt.blockHash
    };
  }
  return { verified, next: null, pending: null, failed: null };
}
export type AnimeLaunchState = Awaited<ReturnType<typeof readAnimeLaunch>>;
