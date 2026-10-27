#!/usr/bin/env python3
"""Read exact staged grant needs; optionally rehearse them and always ROLLBACK.

No commit mode, accounts, LOGIN, application-row queries or service/provider work.
Uses the same clean local PostgreSQL peer transport as the existing owner tools.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
STAGE = Path('/var/backups/yunipals-marketplace-consumer-stage-v1-20261022')
STAGER_SHA = 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798'
NO_PASSWORD = OPS / 'marketplace-grants-password-not-present'
FORMAT = 'yunipals-marketplace-grants-rehearsal-v1'
ROLES = ['market_prod_sale_' + c for c in ('ethereum', 'base', 'polygon')]
SOURCE_ROLE = 'market_prod_source_read'
CLUSTERS = {'market': ('15438', 'yunipals_market_production'), 'source': ('5432', 'yunipals_backfill')}
IDENTIFIER = r'[a-z_][a-z0-9_]*'


def fail(code):
    raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def modules():
    path = OPS / 'marketplace-consumer-stage-v1.py'
    import stat
    for part in [*path.parents, path]:
        info = part.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_stager_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or sha(raw) != STAGER_SHA:
        fail('exact_stager_required')
    stage = types.ModuleType('marketplace_stager')
    stage.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), stage.__dict__)
    return stage, stage.shared()


def bundle(stage, m, pin):
    if not re.fullmatch('[0-9a-f]{64}', pin) or pin == '0' * 64:
        fail('actual_stage_receipt_sha_required')
    receipt = m.document(STAGE / 'result.json', pin)
    if receipt.get('format') != stage.FORMAT or receipt.get('staged') is not True or receipt.get('selected') is not False:
        fail('actual_completed_stage_required')
    expected = stage.grants(m)
    bodies = {}
    for kind, name, original in zip(CLUSTERS, ('market-sale-roles.proposal.sql', 'source-read-grants.proposal.sql'), expected):
        raw = m.protected(STAGE / name)
        if sha(raw) != receipt['files'][name] or raw != original:
            fail('exact_produced_proposal_required')
        bodies[kind] = proposal(raw.decode(), kind)
    return receipt, bodies


def proposal(text, kind):
    clean = re.sub(r'--[^\n]*', '', text)
    statements = [s.strip() for s in clean.split(';') if s.strip()]
    if statements[0] != 'BEGIN' or statements[-1] != 'COMMIT':
        fail('one_exact_proposal_transaction_required')
    statements = statements[1:-1]
    permissions, created = [], []
    for statement in statements:
        create = re.fullmatch('CREATE ROLE (' + IDENTIFIER + ') NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4', statement)
        if create:
            created.append(create[1])
            continue
        match = re.fullmatch(r'GRANT (.*?) ON (.*?) TO (' + IDENTIFIER + ')', ' '.join(statement.split()))
        if not match:
            fail('only_exact_finite_grants_required')
        privilege_text, object_text, role = match.groups()
        object_kind = 'table'
        for prefix in ('SCHEMA', 'FUNCTION'):
            if object_text.startswith(prefix + ' '):
                object_kind, object_text = prefix.lower(), object_text[len(prefix) + 1:]
        privileges = re.findall(r'(SELECT|INSERT|UPDATE|DELETE|USAGE|EXECUTE)(?:\(([^)]+)\))?', privilege_text)
        if not privileges or ','.join(p + ('(' + cols + ')' if cols else '') for p, cols in privileges) != privilege_text:
            fail('finite_privileges_required')
        for obj in object_text.split(','):
            obj = obj.strip()
            pattern = IDENTIFIER if object_kind == 'schema' else IDENTIFIER + r'\.' + IDENTIFIER + (r'\(text\)' if object_kind == 'function' else '')
            if not re.fullmatch(pattern, obj):
                fail('fixed_object_identifier_required')
            for privilege, columns in privileges:
                for column in columns.split(',') if columns else [None]:
                    if column is not None and not re.fullmatch(IDENTIFIER, column):
                        fail('fixed_column_identifier_required')
                    permissions.append({'kind': 'column' if column else object_kind, 'object': obj, 'privilege': privilege, 'column': column, 'role': role})
    if (kind == 'market' and (created != ROLES or {p['role'] for p in permissions} != set(ROLES))) or (kind == 'source' and (created or {p['role'] for p in permissions} != {SOURCE_ROLE})):
        fail('exact_role_scope_required')
    return {'body': ';\n'.join(statements) + ';', 'permissions': permissions, 'created': created}


def catalog_sql(plan):
    rows = ','.join('(' + ','.join('NULL' if p[k] is None else literal(p[k]) for k in ('kind', 'object', 'privilege', 'column', 'role')) + ')' for p in plan['permissions'])
    names = ','.join(literal(r) for r in sorted({p['role'] for p in plan['permissions']}))
    schemas = ','.join(literal(s) for s in sorted({p['object'] if p['kind'] == 'schema' else p['object'].split('.')[0] for p in plan['permissions']}))
    return f"""WITH desired(kind,object_name,privilege,column_name,role_name) AS (VALUES {rows}),
      resolved AS (SELECT d.*,r.oid role_oid,CASE WHEN kind='schema' THEN to_regnamespace(object_name)::oid WHEN kind='function' THEN to_regprocedure(object_name)::oid ELSE to_regclass(object_name)::oid END object_oid FROM desired d LEFT JOIN pg_roles r ON r.rolname=d.role_name),
      permissions AS (SELECT *, CASE WHEN role_oid IS NULL OR object_oid IS NULL THEN NULL WHEN kind='schema' THEN has_schema_privilege(role_oid,object_oid,privilege) WHEN kind='function' THEN has_function_privilege(role_oid,object_oid,privilege) WHEN kind='column' THEN has_column_privilege(role_oid,object_oid,column_name,privilege) ELSE has_table_privilege(role_oid,object_oid,privilege) END allowed FROM resolved)
      SELECT jsonb_build_object('database',current_database(),'sessionUser',session_user,'currentUser',current_user,
       'permissions',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'object',object_name,'oid',object_oid::text,'privilege',privilege,'column',column_name,'role',role_name,'allowed',allowed) ORDER BY role_name,kind,object_name,privilege,column_name) FROM permissions),
       'roles',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'oid',r.oid::text,'login',r.rolcanlogin,'inherit',r.rolinherit,'super',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,'passwordPresent',a.rolpassword IS NOT NULL,'memberships',(SELECT count(*) FROM pg_auth_members x WHERE x.member=r.oid OR x.roleid=r.oid)) ORDER BY r.rolname) FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid WHERE r.rolname IN ({names})),'[]'::jsonb),
       'effectiveAuthority',COALESCE((SELECT jsonb_agg(jsonb_build_object('role',r.rolname,
         'databaseCreate',has_database_privilege(r.oid,current_database(),'CREATE'),
         'schemaCreate',(SELECT count(*) FROM pg_namespace n WHERE n.nspname IN ({schemas}) AND has_schema_privilege(r.oid,n.oid,'CREATE')),
         'ownedSchemas',(SELECT count(*) FROM pg_namespace n WHERE n.nspname IN ({schemas}) AND n.nspowner=r.oid),
         'ownedRelations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ({schemas}) AND c.relowner=r.oid),
         'ownedFunctions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ({schemas}) AND p.proowner=r.oid),
         'writableRelations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ({schemas}) AND c.relkind IN('r','p','v','m','f') AND (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname IN ({names})),'[]'::jsonb),
       'objects',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'name',object_name,'oid',object_oid::text,'owner',CASE WHEN kind='schema' THEN (SELECT nspowner::text FROM pg_namespace WHERE oid=object_oid) WHEN kind='function' THEN (SELECT proowner::text FROM pg_proc WHERE oid=object_oid) ELSE (SELECT relowner::text FROM pg_class WHERE oid=object_oid) END,'acl',CASE WHEN kind='schema' THEN (SELECT nspacl::text FROM pg_namespace WHERE oid=object_oid) WHEN kind='function' THEN (SELECT proacl::text FROM pg_proc WHERE oid=object_oid) ELSE (SELECT relacl::text FROM pg_class WHERE oid=object_oid) END,'columnAcl',CASE WHEN kind='table' THEN (SELECT jsonb_agg(jsonb_build_object('number',attnum,'acl',attacl::text) ORDER BY attnum) FROM pg_attribute WHERE attrelid=object_oid AND attnum>0 AND NOT attisdropped) END) ORDER BY kind,object_name) FROM (SELECT DISTINCT CASE WHEN kind='column' THEN 'table' ELSE kind END kind,object_name,object_oid FROM resolved) objects))"""


HEADROOM_SQL = """SELECT jsonb_build_object('maxConnections',current_setting('max_connections')::integer,'superuserReserved',current_setting('superuser_reserved_connections')::integer,'reserved',COALESCE(current_setting('reserved_connections',true),'0')::integer,'clientConnections',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend'),'byRole',(SELECT jsonb_agg(jsonb_build_object('role',usename,'connections',n) ORDER BY usename) FROM (SELECT usename,count(*) n FROM pg_stat_activity WHERE backend_type='client backend' GROUP BY usename) x))"""


def sql(kind, text, readonly=True):
    if os.path.lexists(NO_PASSWORD):
        fail('password_path_must_be_absent')
    port, database = CLUSTERS[kind]
    peer = pwd.getpwnam('postgres')
    if peer.pw_uid <= 0 or peer.pw_gid <= 0:
        fail('existing_postgres_peer_required')
    options = '-c statement_timeout=8000 -c lock_timeout=1500 -c idle_in_transaction_session_timeout=10000 -c application_name=marketplace_grants_rehearsal_v1'
    if readonly:
        options += ' -c default_transaction_read_only=on'
    args = ['/usr/bin/setpriv', '--reuid=' + str(peer.pw_uid), '--regid=' + str(peer.pw_gid), '--clear-groups', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'HOME=/nonexistent', 'LANG=C.UTF-8', 'PGHOST=/var/run/postgresql', 'PGPORT=' + port, 'PGDATABASE=' + database, 'PGUSER=postgres', 'PGPASSFILE=' + str(NO_PASSWORD), 'PGOPTIONS=' + options, '/usr/bin/psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1']
    result = subprocess.run(args, input=text.encode(), capture_output=True, timeout=30, env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
    if result.returncode or result.stderr or len(result.stdout) > 2_000_000:
        fail('bounded_local_catalog_command_failed')
    if os.path.lexists(NO_PASSWORD):
        fail('password_path_appeared')
    return [json.loads(line) for line in result.stdout.decode().splitlines() if line.strip()]


def validate_catalog(value, plan, kind, applied=False):
    if value['sessionUser'] != 'postgres' or value['currentUser'] != 'postgres' or value['database'] != CLUSTERS[kind][1]:
        fail('exact_local_owner_database_required')
    if len(value['permissions']) != len(plan['permissions']) or any(p['oid'] is None for p in value['permissions']):
        fail('all_exact_grant_objects_required')
    if kind == 'market':
        expected = set(ROLES) if applied else set()
        if {r['name'] for r in value['roles']} != expected:
            fail('fresh_dormant_roles_required')
        if any(any(r[k] is not False for k in ('login', 'inherit', 'super', 'createDb', 'createRole', 'replication', 'bypassRls', 'passwordPresent')) or r['connectionLimit'] != 4 or r['memberships'] != 0 for r in value['roles']):
            fail('only_dormant_finite_roles_required')
    else:
        if len(value['roles']) != 1 or value['roles'][0]['name'] != SOURCE_ROLE:
            fail('retained_source_role_required')
        role = value['roles'][0]
        if any(role[k] is not False for k in ('super', 'createDb', 'createRole', 'replication', 'bypassRls')):
            fail('nonadministrative_source_role_required')
        if len(value['effectiveAuthority']) != 1:
            fail('source_effective_authority_required')
        authority = value['effectiveAuthority'][0]
        if authority['databaseCreate'] is not False or any(authority[k] != 0 for k in ('schemaCreate', 'ownedSchemas', 'ownedRelations', 'ownedFunctions', 'writableRelations')):
            fail('source_must_be_nonowner_and_readonly')
    if applied and any(p['allowed'] is not True for p in value['permissions']):
        fail('all_rehearsed_privileges_required')
    return value


def missing_sql(value):
    statements = []
    for p in value['permissions']:
        if p['allowed'] is True:
            continue
        privilege = p['privilege'] + ('(' + p['column'] + ')' if p['column'] else '')
        kind = p['kind'].upper() + ' ' if p['kind'] in ('schema', 'function') else ''
        statements.append('GRANT ' + privilege + ' ON ' + kind + p['object'] + ' TO ' + p['role'] + ';')
    return statements


def inspect(kind, plan, rehearse):
    query = catalog_sql(plan)
    before, headroom = sql(kind, 'BEGIN READ ONLY;\n' + query + ';\n' + HEADROOM_SQL + ';\nROLLBACK;')
    validate_catalog(before, plan, kind)
    outcome = 'not_attempted'
    if rehearse:
        # No COMMIT is present in the transport. ON_ERROR_STOP closes the peer
        # connection on any error, causing PostgreSQL to abort the transaction.
        inside_before, inside_after = sql(kind, 'BEGIN;\n' + query + ';\n' + plan['body'] + '\n' + query + ';\nROLLBACK;', readonly=False)
        if inside_before != before:
            fail('catalog_changed_before_rollback_rehearsal')
        validate_catalog(inside_after, plan, kind, applied=True)
        after, = sql(kind, 'BEGIN READ ONLY;\n' + query + ';\nROLLBACK;')
        if after != before:
            fail('rollback_catalog_unchanged_required')
        outcome = 'rollback_confirmed_catalog_unchanged'
    headroom['ordinaryAvailableNow'] = headroom['maxConnections'] - headroom['superuserReserved'] - headroom['reserved'] - headroom['clientConnections']
    return {'catalog': before, 'missingStatements': missing_sql(before), 'missingPrivileges': sum(p['allowed'] is not True for p in before['permissions']), 'connectionHeadroom': headroom, 'outcome': outcome, 'proposalSqlSha256': sha(plan['body'].encode())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle-sha', required=True)
    parser.add_argument('--rehearse', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_host_required')
    os.umask(0o077)
    stage, m = modules()
    receipt, plans = bundle(stage, m, args.bundle_sha)
    result = {'format': FORMAT, 'stageReceiptSha256': args.bundle_sha, 'stagerSha256': STAGER_SHA,
              'rehearsalRequested': args.rehearse, 'clusters': {k: inspect(k, p, args.rehearse) for k, p in plans.items()},
              'newThreeSaleWorkerPoolCaps': {'marketWorker': 12, 'sourceReader': 12, 'budgetCoordinator': 6},
              'capacityScope': 'New three sale workers only; BNB/API/other migrations must also be reserved before admission. Budget connection cluster must be confirmed from retained configuration.',
              'persistentWrites': 0, 'loginChanges': 0, 'serviceJobs': 0, 'providerCalls': 0, 'applicationRowsRead': False, 'privateValuesExported': False}
    if m.document(STAGE / 'result.json', args.bundle_sha) != receipt:
        fail('stage_changed_during_catalog_checks')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'status': 'refused_or_failed', 'error': str(error) if isinstance(error, RuntimeError) else type(error).__name__, 'noCommitPath': True}))
        raise SystemExit(1)
