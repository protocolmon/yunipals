-- Run as the existing indexer relation owner with psql -v market_runtime_role=...
-- These are the exact read relations inspected on the deployed indexer.
-- A staging database must supply isolated equivalents before using this grant.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_read_v4,yunipals_indexer_v3,metadata,bnb_indexer TO :"market_runtime_role";
GRANT SELECT ON yunipals_read_v4.token,yunipals_read_v4.transfer_event,
  metadata.token_visibility,metadata.token_metadata,metadata.token_search,metadata.token_trait,
  metadata.market_catalog_attribute,metadata.market_catalog_trait,
  bnb_indexer.sync_state,yunipals_indexer_v3.token,bnb_indexer.token TO :"market_runtime_role";
COMMIT;
