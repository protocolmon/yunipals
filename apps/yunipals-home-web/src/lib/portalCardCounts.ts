import { z } from "zod";
import { environment } from "@/environment";
import type { ActivePortalStatus } from "@/lib/portals";

const countsSchema = z.object({
  owner: z.string(),
  grading: z.string(),
  collection: z.string(),
  cards: z.string(),
  chainId: z.literal(8453),
  indexedBlock: z.string().regex(/^\d+$/),
  items: z
    .array(
      z.object({
        portalId: z.string().regex(/^[1-9]\d*$/),
        count: z.number().int().nonnegative(),
        retired: z.boolean()
      })
    )
    .max(11)
});

export async function fetchPortalCardCounts(
  owner: string,
  deployment: ActivePortalStatus["deployment"],
  portalIds: string[],
  signal?: AbortSignal
) {
  const params = new URLSearchParams({
    owner,
    grading: deployment.grading,
    collection: deployment.collection,
    portalIds: portalIds.join(",")
  });
  const response = await fetch(
    `${environment.yunipalsIndexerUrl}/v1/boosters/portal-card-counts?${params}`,
    {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000)
    }
  );
  if (!response.ok)
    throw new Error("Card counts are unavailable. Please try again.");
  const result = countsSchema.parse(await response.json());
  if (
    result.owner.toLowerCase() !== owner.toLowerCase() ||
    result.grading.toLowerCase() !== deployment.grading.toLowerCase() ||
    result.collection.toLowerCase() !== deployment.collection.toLowerCase() ||
    result.cards.toLowerCase() !== deployment.cards.toLowerCase() ||
    result.chainId !== deployment.chainId ||
    result.items.length !== portalIds.length ||
    new Set(result.items.map((item) => item.portalId)).size !==
      portalIds.length ||
    result.items.some((item) => !portalIds.includes(item.portalId))
  )
    throw new Error("Card count context changed. Please try again.");
  return result;
}
