// Shared by normal startup and cold recovery; these indexes support bounded rarity pages.
export const performanceIndexes = [
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_rarity_desc_idx
      ON metadata.token_search(collection, rarity_points DESC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_rarity_asc_idx
      ON metadata.token_search(collection, rarity_points ASC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_rarity_desc_idx
      ON metadata.token_search(rarity_points DESC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_rarity_asc_idx
      ON metadata.token_search(rarity_points ASC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_capped_rarity_desc_idx
      ON metadata.token_search(collection, rarity_points_capped DESC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_collection_capped_rarity_asc_idx
      ON metadata.token_search(collection, rarity_points_capped ASC NULLS LAST, token_id, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_capped_rarity_desc_idx
      ON metadata.token_search(rarity_points_capped DESC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS token_search_available_capped_rarity_asc_idx
      ON metadata.token_search(rarity_points_capped ASC NULLS LAST, token_id, collection, lifecycle)
      WHERE metadata_available`
  ];
