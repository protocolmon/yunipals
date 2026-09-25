-- Run in the single coordinator database as migration owner:
-- psql -v market_budget_role=yunipals_market_budget -f grant-opensea-budget.sql
-- This role receives no order, signature, indexer or budget-policy writes.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_budget_role";
GRANT SELECT ON yunipals_market.opensea_request_budget TO :"market_budget_role";
GRANT SELECT,UPDATE ON yunipals_market.opensea_request_budget_state TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_request_reservation TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_request_window TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_request_endpoint_window TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_request_metric_minute TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE ON yunipals_market.opensea_policy_observation TO :"market_budget_role";
GRANT SELECT ON yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation TO :"market_budget_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.rpc_compute_window,
  yunipals_market.rpc_compute_workload_window TO :"market_budget_role";
COMMIT;
