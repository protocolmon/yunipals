import { z } from "zod";
import { formatUnits, isAddress, type Hex } from "viem";
import { environment } from "@/environment";
import { PortalRequestError, portalRetryAfter } from "./portalRetry";

const uint = z.string().regex(/^\d+$/);
const address = z.string().refine((value) => isAddress(value));
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const asset = z.object({ uri: z.string(), hash });
export const portalSpellReceiptSchema = z.object({
  commitment: hash,
  receipt: z.object({
    expiresAt: uint,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/)
  })
});
const gate = z.object({
  sequenceStart: z.number().int().min(0).max(263),
  sequenceLength: z.union([z.literal(1), z.literal(10), z.literal(100)]),
  colorGate: z.number().int().min(0).max(5),
  typeGate: z.number().int().min(0).max(10),
  originalOnly: z.boolean(),
  glitterGate: z.boolean(),
  diamondGate: z.boolean()
});
export const portalTokenSchema = z.object({
  id: uint,
  kindId: uint,
  name: z.string(),
  imageURI: z.string(),
  gates: gate,
  owner: address,
  retired: z.boolean(),
  claimable: uint,
  active: z.boolean(),
  slotEndsAt: uint,
  asOfBlock: uint,
  asOfBlockHash: hash
});
export type OwnedPortal = z.infer<typeof portalTokenSchema>;
const activityEvent = z.object({
  type: z.string(),
  tokenId: uint,
  block: uint,
  blockHash: hash,
  transactionHash: hash,
  logIndex: z.number().int(),
  args: z.record(z.string())
});
const activitySchema = z.object({
  events: z.array(activityEvent),
  nextCursor: z.string().nullable(),
  indexedThroughBlock: uint,
  snapshotBlock: uint
});
export type PortalActivity = z.infer<typeof activitySchema>;
const core = z.object({
  indexing: z.boolean().default(true),
  rotationIndexed: z.boolean().default(false),
  indexedThroughBlock: uint.nullable().optional(),
  competition: z
    .object({
      address,
      fee: uint,
      rulesHash: hash,
      admissionHash: hash,
      accepting: z.boolean(),
      phase: z.enum(["open", "grading", "theme"]),
      theme: z
        .object({
          hash,
          title: z.string(),
          brief: z.string(),
          sourcesHash: hash,
          uri: z.string()
        })
        .passthrough(),
      batchSize: uint,
      entryCount: uint,
      batchCount: uint,
      liability: uint,
      reserves: uint,
      pending: uint,
      nextBatch: uint
    })
    .nullable()
    .optional(),
  deployment: z.object({
    chainId: z.number().int(),
    collection: address,
    registry: address,
    grading: address,
    cards: address,
    usdc: address
  }),
  now: z.number(),
  asOfBlock: uint,
  asOfBlockHash: hash,
  economicsVersion: z.literal("2"),
  portalFeeMode: z.literal("accumulate_and_burn"),
  portalEscrow: address,
  statusReason: z.enum([
    "unconfigured",
    "empty",
    "not_started",
    "retired",
    "expired",
    "paused",
    "open"
  ]),
  supply: z.object({ live: uint, minted: uint, burned: uint }),
  escrow: z.object({ reserves: uint, liability: uint }),
  round: z.object({ id: uint, portalId: uint, startsAt: uint, endsAt: uint }),
  open: z.boolean(),
  paused: z.boolean(),
  rubricId: hash,
  rotation: z.object({
    requestId: uint,
    ready: z.boolean(),
    canActivate: z.boolean(),
    canRequest: z.boolean()
  }),
  portal: z
    .object({
      id: uint,
      owner: address,
      retired: z.boolean(),
      claimable: uint,
      active: z.boolean(),
      slotEndsAt: uint,
      asOfBlock: uint,
      asOfBlockHash: hash,
      kindId: uint,
      name: z.string(),
      imageURI: z.string(),
      effect: z
        .object({ name: z.string(), instruction: z.string() })
        .nullable()
        .optional(),
      gradingCase: z
        .object({
          id: z.string(),
          title: z.string(),
          criteria: z.object({
            creativity: z.string(),
            harmony: z.string(),
            craft: z.string(),
            impact: z.string()
          })
        })
        .nullable()
        .optional(),
      gates: gate,
      payment: z.object({
        aiFee: uint,
        portalFee: uint,
        aiRecipient: address,
        portalRecipient: address,
        version: uint
      }),
      rubric: z.object({
        modelPolicy: hash,
        copyCap: z.number(),
        uri: z.string(),
        configured: z.boolean()
      })
    })
    .nullable()
});
const status = z.union([
  core.extend({ enabled: z.literal(true) }),
  z.object({ enabled: z.literal(false) })
]);
const quote = core.extend({
  input: asset,
  artVersion: uint,
  nonce: uint,
  tokenId: uint
});
const grade = z.number().int().min(1).max(100);
const history = z.object({
  tokenId: uint,
  historyCount: uint,
  pending: uint,
  originalArtwork: asset,
  nextBefore: uint.nullable(),
  history: z.array(
    z.object({
      id: uint,
      request: z
        .object({
          submitter: address,
          portalId: uint,
          kindId: uint,
          roundId: uint,
          acceptedAt: uint,
          artVersion: uint
        })
        .passthrough(),
      result: z
        .object({
          artwork: asset,
          scores: z.tuple([grade, grade, grade, grade]),
          copied: z.boolean(),
          reportURI: z.string(),
          spellURI: z.string(),
          completedAt: uint
        })
        .passthrough()
    })
  ),
  publicationPending: z.boolean().default(false),
  publication: z.array(
    z.object({
      requestId: uint,
      spell: z.string(),
      result: z
        .object({
          slab: asset
            .extend({
              version: uint,
              renderer: z.string(),
              manifest: asset,
              rawArtworkHash: hash
            })
            .optional(),
          gradingReason: z.string().nullable().optional(),
          originality: z
            .object({
              reason: z.string(),
              sources: z
                .array(
                  z.object({
                    requestId: uint,
                    excerpt: z.string(),
                    reason: z.string()
                  })
                )
                .optional()
            })
            .passthrough()
            .nullable()
            .optional()
        })
        .passthrough()
    })
  )
});
export type PortalStatus = z.infer<typeof status>;
export type PortalQuote = z.infer<typeof quote>;
export type PortalCard = z.infer<typeof history>;
export type ActivePortalStatus = Extract<PortalStatus, { enabled: true }>;

