#!/usr/bin/env python3
"""Explicit managed EVM/Solana transition. No SQL writes or provider client.

The root-private input is an actual, reviewed ownership inventory, not a source
of readiness booleans. Completed reader/feature/Arena leaves are re-executed.
No old source actor or observer acknowledgement is relabelled after takeover.
"""
import argparse
import contextlib
import copy
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-ypal-managed-handover-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-ypal-managed-handover-v1-20261024')
INPUT = Path('/var/backups/yunipals-ypal-managed-handover-input-v1-20261024/input.json')
MANIFEST = OPS / 'ypal-managed-handover-v1.manifest.json'
STAGE = OPS / 'ypal-managed-indexer-v1'
SYSTEM = Path('/etc/systemd/system')
HOLD = SYSTEM / '.ypal-managed-handover-v1'
LOCK = Path('/run/lock/yunipals-ypal-combined-transition.lock')
PARENT = 'yunipals-indexer.service'
SOURCE = 'yunipals-ypal-combined-source.service'
OBSERVER = 'yunipals-combined-ordinary-observer.service'
SOLANA = 'yunipals-solana.service'
METADATA = 'yunipals-metadata.service'
WRITERS = (SOURCE, SOLANA, PARENT, 'yunipals-unified-source6-free-v2.service',
           'yunipals-booster-ypal-source.service', 'yunipals-booster-launch.service',
           'yunipals-bnb.service', 'yunipals-islands-indexer.service',
           'yunipals-base-islands-v2.service')
UNITS = (*WRITERS, OBSERVER)
NODE = '/opt/node-v24.18.1/bin/node'
PROJECT = '/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'
SOLANA_PROJECT = '/var/lib/yunipals-unified-shadow/20261020-008028af-a/apps/yunipals-indexer'
ENV_FILES = ('/var/lib/yunipals-unified-shadow/20261020-008028af-a/launch.env',
             str(OPS / 'source6-free-runtime-v2.env'),
             str(OPS / 'ypal-combined-source-v1-stage/combined.public.env'),
             '/etc/yunipals-unified/solana.env')
SCHEMA = 'unified_ypal_20261023_v1'
BUILD = '71e2a7f3b7'
RELEASE = '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3'
READ = 'yunipals_ownership_4e77f52b_v4'
SOURCE_ACK = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
PINS = {
    'launcher.mjs': 'd3e849e2f05a7c33c7164d649c6f1db28f6a70202b3308dada3989be634bc321',
    'service.public.env': '0fe3a64a989f61fe5394e9089dc3c3302f6bc7321f901b31b9f22e776952d33a',
    'yunipals-indexer.service.example': '16f2f4d84999d8f26cfeb9b30d38c6385d66ce6f6018f8b4343c21d80e6f0f59'
}
REGISTER_SHA = 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d'
OBSERVER_SHA = 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6'
FEATURE_SHA = 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e'
SQL_SHA = '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0'
CATALOG_SHA = 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991'
COLUMN_SQL_SHA = '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264'
SOLANA_STAGE = Path('/opt/yunipals-unified/operations/solana-consolidation-20261021')
SOLANA_STAGE_ACK = '35093ff3fee4532b29e017f91451bde8f7fb4deeafeff4f80524e81647dd4a60'
SOLANA_AUTH = OPS / 'solana-child-sandbox-auth-v2-20261022/result.json'
SOLANA_AUTH_PROGRAM_SHA = '8a4f6acc3b0b8225ab780c83b1842bc1d4f56facf606f4f37d9d37fa202a1076'
HELIUS_SHA = '8a3011e5bcbcf84638738ecfd2781550d0b8343979cd9e5a284b2de8e0e40ab7'
MANIFEST_CHECKSUM = 'f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07'
CIDRS = {'104.18.36.169/32', '172.64.151.87/32',
         '2606:4700:440d::6812:24a9/128', '2a06:98c1:3104::ac40:9757/128'}
SOLANA_SOURCES = ('lib/solana/worker.ts', 'lib/solana/budget.ts', 'lib/solana/das.ts', 'lib/offchain/db.ts',
                  'lib/metadata/publication.ts', 'lib/metadata/source/read.ts', 'lib/metadata/source/canonical.ts',
                  'lib/metadata/source/ejson.ts', 'lib/metadata/render/legacy.cjs', 'lib/metadata/render/origins.ts',
                  'lib/metadata/render/snapshot.ts', 'lib/rarity/calculate.ts', 'lib/rarity/legacy.cjs')
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
KEYS = ('Id LoadState ActiveState SubState MainPID ControlPID InvocationID ControlGroup '
        'FragmentPath DropInPaths Job NRestarts User Group ExecStart WorkingDirectory '
        'ExecMainStartTimestampMonotonic UnitFileState WantedBy RequiredBy UpheldBy '
        'TriggeredBy Triggers PartOf BindsTo Requisite After').split()
LEAVES = {'readers': {'ypal-native-cutover-v1.py', 'ypal-native-cutover-v2.py'},
          'arena': {'arena-ypal-native-v2.py'}, 'cache': {'ypal-cache-finish-v2.py'},
          'rpc': {'ypal-retained-proxy-current-v1.py'}}
NAMESPACE = {
    PROJECT + '/.ponder': '/var/lib/yunipals-unified-ypal/combined-v1-source008/cache/.ponder',
    PROJECT + '/node_modules/.vite-temp': '/var/lib/yunipals-unified-ypal/combined-v1-source008/cache/.vite-temp',
    PROJECT + '/ponder-env.d.ts': '/var/lib/yunipals-unified-ypal/combined-v1-source008/cache/ponder-env.d.ts',
    PROJECT + '/ponder.config.ts': str(OPS / 'ypal-combined-source-v1-stage/ponder.config.ts'),
    PROJECT + '/lib/boosters/config.ts': str(OPS / 'ypal-combined-source-v1-stage/booster-config.ts'),
    PROJECT + '/lib/unified/rpc-preflight.ts': str(OPS / 'ypal-combined-source-v1-stage/rpc-preflight.ts')
}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def encoded(v): return (json.dumps(v, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(v): return isinstance(v, str) and re.fullmatch('[0-9a-f]{64}', v) is not None
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def mono(): return time.monotonic_ns() // 1000
def literal(v): return "'" + str(v).replace("'", "''") + "'"


def identity(path):
    s = Path(path).lstat()
    return {k: getattr(s, k) for k in ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')}


def protected(path, cap=8_000_000):
    p = Path(path)
    need(p.is_absolute() and '..' not in p.parts, 'absolute_protected_input_required')
    for q in [*p.parents, p]:
        s = q.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
             'root_owned_nonwritable_input_required')
    before = p.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= cap,
         'bounded_single_link_file_required')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, cap + 1)
        stable = lambda s: tuple(getattr(s, k) for k in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
        need(stable(os.fstat(fd)) == stable(before) == stable(p.lstat()) and len(raw) == before.st_size,
             'input_changed_during_read')
    finally: os.close(fd)
    return raw


def document(path, expected=None):
    raw = protected(path)
    need(expected is None or pin(expected) and sha(raw) == expected, 'exact_actual_receipt_required')
    return json.loads(raw)


def ref(value):
    need(isinstance(value, dict) and set(value) == {'file', 'sha256'} and pin(value['sha256']),
         'actual_file_checksum_reference_required')
    return document(value['file'], value['sha256'])


def module(path, expected):
    raw = protected(path)
    need(pin(expected) and sha(raw) == expected, 'exact_external_producer_required')
    m = types.ModuleType(Path(path).stem); m.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), m.__dict__)
    need(sha(protected(path)) == expected, 'producer_changed_during_import')
    return m


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode); os.fchown(fd, 0, 0)
        with os.fdopen(fd, 'wb', closefd=False) as f:
            f.write(raw); f.flush(); os.fsync(fd)
    finally: os.close(fd)
    sync(Path(path).parent)
    return sha(raw)


def command(args, data=None, timeout=12):
    p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         env=CLEAN, cwd='/', start_new_session=True)
    try: out, err = p.communicate(data, timeout=timeout)
    except BaseException:
        try: os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        p.communicate(); raise
    need(p.returncode == 0 and not err and len(out) <= 8_000_000, 'bounded_command_ACK_unknown_inspect_no_retry')
    return out


@contextlib.contextmanager
def lock():
    parent = LOCK.parent.lstat()
    need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and
         (not parent.st_mode & 0o022 or stat.S_IMODE(parent.st_mode) == 0o1777), 'protected_lock_parent_required')
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and s.st_nlink == 1 and
             stat.S_IMODE(s.st_mode) == 0o600, 'protected_shared_lock_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(identity(LOCK) == {k: getattr(s, k) for k in identity(LOCK)}, 'shared_lock_path_changed')
        yield
    finally: os.close(fd)


def link_record(path):
    if not os.path.lexists(path): return None
    value = identity(path)
    need(stat.S_ISLNK(value['st_mode']) and value['st_uid'] == value['st_gid'] == 0,
         'root_owned_boot_symlink_required')
    return {'identity': value, 'target': os.readlink(path)}


def moved_link_matches(path, expected):
    need(link_record(path) == expected, 'exact_original_boot_inode_required')


def check_solana(v):
    need(v['format'] == 'yunipals-solana-supervisor-handover-state-v1' and v['readOnly'] is True and
         v['isolation'] == 'repeatable read' and v['databaseWrites'] == v['providerCalls'] == 0 and
         v['manifest'] == {'checksum': MANIFEST_CHECKSUM, 'count': 10000} and v['runningScans'] <= 1 and
         v['workerLock']['granted'] <= 1 and v['workerLock']['waiting'] == 0,
         'one_retained_manifest_and_exclusive_solana_writer_required')


def stopped_solana(before, after):
    check_solana(before); check_solana(after)
    keys = ('manifest', 'state', 'publishedRun', 'runningScans', 'runningRunStates', 'stage',
            'ledgerPrefix', 'ledgerCurrent', 'workerLock')
    need(before['workerLock'] == after['workerLock'] == {'granted': 0, 'waiting': 0} and
         all(before[k] == after[k] for k in keys), 'stopped_solana_state_stage_schedule_prefix_changed')


def prefix_preserved(before, after):
    check_solana(before); check_solana(after)
    need(before['manifest'] == after['manifest'] and before['ledgerPrefix'] == after['ledgerPrefix'] and
         int(after['ledgerCurrent']['credits']) >= int(before['ledgerCurrent']['credits']) and
         int(after['state']['publishedRunId'] or 0) >= int(before['state']['publishedRunId'] or 0),
         'whole_usage_prefix_or_solana_publication_rewound')


def scheduled_publication(before, after, fresh):
    prefix_preserved(before, after)
    p = after['publishedRun']; dt = lambda x: datetime.datetime.fromisoformat(x.replace('Z', '+00:00'))
    need(int(p['id']) > int(before['state']['publishedRunId'] or 0) and p['id'] == after['state']['publishedRunId'] and
         p['state'] == 'published' and p['assetCount'] == 10000 and p['missingCount'] <= 2 and
         not after['state']['lastErrorPresent'] and fresh['id'] == p['id'] and
         fresh['id'] not in [r['id'] for r in before['runningRunStates']] and
         fresh['manifestChecksum'] == MANIFEST_CHECKSUM and fresh['requestCount'] >= 10 and
         dt(fresh['startedAt']) >= max(dt(before['observedAt']), dt(before['state']['nextScanAt'])) and
         dt(fresh['startedAt']) <= dt(p['completedAt']) <= dt(after['observedAt']) and
         dt(after['state']['nextScanAt']) > dt(p['completedAt']), 'next_genuine_scheduled_10000_publication_pending')


