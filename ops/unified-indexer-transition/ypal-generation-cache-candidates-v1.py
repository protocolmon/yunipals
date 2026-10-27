#!/usr/bin/env python3
"""Prepare dormant generation/cache selectors; never run or select a writer."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = 'yunipals-ypal-generation-cache-candidates-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-generation-cache-candidates-v1-20261024')
META_FILE = OPS / 'ypal-native-metadata-candidates-v1.py'
META_SHA = '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525'
MANIFEST_SHA = '6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801'
LEADERBOARD = 'yunipals-leaderboard.service'
CACHE = 'yunipals-read-cache.service'
SELECTORS = {LEADERBOARD: 'yunipals-leaderboard.selectors.env', CACHE: 'yunipals-read-cache.ownership.env'}
FILES = tuple(name for unit, env in SELECTORS.items() for name in (env, unit + '.drop-in.candidate'))
CLOSURE = ('scripts/refresh-leaderboard.ts', 'scripts/migrate-read-cache.ts',
    'lib/leaderboard/refresh.ts', 'lib/leaderboard/worker.ts', 'lib/metadata/projection-refresh.ts',
    'lib/metadata/read-cache-worker.ts', 'lib/metadata/read-cache.ts', 'lib/metadata/read-cache-schema.ts',
    'lib/metadata/chain-readiness.ts', 'lib/metadata/read-source.ts', 'lib/ownership/readiness.ts',
    'lib/offchain/db.ts', 'lib/constants.ts')
CACHE_PROPS = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'User', 'Group',
    'FragmentPath', 'DropInPaths', 'WorkingDirectory', 'EnvironmentFiles', 'UnitFileState',
    'Restart', 'TriggeredBy', 'Triggers', 'WantedBy', 'RequiredBy', 'Job')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def metadata():
    for path in [*META_FILE.parents, META_FILE]:
        st = path.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             'protected_exact_metadata_preparer_required')
    raw = META_FILE.read_bytes(); need(len(raw) < 100000 and sha(raw) == META_SHA, 'exact_metadata_preparer_required')
    value = types.ModuleType('generation_metadata_dependency'); value.__file__ = str(META_FILE)
    exec(compile(raw, str(META_FILE), 'exec'), value.__dict__)
    return value


def retarget(meta, unit, before):
    need(unit in SELECTORS, 'only_fixed_generation_cache_units_allowed')
    allowed = set(meta.REPIN) - {'PONDER_RPC_URL_8453'}
    required = allowed if unit == LEADERBOARD else allowed - {'UNIFIED_INDEXER_RELEASE_ID'}
    need(required <= before.keys() and (unit != CACHE or 'UNIFIED_INDEXER_RELEASE_ID' not in before),
         'exact_existing_generation_cache_selector_shape_required')
    need(before.get('OWNERSHIP_READ_MODE') == 'unified' and before.get('BASE_METADATA_INGESTION') == 'native' and
         before.get('METADATA_SOURCE_MODE') == 'archive' and before.get('YUNIPALS_PROJECTION_MODE') == 'generation',
         'retained_generation_cache_modes_required')
    need('PONDER_RPC_URL_8453' not in before and 'DATABASE_URL' not in before and
         'UNIFIED_INDEXER_DATABASE_URL' not in before, 'public_selectors_without_new_credentials_or_rpc_required')
    result = dict(before)
    for key in required:
        old, new = meta.REPIN[key]
        need(result.get(key) == old, 'exact_old_generation_cache_selector_required')
        result[key] = new
    need({key for key in result if result[key] != before[key]} == required,
         'only_existing_public_generation_cache_selectors_may_change')
    return result


def render(meta, m, originals):
    result = {}
    for unit, env_name in SELECTORS.items():
        before = m.parse_env(originals[env_name])
        allowed = set(m.PUBLIC) | ({'OFFCHAIN_DB_POOL_MAX', 'API_DB_POOL_MAX'} if unit == CACHE else set())
        need(set(before) == allowed - ({'UNIFIED_INDEXER_RELEASE_ID'} if unit == CACHE else set()),
             'exact_public_selector_keyset_required')
        after = retarget(meta, unit, before)
        result[env_name] = m.env_bytes(after); m.node_roundtrip(after, result[env_name])
        name = unit + '.drop-in.candidate'; raw = originals[name]
        entry = 'lib/leaderboard/worker.ts' if unit == LEADERBOARD else 'lib/metadata/read-cache-worker.ts'
        command = ('ExecStart=' + m.NODE + ' --import tsx ' + str(m.PROJECT / entry) + '\n').encode()
        need(raw.count(command) == 1, 'same_accepted_official_worker_entry_required')
        old = ('EnvironmentFile=' + str(meta.PREVIOUS / env_name) + '\n').encode()
        new = ('EnvironmentFile=' + str(BASE / env_name) + '\n').encode()
        need(raw.count(old) == 1, 'one_owned_dormant_selector_path_required')
        result[name] = raw.replace(old, new, 1)
    return result


def cache_snapshot(m):
    r = subprocess.run(['/usr/bin/systemctl', 'show', '--all', CACHE,
         *['--property=' + key for key in CACHE_PROPS]], capture_output=True, timeout=8, env=m.CLEAN, cwd='/')
    need(r.returncode == 0 and not r.stderr and len(r.stdout) < 20000, 'bounded_public_cache_state_required')
    value = {}
    for line in r.stdout.decode().splitlines():
        key, sep, val = line.partition('=')
        need(sep and key in CACHE_PROPS, 'fixed_public_cache_state_keys_required')
        if key == 'EnvironmentFiles': value.setdefault(key, []).append(val)
        else:
            need(key not in value, 'unique_cache_state_properties_required'); value[key] = val
    need(set(value) == set(CACHE_PROPS) and value['Id'] == CACHE and value['LoadState'] == 'loaded' and
         value['ActiveState'] == 'active' and value['SubState'] == 'running' and value['Job'] == '' and
         re.fullmatch('[1-9][0-9]*', value['MainPID']) and re.fullmatch('[0-9a-f]{32}', value['InvocationID']) and
         value['FragmentPath'] == '/etc/systemd/system/' + CACHE and value['DropInPaths'] == '' and
         value['WorkingDirectory'] == '/opt/yunipals-read-cache/releases/3d36d9b' and
         value['EnvironmentFiles'] == ['/etc/yunipals-indexer/read-cache.env (ignore_errors=no)'],
         'same_legacy_cache_layout_required')
    files = {path: sha(m.protected(path)) for path in [value['FragmentPath'], '/etc/yunipals-indexer/read-cache.env']}
    inline = {key: sha(encoded(m.service_property(CACHE, key))) for key in ['Environment', 'PassEnvironment', 'UnsetEnvironment']}
    pid = value['MainPID']; actor = m.process(pid)
    argv_sha = sha((Path('/proc') / pid / 'cmdline').read_bytes())
    need(m.process(pid) == actor, 'cache_process_changed_during_snapshot')
    return {'unit': CACHE, 'state': value, 'process': actor, 'inputHashes': files,
            'managerEnvironmentHashes': inline, 'argvSha256': argv_sha}


def context_sql(meta):
    return f"""SELECT jsonb_build_object('at',clock_timestamp(),
      'generation',(SELECT jsonb_build_object('id',g.id::text,'state',g.state,'release',g.ownership_release_id,'identity',g.ownership_read_identity)
        FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id WHERE a.singleton),
      'guards',(SELECT jsonb_agg(jsonb_build_object('collection',g.collection,'relation',g.relation,'oid',g.relation_oid::text,
        'schema',n.nspname,'owner',c.relowner::text,'triggers',(SELECT jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'functionOid',t.tgfoid::text)
          ORDER BY t.tgname)FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND t.tgname LIKE 'read_cache_%'))ORDER BY g.collection,g.relation)
        FROM metadata_projection.read_guard g LEFT JOIN pg_class c ON c.oid=g.relation_oid LEFT JOIN pg_namespace n ON n.oid=c.relnamespace),
      'epochCount',(SELECT count(*)FROM metadata_projection.read_epoch),
      'cacheRole',(SELECT jsonb_build_object('name',rolname,'oid',oid::text,'login',rolcanlogin,'limit',rolconnlimit,'super',rolsuper,
        'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls)FROM pg_roles WHERE oid=73187673),
      'baseProbe',{meta.READ}.base_metadata_probe())"""


def legacy_facts(value):
    need(value['generation'] == {'id': '103', 'state': 'ready', 'release': None, 'identity': None},
         'historical_generation103_must_remain_unlabelled')
    guards = value['guards']
    need(len(guards) == 35 and len({(g['collection'], g['relation']) for g in guards}) == 35 and
         sum(g['schema'] in {'yunipals_indexer_v3', 'bnb_indexer'} for g in guards) == 12 and
         not any(g['schema'] in {'unified_shadow_20261020_7e7375b0', 'unified_ypal_20261023_v1'} for g in guards) and
         value['epochCount'] == 4, 'unchanged_legacy35_guard_graph_required')
    role = value['cacheRole']
    need(role == {'name': 'yunipals_unified_read_cache', 'oid': '73187673', 'login': False, 'limit': 6,
                  'super': False, 'createDb': False, 'createRole': False, 'replication': False, 'bypassRls': False},
         'same_dormant_restricted_cache_role_required')
    return {'generation': value['generation'], 'guards': guards, 'epochCount': 4, 'cacheRole': role}


def prepare(check_absent=True):
    meta = metadata(); s, h, m, installer, reader, op, source, created = meta.load(meta.READ_RESULT_SHA)
    if check_absent: need(not os.path.lexists(BASE), 'fresh_dormant_generation_cache_directory_required')
    meta.source_guard(s, h, op, source)
    prior = s.document(meta.PREVIOUS / 'result.json', meta.PREVIOUS_SHA)
    need(prior['staged'] is True and prior['readSchema'] == meta.OLD_READ, 'acknowledged_old_dormant_candidates_required')
    originals = {name: m.protected(meta.PREVIOUS / name) for name in FILES}
    need(all(sha(raw) == prior['files'][name] for name, raw in originals.items()), 'old_dormant_generation_cache_payload_changed')
    files = render(meta, m, originals)
    manifest = m.document(m.ROOT / 'RELEASE-MANIFEST.json', MANIFEST_SHA); rows = {row['path']: row for row in manifest['files']}
    closure = []
    for rel in CLOSURE:
        row = rows['apps/yunipals-indexer/' + rel]; raw = m.protected(m.PROJECT / rel)
        need(sha(raw) == row['sha256'] and len(raw) == row['bytes'], 'accepted_official_generation_cache_source_changed')
        closure.append({'path': rel, 'sha256': sha(raw), 'bytes': len(raw)})
    leader = m.snapshot(LEADERBOARD)[0]; cache = cache_snapshot(m)
    target = h.query(reader.target_sql({'physicalSchema': meta.PHYSICAL}))
    need(meta.target_identity(target) == meta.target_identity(created['target']), 'fresh_readview_identity_changed')
    observation = h.query(context_sql(meta)); facts = legacy_facts(observation)
    binding = {'format': FORMAT, 'operatorSha256': sha(s.protected(Path(__file__).absolute())), 'bootId': s.boot(),
        'metadataPreparerSha256': META_SHA, 'previousCandidateReceiptSha256': meta.PREVIOUS_SHA,
        'sourceResultSha256': meta.SOURCE_RESULT_SHA, 'sourceOperationSha256': meta.SOURCE_OPERATION_SHA,
        'readviewResultSha256': meta.READ_RESULT_SHA, 'readSchema': meta.READ, 'readIdentity': meta.IDENTITY,
        'sourceRelease': meta.RELEASE, 'physicalSchema': meta.PHYSICAL,
        'currentReadCatalogSha256': sha(encoded(target)), 'originalGenerationWriter': leader, 'originalCacheWriter': cache,
        'retainedLegacyFacts': facts, 'acceptedSourceDigest': m.SOURCE, 'acceptedSourceManifestSha256': MANIFEST_SHA,
        'officialSourceClosure': closure, 'metadataArtifactDigest': installer.DIGEST,
        'metadataInstallReceiptSha256': meta.INSTALL_SHA, 'files': {name: sha(raw) for name, raw in files.items()},
        'selectorChanges': {LEADERBOARD: 5, CACHE: 4}, 'privateEnvironmentFilesCopied': False,
        'sourceCodeOrExecutableChanged': False, 'existingDatabaseAndPrivateSelectorsPreserved': True}
    need(m.snapshot(LEADERBOARD)[0] == leader and cache_snapshot(m) == cache, 'original_writers_changed_during_dormant_review')
    meta.source_guard(s, h, op, source)
    return s, binding, observation, files


def stage(s, binding, files):
    BASE.mkdir(mode=0o700); s.sync(BASE.parent); s.save(BASE / 'intent.json', binding)
    for name, raw in files.items(): s.save(BASE / name, raw, 0o600)
    _, again, _, outputs = prepare(check_absent=False)
    need(again == binding and outputs == files, 'generation_cache_inputs_changed_during_dormant_stage')
    need(all(s.protected(BASE / name) == raw for name, raw in files.items()), 'dormant_generation_cache_file_changed')
    return s.save(BASE / 'result.json', {**binding, 'staged': True, 'selected': False, 'generationStarted': False,
        'cacheStarted': False, 'guardTransitionExecuted': False, 'databaseWrites': 0, 'servicesChanged': False,
        'providerRequests': 0, 'permissionAdmissionAcknowledged': False})


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--stage'); a = p.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_production_host_required')
    os.umask(0o077); s, binding, observation, files = prepare(); review = sha(encoded(binding))
    pin = None
    if a.stage:
        need(a.stage == review, 'exact_fresh_dormant_generation_cache_review_required'); pin = stage(s, binding, files)
    print(json.dumps({'format': FORMAT, 'binding': binding, 'reviewHash': review, 'observation': observation,
        'staged': a.stage is not None, 'resultSha256': pin, 'databaseWrites': 0, 'servicesChanged': False,
        'providerRequests': 0, 'privateValuesExported': False, 'futureGenerationGuardAndInstallOwnersRequired': True}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_dormant_candidate_review_expired')); signal.alarm(120)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'private_diagnostics_withheld'}))
        raise SystemExit(1)
    finally: signal.alarm(0)
