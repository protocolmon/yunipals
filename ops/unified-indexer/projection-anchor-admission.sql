BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'yunipals_backfill'
     OR (SELECT oid FROM pg_database WHERE datname = current_database()) <> 17584
     OR current_setting('port') <> '5432' THEN
    RAISE EXCEPTION 'exact_main_project_database_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = 16388 AND rolname = 'yunipals'
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'existing_metadata_publisher_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'yunipals_indexer_control'
      AND c.relname = 'chain_anchor' AND c.relkind = 'r'
  ) THEN
    RAISE EXCEPTION 'existing_canonical_header_cache_required';
  END IF;
END $guard$;

GRANT SELECT, INSERT, UPDATE
ON TABLE yunipals_indexer_control.chain_anchor TO yunipals;

COMMIT;
