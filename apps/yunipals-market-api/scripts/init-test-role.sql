-- Disposable local fixture only. Run after db:migrate, as market_test_owner.
DO $$ BEGIN
  IF current_database()<>'yunipals_market_test' OR current_user<>'market_test_owner' THEN
    RAISE EXCEPTION 'This fixture requires the isolated marketplace test database and owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='market_test_runtime') THEN
    CREATE ROLE market_test_runtime LOGIN PASSWORD 'local-runtime-test-only';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS indexer_guard;
CREATE TABLE IF NOT EXISTS indexer_guard.token(id integer PRIMARY KEY);
GRANT USAGE ON SCHEMA indexer_guard TO market_test_runtime;
GRANT SELECT ON indexer_guard.token TO market_test_runtime;
