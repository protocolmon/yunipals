-- Optional catalog fallback when MARKET_INDEXER_DATABASE_URL is not configured.
-- Run in the marketplace database after the source schema is installed.
-- Required psql variables: indexer_server (existing postgres_fdw server),
-- market_runtime_role (the marketplace application role).
BEGIN;
CREATE SCHEMA IF NOT EXISTS metadata_projection;
CREATE FOREIGN TABLE IF NOT EXISTS metadata_projection.active (
  singleton boolean, current_id bigint, previous_id bigint, updated_at timestamptz
) SERVER :"indexer_server" OPTIONS (schema_name 'metadata_projection', table_name 'active');
CREATE FOREIGN TABLE IF NOT EXISTS metadata_projection.search (
  generation_id bigint, collection text, token_id numeric(78,0), lifecycle integer,
  metadata_available boolean, rarity_points numeric, rarity_points_capped numeric,
  updated_at timestamptz
) SERVER :"indexer_server" OPTIONS (schema_name 'metadata_projection', table_name 'search');
GRANT USAGE ON SCHEMA metadata_projection TO :"market_runtime_role";
GRANT SELECT ON metadata_projection.active,metadata_projection.search TO :"market_runtime_role";
COMMIT;
