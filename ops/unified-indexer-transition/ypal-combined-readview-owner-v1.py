#!/usr/bin/env python3
"""Create only the immutable combined read views; no grants or selection."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket

FORMAT = 'yunipals-ypal-combined-readview-owner-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023')
REGISTER = OPS / 'ypal-combined-release-register-v1.py'
REGISTER_SHA = 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d'
REGISTER_ACK = Path('/var/backups/yunipals-ypal-combined-release-register-v1-20261023/registered.json')
REGISTER_ACK_SHA = '39b967846a4c84e320766075cd5c9ea478e29b85a38b6aa8306df95e94fe4cb7'
PLAN = OPS / 'ypal-combined-readview-v1.preparation.json'
PLAN_SHA = '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b'
INSTALLER_SHA = '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab'
INSTALL_ACK_SHA = '14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83'
READ_SCHEMA = 'yunipals_ownership_4e77f52b_v4'
READ_IDENTITY = '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
RELATIONS = {'_unified_read_release': 'r', '_unified_read_release_pkey': 'i',
             **{name: 'v' for name in ['token', 'token_lifecycle', 'transfer_event', 'admin_role_event',
                                      'contract_owner_event', 'source_status', 'base_metadata_event', 'base_metadata_scan']}}
FUNCTIONS = ['base_metadata_frame(boolean)', 'base_metadata_probe()', 'source_boundary(text)', 'source_probe(text)']


def need(value, code):
    if not value: raise RuntimeError(code)


def literal(value): return "'" + str(value).replace("'", "''") + "'"


def load():
    import hashlib
    import types
    raw = REGISTER.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == REGISTER_SHA, 'exact_registration_owner_required')
    r = types.ModuleType('combined_registration'); r.__file__ = str(REGISTER)
    exec(compile(raw, str(REGISTER), 'exec'), r.__dict__)
    s, h, op, ack = r.load()
    need(r.sha(s.protected(REGISTER)) == REGISTER_SHA, 'protected_registration_owner_required')
    registered = s.document(REGISTER_ACK, REGISTER_ACK_SHA)
    need(registered['registered'] is True and registered['releaseId'] == r.RELEASE_ID and
         registered['sourceReceiptSha256'] == r.SOURCE_ACK_SHA and registered['activeReleaseChanged'] is False,
         'actually_registered_unselected_candidate_required')
    p = s.document(PLAN, PLAN_SHA)
    need(p['readSchema'] == READ_SCHEMA and p['readIdentity'] == READ_IDENTITY and
         p['sourceRelease'] == r.RELEASE_ID and p['physicalSchema'] == s.SCHEMA and p['buildId'] == s.BUILD and
         p['manifestHash'] == r.MANIFEST_HASH and len(p['expectedOwnerStatements']) == 19 and
         p['grantsPrepared'] is False, 'exact_official_readview_preparation_required')
    installer = s.module(OPS / 'metadata-normalization-runtime-install-v1.py', INSTALLER_SHA)
    installed = installer.installed(installer.shared(), INSTALL_ACK_SHA)
    need(installed['artifactDigest'] == p['requiredInstalledArtifactDigest'], 'exact_normalized_official_artifact_required')
    manifest = s.document(installer.TARGET / 'manifest.json', installer.MANIFEST_SHA)
    inputs = {row['path']: row['sha256'] for row in manifest['inputs']}
    need(all(inputs.get(name) == pin for name, pin in p['officialSourcePins'].items()), 'official_creator_artifact_provenance_required')
    return r, s, h, op, ack, p


def source_binding(r, s, h, op, ack):
    need(r.sha(s.protected(REGISTER_ACK)) == REGISTER_ACK_SHA and
         r.sha(s.protected(PLAN)) == PLAN_SHA, 'registered_receipt_and_plan_unchanged')
    return r.binding(s, h, op, ack)


def snapshot_sql(p):
    physical = p['physicalSchema']
    return f"""SELECT jsonb_build_object(
      'database',current_database(),'user',current_user,'port',current_setting('port'),'socket',inet_client_addr() IS NULL,
      'targetAbsent',to_regnamespace('{READ_SCHEMA}') IS NULL,
      'nativeOid',(SELECT oid::text FROM pg_namespace WHERE nspname='{physical}'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','buildId',value->>'build_id','isDev',value->>'is_dev') FROM {physical}._ponder_meta WHERE key='app'),
      'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'manifestHash',manifest_hash,'definition',definition::jsonb) ORDER BY id) FROM {physical}.indexer_source),
      'release',(SELECT to_jsonb(r) FROM yunipals_indexer_control.release r WHERE id='{p['sourceRelease']}'),
      'active',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY name) FROM yunipals_indexer_control.active_release a),'[]'::jsonb),
      'previousRelations',COALESCE((SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'oid',c.oid::text,'kind',c.relkind,'owner',c.relowner::text,'acl',c.relacl::text,'definition',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) END) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'yunipals_ownership_%' AND n.nspname<>'{READ_SCHEMA}'),'[]'::jsonb),
      'previousFunctions',COALESCE((SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',f.proname,'oid',f.oid::text,'owner',f.proowner::text,'acl',f.proacl::text,'definition',pg_get_functiondef(f.oid)) ORDER BY n.nspname,f.proname) FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname LIKE 'yunipals_ownership_%' AND n.nspname<>'{READ_SCHEMA}'),'[]'::jsonb))"""


def target_sql(p):
    return f"""SELECT jsonb_build_object(
      'schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='{READ_SCHEMA}'),
      'owner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='{READ_SCHEMA}'),
      'marker',(SELECT to_jsonb(m)-'created_at' FROM {READ_SCHEMA}._unified_read_release m WHERE singleton),
      'relations',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid::text,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'definition',CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) WHEN c.relkind='i' THEN pg_get_indexdef(c.oid) END,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace='{READ_SCHEMA}'::regnamespace),
      'functions',(SELECT jsonb_agg(jsonb_build_object('oid',f.oid::text,'name',f.proname||'('||oidvectortypes(f.proargtypes)||')','owner',pg_get_userbyid(f.proowner),'definer',f.prosecdef,'configuration',f.proconfig,'acl',f.proacl::text,'definition',pg_get_functiondef(f.oid)) ORDER BY f.proname) FROM pg_proc f WHERE f.pronamespace='{READ_SCHEMA}'::regnamespace),
      'nonownerPermissions',(
        SELECT count(*) FROM (
          SELECT a.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='{READ_SCHEMA}' AND a.grantee<>n.nspowner
          UNION ALL SELECT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='{READ_SCHEMA}'::regnamespace AND a.grantee<>c.relowner
          UNION ALL SELECT a.grantee FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE c.relnamespace='{READ_SCHEMA}'::regnamespace AND a.grantee<>c.relowner
          UNION ALL SELECT a.grantee FROM pg_proc f CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE f.pronamespace='{READ_SCHEMA}'::regnamespace AND a.grantee<>f.proowner
        ) nonowner))"""


def semantics(target):
    return {key: ([{k: v for k, v in row.items() if k != 'oid'} for row in value]
                  if key in {'relations', 'functions'} else value)
            for key, value in target.items() if key != 'schemaOid'}


def validate_snapshot(p, value, manifest):
    need([value['database'], value['user'], value['port'], value['socket'], value['nativeOid']] ==
         ['yunipals_backfill', 'postgres', '5432', True, '75963410'], 'exact_local_registered_native_owner_required')
    need(value['targetAbsent'] is True and value['runtime'] == {'version': '6', 'buildId': p['buildId'], 'isDev': '0'},
         'fresh_candidate_and_exact_native_build_required')
    row = value['release']
    need(row and row['id'] == p['sourceRelease'] and row['physical_schema'] == p['physicalSchema'] and
         row['build_id'] == p['buildId'] and row['manifest_hash'] == p['manifestHash'] and row['manifest'] == manifest,
         'exact_actual_registered_manifest_required')
    expected = sorted([{'id': source['id'], 'chainId': source['chainId'], 'manifestHash': p['manifestHash'],
                        'definition': source} for source in manifest['sources']], key=lambda row: row['id'])
    need(value['sources'] == expected, 'exact_twelve_native_source_definitions_required')


def validate_target(p, value):
    need(value['schemaOid'] and value['owner'] == 'postgres' and value['nonownerPermissions'] == 0,
         'owner_only_fresh_read_schema_required')
    need(value['marker'] == {'singleton': True, 'identity': p['readIdentity'], 'release_id': p['sourceRelease'],
                            'manifest_hash': p['manifestHash'], 'definitions': p['definitions']}, 'exact_read_identity_marker_required')
    need({row['name']: row['kind'] for row in value['relations']} == RELATIONS and len(value['relations']) == 10 and
         sorted(row['name'] for row in value['functions']) == FUNCTIONS and
         all(row['owner'] == 'postgres' for row in value['relations'] + value['functions']) and
         all(row['definer'] is False and row['configuration'] == ['search_path=pg_catalog'] for row in value['functions']),
         'exact_ten_relations_four_protected_invokers_required')


def owner_sql(p, before, commit=False, expected_target=None):
    writes = []
    for row in p['expectedOwnerStatements']:
        text = row['sql']
        need(text.startswith(('CREATE ', 'INSERT ', 'REVOKE ')) and
             ('"' + READ_SCHEMA + '".' in text or text == 'CREATE SCHEMA "' + READ_SCHEMA + '"'), 'fixed_nineteen_fresh_owner_statements_required')
        if row['params']:
            need(text.startswith('INSERT INTO "' + READ_SCHEMA + '"._unified_read_release(') and
                 len(row['params']) == 4 and all(isinstance(v, str) for v in row['params']), 'exact_marker_parameters_required')
            text = re.sub(r'\$([1-4])\b', lambda match: literal(row['params'][int(match[1]) - 1]), text)
        writes.append(text + ';')
    need(len(writes) == 19 and (not commit or expected_target is not None), 'reviewed_nineteen_write_rehearsal_required')
    old = literal(json.dumps(before)) + '::jsonb'; after = literal(json.dumps({**before, 'targetAbsent': False})) + '::jsonb'
    # Strip only fresh OIDs. Function/view definitions and ACLs remain compared
    # exactly to the actual PostgreSQL rollback rehearsal, not guessed text.
    semantic_sql = f"""WITH t AS ({target_sql(p)}) SELECT jsonb_build_object(
      'owner',v->'owner','marker',v->'marker','nonownerPermissions',v->'nonownerPermissions',
      'relations',(SELECT jsonb_agg(r-'oid' ORDER BY ordinal) FROM jsonb_array_elements(v->'relations') WITH ORDINALITY x(r,ordinal)),
      'functions',(SELECT jsonb_agg(f-'oid' ORDER BY ordinal) FROM jsonb_array_elements(v->'functions') WITH ORDINALITY x(f,ordinal)))
      FROM (SELECT jsonb_build_object AS v FROM t) value"""
    exact = '' if expected_target is None else f"IF ({semantic_sql}) IS DISTINCT FROM {literal(json.dumps(expected_target))}::jsonb THEN RAISE EXCEPTION 'rehearsed_read_objects_changed'; END IF;"
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='40s'; SET LOCAL search_path=pg_catalog;\n"
            + f"SELECT pg_advisory_xact_lock(hashtext('unified-ownership-read-views'),hashtext('{READ_SCHEMA}'));\n"
            + f"DO $before$ BEGIN IF ({snapshot_sql(p)}) IS DISTINCT FROM {old} THEN RAISE EXCEPTION 'reviewed_readview_catalog_changed'; END IF; END $before$;\n"
            + '\n'.join(writes) + '\n'
            + f"DO $after$ BEGIN IF ({snapshot_sql(p)}) IS DISTINCT FROM {after} THEN RAISE EXCEPTION 'previous_source_or_read_schemas_changed'; END IF; {exact} END $after$;\n"
            + target_sql(p) + ';\n' + ('COMMIT;\n' if commit else 'ROLLBACK;\n'))


def query(h, sql, readonly=True):
    sentinel = '/run/yunipals-combined-readview-no-password-file'
    need(not os.path.lexists(sentinel), 'absent_peer_password_file_required')
    options = '-c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=40000 -c search_path=pg_catalog'
    if readonly: options += ' -c default_transaction_read_only=on'
    args = [*h.m.peer(), '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
            'PGPASSFILE=' + sentinel, 'PGOPTIONS=' + options, '/usr/bin/psql', '-XwAtq', '-h', '/var/run/postgresql',
            '-p', '5432', '-U', 'postgres', '-d', 'yunipals_backfill', '-v', 'ON_ERROR_STOP=1']
    raw = h.m.run(args, sql.encode(), timeout=55)
    need(len(raw) <= 2000000, 'bounded_catalog_receipt_required')
    return [json.loads(row) for row in raw.decode().splitlines() if row.strip()]


def review(r, s, h, op, ack, p):
    binding = source_binding(r, s, h, op, ack)
    before = query(h, snapshot_sql(p))[0]
    manifest = json.loads(s.protected(OPS / 'ypal-combined-rpc-v1/profile.json'))['manifest']
    validate_snapshot(p, before, manifest)
    need(source_binding(r, s, h, op, ack) == binding, 'source_changed_during_readview_review')
    value = {'format': FORMAT, 'binding': binding, 'before': before, 'planSha256': PLAN_SHA,
             'registeredReceiptSha256': REGISTER_ACK_SHA, 'artifactInstallReceiptSha256': INSTALL_ACK_SHA,
             'operatorSha256': r.sha(s.protected(Path(__file__).absolute())), 'selected': False, 'grantsChanged': False,
             'servicesChanged': False, 'nativeDataWritten': False, 'providerRequests': 0}
    return {**value, 'reviewHash': r.sha(r.encoded(value))}


def saved_review(r, s, h, op, ack, expected):
    value = s.document(BASE / 'before.json')
    need(value['reviewHash'] == expected == r.sha(r.encoded({k: v for k, v in value.items() if k != 'reviewHash'})) and
         value['operatorSha256'] == r.sha(s.protected(Path(__file__).absolute())), 'exact_saved_readview_review_required')
    need(source_binding(r, s, h, op, ack) == value['binding'], 'same_source_before_readview_operation_required')
    return value


def rehearse(r, s, h, op, ack, p, expected):
    need(not os.path.lexists(BASE), 'fresh_readview_operation_required')
    value = review(r, s, h, op, ack, p); need(value['reviewHash'] == expected, 'fresh_readview_review_hash_required')
    BASE.mkdir(mode=0o700); s.sync(BASE.parent); s.save(BASE / 'before.json', value)
    s.save(BASE / 'rehearsal-intent.json', {'reviewHash': expected, 'bootId': s.boot()})
    rows = query(h, owner_sql(p, value['before']), False); need(len(rows) == 1, 'one_rehearsed_target_required')
    target = rows[0]; validate_target(p, target)
    need(query(h, snapshot_sql(p))[0] == value['before'], 'readview_ddl_rehearsal_must_rollback_exactly')
    need(source_binding(r, s, h, op, ack) == value['binding'], 'source_changed_during_readview_rehearsal')
    result = {'format': FORMAT, 'rehearsed': True, 'reviewHash': expected, 'targetSemantics': semantics(target),
              'officialWriteCount': 19, 'catalogUnchanged': True, 'databaseCommitted': False}
    s.save(BASE / 'rehearsed.json', result); return result


def acknowledge(r, s, h, op, ack, p, before, rehearsal, reconciled=False):
    need(source_binding(r, s, h, op, ack) == before['binding'], 'same_source_before_readview_ack_required')
    current = query(h, snapshot_sql(p))[0]
    need(current == {**before['before'], 'targetAbsent': False}, 'previous_catalog_preserved_after_creation')
    target = query(h, target_sql(p))[0]; validate_target(p, target)
    need(semantics(target) == rehearsal['targetSemantics'], 'exact_actual_rehearsed_readview_objects_required')
    # These existing probes return bounded readiness metadata, never token rows.
    probes = query(h, f"SELECT jsonb_build_object('collections',(SELECT jsonb_agg({READ_SCHEMA}.source_probe(c) ORDER BY c) FROM unnest(ARRAY[" +
                   ','.join(literal(row['collection']) for row in p['definitions']) +
                   f"]) c),'baseMetadataReady',{READ_SCHEMA}.base_metadata_probe())")[0]
    value = {'format': FORMAT, 'created': True, 'reviewHash': before['reviewHash'], 'readSchema': READ_SCHEMA,
             'readIdentity': READ_IDENTITY, 'sourceRelease': p['sourceRelease'], 'registeredReceiptSha256': REGISTER_ACK_SHA,
             'sourceReceiptSha256': r.SOURCE_ACK_SHA, 'target': target, 'readonlyBoundaries': probes,
             'reconciledAfterUnknownAck': reconciled, 'officialWriteCount': 19, 'selected': False,
             'grantsChanged': False, 'servicesChanged': False, 'nativeDataWritten': False, 'providerRequests': 0}
    s.save(BASE / 'created.json', value); return value


def commit(r, s, h, op, ack, p, expected):
    value = saved_review(r, s, h, op, ack, expected); rehearsal = s.document(BASE / 'rehearsed.json')
    need(rehearsal['rehearsed'] is True and rehearsal['catalogUnchanged'] is True and rehearsal['reviewHash'] == expected,
         'successful_exact_readview_rehearsal_required')
    need(not any((BASE / name).exists() for name in ['commit-intent.json', 'created.json', 'failed.json']), 'one_readview_creation_attempt_only')
    need(query(h, snapshot_sql(p))[0] == value['before'], 'catalog_changed_before_readview_creation')
    s.save(BASE / 'commit-intent.json', {'reviewHash': expected, 'bootId': s.boot(), 'planSha256': PLAN_SHA,
                                     'rehearsalSha256': r.sha(s.protected(BASE / 'rehearsed.json')), 'automaticRetryAllowed': False})
    try:
        rows = query(h, owner_sql(p, value['before'], True, rehearsal['targetSemantics']), False)
        need(len(rows) == 1, 'single_committed_target_ack_required')
        validate_target(p, rows[0])
        return acknowledge(r, s, h, op, ack, p, value, rehearsal)
    except BaseException:
        s.save(BASE / 'failed.json', {'format': FORMAT, 'commitOutcomeMayBeUnknown': True, 'reviewHash': expected, 'automaticRetryAllowed': False})
        raise


def reconcile(r, s, h, op, ack, p, intent_sha):
    intent = s.document(BASE / 'commit-intent.json', intent_sha)
    need(intent['bootId'] == s.boot() and intent['planSha256'] == PLAN_SHA and not (BASE / 'created.json').exists(), 'owned_same_boot_readview_intent_required')
    value = saved_review(r, s, h, op, ack, intent['reviewHash'])
    rehearsal = s.document(BASE / 'rehearsed.json', intent['rehearsalSha256'])
    return acknowledge(r, s, h, op, ack, p, value, rehearsal, True)


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    group.add_argument('--rehearse'); group.add_argument('--commit'); group.add_argument('--reconcile')
    args = parser.parse_args(); need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_production_owner_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError('bounded_readview_owner_expired'))); signal.alarm(180)
    r, s, h, op, ack, p = load()
    with s.transition_lock():
        fn, value = (rehearse, args.rehearse) if args.rehearse else (commit, args.commit) if args.commit else (reconcile, args.reconcile) if args.reconcile else (review, None)
        print(json.dumps(fn(r, s, h, op, ack, p, *([value] if value else [])), sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
