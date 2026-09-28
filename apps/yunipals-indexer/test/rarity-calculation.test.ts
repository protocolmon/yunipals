import { describe, expect, it } from "vitest";

import { calculateRarity, rarityFormulaVersion } from "../lib/rarity/calculate.js";

const attributes = [
  { trait_type: "Type", value: "Unisheep" },
  { trait_type: "Color", value: "Red" }
];

describe("metadata rarity scores", () => {
  it("stores supplied raw and capped scores under a distinct formula version", () => {
    expect(
      calculateRarity("1", {
        attributes,
        rarity: "1.0528",
        rarityCapped: 1
      })
    ).toMatchObject({
      formulaVersion: rarityFormulaVersion,
      status: "valid",
      rarityPoints: 1.0528,
      rarityPointsCapped: 1
    });
  });

  it("uses the metadata trait score when the document has no top-level score", () => {
    expect(
      calculateRarity("2", {
        attributes: [...attributes, { trait_type: "Rarity Points", value: 12.5 }]
      })
    ).toMatchObject({ status: "valid", rarityPoints: 12.5 });
  });

  it("does not invent scores for missing or invalid metadata", () => {
    expect(calculateRarity("3", { attributes })).toMatchObject({
      status: "unscored",
      rarityPoints: null
    });
    expect(calculateRarity("3", { rarity: 2 })).toMatchObject({
      status: "missing_input",
      errorCode: "type_missing"
    });
    expect(calculateRarity("3", { attributes, rarity: "Infinity" })).toMatchObject({
      status: "invalid",
      errorCode: "invalid_supplied_score"
    });
  });

  it("ignores editorial fields when fingerprinting score inputs", () => {
    const original = calculateRarity("1", { attributes, rarity: 1 });
    const renamed = calculateRarity("1", {
      attributes,
      rarity: 1,
      name: "Renamed"
    });
    expect(renamed.inputFingerprint).toBe(original.inputFingerprint);
  });
});
