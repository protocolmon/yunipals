import { createHash } from "node:crypto";
import {
  AttributeTransformingUtils,
  isRainbowByAttrs,
  rarityFor
} from "./legacy.cjs";

export const rarityFormulaVersion = "web3-util-pmons-31.15.1-v1";

export type RarityCalculation = {
  formulaVersion: typeof rarityFormulaVersion;
  inputFingerprint: string;
  status: "valid" | "unscored" | "missing_input" | "invalid";
  rarityPoints: number | null;
  rarityPointsCapped: number | null;
  errorCode: string | null;
};

type MetadataDocument = Record<string, unknown>;

function relevantInput(tokenId: string, document: MetadataDocument) {
  return {
    id: document.id ?? tokenId,
    originScore: document.originScore ?? null,
    initialProbabilities: document.initialProbabilities ?? null,
    attributes: document.attributes ?? []
  };
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function result(
  inputFingerprint: string,
  status: RarityCalculation["status"],
  rarityPoints: number | null = null,
  rarityPointsCapped: number | null = null,
  errorCode: string | null = null
): RarityCalculation {
  return {
    formulaVersion: rarityFormulaVersion,
    inputFingerprint,
    status,
    rarityPoints,
    rarityPointsCapped,
    errorCode
  };
}

export function calculateRarity(
  tokenId: string,
  document: MetadataDocument
): RarityCalculation {
  const input = relevantInput(tokenId, document);
  const inputFingerprint = fingerprint(input);
  if (!Array.isArray(input.attributes)) {
    return result(inputFingerprint, "invalid", null, null, "attributes_not_array");
  }

  try {
    const attributes = AttributeTransformingUtils.toAttributes(
      input.attributes as Parameters<
        typeof AttributeTransformingUtils.toAttributes
      >[0]
    );
    if (!attributes.type) {
      return result(inputFingerprint, "missing_input", null, null, "type_missing");
    }
    if (isRainbowByAttrs({ attributes }) && typeof input.originScore !== "number") {
      return result(
        inputFingerprint,
        "missing_input",
        null,
        null,
        "rainbow_origin_score_missing"
      );
    }
    const rarityInput = {
      id: String(input.id),
      originScore: input.originScore,
      initialProbabilities: input.initialProbabilities,
      attributes
    } as Parameters<typeof rarityFor>[0];
    const rarityPoints = rarityFor(rarityInput, {});
    const rarityPointsCapped = rarityFor(rarityInput);
    if (rarityPoints === undefined && rarityPointsCapped === undefined) {
      return result(inputFingerprint, "unscored");
    }
    if (
      typeof rarityPoints !== "number" ||
      typeof rarityPointsCapped !== "number" ||
      !Number.isFinite(rarityPoints) ||
      !Number.isFinite(rarityPointsCapped) ||
      rarityPoints < 0 ||
      rarityPointsCapped < 0
    ) {
      return result(inputFingerprint, "invalid", null, null, "non_finite_score");
    }
    return result(
      inputFingerprint,
      "valid",
      rarityPoints,
      rarityPointsCapped
    );
  } catch {
    return result(inputFingerprint, "invalid", null, null, "calculation_failed");
  }
}
