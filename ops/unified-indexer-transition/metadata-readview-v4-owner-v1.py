#!/usr/bin/env python3
"""Create the exact official v4 views and copied read grants in one transaction.

Default reads catalogs. --rehearse always rolls back. --apply requires the exact
fresh review hash. Never writes physical/operational rows, selects or starts.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-metadata-readview-v4-owner-v1-20261022')
STAGER_SHA = '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c'
PEER_SHA = '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0'
FORMAT = 'yunipals-metadata-readview-v4-owner-v1'
PROFILE_SHA = 'eb32453ec40d043929ba66bc131fc70aad8bf9239a7bdb7258f72067f1bfa1db'


def fail(code):
    raise RuntimeError(code)


def modules():
    import hashlib
    import stat
    import types
    path = OPS / 'metadata-readview-v4-candidates-stage-v1.py'
    for item in [*path.parents, path]:
        info = item.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_operator_required')
    raw = path.read_bytes()
    if not STAGER_SHA or len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != STAGER_SHA:
        fail('exact_frozen_operator_required')
    stage = types.ModuleType('metadata_v4_primitives'); stage.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), stage.__dict__)
    installer = stage.load('metadata-normalization-runtime-install-v1.py', stage.INSTALLER_SHA)
    return stage, installer, installer.shared(), stage.load('marketplace-grants-rehearsal-v1.py', PEER_SHA)


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def snapshot_sql(p):
    old = p['previousReadSchema']
    roles = ','.join(literal(row['role']) for row in p['grants'])
    rights = []
    for row in p['grants']:
        role = literal(row['role'])
        rights.append(f"has_schema_privilege({role},'{old}','USAGE')")
        rights += [f"has_table_privilege({role},'{old}.{name}','SELECT')" for name in row['tables']]
        rights += [f"has_function_privilege({role},'{old}.{name}','EXECUTE')" for name in row['functions']]
    return f"""SELECT jsonb_build_object('database',current_database(),'sessionUser',session_user,'currentUser',current_user,
      'port',current_setting('port'),'socket',inet_client_addr() IS NULL,'targetAbsent',to_regnamespace('{p['readSchema']}') IS NULL,
      'oldMarker',(SELECT to_jsonb(r) FROM {old}._unified_read_release r WHERE singleton),
      'release',(SELECT to_jsonb(r) FROM yunipals_indexer_control.release r WHERE id='{p['sourceRelease']}'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','buildId',value->>'build_id','isDev',value->>'is_dev') FROM {p['physicalSchema']}._ponder_meta WHERE key='app'),
      'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'manifestHash',manifest_hash,'definition',definition::jsonb) ORDER BY id) FROM {p['physicalSchema']}.indexer_source),
      'activeSelectors',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY name),'[]'::jsonb) FROM yunipals_indexer_control.active_release a),
      'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit) ORDER BY rolname) FROM pg_roles WHERE rolname IN({roles})),
      'oldRights',{' AND '.join(rights)},
      'oldRelations',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'kind',c.relkind,'owner',c.relowner::text,'acl',c.relacl::text,'definition',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='{old}'::regnamespace),
      'oldFunctions',(SELECT jsonb_agg(jsonb_build_object('name',proname,'oid',oid::text,'owner',proowner::text,'acl',proacl::text,'definition',pg_get_functiondef(oid)) ORDER BY proname) FROM pg_proc WHERE pronamespace='{old}'::regnamespace))"""


def validate(value, plan, profile):
    if (value.get('database') != 'yunipals_backfill' or value.get('sessionUser') != 'postgres'
            or value.get('currentUser') != 'postgres' or value.get('port') != '5432' or value.get('socket') is not True
            or value.get('targetAbsent') is not True or value.get('oldRights') is not True):
        fail('exact_owner_fresh_target_and_existing_rights_required')
    marker = value['oldMarker']; release = value['release']
    if (marker['identity'] != plan['previousReadIdentity'] or marker['release_id'] != plan['sourceRelease']
            or marker['definitions'] != plan['definitions'] or release['id'] != plan['sourceRelease']
            or release['physical_schema'] != plan['physicalSchema'] or release['build_id'] != plan['buildId']
            or release['manifest'] != profile['manifest'] or marker['manifest_hash'] != release['manifest_hash']
            or release['manifest_hash'] != '0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029'
            or value['runtime'] != {'version': '6', 'buildId': plan['buildId'], 'isDev': '0'}):
        fail('exact_registered_source_and_previous_read_identity_required')
    sources = [{'id': row['id'], 'chainId': row['chainId'], 'manifestHash': release['manifest_hash'], 'definition': row} for row in profile['manifest']['sources']]
    if sorted(value['sources'], key=lambda row: row['id']) != sorted(sources, key=lambda row: row['id']):
        fail('exact_native_source_setup_required')
    if sorted(row['name'] for row in value['roles']) != sorted(row['role'] for row in plan['grants']):
        fail('all_existing_roles_required')
    for row in value['roles']:
        if any(row[key] is not False for key in ('super','createDb','createRole','replication','bypassRls')):
            fail('nonadministrative_existing_roles_required')
    if len(value['oldRelations']) != 10 or len(value['oldFunctions']) != 4:
        fail('complete_previous_candidate_required')


def owner_sql(p, grant_sql, before, commit):
    # Use the exact recorded official owner statements. Only its one parameterized
    # INSERT needs binding; all four values are strings/JSON, never identifiers.
    statements = []
    for row in p['expectedOwnerStatements']:
        sql = row['sql']; params = row['params']
        if params:
            if not sql.startswith('INSERT INTO "' + p['readSchema'] + '"._unified_read_release(') or len(params) != 4 or any(not isinstance(v,str) for v in params):
                fail('exact_official_owner_insert_required')
            sql = re.sub(r'\$([1-4])\b', lambda match: literal(params[int(match[1])-1]), sql)
        if not (sql.startswith('CREATE ') or sql.startswith('INSERT ') or sql.startswith('REVOKE ')):
            fail('exact_official_owner_writes_required')
        statements.append(sql + ';')
    start = grant_sql.index('BEGIN;') + len('BEGIN;')
    if not grant_sql.endswith('COMMIT;\n'):
        fail('exact_read_grant_transaction_required')
    grants = grant_sql[start:-len('COMMIT;\n')]
    guard = f"""DO $v4_snapshot$ BEGIN IF ({snapshot_sql(p)}) IS DISTINCT FROM {literal(json.dumps(before))}::jsonb THEN RAISE EXCEPTION 'reviewed_catalog_changed'; END IF; END $v4_snapshot$;"""
    final_guard = f"DO $v4_result$ BEGIN IF ({snapshot_sql(p)}) IS DISTINCT FROM {literal(json.dumps({**before, 'targetAbsent': False}))}::jsonb OR ({target_sql(p)}) IS DISTINCT FROM {literal(json.dumps(expected_target(p)))}::jsonb THEN RAISE EXCEPTION 'owner_result_outside_exact_scope'; END IF; END $v4_result$;"
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ;\nSET LOCAL lock_timeout='3s';\nSET LOCAL statement_timeout='30s';\n"
        + "SELECT pg_advisory_xact_lock(hashtext('unified-ownership-read-views'),hashtext(" + literal(p['readSchema']) + "));\n"
        + guard + '\n' + '\n'.join(statements) + '\n' + grants + '\n'
        + final_guard + '\n' + snapshot_sql(p) + ';\n' + target_sql(p) + ';\n' + ('COMMIT;\n' if commit else 'ROLLBACK;\n'))


def target_sql(p):
    schema = p['readSchema']; checks = []
    for row in p['grants']:
        role = literal(row['role']); checks.append(f"has_schema_privilege({role},'{schema}','USAGE')")
        checks += [f"has_table_privilege({role},'{schema}.{name}','SELECT')" for name in row['tables']]
        checks += [f"has_function_privilege({role},'{schema}.{name}','EXECUTE')" for name in row['functions']]
    roles = ','.join(literal(row['role']) for row in p['grants'])
    return f"""SELECT jsonb_build_object('aclDifferenceCount',({acl_difference_sql(p)}),'forbiddenAuthority',(SELECT count(*) FROM pg_roles r WHERE r.rolname IN({roles}) AND (has_schema_privilege(r.oid,'{schema}','CREATE') OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='{schema}'::regnamespace AND c.relkind IN('r','v') AND (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES'))))),'publicRelationPrivileges',(SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='{schema}'::regnamespace AND c.relkind IN('r','v') AND a.grantee=0),'identity',(SELECT identity FROM {schema}._unified_read_release WHERE singleton),'relationCount',(SELECT count(*) FROM pg_class WHERE relnamespace='{schema}'::regnamespace),'invokerCount',(SELECT count(*) FROM pg_proc WHERE pronamespace='{schema}'::regnamespace AND NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog']),'publicExecute',(SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='{schema}'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE'),'allReads',{' AND '.join(checks)})"""


def acl_difference_sql(p):
    # Owner authority is unchanged. Every non-owner grant must be exactly one
    # reviewed read grant, including default ACLs for unrelated roles/PUBLIC.
    schema = p['readSchema']; rows = []
    for row in p['grants']:
        rows.append(('schema', schema, row['role'], 'USAGE'))
        rows.extend(('relation', name, row['role'], 'SELECT') for name in row['tables'])
        rows.extend(('function', name, row['role'], 'EXECUTE') for name in row['functions'])
    expected = ','.join('(' + ','.join(literal(value) for value in row) + ',false)' for row in rows)
    return f"""WITH actual(kind,name,role,privilege,grantable) AS (
      SELECT 'schema',n.nspname::text,pg_get_userbyid(a.grantee)::text,a.privilege_type,a.is_grantable
        FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
        WHERE n.nspname='{schema}' AND a.grantee<>n.nspowner
      UNION ALL SELECT 'relation',c.relname::text,pg_get_userbyid(a.grantee)::text,a.privilege_type,a.is_grantable
        FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
        WHERE c.relnamespace='{schema}'::regnamespace AND a.grantee<>c.relowner
      UNION ALL SELECT 'column',c.relname::text||'.'||col.attname::text,pg_get_userbyid(a.grantee)::text,a.privilege_type,a.is_grantable
        FROM pg_class c JOIN pg_attribute col ON col.attrelid=c.oid CROSS JOIN LATERAL aclexplode(col.attacl) a
        WHERE c.relnamespace='{schema}'::regnamespace AND a.grantee<>c.relowner
      UNION ALL SELECT 'function',f.proname::text||'('||oidvectortypes(f.proargtypes)||')',pg_get_userbyid(a.grantee)::text,a.privilege_type,a.is_grantable
        FROM pg_proc f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a
        WHERE f.pronamespace='{schema}'::regnamespace AND a.grantee<>f.proowner
      ), expected(kind,name,role,privilege,grantable) AS (VALUES {expected})
      SELECT count(*) FROM ((SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
        UNION ALL (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)) differences"""


def expected_target(p):
    return {'identity': p['readIdentity'], 'relationCount': 10, 'invokerCount': 4, 'publicExecute': 0, 'allReads': True, 'forbiddenAuthority': 0, 'publicRelationPrivileges': 0, 'aclDifferenceCount': 0}


def outcome(before, after, target, p):
    if after != {**before, 'targetAbsent': False}:
        fail('previous_candidate_roles_or_source_changed')
    if target != expected_target(p):
        # Nine visible relations plus the marker primary-key index.
        fail('exact_fresh_view_catalog_required')


def prepare(stage, installer, m, peer, install_pin):
    installed = installer.installed(m, install_pin)
    plan = m.document(OPS / 'metadata-readview-v4-plan.review.json', stage.PLAN_SHA)
    grants = m.protected(OPS / 'metadata-readview-v4-grants.review.sql')
    if m.sha(grants) != plan['grantsSha256'] or plan['artifactDigest'] != installer.DIGEST:
        fail('exact_owner_artifact_and_grants_required')
    profile = m.document(OPS / 'production-rpc-profile-2026-10-20.draft.json', PROFILE_SHA)
    before = peer.sql('source', snapshot_sql(plan) + ';')[0]
    validate(before, plan, profile)
    result = {'format': FORMAT, 'artifactDigest': installer.DIGEST, 'installReceiptSha256': install_pin,
              'planSha256': stage.PLAN_SHA, 'grantsSha256': plan['grantsSha256'], 'before': before,
              'readSchema': plan['readSchema'], 'readIdentity': plan['readIdentity'],
              'serviceJobs': 0, 'providerRequests': 0, 'selected': False}
    return result, plan, grants.decode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install-receipt-sha',required=True); group=parser.add_mutually_exclusive_group()
    group.add_argument('--rehearse',action='store_true'); group.add_argument('--apply',metavar='REVIEW_SHA')
    args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='yunipals-main':fail('root_on_exact_host_required')
    os.umask(0o077); stage,installer,m,peer=modules()
    result,p,grants=prepare(stage,installer,m,peer,args.install_receipt_sha); binding=m.sha(m.encoded(result))
    if args.apply and args.apply!=binding:fail('fresh_owner_review_hash_required')
    if args.apply:
        if os.path.lexists(BASE):fail('fresh_owner_intent_required')
        installer.directory(BASE.parent);BASE.mkdir(mode=0o700)
        m.write_new(BASE/'intent.json',m.encoded(result));m.sync_directory(BASE);m.sync_directory(BASE.parent)
    if args.rehearse or args.apply:
        rows=peer.sql('source',owner_sql(p,grants,result['before'],bool(args.apply)),readonly=False)
        # psql may emit an empty advisory-lock row; the peer transport discards it.
        if len(rows)!=2:fail('exact_two_owner_observations_required')
        outcome(result['before'],rows[0],rows[1],p)
        if args.rehearse:
            if peer.sql('source',snapshot_sql(p)+';')[0]!=result['before']:fail('rehearsal_not_fully_rolled_back')
        else:
            persisted=peer.sql('source',snapshot_sql(p)+';'+target_sql(p)+';')
            outcome(result['before'],*persisted,p)
        result.update(rehearsed=bool(args.rehearse),committed=bool(args.apply),after=rows[0],target=rows[1])
    pin=None
    if args.apply:
        raw=m.encoded(result);m.write_new(BASE/'result.json',raw);m.sync_directory(BASE);pin=m.sha(raw)
    print(json.dumps({'format':FORMAT,'bindingSha256':binding,'readSchema':p['readSchema'],'readIdentity':p['readIdentity'],
        'rehearsed':bool(args.rehearse),'committed':bool(args.apply),'resultSha256':pin,'serviceJobs':0,'providerRequests':0,'selected':False},sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:fail('bounded_owner_deadline'));signal.alarm(120)
    try:main()
    except Exception as error:
        code=str(error) if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',str(error)) else 'owner_operation_failed'
        print(json.dumps({'format':FORMAT,'completed':False,'failure':code}));raise SystemExit(1)
    finally:signal.alarm(0)
