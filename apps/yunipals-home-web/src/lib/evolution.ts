import { z } from "zod";
import { decodeFunctionData, type Address } from "viem";
import {
  adventureAbi,
  evolutionAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import { environment } from "@/environment";
import { portalImage } from "@/lib/portals";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v as Address);
const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as `0x${string}`);
const dose = z.object({
  catalogueVersion: z.literal(1),
  serumId: z.number().int().min(1).max(121),
  presenceId: z.number().int().min(1).max(11)
});
export type DoseHistory = {
  tokenId: string;
  level: number;
  presence: number;
  finish: number;
  doses: z.infer<typeof dose>[];
  parents: DoseHistory[];
};
const history: z.ZodType<DoseHistory> = z.lazy(() =>
  z.object({
    tokenId: uint,
    level: z.number().int().min(0).max(2),
    presence: z.number().int().min(0).max(11),
    finish: z.number().int().min(0).max(3),
    doses: z.array(dose).max(11),
    parents: z.array(history).max(2)
  })
);
export const evolutionCardSchema = z.object({
  portalWitness: uint.optional(),
  tokenId: uint,
  owner: address,
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  sources: z
    .array(
      z.object({
        tokenId: uint,
        originalTokenId: uint,
        sequence: z.number().int().min(0).max(263),
        isOriginal: z.boolean(),
        packTypeId: uint,
        variantId: z.number(),
        monsterType: z.number(),
        color: z.number(),
        horn: z.number(),
        glitter: z.number()
      })
    )
    .min(1)
    .max(4),
  effectiveSequence: z.number().int().min(0).max(263),
  artVersion: uint,
  historyHash: hash,
  localDoses: z.number().int().min(0).max(11),
  presence: z.number().int().min(0).max(11),
  finish: z.number().int().min(0).max(3),
  history,
  nextAdventureAt: z.number().int(),
  unused: dose.nullable(),
  pendingAdventure: uint.nullable(),
  pendingEvolution: uint.nullable(),
  pendingGrade: uint.nullable(),
  graded: z.boolean(),
  reservedBy: address.nullable(),
  transferLocked: z.boolean(),
  artwork: z.object({ uri: z.string(), hash }),
  metadataURI: z.string()
});
export type AdventureCard = z.infer<typeof evolutionCardSchema>;
export type EvolutionAction = "adventure" | "serum" | "fusion";
export const evolutionQuoteSchema = z.object({
  kind: z.enum(["adventure", "serum", "fusion"]),
  cards: z.array(evolutionCardSchema).min(1).max(2),
  to: address,
  data: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .transform((v) => v as `0x${string}`),
  value: uint,
  fee: uint,
  fees: z.object({ maxFeePerGas: uint, maxPriorityFeePerGas: uint }),
  deadline: uint,
  chainId: z.number(),
  usdc: address
});
export type EvolutionQuote = z.infer<typeof evolutionQuoteSchema>;
export async function evolutionRequest(path: string, signal?: AbortSignal) {
  const response = await fetch(
    `${environment.portalApiUrl ?? environment.yunipalsIndexerUrl}/v1/evolution${path}`,
    { signal }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Adventures are temporarily unavailable.");
  }
  return response.json() as Promise<unknown>;
}
export async function fetchAdventureCard(id: string, signal?: AbortSignal) {
  return z
    .object({ card: evolutionCardSchema, timestamp: z.number() })
    .parse(await evolutionRequest(`/cards/${id}`, signal));
}
export async function fetchAdventureCards(
  owner: string,
  after?: string | null,
  compatibleWith?: string,
  signal?: AbortSignal,
  portalId?: string
) {
  const params = new URLSearchParams();
  if (after) params.set("after", after);
  if (compatibleWith) params.set("compatibleWith", compatibleWith);
  if (portalId) params.set("portalId", portalId);
  return z
    .object({
      cards: z.array(evolutionCardSchema),
      nextAfter: z.string().max(1000).nullable()
    })
    .parse(await evolutionRequest(`/owners/${owner}?${params}`, signal));
}
export async function fetchEvolutionQuote(
  kind: EvolutionAction,
  tokenId: string,
  owner: string,
  partnerId?: string
) {
  const params = new URLSearchParams({ kind, tokenId, owner });
  if (partnerId) params.set("partnerId", partnerId);
  return evolutionQuoteSchema.parse(await evolutionRequest(`/quote?${params}`));
}
/** Never trust an API-provided transaction destination or calldata without checking the reviewed semantics. */
export function validateEvolutionQuote(
  quote: EvolutionQuote,
  owner: Address,
  kind: EvolutionAction,
  tokenId: string,
  partnerId?: string
) {
  const configured =
    kind === "adventure"
      ? environment.adventuresAddress
      : environment.evolutionAddress;
  if (
    !environment.evolutionEnabled ||
    quote.chainId !== environment.portalChainId ||
    quote.to.toLowerCase() !== configured.toLowerCase() ||
    quote.kind !== kind ||
    !(
      kind === "serum"
        ? ["0", "100000"]
        : [kind === "adventure" ? "0" : "100000"]
    ).includes(quote.fee) ||
    quote.cards.some(
      (c) =>
        c.owner.toLowerCase() !== owner.toLowerCase() ||
        c.graded ||
        c.reservedBy
    ) ||
    quote.cards
      .map((c) => c.tokenId)
      .sort()
      .join() !== [tokenId, ...(partnerId ? [partnerId] : [])].sort().join()
  )
    throw new Error(
      "The adventure quote does not match your selection or configured contracts."
    );
  const decoded = decodeFunctionData({
    abi: kind === "adventure" ? adventureAbi : evolutionAbi,
    data: quote.data
  });
  const args = decoded.args as readonly unknown[];
  const expectedName =
    kind === "adventure"
      ? "adventure"
      : kind === "serum"
        ? "consumeSerum"
        : "fuse";
  const a = quote.cards[0],
    b = quote.cards[1];
  const expected = (c: AdventureCard) => ({
    artVersion: BigInt(c.artVersion),
    historyHash: c.historyHash
  });
  const normalize = (v: unknown) =>
    JSON.stringify(v, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    );
  const required =
    kind === "adventure"
      ? [BigInt(tokenId), args[1], BigInt(quote.value), BigInt(quote.deadline)]
      : kind === "serum"
        ? [
            BigInt(tokenId),
            expected(a),
            a.unused,
            BigInt(quote.fee),
            BigInt(quote.value),
            BigInt(quote.deadline)
          ]
        : [
            BigInt(a.tokenId),
            BigInt(b.tokenId),
            expected(a),
            expected(b),
            BigInt(quote.value),
            BigInt(quote.deadline)
          ];
  if (
    decoded.functionName !== expectedName ||
    normalize(args) !== normalize(required) ||
    (kind === "serum" && a.finish !== 0 && quote.value !== "0")
  )
    throw new Error(
      "The quote's transaction does not match the reviewed action."
    );
}
export const evolutionImage = (card: AdventureCard) =>
  portalImage(card.artwork.uri);
export const presencePreviews = [
  "01-holy-voidheart-avatar",
  "02-aggressive-bloom-fangs",
  "03-calm-frost-runes",
  "04-chill-ember-wings",
  "05-happy-solar-veil",
  "06-panicked-storm-spines",
  "07-mischievous-dreadthorn-talons",
  "08-proud-bloodmoon-sovereign",
  "09-curious-crystal-crest",
  "10-melancholic-tidal-wraith",
  "11-sinister-starlight-hide"
].map((name) => `/images/evolution/${name}.webp`);
