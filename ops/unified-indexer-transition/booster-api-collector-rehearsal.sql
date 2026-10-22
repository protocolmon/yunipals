-- Owner executes via existing postgres Unix peer on yunipals_backfill:5432.
-- Run only after the source owner has created and pinned this normal Ponder
-- schema. Capture stdout/catalog as the owned receipt. Default is ROLLBACK.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
SET LOCAL search_path=pg_catalog;
DO $admit$
DECLARE r record; n record; ids oid[]; expected text[]:=ARRAY[
  '_ponder_meta','_ponder_checkpoint','booster_checkpoint','booster_engine_state',
  'booster_type','booster_original','booster_request','booster_monster','booster_refund'];
BEGIN
  IF current_database()<>'yunipals_backfill' OR current_user<>'postgres'
    OR current_setting('port')<>'5432' OR inet_server_addr()IS NOT NULL
    OR current_setting('data_directory')<>'/var/lib/postgresql/16/main'
    THEN RAISE EXCEPTION 'fixed_primary_peer_context_required'; END IF;
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname='yunipals_unified_collector';
  IF r.oid<>73187672 OR r.rolcanlogin OR r.rolsuper OR r.rolinherit
    OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
    OR r.rolconnlimit<>6 OR r.rolvaliduntil IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_authid WHERE oid=r.oid AND rolpassword IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid=r.oid)
    THEN RAISE EXCEPTION 'fixed_dormant_collector_role_required'; END IF;
  -- The actual first matching local HBA rule for this role/database is peer.
  -- Preserve the complete observed ordering; no HBA/ident modification occurs.
  IF (SELECT jsonb_agg(jsonb_build_object('line',line_number,'type',type,'database',database,
      'users',user_name,'auth',auth_method,'options',options,'error',error)ORDER BY rule_number)
      FROM pg_hba_file_rules WHERE type='local') IS DISTINCT FROM
      '[{"auth":"peer","line":118,"type":"local","error":null,"users":["postgres"],"options":null,"database":["all"]},{"auth":"peer","line":123,"type":"local","error":null,"users":["all"],"options":null,"database":["all"]},{"auth":"peer","line":130,"type":"local","error":null,"users":["all"],"options":null,"database":["replication"]}]'::jsonb
    THEN RAISE EXCEPTION 'observed_local_peer_hba_changed'; END IF;
  SELECT * INTO STRICT n FROM pg_namespace WHERE nspname='yunipals_boosters_launch_v1';
  IF n.oid<>74518314 -- FROZEN_NAMESPACE_OID
    OR (SELECT jsonb_object_agg(c.relname,c.oid::text)FROM pg_class c
      WHERE c.relnamespace=n.oid AND c.relname=ANY(expected)) IS DISTINCT FROM
      '{"_ponder_checkpoint":"74518322","_ponder_meta":"74518315","booster_checkpoint":"74518510","booster_engine_state":"74518480","booster_monster":"74518450","booster_original":"74518420","booster_refund":"74518465","booster_request":"74518435","booster_type":"74518405"}'::jsonb -- FROZEN_TABLE_OIDS
    THEN RAISE EXCEPTION 'actual_frozen_launch_source_OIDs_required';END IF;
  IF n.nspowner<>73004621 OR has_schema_privilege(r.oid,n.oid,'USAGE')
    OR has_schema_privilege(r.oid,n.oid,'CREATE')
    THEN RAISE EXCEPTION 'fresh_source_owned_launch_schema_required'; END IF;
  SELECT array_agg(c.oid ORDER BY c.relname)INTO ids FROM pg_class c
    WHERE c.relnamespace=n.oid AND c.relname=ANY(expected)
      AND c.relkind='r' AND c.relowner=73004621;
  IF coalesce(cardinality(ids),0)<>9 OR EXISTS(SELECT 1 FROM unnest(ids)i
    WHERE has_table_privilege(r.oid,i,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
    THEN RAISE EXCEPTION 'exact_nine_unadmitted_source_tables_required'; END IF;
END $admit$;
SELECT jsonb_build_object('phase','before','roleOid',73187672,'schemaOid',n.oid,
  'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid,'owner',c.relowner,'acl',c.relacl::text)ORDER BY c.relname)
    FROM pg_class c WHERE c.relnamespace=n.oid AND c.relname=ANY(ARRAY[
    '_ponder_meta','_ponder_checkpoint','booster_checkpoint','booster_engine_state',
    'booster_type','booster_original','booster_request','booster_monster','booster_refund'])))
FROM pg_namespace n WHERE n.nspname='yunipals_boosters_launch_v1';
GRANT USAGE ON SCHEMA yunipals_boosters_launch_v1 TO yunipals_unified_collector;
GRANT SELECT ON TABLE
  yunipals_boosters_launch_v1._ponder_meta,
  yunipals_boosters_launch_v1._ponder_checkpoint,
  yunipals_boosters_launch_v1.booster_checkpoint,
  yunipals_boosters_launch_v1.booster_engine_state,
  yunipals_boosters_launch_v1.booster_type,
  yunipals_boosters_launch_v1.booster_original,
  yunipals_boosters_launch_v1.booster_request,
  yunipals_boosters_launch_v1.booster_monster,
  yunipals_boosters_launch_v1.booster_refund
TO yunipals_unified_collector;
ALTER ROLE yunipals_unified_collector LOGIN;
SELECT jsonb_build_object('phase','after','login',r.rolcanlogin,
  'roleOid',r.oid,'schemaOid',n.oid,'schemaUsage',has_schema_privilege(r.oid,n.oid,'USAGE'),
  'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid,
    'select',has_table_privilege(r.oid,c.oid,'SELECT'),
    'writes',has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))ORDER BY c.relname)
    FROM pg_class c WHERE c.relnamespace=n.oid AND c.relname=ANY(ARRAY[
    '_ponder_meta','_ponder_checkpoint','booster_checkpoint','booster_engine_state',
    'booster_type','booster_original','booster_request','booster_monster','booster_refund'])))
FROM pg_namespace n CROSS JOIN pg_roles r
WHERE n.nspname='yunipals_boosters_launch_v1'AND r.rolname='yunipals_unified_collector';
ROLLBACK;
