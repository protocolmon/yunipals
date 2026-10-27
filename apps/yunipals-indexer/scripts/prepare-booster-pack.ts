import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { encodeFunctionData, isAddress, zeroAddress } from "viem";
import { packRegistryAbi } from "../../../packages/yunipals-market-core/src/boosterAbi.js";
import { validateBoosterCatalog } from "../../../packages/yunipals-market-core/src/boosterCatalog.js";
import { checkBoosterVrfConfig } from "../lib/boosters/vrf-preflight.js";

const uint32 = z.number().int().min(0).max(0xffffffff);
const uint64 = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) < 2n ** 64n);
const address = z
  .string()
  .refine((value) => isAddress(value) && value.toLowerCase() !== zeroAddress);
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: z.string().min(1),
    status: z.enum(["draft", "ready"]),
    chainId: z.union([z.literal(8453), z.literal(84532)]),
    engine: address.nullable(),
    paymentToken: address,
    priceRaw: z
      .string()
      .regex(/^\d+$/)
      .refine((value) => BigInt(value) > 0n && BigInt(value) < 2n ** 128n),
    intervalSeconds: uint64.refine((value) => BigInt(value) > 0n),
    mintsPerInterval: uint32.min(1),
    maxBatch: uint32.min(1).max(32),
    baseGas: uint32.min(400000),
    perMintGas: uint32.min(200000),
    confirmations: z.number().int().min(3).max(200),
    supplyCap: uint64.nullable(),
    typeIds: z.array(uint32),
    colorIds: z.array(uint32),
    hornIds: z.array(uint32),
    glitterIds: z.array(uint32),
    allowedVariantIds: z.array(uint32),
    artworkHash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .nullable(),
    manifestURI: z.string().min(1).max(512).nullable(),
    metadataBaseURI: z.string().min(1).max(512).endsWith("/").nullable()
  })
  .strict();
const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    rpc: { type: "string" },
    "type-id": { type: "string", default: "0" }
  }
});
if (!values.manifest || !/^(0|[1-9]\d*)$/.test(values["type-id"]!))
  throw new Error("Use --manifest PATH [--type-id EXISTING_DRAFT_ID]");
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(values.manifest, "utf8"))
);
if (manifest.baseGas + manifest.perMintGas * manifest.maxBatch > 2400000)
  throw new Error("Callback gas exceeds the configured safety ceiling.");
const missing = [
  !manifest.engine && "engine",
  !manifest.artworkHash && "artworkHash",
  !manifest.manifestURI && "manifestURI",
  !manifest.metadataBaseURI && "metadataBaseURI",
  ...["typeIds", "colorIds", "hornIds", "glitterIds"].filter(
    (key) => manifest[key as "typeIds"].length === 0
  )
].filter(Boolean);
if (missing.length) {
  console.log(
    JSON.stringify(
      { status: "draft", missing, activationPrepared: false },
      null,
      2
    )
  );
  if (manifest.status === "ready") process.exitCode = 1;
} else {
  const catalog = {
    types: manifest.typeIds,
    colors: manifest.colorIds,
    horns: manifest.hornIds,
    glitters: manifest.glitterIds,
    allowed: manifest.allowedVariantIds
  };
  const validated = validateBoosterCatalog(catalog);
  if (manifest.artworkHash === `0x${"0".repeat(64)}`)
    throw new Error("Artwork hash must be nonzero.");
  const rules = {
    engine: manifest.engine as `0x${string}`,
    paymentToken: manifest.paymentToken as `0x${string}`,
    price: BigInt(manifest.priceRaw),
    intervalSeconds: BigInt(manifest.intervalSeconds),
    mintsPerInterval: manifest.mintsPerInterval,
    maxBatch: manifest.maxBatch,
    baseGas: manifest.baseGas,
    perMintGas: manifest.perMintGas,
    confirmations: manifest.confirmations,
    supplyCap: BigInt(manifest.supplyCap ?? "0"),
    artworkHash: manifest.artworkHash as `0x${string}`,
    manifestURI: manifest.manifestURI!,
    metadataBaseURI: manifest.metadataBaseURI!
  };
  if (manifest.chainId === 8453 && manifest.status === "ready") {
    for (const uri of [rules.manifestURI, rules.metadataBaseURI]) {
      const url = new URL(uri);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        throw new Error(
          "Mainnet activation requires public HTTPS artwork URLs."
        );
    }
    const response = await fetch(rules.manifestURI, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok)
      throw new Error(
        "Publish the artwork manifest before preparing mainnet activation."
      );
    const published = (await response.json()) as Record<string, unknown>;
    if (
      published.artworkHash !== manifest.artworkHash ||
      published.catalogHash !== validated.catalogHash ||
      published.metadataBaseURI !== manifest.metadataBaseURI
    )
      throw new Error(
        "Published artwork commitment does not match the pack rules."
      );
  }
  const vrfPreflight =
    manifest.status === "ready"
      ? await checkBoosterVrfConfig({
          ...rules,
          chainId: manifest.chainId,
          rpc:
            values.rpc ??
            (manifest.chainId === 8453
              ? "https://mainnet.base.org"
              : "https://sepolia.base.org")
        })
      : null;
  const id = BigInt(values["type-id"]!);
  console.log(
    JSON.stringify(
      {
        slug: manifest.slug,
        chainId: manifest.chainId,
        vrfPreflight,
        ...validated,
        fullAccrualSeconds: (
          BigInt(
            Math.ceil((validated.totalVariants - 1) / manifest.mintsPerInterval)
          ) * rules.intervalSeconds
        ).toString(),
        configureData: encodeFunctionData({
          abi: packRegistryAbi,
          functionName: "configureType",
          args: [id, rules, catalog]
        }),
        activateData:
          id === 0n || manifest.status !== "ready"
            ? null
            : encodeFunctionData({
                abi: packRegistryAbi,
                functionName: "activate",
                args: [id]
              }),
        note:
          id === 0n
            ? "Use the TypeConfigured event's allocated ID to prepare activation; no transactions were sent."
            : "Review against the existing draft and deployment before signing; no transactions were sent."
      },
      null,
      2
    )
  );
}