def native_preserved(before, after):
    need(before['schemaOid'] == after['schemaOid'] == '75963410' and
         before['app']['build_id'] == after['app']['build_id'] == BUILD and
         before['tables'] == after['tables'] and len(after['tables']) == 44 and
         set(before['checkpoints']) == set(after['checkpoints']) == {'1', '56', '137', '8453'} and
         all(after['checkpoints'][c] >= before['checkpoints'][c] for c in before['checkpoints']),
         'exact_native_catalog_and_monotonic_actual_checkpoints_required')


def bootstrap_catalog_matches(before, current):
    need(before['schemaOid'] == current['schemaOid'] == '75963410' and
         before['app']['build_id'] == current['app']['build_id'] == BUILD and
         before['tables'] == current['tables'] and len(current['tables']) == 44,
         'actual_bootstrap_native_catalog_required_not_a_historical_readiness_claim')


def columns_preserved(before, after):
    need(before['format'] == after['format'] == 'yunipals-ypal-managed-all-column-acl-v1' and
         {s['name'] for s in before['schemas']} == {SCHEMA, READ, 'yunipals_indexer_control'} and before == after,
         'complete_all_grantee_column_identity_and_ACL_catalog_changed')
    return after


def phase_catalog(before, current, additions):
    """Compose the authenticated seven-role catalog with explicit owned deltas.

    Arena's own separate role graph is verified by its phase leaf. All native
    target ACLs (including other grantees/PUBLIC) and all original-role edges
    still compare exactly here. No old whole validator is claimed to pass.
    """
    key = lambda e: tuple(str(e.get(k)) for k in ('kind', 'object', 'object_name', 'grantee', 'grantor', 'privilege', 'grantable', 'column_number'))
    b, a = copy.deepcopy(before), copy.deepcopy(current)
    roles = {r['oid']: r['name'] for r in b['roles']}
    for e in additions:
        need((e['kind'], e['privilege']) in {('schema', 'USAGE'), ('relation', 'SELECT'), ('function', 'EXECUTE'), ('database', 'CONNECT')} and
             e['grantable'] is False and e.get('column_number') is None, 'finite_acknowledged_read_only_phase_edges_required')
    for field in ['directRoleEdges', 'targetEdges']:
        prior = {key(e) for e in b.pop(field)}; following = {key(e) for e in a.pop(field)}
        allowed = [e for e in additions if str(e['grantee']) in roles] if field == 'directRoleEdges' else [
            e for e in additions if e['object_name'].split('.')[0] in {SCHEMA, READ, 'yunipals_indexer_control'}]
        need(following == prior | {key(e) for e in allowed}, 'only_explicit_feature_eight_and_Arena_read_edges_allowed')
    touched = {(e['kind'], str(e['object'])) for e in additions}
    for field, kind in [('schemas', 'schema'), ('relations', 'relation'), ('functions', 'function')]:
        for value in [b, a]:
            for row in value[field] or []:
                if (kind, str(row['oid'])) in touched: row.pop('acl', None)
    effective = {r['role']: r for r in b['effective']}
    for e in additions:
        role = roles.get(str(e['grantee']))
        if role is None: continue
        if e['kind'] == 'schema': effective[role]['schemas'][e['object_name']]['usage'] = True
        elif e['kind'] == 'relation': effective[role]['relations'][e['object_name']]['select'] = True
        elif e['kind'] == 'function': effective[role]['functions'][e['object_name']] = True
    need(a == b, 'all_other_roles_effective_rights_catalog_and_selection_facts_must_match')
    return current


def pointer(ref_value):
    need(set(ref_value) == {'file', 'sha256', 'jsonPointer'} and ref_value['jsonPointer'] in {'/after', '/postProof/catalog'},
         'fixed_authenticated_phase_catalog_reference_required')
    value = document(ref_value['file'], ref_value['sha256'])
    for part in ref_value['jsonPointer'].split('/')[1:]: value = value[part]
    return value


def definition_frame(state):
    fields = ['LoadState', 'FragmentPath', 'DropInPaths', 'WorkingDirectory', 'User', 'Group',
              'PartOf', 'BindsTo', 'Requisite', 'After']
    return {**{k: sorted(state[k].split()) if k in {'PartOf', 'BindsTo', 'Requisite', 'After'} else state[k] for k in fields},
            'argv': re.findall(r'argv\[\]=(.*?)\s+;', state['ExecStart'])}


def source_arguments():
    return [NODE, '--max-old-space-size=4096', *['--env-file=' + p for p in ENV_FILES[:3]],
            'node_modules/ponder/dist/esm/bin/ponder.js', 'start', '--schema', SCHEMA,
            '--hostname', '127.0.0.1', '--port', '9028']


def solana_arguments():
    return [NODE, '--max-old-space-size=4096', '--env-file=' + ENV_FILES[3], '--import', 'tsx', 'lib/solana/worker.ts']


def validate_tree(v):
    p = v['parent']; rows = v['processes']; by = {r['pid']: r for r in rows}
    need(len(rows) == len(by) and 3 <= len(rows) <= 4 and p['pid'] in by,
         'one_parent_two_children_optional_esbuild_required')
    need(p['argv'] == [NODE, str(STAGE / 'launcher.mjs')] and p['cwd'] == '/', 'exact_managed_parent_program_required')
    evm = [r for r in rows if r['argv'] == source_arguments()]
    sol = [r for r in rows if r['argv'] == solana_arguments()]
    need(len(evm) == len(sol) == 1 and evm[0]['parentPid'] == sol[0]['parentPid'] == p['pid'] and
         evm[0]['cwd'] == PROJECT and sol[0]['cwd'] == SOLANA_PROJECT, 'exact_separate_EVM_Solana_child_contexts_required')
    for r in rows:
        need(r['uid'] == 970 and r['gid'] == 964 and set(r['groups']) <= {964} and r['noNewPrivileges'] and
             r['capabilitiesZero'] and r['startupInjectionAbsent'] and r['cgroup'] == '0::/system.slice/' + PARENT,
             'restricted_managed_tree_kernel_identity_required')
        if r['pid'] not in {p['pid'], evm[0]['pid'], sol[0]['pid']}:
            need(r['parentPid'] == evm[0]['pid'] and r['argv'] == [r['executable'], '--service=0.25.12', '--ping'] and
                 r['executable'].endswith('/@esbuild/linux-x64/bin/esbuild'), 'only_actual_Ponder_esbuild_child_allowed')
    need(p['parentPrivateValuesAbsent'], 'private_credentials_must_remain_in_separate_child_files')
    return {'evm': evm[0], 'solana': sol[0]}


# Only public argv/cwd, private environment hashes, and kernel facts leave this peer.
PEER = r'''import hashlib,json,os,pathlib,sys
v=json.loads(sys.stdin.read());uid,gid=v['uid'],v['gid'];assert os.getuid()==uid and os.getgid()==gid
p=pathlib.Path('/proc')/str(v['pid'])
def ticks():
 s=(p/'stat').read_text();return int(s[s.rfind(')')+2:].split()[19])
start=ticks();s=dict(x.split(':',1)for x in(p/'status').read_text().splitlines()if ':'in x)
raw=(p/'environ').read_bytes();env=dict(x.split(b'=',1)for x in raw.split(b'\0')if b'='in x)
assert len(raw)<=1000000
assert all(k.encode()not in env or env[k.encode()]==val.encode()for k,val in v['public'].items())
assert not v.get('requirePublic')or all(env.get(k.encode())==val.encode()for k,val in v['public'].items())
argv=(p/'cmdline').read_bytes().rstrip(b'\0').decode().split('\0')
row={'pid':v['pid'],'startTicks':start,'parentPid':int(s['PPid']),'uid':int(s['Uid'].split()[0]),'gid':int(s['Gid'].split()[0]),'groups':[int(x)for x in s['Groups'].split()],'noNewPrivileges':s['NoNewPrivs'].strip()=='1','capabilitiesZero':all(int(s[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']),'capabilitySetSha256':hashlib.sha256(json.dumps({k:s[k].strip()for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']},sort_keys=True).encode()).hexdigest(),'startupInjectionAbsent':not any(k.encode()in env for k in ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH']),'parentPrivateValuesAbsent':not any(k.encode()in env for k in ['DATABASE_URL','DATABASE_PRIVATE_URL','HELIUS_API_KEY']),'argv':argv,'cwd':os.readlink(p/'cwd'),'executable':os.readlink(p/'exe'),'environmentSha256':hashlib.sha256(raw).hexdigest(),'cgroup':(p/'cgroup').read_text().strip()}
assert ticks()==start and all(int(x)==uid for x in s['Uid'].split())and all(int(x)==gid for x in s['Gid'].split())
print(json.dumps(row,sort_keys=True))
'''
NAMESPACE_PEER = r'''import hashlib,json,os,pathlib,stat,sys
assert os.getuid()==970 and os.getgid()==964
v=json.loads(sys.stdin.read());pid=v['pid'];root=pathlib.Path('/proc')/str(pid)/'root';out={}
for inside,backing in v['paths'].items():
 p=root/inside.lstrip('/');s=p.stat();out[inside]={'device':s.st_dev,'inode':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,'kind':stat.S_IFMT(s.st_mode)}
print(json.dumps(out,sort_keys=True))
'''


