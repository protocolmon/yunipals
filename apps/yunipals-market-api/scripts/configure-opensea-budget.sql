-- Migration owner only. Scope identifies the provider ACCOUNT, shared by all
-- keys and processes, including rotation and separate ingestion databases.
-- Supply budget_scope, coordinator_id, all_per_hour, fulfillment_per_minute, publication_per_hour
-- from reviewed provider allowance. No key is passed to psql or stored here.
-- Caps apply to rolling windows and may conservatively underuse token buckets.
BEGIN;
INSERT INTO yunipals_market.opensea_request_budget
  (scope,coordinator_id,all_per_hour,fulfillment_per_minute,publication_per_hour,enabled)
VALUES(:'budget_scope',:'coordinator_id'::uuid,:'all_per_hour'::integer,:'fulfillment_per_minute'::integer,:'publication_per_hour'::integer,true)
ON CONFLICT(scope) DO UPDATE SET all_per_hour=excluded.all_per_hour,
  fulfillment_per_minute=excluded.fulfillment_per_minute,publication_per_hour=excluded.publication_per_hour,enabled=true;
INSERT INTO yunipals_market.opensea_request_budget_state(scope) VALUES(:'budget_scope') ON CONFLICT DO NOTHING;
COMMIT;
