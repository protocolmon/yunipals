import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";

export type BoosterCatalog = {
  types: number[];
  colors: number[];
  horns: number[];
  glitters: number[];
  allowed: number[];
};

export function validateBoosterCatalog(catalog: BoosterCatalog): {
  totalVariants: number;
  catalogHash: `0x${string}`;
} {
  const categories = [
    catalog.types,
    catalog.colors,
    catalog.horns,
    catalog.glitters
  ];
  for (const values of categories) {
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 256 ||
      values.some(
        (value, index) =>
          !Number.isInteger(value) ||
          value < 0 ||
          value > 0xffffffff ||
          (index > 0 && value <= values[index - 1])
      )
    )
      throw new Error(
        "Each category needs 1–256 sorted, unique uint32 trait IDs."
      );
  }
  const product = categories.reduce(
    (count, values) => count * values.length,
    1
  );
  if (product > 0xffffffff)
    throw new Error("The catalog exceeds uint32 variant capacity.");
  if (!Array.isArray(catalog.allowed) || catalog.allowed.length > 4096)
    throw new Error("An allowed subset can have at most 4096 ranks.");
  if (catalog.allowed.length) {
    const counts = categories.map((values) => values.map(() => 0));
    catalog.allowed.forEach((value, index) => {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value >= product ||
        (index > 0 && value <= catalog.allowed[index - 1])
      )
        throw new Error(
          "Allowed variant ranks must be sorted, unique, and within the Cartesian product."
        );
      let rank = value;
      for (let category = 3; category >= 0; category--) {
        counts[category][rank % categories[category].length]++;
        rank = Math.floor(rank / categories[category].length);
      }
    });
    if (counts.some((values) => values.some((value) => value !== values[0])))
      throw new Error(
        "The allowed subset must give every value in each category equal probability."
      );
  }
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "(uint32[] types, uint32[] colors, uint32[] horns, uint32[] glitters, uint32[] allowed)"
    ),
    [catalog]
  );
  return {
    totalVariants: catalog.allowed.length || product,
    catalogHash: keccak256(encoded)
  };
}
