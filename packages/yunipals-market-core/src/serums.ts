/** Launch rules, shared by quotes, metadata and the collection UI. Weights are ppm per adventure. */
export const serumCatalogueVersion = 1;
export const serumFee = 100_000n;
export const maxLocalDoses = 11;
export const serumEssences = [
  "Bloom",
  "Ember",
  "Tidal",
  "Frost",
  "Storm",
  "Crystal",
  "Solar",
  "Starlight",
  "Dreadthorn",
  "Bloodmoon",
  "Voidheart"
] as const;
export const serumForms = [
  "Veil",
  "Runes",
  "Hide",
  "Crest",
  "Fangs",
  "Talons",
  "Spines",
  "Wings",
  "Wraith",
  "Sovereign",
  "Avatar"
] as const;
export const serumPresences = [
  "Neutral",
  "Holy",
  "Aggressive",
  "Calm",
  "Chill",
  "Happy",
  "Panicked",
  "Mischievous",
  "Proud",
  "Curious",
  "Melancholic",
  "Sinister"
] as const;
export const serumRarities = [
  "Common",
  "Uncommon",
  "Rare",
  "Epic",
  "Legendary",
  "Mythic"
] as const;
export const presenceWeights = [
  10_000,
  ...Array<number>(10).fill(99_000)
] as const;
export type SerumDose = {
  catalogueVersion: number;
  serumId: number;
  presenceId: number;
};
const minimumRarity = [0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5];
export const serumCatalogue = serumEssences.flatMap((essence, e) =>
  serumForms.map((form, f) => ({
    id: e * 11 + f + 1,
    essence,
    form,
    name: `${essence} ${form} Serum`,
    rarity: serumRarities[Math.max(minimumRarity[e], minimumRarity[f])]
  }))
);
export function serumDefinition(dose: SerumDose) {
  if (
    dose.catalogueVersion !== serumCatalogueVersion ||
    !Number.isInteger(dose.serumId) ||
    dose.serumId < 1 ||
    dose.serumId > 121 ||
    !Number.isInteger(dose.presenceId) ||
    dose.presenceId < 1 ||
    dose.presenceId > 11
  )
    throw new Error("Unsupported serum.");
  return {
    ...serumCatalogue[dose.serumId - 1],
    presence: serumPresences[dose.presenceId]
  };
}
export function adventureOdds(sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 263)
    throw new Error("Invalid source sequence.");
  const tier = Math.floor(sequence / 24);
  return {
    tier: tier + 1,
    min: tier * 24,
    max: tier * 24 + 23,
    weights: [
      350000,
      400000 - 15000 * tier,
      180000 + 6000 * tier,
      60000 + 6000 * tier,
      9000 + 2600 * tier,
      900 + 360 * tier,
      100 + 40 * tier
    ]
  };
}
export type EvolutionSource = {
  tokenId: string;
  originalTokenId: string;
  sequence: number;
  isOriginal: boolean;
  packTypeId: string;
  variantId: number;
  monsterType: number;
  color: number;
  horn: number;
  glitter: number;
};
export type EvolutionCard = {
  tokenId: string;
  level: 0 | 1 | 2;
  sources: EvolutionSource[];
  artVersion: string;
  historyHash: `0x${string}`;
  localDoses: number;
  presence: number;
  doses: SerumDose[];
  parents: string[];
  nextAdventureAt: number;
  unused: SerumDose | null;
  pendingAdventure: string | null;
  pendingEvolution: string | null;
  artwork: { uri: string; hash: `0x${string}` } | null;
  metadataURI: string | null;
};
export function effectiveSequence(sources: readonly EvolutionSource[]) {
  if (
    ![1, 2, 4].includes(sources.length) ||
    new Set(sources.map((s) => s.tokenId)).size !== sources.length
  )
    throw new Error("Invalid fusion ancestry.");
  for (const source of sources) adventureOdds(source.sequence);
  return Math.floor(
    sources.reduce((sum, source) => sum + source.sequence, 0) / sources.length
  );
}
export function fusionCompatible(
  a: Pick<EvolutionCard, "tokenId" | "level" | "sources">,
  b: Pick<EvolutionCard, "tokenId" | "level" | "sources">
) {
  if (a.tokenId === b.tokenId || a.level !== b.level || a.level === 2)
    return false;
  if (a.level === 0)
    return (
      a.sources[0].originalTokenId === b.sources[0].originalTokenId &&
      Math.abs(a.sources[0].sequence - b.sources[0].sequence) === 1
    );
  return a.sources[0].originalTokenId !== b.sources[0].originalTokenId;
}
export function fusionPresenceOdds(a: number, b: number) {
  if (![a, b].every((p) => Number.isInteger(p) && p >= 0 && p <= 11))
    throw new Error("Invalid Presence.");
  return a === b
    ? [{ presence: a, percent: 100 }]
    : [
        { presence: a, percent: 50 },
        { presence: b, percent: 50 }
      ];
}
