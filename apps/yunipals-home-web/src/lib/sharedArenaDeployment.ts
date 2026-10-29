import { z } from "zod";
import {
  encodeDeployData,
  getContractAddress,
  type Hex,
  type PublicClient
} from "viem";
import { arenaV2Abi } from "@protopals/yunipals-market-core/arenaV2Abi";
import { canonicalAnimeJson } from "@protopals/yunipals-market-core/anime";
import { animeSha256 } from "./animeDeployment";

export const sharedArenaDeploymentPath =
  "/arena/shared-arena-deployment-v2.json";
export const sharedArenaDeploymentSha256 =
  "3234c6116adecd55b5db04c754c12cd0c72c0406bbeec092e07dcb9fe61053bd";
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .refine((v) => !/^0x0{40}$/i.test(v))
  .transform((v) => v as `0x${string}`);
const hex = z
  .string()
  .regex(/^0x(?:[0-9a-f]{2})+$/i)
  .transform((v) => v as Hex);
const hash = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((v) => v as Hex);
const schema = z
  .object({
    version: z.literal("arena-modes-browser-deployment/v2"),
    chainId: z.literal(8453),
    admin: address,
    registry: address,
    roles: z
      .object({
        admissionSigner: address,
        referee: address,
        lobbyOperator: address
      })
      .strict(),
    rules: z
      .object({ video: z.record(z.unknown()), anime: z.record(z.unknown()) })
      .strict(),
    rulesHashes: z.object({ video: hash, anime: hash }).strict(),
    arena: z
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
      .strict()
  })
  .strict();
export type SharedArenaDeploymentPackage = z.infer<typeof schema>;

export async function readSharedArenaDeploymentPackage(signal?: AbortSignal) {
  const response = await fetch(sharedArenaDeploymentPath, {
    signal,
    cache: "no-cache"
  });
  if (!response.ok)
    throw new Error(
      "The reviewed shared Arena deployment could not be loaded."
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length > 300000 ||
    (await animeSha256(bytes)) !== sharedArenaDeploymentSha256
  )
    throw new Error(
      "The shared Arena package differs from the reviewed build."
    );
  const bundle = schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  for (const kind of ["video", "anime"] as const)
    if (
      `0x${await animeSha256(new TextEncoder().encode(canonicalAnimeJson(bundle.rules[kind])))}` !==
      bundle.rulesHashes[kind]
    )
      throw new Error(
        "The shared Arena rules do not match the reviewed hashes."
      );
  return bundle;
}

export function sharedArenaCreation(bundle: SharedArenaDeploymentPackage) {
  return encodeDeployData({
    abi: arenaV2Abi,
    bytecode: bundle.arena.creation,
    args: [
      {
        admin: bundle.admin,
        treasury: bundle.admin,
        ...bundle.roles,
        islands: "0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168",
        vrfWrapper: "0xb0407dbe851f8318bd31404a49e658143c982f23",
        paymentToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        animeRegistry: bundle.registry,
        videoRulesHash: bundle.rulesHashes.video,
        animeRulesHash: bundle.rulesHashes.anime,
        joinWindow: 604800,
        strategyWindow: 86400,
        resolutionWindow: 86400
      }
    ]
  });
}

function maskedRuntime(
  code: Hex,
  ranges: SharedArenaDeploymentPackage["arena"]["immutableRanges"]
) {
  const chars = code.slice(2).toLowerCase().split("");
  const used = new Set<number>();
  for (const { start, length } of ranges) {
    if (start + length > chars.length / 2)
      throw new Error("Invalid reviewed runtime ranges.");
    for (let i = start * 2; i < (start + length) * 2; i++) {
      if (used.has(i)) throw new Error("Overlapping reviewed runtime ranges.");
      used.add(i);
      chars[i] = "0";
    }
  }
  return chars.join("");
}

export async function readSharedArenaDeployment(
  client: PublicClient,
  bundle: SharedArenaDeploymentPackage,
  hash: Hex
) {
  if ((await client.getChainId()) !== 8453)
    throw new Error("Select Base before reviewing this deployment.");
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("This transaction did not deploy an Arena.");
  const [transaction, block, latest] = await Promise.all([
    client.getTransaction({ hash }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.getBlockNumber({ cacheTime: 0 })
  ]);
  if (block.hash !== receipt.blockHash || latest < receipt.blockNumber + 1n)
    throw new Error(
      "Wait for two confirmations before copying the deployment."
    );
  const expectedAddress = getContractAddress({
    from: bundle.admin,
    nonce: BigInt(transaction.nonce)
  });
  if (
    transaction.from.toLowerCase() !== bundle.admin.toLowerCase() ||
    transaction.to !== null ||
    transaction.value !== 0n ||
    transaction.input.toLowerCase() !==
      sharedArenaCreation(bundle).toLowerCase() ||
    receipt.contractAddress.toLowerCase() !== expectedAddress.toLowerCase()
  )
    throw new Error(
      "The transaction does not match the reviewed shared Arena deployment."
    );
  const address = receipt.contractAddress;
  const runtime = await client.getCode({
    address,
    blockNumber: receipt.blockNumber
  });
  if (
    !runtime ||
    maskedRuntime(runtime, bundle.arena.immutableRanges) !==
      maskedRuntime(bundle.arena.runtime, bundle.arena.immutableRanges)
  )
    throw new Error("The deployed Arena code differs from the reviewed build.");
  const at = { address, abi: arenaV2Abi, blockNumber: receipt.blockNumber };
  const [owner, operator, admission, referee] = await Promise.all([
    client.readContract({ ...at, functionName: "owner" }),
    client.readContract({ ...at, functionName: "lobbyOperator" }),
    client.readContract({ ...at, functionName: "admissionSigner" }),
    client.readContract({ ...at, functionName: "referee" })
  ]);
  if (
    [owner, operator, admission, referee].map((v) => v.toLowerCase()).join() !==
    [
      bundle.admin,
      bundle.roles.lobbyOperator,
      bundle.roles.admissionSigner,
      bundle.roles.referee
    ]
      .map((v) => v.toLowerCase())
      .join()
  )
    throw new Error(
      "The deployed Arena roles differ from the reviewed settings."
    );
  for (const mode of [0, 1] as const) {
    const [config, paused, next] = await Promise.all([
      client.readContract({ ...at, functionName: "modeConfig", args: [mode] }),
      client.readContract({
        ...at,
        functionName: "entriesPaused",
        args: [BigInt(mode)]
      }),
      client.readContract({
        ...at,
        functionName: "nextTournamentId",
        args: [BigInt(mode)]
      })
    ]);
    if (
      !paused ||
      next !== BigInt(mode + 1) ||
      config.entryFee !== (mode === 0 ? 2000000n : 1000000n) ||
      config.winnerBps !== (mode === 0 ? 7500 : 8000) ||
      config.islandBps !== 500 ||
      config.rulesHash !== bundle.rulesHashes[mode === 0 ? "video" : "anime"] ||
      config.eligibility.toLowerCase() !==
        (mode === 0
          ? "0x0000000000000000000000000000000000000000"
          : bundle.registry.toLowerCase())
    )
      throw new Error(
        "The deployed modes do not match their reviewed settings or initial paused state."
      );
  }
  return {
    version: "arena-modes-browser/confirmed-v2",
    chainId: 8453,
    admin: bundle.admin,
    registry: bundle.registry,
    packageSha256: sharedArenaDeploymentSha256,
    rulesHashes: bundle.rulesHashes,
    arena: {
      address,
      transactionHash: hash,
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash
    }
  } as const;
}
