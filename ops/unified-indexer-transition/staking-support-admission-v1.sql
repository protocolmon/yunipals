-- Fixed owner preparation for the accepted9ee bounded native staking worker.
-- Use a clean postgres Unix-peer on yunipals_backfill; no runtime executes this.
-- Root reviews the current actor/column catalog capture before submitting it.
-- Requires the exact existing two physical operational tables; never replaces
-- them or changes their ownership, existing rows, existing ACLs or old scanner.
BEGIN ISOLATION LEVEL REPEATABLE READ READ WRITE;
SET LOCAL search_path=pg_catalog;
SET LOCAL standard_conforming_strings=on;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1500ms';
SET LOCAL idle_in_transaction_session_timeout='15s';
SELECT pg_advisory_xact_lock(178858,9062);
DO $staking_admission$
DECLARE before_scan jsonb;after_scan jsonb;before_positions jsonb;after_positions jsonb;before_acl jsonb;oid_actor oid;item record;
BEGIN
 IF current_database()<>'yunipals_backfill' OR current_user<>'postgres' OR session_user<>'postgres'
  OR current_setting('port')<>'5432' OR inet_client_addr()IS NOT NULL OR pg_is_in_recovery()
  THEN RAISE EXCEPTION 'staking_main_owner_identity_required';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='yunipals_islands_staking')
  THEN RAISE EXCEPTION 'fresh_absent_staking_role_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM yunipals_ownership_35cdcb32_v3._unified_read_release m
  JOIN yunipals_indexer_control.release r ON r.id=m.release_id
  WHERE m.singleton AND m.identity='0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc'
   AND r.id='0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
   AND r.physical_schema='unified_shadow_20261020_7e7375b0'AND r.build_id='bf4939b3ff')
  THEN RAISE EXCEPTION 'staking_selected_source_identity_required';END IF;
 IF (SELECT count(*)FROM pg_class c WHERE c.oid IN('metadata.island_staking_scan'::regclass,'metadata.island_staking_position'::regclass)
   AND c.relkind='r'AND c.relpersistence='p')<>2
  THEN RAISE EXCEPTION 'existing_physical_staking_tables_required';END IF;
 IF (SELECT count(*)FROM pg_proc p WHERE p.oid IN('yunipals_ownership_35cdcb32_v3.source_boundary(text)'::regprocedure,
   'yunipals_ownership_35cdcb32_v3.source_probe(text)'::regprocedure)AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog'])<>2
  THEN RAISE EXCEPTION 'staking_protected_source_INVOKER_required';END IF;
 LOCK TABLE metadata.island_staking_scan,metadata.island_staking_position IN ACCESS EXCLUSIVE MODE;
 RAISE EXCEPTION 'reviewed_staking_owner_capture_required'; -- OWNED_CAPTURE_GUARD
 SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(s.*)-ARRAY['ownership_release_id','ownership_read_identity']ORDER BY s.schema_name),'[]'::jsonb)::text,'UTF8')),'hex'))INTO before_scan FROM metadata.island_staking_scan s;
 SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(p.*)ORDER BY p.schema_name,p.token_id),'[]'::jsonb)::text,'UTF8')),'hex'))INTO before_positions FROM metadata.island_staking_position p;
 -- These are exactly nativeStakingSchemaStatements[2..3], not new migrations.
 SELECT relowner INTO item FROM pg_class WHERE oid='metadata.island_staking_scan'::regclass;
 EXECUTE format('SET LOCAL ROLE %I',pg_get_userbyid(item.relowner));
 ALTER TABLE metadata.island_staking_scan ADD COLUMN IF NOT EXISTS ownership_release_id text;
 ALTER TABLE metadata.island_staking_scan ADD COLUMN IF NOT EXISTS ownership_read_identity text;
 RESET ROLE;
 RAISE EXCEPTION 'exact_staking_nullable_catalog_required'; -- OWNED_COLUMN_POSTCHECK
 IF (SELECT count(*)FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='metadata.island_staking_scan'::regclass AND a.attname IN('ownership_release_id','ownership_read_identity')
   AND a.atttypid='text'::regtype AND NOT a.attnotnull AND NOT a.attisdropped AND d.oid IS NULL AND a.attidentity=''AND a.attgenerated='')<>2
  THEN RAISE EXCEPTION 'staking_exact_nullable_no_default_columns_required';END IF;
 CREATE ROLE yunipals_islands_staking NOLOGIN PASSWORD NULL NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
 SELECT oid INTO STRICT oid_actor FROM pg_roles WHERE rolname='yunipals_islands_staking';
 GRANT USAGE ON SCHEMA metadata,unified_shadow_20261020_7e7375b0,yunipals_ownership_35cdcb32_v3,yunipals_indexer_control TO yunipals_islands_staking;
 -- Exact closure reached by the official point verifier and the two INVOKER
 -- functions. No unrelated source read surface or native Base tables needed.
 GRANT SELECT ON TABLE unified_shadow_20261020_7e7375b0._ponder_meta,unified_shadow_20261020_7e7375b0._ponder_checkpoint,
  unified_shadow_20261020_7e7375b0.indexer_source,unified_shadow_20261020_7e7375b0.chain_block,unified_shadow_20261020_7e7375b0.transfer_event,
  yunipals_indexer_control.release,yunipals_indexer_control.chain_status,
  yunipals_ownership_35cdcb32_v3._unified_read_release,yunipals_ownership_35cdcb32_v3.transfer_event,
  metadata.island_staking_scan,metadata.island_staking_position TO yunipals_islands_staking;
 GRANT EXECUTE ON FUNCTION yunipals_ownership_35cdcb32_v3.source_boundary(text),yunipals_ownership_35cdcb32_v3.source_probe(text)TO yunipals_islands_staking;
 GRANT INSERT,UPDATE ON metadata.island_staking_scan TO yunipals_islands_staking;
 GRANT INSERT,DELETE ON metadata.island_staking_position TO yunipals_islands_staking;
 RAISE EXCEPTION 'exact_staking_new_actor_ACL_required'; -- OWNED_ACL_POSTCHECK
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE member=oid_actor OR roleid=oid_actor)
  OR NOT EXISTS(SELECT 1 FROM pg_authid WHERE oid=oid_actor AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolpassword IS NULL AND rolconnlimit=2)
  OR has_database_privilege(oid_actor,current_database(),'CREATE')
  OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=oid_actor)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=oid_actor)
  OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=oid_actor)
  THEN RAISE EXCEPTION 'staking_dedicated_NOLOGIN_actor_required';END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN('metadata','unified_shadow_20261020_7e7375b0','yunipals_ownership_35cdcb32_v3','yunipals_indexer_control')
   AND has_schema_privilege(oid_actor,n.oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN('metadata','unified_shadow_20261020_7e7375b0','yunipals_ownership_35cdcb32_v3','yunipals_indexer_control')
    AND p.prosecdef AND has_function_privilege(oid_actor,p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'staking_no_schema_create_or_definer_path_required';END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])v(privilege)
  WHERE n.nspname IN('metadata','unified_shadow_20261020_7e7375b0','yunipals_ownership_35cdcb32_v3','yunipals_indexer_control')
   AND CASE WHEN c.relkind IN('r','p','v','m','f')THEN has_table_privilege(oid_actor,c.oid,v.privilege)ELSE false END
   AND NOT(c.oid='metadata.island_staking_scan'::regclass AND v.privilege IN('INSERT','UPDATE'))
   AND NOT(c.oid='metadata.island_staking_position'::regclass AND v.privilege IN('INSERT','DELETE')))
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('metadata','unified_shadow_20261020_7e7375b0','yunipals_ownership_35cdcb32_v3','yunipals_indexer_control')
    AND CASE WHEN c.relkind='S'THEN has_sequence_privilege(oid_actor,c.oid,'USAGE,UPDATE')ELSE false END)
  THEN RAISE EXCEPTION 'staking_only_two_operational_write_slices_required';END IF;
 SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(s.*)-ARRAY['ownership_release_id','ownership_read_identity']ORDER BY s.schema_name),'[]'::jsonb)::text,'UTF8')),'hex'))INTO after_scan FROM metadata.island_staking_scan s;
 SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(p.*)ORDER BY p.schema_name,p.token_id),'[]'::jsonb)::text,'UTF8')),'hex'))INTO after_positions FROM metadata.island_staking_position p;
 IF before_scan IS DISTINCT FROM after_scan OR before_positions IS DISTINCT FROM after_positions
  THEN RAISE EXCEPTION 'staking_old_operational_rows_unchanged_required';END IF;
 PERFORM set_config('yunipals.staking_owner_proof',jsonb_build_object('applied',true,'roleOid',oid_actor::text,'roleLogin',false,
  'connectionLimit',2,'scanRowsBefore',before_scan,'scanRowsAfter',after_scan,'positionRowsBefore',before_positions,'positionRowsAfter',after_positions,
  'sourceWrites',false,'sourceSelectionChanged',false,'oldScannerChanged',false,'workerExecuted',false)::text,true);
END $staking_admission$;
SELECT current_setting('yunipals.staking_owner_proof');
COMMIT;
