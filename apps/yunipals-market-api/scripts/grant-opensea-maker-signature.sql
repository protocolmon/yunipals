-- Verified maker-proof retention only. Combine with separately reviewed read and
-- queue grants for an enrichment worker; this does not grant provider/job writes.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_signature_role";
GRANT SELECT ON yunipals_market.orders,yunipals_market.opensea_discovered_order,
  yunipals_market.opensea_discovered_state,yunipals_market.opensea_maker_signature
  TO :"market_signature_role";
GRANT INSERT,UPDATE ON yunipals_market.opensea_maker_signature TO :"market_signature_role";
GRANT UPDATE(next_reconcile_at) ON yunipals_market.opensea_discovered_state TO :"market_signature_role";
COMMIT;