export function portalApiUrl() {
  return environment.portalApiUrl ?? environment.yunipalsIndexerUrl;
}

export async function portalRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${portalApiUrl()}/v1/portals${path}`, {
    ...init,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000)
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.string().max(300) }).safeParse(value);
    throw new PortalRequestError(
      parsed.success
        ? parsed.data.error
        : "Portals are temporarily unavailable.",
      response.status,
      portalRetryAfter(response.headers.get("Retry-After"))
    );
  }
  return value;
}
export async function fetchPortalStatus(signal?: AbortSignal) {
  return status.parse(await portalRequest("", { signal }));
}
export async function fetchPortalQuote(tokenId: string, owner: string) {
  return quote.parse(
    await portalRequest(
      `/quote?tokenId=${encodeURIComponent(tokenId)}&owner=${encodeURIComponent(owner)}`
    )
  );
}
export async function fetchPortalCard(tokenId: string, before?: string) {
  return history.parse(
    await portalRequest(
      `/cards/${encodeURIComponent(tokenId)}${before ? `?before=${encodeURIComponent(before)}` : ""}`
    )
  );
}

export async function fetchOwnedPortals(
  owner: string,
  cursor?: string,
  signal?: AbortSignal
) {
  return z
    .object({
      tokens: z.array(portalTokenSchema),
      nextCursor: z.string().nullable(),
      indexedThroughBlock: uint,
      snapshotBlock: uint,
      asOfBlock: uint,
      catchingUp: z.boolean()
    })
    .parse(
      await portalRequest(
        `/owners/${encodeURIComponent(owner)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal }
      )
    );
}
export async function fetchPortalActivity(
  tokenId: string,
  cursor?: string,
  signal?: AbortSignal
) {
  return activitySchema.parse(
    await portalRequest(
      `/tokens/${encodeURIComponent(tokenId)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal }
    )
  );
}
export async function fetchPortalClaims(
  owner: string,
  cursor?: string,
  signal?: AbortSignal
) {
  return activitySchema.parse(
    await portalRequest(
      `/owners/${encodeURIComponent(owner)}/claims${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal }
    )
  );
}

export function portalImage(uri: string) {
  if (uri.startsWith("ipfs://"))
    return `${environment.boosterIpfsGateway.replace(/\/?$/, "/")}${uri.slice(7)}`;
  return uri.startsWith("https://") || uri.startsWith("/images/") ? uri : "";
}
export function portalPrice(value: string | bigint) {
  return formatUnits(BigInt(value), 6);
}
export function portalRange(start: number, length: number) {
  const end = (start + length - 1) % 264;
  return end < start
    ? `${start}–263 and 0–${end}`
    : start === end
      ? String(start)
      : `${start}–${end}`;
}
export function portalDeploymentMatches(
  value: ActivePortalStatus | PortalQuote
) {
  return Boolean(
    value.economicsVersion === "2" &&
    value.portalFeeMode === "accumulate_and_burn" &&
    environment.portalGrading &&
    value.deployment.grading.toLowerCase() ===
      environment.portalGrading.toLowerCase() &&
    value.deployment.chainId === environment.portalChainId
  );
}
export function portalAdmission(value: PortalQuote, commitment: Hex) {
  if (!value.open || !value.portal)
    throw new Error("The portal window has closed. Please check again.");
  return {
    tokenId: BigInt(value.tokenId),
    portalId: BigInt(value.round.portalId),
    roundId: BigInt(value.round.id),
    paymentVersion: BigInt(value.portal.payment.version),
    artVersion: BigInt(value.artVersion),
    rubricId: value.rubricId as Hex,
    maximumFee:
      BigInt(value.portal.payment.aiFee) +
      BigInt(value.portal.payment.portalFee) +
      BigInt(value.competition?.fee ?? 0),
    inputHash: value.input.hash as Hex,
    spellCommitment: commitment,
    nonce: BigInt(value.nonce)
  };
}
