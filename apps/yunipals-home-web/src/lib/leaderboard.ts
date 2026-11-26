import type {
  LeaderboardEntry,
  LeaderboardMetric,
  OwnerLeaderboard
} from "@/lib/yunipalsIndexer";

export function ownerLeaderboardEntry(
  owner: OwnerLeaderboard,
  metric: LeaderboardMetric
): LeaderboardEntry {
  const values: Record<LeaderboardMetric, [number, string]> = {
    "collector-score": [owner.collectorScoreRank, owner.collectorScore],
    "total-rarity": [owner.totalRarityRank, owner.totalRarity],
    "monster-count": [owner.monsterCountRank, String(owner.monsterCount)],
    "unique-types": [owner.uniqueTypesRank, String(owner.uniqueTypes)],
    "special-count": [owner.specialCountRank, String(owner.specialCount)],
    "glitter-count": [owner.glitterCountRank, String(owner.glitterCount)]
  };
  const [rank, score] = values[metric];
  return { ...owner, rank, score };
}
