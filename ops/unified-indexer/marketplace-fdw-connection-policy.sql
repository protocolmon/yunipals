-- Release idle source connections without changing the role's connection cap.
-- Existing transactions retain their remote snapshot until commit or rollback.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = pg_catalog;

DO $policy$
DECLARE
  options text[];
BEGIN
  IF current_database() <> 'yunipals_market_production'
    OR current_setting('port') <> '15438' THEN
    RAISE EXCEPTION 'marketplace_connection_policy_database_mismatch';
  END IF;
  SELECT srvoptions INTO options FROM pg_foreign_server
    WHERE srvname = 'yunipals_production_indexer';
  IF options IS NULL OR NOT options @> ARRAY[
    'host=127.0.0.1', 'port=5432', 'dbname=yunipals_backfill',
    'updatable=false', 'truncatable=false'
  ] THEN
    RAISE EXCEPTION 'marketplace_connection_policy_source_mismatch';
  END IF;
  IF options @> ARRAY['keep_connections=false'] THEN
    RETURN;
  ELSIF EXISTS (
    SELECT FROM pg_options_to_table(options) WHERE option_name = 'keep_connections'
  ) THEN
    ALTER SERVER yunipals_production_indexer OPTIONS (SET keep_connections 'false');
  ELSE
    ALTER SERVER yunipals_production_indexer OPTIONS (ADD keep_connections 'false');
  END IF;
END
$policy$;
COMMIT;
