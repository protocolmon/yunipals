-- One read needed for actual NFT mint timestamps. No row, login or write changes.
-- Rehearsal: execute these exact bytes with only COMMIT changed to ROLLBACK.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
DO $guard$
BEGIN
  IF current_database() <> 'yunipals_backfill'
    OR (SELECT oid FROM pg_roles WHERE rolname = 'yunipals_unified_collector') <> 73187672
    OR (SELECT oid FROM pg_namespace WHERE nspname = 'yunipals_boosters_launch_v1') <> 74518314
    OR (SELECT 'yunipals_boosters_launch_v1.booster_event'::regclass::oid) <> 74518495
    OR (SELECT relowner FROM pg_class WHERE oid = 74518495) <> 73004621
    OR NOT has_schema_privilege('yunipals_unified_collector', 'yunipals_boosters_launch_v1', 'USAGE')
    OR has_table_privilege('yunipals_unified_collector', 74518495, 'SELECT')
    OR has_table_privilege('yunipals_unified_collector', 74518495, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  THEN
    RAISE EXCEPTION 'Exact existing API role and unread mint journal required';
  END IF;
END
$guard$;
GRANT SELECT ON TABLE yunipals_boosters_launch_v1.booster_event TO yunipals_unified_collector;
DO $postcheck$
BEGIN
  IF NOT has_table_privilege('yunipals_unified_collector', 74518495, 'SELECT')
    OR has_table_privilege('yunipals_unified_collector', 74518495, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  THEN
    RAISE EXCEPTION 'Read-only journal postcheck failed';
  END IF;
END
$postcheck$;
SELECT json_build_object(
  'format', 'yunipals-booster-birth-journal-read-v1',
  'database', current_database(),
  'roleOid', '73187672',
  'schemaOid', '74518314',
  'tableOid', '74518495',
  'select', has_table_privilege('yunipals_unified_collector', 74518495, 'SELECT'),
  'writes', has_table_privilege('yunipals_unified_collector', 74518495, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'roleOrLoginChanges', 0,
  'rowChanges', 0
);
COMMIT;
