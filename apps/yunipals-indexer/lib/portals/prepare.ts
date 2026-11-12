import {
  encodeFunctionData,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex
} from "viem";
import { z } from "zod";
import {
  portalCollectionAbi,
  portalGradingAbi,
  portalCompetitionAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalModels,
  portalModelPolicyHash
} from "@protopals/yunipals-market-core/portals";

const assetUri = z
  .string()
  .max(512)
  .refine((value) => {
    if (value.startsWith("ipfs://"))
      return /^ipfs:\/\/[a-zA-Z0-9][^\s?#]*$/.test(value);
    try {
      const uri = new URL(value);
      return (
        uri.protocol === "https:" && !uri.username && !uri.password && !uri.hash
      );
    } catch {
      return false;
    }
  });
export const launchArtworkSchema = z
  .array(
    z
      .object({
        variantId: z.number().int().min(0).max(263),
        uri: assetUri,
        hash: z.string().regex(/^0x[0-9a-f]{64}$/)
      })
      .strict()
  )
  .length(264)
  .refine(
    (entries) => new Set(entries.map((e) => e.variantId)).size === 264,
    "Provide each of the 264 variant artworks exactly once."
  );
export const rainbowPortalOdds = {
  originalBps: 1000,
  glitterBps: 1000,
  diamondBps: 1000,
  length1Bps: 500,
  length10Bps: 2000,
  length100Bps: 7500,
  colorWeights: [1, 1, 1, 1, 1, 1],
  typeWeights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
} as const;
export interface PortalSetupTransaction {
  purpose: string;
  to: Address;
  value: "0";
  data: Hex;
}

/** Returns reviewable calls only. It never signs, funds or broadcasts transactions. */
export function preparePortalSetup(input: {
  collection: Address;
  grading: Address;
  cards: Address;
  grader: Address;
  aiRecipient: Address;
  rainbowURI: string;
  rainbowHash: Hex;
  rubricURI: string;
  baseArt: z.infer<typeof launchArtworkSchema>;
  competition?: Address;
}) {
  if (
    /^0x0{40}$/i.test(input.aiRecipient) ||
    input.aiRecipient.toLowerCase() === input.grading.toLowerCase()
  )
    throw new Error("AI recipient must be a nonzero payout wallet.");
  assetUri.parse(input.rainbowURI);
  assetUri.parse(input.rubricURI);
  const art = launchArtworkSchema
    .parse(input.baseArt)
    .sort((a, b) => a.variantId - b.variantId);
  const transactions: PortalSetupTransaction[] = [];
  const add = (purpose: string, to: Address, data: Hex) =>
    transactions.push({ purpose, to, value: "0", data });
  add(
    "Create Rainbow as kind 1; requires kindCount=0",
    input.collection,
    encodeFunctionData({
      abi: portalCollectionAbi,
      functionName: "configureKind",
      args: [
        0n,
        {
          name: "Rainbow Portal",
          imageURI: input.rainbowURI,
          artworkHash: input.rainbowHash,
          cap: 1000,
          odds: rainbowPortalOdds
        }
      ]
    })
  );
  add(
    "Bind portal burn-and-claim authority once",
    input.collection,
    encodeFunctionData({
      abi: portalCollectionAbi,
      functionName: "bindClaimController",
      args: [input.grading]
    })
  );
  add(
    "Set Rainbow fees to 0.245 + 0.245 USDC",
    input.grading,
    encodeFunctionData({
      abi: portalGradingAbi,
      functionName: "setPaymentPolicy",
      args: [1n, 245000n, 245000n, input.aiRecipient]
    })
  );
  const rubricId = keccak256(toHex(portalModels.rubric));
  add(
    "Register and activate the immutable grading policy",
    input.grading,
    encodeFunctionData({
      abi: portalGradingAbi,
      functionName: "configureRubric",
      args: [
        rubricId,
        portalModelPolicyHash(),
        portalModels.copyCap,
        input.rubricURI
      ]
    })
  );
  if (input.competition)
    add(
      "Bind the 0.50 USDC competition allocation; Rainbow total becomes 0.99 USDC",
      input.grading,
      encodeFunctionData({
        abi: portalGradingAbi,
        functionName: "configureCompetition",
        args: [input.competition]
      })
    );
  for (let offset = 0; offset < art.length; offset += 64) {
    const batch = art.slice(offset, offset + 64);
    add(
      `Register original artworks ${offset}–${offset + batch.length - 1}`,
      input.grading,
      encodeFunctionData({
        abi: portalGradingAbi,
        functionName: "registerBaseArt",
        args: [
          batch.map((e) => e.variantId),
          batch.map((e) => ({ uri: e.uri, hash: e.hash as Hex }))
        ]
      })
    );
  }
  add(
    "Grant the dedicated wallet grading authority",
    input.grading,
    encodeFunctionData({
      abi: portalGradingAbi,
      functionName: "grantRole",
      args: [keccak256(toHex("GRADER_ROLE")), input.grader]
    })
  );
  if (input.competition)
    add(
      "Grant the dedicated wallet theme publication authority",
      input.competition,
      encodeFunctionData({
        abi: portalCompetitionAbi,
        functionName: "grantRole",
        args: [keccak256(toHex("THEME_ROLE")), input.grader]
      })
    );
  const cardAbi = parseAbi([
    "function setGradingRegistry(address)",
    "function setTokenMetadataBaseURI(string)"
  ]);
  add(
    "Connect card metadata updates to the grading registry",
    input.cards,
    encodeFunctionData({
      abi: cardAbi,
      functionName: "setGradingRegistry",
      args: [input.grading]
    })
  );
  return {
    economicsVersion: 2,
    portalFeeMode: "accumulate_and_burn",
    portalEscrow: input.grading,
    competition: input.competition ?? null,
    modelPolicy: portalModels,
    modelPolicyHash: portalModelPolicyHash(),
    rubricId,
    transactions
  };
}
