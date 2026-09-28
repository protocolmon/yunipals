import { assetKey } from "./canonical.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalar(value: unknown): string | null {
  return typeof value === "string" && value.length ? value : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

export function sourceIdentity(value: unknown) {
  const doc = object(value), generation = object(doc.genId), nft = object(doc.nft);
  const family = scalar(generation.type), id = scalar(nft.id), generatedId = scalar(generation.id);
  const bscBabyRemap = family === "GEN1" && object(doc.origin).type === "GEN1_BSC_BABY_MYSTERY_BOX"
    && doc.id === `GEN1_${id}` && id !== null && generatedId !== null
    && /^\d+$/.test(id) && /^\d+$/.test(generatedId)
    && BigInt(id) >= 202300000000n && BigInt(id) <= 202300025000n
    && BigInt(generatedId) - BigInt(id) === 1097700200000n;
  // NFB and some experimental genIds contain a chain prefix; their public NFT
  // IDs intentionally differ. Preserve the complete genId in the asset key.
  const issue = !family || !id || !generatedId ? "missing_asset_identity"
    : family === "GEN1" && generatedId !== id && !bscBabyRemap ? "identity_disagreement" : null;
  return { assetKey: !issue ? assetKey(family!, generatedId!) : null, legacyId: id, family,
    chainId: scalar(object(doc.chain).id), originType: scalar(object(doc.origin).type), issue };
}
