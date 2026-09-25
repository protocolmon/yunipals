-- The stream role can persist advisory notices and wakeups only. It cannot
-- admit, publish, reconcile or settle an order, and cannot alter source data.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.collection,yunipals_market.schema_migration,
  yunipals_market.deployment,yunipals_market.opensea_stream_state,
  yunipals_market.opensea_stream_notice,yunipals_market.opensea_stream_wakeup
  TO :"market_runtime_role";
GRANT UPDATE ON yunipals_market.opensea_stream_state TO :"market_runtime_role";
GRANT INSERT,DELETE ON yunipals_market.opensea_stream_notice TO :"market_runtime_role";
GRANT INSERT,UPDATE,DELETE ON yunipals_market.opensea_stream_wakeup TO :"market_runtime_role";
COMMIT;
