-- Use only after matching the actual owned admission receipt's schema/table
-- OIDs and stopping the owned booster API. The role must have zero sessions.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
SET LOCAL search_path=pg_catalog;
DO $inverse$
DECLARE r record;n record;expected text[]:=ARRAY[
  '_ponder_meta','_ponder_checkpoint','booster_checkpoint','booster_engine_state',
  'booster_type','booster_original','booster_request','booster_monster','booster_refund'];
BEGIN
  IF current_database()<>'yunipals_backfill'OR current_user<>'postgres'
    OR current_setting('port')<>'5432'OR inet_server_addr()IS NOT NULL
    THEN RAISE EXCEPTION 'fixed_primary_peer_context_required';END IF;
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname='yunipals_unified_collector';
  SELECT * INTO STRICT n FROM pg_namespace WHERE nspname='yunipals_boosters_launch_v1';
  IF n.oid<>74518314 -- FROZEN_NAMESPACE_OID
    OR (SELECT jsonb_object_agg(c.relname,c.oid::text)FROM pg_class c
      WHERE c.relnamespace=n.oid AND c.relname=ANY(expected)) IS DISTINCT FROM
      '{"_ponder_checkpoint":"74518322","_ponder_meta":"74518315","booster_checkpoint":"74518510","booster_engine_state":"74518480","booster_monster":"74518450","booster_original":"74518420","booster_refund":"74518465","booster_request":"74518435","booster_type":"74518405"}'::jsonb -- FROZEN_TABLE_OIDS
    THEN RAISE EXCEPTION 'actual_frozen_launch_source_OIDs_required';END IF;
  IF r.oid<>73187672 OR NOT r.rolcanlogin OR r.rolsuper OR r.rolinherit
    OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
    OR r.rolconnlimit<>6 OR r.rolvaliduntil IS NOT NULL OR n.nspowner<>73004621
    OR EXISTS(SELECT 1 FROM pg_authid WHERE oid=r.oid AND rolpassword IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=r.oid)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR NOT has_schema_privilege(r.oid,n.oid,'USAGE')
    THEN RAISE EXCEPTION 'stopped_owned_collector_admission_required';END IF;
END $inverse$;
REVOKE SELECT ON TABLE
  yunipals_boosters_launch_v1._ponder_meta,
  yunipals_boosters_launch_v1._ponder_checkpoint,
  yunipals_boosters_launch_v1.booster_checkpoint,
  yunipals_boosters_launch_v1.booster_engine_state,
  yunipals_boosters_launch_v1.booster_type,
  yunipals_boosters_launch_v1.booster_original,
  yunipals_boosters_launch_v1.booster_request,
  yunipals_boosters_launch_v1.booster_monster,
  yunipals_boosters_launch_v1.booster_refund
FROM yunipals_unified_collector;
REVOKE USAGE ON SCHEMA yunipals_boosters_launch_v1 FROM yunipals_unified_collector;
ALTER ROLE yunipals_unified_collector NOLOGIN;
COMMIT;
