-- Apply on the indexer after projection:migrate, using the same read-only
-- MARKET_INDEXER_DATABASE_URL role as grant-indexer-read.sql.
-- Required psql variable: market_runtime_role.
BEGIN;
GRANT USAGE ON SCHEMA metadata_projection TO :"market_runtime_role";
GRANT SELECT ON metadata_projection.active,metadata_projection.search TO :"market_runtime_role";
COMMIT;
