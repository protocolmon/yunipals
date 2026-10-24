#!/usr/bin/env python3
"""Prepare only fresh-release metadata candidates; never adopt or select a worker.

Default captures real readonly source/writer/cursor/publication/role context.
--stage copies the authenticated existing private environment with only six
public selectors changed. Old candidates, credentials and all live units stay.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
from urllib.parse import unquote, urlsplit

FORMAT = 'yunipals-ypal-native-metadata-candidates-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-native-metadata-candidates-v1-20261023')
PREVIOUS = Path('/var/backups/yunipals-metadata-readview-v4-candidates-v1-20261022')
PREVIOUS_SHA = 'be0e6ec9f39d9b967a5395a7955496be801a04dc26cf90f3ce7173941e8591a0'
PREVIOUS_ENV_SHA = 'bba7312f878d828df49d23b1bb8c5245fe196f477cd9cf8e05a953af01599cb0'
SOURCE_OWNER = OPS / 'ypal-combined-source-v1-stage/start-source.py'
SOURCE_OWNER_SHA = '3a70a1167f7e8ffcc73689bc8f0b668319ad1801801c4b403fc791998a7686f6'
SOURCE_OPERATION_SHA = 'a80ce9cca2da0dd5e40958db16e65f46e82ea859e861cfb110407e4bf93b9336'
SOURCE_RESULT_SHA = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
READ_OWNER = OPS / 'ypal-combined-readview-owner-v1.py'
READ_OWNER_SHA = '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058'
READ_BASE = Path('/var/backups/yunipals-ypal-combined-readview-owner-v1-20261023')
READ_RESULT_SHA = '17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3'
RETAINED_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
INSTALLER_SHA = '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab'
INSTALL_SHA = '14ca61dac4a1c8ec86f5b64ecbe701a572b2c972fac807c8054a299aed522b83'
UNIT = 'yunipals-metadata.service'
OLD_RELEASE = '0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
OLD_PHYSICAL = 'unified_shadow_20261020_7e7375b0'
PHYSICAL = 'unified_ypal_20261023_v1'
OLD_READ = 'yunipals_ownership_35cdcb32_v4'
READ = 'yunipals_ownership_4e77f52b_v4'
IDENTITY = '0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67'
REPIN = {'DATABASE_SCHEMA': (OLD_PHYSICAL, PHYSICAL), 'READ_DATABASE_SCHEMA': (OLD_READ, READ),
         'OWNERSHIP_READ_SCHEMA': (OLD_READ, READ), 'OWNERSHIP_RELEASE_ID': (OLD_RELEASE, RELEASE),
         'UNIFIED_INDEXER_RELEASE_ID': (OLD_RELEASE, RELEASE),
         'PONDER_RPC_URL_8453': ('http://127.0.0.1:19202/', 'http://127.0.0.1:19222/')}
FILES = ('native-recovery.env', 'native-recovery.sh', 'yunipals-metadata.selectors.env',
         'yunipals-metadata.service.drop-in.candidate')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def retarget(env):
    need(env.get('OWNERSHIP_READ_MODE') == 'unified' and env.get('BASE_METADATA_INGESTION') == 'native' and
         env.get('METADATA_SOURCE_MODE') == 'archive' and env.get('YUNIPALS_PROJECTION_MODE') == 'generation',
         'exact_retained_native_metadata_modes_required')
    result = dict(env)
    for key, (old, new) in REPIN.items():
        need(result.get(key) == old, 'exact_previous_metadata_selector_required')
        result[key] = new
    need({k for k in result if result[k] != env[k]} == set(REPIN), 'only_six_metadata_selectors_may_change')
    return result


def same_private_configuration(native, current, public_keys):
    keys = set(native) | set(current)
    need(all(native.get(k) == current.get(k) for k in keys - set(public_keys)),
         'retained_private_configuration_no_longer_matches_live_writer')


def database_identity(env):
    need('UNIFIED_INDEXER_DATABASE_URL' not in env, 'no_new_source_database_credentials_required')
    value = urlsplit(env['DATABASE_URL'])
    need(value.scheme in {'postgres', 'postgresql'} and unquote(value.username or '') == 'yunipals' and
         value.hostname in {'localhost', '127.0.0.1'} and (value.port or 5432) == 5432 and
         unquote(value.path[1:]) == 'yunipals_backfill', 'same_local_metadata_database_and_actor_required')
    return {'role': 'yunipals', 'roleOid': '16388', 'database': 'yunipals_backfill', 'databaseOid': '17584',
            'port': 5432, 'newPasswordOrDatabaseUrl': False, 'unifiedDatabaseUrlStillAbsent': True}


def replace_exact(raw, old, new, count):
    need(raw.count(old) == count, 'exact_prior_candidate_path_occurrences_required')
    return raw.replace(old, new)


def render(m, originals):
    old_env = m.parse_env(originals['native-recovery.env']); native = retarget(old_env)
    need(native.get('PONDER_RPC_URL_8453') == 'http://127.0.0.1:19222/',
         'combined_point_read_root_route_required')
    db = database_identity(native)
    env_raw = m.env_bytes(native); m.node_roundtrip(native, env_raw)
    selectors = retarget(m.parse_env(originals['yunipals-metadata.selectors.env']))
    files = {'native-recovery.env': env_raw, 'yunipals-metadata.selectors.env': m.env_bytes(selectors),
             'native-recovery.sh': replace_exact(originals['native-recovery.sh'],
                str(PREVIOUS / 'native-recovery.env').encode(), str(BASE / 'native-recovery.env').encode(), 2),
             'yunipals-metadata.service.drop-in.candidate': replace_exact(originals['yunipals-metadata.service.drop-in.candidate'],
                str(PREVIOUS / 'yunipals-metadata.selectors.env').encode(), str(BASE / 'yunipals-metadata.selectors.env').encode(), 1)}
    need(all(native.get(k) == old_env.get(k) for k in set(old_env) - set(REPIN)), 'private_values_must_remain_identical')
    return files, db, old_env


def target_identity(target):
    """Object OIDs/definitions are immutable; actual current ACLs are separate facts."""
    return {k: ([{a: b for a, b in row.items() if a != 'acl'} for row in v]
                if k in {'relations', 'functions'} else v)
            for k, v in target.items() if k != 'nonownerPermissions'}


def context_sql():
    return f"""SELECT jsonb_build_object('databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
      'role',(SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit)FROM pg_roles WHERE oid=16388),
      'scan',(SELECT jsonb_build_object('chainId',chain_id,'contract',contract_address,'deploymentBlock',deployment_block::text,'nextBlock',next_block::text,'ingestionMode',ingestion_mode)FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'),
      'nativeApprovals',(SELECT coalesce(jsonb_agg(jsonb_build_object('releaseId',release_id,'readIdentity',read_identity,'state',state,'checkedBlock',checked_block::text,'checkedAt',checked_at,'errorPresent',error_code IS NOT NULL)),'[]'::jsonb)FROM metadata_source.native_base_metadata_state),
      'publication',(SELECT jsonb_build_object('baseErrorPresent',base_error IS NOT NULL,'baseCheckedAt',base_checked_at,'lastWorkerAt',last_worker_at)FROM metadata.publication_runtime WHERE singleton),
      'publicationCounts',(SELECT jsonb_build_object('baseRows',count(*),'baseWithoutNativeHash',count(*)FILTER(WHERE chain_event_block_hash IS NULL),'published',count(*)FILTER(WHERE publication_status='published'))FROM metadata.token_publication WHERE collection='base'),
      'baseProbe',{READ}.base_metadata_probe(),
      'requiredReadPermissions',(SELECT jsonb_agg(jsonb_build_object('kind',kind,'object',object,'allowed',allowed)ORDER BY kind,object)FROM(
       SELECT 'schema'AS kind,x AS object,has_schema_privilege(16388,x,'USAGE')AS allowed FROM unnest(ARRAY['{PHYSICAL}','{READ}','yunipals_indexer_control'])x
       UNION ALL SELECT 'relation',x,has_table_privilege(16388,x,'SELECT')FROM unnest(ARRAY['{PHYSICAL}._ponder_meta','{PHYSICAL}._ponder_checkpoint','{PHYSICAL}.indexer_source','{PHYSICAL}.chain_block','{PHYSICAL}.canonical_event','yunipals_indexer_control.release','yunipals_indexer_control.chain_status','{READ}._unified_read_release'])x
       UNION ALL SELECT 'function',x,has_function_privilege(16388,x,'EXECUTE')FROM unnest(ARRAY['{READ}.source_boundary(text)','{READ}.base_metadata_frame(boolean)'])x)r))"""


def load(read_pin):
    import stat, types
    need(read_pin == READ_RESULT_SHA, 'exact_created_readview_acknowledgement_required')
    for path in [*SOURCE_OWNER.parents, SOURCE_OWNER]:
        st = path.lstat(); need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
                               'protected_actual_source_owner_required')
    raw = SOURCE_OWNER.read_bytes(); need(sha(raw) == SOURCE_OWNER_SHA, 'exact_actual_source_owner_required')
    s = types.ModuleType('combined_metadata_source'); s.__file__ = str(SOURCE_OWNER)
    exec(compile(raw, str(SOURCE_OWNER), 'exec'), s.__dict__)
    op = s.load_operation(SOURCE_OPERATION_SHA); source = s.document(s.BASE / 'result.json', SOURCE_RESULT_SHA)
    h = s.Host(op['rpcOwnerSha256'], op['rpcResultSha256'], op['hostBuildResultSha256'])
    m = s.module(OPS / 'retained-workers-stage-v1.py', RETAINED_SHA)
    installer = s.module(OPS / 'metadata-normalization-runtime-install-v1.py', INSTALLER_SHA)
    installer.installed(m, INSTALL_SHA)
    read_owner = s.module(READ_OWNER, READ_OWNER_SHA)
    created = s.document(READ_BASE / 'created.json', read_pin)
    need(created['format'] == read_owner.FORMAT and created['created'] is True and created['readSchema'] == READ and
         created['readIdentity'] == IDENTITY and created['sourceRelease'] == RELEASE and
         created['sourceReceiptSha256'] == SOURCE_RESULT_SHA and created['selected'] is False,
         'actual_unselected_fresh_readview_receipt_required')
    return s, h, m, installer, read_owner, op, source, created


def source_guard(s, h, op, source):
    s.check_preserved(h, op); h.old_terminal(op)
    need(s.new_owned(h, op, True) == source['source'], 'same_acknowledged_combined_source_required')


def prepare(read_pin):
    s, h, m, installer, read_owner, op, source, created = load(read_pin)
    need(not os.path.lexists(BASE), 'fresh_private_metadata_candidate_directory_required')
    source_guard(s, h, op, source)
    prior = s.document(PREVIOUS / 'result.json', PREVIOUS_SHA)
    originals = {name: m.protected(PREVIOUS / name) for name in FILES}
    need(prior['staged'] is True and prior['readSchema'] == OLD_READ and prior['readIdentity'] ==
         '0x3a9ad87513ba12bffb9862ef9d408774e9ceae3480ace1293ffca3b81d97e00d' and
         all(sha(raw) == prior['files'][name] for name, raw in originals.items()) and
         sha(originals['native-recovery.env']) == PREVIOUS_ENV_SHA, 'exact_old_dormant_metadata_candidates_required')
    files, db, old_env = render(m, originals)
    writer, current_env = m.snapshot(UNIT)
    same_private_configuration(old_env, current_env, {*m.PUBLIC, 'PONDER_RPC_URL_8453'})
    target = h.query(read_owner.target_sql({'physicalSchema': PHYSICAL}))
    need(target_identity(target) == target_identity(created['target']), 'current_readview_oids_and_definitions_changed')
    observation = h.query(context_sql())
    need(observation['databaseOid'] == '17584' and observation['role']['oid'] == '16388' and
         observation['role']['name'] == 'yunipals' and observation['scan']['ingestionMode'] == 'rpc',
         'actual_legacy_metadata_actor_and_rpc_cursor_required')
    binding = {'format': FORMAT, 'operatorSha256': sha(s.protected(Path(__file__).absolute())),
               'bootId': s.boot(), 'previousReceiptSha256': PREVIOUS_SHA, 'previousPrivateEnvSha256': PREVIOUS_ENV_SHA,
               'sourceResultSha256': SOURCE_RESULT_SHA, 'sourceOperationSha256': SOURCE_OPERATION_SHA,
               'readviewResultSha256': read_pin, 'readSchema': READ, 'readIdentity': IDENTITY,
               'sourceRelease': RELEASE, 'physicalSchema': PHYSICAL, 'database': db,
               'role': observation['role'], 'oldWriter': writer, 'currentReadCatalogSha256': sha(encoded(target)),
               'artifactInstallReceiptSha256': INSTALL_SHA, 'artifactDigest': installer.DIGEST,
               'files': {name: sha(raw) for name, raw in files.items()}, 'changedPrivateEnvironmentKeys': sorted(REPIN),
               'allOtherEnvironmentValuesPreserved': True, 'unifiedDatabaseUrlStillAbsent': True}
    need(m.snapshot(UNIT)[0] == writer, 'legacy_metadata_writer_changed_during_candidate_review')
    source_guard(s, h, op, source)
    missing = [row for row in observation['requiredReadPermissions'] if not row['allowed']]
    return s, m, binding, observation, files, {'permissionsReady': not missing, 'missingReads': missing,
        'baseProbe': observation['baseProbe'], 'adoptionAccepted': False, 'writerSelectionChanged': False,
        'permissionAdmissionAcknowledged': False,
        'oldWriterDrainRequired': True, 'actualCurrentBaseCoverageRequired': True, 'providerPointChecksRequiredForAdoption': True}


def stage(s, m, binding, files, read_pin):
    BASE.mkdir(mode=0o700); s.sync(BASE.parent); s.save(BASE / 'intent.json', binding)
    for name, raw in files.items(): s.save(BASE / name, raw, 0o700 if name.endswith('.sh') else 0o600)
    for name, raw in files.items(): need(s.protected(BASE / name) == raw, 'staged_private_metadata_candidate_changed')
    need(m.snapshot(UNIT)[0] == binding['oldWriter'], 'legacy_metadata_writer_changed_during_stage')
    again, h, _, _, read_owner, op, source, _ = load(read_pin)
    source_guard(again, h, op, source)
    need(sha(encoded(h.query(read_owner.target_sql({'physicalSchema': PHYSICAL})))) ==
         binding['currentReadCatalogSha256'], 'readview_catalog_changed_during_metadata_stage')
    need(h.query(context_sql())['role'] == binding['role'], 'metadata_role_changed_during_candidate_stage')
    need(sha(m.protected(PREVIOUS / 'native-recovery.env')) == PREVIOUS_ENV_SHA,
         'original_private_candidate_changed_during_stage')
    value = {**binding, 'staged': True, 'selected': False, 'adopted': False, 'databaseWrites': 0,
             'servicesChanged': False, 'providerRequests': 0, 'originalCandidatesModified': False}
    return s.save(BASE / 'result.json', value)


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--readview-result-sha', required=True)
    p.add_argument('--stage'); a = p.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_production_host_required')
    need(a.readview_result_sha == READ_RESULT_SHA, 'exact_created_readview_acknowledgement_required')
    os.umask(0o077)
    s, m, binding, observation, files, eligibility = prepare(a.readview_result_sha)
    review = sha(encoded(binding)); result = None
    if a.stage:
        need(a.stage == review, 'exact_fresh_metadata_candidate_review_required')
        result = stage(s, m, binding, files, a.readview_result_sha)
    print(json.dumps({'format': FORMAT, 'binding': binding, 'reviewHash': review, 'observation': observation,
                      'eligibility': eligibility, 'staged': a.stage is not None, 'resultSha256': result,
                      'databaseWrites': 0, 'servicesChanged': False, 'providerRequests': 0,
                      'privateValuesExported': False}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_candidate_review_expired')); signal.alarm(120)
    try: main()
    except Exception as e:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(e).__name__,
                          'fixedCode': str(e) if type(e) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(e)) else 'private_diagnostics_withheld'}))
        raise SystemExit(1)
    finally: signal.alarm(0)
