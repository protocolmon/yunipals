import { createHash } from "node:crypto";

// The public source records scores supplied by the metadata document. The
// previous local scorer required private package archives; this version keeps
// its rows distinct until a parity-checked scorer can be published.
export const rarityFormulaVersion = "metadata-document-v1" as const;

export type RarityCalculation = {
  formulaVersion: typeof rarityFormulaVersion;
  inputFingerprint: string;
  status: "valid" | "unscored" | "missing_input" | "invalid";
  rarityPoints: number | null;
  rarityPointsCapped: number | null;
  errorCode: string | null;
};

type MetadataDocument = Record<string, unknown>;

function score(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function calculateRarity(
  tokenId: string,
  document: MetadataDocument
): RarityCalculation {
  const attributes = Array.isArray(document.attributes)
    ? document.attributes
    : [];
  const type = attributes.find(
    (attribute) =>
      typeof attribute === "object" &&
      attribute !== null &&
      "trait_type" in attribute &&
      attribute.trait_type === "Type"
  );
  const traitScore = attributes.find(
    (attribute) =>
      typeof attribute === "object" &&
      attribute !== null &&
      "trait_type" in attribute &&
      attribute.trait_type === "Rarity Points"
  );
  const suppliedScore =
    document.rarity ??
    (typeof traitScore === "object" && traitScore !== null && "value" in traitScore
      ? traitScore.value
      : null);
  const inputFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        tokenId,
        rarity: suppliedScore,
        rarityCapped: document.rarityCapped ?? null,
        type: typeof type === "object" && type !== null && "value" in type
          ? type.value
          : null
      })
    )
    .digest("hex");
  const base = {
    formulaVersion: rarityFormulaVersion,
    inputFingerprint,
    rarityPoints: null,
    rarityPointsCapped: null
  };
  if (!type) return { ...base, status: "missing_input", errorCode: "type_missing" };
  if (suppliedScore === null || suppliedScore === undefined)
    return { ...base, status: "unscored", errorCode: null };
  const raw = score(suppliedScore);
  const capped = score(document.rarityCapped ?? suppliedScore);
  if (raw === null || capped === null)
    return { ...base, status: "invalid", errorCode: "invalid_supplied_score" };
  return {
    ...base,
    status: "valid",
    rarityPoints: raw,
    rarityPointsCapped: capped,
    errorCode: null
  };
}
