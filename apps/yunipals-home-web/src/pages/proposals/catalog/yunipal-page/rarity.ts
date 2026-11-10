/**
 * The eight rarity levels, highest first. Level 8 is the top. The card draws
 * the level as a line under the rarity points.
 */
export const RARITY_TIERS = [
  { level: 8, range: "1,000,000+", min: 1_000_000, sample: 3_373_975 },
  { level: 7, range: "250,000 – 1,000,000", min: 250_000, sample: 812_440 },
  { level: 6, range: "100,000 – 250,000", min: 100_000, sample: 180_250 },
  { level: 5, range: "30,000 – 100,000", min: 30_000, sample: 54_120 },
  { level: 4, range: "5,000 – 30,000", min: 5_000, sample: 12_500 },
  { level: 3, range: "1,000 – 5,000", min: 1_000, sample: 2_410 },
  { level: 2, range: "200 – 1,000", min: 200, sample: 640 },
  { level: 1, range: "Under 200", min: 0, sample: 40.625 }
] as const;

export type RarityLevel = (typeof RARITY_TIERS)[number]["level"];

/** The level for a number of rarity points. */
export function rarityLevel(points: number): RarityLevel {
  return (
    RARITY_TIERS.find((tier) => points >= tier.min) ??
    RARITY_TIERS[RARITY_TIERS.length - 1]
  ).level;
}
