import { z } from "zod";
import { AttributeTransformingUtils } from "./legacy.cjs";
import { MissingOriginData, type RainbowOrigins } from "./snapshot.js";

const parentSchema = z.object({ nft: z.object({ id: z.string(), code: z.string(), birthday: z.string(),
  initialRarityCapped: z.number().finite(), name: z.string(), description: z.string(),
  attributes: z.record(z.unknown()), initialProbabilities: z.unknown().optional() }).passthrough() });

export function historicalOriginIds(value: unknown): string[] {
  const source = z.object({ origin: z.object({ originIds: z.array(z.string()).optional() }).passthrough(),
    nft: z.object({ originIds: z.array(z.string()).optional() }).passthrough() }).parse(value);
  const a = source.nft.originIds, b = source.origin.originIds;
  if (a && b && JSON.stringify(a) !== JSON.stringify(b)) throw new Error("Conflicting historical rainbow parents");
  if (!(a ?? b)?.length) throw new MissingOriginData();
  return [...(a ?? b)!];
}

export function renderRainbowOrigins(ids: readonly string[], parents: readonly unknown[]): RainbowOrigins {
  if (!ids.length || ids.length !== parents.length) throw new MissingOriginData();
  const nfts = parents.map(parent => parentSchema.parse(parent).nft);
  if (nfts.some((nft, index) => nft.id !== ids[index])) throw new Error("Historical parent order/identity mismatch");
  return { originIds: [...ids], originScore: nfts.reduce((total,nft) => total+nft.initialRarityCapped,0),
    origins: nfts.map(nft => ({ id: nft.id, createdAt: nft.birthday, code: nft.code,
      initialProbabilities: nft.initialProbabilities,
      image: `https://assets.polkamon.com/images/Unimons_${nft.code}.jpg`,
      external_url: `https://polkamon.com/polkamon/${nft.code}`, description: nft.description, name: nft.name,
      attributes: AttributeTransformingUtils.toTraits(nft.attributes as Parameters<typeof AttributeTransformingUtils.toTraits>[0]),
      background_color: "FFFFFF", animation_url: `https://assets.polkamon.com/videos/Unimons_${nft.code}.mp4` })) };
}
