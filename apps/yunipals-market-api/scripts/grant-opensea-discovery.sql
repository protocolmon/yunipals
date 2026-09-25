-- Discovery can mutate provider observations only. It cannot admit orders,
-- alter signatures retained by the trading API, or modify indexer relations.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.collection,yunipals_market.schema_migration,yunipals_market.deployment,
  yunipals_market.opensea_discovery_scan,yunipals_market.opensea_discovery_page,
  yunipals_market.opensea_discovered_order,yunipals_market.opensea_stream_wakeup TO :"market_runtime_role";
GRANT INSERT,UPDATE,DELETE ON yunipals_market.opensea_discovery_scan,
  yunipals_market.opensea_discovery_page,yunipals_market.opensea_discovered_order TO :"market_runtime_role";
COMMIT;