class Host:
    def __init__(self, manifest_sha, input_sha):
        self.manifest_sha, self.input_sha = manifest_sha, input_sha
        self.manifest = document(MANIFEST, manifest_sha); self.config = document(INPUT, input_sha)
        need(self.manifest['format'] == 'yunipals-ypal-managed-code-v1' and
             set(self.manifest['producers']) == set(LEAVES) and
             all(pin(v['sha256']) and v['file'] in LEAVES[k] for k, v in self.manifest['producers'].items()),
             'finite_frozen_reader_and_Arena_producer_manifest_required')
        self.reg = module(OPS / 'ypal-combined-release-register-v1.py', REGISTER_SHA)
        self.s, self.raw, self.source_op, self.source_ack = self.reg.load()
        self.feature = module(OPS / 'ypal-feature-handover-v1.py', FEATURE_SHA)
        self.observer = module(OPS / 'ypal-combined-ordinary-observer-owner-v1.py', OBSERVER_SHA)
        need(self.config['format'] == FORMAT + '-input' and self.config['sourceReceiptSha256'] == SOURCE_ACK and
             set(self.config['writers']) == set(WRITERS) and self.config['retireOldActivations'] is True,
             'actual_complete_writer_ownership_inventory_required')

    def peer_query(self, sql):
        sentinel = '/run/yunipals-managed-handover-no-password-file'
        need(not os.path.lexists(sentinel), 'absent_peer_password_file_required')
        args = ['/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups', '--no-new-privs',
                '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
                'PGPASSFILE=' + sentinel, 'PGAPPNAME=ypal_managed_handover_readonly',
                'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000',
                '/usr/bin/psql', '-XwAtq', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'postgres',
                '-d', 'yunipals_backfill', '-v', 'ON_ERROR_STOP=1']
        value = json.loads(command(args, sql.encode(), timeout=20))
        need(not os.path.lexists(sentinel), 'peer_password_sentinel_must_remain_absent')
        return value

    def query(self, sql):
        return self.peer_query('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;' + sql + ';ROLLBACK;')

    def state(self, unit):
        need(unit in {*UNITS, METADATA}, 'only_fixed_managed_handover_or_readonly_metadata_units_allowed')
        value = dict(x.split('=', 1) for x in command(['/usr/bin/systemctl', 'show', '--all', unit,
                     *['--property=' + k for k in KEYS]]).decode().splitlines())
        if set(value) == set(KEYS) - {'ExecStart'} and value.get('LoadState') == 'not-found': value['ExecStart'] = ''
        need(set(value) == set(KEYS) and value['Id'] == unit and value['Job'] in {'', '0'}, 'complete_idle_fixed_unit_state_required')
        for key in ['After', 'PartOf', 'BindsTo', 'Requisite']:
            value[key] = ' '.join(sorted(value[key].split()))
        return value

    def definitions(self, unit):
        s = self.state(unit)
        paths = [p for p in [s['FragmentPath'], *s['DropInPaths'].split()] if p]
        need(all(p == str(SYSTEM / unit) or p.startswith(str(SYSTEM / (unit + '.d')) + '/') or
                 p.startswith('/run/systemd/system/' + unit + '.d/') for p in paths), 'literal_owned_unit_definition_paths_required')
        return {p: {'sha256': sha(protected(p)), 'identity': identity(p)} for p in paths}

    def boot_link(self, unit): return SYSTEM / 'multi-user.target.wants' / unit

    def activation(self, unit):
        s = self.state(unit); boot_link = link_record(self.boot_link(unit))
        allowed = {'multi-user.target'} if boot_link else set()
        need(set(s['WantedBy'].split()) <= allowed and not any(s[k] for k in ['RequiredBy', 'UpheldBy', 'TriggeredBy', 'Triggers']),
             'no_unowned_timer_socket_supervisor_or_reverse_boot_path_allowed')
        need(s['UnitFileState'] in ({'enabled'} if boot_link else {'disabled', 'static', '', 'not-found'}),
             'literal_only_known_boot_activation_required')
        if boot_link: need(boot_link['target'] in {str(SYSTEM / unit), '../' + unit}, 'exact_boot_link_destination_required')
        return {'boot': boot_link, 'definitions': self.definitions(unit)}

    def peer(self, pid, observer=False, public=None, require_public=False):
        status = dict(x.split(':', 1) for x in (Path('/proc') / str(pid) / 'status').read_text().splitlines() if ':' in x)
        uid, gid = int(status['Uid'].split()[0]), int(status['Gid'].split()[0])
        need((uid, gid) in ({(969, 963)} if observer else {(970, 964), (0, 0)}),
             'only_retained_root_or_fixed_native_worker_identity_allowed')
        public = public or {}
        return json.loads(command(['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups',
                 '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i',
                 '/usr/bin/python3', '-I', '-B', '-c', PEER], encoded({'pid': pid, 'uid': uid, 'gid': gid, 'public': public, 'requirePublic': require_public})))

    def actor(self, unit, allow_terminal=False):
        s = self.state(unit)
        cg = Path('/sys/fs/cgroup/system.slice') / unit / 'cgroup.procs'
        pids = sorted(int(x) for x in cg.read_text().split()) if cg.exists() else []
        if s['MainPID'] == '0':
            need(allow_terminal and s['ControlPID'] == '0' and s['ActiveState'] in {'inactive', 'failed'} and not pids,
                 'exact_terminal_unit_and_empty_cgroup_required')
            return None
        need(s['ActiveState'] == 'active' and s['SubState'] == 'running' and s['ControlGroup'] == '/system.slice/' + unit and
             1 <= len(pids) <= 8 and int(s['MainPID']) in pids, 'bounded_active_owned_service_required')
        rows = [self.peer(p, unit == OBSERVER) for p in pids]
        need(self.state(unit) == s and sorted(int(x) for x in cg.read_text().split()) == pids, 'actor_changed_during_kernel_capture')
        return {'unit': s, 'parent': next(r for r in rows if r['pid'] == int(s['MainPID'])), 'processes': rows}

    def native(self): return self.raw.native()

    def readiness(self):
        value = self.query('SELECT jsonb_object_agg(c,' + READ + ".source_probe(c)) FROM unnest(ARRAY['base','bnb','ethereum','polygon'])c")
        need(set(value) == {'base', 'bnb', 'ethereum', 'polygon'} and all(v.get('ready') is True for v in value.values()),
             'fresh_all_four_canonical_source_probes_required')
        return value

    def sql_solana(self, through=0):
        raw = protected(OPS / 'ypal-managed-handover-v1.solana.sql')
        need(sha(raw) == SQL_SHA and type(through) is int and through >= 0, 'unchanged_bounded_readonly_Solana_snapshot_required')
        # Existing peer transport, one RR snapshot, no variable from a private environment.
        script = raw.decode().replace(":'ledger_max_id'", str(through))
        value = self.peer_query(script)
        check_solana(value)
        return value

    def leaves(self):
        feature = self.feature.validate_feature_leaf(**self.config['feature'])
        reader_code = self.manifest['producers']['readers']
        feature_refs = {'retirementSha256': self.config['feature']['result_sha'],
                        'manifestSha256': self.config['feature']['manifest_sha'], 'inputSha256': self.config['feature']['input_sha']}
        readers = module(OPS / reader_code['file'], reader_code['sha256']).validate_reader_leaf(
            self.config['readers']['resultSha256'], self.config['readers']['sourceManifestSha256'], feature_refs)
        arena_code = self.manifest['producers']['arena']
        arena = module(OPS / arena_code['file'], arena_code['sha256']).validate_phase_leaf(**self.config['arena'])
        cache_code = self.manifest['producers']['cache']
        cache = module(OPS / cache_code['file'], cache_code['sha256']).validate_cache_leaf(
            self.config['cache']['resultSha256'], self.config['cache']['sourceManifestSha256'], feature_refs)
        need(feature['validated'] is readers['validated'] is arena['validated'] is cache['validated'] is True and
             feature['temporarySourceRetired'] is True and readers['fullGlobalRoleGraphQualified'] is False,
             'actual_readers_metadata_cache_feature_postevent_and_Arena_acceptance_required')
        return {'feature': feature, 'readers': readers, 'arena': arena, 'cache': cache}

    def composed_catalog(self, leaves):
        prior = pointer(leaves['readers']['recordedRead143Cache4AndTwoLOGINCatalog'])
        need(sha(encoded(prior)) == leaves['readers']['recordedAfterLOGINCatalogSha256'], 'authenticated_coordinator_whole_after_LOGIN_catalog_required')
        # Exactly the same eight SELECTs as the admitted feature owner, with
        # actual acknowledged physical table/owner identities.
        additions = []
        for name, oid in self.feature.TARGET_OIDS.items():
            if name in {'_ponder_meta', '_ponder_checkpoint'}: continue
            additions.append({'kind': 'relation', 'object': str(oid), 'object_name': SCHEMA + '.' + name,
                              'grantee': '73187672', 'grantor': '73004621', 'privilege': 'SELECT',
                              'grantable': False, 'column_number': None})
        need(len(additions) == 8, 'exact_feature_eight_native_READs_required')
        additions += leaves['arena']['ownedReadEdges']
        return phase_catalog(prior, self.catalog(), additions)

    def private_inputs(self):
        v = self.config['privateAndCodeInputs']
        need(set(ENV_FILES) | {'/etc/yunipals-indexer/indexer.env', '/etc/yunipals-indexer/solana.env'} <= set(v) and len(v) <= 200,
             'exact_new_and_retained_original_private_environment_files_required')
        for p, digest in v.items():
            need(pin(digest) and (p in ENV_FILES or p.startswith(SOLANA_PROJECT + '/') or
                 p.startswith('/etc/yunipals-unified/') or p in {'/etc/yunipals-indexer/indexer.env', '/etc/yunipals-indexer/solana.env'} or
                 p.startswith(str(OPS) + '/') or p == NODE),
                 'finite_existing_private_and_program_paths_only')
            need(sha(protected(p, 256_000_000 if p == NODE else 8_000_000)) == digest,
                 'existing_private_program_or_budget_configuration_changed')
        self.s.static_inputs(self.raw); self.s.old_private_inputs(self.source_op)
        need(self.s.base_code() == self.source_op['sourceCode'] and self.raw.role() == self.source_op['sourceRole'],
             'same_accepted_source_code_writer_role_and_pool_five_required')
        for name, digest in PINS.items(): need(sha(protected(STAGE / name)) == digest, 'exact_managed_launcher_unit_public_environment_required')
        self.retained_solana_auth()
        # Check the exact child identity can still read all four files before
        # stopping anything. The helper hashes bytes only; no values/worker import.
        read_code = "import hashlib,json,os,pathlib,sys;assert os.getuid()==970 and os.getgid()==964;paths=json.load(sys.stdin);print(json.dumps({p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in paths},sort_keys=True))"
        hashes = json.loads(command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
            '/usr/bin/python3', '-I', '-B', '-c', read_code], encoded(list(ENV_FILES))))
        need(hashes == {p: v[p] for p in ENV_FILES}, 'actual_child_identity_must_read_all_four_original_environment_files')
        manifest = document(Path(PROJECT).parents[1] / 'BASE-SOURCE-MANIFEST.json')
        # base_code() above authenticates this exact 008 manifest/digest. Compare
        # the actual separate Solana workspace, not the EVM copy's cwd alone.
        rows = {r['path']: r['sha256'] for r in manifest['files']}
        source13 = {}
        for name in SOLANA_SOURCES:
            expected = rows['apps/yunipals-indexer/' + name]
            need(sha(protected(Path(SOLANA_PROJECT) / name)) == expected,
                 'separate_retained_008_Solana_source_closure_must_match_approved_manifest')
            source13[name] = expected
        return {'files': v, 'inputIdentities': {p: identity(Path(p)) for p in v}, 'retainedSolanaSource13': source13}

    def retained_solana_auth(self):
        stage = document(SOLANA_STAGE / 'staged.json', SOLANA_STAGE_ACK)
        review = document(SOLANA_STAGE / 'review.json')
        # The old stage hashed JSON without a trailing newline. Do not relabel
        # its actual receipt or silently change that producer's checksum rule.
        need(stage['staged'] is True and stage['sourceUidReadabilityVerified'] is True and
             sha(json.dumps(review['binding'], sort_keys=True, separators=(',', ':')).encode()) == review['reviewHash'] == stage['reviewHash'],
             'actual_retained_Solana_private_stage_and_complete_manifest_required')
        files = review['binding']['files']
        for name in ['/etc/yunipals-indexer/indexer.env', '/etc/yunipals-indexer/solana.env']:
            need(sha(protected(name)) == review['binding']['sourceInputs'][name]['sha256'] and
                 stat.S_IMODE(Path(name).stat().st_mode) == 0o600 and Path(name).stat().st_uid == Path(name).stat().st_gid == 0,
                 'retained_original_Solana_credentials_and_limits_changed_since_actual_auth_stage')
        need(sha(protected(SOLANA_STAGE / 'helius-egress.conf.candidate')) == files['helius-egress.conf.candidate']['sha256'] == HELIUS_SHA and
             sha(protected(ENV_FILES[3])) == sha(protected(SOLANA_STAGE / 'private/solana.env')) == files['private/solana.env']['sha256'],
             'existing_private_Solana_file_and_literal_egress_must_match_authenticated_stage')
        auth = document(SOLANA_AUTH, self.config['solanaAuthSha256'])
        need(auth['format'] == 'yunipals-solana-child-sandbox-auth-v2' and auth['status'] == 'passed' and
             auth['authSha256'] == SOLANA_AUTH_PROGRAM_SHA and auth['stagingReviewHash'] == review['reviewHash'] and
             auth['actualSandboxAuthenticationSucceeded'] is auth['selectedInputsUnchanged'] is auth['ownedDiagnosticStopped'] is True and
             auth['providerCalls'] == auth['databaseWrites'] == auth['existingServiceJobs'] == 0 and
             auth['proof']['configuredRoleSha256'] == '5c125b1b2e509437f6bf74160fbfcfd362228a503f646e82734b08bc1170b27d' and
             auth['proof']['readOnly'] is auth['proof']['databaseMatches'] is auth['proof']['capabilitySetsZero'] is True and
             auth['proof']['uid'] == 970 and auth['proof']['gid'] == 964,
             'actual_retained_restricted_child_authentication_proof_required')
        return {'stageSha256': SOLANA_STAGE_ACK, 'authSha256': self.config['solanaAuthSha256'], 'privateFileSha256': files['private/solana.env']['sha256']}

    def routes(self):
        # Separately acknowledged current RPC packets remain valid after the
        # temporary source/API retirement and the c96 parent transition. Never
        # call the helper's strict original-source component in this phase.
        code = self.manifest['producers']['rpc']
        value = module(OPS / code['file'], code['sha256']).validate_rpc_current(self.config['proxyReceiptSha256'])
        need(value['validated'] is True and value['receiptSha256'] == self.config['proxyReceiptSha256'] and
             value['operatorSha256'] == code['sha256'] and
             value['rpcScopeOnly'] is value['freeOnly'] is True and value['paidAuthority'] is False and
             value['historicalWholeValidatorPassed'] is value['sourceActorQualified'] is False and
             value['temporaryYpalSourceAndApiQualified'] is value['sourceReadinessQualified'] is False and
             value['readerRoleGraphQualified'] is value['financialWriteAuthorityQualified'] is False and
             value['providerCalls'] == value['databaseWrites'] == value['serviceActions'] == 0,
             'actual_current_proxy_only_acknowledgement_and_unchanged_free_authority_required')
        return value

    def catalog(self):
        sql = protected(OPS / 'ypal-combined-read-admission-v1.catalog.sql')
        need(sha(sql) == CATALOG_SHA, 'unchanged_complete_read_authorization_catalog_required')
        return self.query(sql.decode())

    def columns(self):
        raw = protected(OPS / 'ypal-managed-handover-v1.columns.sql')
        need(sha(raw) == COLUMN_SQL_SHA, 'new_full_column_SQL_producer_pin_required')
        value = self.query(raw.decode())
        schemas = {s['name']: s['oid'] for s in value['schemas']}
        need(value['databaseOid'] == '17584' and schemas.get(SCHEMA) == '75963410' and schemas.get(READ) == '75994954',
             'same_actual_native_read_and_control_column_scope_required')
        ack = document(Path('/var/backups/yunipals-ypal-combined-source-start-v1-20261023/result.json'), SOURCE_ACK)
        expected = {name: row['oid'] for name, row in ack['native']['tables'].items()}
        actual = {c['relation']: c['relationOid'] for c in value['columns'] if c['schema'] == SCHEMA}
        need(len(expected) == 44 and actual == expected, 'all_44_native_relations_in_complete_column_catalog_required')
        columns_preserved(value, value)
        return value

    def sessions(self, actors, all_native=False):
        # Positive kernel mapping for both dedicated native role and shared Solana
        # role16388; other metadata/API sessions using16388 are retained separately.
        observer = self.raw.observer; result = {}
        for role in [73004621, 16388, 73036832]:
            sql = 'SELECT coalesce(jsonb_agg(jsonb_build_object(\'pid\',pid,\'backendStart\',backend_start,\'clientAddress\',client_addr::text,\'clientPort\',client_port)ORDER BY pid),\'[]\'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND usesysid=' + str(role)
            rows = self.query(sql); need(len(rows) <= 64, 'bounded_shared_role_backend_inventory_required')
            fds = observer.peer_fds([r['pid'] for r in rows], 111, 113)
            peers = observer.unix_peers(observer.run(['/usr/bin/ss', '-xHn']))
            tcp = {**observer.tcp_clients(Path('/proc/net/tcp').read_bytes()),
                   **observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
            owned = {}
            for name, actor in actors.items():
                actor_fds = {}
                for uid, gid in {(p['uid'], p['gid']) for p in actor['processes']}:
                    actor_fds.update(observer.peer_fds([p['pid'] for p in actor['processes'] if (p['uid'], p['gid']) == (uid, gid)], uid, gid))
                owned[name] = observer.map_owned_backends(actor_fds, fds, rows, peers, tcp)
            ids = [r['pid'] for rs in owned.values() for r in rs]
            need(len(ids) == len(set(ids)) and self.query(sql) == rows, 'session_mapping_changed_or_duplicated')
            result[str(role)] = {'owned': owned, 'other': [{'pid': r['pid'], 'backendStart': r['backendStart']} for r in rows if r['pid'] not in ids]}
            if role == 73004621 and all_native: need(not result[str(role)]['other'], 'all_native_writer_backends_must_be_owned')
            if role == 16388:
                locks = self.query("SELECT coalesce(jsonb_agg(pid),'[]'::jsonb) FROM pg_locks WHERE locktype='advisory' AND database=17584 AND classid=((hashtext('solana:indexer:worker')::bigint>>32)&4294967295)::oid AND objid=(hashtext('solana:indexer:worker')::bigint&4294967295)::oid AND objsubid=1 AND granted")
                result[str(role)]['solanaLockHolders'] = locks
                if all_native: need(set(locks) <= set(ids), 'Solana_lock_must_belong_to_kernel_owned_writer_backend')
        return result

    def sessions_gone(self, proof):
        rows = self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)),'[]'::jsonb)FROM pg_stat_activity WHERE datid=17584 AND usesysid IN(73004621,16388,73036832)")
        owned = [r for v in proof.values() for rs in v['owned'].values() for r in rs]
        need(not any(a['pid'] == b['pid'] and a['backendStart'] == b['backendStart'] for a in owned for b in rows),
             'drained_kernel_owned_database_sessions_still_present')

    def failed_parent_quiet(self, op):
        # A source can fail between accepted invocations. Positive attribution
        # to the unchanged metadata worker proves that no unacknowledged shared
        # Solana backend remains; never use role16388=0 or session age as a proxy.
        actor = self.actor(METADATA)
        need(actor == op['metadataKernelActor'], 'same_preserved_metadata_actor_required_for_failed_parent_drain')
        proof = self.sessions({METADATA: actor}, all_native=True)
        need(not proof['16388']['other'] and not proof['16388']['solanaLockHolders'],
             'unattributed_shared_role_sessions_prevent_frozen_Solana_boundary')
        return proof

    def manager(self, action, unit=None):
        need(action == 'daemon-reload' and unit is None or action in {'start', 'stop'} and unit in UNITS,
             'fixed_manager_command_only')
        need(not command(['/usr/bin/systemctl', action, *([unit] if unit else [])], timeout=90), 'quiet_manager_ACK_required')

    def availability(self):
        # Existing phase leaf actually requests all accepted routes; same source
        # schema/identity, no fake process-unchanged availability claim.
        return self.leaves()

    def observer_health(self): return self.observer.Host(self.config['observer']['readAdmissionSha256'], self.config['observer']['installSha256']).control()

    def managed(self, epoch):
        self.managed_settings()
        actor = self.actor(PARENT); children = validate_tree(actor)
        public = dict(line.split('=', 1) for line in protected(STAGE / 'service.public.env').decode().splitlines() if line and not line.startswith('#'))
        need(self.peer(actor['parent']['pid'], public=public, require_public=True) == actor['parent'],
             'actual_parent_has_all_exact_public_launch_settings_without_private_credentials')
        need(actor['unit']['InvocationID'] != epoch['predecessorInvocation'] and
             int(actor['unit']['ExecMainStartTimestampMonotonic']) >= epoch['notBeforeUs'], 'new_owned_managed_start_epoch_required')
        need(self.definitions(PARENT) == epoch['definitions'] and self.activation(PARENT)['boot'] == epoch['boot'],
             'exact_managed_definition_and_boot_inodes_required')
        # Process-private namespace: compare each accepted overlay and writable
        # cache target through the actual EVM mount namespace, never host cwd only.
        proofs = json.loads(command(['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
            '/usr/bin/python3', '-I', '-B', '-c', NAMESPACE_PEER], encoded({'pid': children['evm']['pid'], 'paths': NAMESPACE}), timeout=8))
        expected = {}
        for inside, backing in NAMESPACE.items():
            s = Path(backing).stat()
            expected[inside] = {'device': s.st_dev, 'inode': s.st_ino, 'uid': s.st_uid, 'gid': s.st_gid, 'kind': stat.S_IFMT(s.st_mode)}
        need(proofs == expected, 'actual_EVM_private_mounts_and_cache_bindings_required')
        return actor

    def managed_settings(self):
        keys = ['Restart', 'RestartPreventExitStatus', 'TimeoutStopUSec', 'KillMode', 'MemoryMax', 'MemorySwapMax',
                'TasksMax', 'NoNewPrivileges', 'CapabilityBoundingSet', 'AmbientCapabilities', 'ProtectSystem',
                'ProtectHome', 'PrivateTmp', 'RestrictSUIDSGID', 'IPAddressAllow', 'IPAddressDeny', 'Environment',
                'PassEnvironment', 'UnsetEnvironment', 'ExecStart', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost',
                'WorkingDirectory', 'User', 'Group', 'Conflicts', 'Wants', 'RuntimeMaxUSec', 'RestrictAddressFamilies']
        raw = command(['/usr/bin/systemctl', 'show', '--all', PARENT, *['--property=' + k for k in keys]]).decode()
        value = {}
        for line in raw.splitlines():
            k, sep, v = line.partition('='); need(sep and k in keys and k not in value, 'exact_managed_settings_required'); value[k] = v
        expected = {'Restart': 'on-failure', 'RestartPreventExitStatus': '75', 'TimeoutStopUSec': '1min',
                    'KillMode': 'control-group', 'MemoryMax': '6442450944', 'MemorySwapMax': '0', 'TasksMax': '128',
                    'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
                    'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'RestrictSUIDSGID': 'yes',
                    'Environment': '', 'PassEnvironment': '', 'ExecStartPre': '', 'ExecStartPost': '', 'ExecStop': '', 'ExecStopPost': '',
                    'WorkingDirectory': '/', 'User': 'yunipals_unified_shadow', 'Group': 'yunipals_unified_shadow', 'RuntimeMaxUSec': 'infinity'}
        need(set(value) == set(keys) and all(value[k] == v for k, v in expected.items()) and
             set(value['UnsetEnvironment'].split()) == {'DATABASE_URL', 'DATABASE_PRIVATE_URL', 'HELIUS_API_KEY'},
             'exact_inherited_hardening_resources_and_environment_resets_required')
        need(set(value['RestrictAddressFamilies'].split()) == {'AF_UNIX', 'AF_INET', 'AF_INET6'}, 'same_bounded_address_families_required')
        need(re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) == [NODE + ' ' + str(STAGE / 'launcher.mjs')] and
             set(value['Wants'].split()) == {'network-online.target'} and
             set(WRITERS) - {PARENT} <= set(value['Conflicts'].split()) <= set(WRITERS) - {PARENT} | {'shutdown.target'},
             'only_exact_managed_start_command_and_known_writer_conflicts_allowed')
        networks = lambda s: {str(ipaddress.ip_network(p, strict=False)) for p in s.split()}
        need(networks(value['IPAddressAllow']) == CIDRS | {'127.0.0.0/8', '::1/128'} and
             networks(value['IPAddressDeny']) == {'0.0.0.0/0', '::/0'}, 'only_retained_literal_Helius_and_loopback_egress_allowed')
        object_path = '/org/freedesktop/systemd1/unit/' + re.sub('[^a-zA-Z0-9]', lambda x: '_' + format(ord(x[0]), '02x'), PARENT)
        typed = lambda name: json.loads(command(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', object_path,
                                                 'org.freedesktop.systemd1.Service', name]))
        need(typed('EnvironmentFiles') == {'type': 'a(sb)', 'data': [[str(STAGE / 'service.public.env'), False]]},
             'only_exact_parent_public_environment_file_allowed')
        for name, pairs in [('BindPaths', list(NAMESPACE.items())[:3]), ('BindReadOnlyPaths', list(NAMESPACE.items())[3:])]:
            rows = typed(name)
            need(rows.get('type') == 'a(ssbt)' and len(rows.get('data', [])) == 3 and
                 all(len(row) == 4 and row[:3] == [backing, inside, False] and type(row[3]) is int and row[3] in {0, 16384}
                     for row, (inside, backing) in zip(rows['data'], pairs)), 'exact_three_writable_and_three_readonly_mounts_required')
        return value

    def observer_managed(self, epoch):
        actor = self.actor(OBSERVER); need(len(actor['processes']) == 1, 'one_observer_process_required')
        need(actor['parent']['argv'] == self.config['observer']['argv'] and
             actor['parent']['capabilitiesZero'] and actor['parent']['noNewPrivileges'] and
             actor['unit']['InvocationID'] != epoch['predecessorInvocation'] and
             int(actor['unit']['ExecMainStartTimestampMonotonic']) >= epoch['notBeforeUs'] and
             self.definitions(OBSERVER) == epoch['definitions'] and self.activation(OBSERVER)['boot'] == epoch['boot'] and
             actor['unit']['BindsTo'].split() == [PARENT] and actor['unit']['PartOf'].split() == [PARENT],
             'new_owned_official_observer_and_managed_parent_dependencies_required')
        return actor


