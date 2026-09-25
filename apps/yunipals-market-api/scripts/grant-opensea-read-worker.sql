-- A read worker changes projections and health only; it cannot publish orders,
-- replace discovery, retain signatures, or modify source indexer data.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market,yunipals_read_v4,yunipals_indexer_v3,metadata TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.collection,yunipals_market.schema_migration,yunipals_market.deployment,
  yunipals_market.orders,yunipals_market.opensea_discovered_order,yunipals_market.opensea_discovered_state,
  yunipals_market.opensea_maker_signature,yunipals_market.opensea_discovery_scan,
  yunipals_market.opensea_discovery_page,yunipals_market.opensea_stream_wakeup,
  yunipals_market.checkpoint TO :"market_runtime_role";
GRANT INSERT,UPDATE ON yunipals_market.opensea_discovered_state,yunipals_market.checkpoint TO :"market_runtime_role";
GRANT SELECT ON yunipals_read_v4.token,yunipals_read_v4.token_lifecycle,yunipals_read_v4.transfer_event,
  yunipals_indexer_v3._ponder_checkpoint,yunipals_indexer_v3._ponder_meta,metadata.token_visibility TO :"market_runtime_role";
COMMIT;
