#!/usr/bin/env python3
"""Insert one free combined profile and own four separate loopback proxies.

No old unit is changed. Review captures old ancestry once; subsequent phases
preserve the directly observed old proxies and live YPAL actors, independently
of whether the old combined source has since been deliberately drained.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import time
import types
import urllib.request

FORMAT = 'yunipals-ypal-combined-rpc-admission-v3'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PUBLIC = OPS / 'ypal-combined-rpc-v1'
BASE = Path('/var/backups/yunipals-ypal-combined-rpc-admission-v3-20261023')
OLD_OWNER = OPS / 'ypal-rpc-admission-v2.py'
OLD_OWNER_SHA = '45cfa08ba3a2de5de775053081b954dbb5a5e732871e8db1b80fa0b16fe5591e'
YPAL_ACK = '14b54f8aba5179c26cafad5eda647106f1d1d57fe6639278846a4240661b85c7'
PROFILE = PUBLIC / 'profile.json'
APPROVAL = PUBLIC / 'approval.json'
RUNNER = PUBLIC / 'official.mjs'
PROFILE_SHA = 'c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b'
APPROVAL_SHA = '79b047cec82b5108eb79f56588c62b3bc2857b3c863dceb7d2239a14e87e5da5'
RUNNER_SHA = '8cc6083f82420f4a9dd075f1b26dd9dfdfe42dd55c232415607ece884de4057b'
PROFILE_ID = '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'
MANIFEST_HASH = '0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112'
OLD_PROFILE_ID = '0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728'
YPAL_PROFILE_ID = '0x25308afec8bf9d4992afb5dbf52675d958ee1c619533e7917ae3fe08dbd29c86'
EXPIRY = '2026-11-19T18:00:00.000Z'
NODE = '/opt/node-v24.18.1/bin/node'
ESBUILD = '/var/lib/yunipals-unified-shadow/20261020-008028af-a/node_modules/.pnpm/@esbuild+linux-x64@0.25.12/node_modules/@esbuild/linux-x64/bin/esbuild'
ESBUILD_SHA = 'bab29b2ca7a9e89b67cf720b77b2d743f9f31f5cf0d5bd74ee8c8de30ced7014'
SOURCE = 'yunipals-ypal-combined-source.service'
# Admission can complete now. Four max2 proxy pools would exceed the retained
# budget role's worst-case capacity; a separate reviewed max1 artifact is needed.
SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA = None
CHAINS = {'ethereum': (1, 19221), 'base': (8453, 19222), 'polygon': (137, 19223), 'bnb': (56, 19224)}
YPAL_UNITS = ['yunipals-ypal-base-rpc.service', 'yunipals-booster-ypal-source.service', 'yunipals-booster-api.service']
YPAL_IDENTITIES = {
    YPAL_UNITS[0]: ('2238064', '76e58064c4544d69a2a7b090b1102a01'),
    YPAL_UNITS[1]: ('2309283', '3744d80464924b5ca1de340ac94c1034'),
    YPAL_UNITS[2]: ('2334701', '3a3b4014f75b4db9968f4c5ee26fa904')}
YPAL_SOURCE_BASE = Path('/var/backups/yunipals-ypal-source-start-v1-20261023')
YPAL_READER_BASE = Path('/var/backups/yunipals-ypal-reader-cutover-v1-20261023')
YPAL_BOOT_BASE = Path('/var/backups/yunipals-ypal-api-enable-boot-v1-20261023')
YPAL_SOURCE_SHA = '581990e80baa6ae074786b7b2cf7c771c82ebe046253a1de23a96f251d900efd'
YPAL_READER_SHA = '9bf720f7d669b1863184db4214602a16346f7913d6d2fbdcd4090a42c1ba6e1c'
YPAL_BOOT_SHA = '30fabaf05eb34e9b39c513457abf178996deeab72941bc9df9850e5c4ab423a3'
READER_FILE = Path('/var/backups/yunipals-ypal-backend-input-v1-20261023/ypal-reader-cutover-v1.py')
READER_SHA = 'f6037061b599ebf949a781e6dc685cfc97961c8cff40bd6b7bf73a78113fe3d8'
YPAL_SOURCE_ROOT = Path('/var/lib/yunipals-booster-ypal/base-ypal-v1-source008')
QUEUE = 'yunipals-booster-artwork-queue.service'
TIMER = 'yunipals-booster-artwork-queue.timer'
FIELDS = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'Job',
          'FragmentPath', 'DropInPaths', 'NRestarts', 'WorkingDirectory', 'ControlGroup',
          'ExecMainStartTimestampMonotonic', 'ExecStart', 'TimeoutStartUSec', 'TimeoutStopUSec',
          'EnvironmentFiles', 'Environment', 'UnitFileState']
PAID_FLAGS = ['PAID_FALLBACK_ON_FREE_FAILURE', 'FOREGROUND_PAID_FALLBACK_ON_FREE_FAILURE',
              'ORDER_PAID_FALLBACK_ON_FREE_FAILURE', 'SOURCE_PAID_FALLBACK_ON_FREE_FAILURE',
              'SALE_PAID_FALLBACK_ON_FREE_FAILURE', 'UNIFIED_SOURCE_PAID_PRIMARY', 'UNIFIED_SOURCE_PAID_LOGS']


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def old_unit(chain): return 'yunipals-market-production-rpc@' + chain + '.service'
def unit(chain):
    need(chain in CHAINS, 'fixed_chain_required')
    return 'yunipals-combined-rpc@' + chain + '.service'
def paths(chain):
    name = unit(chain)
    return {'unit': Path('/etc/systemd/system') / name,
            'env': PUBLIC / (chain + '.env'),
            'boot': Path('/etc/systemd/system/multi-user.target.wants') / name}


def core():
    for p in [*OLD_OWNER.parents, OLD_OWNER]:
        s = p.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, 'protected_frozen_owner_required')
    raw = OLD_OWNER.read_bytes()
    need(sha(raw) == OLD_OWNER_SHA, 'exact_frozen_ypal_owner_required')
    module = types.ModuleType('retained_ypal_owner'); module.__file__ = str(OLD_OWNER)
    exec(compile(raw, str(OLD_OWNER), 'exec'), module.__dict__)
    m = module.core()
    need(sha(m.protected(OLD_OWNER)) == OLD_OWNER_SHA, 'frozen_owner_changed_during_load')
    m.BASE = BASE  # Only the immutable owner's filesystem primitives use this.
    return m, module


def state(m, name):
    allowed = {SOURCE, *YPAL_UNITS, *(old_unit(c) for c in CHAINS), *(unit(c) for c in CHAINS)}
    need(name in allowed, 'fixed_units_only')
    keys = list(dict.fromkeys(FIELDS + m.SECURITY))
    raw = m.run(['/usr/bin/systemctl', 'show', '--all', name, *['--property=' + k for k in keys]], timeout=8)
    values = dict(line.split('=', 1) for line in raw.decode().splitlines())
    # The actual host omits empty ExecStart only for not-found units. Never
    # normalize a loaded unit or any other missing property.
    if values.get('LoadState') == 'not-found' and 'ExecStart' not in values:
        need(name in {SOURCE, *(unit(c) for c in CHAINS)} and values.get('MainPID') == '0' and
             values.get('ActiveState') == 'inactive' and values.get('Job') in {'', '0'} and
             values.get('FragmentPath') == values.get('DropInPaths') == '', 'verified_absent_unit_command_required')
        values['ExecStart'] = ''
    # systemctl omits an empty EnvironmentFiles array on this host. Do not
    # guess it: use its fixed typed manager property when omitted.
    if 'EnvironmentFiles' not in values:
        object_path = '/org/freedesktop/systemd1/unit/' + re.sub(r'[^A-Za-z0-9]', lambda x: '_' + format(ord(x[0]), '02x'), name)
        typed = json.loads(m.run(['/usr/bin/busctl', '--json=short', 'get-property', 'org.freedesktop.systemd1', object_path,
                                 'org.freedesktop.systemd1.Service', 'EnvironmentFiles'], timeout=8)) if values.get('LoadState') != 'not-found' else {'type': 'a(sb)', 'data': []}
        need(typed == {'type': 'a(sb)', 'data': []}, 'typed_empty_environment_files_required')
        values['EnvironmentFiles'] = ''
    need(set(values) == set(keys) and values['Id'] == name, 'complete_fixed_unit_state_required')
    return values


def definition(m, value, instance=None):
    files = [value['FragmentPath'], *shlex.split(value['DropInPaths'])]
    need(all(p.startswith('/etc/systemd/system/') for p in files), 'retained_system_unit_paths_required')
    hashes, refs, parts = {}, {}, []
    for path in files:
        raw = m.protected(path); hashes[path] = sha(raw); text = raw.decode()
        specifiers = set(re.findall('%[a-zA-Z%]', text))
        need(not specifiers or instance is not None and specifiers <= {'%i'}, 'only_known_instance_specifier_required')
        if instance is not None: text = text.replace('%i', instance)
        parts.append(text)
        for line in text.splitlines():
            if line.startswith('EnvironmentFile=') and line != 'EnvironmentFile=':
                path = line.split('=', 1)[1]
                need(re.fullmatch('/[A-Za-z0-9_./@-]+', path), 'fixed_required_environment_file_required')
                refs[path] = sha(m.protected(path))
    return {'definitionHashes': hashes, 'environmentFileHashes': refs}, '\n'.join(parts)


PEER = r"""import hashlib,json,os,pathlib,re,sys
pid=int(sys.argv[1]);uid=int(sys.argv[2]);gid=int(sys.argv[3]);group=sys.argv[4];expected=json.loads(sys.argv[5])
assert 1<pid<2147483648 and 0<uid<65536 and 0<gid<65536 and group.startswith('/system.slice/') and '..'not in group
assert len(expected)<=40 and all(re.fullmatch('[A-Z0-9_]+',k)and isinstance(v,str)and len(v)<2000 for k,v in expected.items())
me=dict(x.split(':',1)for x in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in x)
assert os.getuid()==os.geteuid()==uid and os.getgid()==os.getegid()==gid and os.getgroups()==[] and me['NoNewPrivs'].strip()=='1'and all(int(me[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])
p=pathlib.Path('/proc')/str(pid)
def ticks():
 s=(p/'stat').read_text();return int(s[s.rfind(')')+2:].split()[19])
a=ticks();status=dict(x.split(':',1)for x in(p/'status').read_text().splitlines()if ':'in x)
assert set(status['Uid'].split())=={str(uid)}and set(status['Gid'].split())=={str(gid)}and(p/'cgroup').read_text().splitlines()==['0::'+group]
command=(p/'cmdline').read_bytes();environment=(p/'environ').read_bytes();assert len(command)<=100000 and len(environment)<=1000000
def public_env_matches(environment,expected,pid,group):
 # Only the acknowledged Node --env-file source loads these after exec. Its
 # argv/files/native catalog are independently bound by retained().
 file_loaded=pid==2309283 and group=='/system.slice/yunipals-booster-ypal-source.service'
 return all(environment.get(k.encode(),v.encode()if file_loaded else None)==v.encode()for k,v in expected.items())
e=dict(x.split(b'=',1)for x in environment.split(b'\0')if b'='in x);assert public_env_matches(e,expected,pid,group)
paths=[x.split('=',1)[1]for x in command.decode().strip('\0').split('\0')if x.startswith('--env-file=')]
assert len(paths)<=12 and all(x.startswith('/')and len(x)<=500 for x in paths)and ticks()==a
print(json.dumps({'pid':pid,'startTicks':a,'commandSha256':hashlib.sha256(command).hexdigest(),'environmentSha256':hashlib.sha256(environment).hexdigest(),'environmentFiles':paths,'executableSha256':hashlib.sha256(os.readlink(p/'exe').encode()).hexdigest(),'parentPid':int(status['PPid']),'publicEnvironmentMatched':True,'privileges':{k:status[k].strip()for k in ['Uid','Gid','Groups','NoNewPrivs','CapInh','CapPrm','CapEff','CapBnd','CapAmb']}},sort_keys=True))
"""


def peer_actor(m, pid, account, cgroup, expected=None):
    value = json.loads(m.run(['/usr/bin/setpriv', '--reuid=' + str(account.pw_uid), '--regid=' + str(account.pw_gid),
                             '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs',
                             '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', PEER,
                             str(pid), str(account.pw_uid), str(account.pw_gid), cgroup, json.dumps(expected or {})], timeout=8))
    need(value['pid'] == pid and value['publicEnvironmentMatched'] is True and type(value['startTicks']) is int and
         value['startTicks'] > 0 and all(re.fullmatch('[0-9a-f]{64}', value[k]) for k in ['commandSha256', 'environmentSha256']), 'bounded_same_uid_process_proof_required')
    value['environmentFileHashes'] = {p: sha(m.protected(p)) for p in value.pop('environmentFiles')}
    return value


def live_actor(m, value, expected=None):
    need(value['ActiveState'] == 'active' and value['SubState'] == 'running' and value['Job'] in {'', '0'} and
         re.fullmatch('[1-9][0-9]*', value['MainPID']) and re.fullmatch('[0-9a-f]{32}', value['InvocationID']), 'live_actor_without_job_required')
    need(value['User'] in {'yunipals-market-prod-rpc', 'yunipals_unified_shadow', 'yunipals_unified_collector'}, 'fixed_retained_peer_account_required')
    account = pwd.getpwnam(value['User'])
    cgroup = value['ControlGroup']
    need(cgroup.startswith('/system.slice/') and '..' not in cgroup, 'fixed_system_cgroup_required')
    cg = Path('/sys/fs/cgroup' + cgroup) / 'cgroup.procs'
    pids = sorted(int(x) for x in cg.read_text().split())
    need(1 <= len(pids) <= 16 and int(value['MainPID']) in pids, 'bounded_live_actor_cgroup_required')
    actors = [peer_actor(m, pid, account, cgroup, expected if pid == int(value['MainPID']) else None) for pid in pids]
    need(sorted(int(x) for x in cg.read_text().split()) == pids, 'actor_set_changed_during_read')
    return {'pid': int(value['MainPID']), 'invocation': value['InvocationID'],
            'startMonotonicMicroseconds': int(value['ExecMainStartTimestampMonotonic']), 'cgroup': cgroup, 'processes': actors}


def retained(m):
    accepted, expected = accepted_ypal(m)
    result = {}
    for name in [*(old_unit(c) for c in CHAINS), *YPAL_UNITS]:
        s = state(m, name)
        if name in YPAL_IDENTITIES: need((s['MainPID'], s['InvocationID']) == YPAL_IDENTITIES[name], 'acknowledged_ypal_actor_required')
        chain = next((c for c in CHAINS if name == old_unit(c)), None)
        files, _ = definition(m, s, chain)
        actor = live_actor(m, s, expected.get(name))
        after = state(m, name)
        stable = [k for k in s if k not in {'ExecStart', 'Environment', 'EnvironmentFiles'}]
        need(all(after[k] == s[k] for k in stable), 'retained_unit_changed_during_read')
        result[name] = {**files, 'actor': actor, 'settings': {k: s[k] for k in stable},
                        'environmentPropertySha256': sha(s['Environment'].encode()),
                        'environmentFilesPropertySha256': sha(s['EnvironmentFiles'].encode())}
    source = result[YPAL_UNITS[1]]; actual = source['actor']; acknowledged = accepted['source']
    need(actual['pid'] == acknowledged['pid'] and actual['invocation'] == acknowledged['invocation'] and
         [(p['pid'], p['startTicks']) for p in actual['processes']] == sorted((p['pid'], p['startTicks']) for p in acknowledged['peerProofs']) and
         source['definitionHashes'] == {str(Path('/etc/systemd/system') / YPAL_UNITS[1]): acknowledged['definitionSha256']} and
         source['settings']['UnitFileState'] == 'enabled' and len(actual['processes']) == 2 and
         actual['processes'][0]['commandSha256'] == accepted['sourceCommandSha256'] and
         actual['processes'][0]['executableSha256'] == sha(NODE.encode()) and
         actual['processes'][1]['commandSha256'] == sha((ESBUILD + '\0--service=0.25.12\0--ping\0').encode()) and
         actual['processes'][1]['executableSha256'] == sha(ESBUILD.encode()) and actual['processes'][1]['parentPid'] == actual['pid'], 'accepted_ypal_source_identity_and_definition_required')
    api = result[YPAL_UNITS[2]]; a = accepted['api']
    need(api['actor']['pid'] == int(a['MainPID']) and api['actor']['invocation'] == a['InvocationID'] and
         api['actor']['processes'][0]['startTicks'] == a['startTicks'] and len(api['actor']['processes']) == 1 and
         api['settings']['UnitFileState'] == 'enabled', 'accepted_api_identity_required')
    rpc = accepted['rpc']; r = result[YPAL_UNITS[0]]
    need(r['actor']['pid'] == rpc['runtime']['pid'] and r['actor']['invocation'] == rpc['runtime']['invocation'] and
         r['actor']['processes'][0]['startTicks'] == rpc['runtime']['startTicks'] and len(r['actor']['processes']) == 1 and
         r['definitionHashes'] == rpc['proxy']['definitionHashes'] and r['settings']['UnitFileState'] == 'enabled', 'accepted_ypal_proxy_identity_required')
    result['acceptedYpal'] = {k: v for k, v in accepted.items() if k not in {'source', 'api', 'rpc'}}
    return result


def check_link(path, record):
    s = path.lstat()
    need(stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and os.readlink(path) == record['target'] and
         all(getattr(s, k) == v for k, v in record['identity'].items()), 'accepted_owned_boot_link_required')


def source_query(m, sql):
    sentinel = '/run/yunipals-combined-rpc-no-password-file'
    need(not os.path.lexists(sentinel), 'absent_peer_password_file_required')
    opts = '-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000'
    return json.loads(m.run([*m.peer(), '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC',
                            'PGPASSFILE=' + sentinel, 'PGOPTIONS=' + opts, '/usr/bin/psql', '-XwAtq', '-h', '/var/run/postgresql',
                            '-p', '5432', '-U', 'postgres', '-d', 'yunipals_backfill', '-v', 'ON_ERROR_STOP=1'],
                           ('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;' + sql + ';ROLLBACK;').encode(), timeout=20))


def accepted_ypal(m):
    source = json.loads(m.pinned(YPAL_SOURCE_BASE / 'result.json', YPAL_SOURCE_SHA))
    reader = json.loads(m.pinned(YPAL_READER_BASE / 'finalization-v2-result.json', YPAL_READER_SHA))
    boot = json.loads(m.pinned(YPAL_BOOT_BASE / 'result.json', YPAL_BOOT_SHA))
    rpc = json.loads(m.pinned(Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023/result.json'), YPAL_ACK))
    need(source['ready'] is True and source['sourceStarted'] is True and reader['completed'] is True and boot['completed'] is True and
         all(x['bootId'] == m.boot() for x in [source, reader, boot, rpc]) and reader['sourceReceiptSha256'] == YPAL_SOURCE_SHA and
         boot['finalizationSha256'] == YPAL_READER_SHA and boot['actor'] == reader['API'], 'accepted_ypal_receipt_chain_required')
    need(not any((p / 'inverse-intent.json').exists() for p in [YPAL_SOURCE_BASE, YPAL_READER_BASE]) and
         not (Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023') / 'stop-intent.json').exists(), 'unreversed_ypal_receipts_required')
    # Fixed accepted proxy files and boot link are checked independently of its
    # obsolete full validator, which also requires the old source alive.
    m.pinned(rpc['profileFile'], rpc['profileFileSha256'])
    need(m.protected(m.ENV_FILE) == m.env_bytes(), 'accepted_ypal_proxy_public_environment_required')
    rpc_boot = json.loads(m.protected(Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023/boot-prepared.json')))
    need(rpc_boot['path'] == str(m.BOOT_LINK), 'accepted_proxy_boot_path_required'); check_link(m.BOOT_LINK, rpc_boot)
    operation = json.loads(m.pinned(YPAL_SOURCE_BASE / 'operation.json', source['operationSha256']))
    m.pinned(ESBUILD, ESBUILD_SHA)
    public_pins = {}
    for path, row in operation['publicFilePins'].items():
        target = YPAL_SOURCE_ROOT / path; need(path in {'launch.public.env', 'ponder.ypal.config.ts'}, 'fixed_source_public_files_required')
        m.pinned(target, row['sha256']); public_pins[str(target)] = row['sha256']
    for path, row in operation['preparationOperation']['snapshot']['privateInputHashes'].items(): m.pinned(path, row['sha256'])
    for row in reader['published']:
        m.pinned(row['path'], row['sha256']); s = Path(row['path']).lstat()
        need(all(getattr(s, k) == v for k, v in row['identity'].items()), 'accepted_reader_publication_inode_required')
    for path, pin in boot['definitionHashes'].items(): m.pinned(path, pin)
    check_link(Path(boot['link']), {'target': boot['target'], 'identity': boot['linkIdentity']})
    enable_intent_raw = m.protected(YPAL_SOURCE_BASE / 'enable-new-source-intent.json')
    enable_intent = json.loads(enable_intent_raw); enable = json.loads(m.protected(YPAL_SOURCE_BASE / 'enable-new-source-result.json'))
    need(enable_intent['operationSha256'] == source['operationSha256'] and enable_intent['bootId'] == m.boot() and
         enable['intentSha256'] == sha(enable_intent_raw), 'accepted_source_enable_chain_required')
    check_link(Path('/etc/systemd/system/multi-user.target.wants') / YPAL_UNITS[1], enable['result'])
    # Preserve the scheduled oneshot's definition/environment, not its changing
    # execution PID or timer's transient job while it legitimately fires.
    queue = {}
    for name in [QUEUE, TIMER]:
        keys = ['Id', 'LoadState', 'FragmentPath', 'DropInPaths', 'UnitFileState'] + (['ActiveState'] if name == TIMER else [])
        row = dict(x.split('=', 1) for x in m.run(['/usr/bin/systemctl', 'show', '--all', name, *['--property=' + k for k in keys]], timeout=8).decode().splitlines())
        need(set(row) == set(keys) and row['Id'] == name and row['LoadState'] == 'loaded', 'accepted_queue_definition_required')
        if name == TIMER: need(row['ActiveState'] == 'active' and row['UnitFileState'] == 'enabled', 'accepted_active_queue_schedule_required')
        files, _ = definition(m, row)
        original = operation['preparationOperation']['snapshot']['queue']['timer' if name == TIMER else 'service']
        for path, info in original['definitionFiles'].items(): need(files['definitionHashes'].get(path) == info['sha256'], 'retained_queue_base_definition_required')
        expected_drop = '' if name == TIMER else '/etc/systemd/system/' + QUEUE + '.d/95-ypal.conf'
        need(row['DropInPaths'] == expected_drop, 'only_accepted_queue_overlay_required')
        queue[name] = {'settings': row, **files}
    reader_raw = m.pinned(READER_FILE, READER_SHA); module = types.ModuleType('accepted_reader_catalog'); module.__file__ = str(READER_FILE)
    exec(compile(reader_raw, str(READER_FILE), 'exec'), module.__dict__)
    catalog_value = source_query(m, module.catalog_sql()); module.validate_catalog(catalog_value, True)
    need(sha(encoded(catalog_value)) == reader['roleGraphSha256'], 'accepted_reader_catalog_required')
    native = source_query(m, "SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='yunipals_boosters_ypal_v1'),'build',(SELECT value->>'build_id' FROM yunipals_boosters_ypal_v1._ponder_meta WHERE key='app'),'ready',(SELECT value->>'is_ready' FROM yunipals_boosters_ypal_v1._ponder_meta WHERE key='app'),'tables',(SELECT jsonb_object_agg(c.relname,c.oid::text)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_boosters_ypal_v1' AND c.relname=ANY(ARRAY[" + ','.join("'" + k + "'" for k in source['readTableOids']) + "])))")
    need(native == {'schemaOid': source['schemaOid'], 'build': '8e88ea2e00', 'ready': '1', 'tables': source['readTableOids']}, 'accepted_native_ypal_identity_ready_required')
    values = source_query(m, "SELECT jsonb_build_object('app',(SELECT value FROM yunipals_boosters_ypal_v1._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM yunipals_boosters_ypal_v1._ponder_checkpoint WHERE chain_id=8453),'clock',floor(extract(epoch FROM statement_timestamp())*1000)::bigint,'types',(SELECT jsonb_agg(to_jsonb(t))FROM yunipals_boosters_ypal_v1.booster_type t))")
    native_rules(values, operation)
    api = get(9030, '/v1/boosters/types')
    need(api.get('ready') is True and api.get('buildId') == '8e88ea2e00' and api.get('engine') == '0xdf4aaa47fe0e8208b5a33c74898f834b2952189e' and
         api.get('collection') == '0x7d62628806e7eef76a354c7c48787879e3440b16', 'accepted_live_ypal_api_required')
    public_env = lambda path: dict(line.split('=', 1) for line in m.protected(path).decode().splitlines() if line and not line.startswith('#'))
    expected = {YPAL_UNITS[1]: public_env(YPAL_SOURCE_ROOT / 'launch.public.env'),
                YPAL_UNITS[2]: public_env('/etc/yunipals-unified/booster-ypal.public.env'),
                YPAL_UNITS[0]: dict(line.split('=', 1) for line in m.env_bytes().decode().splitlines())}
    return {'source': source['source'], 'api': reader['API'], 'rpc': rpc, 'sourceReceiptSha256': YPAL_SOURCE_SHA,
            'readerReceiptSha256': YPAL_READER_SHA, 'bootReceiptSha256': YPAL_BOOT_SHA, 'publicFilePins': public_pins,
            'readerCatalogSha256': reader['roleGraphSha256'], 'native': native, 'queue': queue,
            'sourceBoot': enable['result'], 'apiBoot': boot['linkIdentity'], 'rpcBoot': rpc_boot,
            'sourceCommandSha256': sha(('\0'.join(operation['argv']) + '\0').encode()),
            'acceptedTypeRulesSha256': sha(encoded(native_rules(values, operation))), 'apiReady': True}, expected


def native_rules(row, operation):
    """Preserve the accepted type and fresh complete checkpoint; no RPC refetch."""
    app, point, now = row['app'], row['checkpoint'], int(row['clock']); d = operation['deployment']
    need(app['build_id'] == operation['buildId'] == '8e88ea2e00' and str(app['version']) == '6' and
         str(app['is_dev']) == '0' and str(app['is_locked']) == str(app['is_ready']) == '1' and
         0 <= now - int(app['heartbeat_at']) <= 180000, 'accepted_fresh_native_runtime_required')
    need(isinstance(point, str) and re.fullmatch('[0-9]{75}', point) and int(point[10:26]) == 8453 and
         point[42:] == '9' * 33 and int(point[26:42]) >= int(d['sourceStartBlock']) and
         0 <= now - int(point[:10]) * 1000 <= 180000, 'accepted_fresh_complete_checkpoint_required')
    expected = {'id': '8453:' + d['registry'].lower() + ':1', 'registry': d['registry'].lower(),
                'engine': d['engine'].lower(), 'payment_token': d['ypal'].lower(), 'pack_type_id': '1',
                'price': '1000000000000000000', 'interval_seconds': 86400, 'mints_per_interval': 1,
                'total_variants': 264, 'max_batch': 7, 'catalog_hash': d['catalogHash'],
                'rule_hash': operation['expectedRuleHash'], 'sales_paused': False,
                'manifest_uri': 'https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/manifest.json',
                'metadata_base_uri': 'https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/'}
    rows = row['types'] or []
    need(len(rows) == 1 and all(str(rows[0].get(k)) == str(v) for k, v in expected.items()), 'accepted_ypal_type_one_rules_required')
    return expected


def profile_inputs(m):
    for path, pin in [(PROFILE, PROFILE_SHA), (APPROVAL, APPROVAL_SHA), (RUNNER, RUNNER_SHA)]: m.pinned(path, pin)
    p = json.loads(m.pinned(PROFILE, PROFILE_SHA))
    need(json.loads(m.pinned(APPROVAL, APPROVAL_SHA)) == {'profile': p, 'expiresAt': EXPIRY, 'permits': []}, 'exact_empty_permit_approval_required')
    for path, pin in m.DEPENDENCIES.items(): need(sha((m.RELEASE / path).read_bytes()) == pin, 'exact_official_dependency_required')
    return {'profileSha256': PROFILE_SHA, 'approvalSha256': APPROVAL_SHA, 'runnerSha256': RUNNER_SHA,
            'retainedOwnerSha256': OLD_OWNER_SHA, 'dependencies': m.DEPENDENCIES}


def catalog(m):
    return m.query("SELECT jsonb_build_object('budget',(SELECT jsonb_build_object('coordinator',c.coordinator_id,'enabled',b.enabled,'dailyCu',b.daily_cu::text,'reserveCu',b.foreground_reserve_cu::text,'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation a WHERE a.scope=c.scope)) FROM yunipals_market.opensea_request_budget c JOIN yunipals_market.rpc_compute_budget b USING(scope) WHERE c.scope='yunipals-opensea' AND c.enabled),'profile',(SELECT to_jsonb(p) FROM yunipals_market.unified_rpc_profile p WHERE profile_id='" + PROFILE_ID + "'),'retainedProfiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY profile_id) FROM yunipals_market.unified_rpc_profile p WHERE profile_id IN ('" + OLD_PROFILE_ID + "','" + YPAL_PROFILE_ID + "')),'newPermits',(SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id='" + PROFILE_ID + "'),'activePermits',(SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit WHERE enabled AND expires_at>clock_timestamp()))")


def exact_catalog(m, value, before, admitted):
    need(value['budget'] == before['budget'] and value['retainedProfiles'] == before['retainedProfiles'] and
         value['newPermits'] == 0 and value['activePermits'] == before['activePermits'] == 0, 'retained_policy_and_empty_permits_required')
    need(value['budget'] and value['budget']['enabled'] is True and len(value['retainedProfiles'] or []) == 2, 'live_retained_policy_required')
    p = value['profile']
    if not admitted: need(p is None, 'new_profile_must_be_absent'); return
    expected = json.loads(m.pinned(PROFILE, PROFILE_SHA))
    need(p and p['profile_id'] == PROFILE_ID and p['scope'] == expected['scope'] and p['manifest_hash'] == MANIFEST_HASH and
         p['policy'] == expected and p['enabled'] is True and p['expires_at'].replace('+00:00', 'Z') in [EXPIRY, EXPIRY.replace('.000Z', 'Z')], 'exact_insert_only_profile_required')


def official(m, phase, pin=None):
    profile_inputs(m)
    env = {**m.ENV, 'NODE_NO_WARNINGS': '1', 'TSX_DISABLE_CACHE': '1',
           'UNIFIED_RPC_REVIEW_DATABASE_URL': 'postgresql://postgres@localhost:15438/yunipals_market_production?host=/var/run/postgresql'}
    if phase == 'review': env['PGOPTIONS'] = '-c default_transaction_read_only=on'
    args = [*m.peer(), NODE, '--import', str(m.RELEASE / 'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'), str(RUNNER), phase, *([pin] if pin else [])]
    rows = [json.loads(x) for x in m.run(args, timeout=40, env=env).splitlines()]
    need(len(rows) == (1 if phase == 'review' else 2) and rows[0]['event'] == 'unified_rpc_policy_review' and
         rows[0]['profileId'] == PROFILE_ID and rows[0]['manifestHash'] == MANIFEST_HASH and rows[0]['permits'] == [] and rows[0]['applied'] is False, 'official_review_ack_required')
    if phase != 'review':
        need(rows[0]['reviewHash'] == pin and rows[1] == {'event': 'unified_rpc_policy_' + ('rehearsed' if phase == 'rehearse' else 'approved'), 'reviewHash': pin, 'profileId': PROFILE_ID}, 'official_terminal_ack_required')
    return rows


def env_bytes(chain):
    chain_id, port = CHAINS[chain]
    values = {'MARKET_RPC_PROXY_HOST': '127.0.0.1', 'MARKET_RPC_PROXY_PORT': str(port), 'MARKET_RPC_PROXY_CHAIN_ID': str(chain_id),
              'MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE': str(PROFILE), 'MARKET_RPC_PROXY_UNIFIED_PROFILE_ID': PROFILE_ID,
              'MARKET_RPC_PROXY_MAX_IN_FLIGHT': '2'}
    values.update({'MARKET_RPC_PROXY_' + key: 'false' for key in PAID_FLAGS})
    return ''.join(k + '=' + v + '\n' for k, v in values.items()).encode()


def plan(m, chain):
    s = state(m, old_unit(chain)); files, text = definition(m, s, chain)
    need(s['User'] == s['Group'] == 'yunipals-market-prod-rpc' and s['NoNewPrivileges'] == 'yes' and
         s['ProtectSystem'] == 'strict' and s['ProtectHome'] == 'yes' and s['CapabilityBoundingSet'] == s['AmbientCapabilities'] == '', 'retained_hardened_actor_required')
    commands = re.findall(r'argv\[\]=(.*?)\s+;', s['ExecStart'])
    need(len(commands) == 1, 'single_retained_proxy_command_required')
    args = shlex.split(commands[0]); need(len(args) == 2 and args[0] == NODE and args[1].startswith(str(OPS) + '/') and args[1].endswith('/rpc-budget-proxy.mjs'), 'exact_retained_proxy_entry_required')
    entry_sha = sha(m.protected(args[1], 12000000))
    body = (text + '\n[Unit]\nDescription=Yunipals combined ' + chain + ' free RPC\n[Service]\nEnvironmentFile=' +
            str(paths(chain)['env']) + '\nExecStart=\nExecStart=' + commands[0] + '\nRestart=on-failure\nRestartSec=5\nRuntimeMaxSec=infinity\n').encode()
    return {'unit': unit(chain), 'port': CHAINS[chain][1], 'chainId': CHAINS[chain][0], 'unitSha256': sha(body),
            'environmentSha256': sha(env_bytes(chain)), 'entry': args[1], 'entrySha256': entry_sha,
            'security': {k: s[k] for k in m.SECURITY}, 'inherited': files}, body


def new_absent(m):
    for chain in CHAINS:
        s = state(m, unit(chain))
        need(s['LoadState'] == 'not-found' and s['MainPID'] == '0' and s['ActiveState'] == 'inactive' and s['Job'] in {'', '0'}, 'four_fresh_absent_units_required')
        need(all(not os.path.lexists(p) for p in paths(chain).values()), 'fresh_owned_paths_required')
        with socket.socket() as sock: need(sock.connect_ex(('127.0.0.1', CHAINS[chain][1])) != 0, 'four_unused_loopback_ports_required')


def review(m, owner):
    need(not BASE.exists(), 'existing_operation_requires_explicit_phase')
    new_absent(m); inputs = profile_inputs(m)
    ancestry = m.source_guard()  # One full old008 qualification, before its later owned drain.
    need(ancestry['runtime']['pid'] == 716994 and ancestry['runtime']['invocation'] == 'c3463c9a2e1240e8890e318ba1360cf4', 'actual_old_ancestry_required')
    direct = retained(m); plans = {c: plan(m, c)[0] for c in CHAINS}; before = catalog(m); exact_catalog(m, before, before, False)
    rows = official(m, 'review'); need(retained(m) == direct, 'retained_actors_changed_during_review')
    binding = {'format': FORMAT, 'operatorSha256': sha(m.protected(Path(__file__).absolute())), 'bootId': m.boot(), 'inputs': inputs,
               'retained': direct, 'plans': plans,
               'originalAncestryReceiptSha256': 'add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d',
               'retainedYpalRpcReceiptSha256': YPAL_ACK,
               'originalAncestry': ancestry, 'profileId': PROFILE_ID, 'manifestHash': MANIFEST_HASH, 'expiresAt': EXPIRY}
    return {'format': FORMAT, 'binding': binding, 'catalog': before, 'official': rows[0],
            'reviewHash': sha(encoded({'binding': binding, 'catalog': before, 'official': rows[0]})),
            'databaseWrites': 0, 'serviceChanges': 0, 'providerRpcRequests': 0}


def baseline(m):
    before = m.load('before.json'); b = before['binding']
    need(b['operatorSha256'] == sha(m.protected(Path(__file__).absolute())) and b['bootId'] == m.boot() and
         b['inputs'] == profile_inputs(m) and b['retained'] == retained(m), 'exact_retained_direct_binding_required')
    need({c: plan(m, c)[0] for c in CHAINS} == b['plans'], 'retained_proxy_inputs_changed')
    need(before['reviewHash'] == sha(encoded({'binding': b, 'catalog': before['catalog'], 'official': before['official']})), 'authenticated_saved_review_required')
    return before


def rehearse(m, owner, pin):
    before = review(m, owner); need(pin == before['reviewHash'], 'fresh_owner_review_required')
    BASE.mkdir(mode=0o700); m.sync(BASE.parent); m.save('before.json', before); m.save('rehearse-intent.json', {'reviewHash': pin, 'bootId': m.boot()})
    rows = official(m, 'rehearse', before['official']['reviewHash']); after = catalog(m); exact_catalog(m, after, before['catalog'], False)
    need(after == before['catalog'], 'rollback_catalog_must_be_unchanged'); baseline(m)
    value = {'format': FORMAT, 'rehearsed': True, 'reviewHash': pin, 'official': rows, 'databaseCommitted': False, 'catalogUnchanged': True}; m.save('rehearsed.json', value); return value


def admission_result(m, before, ack):
    after = catalog(m); exact_catalog(m, after, before['catalog'], True); baseline(m)
    value = {'format': FORMAT, 'admitted': True, 'reviewHash': before['reviewHash'], 'officialAcknowledgement': ack,
             'catalog': after, 'newPermits': 0, 'paidAuthority': False, 'budgetUnchanged': True}; m.save('admitted.json', value); return value


def commit(m, pin):
    before = baseline(m); need(m.load('rehearsed.json')['reviewHash'] == pin == before['reviewHash'], 'actual_rollback_rehearsal_required')
    need(not (BASE / 'commit-intent.json').exists(), 'commit_attempt_requires_reconcile_not_retry'); exact_catalog(m, catalog(m), before['catalog'], False)
    m.save('commit-intent.json', {'reviewHash': pin, 'officialReviewHash': before['official']['reviewHash'], 'bootId': m.boot()})
    return admission_result(m, before, official(m, 'commit', before['official']['reviewHash']))


def reconcile(m, pin):
    need(sha(m.protected(BASE / 'commit-intent.json')) == pin and not (BASE / 'admitted.json').exists(), 'exact_unacknowledged_commit_intent_required')
    before = baseline(m); intent = m.load('commit-intent.json')
    need(intent['bootId'] == m.boot() and intent['reviewHash'] == before['reviewHash'], 'same_owned_commit_required')
    return admission_result(m, before, {'commitAckLost': True, 'commitRetried': False, 'exactPresentProfileObserved': True})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_): return None


def get(port, path, headers=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request('http://127.0.0.1:' + str(port) + path, headers=headers or {})
    with opener.open(request, timeout=5) as response:
        raw = response.read(300001); need(response.status == 200 and len(raw) <= 300000, 'bounded_local_gate_required')
    return json.loads(raw)


def gate(chain):
    chain_id, port = CHAINS[chain]; gates = {}
    for workload in ['unified_source', 'unified_evidence']:
        v = get(port, '/unified/preflight', {'x-yunipals-unified-rpc-profile': PROFILE_ID, 'x-yunipals-rpc-workload': workload})
        need(v.get('profileId') == PROFILE_ID and v.get('manifestHash') == MANIFEST_HASH and v.get('chainId') == chain_id and
             v.get('replay') == {'mode': 'free_only'} and v.get('workload') == workload and
             v.get('coordinatorId') == 'faf1bb8c-4306-4c43-b55e-6ac5fa038567' and v.get('scope') == 'yunipals-opensea' and
             v.get('limits') == {'batchCalls': 10, 'logRange': 10000, 'addresses': 50, 'topicValues': 128}, 'exact_new_chain_gate_required')
        gates[workload] = {k: v[k] for k in ['profileId', 'manifestHash', 'chainId', 'workload', 'replay', 'limits']}
    metrics = get(port, '/metrics'); u = metrics.get('unified', {})
    need(metrics.get('freeRouting') is True and all(metrics.get(key) is False for key in ['paidFallbackOnFreeFailure', 'sourcePaidFallbackOnFreeFailure']) and
         u.get('profileId') == PROFILE_ID and u.get('chainId') == chain_id and u.get('sourceRouting') == 'free_first' and
         all(u.get('traffic', {}).get(w, {}).get('paidCalls') == 0 for w in gates), 'free_only_new_route_metrics_required')
    return gates


def manager(m, verb, chain=None):
    need(verb in {'start', 'stop', 'daemon-reload'} and (chain in CHAINS if verb != 'daemon-reload' else chain is None), 'new_routes_only_manager_actions')
    return m.run(['/usr/bin/systemctl', verb, *([] if chain is None else [unit(chain)])], timeout=130)


def owned(m, chain, before, allow_restart=False):
    for tag in ['unit', 'env']: m.check_published(chain + '-' + tag)
    p = before['binding']['plans'][chain]; s = state(m, unit(chain))
    need(s['FragmentPath'] == str(paths(chain)['unit']) and not s['DropInPaths'] and
         {k: s[k] for k in m.SECURITY} == p['security'], 'exact_owned_definition_and_hardening_required')
    intent = m.load(chain + '-start-intent.json')
    need(intent['bootId'] == m.boot() and intent['unitSha256'] == p['unitSha256'], 'same_boot_owned_start_required')
    actor = live_actor(m, s, dict(line.split('=', 1) for line in env_bytes(chain).decode().splitlines())); account = pwd.getpwnam('yunipals-market-prod-rpc')
    need(len(actor['processes']) == 1 and (allow_restart or s['NRestarts'] == '0'), 'single_owned_proxy_process_required')
    process = actor['processes'][0]; priv = process['privileges']
    need(set(priv['Uid'].split()) == {str(account.pw_uid)} and set(priv['Gid'].split()) == {str(account.pw_gid)} and
         set(priv['Groups'].split()) <= {str(account.pw_gid)} and priv['NoNewPrivs'] == '1' and
         all(int(priv[k], 16) == 0 for k in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']), 'unprivileged_owned_proxy_required')
    need(process['commandSha256'] == sha((NODE + '\0' + p['entry'] + '\0').encode()) and sha(m.protected(p['entry'])) == p['entrySha256'], 'exact_owned_proxy_entry_required')
    need(intent['earliestMonotonicUs'] <= actor['startMonotonicMicroseconds'] <= time.monotonic_ns() // 1000 and
         (int(s['NRestarts']) > 0 or actor['startMonotonicMicroseconds'] <= intent['earliestMonotonicUs'] + 130000000), 'owned_start_window_required')
    return {'unit': unit(chain), 'actor': actor, 'definitionSha256': p['unitSha256'], 'environmentSha256': p['environmentSha256'], 'gate': gate(chain)}


def result(m, before, admission_pin, reconciled=False):
    baseline(m); exact_catalog(m, catalog(m), before['catalog'], True)
    values = {c: owned(m, c, before) for c in CHAINS}
    for c in CHAINS: m.check_published(c + '-boot')
    need(retained(m) == before['binding']['retained'], 'retained_actors_changed_before_ack')
    value = {'format': FORMAT, 'completed': True, 'operatorSha256': sha(m.protected(Path(__file__).absolute())), 'bootId': m.boot(),
             'profileId': PROFILE_ID, 'manifestHash': MANIFEST_HASH, 'profileFile': str(PROFILE), 'profileFileSha256': PROFILE_SHA,
             'sourceManifest': json.loads(m.pinned(PROFILE, PROFILE_SHA))['manifest'], 'expiresAt': EXPIRY,
             'admissionReceiptSha256': admission_pin, 'routes': values, 'endpoints': {str(CHAINS[c][0]): 'http://127.0.0.1:' + str(CHAINS[c][1]) + '/unified' for c in CHAINS},
             'freeOnly': True, 'paidAuthority': False, 'emptyPermits': True, 'budgetUnchanged': True,
             'oldRoutesAndYpalUnchanged': True, 'oldCombinedSourceLivenessRequired': False,
             'providerRpcRequests': 0, 'startAcknowledgementReconciled': reconciled, 'automaticRetryAllowed': False}
    m.save('result.json', value); return value


def start(m, pin):
    need(isinstance(SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA, str) and re.fullmatch('[0-9a-f]{64}', SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA), 'qualified_single_connection_proxy_artifact_required')
    need(sha(m.protected(BASE / 'admitted.json')) == pin and m.load('admitted.json')['admitted'] is True, 'actual_profile_admission_required')
    before = baseline(m); exact_catalog(m, catalog(m), before['catalog'], True); new_absent(m)
    need(not (BASE / 'install-intent.json').exists(), 'existing_install_requires_reconcile_or_inverse')
    m.save('install-intent.json', {'bootId': m.boot(), 'admissionReceiptSha256': pin, 'reviewHash': before['reviewHash']})
    for chain in CHAINS:
        p, body = plan(m, chain); need(p == before['binding']['plans'][chain], 'exact_reviewed_unit_plan_required')
        m.publish(paths(chain)['env'], env_bytes(chain), chain + '-env')
        m.publish(paths(chain)['unit'], body, chain + '-unit')
    manager(m, 'daemon-reload')
    for chain in CHAINS:
        s = state(m, unit(chain)); p = before['binding']['plans'][chain]
        need(s['LoadState'] == 'loaded' and s['MainPID'] == '0' and s['Job'] in {'', '0'} and not s['DropInPaths'] and
             {k: s[k] for k in m.SECURITY} == p['security'], 'loaded_hardening_before_start_required')
        baseline(m); m.save(chain + '-start-intent.json', {'bootId': m.boot(), 'unitSha256': p['unitSha256'], 'earliestMonotonicUs': time.monotonic_ns() // 1000})
        manager(m, 'start', chain)
        deadline = time.monotonic() + 20
        while True:
            try: actor = owned(m, chain, before); break
            except Exception:
                need(time.monotonic() < deadline, 'new_proxy_not_yet_accepted'); time.sleep(1)
        m.save(chain + '-started.json', actor)
        m.publish(paths(chain)['boot'], str(paths(chain)['unit']), chain + '-boot', True)
    return result(m, before, pin)


def reconcile_start(m, pin):
    need(sha(m.protected(BASE / 'install-intent.json')) == pin and not (BASE / 'result.json').exists(), 'exact_unacknowledged_install_required')
    intent = m.load('install-intent.json'); before = baseline(m)
    need(intent['bootId'] == m.boot() and intent['reviewHash'] == before['reviewHash'], 'same_owned_install_required')
    # Observe only. No missing unit/start/link is retried or invented.
    return result(m, before, intent['admissionReceiptSha256'], True)


def validate_current(pin):
    m, _ = core(); saved = json.loads(m.pinned(BASE / 'result.json', pin)); before = baseline(m)
    need(saved['completed'] is True and saved['format'] == FORMAT and saved['operatorSha256'] == sha(m.protected(Path(__file__).absolute())) and
         saved['bootId'] == m.boot() and not (BASE / 'restore-intent.json').exists(), 'acknowledged_unrestored_routes_required')
    exact_catalog(m, catalog(m), before['catalog'], True)
    need({c: owned(m, c, before) for c in CHAINS} == saved['routes'], 'same_acknowledged_proxy_actors_required')
    for c in CHAINS: m.check_published(c + '-boot')
    return {**saved, 'validated': True, 'receiptSha256': pin}


def combined_stopped(m):
    s = state(m, SOURCE)
    need(s['MainPID'] == '0' and s['Job'] in {'', '0'} and s['ActiveState'] in {'inactive', 'failed'}, 'combined_source_must_be_stopped_before_inverse')
    if s['ControlGroup']:
        p = Path('/sys/fs/cgroup' + s['ControlGroup']) / 'cgroup.procs'
        need(not p.exists() or not p.read_text().split(), 'combined_source_cgroup_must_be_empty')


def restore(m, pin):
    need(sha(m.protected(BASE / 'install-intent.json')) == pin, 'exact_owned_install_intent_required')
    before = baseline(m); intent = m.load('install-intent.json')
    need(intent['bootId'] == m.boot() and intent['reviewHash'] == before['reviewHash'], 'same_boot_owned_inverse_required')
    combined_stopped(m); need(not (BASE / 'restore-intent.json').exists(), 'existing_inverse_requires_manual_reconciliation')
    m.save('restore-intent.json', {'installIntentSha256': pin, 'bootId': m.boot()})
    for chain in reversed(list(CHAINS)):
        combined_stopped(m); s = state(m, unit(chain))
        if s['MainPID'] != '0':
            checked = owned(m, chain, before, True)
            s = state(m, unit(chain)); actor = live_actor(m, s)
            need(actor == checked['actor'], 'same_owned_actor_immediately_before_stop')
            m.save(chain + '-stop-intent.json', {'bootId': m.boot(), 'actor': actor})
            need(live_actor(m, state(m, unit(chain))) == actor, 'owned_stop_intent_actor_changed')
            manager(m, 'stop', chain)
        s = state(m, unit(chain))
        need(s['MainPID'] == '0' and s['ActiveState'] in {'inactive', 'failed'} and s['Job'] in {'', '0'}, 'owned_proxy_must_be_terminal')
        if s['ControlGroup']:
            p = Path('/sys/fs/cgroup' + s['ControlGroup']) / 'cgroup.procs'; need(not p.exists() or not p.read_text().split(), 'owned_proxy_cgroup_must_be_empty')
        for tag in ['boot', 'unit', 'env']:
            if (BASE / (chain + '-' + tag + '-prepared.json')).exists(): m.remove_published(chain + '-' + tag)
    manager(m, 'daemon-reload'); baseline(m); exact_catalog(m, catalog(m), before['catalog'], True); combined_stopped(m)
    value = {'format': FORMAT, 'restored': True, 'newRoutesStoppedAndBootDisabled': True, 'profileAdmissionRetained': True,
             'countersReset': False, 'oldRoutesAndYpalUnchanged': True, 'sourceRestarted': False, 'paidAuthority': False}; m.save('restored.json', value); return value


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    for name in ['rehearse', 'commit', 'reconcile', 'start', 'reconcile-start', 'validate', 'restore']: group.add_argument('--' + name)
    args = parser.parse_args(); need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_operation_expired')); signal.alarm(900)
    m, owner = core(); lock = os.open('/run/lock/yunipals-ypal-combined-rpc-v1.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.validate: value = validate_current(args.validate)
        elif args.rehearse: value = rehearse(m, owner, args.rehearse)
        else:
            selected = next(((k, f) for k, f in [('commit', commit), ('reconcile', reconcile), ('start', start), ('reconcile_start', reconcile_start), ('restore', restore)] if getattr(args, k)), None)
            value = selected[1](m, getattr(args, selected[0])) if selected else review(m, owner)
        print(json.dumps(value, sort_keys=True))
    finally: os.close(lock)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld',
                          'automaticRetryAllowed': False})); raise SystemExit(1)
