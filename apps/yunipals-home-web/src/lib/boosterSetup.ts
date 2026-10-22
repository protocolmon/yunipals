import { z } from "zod";
import {
  encodeFunctionData,
  isAddress,
  type Address,
  type ContractFunctionReturnType,
  type Hex
} from "viem";
import { packRegistryAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { validateBoosterCatalog } from "@protopals/yunipals-market-core/boosterCatalog";

export const boosterSetupOwner =
  "0xB3883Cd96d72B08b8226452305A28D65974a3727" as const;
export type BoosterSetupKind = "smoke" | "standard";
export const boosterSetupProfiles = {
  smoke: {
    slug: "base-mainnet-smoke-v1",
    filename: "/boosters/mainnet-smoke-setup.json",
    expectedTypeCount: "0",
    supplyCap: "1"
  },
  standard: {
    slug: "base-mainnet-standard-v1",
    filename: "/boosters/mainnet-standard-setup.json",
    expectedTypeCount: "1",
    supplyCap: null
  }
} as const;
const proto = "0xe5a54a517cde8ed48a336b173044b1138aa2c1a3";
const address = z
  .string()
  .refine(isAddress)
  .transform((value) => value.toLowerCase() as Address);
const digest = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as Hex);
const uint32 = z.number().int().min(0).max(0xffffffff);
const ids = z.array(uint32);
const packSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: z.enum(["base-mainnet-smoke-v1", "base-mainnet-standard-v1"]),
    status: z.literal("ready"),
    chainId: z.literal(8453),
    engine: address,
    paymentToken: address,
    priceRaw: z.literal("1000000000000000000"),
    intervalSeconds: z.literal("86400"),
    mintsPerInterval: z.literal(1),
    maxBatch: uint32.min(1).max(7),
    baseGas: uint32.min(400000),
    perMintGas: uint32.min(200000),
    confirmations: z.number().int().min(3).max(200),
    supplyCap: z.union([z.literal("1"), z.null()]),
    typeIds: ids,
    colorIds: ids,
    hornIds: ids,
    glitterIds: ids,
    allowedVariantIds: ids,
    artworkHash: digest,
    manifestURI: z.string().url(),
    metadataBaseURI: z.string().url()
  })
  .strict();
const bundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    chainId: z.literal(8453),
    admin: address,
    registry: address,
    engine: address,
    monsters: address,
    expectedTypeCount: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
    pack: packSchema,
    catalogHash: digest,
    configureData: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{2})+$/)
      .transform((value) => value.toLowerCase() as Hex)
  })
  .strict();

export type BoosterSetupBundle = z.infer<typeof bundleSchema>;
export type BoosterSetupDeployment = {
  registry: Address;
  engine: Address;
  monsters: Address;
};

export function boosterSetupArguments(bundle: BoosterSetupBundle) {
  const p = bundle.pack;
  return {
    rules: {
      engine: p.engine,
      paymentToken: p.paymentToken,
      price: BigInt(p.priceRaw),
      intervalSeconds: BigInt(p.intervalSeconds),
      mintsPerInterval: p.mintsPerInterval,
      maxBatch: p.maxBatch,
      baseGas: p.baseGas,
      perMintGas: p.perMintGas,
      confirmations: p.confirmations,
      supplyCap: BigInt(p.supplyCap ?? "0"),
      artworkHash: p.artworkHash,
      manifestURI: p.manifestURI,
      metadataBaseURI: p.metadataBaseURI
    },
    catalog: {
      types: p.typeIds,
      colors: p.colorIds,
      horns: p.hornIds,
      glitters: p.glitterIds,
      allowed: p.allowedVariantIds
    }
  };
}

