import { basename, extname } from "node:path";
import { z } from "zod";
import { AttributeTransformingUtils, PublicAttributeTransformingUtils, getLegacyChain,
  isRainbowByAttrs, rarityFor, NFBOrigins } from "./legacy.cjs";

export const rendererVersion = "legacy-snapshot-v1";
const chain = z.object({ id: z.enum(["1", "56", "137", "42161", "42170", "mainnet-beta"]), type: z.enum(["EVM", "SOLANA"]) });
const envelopeSchema = z.object({
  chain, chainOrigin: chain, origin: z.object({ type: z.string() }).passthrough(),
  nft: z.object({ id: z.string(), name: z.string(), description: z.string(), attributes: z.record(z.unknown()) }).passthrough()
}).passthrough();

export type RainbowOrigins = { originIds: string[]; origins: Record<string, unknown>[]; originScore: number };
export class MissingOriginData extends Error {
  constructor() { super("Historical rainbow origins are required before rendering"); this.name = "MissingOriginData"; }
}

/** Legacy response snapshot. Current owner overlays belong in the read layer. */
export function renderLegacySnapshot(value: unknown, options: {
  publicFacing: boolean; metadataUpdatedAt: number; rainbow?: RainbowOrigins; legacyFactoryOnly?: boolean;
}): Record<string, unknown> {
  if (!Number.isSafeInteger(options.metadataUpdatedAt) || options.metadataUpdatedAt < 0) throw new Error("Invalid metadata timestamp");
  const envelope = envelopeSchema.parse(value), nft = envelope.nft;
  const legacyChain = getLegacyChain(envelope.chain, nft.id), originChain = getLegacyChain(envelope.chainOrigin, nft.id);
  const attrs = nft.attributes as Parameters<typeof AttributeTransformingUtils.toTraits>[0];
  const attributes = AttributeTransformingUtils.toTraits(attrs);
  const nfb = (NFBOrigins as readonly string[]).includes(envelope.origin.type);
  const meta: Record<string, unknown> = {
    address: envelope.delegateeAddress || envelope.ownerAddress,
    animation_url: nft.videoUrl, attributes, background_color: "FFFFFF", description: nft.description,
    external_url: `https://polkamon.com/polkamon/${nft.code}`, id: nft.id, type: nft.type,
    origin: envelope.origin.type, image: nft.imageUrl, code: nft.code,
    initialProbabilities: nft.initialProbabilities, name: nft.name, txHash: nft.hash,
    minted: envelope.minted, bridged: envelope.bridged,
    chain: legacyChain.chain, chainGroup: legacyChain.chainGroup,
    originChain: originChain.chain, originChainGroup: originChain.chainGroup,
    nftContract: legacyChain.nftContract, opening_network: legacyChain.openingNetwork,
    rarity: envelope.rarity, rarityCapped: envelope.rarityCapped, pfpUrl: nft.pfpUrl, ownerSince: envelope.ownerSince
  };
  // Fields excluded by MandatoryNftProjection (e.g. nft.randomNumber) must not
  // leak into the public response simply because the archive preserves them.
  if (nft.rafflePriceClaimed) meta.rafflePriceClaimed = nft.rafflePriceClaimed;
  if (nfb) meta.giftData = envelope.giftData;
  else {
    attributes.push({ trait_type: "Opening Network", value: originChain.openingNetwork });
    for (const field of ["boosterId", "adventureStatus", "axpCount", "adventureTitle", "gameData", "polyboostPosition"]) meta[field] = nft[field];
  }
  if (isRainbowByAttrs({ attributes: attrs } as Parameters<typeof isRainbowByAttrs>[0])) {
    const origins = options.rainbow;
    if (!origins || !origins.originIds.length || origins.originIds.length !== origins.origins.length || !Number.isFinite(origins.originScore)) {
      throw new MissingOriginData();
    }
    Object.assign(meta, origins);
  }
  if(options.legacyFactoryOnly)return JSON.parse(JSON.stringify(meta)) as Record<string,unknown>;
  const transformed = AttributeTransformingUtils.toAttributes(attributes, meta as Parameters<typeof AttributeTransformingUtils.toAttributes>[1]);
  const transformer = options.publicFacing ? PublicAttributeTransformingUtils : AttributeTransformingUtils;
  meta.attributes = transformer.toTraits(transformed, meta as Parameters<typeof transformer.toTraits>[1]).map(trait =>
    trait.trait_type === "Last metadata update" ? { ...trait, value: options.metadataUpdatedAt } : trait);
  if (typeof meta.image === "string") meta.image = meta.image.replace(".mp4", ".jpg").replace("/videos/", "/images/");
  if (!meta.code) {
    const fileName = (url: string) => basename(url, extname(url));
    meta.code = typeof meta.image === "string" ? fileName(fileName(meta.image)).replace(/(?:unimons|unimon|Unimons|Unimon|exomons|exomon|Exomons|Exomon)_/g, "") : null;
  }
  if (options.publicFacing && !nfb) {
    try {
      const rarityInput = { id: nft.id, originScore: meta.originScore, initialProbabilities: nft.initialProbabilities,
        attributes: AttributeTransformingUtils.toAttributes(meta.attributes as Parameters<typeof AttributeTransformingUtils.toAttributes>[0]) } as Parameters<typeof rarityFor>[0];
      if (!rarityInput.attributes.type) Object.assign(meta, { rarity: 0, rarityCapped: 0 });
      else Object.assign(meta, { rarity: rarityFor(rarityInput, {}), rarityCapped: rarityFor(rarityInput) });
    } catch { Object.assign(meta, { rarity: 0, rarityCapped: 0 }); }
  }
  return JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
}
