-- Run separately from a transaction and before enabling collector filters.
-- Uses the existing current-lifecycle PKs and owner/trait indexes for the
-- remaining predicates. Does not alter Ponder-managed table definitions.
CREATE INDEX CONCURRENTLY IF NOT EXISTS token_metadata_name_prefix_idx
  ON metadata.token_metadata(collection, lower(name) text_pattern_ops, token_id, lifecycle);

ANALYZE metadata.token_metadata;