export function validateBoosterSetup(
  input: unknown,
  deployment: BoosterSetupDeployment,
  kind: BoosterSetupKind = "smoke"
): BoosterSetupBundle {
  const bundle = bundleSchema.parse(input);
  const profile = boosterSetupProfiles[kind];
  if (
    bundle.admin !== boosterSetupOwner.toLowerCase() ||
    bundle.registry !== deployment.registry.toLowerCase() ||
    bundle.engine !== deployment.engine.toLowerCase() ||
    bundle.monsters !== deployment.monsters.toLowerCase() ||
    bundle.pack.engine !== bundle.engine ||
    bundle.pack.paymentToken !== proto ||
    bundle.expectedTypeCount !== profile.expectedTypeCount ||
    bundle.pack.slug !== profile.slug ||
    bundle.pack.supplyCap !== profile.supplyCap
  )
    throw new Error(
      "Setup package does not match the approved Base deployment."
    );
  const { rules, catalog } = boosterSetupArguments(bundle);
  if (
    JSON.stringify(catalog) !==
    JSON.stringify({
      types: Array.from({ length: 11 }, (_, i) => i + 1),
      colors: [1, 2, 3, 4, 5, 6],
      horns: [1, 2],
      glitters: [0, 1],
      allowed: []
    })
  )
    throw new Error("The pack must include all 264 approved variants.");
  if (
    rules.baseGas + rules.perMintGas * rules.maxBatch > 2400000 ||
    rules.artworkHash === `0x${"0".repeat(64)}`
  )
    throw new Error("Invalid callback gas or artwork commitment.");
  const expectedBase = `https://api.yunipals.com/yunipals-indexer/v1/boosters/art/${profile.slug}/`;
  if (
    rules.metadataBaseURI !== expectedBase ||
    rules.manifestURI !== expectedBase + "manifest.json"
  )
    throw new Error(
      "The pack must use its published production artwork catalog."
    );
  const validated = validateBoosterCatalog(catalog);
  if (
    validated.catalogHash.toLowerCase() !== bundle.catalogHash ||
    validated.totalVariants !== 264 ||
    encodeFunctionData({
      abi: packRegistryAbi,
      functionName: "configureType",
      args: [0n, rules, catalog]
    }).toLowerCase() !== bundle.configureData
  )
    throw new Error("Setup calldata differs from the frozen pack rules.");
  return bundle;
}

export async function readBoosterSetup(
  sha256: string,
  deployment: BoosterSetupDeployment,
  signal?: AbortSignal,
  kind: BoosterSetupKind = "smoke"
) {
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new Error("The owner setup package is not published yet.");
  const response = await fetch(boosterSetupProfiles[kind].filename, {
    cache: "no-store",
    signal
  });
  if (!response.ok)
    throw new Error("The owner setup package could not be loaded.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 500000) throw new Error("Setup package is too large.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== sha256)
    throw new Error(
      "Setup package checksum changed. No transaction was prepared."
    );
  return validateBoosterSetup(
    JSON.parse(new TextDecoder().decode(bytes)),
    deployment,
    kind
  );
}

export async function checkPublishedBoosterSetup(bundle: BoosterSetupBundle) {
  const response = await fetch(bundle.pack.manifestURI, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok)
    throw new Error(
      "Publish the artwork manifest before configuring or activating this pack."
    );
  const metadata = (await response.json()) as Record<string, unknown>;
  if (
    metadata.artworkHash !== bundle.pack.artworkHash ||
    metadata.catalogHash !== bundle.catalogHash ||
    metadata.metadataBaseURI !== bundle.pack.metadataBaseURI
  )
    throw new Error(
      "The published artwork manifest differs from the frozen setup package."
    );
}

export function matchesBoosterSetup(
  bundle: BoosterSetupBundle,
  pack: ContractFunctionReturnType<typeof packRegistryAbi, "view", "getPack">,
  catalog: ContractFunctionReturnType<
    typeof packRegistryAbi,
    "view",
    "getCatalog"
  >
) {
  const data = encodeFunctionData({
    abi: packRegistryAbi,
    functionName: "configureType",
    args: [0n, pack.rules, catalog]
  });
  return (
    data.toLowerCase() === bundle.configureData &&
    pack.catalogHash.toLowerCase() === bundle.catalogHash &&
    (!pack.active || pack.totalVariants === 264)
  );
}