class Owner:
    def __init__(self, h): self.h = h
    def get(self, name): return document(BASE / name)
    def put(self, name, value): return save(BASE / name, value)

    def operation(self):
        op = self.get('operation.json')
        need(op['operatorSha256'] == sha(protected(Path(__file__).absolute())) and op['bootId'] == boot() and
             op['inputSha256'] == self.h.input_sha and op['manifestSha256'] == self.h.manifest_sha,
             'same_operator_boot_actual_input_and_external_producer_manifest_required')
        return op

    def stable(self, op, serving=True):
        need(self.h.private_inputs() == op['privateInputs'] and self.h.routes() == op['routes'] and self.h.catalog() == op['catalog'],
             'complete_phase_authorization_private_config_and_free_routes_changed')
        columns_preserved(op['columnCatalog'], self.h.columns())
        native_preserved(op['native'], self.h.native())
        if serving: self.h.availability()

    def review(self):
        h = self.h; leaves = h.leaves(); h.private_inputs(); routes = h.routes(); native = h.native(); bootstrap_catalog_matches(h.source_ack['native'], native)
        native_preserved(native, native)
        h.readiness()
        need(h.s.new_owned(h.raw, h.source_op) == h.source_ack['source'], 'actual_c96_source_before_handover_required')
        h.observer.validate_current(h.config['observer']['resultSha256'])
        units = {}; activations = {}; frames = {}
        for unit in UNITS:
            activations[unit] = h.activation(unit); actor = h.actor(unit, True)
            expected = h.config['writers'].get(unit, h.config['observer'])
            need({p: v['sha256'] for p, v in activations[unit]['definitions'].items()} == expected['definitionHashes'],
                 'actual_previously_reviewed_unit_definitions_required')
            if unit not in {SOURCE, SOLANA, PARENT, OBSERVER}: need(actor is None, 'unknown_or_unretired_active_legacy_writer_refused')
            if actor:
                need(actor['parent']['argv'] == expected['argv'] and actor['parent']['cwd'] == expected['cwd'], 'exact_reviewed_existing_writer_command_required')
            units[unit] = actor
            frames[unit] = definition_frame(h.state(unit))
        sessions = h.sessions({u: a for u, a in units.items() if a}, all_native=True)
        sol = h.sql_solana(); check_solana(sol)
        need(sol['state']['lastErrorPresent'] is False, 'existing_Solana_error_requires_readonly_diagnosis')
        catalog = h.composed_catalog(leaves); authority = ref(h.config['authorization']); columns = h.columns()
        need(authority['format'] == FORMAT + '-authorization' and authority['catalog'] == catalog and
             authority['readerReceiptSha256'] == h.config['readers']['resultSha256'] and
             authority['featureReceiptSha256'] == h.config['feature']['result_sha'] and
             authority['arenaReceiptSha256'] == h.config['arena']['result_sha'], 'explicit_reviewed_complete_phase_catalog_and_acceptance_references_required')
        column_baseline = ref(authority['columnBaseline'])
        need(column_baseline['format'] == FORMAT + '-column-baseline' and column_baseline['dataOnly'] is True and
             column_baseline['sourceReadinessQualified'] is False and column_baseline['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
             column_baseline['sqlSha256'] == COLUMN_SQL_SHA and column_baseline['sourceReceiptSha256'] == SOURCE_ACK,
             'explicit_new_current_column_authority_not_historical_cd1_capture_required')
        columns_preserved(column_baseline['catalog'], columns)
        resources = h.s.resources()
        value = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': boot(),
                 'inputSha256': h.input_sha, 'manifestSha256': h.manifest_sha, 'units': units, 'activations': activations,
                 'unitDefinitionFrames': frames,
                 'native': native, 'routes': routes, 'catalog': catalog, 'privateInputs': h.private_inputs(),
                 'columnCatalog': columns, 'columnBaseline': authority['columnBaseline'],
                 'solana': sol, 'sessions': sessions, 'acceptance': leaves, 'resources': resources,
                 'metadataKernelActor': h.actor(METADATA),
                 'originalWholeValidatorsPassedAfterTakeover': False, 'marketplaceFullHistoryAccepted': False}
        # Process/boot/private/catalog authority is exact. Legitimate live native
        # and Solana progress is re-read and preserved at the drain boundary;
        # transient clocks/resources/session IDs do not make a review impossible.
        binding = {k: value[k] for k in ['format', 'operatorSha256', 'bootId', 'inputSha256', 'manifestSha256',
                   'units', 'activations', 'unitDefinitionFrames', 'catalog', 'columnCatalog', 'columnBaseline', 'privateInputs', 'routes', 'metadataKernelActor']}
        binding['nativeIdentity'] = {'schemaOid': native['schemaOid'], 'buildId': native['app']['build_id'], 'tables': native['tables']}
        binding['solanaManifest'] = sol['manifest']
        return {**value, 'reviewBinding': binding, 'reviewHash': sha(encoded(binding))}

    def step(self, name, value, action):
        self.put(name + '-intent.json', {'operationSha256': sha(protected(BASE / 'operation.json')), 'bootId': boot(),
                                        'value': value, 'notBeforeUs': mono(), 'automaticRetryAllowed': False})
        result = action()
        self.put(name + '-result.json', {'value': result})
        return result

    def stop_exact(self, unit, actor, name):
        h = self.h
        # Fresh positive backend capture immediately before stop intent. Shared
        # role16388's unrelated metadata sessions are not required to disappear.
        need(h.actor(unit) == actor, 'exact_actor_before_owned_stop_required')
        sessions = h.sessions({unit: actor}); self.put(name + '-sessions.json', sessions)
        def effect():
            need(h.actor(unit) == actor, 'post_intent_stop_actor_CAS_required')
            h.manager('stop', unit)
            need(h.actor(unit, True) is None, 'stop_must_leave_empty_terminal_cgroup')
            h.sessions_gone(sessions)
            return {'terminal': True}
        return self.step(name, {'unit': unit, 'actor': actor, 'sessionsSha256': sha(protected(BASE / (name + '-sessions.json')))}, effect)

    def drain(self, expected):
        need(not os.path.lexists(BASE) and not os.path.lexists(HOLD), 'fresh_exclusive_managed_operation_and_inode_hold_required')
        value = self.review(); need(value['reviewHash'] == expected, 'exact_fresh_managed_review_hash_required')
        BASE.mkdir(mode=0o700); sync(BASE.parent); HOLD.mkdir(mode=0o700); sync(SYSTEM)
        self.put('operation.json', value)
        for unit in [OBSERVER, SOURCE, PARENT, SOLANA]:
            actor = value['units'][unit]
            if actor: self.stop_exact(unit, actor, 'drain-' + unit)
        for unit in UNITS: need(self.h.actor(unit, True) is None, 'all_old_writer_and_observer_groups_terminal_before_replacement')
        sol = self.h.sql_solana()
        need(sol['workerLock'] == {'granted': 0, 'waiting': 0}, 'stopped_Solana_advisory_lock_required')
        self.put('drained.json', {'solana': sol, 'native': self.h.native(), 'stoppedAtUs': mono()})
        return {'drained': True, 'globalSelectorsChanged': False, 'databaseWrites': 0}

    def move_owned(self, source, target, record, label, finish=False):
        intent = {'source': str(source), 'target': str(target), 'identity': record}
        path = BASE / (label + '-intent.json')
        if path.exists(): need(finish and document(path)['value'] == intent, 'owned_same_rename_intent_required')
        else: self.put(label + '-intent.json', {'value': intent})
        if os.path.lexists(target):
            need(finish and not os.path.lexists(source) and identity(target) == record, 'one_owned_rename_outcome_only')
        else:
            need(identity(source) == record, 'source_inode_changed_before_rename')
            os.rename(source, target); sync(source.parent); sync(target.parent)
        if not (BASE / (label + '-result.json')).exists(): self.put(label + '-result.json', {'completed': True, 'identity': identity(target)})

    def install(self):
        op = self.operation(); self.stable(op, False); d = self.get('drained.json')
        stopped_solana(d['solana'], self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
        for unit in UNITS: need(self.h.actor(unit, True) is None, 'no_active_old_writer_during_unit_replacement')
        # Preserve every original restart inode, not merely its symlink text.
        for unit in UNITS:
            b = op['activations'][unit]['boot']
            if b: self.move_owned(self.h.boot_link(unit), HOLD / (unit + '.boot'), b['identity'], 'hold-boot-' + unit)
        for unit in [PARENT, OBSERVER]:
            for i, (p, rec) in enumerate(op['activations'][unit]['definitions'].items()):
                self.move_owned(Path(p), HOLD / (unit + '.definition-' + str(i)), rec['identity'], 'hold-definition-' + unit + '-' + str(i))
        raw = protected(STAGE / 'yunipals-indexer.service.example')
        self.publish_file('managed-unit', SYSTEM / PARENT, raw)
        observer_paths = op['activations'][OBSERVER]['definitions']
        need(len(observer_paths) == 1 and str(SYSTEM / OBSERVER) in observer_paths, 'unchanged_observer_single_original_fragment_required')
        original = protected(HOLD / (OBSERVER + '.definition-0'))
        need(original.count(SOURCE.encode()) == 4, 'only_four_dependency_bindings_in_original_observer_required')
        self.publish_file('observer-unit', SYSTEM / OBSERVER, original.replace(SOURCE.encode(), PARENT.encode()))
        egress = ref(self.h.config['solanaEgress'])
        need(egress['format'] == 'yunipals-ypal-managed-egress-v1' and set(egress['literalCidrs']) == CIDRS,
             'retained_literal_IP_egress_acknowledgement_required')
        drop = SYSTEM / (PARENT + '.d')
        if not drop.exists(): drop.mkdir(mode=0o755); sync(SYSTEM)
        raw = ('[Service]\n' + ''.join('IPAddressAllow=' + c + '\n' for c in sorted(CIDRS))).encode()
        self.publish_file('managed-egress', drop / '90-managed-helius.conf', raw)
        # This is native enable semantics without starting a service. Same-inode
        # old links remain held; the final parent and observer get owned newlinks.
        for unit in [PARENT, OBSERVER]:
            path = self.h.boot_link(unit); temporary = HOLD / (unit + '.new-boot')
            os.symlink(str(SYSTEM / unit), temporary); sync(HOLD)
            record = link_record(temporary)
            self.put('new-boot-' + unit + '-prepared.json', {'path': str(path), 'link': record})
            need(not os.path.lexists(path), 'new_boot_path_must_be_absent')
            os.rename(temporary, path); sync(HOLD); sync(path.parent)
        self.step('reload-managed', {}, lambda: self.h.manager('daemon-reload'))
        self.h.managed_settings()
        installed = {u: self.h.activation(u) for u in [PARENT, OBSERVER]}
        self.put('installed.json', installed)
        return {'installedInactive': True, 'oldRestartPathsHeld': True}

    def publish_file(self, name, path, raw):
        temporary = HOLD / (name + '.prepared')
        save(temporary, raw, 0o644)
        record = {'path': str(path), 'sha256': sha(raw), 'identity': identity(temporary)}
        self.put(name + '-prepared.json', record)
        need(not os.path.lexists(path), 'no_foreign_definition_may_be_overwritten')
        os.rename(temporary, path); sync(HOLD); sync(path.parent)
        self.put(name + '-published.json', record)

    def owned_new_definition(self, name):
        record = self.get(name + '-prepared.json'); path = Path(record['path'])
        need(identity(path) == record['identity'] and sha(protected(path)) == record['sha256'],
             'exact_owned_new_definition_inode_and_bytes_required')
        return record

    def epoch(self, unit):
        installed = self.get('installed.json')[unit]; op = self.operation()
        predecessor = op['units'][unit]
        return {'predecessorInvocation': predecessor['unit']['InvocationID'] if predecessor else '',
                'notBeforeUs': mono(), 'definitions': installed['definitions'], 'boot': installed['boot']}

    def start_parent(self):
        op = self.operation(); self.stable(op, False); d = self.get('drained.json')
        self.h.managed_settings()
        for unit in UNITS: need(self.h.actor(unit, True) is None, 'exclusive_empty_writer_tree_before_managed_start')
        stopped_solana(d['solana'], self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
        intent = self.epoch(PARENT)
        self.put('parent-start-intent.json', intent)
        # No second start after a timeout. Explicit reconcile can only observe.
        need(self.h.actor(PARENT, True) is None, 'post_intent_parent_must_still_be_terminal')
        self.h.manager('start', PARENT)
        return self.accept_parent()

    def accept_parent(self, prefix=''):
        op = self.operation(); self.stable(op, False)
        actor = self.h.managed(self.get(prefix + 'parent-start-intent.json'))
        self.h.sessions({PARENT: actor}, all_native=True)
        native = self.h.native(); native_preserved(op['native'], native)
        need(str(native['app']['is_ready']) == '1' and str(native['app']['is_locked']) == '1' and
             0 <= int(native['clock']) - int(native['app']['heartbeat_at']) <= 180000,
             'current_Ponder_framework_heartbeat_before_observer_start_required')
        d = self.get(prefix + 'drained.json'); sol = self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId']))
        prefix_preserved(d['solana'], sol)
        need(self.h.managed(self.get(prefix + 'parent-start-intent.json')) == actor, 'managed_actor_changed_before_acceptance')
        result = {'managed': actor, 'solana': sol, 'native': native, 'availabilityQualified': False,
                  'canonicalReadinessRequiresNewObserver': True, 'zeroOutageClaimed': False}
        if not (BASE / (prefix + 'parent-started.json')).exists(): self.put(prefix + 'parent-started.json', result)
        else: need(self.get(prefix + 'parent-started.json')['managed'] == actor, 'reconciled_parent_must_match_owned_ACK')
        return result

    def start_observer(self, prefix=''):
        self.accept_parent(prefix); need(self.h.actor(OBSERVER, True) is None, 'no_competing_observer_before_start')
        intent = self.epoch(OBSERVER); intent['previousControl'] = self.h.observer_health()
        self.put(prefix + 'observer-start-intent.json', intent)
        need(self.h.actor(OBSERVER, True) is None, 'post_intent_observer_must_still_be_terminal')
        self.h.manager('start', OBSERVER)
        return self.accept(prefix)

    def accept(self, prefix=''):
        op = self.operation(); parent = self.accept_parent(prefix); intent = self.get(prefix + 'observer-start-intent.json')
        observer = self.h.observer_managed(intent); control = self.h.observer_health()
        need(self.h.observer.first_cycle_complete(control, intent['previousControl']), 'new_observer_four_source_revision_advancement_required')
        self.stable(op); self.h.readiness()
        self.retired_writers(op)
        need(self.h.observer_managed(intent) == observer, 'observer_changed_before_final_ACK')
        elapsed = mono() - (self.get('restart-drain-parent-intent.json')['notBeforeUs'] if prefix else
                            self.get('drain-' + SOURCE + '-intent.json')['notBeforeUs'])
        bound = self.h.config['maximumColdStartSeconds']
        need(type(bound) is int and 1 <= bound <= 300 and elapsed <= bound * 1000000,
             'reviewed_cold_start_window_exceeded_inspect_or_owned_inverse')
        scheduled_sha = None
        if prefix:
            scheduled = self.get('scheduled-result.json')
            need(scheduled['scheduledSolanaAccepted'] is True and scheduled['resultSha256'] == sha(protected(BASE / 'result.json')) and
                 scheduled['operationSha256'] == sha(protected(BASE / 'operation.json')), 'same_actual_scheduled_publication_before_restart_required')
            scheduled_sha = sha(protected(BASE / 'scheduled-result.json'))
        result = {'format': FORMAT, 'completed': True, 'operationSha256': sha(protected(BASE / 'operation.json')),
                  'operatorSha256': op['operatorSha256'], 'bootId': boot(), 'source': parent['managed'], 'observer': observer,
                  'schema': SCHEMA, 'buildId': BUILD, 'schemaOid': '75963410', 'nativeTableIdentities': parent['native']['tables'],
                  'globalSelectorsChanged': False, 'checkpointsCopied': False, 'databaseWrites': 0, 'providerCalls': 0,
                  'paidAuthority': False, 'wholeOriginalValidatorsPassed': False, 'scheduledSolanaAccepted': bool(prefix),
                  'scheduledPublicationReceiptSha256': scheduled_sha,
                  'supervisedRestartAccepted': bool(prefix), 'recurringGenerationAccepted': False, 'marketplaceFullHistoryAccepted': False,
                  'availabilityObservationGapUpperBoundUs': elapsed, 'maximumColdStartSeconds': bound,
                  'actualHTTPOutageDurationClaimed': False, 'zeroOutageClaimed': False}
        self.put(prefix + 'result.json', result)
        return result

    def retired_writers(self, op):
        for unit in WRITERS:
            if unit == PARENT: continue
            need(self.h.actor(unit, True) is None and self.h.activation(unit)['boot'] is None and
                 self.h.definitions(unit) == op['activations'][unit]['definitions'],
                 'all_retired_writer_groups_definitions_and_restart_paths_required')
            r = op['activations'][unit]['boot']
            if r: moved_link_matches(HOLD / (unit + '.boot'), r)

    def active_prefix(self):
        if (BASE / 'restart-parent-start-intent.json').exists():
            need((BASE / 'restart-result.json').exists(), 'owned_restart_still_pending_no_final_authority')
            return 'restart-'
        return ''

    def source_leaf(self, result_sha):
        op = self.operation(); receipt = document(BASE / 'result.json', result_sha)
        need(receipt['completed'] is True and receipt['operatorSha256'] == op['operatorSha256'] and
             receipt['operationSha256'] == sha(protected(BASE / 'operation.json')) and
             not (BASE / 'inverse-intent.json').exists(), 'exact_unreversed_managed_ancestor_receipt_required')
        self.stable(op, False); self.retired_writers(op)
        prefix = self.active_prefix(); current = self.h.managed(self.get(prefix + 'parent-start-intent.json'))
        native = self.h.native(); native_preserved(op['native'], native); ready = self.h.readiness()
        self.h.sessions({PARENT: current}, all_native=True)
        d = self.get('drained.json'); sol = self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId']))
        prefix_preserved(d['solana'], sol)
        need(self.h.managed(self.get(prefix + 'parent-start-intent.json')) == current, 'source_epoch_changed_before_leaf_return')
        return {'format': FORMAT + '-source-leaf', 'validated': True, 'receiptSha256': result_sha,
                'operatorSha256': op['operatorSha256'], 'operationSha256': receipt['operationSha256'],
                'bootId': boot(), 'currentManagedEpoch': current, 'historicalC96ReceiptSha256': SOURCE_ACK,
                'historicalC96ActorClaimedCurrent': False, 'sourceRelease': RELEASE, 'schema': SCHEMA,
                'schemaOid': '75963410', 'buildId': BUILD, 'nativeTables': native['tables'],
                'nativeReadiness': ready, 'sourceReadinessQualified': True, 'financialAuthorityQualified': True,
                'supplementalAllColumnCatalogSha256': sha(encoded(op['columnCatalog'])),
                'consumerOrArenaAuthorityQualified': False, 'databaseWrites': 0, 'providerCalls': 0}

    def scheduled(self, result_sha):
        self.source_leaf(result_sha); d = self.get('drained.json')
        after = self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId']))
        fresh = self.h.query("SELECT jsonb_build_object('id',id,'startedAt',started_at,'manifestChecksum',manifest_checksum,'requestCount',request_count,'rowSha256',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')) FROM solana_indexer.scan_run r WHERE id=" + str(int(after['state']['publishedRunId'] or 0)))
        need(fresh['rowSha256'] == after['publishedRun']['rowSha256'], 'same_immutable_published_run_record_required')
        scheduled_publication(d['solana'], after, fresh)
        self.source_leaf(result_sha)
        result = {'format': FORMAT, 'scheduledSolanaAccepted': True, 'resultSha256': result_sha,
                  'operationSha256': sha(protected(BASE / 'operation.json')), 'newPublishedRun': after['publishedRun'],
                  'wholeExistingLedgerPrefixPreserved': True, 'newKeysOrPaidAuthority': False, 'providerCallsByOwner': 0}
        self.put('scheduled-result.json', result)
        return result

    def restart(self, result_sha):
        op = self.operation(); self.source_leaf(result_sha); self.stable(op)
        need(self.get('scheduled-result.json')['scheduledSolanaAccepted'] is True and
             not (BASE / 'restart-drain-observer-intent.json').exists() and
             not (BASE / 'restart-drain-parent-intent.json').exists(), 'one_explicit_restart_after_genuine_scheduled_publication_only')
        observer = self.h.observer_managed(self.get('observer-start-intent.json'))
        parent = self.h.managed(self.get('parent-start-intent.json'))
        self.stop_exact(OBSERVER, observer, 'restart-drain-observer')
        self.stop_exact(PARENT, parent, 'restart-drain-parent')
        sol = self.h.sql_solana(); need(sol['workerLock'] == {'granted': 0, 'waiting': 0}, 'restart_Solana_lock_must_be_free')
        self.put('restart-drained.json', {'solana': sol, 'native': self.h.native(), 'stoppedAtUs': mono()})
        intent = self.epoch(PARENT); intent['predecessorInvocation'] = parent['unit']['InvocationID']
        self.put('restart-parent-start-intent.json', intent)
        need(self.h.actor(PARENT, True) is None, 'post_intent_restart_parent_must_still_be_terminal')
        self.h.manager('start', PARENT)
        return self.accept_parent('restart-')

    def inspect(self):
        op = self.operation()
        return {'format': FORMAT, 'operationSha256': sha(protected(BASE / 'operation.json')),
                'units': {u: self.h.state(u) for u in UNITS}, 'solana': self.h.sql_solana(), 'native': self.h.native(),
                'automaticRetryAllowed': False, 'databaseWrites': 0, 'providerCalls': 0,
                'sameOperator': op['operatorSha256'] == sha(protected(Path(__file__).absolute()))}

    def restored_source_leaf(self, expected):
        op = self.operation(); result = document(BASE / 'inverse-result.json', expected)
        need(result['restored'] is True and result['operatorSha256'] == op['operatorSha256'] and result['bootId'] == boot() and
             result['operationSha256'] == sha(protected(BASE / 'operation.json')) and result['sourceReadinessRequalified'] is True,
             'actual_complete_owned_inverse_source_receipt_required')
        self.stable(op, False); actors = {}
        for unit in [SOURCE, PARENT, SOLANA, OBSERVER]:
            if op['units'][unit] is None:
                need(self.h.actor(unit, True) is None, 'originally_terminal_unit_must_remain_terminal_after_inverse')
                continue
            intent = BASE / ('inverse-start-' + unit + '-intent.json')
            if intent.exists(): actors[unit] = self.original_actor(unit, document(intent))
            else:
                actors[unit] = self.h.actor(unit)
                need(actors[unit] == op['units'][unit], 'undrained_original_actor_must_stay_exact')
        self.h.sessions(actors, all_native=True)
        quiet = self.get('inverse-drained.json'); native = self.h.native(); native_preserved(quiet['native'], native)
        if quiet['solanaFrozen']:
            prefix_preserved(quiet['solana'], self.h.sql_solana(int(quiet['solana']['ledgerPrefix']['throughId'])))
        self.h.readiness()
        for unit, actor in actors.items(): need(self.h.actor(unit) == actor, 'restored_source_epoch_changed_during_leaf_capture')
        return {'format': FORMAT + '-restored-source-leaf', 'validated': True, 'receiptSha256': expected,
                'operatorSha256': op['operatorSha256'], 'operationSha256': result['operationSha256'],
                'currentRestoredActors': actors, 'sourceRelease': RELEASE, 'schema': SCHEMA, 'schemaOid': '75963410',
                'buildId': BUILD, 'nativeTables': native['tables'], 'sourceReadinessQualified': True,
                'historicalC96ActorClaimedCurrent': False, 'historicalC96ReceiptSha256': SOURCE_ACK,
                'finalManagedTargetSelected': False, 'consumerOrArenaAuthorityQualified': False,
                'supplementalAllColumnCatalogSha256': sha(encoded(op['columnCatalog'])),
                'databaseWrites': 0, 'providerCalls': 0}

    def finish_stop(self, unit, actor, name):
        """Observe a possibly lost stop ACK, never issue its command again."""
        intent = self.get(name + '-intent.json')
        need(intent['value']['unit'] == unit and intent['value']['actor'] == actor and
             intent['operationSha256'] == sha(protected(BASE / 'operation.json')), 'same_owned_stop_intent_required')
        need(self.h.actor(unit, True) is None, 'unknown_stop_ACK_still_live_inspect_no_retry')
        self.h.sessions_gone(self.get(name + '-sessions.json'))
        if intent['value'].get('pendingRestartState'):
            self.h.failed_parent_quiet(self.operation())
        if not (BASE / (name + '-result.json')).exists(): self.put(name + '-result.json', {'value': {'terminal': True}, 'reconciled': True})

    def inverse_stop(self, unit, name):
        """New actors can have normally restarted; definition/epoch/kernel joins
        authenticate the current invocation, not the old result's PID alone."""
        h = self.h
        not_invoked = BASE / (name + '-not-invoked.json')
        if not_invoked.exists():
            proof = document(not_invoked)
            need(proof == {'managerCommandInvoked': False, 'bootId': boot(),
                           'operationSha256': sha(protected(BASE / 'operation.json'))} and
                 self.get(name + '-intent.json')['value'].get('pendingRestartState'),
                 'only_explicit_proven_no_command_CAS_prefix_may_have_new_stop_intent')
            name += '-after-CAS'
        # Terminal units need the same installed inodes too. A failed service is
        # not permission to stop/replace a foreign definition at that pathname.
        if (BASE / 'installed.json').exists():
            installed = self.get('installed.json')[unit]
            need(h.definitions(unit) == installed['definitions'] and h.activation(unit)['boot'] == installed['boot'],
                 'owned_new_unit_inodes_required_even_when_terminal')
        state = h.state(unit)
        if unit == PARENT and state['MainPID'] == state['ControlPID'] == '0' and state['ActiveState'] == 'activating' and state['SubState'] == 'auto-restart':
            return self.cancel_owned_restart(state, name)
        actor = h.actor(unit, True)
        if actor is not None:
            name_part = ('parent' if unit == PARENT else 'observer') + '-start-intent.json'
            epoch = self.get(('restart-' if (BASE / ('restart-' + name_part)).exists() else '') + name_part)
            owned = h.managed(epoch) if unit == PARENT else h.observer_managed(epoch)
            need(owned == actor, 'exact_current_owned_new_actor_required_for_inverse')
            if (BASE / (name + '-intent.json')).exists():
                raise RuntimeError('unknown_owned_stop_must_be_inspected_never_repeated')
            self.stop_exact(unit, actor, name)
        elif (BASE / (name + '-intent.json')).exists():
            intent = self.get(name + '-intent.json')
            self.finish_stop(unit, intent['value']['actor'], name)
        return {'terminal': True}

    def cancel_owned_restart(self, state, name):
        h = self.h; op = self.operation(); h.managed_settings()
        epoch_name = 'restart-parent-start-intent.json' if (BASE / 'restart-parent-start-intent.json').exists() else 'parent-start-intent.json'
        epoch = self.get(epoch_name)
        cg = Path('/sys/fs/cgroup/system.slice') / PARENT / 'cgroup.procs'
        need((not cg.exists() or not cg.read_text().split()) and state['NRestarts'].isdecimal() and
             int(state['ExecMainStartTimestampMonotonic']) >= epoch['notBeforeUs'],
             'owned_empty_parent_restart_epoch_required')
        proof = h.failed_parent_quiet(op)
        sessions = {role: {'owned': {PARENT: []}, 'other': v['other']} for role, v in proof.items()}
        self.put(name + '-sessions.json', sessions)
        def effect():
            if h.state(PARENT) != state:
                self.put(name + '-not-invoked.json', {'managerCommandInvoked': False, 'bootId': boot(),
                    'operationSha256': sha(protected(BASE / 'operation.json'))})
                raise RuntimeError('parent_restarted_before_stop_CAS_no_command_invoked')
            h.manager('stop', PARENT)
            need(h.actor(PARENT, True) is None, 'owned_restart_timer_must_be_cancelled_and_group_terminal')
            h.failed_parent_quiet(op)
            return {'terminal': True, 'ownedRestartCancelled': True}
        return self.step(name, {'unit': PARENT, 'actor': None, 'pendingRestartState': state,
                               'sourceStartIntentSha256': sha(protected(BASE / epoch_name))}, effect)

    def restore_files(self, op, finish):
        # Every new output has a prepared inode acknowledgement before rename;
        # this also handles failure between publication and its result write.
        for name in ['managed-unit', 'observer-unit', 'managed-egress']:
            prepared = BASE / (name + '-prepared.json')
            if not prepared.exists(): continue
            r = document(prepared); p = Path(r['path']); held = HOLD / (name + '.removed')
            if os.path.lexists(p) and identity(p) == r['identity']:
                need(sha(protected(p)) == r['sha256'], 'owned_new_definition_was_modified')
                self.move_owned(p, held, r['identity'], 'inverse-remove-' + name, finish)
            elif os.path.lexists(held): need(finish and identity(held) == r['identity'], 'same_owned_removed_definition_required')
            else:
                # A prepared output can still be unpublished, or its original
                # already restored by this inverse. No foreign path is unlinked.
                original = next((rec for v in op['activations'].values() for path, rec in v['definitions'].items() if path == str(p)), None)
                need(os.path.lexists(HOLD / (name + '.prepared')) or
                     finish and original and identity(p) == original['identity'], 'unrecognized_unit_publication_prefix')
        for unit in [PARENT, OBSERVER]:
            p = self.h.boot_link(unit); prepared = BASE / ('new-boot-' + unit + '-prepared.json')
            if prepared.exists():
                r = document(prepared)['link']; held = HOLD / (unit + '.removed-new-boot')
                if link_record(p) == r: self.move_owned(p, held, r['identity'], 'inverse-remove-boot-' + unit, finish)
                elif os.path.lexists(held): moved_link_matches(held, r)
                else: need(os.path.lexists(HOLD / (unit + '.new-boot')) or
                           finish and link_record(p) == op['activations'][unit]['boot'], 'unknown_new_boot_publication_prefix')
        for unit in [PARENT, OBSERVER]:
            for i, (p, r) in enumerate(op['activations'][unit]['definitions'].items()):
                original, held = Path(p), HOLD / (unit + '.definition-' + str(i))
                if os.path.lexists(held): self.move_owned(held, original, r['identity'], 'inverse-restore-definition-' + unit + '-' + str(i), finish)
                else: need(identity(original) == r['identity'] and sha(protected(original)) == r['sha256'], 'exact_original_definition_restoration_required')
        for unit in UNITS:
            r = op['activations'][unit]['boot']; p = self.h.boot_link(unit); held = HOLD / (unit + '.boot')
            if r:
                if os.path.lexists(held): self.move_owned(held, p, r['identity'], 'inverse-restore-boot-' + unit, finish)
                moved_link_matches(p, r)
            else: need(not os.path.lexists(p), 'original_absent_boot_path_must_remain_absent')

    def original_actor(self, unit, intent):
        op = self.operation(); actor = self.h.actor(unit)
        expected = op['units'][unit]
        need(expected is not None and actor['parent']['argv'] == expected['parent']['argv'] and
             actor['parent']['cwd'] == expected['parent']['cwd'] and actor['parent']['capabilitiesZero'] == expected['parent']['capabilitiesZero'] and
             all(actor['parent'][k] == expected['parent'][k] for k in ['uid', 'gid', 'groups', 'noNewPrivileges', 'capabilitySetSha256']) and
             actor['unit']['InvocationID'] != expected['unit']['InvocationID'] and
             int(actor['unit']['ExecMainStartTimestampMonotonic']) >= intent['notBeforeUs'] and
             self.h.definitions(unit) == op['activations'][unit]['definitions'] and
             self.h.activation(unit) == op['activations'][unit], 'exact_restored_program_new_owned_actor_and_original_boot_required')
        signature = lambda p: tuple(json.dumps(p[k], sort_keys=True) for k in ['argv', 'cwd', 'executable', 'uid', 'gid', 'groups', 'noNewPrivileges', 'capabilitySetSha256'])
        programs = {signature(p) for p in expected['processes']}
        need(all(signature(p) in programs for p in actor['processes']), 'no_foreign_program_in_restored_original_cgroup')
        return actor

    def inverse(self, finish=False):
        op = self.operation(); self.stable(op, False)
        inverse_intent = {'operationSha256': sha(protected(BASE / 'operation.json')), 'bootId': boot()}
        if not (BASE / 'inverse-intent.json').exists(): self.put('inverse-intent.json', inverse_intent)
        else: need(finish and self.get('inverse-intent.json') == inverse_intent, 'explicit_same_owned_finish_inverse_required')
        # Failed parent/observer or a parent Restart=on-failure epoch is allowed
        # only for this health-independent inverse, not forward readiness.
        for unit in [OBSERVER, PARENT]:
            if (BASE / ('new-boot-' + unit + '-prepared.json')).exists(): self.inverse_stop(unit, 'inverse-stop-' + unit)
        for unit in [OBSERVER, SOURCE, PARENT, SOLANA]:
            old = op['units'][unit]; name = 'drain-' + unit
            if old and (BASE / (name + '-intent.json')).exists() and not (BASE / (name + '-result.json')).exists(): self.finish_stop(unit, old, name)
            elif old and not (BASE / (name + '-intent.json')).exists():
                # Failure before draining this original actor is not authority
                # to stop it now. Preserve and verify it, resume only the others.
                need(self.h.actor(unit) == old, 'undrained_original_actor_must_be_exact')
        if not (BASE / 'inverse-drained.json').exists():
            sol = self.h.sql_solana()
            frozen = all(self.h.actor(u, True) is None for u in [PARENT, SOLANA])
            if frozen:
                need(sol['workerLock'] == {'granted': 0, 'waiting': 0}, 'all_owned_Solana_writers_and_lock_must_be_terminal')
            self.put('inverse-drained.json', {'solana': sol, 'native': self.h.native(), 'solanaFrozen': frozen})
        inverse = self.get('inverse-drained.json')
        if (BASE / 'drained.json').exists():
            d = self.get('drained.json'); prefix_preserved(d['solana'], self.h.sql_solana(int(d['solana']['ledgerPrefix']['throughId'])))
        self.restore_files(op, finish)
        if not (BASE / 'inverse-reload-intent.json').exists(): self.step('inverse-reload', {}, lambda: self.h.manager('daemon-reload'))
        else:
            reload_intent = self.get('inverse-reload-intent.json')
            need(reload_intent['operationSha256'] == inverse_intent['operationSha256'] and reload_intent['bootId'] == boot() and
                 reload_intent['value'] == {}, 'same_owned_inverse_reload_intent_required')
        # An unknown reload ACK is reconciled by actual manager definitions, not
        # by blindly repeating the command.
        for unit in UNITS:
            need(self.h.activation(unit) == op['activations'][unit] and
                 definition_frame(self.h.state(unit)) == op['unitDefinitionFrames'][unit],
                 'original_loaded_commands_dependencies_activation_and_inodes_not_restored')
        actors = {}
        for unit in [SOURCE, PARENT, SOLANA, OBSERVER]:
            if op['units'][unit] is None: continue
            name = 'inverse-start-' + unit; path = BASE / (name + '-intent.json')
            if (BASE / ('drain-' + unit + '-intent.json')).exists():
                if path.exists():
                    need(finish, 'unknown_original_start_ACK_requires_explicit_finish')
                    actors[unit] = self.original_actor(unit, document(path))
                else:
                    need(self.h.actor(unit, True) is None, 'no_foreign_original_restart_before_owned_inverse_start')
                    # Before the first writer resumes, prove no stopped state,
                    # schedule, stage, prefix or checkpoint was rolled back.
                    if inverse['solanaFrozen'] and not actors and all(self.h.actor(u, True) is None for u in [PARENT, SOLANA]):
                        stopped_solana(inverse['solana'], self.h.sql_solana(int(inverse['solana']['ledgerPrefix']['throughId'])))
                    intent = {'notBeforeUs': mono(), 'predecessor': op['units'][unit], 'bootId': boot()}
                    self.put(name + '-intent.json', intent)
                    need(self.h.actor(unit, True) is None, 'post_intent_original_unit_must_be_terminal')
                    self.h.manager('start', unit); actors[unit] = self.original_actor(unit, intent)
                    self.put(name + '-result.json', {'actor': actors[unit]})
            else: actors[unit] = self.h.actor(unit)
        sol = self.h.sql_solana(int(inverse['solana']['ledgerPrefix']['throughId']))
        if inverse['solanaFrozen']: prefix_preserved(inverse['solana'], sol)
        else:
            # A pre-drain inverse may leave the unchanged original worker
            # running. Its reserved usage rows can legitimately finish. Do not
            # fabricate an immutable prefix from a live observation.
            need(sol['manifest'] == inverse['solana']['manifest'] and
                 int(sol['ledgerCurrent']['credits']) >= int(inverse['solana']['ledgerCurrent']['credits']) and
                 int(sol['state']['publishedRunId'] or 0) >= int(inverse['solana']['state']['publishedRunId'] or 0),
                 'undrained_original_Solana_progress_must_not_rewind')
        native_preserved(inverse['native'], self.h.native()); self.stable(op); self.h.readiness()
        for unit, actor in actors.items(): need(self.h.actor(unit) == actor, 'restored_actor_changed_before_inverse_receipt')
        result = {'format': FORMAT, 'restored': True, 'operationSha256': sha(protected(BASE / 'operation.json')),
                  'operatorSha256': op['operatorSha256'], 'bootId': boot(), 'restoredActors': actors,
                  'solanaWholePrefixPreserved': inverse['solanaFrozen'], 'undrainedOriginalSolanaRetained': not inverse['solanaFrozen'],
                  'legitimateSolanaPublicationsRetained': True,
                  'originalBootInodesRestored': True, 'checkpointsCopied': False, 'databaseWrites': 0,
                  'oldC96ActorRelabelled': False, 'sourceReadinessRequalified': True}
        self.put('inverse-result.json', result)
        return result


def validate_source_leaf(result_sha, manifest_sha, input_sha):
    """Explicit current source authority; never calls consumer/Arena leaves."""
    return Owner(Host(manifest_sha, input_sha)).source_leaf(result_sha)


def validate_current(result_sha, manifest_sha, input_sha):
    owner = Owner(Host(manifest_sha, input_sha)); value = owner.source_leaf(result_sha)
    op = owner.operation(); owner.stable(op)
    prefix = owner.active_prefix(); owner.h.observer_managed(owner.get(prefix + 'observer-start-intent.json'))
    return {**value, 'managedObserverQualified': True, 'phaseConsumersQualified': True,
            'recurringGenerationOr24HourAcceptanceQualified': False, 'marketplaceFullHistoryAccepted': False}


def validate_restored_source_leaf(inverse_sha, manifest_sha, input_sha):
    return Owner(Host(manifest_sha, input_sha)).restored_source_leaf(inverse_sha)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest-sha'); p.add_argument('--input-sha')
    phases = p.add_mutually_exclusive_group()
    phases.add_argument('--drain', metavar='REVIEW_SHA'); phases.add_argument('--install', action='store_true')
    phases.add_argument('--start-parent', action='store_true'); phases.add_argument('--reconcile-parent', action='store_true')
    phases.add_argument('--start-observer', action='store_true'); phases.add_argument('--reconcile-observer', action='store_true')
    phases.add_argument('--inspect', action='store_true')
    phases.add_argument('--columns', action='store_true')
    phases.add_argument('--validate-restored', metavar='INVERSE_SHA')
    phases.add_argument('--inverse', action='store_true'); phases.add_argument('--finish-inverse', action='store_true')
    phases.add_argument('--scheduled', metavar='RESULT_SHA'); phases.add_argument('--restart', metavar='RESULT_SHA')
    phases.add_argument('--reconcile-restart-parent', action='store_true')
    phases.add_argument('--start-restart-observer', action='store_true')
    phases.add_argument('--reconcile-restart-observer', action='store_true')
    a = p.parse_args()
    if a.columns:
        need(os.geteuid() == 0 and not a.input_sha and not a.manifest_sha, 'standalone_root_readonly_column_capture_required')
        h = Host.__new__(Host)
        print(json.dumps({'format': FORMAT + '-column-baseline', 'dataOnly': True, 'sourceReadinessQualified': False,
                          'operatorSha256': sha(protected(Path(__file__).absolute())), 'sqlSha256': COLUMN_SQL_SHA,
                          'sourceReceiptSha256': SOURCE_ACK, 'catalog': h.columns(), 'databaseWrites': 0, 'providerCalls': 0}, sort_keys=True)); return
    if not a.manifest_sha and not a.input_sha:
        need(not any([a.drain, a.install, a.start_parent, a.reconcile_parent, a.start_observer, a.reconcile_observer,
                      a.inspect, a.inverse, a.finish_inverse, a.scheduled, a.restart, a.reconcile_restart_parent,
                      a.start_restart_observer, a.reconcile_restart_observer, a.validate_restored]), 'explicit_actual_inputs_required_for_every_runtime_phase')
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'qualified': False, 'databaseWrites': 0,
                          'serviceActions': 0, 'providerCalls': 0, 'requiredInputs': ['actual frozen external producers',
                          'completed readers/metadata/cache/feature/Arena', 'actual observer ACK', 'retained Solana ownership/auth']})); return
    need(pin(a.manifest_sha) and pin(a.input_sha), 'actual_manifest_and_private_input_checksums_required')
    need(os.geteuid() == 0, 'root_operator_required')
    with lock():
        owner = Owner(Host(a.manifest_sha, a.input_sha))
        if a.drain: value = owner.drain(a.drain)
        elif a.install: value = owner.install()
        elif a.start_parent: value = owner.start_parent()
        elif a.reconcile_parent: value = owner.accept_parent()
        elif a.start_observer: value = owner.start_observer()
        elif a.reconcile_observer: value = owner.accept()
        elif a.inspect: value = owner.inspect()
        elif a.inverse or a.finish_inverse: value = owner.inverse(a.finish_inverse)
        elif a.scheduled: value = owner.scheduled(a.scheduled)
        elif a.restart: value = owner.restart(a.restart)
        elif a.reconcile_restart_parent: value = owner.accept_parent('restart-')
        elif a.start_restart_observer: value = owner.start_observer('restart-')
        elif a.reconcile_restart_observer: value = owner.accept('restart-')
        elif a.validate_restored: value = owner.restored_source_leaf(a.validate_restored)
        else: value = owner.review()
        print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as e:
        print(json.dumps({'format': FORMAT, 'failed': True, 'code': str(e) if re.fullmatch('[A-Za-z0-9_]+', str(e)) else type(e).__name__,
                          'automaticRetryAllowed': False, 'privateValuesExported': False})); raise SystemExit(1)
