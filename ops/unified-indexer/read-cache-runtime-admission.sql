BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'yunipals_backfill'
     OR (SELECT oid FROM pg_database WHERE datname=current_database()) <> 17584
     OR current_setting('port') <> '5432' THEN
    RAISE EXCEPTION 'exact_main_project_database_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_authid WHERE oid=73187673
      AND rolname='yunipals_unified_read_cache'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolinherit AND NOT rolbypassrls
      AND rolpassword IS NULL
  ) THEN
    RAISE EXCEPTION 'existing_passwordless_dormant_cache_role_required';
  END IF;
  IF 'metadata_projection.read_member'::regclass::oid <> 60365176
     OR 'metadata_projection.read_set'::regclass::oid <> 60365163 THEN
    RAISE EXCEPTION 'exact_existing_derived_cache_tables_required';
  END IF;
END $guard$;

GRANT INSERT, DELETE ON TABLE metadata_projection.read_member,
  metadata_projection.read_set TO yunipals_unified_read_cache;
ALTER ROLE yunipals_unified_read_cache LOGIN;

COMMIT;
