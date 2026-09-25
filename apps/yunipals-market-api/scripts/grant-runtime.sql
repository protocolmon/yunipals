-- Run with psql as the migration owner: -v market_runtime_role=yunipals_market_runtime.
-- Create the separate LOGIN role and its credential out of band; never give it
-- membership in the migration owner. This file intentionally grants no indexer writes.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA yunipals_market TO :"market_runtime_role";
GRANT INSERT,UPDATE,DELETE ON
  yunipals_market.preparation, yunipals_market.orders,
  yunipals_market.submission_attempt, yunipals_market.job,
  yunipals_market.checkpoint, yunipals_market.sale,
  yunipals_market.activity_block, yunipals_market.sale_receipt, yunipals_market.sale_exclusion,
  yunipals_market.snapshot, yunipals_market.snapshot_item,
  yunipals_market.opensea_discovery_scan, yunipals_market.opensea_discovery_page,
  yunipals_market.opensea_discovered_order, yunipals_market.opensea_discovered_state,
  yunipals_market.opensea_maker_signature,
  yunipals_market.bnb_discovery_cursor, yunipals_market.bnb_discovered_order
  TO :"market_runtime_role";
COMMIT;
