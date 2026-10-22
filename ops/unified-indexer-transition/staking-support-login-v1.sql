-- Clean postgres Unix-peer only. `expected_oid` comes from the confirmed
-- staking-support-owner-v1 proof. `enabled` is exactly true or false.
-- Before disabling, stop the owned worker and drain its sessions; no backend kill.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1500ms';
SELECT pg_advisory_xact_lock(178858,9062);
SELECT set_config('yunipals.expected_staking_oid',:'expected_oid',true)AS bound_oid,
 set_config('yunipals.enable_staking_login',:'enabled',true)AS bound_enabled \gset staking_binding_

DO $staking_login$DECLARE actor oid;enabled boolean;BEGIN
 IF current_database()<>'yunipals_backfill'OR current_user<>'postgres'OR session_user<>'postgres'
  OR current_setting('port')<>'5432'OR inet_client_addr()IS NOT NULL OR pg_is_in_recovery()
  THEN RAISE EXCEPTION 'staking_main_owner_identity_required';END IF;
 IF current_setting('yunipals.expected_staking_oid')!~'^[1-9][0-9]*$'
  OR current_setting('yunipals.enable_staking_login')NOT IN('true','false')
  THEN RAISE EXCEPTION 'exact_staking_actor_and_login_direction_required';END IF;
 enabled:=current_setting('yunipals.enable_staking_login')='true';
 SELECT oid INTO actor FROM pg_authid WHERE rolname='yunipals_islands_staking'
  AND oid=current_setting('yunipals.expected_staking_oid')::oid
  AND rolcanlogin<>enabled AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
  AND NOT rolreplication AND NOT rolbypassrls AND rolpassword IS NULL AND rolconnlimit=2;
 IF actor IS NULL OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=actor OR roleid=actor)
  OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='yunipals_islands_staking')
  THEN RAISE EXCEPTION 'same_dedicated_staking_role_zero_sessions_required';END IF;
 IF enabled THEN ALTER ROLE yunipals_islands_staking LOGIN;
 ELSE ALTER ROLE yunipals_islands_staking NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=actor AND rolcanlogin=enabled)
  THEN RAISE EXCEPTION 'staking_exact_login_postcheck_required';END IF;
 PERFORM set_config('yunipals.staking_login_proof',jsonb_build_object('roleOid',actor::text,'login',enabled,'grantsChanged',false,'sourceSelectionChanged',false)::text,true);
END $staking_login$;
SELECT current_setting('yunipals.staking_login_proof');
COMMIT;
