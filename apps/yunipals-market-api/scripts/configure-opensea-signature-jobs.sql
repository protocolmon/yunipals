-- One-time queue access policy installation, as table owner. Existing table
-- grants keep their behavior; the dedicated signature role is restricted even
-- when another permissive policy would otherwise allow a row.
-- A partial/existing policy installation requires inspection, not blind replay.
BEGIN;
SET LOCAL lock_timeout='1500ms';
SET LOCAL statement_timeout='10000ms';
LOCK TABLE yunipals_market.job IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='yunipals_market.job'::regclass)
    OR (SELECT relrowsecurity FROM pg_class WHERE oid='yunipals_market.job'::regclass)
  THEN RAISE EXCEPTION 'Inspect existing job row security before configuration'; END IF;
END $$;
CREATE POLICY job_existing_table_access ON yunipals_market.job
  AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY job_signature_scope ON yunipals_market.job
  AS RESTRICTIVE FOR ALL TO :"market_signature_role"
  USING (kind='opensea_signature_enrichment')
  WITH CHECK (kind='opensea_signature_enrichment');
ALTER TABLE yunipals_market.job ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON yunipals_market.job TO :"market_signature_role";
COMMIT;
