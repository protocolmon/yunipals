-- Apply to a fresh, non-inheriting login with no other memberships/grants.
-- Collection replay needs neither provider credentials nor indexer access.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_market TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.collection,yunipals_market.schema_migration,
  yunipals_market.deployment,yunipals_market.sale_replay_config,
  yunipals_market.checkpoint,yunipals_market.sale,yunipals_market.sale_receipt,
  yunipals_market.sale_exclusion,yunipals_market.activity_block,
  yunipals_market.snapshot TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.shared_indexer_consumer,
  yunipals_market.sale_receipt_qualification TO :"market_runtime_role";
GRANT SELECT ON yunipals_market.marketplace_legacy_selection,
  yunipals_market.legacy_sale_receipt_qualification TO :"market_runtime_role";
GRANT INSERT,UPDATE ON yunipals_market.legacy_sale_receipt_qualification TO :"market_runtime_role";
GRANT UPDATE(cursor,generation,updated_at) ON yunipals_market.shared_indexer_consumer TO :"market_runtime_role";
GRANT INSERT,UPDATE ON yunipals_market.sale_receipt_qualification TO :"market_runtime_role";
GRANT UPDATE ON yunipals_market.checkpoint,yunipals_market.snapshot TO :"market_runtime_role";
GRANT INSERT,UPDATE ON yunipals_market.sale,yunipals_market.sale_receipt,
  yunipals_market.sale_exclusion TO :"market_runtime_role";
GRANT UPDATE(next_reconcile_at) ON yunipals_market.orders,
  yunipals_market.opensea_discovered_state TO :"market_runtime_role";
GRANT SELECT(chain_id,protocol_address,order_hash,next_reconcile_at)
  ON yunipals_market.orders,yunipals_market.opensea_discovered_state TO :"market_runtime_role";
GRANT INSERT,UPDATE,DELETE ON yunipals_market.activity_block TO :"market_runtime_role";
COMMIT;
