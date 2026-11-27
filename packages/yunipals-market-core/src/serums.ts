import { encodeAbiParameters, keccak256, stringToHex } from "viem";

/** Launch rules, shared by quotes, metadata and the collection UI. Weights are ppm per adventure. */
export const serumCatalogueVersion = 1;
export const serumFee = 100_000n;
export const sponsoredSerumLimit = 1000;
export const sponsoredFusionLimit = 1000;
export const maxLocalDoses = 11;
/** Zero means no finish has been assigned yet, not Normal. */
export const cardFinishes = [
  "Unassigned",
  "Normal",
  "Golden",
  "Black"
] as const;
export const finishOdds = [
  { finish: 1, percent: 70 },
  { finish: 2, percent: 25 },
  { finish: 3, percent: 5 }
] as const;
export const finishDirections = [
  "Unassigned: preserve the existing card material.",
  "Normal: pearlescent card frame, purple lettering and the colored Yunipals mascot logo. Standard border width.",
  "Golden: realistic polished gold frame at the standard border width, integrated embossed gold lettering and gold mascot medallion. No thicker border, geometric patterns or filigree.",
  "Black: genuinely dark illustration and deep black frame, legible gunmetal lettering and black chrome mascot. Preserve glowing creature details and the settled Presence, including Holy. This is a material finish, not an evil transformation."
] as const;
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
  /** Unix seconds. Absent on older API responses; never infer a mint day. */
  mintedAt?: number;
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
  /** 3 is the terminal Singularity kind, not a third recursive fusion. */
  level: 0 | 1 | 2 | 3;
  sources: EvolutionSource[];
  artVersion: string;
  historyHash: `0x${string}`;
  localDoses: number;
  presence: number;
  finish: number;
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
export type FusionCandidate = Pick<
  EvolutionCard,
  "tokenId" | "level" | "sources"
>;
export function singularityCompatible(a: FusionCandidate, b: FusionCandidate) {
  if (
    a.tokenId === b.tokenId ||
    a.level !== 0 ||
    b.level !== 0 ||
    a.sources.length !== 1 ||
    b.sources.length !== 1
  )
    return false;
  const x = a.sources[0],
    y = b.sources[0];
  return (
    x.tokenId !== y.tokenId &&
    x.originalTokenId !== y.originalTokenId &&
    [x.mintedAt, y.mintedAt].every((t) => Number.isSafeInteger(t) && t! > 0) &&
    Math.floor(x.mintedAt! / 86400) === Math.floor(y.mintedAt! / 86400) &&
    x.sequence === y.sequence &&
    x.sequence >= 0 &&
    x.sequence < 264 &&
    x.packTypeId === y.packTypeId &&
    x.monsterType === y.monsterType &&
    x.color === y.color &&
    x.horn === y.horn &&
    x.glitter === y.glitter
  );
}
export function fusionCompatible(a: FusionCandidate, b: FusionCandidate) {
  if (a.tokenId === b.tokenId || a.level !== b.level || a.level >= 2)
    return false;
  if (a.level === 0)
    return (
      singularityCompatible(a, b) ||
      (a.sources[0].originalTokenId === b.sources[0].originalTokenId &&
        Math.abs(a.sources[0].sequence - b.sources[0].sequence) === 1)
    );
  return a.sources[0].originalTokenId !== b.sources[0].originalTokenId;
}
export function evolutionKind(level: number) {
  return level === 3 ? "Singularity" : level ? `Fusion ${level}` : "Yunipal";
}
/** Supplemental art direction pinned by the collection implementation. Legacy rendering policy stays unchanged. */
export const singularityArtDirection =
  "Singularity v2: Render two identical Yunipal counterparts colliding from different multiverse dimensions and melting into one extraordinarily warped, coherent creature. Preserve recognizable birth identity, expressive face and the premium soft sculpted 3D Yunipals style. Make structural deformation the defining feature, immediately visible at thumbnail size: roughly half the creature is dramatically melting, stretching, folding and reconstituting across dimensions. Twist the torso and neck into flowing curves; pull substantial sections of its own material into thick liquid ribbons and rounded suspended droplets. Open luminous negative-space gaps between stretched sections, revealing the other universe, and visibly reconnect the anatomy across spatial discontinuities. Where present, liquefy a wing into broad curling sheets, fold the other through an impossible loop, bend the horn and dissolve the tail into reconnecting arcs. Adapt these transformations to the actual species and inherited features; do not invent dragon anatomy for other species. Integrate partial dimensional echoes into the head and shoulders without adding a separate creature. Give the deformed surfaces tangible rounded volume, coherent reflections and prismatic interiors that retain the source colors and materials. Bend both environments in large curved sheets toward the same convergence point with gravitational lensing and impossible depth. Prioritize the warped creature silhouette and a clear focal face over particle clutter; an intact ordinary body surrounded by energy trails is insufficient. For Singularity, deliberately deform the creature silhouette despite the generic silhouette-preservation rule; retain standard card-border dimensions, nameplates, logo and assigned finish. Preserve both parents' ordered physical serum effects and settled Presence within the transformed anatomy. Subsequent serums and portal spells must preserve this intense structural melting, warping, dimensional seam, echoes and converging environments while adding their own effects, never restoring an ordinary intact silhouette. Render wondrous magical transformation without injury, gore or exposed organs. No split screen, collage, separate second creature, bottles or extra text. This identity grants no grading bonus.";
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

export type CrewSelection = { tokenIds: [string, string, string]; day: number };
export type DailyCrewRequirements = {
  day: number;
  color: number;
  monsterType: number;
};
export const crewRulesHash = keccak256(
  encodeAbiParameters(
    [{ type: "bytes32" }, { type: "string" }],
    [
      keccak256(
        stringToHex("YunipalsSerumsV1:11x11:11tiers24:holy10000:ordered11")
      ),
      "crew-v1:three-distinct:utc-birth:guaranteed"
    ]
  )
);
export function crewSlotMatches(
  card: FusionCandidate,
  slot: number,
  rules: DailyCrewRequirements
) {
  return card.sources.some((s) =>
    slot === 0
      ? s.color === rules.color
      : slot === 1
        ? s.horn === 2
        : slot === 2 && s.monsterType === rules.monsterType
  );
}
export function isCrewNewborn(card: FusionCandidate, day: number) {
  return (
    card.level === 0 &&
    card.sources.length === 1 &&
    Number.isSafeInteger(card.sources[0].mintedAt) &&
    card.sources[0].mintedAt! > 0 &&
    Math.floor(card.sources[0].mintedAt! / 86400) === day
  );
}
export function crewEligibility(
  cards: readonly FusionCandidate[],
  rules: DailyCrewRequirements
): string | null {
  if (cards.length !== 3 || new Set(cards.map((c) => c.tokenId)).size !== 3)
    return "Choose three different monsters.";
  if (!cards.every((card, slot) => crewSlotMatches(card, slot, rules)))
    return "Each monster must match its assigned crew slot.";
  if (!cards.some((card) => isCrewNewborn(card, rules.day)))
    return "At least one crew member must have been born today (UTC).";
  return null;
}
export function crewAdventureOdds(sequence: number) {
  const odds = adventureOdds(sequence);
  const total = odds.weights.slice(1).reduce((sum, value) => sum + value, 0);
  return {
    ...odds,
    weights: odds.weights.map((w, index) =>
      index === 0 ? 0 : (w * 1_000_000) / total
    )
  };
}
