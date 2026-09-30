import { describe, expect, it } from "vitest";
import {
  calculateRarity,
  rarityFormulaVersion
} from "../lib/rarity/calculate.js";

const standardDocument = {
  id: "1",
  attributes: [
    { trait_type: "Type", value: "Unisheep" },
    { trait_type: "Horn", value: "Basic" },
    { trait_type: "Color", value: "Red" },
    { trait_type: "Background", value: "Grassland" },
    { trait_type: "Glitter", value: "None" }
  ]
};

describe("local rarity calculation", () => {
  it("uses the pinned legacy formula for raw and capped scores", () => {
    expect(calculateRarity("1", standardDocument)).toMatchObject({
      formulaVersion: rarityFormulaVersion,
      status: "valid",
      rarityPoints: 1.0528,
      rarityPointsCapped: 1.0528,
      errorCode: null
    });
  });

  it("preserves the historical cap independently from the raw score", () => {
    const calculated = calculateRarity("1000000000001", {
      id: "1000000000001",
      initialProbabilities: {
        type: 0.0001,
        horn: 0.0001,
        glitter: 0.0001,
        sound: 0.0001
      },
      attributes: [
        ...standardDocument.attributes,
        { trait_type: "Glitter", value: "Yes" },
        { trait_type: "Special", value: "Yes" },
        { trait_type: "Sound", value: "Test" }
      ]
    });
    expect(calculated.status).toBe("valid");
    expect(calculated.rarityPoints).toBeGreaterThan(40_000);
    expect(calculated.rarityPointsCapped).toBe(40_000);
  });

  it("distinguishes intentionally unscored NFTs from incomplete metadata", () => {
    expect(
      calculateRarity("42", {
        ...standardDocument,
        id: "42",
        attributes: standardDocument.attributes.map((attribute) =>
          attribute.trait_type === "Type"
            ? { ...attribute, value: "Mysterious Egg" }
            : attribute
        )
      }).status
    ).toBe("unscored");
    expect(calculateRarity("42", { message: "No polkamon found" })).toMatchObject({
      status: "missing_input",
      rarityPoints: null,
      rarityPointsCapped: null,
      errorCode: "type_missing"
    });
  });

  it("fingerprints only inputs that affect the formula", () => {
    const original = calculateRarity("1", standardDocument);
    const editorialChange = calculateRarity("1", {
      ...standardDocument,
      name: "Renamed",
      description: "Changed"
    });
    expect(editorialChange.inputFingerprint).toBe(original.inputFingerprint);
  });

  it("does not invent a rainbow score when its historical origin score is absent", () => {
    const rainbow = calculateRarity("1000004001856", {
      ...standardDocument,
      id: "1000004001856",
      attributes: standardDocument.attributes.map((attribute) =>
        attribute.trait_type === "Type"
          ? { ...attribute, value: "Rainbow Unisheep" }
          : attribute
      )
    });
    expect(rainbow).toMatchObject({
      status: "missing_input",
      errorCode: "rainbow_origin_score_missing"
    });
  });
});
