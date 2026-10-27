#!/usr/bin/env python3
"""Acknowledge exactly five retained RPC invocations; never mutate runtime truth.

Default review performs bounded reads only. RPC-only validation deliberately has
no dependency on the temporary YPAL source/API actors. Strict source preservation
is a separate component; neither claims the historical whole guard passed.
"""
import argparse
import base64
import copy
from datetime import datetime, timezone
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
import types

FORMAT = 'yunipals-ypal-retained-proxy-current-v2'
BASE = Path('/var/backups/yunipals-ypal-retained-proxy-current-v2-20261024')
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
REGISTER = OPS / 'ypal-combined-release-register-v1.py'
REGISTER_SHA = 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d'
PARSER = OPS / 'retained-workers-stage-v1.py'
PARSER_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
SOURCE_ACK = 'c96d558ec3923984b3323064de9bc57a8d0223b094a38cee3bf99daed61d6909'
SOURCE_OP = 'a80ce9cca2da0dd5e40958db16e65f46e82ea859e861cfb110407e4bf93b9336'
SOURCE_SHA = '3a70a1167f7e8ffcc73689bc8f0b668319ad1801801c4b403fc791998a7686f6'
ROUTES_SHA = '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff'
UNIT = 'yunipals-ypal-base-rpc.service'
PROXY_UNITS = ('yunipals-market-production-rpc@ethereum.service', 'yunipals-market-production-rpc@base.service',
    'yunipals-market-production-rpc@polygon.service', 'yunipals-market-production-rpc@bnb.service', UNIT)
RUNTIME_KEYS = {'HOME', 'INVOCATION_ID', 'JOURNAL_STREAM', 'LANG', 'LOGNAME', 'MEMORY_PRESSURE_WATCH',
    'MEMORY_PRESSURE_WRITE', 'PATH', 'SYSTEMD_EXEC_PID', 'USER'}
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value: raise RuntimeError(code)
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value)
def protected(path):
    path = Path(path)
    for item in [*path.parents, path]:
        st = item.lstat(); need(st.st_uid == st.st_gid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022, 'protected_current_proxy_input_required')
    before = path.lstat(); need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 2000000, 'bounded_single_link_current_proxy_input_required')
    raw = path.read_bytes(); after = path.lstat()
    need(all(getattr(before, k) == getattr(after, k) for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'current_proxy_input_changed_during_read')
    return raw
def document(path, digest=None):
    raw = protected(path); need(digest is None or pin(digest) and sha(raw) == digest, 'exact_current_proxy_input_pin_required'); return json.loads(raw)
def module(path, digest):
    raw = protected(path); need(sha(raw) == digest, 'exact_current_proxy_dependency_required')
    result = types.ModuleType(Path(path).stem); result.__file__ = str(path); exec(compile(raw, str(path), 'exec'), result.__dict__); return result
def producer(): return sha(protected(Path(__file__).absolute()))


def semantic_proxy(prior, current):
    """Only the explicitly captured runtime tuple may differ from original."""
    need(len(prior['actor']['processes']) == len(current['actor']['processes']) == 1, 'one_retained_proxy_process_required')
    need(current['settings']['NRestarts'] == '0' and current['settings']['ActiveState'] == 'active' and current['settings']['SubState'] == 'running', 'current_pristine_semantic_proxy_required')
    a, b = copy.deepcopy(prior), copy.deepcopy(current)
    for value in (a, b):
        for key in ('MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic'): value['settings'].pop(key)
        for key in ('pid', 'invocation', 'startMonotonicMicroseconds'): value['actor'].pop(key)
        for key in ('pid', 'startTicks', 'environmentSha256'): value['actor']['processes'][0].pop(key)
    need(a == b, 'all_proxy_static_private_program_privilege_and_fixed_process_facts_must_match_original')
    return sha(encoded(a))


# Expected private values travel over stdin only. The peer prints hashes/booleans.
ENV_PEER = r'''import base64,hashlib,json,os,pathlib,pwd,re,sys
r=json.load(sys.stdin);pid=r['pid'];uid=r['uid'];gid=r['gid'];unit=r['unit'];group=r['cgroup']
assert unit in {'yunipals-market-production-rpc@ethereum.service','yunipals-market-production-rpc@base.service','yunipals-market-production-rpc@polygon.service','yunipals-market-production-rpc@bnb.service','yunipals-ypal-base-rpc.service'}and group.startswith('/system.slice/')and group.endswith('/'+unit)and '..'not in group and len(group)<300
assert type(pid)is int and pid>1 and os.getuid()==os.geteuid()==uid and os.getgid()==os.getegid()==gid and os.getgroups()==[]
me=dict(x.split(':',1)for x in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in x)
assert me['NoNewPrivs'].strip()=='1'and all(int(me[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])
p=pathlib.Path('/proc')/str(pid)
def ticks():
 s=(p/'stat').read_text();return int(s[s.rfind(')')+2:].split()[19])
before=ticks();assert before==r['startTicks']and(p/'cgroup').read_text().splitlines()==['0::'+group]
raw=(p/'environ').read_bytes();assert len(raw)<=1000000
pairs=[x.split(b'=',1)for x in raw.split(b'\0')if x];assert all(len(v)==2 for v in pairs)
e={k.decode():v.decode()for k,v in pairs};assert len(e)==len(pairs)
expected=r['expected'];assert all(e.get(k)==v for k,v in expected.items())
extras={'HOME','INVOCATION_ID','JOURNAL_STREAM','LANG','LOGNAME','MEMORY_PRESSURE_WATCH','MEMORY_PRESSURE_WRITE','PATH','SYSTEMD_EXEC_PID','USER'}
assert set(e)==set(expected)|extras
u=pwd.getpwuid(uid);known={'HOME':u.pw_dir,'USER':u.pw_name,'LOGNAME':u.pw_name,'INVOCATION_ID':r['invocation'],'SYSTEMD_EXEC_PID':str(pid),'PATH':r['managerPath'],'LANG':r['managerLang'],'MEMORY_PRESSURE_WATCH':'/sys/fs/cgroup'+group+'/memory.pressure'}
assert all(e[k]==v for k,v in known.items())
assert e['JOURNAL_STREAM']in{str(os.stat(p/'fd'/str(fd)).st_dev)+':'+str(os.stat(p/'fd'/str(fd)).st_ino)for fd in [1,2]}
assert base64.b64decode(e['MEMORY_PRESSURE_WRITE'],validate=True)==('some '+str(r['memoryPressureThresholdUs'])+' 2000000\0').encode()
assert not any(x.startswith(b'--env-file=')for x in(p/'cmdline').read_bytes().split(b'\0'))and ticks()==before
print(json.dumps({'pid':pid,'startTicks':before,'fullEnvironmentSha256':hashlib.sha256(raw).hexdigest(),'declaredEnvironmentSha256':hashlib.sha256((json.dumps(expected,sort_keys=True,separators=(',',':'))+'\n').encode()).hexdigest(),'allDeclaredValuesMatch':True,'onlyVerifiedSystemdRuntimeExtras':True,'valueBytesExported':0},sort_keys=True))
'''


def typed_environment_files(m, unit, packet):
    """Read the complete typed array, not a dict of repeated show properties."""
    need(unit in PROXY_UNITS, 'only_five_fixed_retained_proxy_units_are_eligible')
    obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in unit)
    value = json.loads(m.run(['/usr/bin/busctl', '--system', '--json=short', 'get-property', 'org.freedesktop.systemd1', obj,
        'org.freedesktop.systemd1.Service', 'EnvironmentFiles'], timeout=8))
    need(value.get('type') == 'a(sb)' and isinstance(value.get('data'), list) and 1 <= len(value['data']) <= 32,
         'complete_bounded_typed_environment_files_required')
    names = []
    for row in value['data']:
        need(isinstance(row, list) and len(row) == 2 and isinstance(row[0], str) and type(row[1]) is bool and
             re.fullmatch('/[A-Za-z0-9_./@+\\-]+', row[0]) and '..' not in Path(row[0]).parts and not row[1],
             'literal_required_typed_environment_file_required')
        names.append((row[0], row[1]))
    # Definition bytes were already bound by the original semantic packet.
    # Reconstruct list semantics to authenticate order, resets and duplicates.
    declared = []
    for path, digest in packet['definitionHashes'].items():
        raw = m.protected(path); need(sha(raw) == digest, 'same_definition_bytes_for_typed_environment_order_required')
        text = raw.decode().replace('\\\n', ''); section = None
        if '@' in unit: text = text.replace('%i', unit.split('@', 1)[1].removesuffix('.service'))
        for line in text.splitlines():
            line = line.strip()
            if line.startswith('[') and line.endswith(']'): section = line[1:-1]; continue
            if section != 'Service' or not line.startswith('EnvironmentFile='): continue
            path = line.partition('=')[2].strip()
            if not path: declared = []; continue
            need(re.fullmatch('/[A-Za-z0-9_./@+\\-]+', path) and '..' not in Path(path).parts,
                 'literal_required_original_environment_file_declaration_required')
            declared.append((path, False))
    need(names == declared and all(path in packet['environmentFileHashes'] for path, _ in names),
         'typed_environment_files_must_match_full_original_definition_order')
    return names


def proxy_environment(m, a, packet, parser):
    unit = packet['settings']['Id']; need(unit in PROXY_UNITS, 'only_five_fixed_retained_proxy_units_are_eligible')
    state = a.state(m, unit); need(state['MainPID'] == str(packet['actor']['pid']) and state['InvocationID'] == packet['actor']['invocation'], 'same_current_proxy_for_full_environment_proof_required')
    expected = {}
    for item in parser.service_property(unit, 'Environment'):
        key, sep, value = item.partition('='); need(sep and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key), 'literal_current_proxy_inline_environment_required'); expected[key] = value
    need(not parser.service_property(unit, 'PassEnvironment') and not parser.service_property(unit, 'UnsetEnvironment'), 'no_unrecorded_proxy_environment_pass_or_unset_required')
    names = typed_environment_files(m, unit, packet)
    for path, _ in names:
        raw = m.protected(path); need(packet['environmentFileHashes'].get(path) == sha(raw), 'current_proxy_declared_file_hash_must_match_capture'); expected.update(parser.parse_env(raw))
    manager = dict(item.split('=', 1) for item in m.run(['/usr/bin/systemctl', 'show-environment'], timeout=8).decode().splitlines() if '=' in item)
    path = manager.get('PATH') or m.run(['/usr/bin/systemd-path', 'search-binaries-default'], timeout=8).decode().strip()
    need(path and manager.get('LANG'), 'actual_systemd_manager_PATH_and_LANG_required')
    object_path = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in unit)
    typed = json.loads(m.run(['/usr/bin/busctl', '--system', '--json=short', 'get-property', 'org.freedesktop.systemd1', object_path,
        'org.freedesktop.systemd1.Service', 'MemoryPressureThresholdUSec'], timeout=8))
    need(typed.get('type') == 't' and type(typed.get('data')) is int and 0 < typed['data'] <= 2000000, 'actual_typed_proxy_memory_pressure_threshold_required')
    user = pwd.getpwnam('yunipals-market-prod-rpc'); main = packet['actor']['processes'][0]
    request = {'unit': unit, 'cgroup': packet['actor']['cgroup'], 'pid': packet['actor']['pid'], 'uid': user.pw_uid, 'gid': user.pw_gid, 'startTicks': main['startTicks'], 'invocation': packet['actor']['invocation'],
        'expected': expected, 'managerPath': path, 'managerLang': manager['LANG'], 'memoryPressureThresholdUs': typed['data']}
    args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups', '--inh-caps=-all',
        '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-B', '-c', ENV_PEER]
    result = json.loads(m.run(args, encoded(request), timeout=10))
    need(result == {'pid': request['pid'], 'startTicks': request['startTicks'], 'fullEnvironmentSha256': main['environmentSha256'],
        'declaredEnvironmentSha256': sha(encoded(expected)), 'allDeclaredValuesMatch': True, 'onlyVerifiedSystemdRuntimeExtras': True, 'valueBytesExported': 0}, 'actual_full_current_proxy_environment_must_match_all_declared_values')
    need(a.state(m, unit) == state and typed_environment_files(m, unit, packet) == names, 'proxy_changed_during_full_environment_proof')
    return {**result, 'typedOrderedEnvironmentFilesSha256': sha(encoded(names)), 'effectiveEnvironmentFileCount': len(names)}


def load():
    register = module(REGISTER, REGISTER_SHA); s, h, op, ack = register.load()
    need(register.SOURCE_SHA == SOURCE_SHA and register.SOURCE_ACK_SHA == SOURCE_ACK and register.SOURCE_OPERATION == SOURCE_OP and
         ack['rpcOwnerSha256'] == ROUTES_SHA and not (s.BASE / 'inverse-intent.json').exists(), 'fixed_unreversed_original_source_chain_required')
    return s, h, op, ack, module(PARSER, PARSER_SHA)


def packet(m, a, name, expected=None):
    state = a.state(m, name); chain = next((c for c in a.CHAINS if name == a.old_unit(c)), None)
    files, _ = a.definition(m, state, chain); actor = a.live_actor(m, state, expected)
    stable = [key for key in state if key not in {'ExecStart', 'Environment', 'EnvironmentFiles'}]
    need(a.state(m, name) == state, 'retained_actor_or_static_configuration_changed_during_snapshot')
    return {**files, 'actor': actor, 'settings': {key: state[key] for key in stable},
        'environmentPropertySha256': sha(state['Environment'].encode()), 'environmentFilesPropertySha256': sha(state['EnvironmentFiles'].encode())}


def semantic_epoch(original, current):
    need(set(original) == set(current) == set(PROXY_UNITS), 'exact_five_retained_proxy_set_required')
    need(len({value['actor']['pid'] for value in current.values()}) == 5, 'five_distinct_current_proxy_processes_required')
    semantic = {}
    for name in PROXY_UNITS:
        prior, now = original[name], current[name]; old_pid = prior['actor']['pid']
        semantic[name] = semantic_proxy(prior, now)
        need(not Path('/proc/' + str(old_pid)).exists() and now['actor']['pid'] != old_pid and
             now['actor']['invocation'] != prior['actor']['invocation'] and
             now['actor']['startMonotonicMicroseconds'] > prior['actor']['startMonotonicMicroseconds'] and
             now['actor']['processes'][0]['startTicks'] > prior['actor']['processes'][0]['startTicks'],
             'five_actual_new_semantic_invocations_and_original_PIDs_gone_required')
    return semantic


def proxy_boot(packet):
    name = packet['settings']['Id']; need(name in PROXY_UNITS and packet['settings']['UnitFileState'] == 'enabled', 'fixed_enabled_retained_proxy_boot_required')
    path = Path('/etc/systemd/system/multi-user.target.wants') / name
    for parent in path.parents:
        st = parent.lstat(); need(stat.S_ISDIR(st.st_mode) and st.st_uid == st.st_gid == 0 and not st.st_mode & 0o022, 'protected_fixed_proxy_boot_ancestry_required')
    st = path.lstat(); fragment = packet['settings']['FragmentPath']
    need(stat.S_ISLNK(st.st_mode) and st.st_uid == st.st_gid == 0 and
         os.readlink(path) in {fragment, '../' + Path(fragment).name}, 'same_configured_fragment_target_for_retained_proxy_boot_required')
    return {'path': str(path), 'target': os.readlink(path), 'dev': st.st_dev, 'ino': st.st_ino, 'mode': st.st_mode, 'nlink': st.st_nlink}


def rpc_snapshot(s, h, op, ack, parser):
    m, route, a = h.m, h.rpc, h.m.route_owner
    before = m.load('before.json'); b = before['binding']; saved = json.loads(m.pinned(a.BASE / 'result.json', ack['rpcResultSha256']))
    need(saved['completed'] is True and saved['format'] == route.FORMAT and saved['operatorSha256'] == ROUTES_SHA and saved['bootId'] == boot() and
         not (a.BASE / 'restore-intent.json').exists() and b['operatorSha256'] == ROUTES_SHA and b['bootId'] == boot() and
         b['retained'] == op['retained'] and b['inputs'] == route.inputs(m, a) and before['reviewHash'] == sha(encoded({'binding': b, 'catalog': before['catalog']})), 'exact_original_route_and_source_retained_chain_required')
    current_catalog = a.catalog(m); a.exact_catalog(m, current_catalog, before['catalog'], True)
    capacity = route.capacity_snapshot(m)
    need({key: capacity[key] for key in b['budgetCapacityIdentity']} == b['budgetCapacityIdentity'], 'original_budget_role_and_global_connection_limits_required')
    for row in [current_catalog['profile'], *current_catalog['retainedProfiles']]:
        need(row['enabled'] is True and datetime.fromisoformat(row['expires_at'].replace('Z', '+00:00')) > datetime.now(timezone.utc), 'all_exact_rpc_profiles_must_remain_unexpired')
    need({c: a.plan(m, c)[0] for c in a.CHAINS} == b['plans'], 'same_fixed_combined_route_plans_required')
    original = op['retained']; values = {}
    for chain in a.CHAINS:
        name = a.old_unit(chain); values[name] = packet(m, a, name)
    public = dict(line.split('=', 1) for line in m.env_bytes().decode().splitlines())
    values[UNIT] = packet(m, a, UNIT, public)
    semantic = semantic_epoch({name: original[name] for name in PROXY_UNITS}, values)
    # The original proxy's own result authenticates profile, private graph and
    # boot; do not invoke its obsolete old-source composite validator.
    old_ack = document(Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023/result.json'), a.YPAL_ACK)
    need(old_ack['runtime']['pid'] == original[UNIT]['actor']['pid'] and old_ack['bootId'] == boot() and old_ack['completed'] is True and
         old_ack['freeOnly'] is True and old_ack['paidAuthority'] is False and old_ack['emptyPermits'] is True,
         'original_retained_proxy_receipt_required')
    m.pinned(old_ack['profileFile'], old_ack['profileFileSha256']); need(m.protected(m.ENV_FILE) == m.env_bytes(), 'exact_retained_proxy_public_inputs_required')
    old_boot = document(Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023/boot-prepared.json'))
    a.check_link(m.BOOT_LINK, old_boot); need(not Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023/stop-intent.json').exists(), 'retained_proxy_inverse_must_not_have_started')
    environments = {name: proxy_environment(m, a, values[name], parser) for name in PROXY_UNITS}
    boots = {name: proxy_boot(values[name]) for name in PROXY_UNITS}
    routes = {chain: a.owned(m, chain, before) for chain in a.CHAINS}
    need(routes == saved['routes'], 'all_four_combined_proxy_actors_and_free_only_gates_must_stay_exact')
    for chain in a.CHAINS: m.check_published(chain + '-boot')
    m.gate()  # Local cached preflight only, never a provider JSON-RPC request.
    capacity_after = route.capacity_snapshot(m)
    need(packet(m, a, UNIT, public) == values[UNIT] and all(packet(m, a, name) == values[name] for name in values if name != UNIT) and
         a.catalog(m) == current_catalog and {name: proxy_boot(values[name]) for name in PROXY_UNITS} == boots and
         {key: capacity_after[key] for key in b['budgetCapacityIdentity']} == b['budgetCapacityIdentity'],
         'retained_proxy_or_policy_changed_after_local_gate_reads')
    return {'originalSourceOperationSha256': SOURCE_OP, 'originalSourceReceiptSha256': SOURCE_ACK, 'routeReceiptSha256': ack['rpcResultSha256'],
        'routeReviewSha256': sha(m.protected(a.BASE / 'before.json')), 'routeInputsSha256': sha(encoded(b['inputs'])),
        'rpcCatalogSha256': sha(encoded(current_catalog)), 'budgetCapacityIdentitySha256': sha(encoded(b['budgetCapacityIdentity'])),
        'retainedRPCPacketSha256': sha(encoded(values)), 'newRoutesSha256': sha(encoded(routes)),
        'oldProxyRuntimesSha256': sha(encoded({name: original[name]['actor'] for name in PROXY_UNITS})),
        'newProxyRuntimes': {name: values[name]['actor'] for name in PROXY_UNITS}, 'finiteSemanticProxyUnits': list(PROXY_UNITS),
        'semanticProxySha256': semantic, 'fullEnvironmentProofs': environments, 'bootSha256': sha(encoded(boots)), 'original19212BootSha256': sha(encoded(old_boot)),
        'oldWholeValidatorPassed': False}, {'retainedRPCPackets': values, 'routes': routes, 'catalog': current_catalog}


def source_snapshot(s, h, op, ack):
    a, m = h.m.route_owner, h.m; accepted, expected = a.accepted_ypal(m); current = {}
    for name in a.YPAL_UNITS[1:]:
        current[name] = packet(m, a, name, expected[name]); need(current[name] == op['retained'][name], 'same_accepted_temporary_YPAL_source_and_API_actors_required')
    need({k: v for k, v in accepted.items() if k not in {'source', 'api', 'rpc'}} == op['retained']['acceptedYpal'], 'exact_accepted_YPAL_native_catalog_rules_queue_and_receipts_required')
    s.static_inputs(h); s.old_private_inputs(op)
    need(s.base_code() == op['sourceCode'] and h.role() == op['sourceRole'], 'same_combined_source_code_role_private_inputs_required')
    h.old_terminal(op); h.preserved_old_native(op); s.exact_link(s.NEW_LINK, ack['newBoot'])
    actor = s.new_owned(h, op); native = h.native(); app = native['app']
    need(actor == ack['source'] and native['schemaOid'] == ack['native']['schemaOid'] and native['tables'] == ack['native']['tables'] and
         app['build_id'] == s.BUILD and str(app['is_dev']) == '0' and str(app['is_locked']) == '1' and
         0 <= native['clock'] - int(app['heartbeat_at']) <= 180000, 'same_live_acknowledged_combined_source_and_native_OIDs_required')
    need(s.new_owned(h, op) == actor and all(packet(m, a, name, expected[name]) == value for name, value in current.items()),
         'source_or_temporary_YPAL_actor_changed_after_native_SQL_observation')
    return {'combinedSourceActorSha256': sha(encoded(actor)), 'temporaryYpalActorsSha256': sha(encoded(current)), 'acceptedYpalSha256': sha(encoded(accepted)),
        'nativeSchemaOid': native['schemaOid'], 'nativeTableIdentitiesSha256': sha(encoded(native['tables'])), 'buildId': s.BUILD,
        'sourceCoverageQualified': False, 'frameworkReadinessQualified': False}, {'temporaryYpalPackets': current, 'combinedSourceActor': actor,
        'nativeIdentity': {'schemaOid': native['schemaOid'], 'tables': native['tables'], 'buildId': s.BUILD}}


def observe(include_source=True):
    s, h, op, ack, parser = load(); rpc, components = rpc_snapshot(s, h, op, ack, parser)
    value = {'rpc': rpc}
    if include_source: value['sourcePreservation'], components['sourcePreservation'] = source_snapshot(s, h, op, ack)
    return value, components


def review():
    first, _ = observe(); second, _ = observe()
    need(first == second, 'two_complete_stable_current_proxy_observations_required')
    binding = {'format': FORMAT, 'operatorSha256': producer(), 'bootId': boot(), 'components': second,
        'historicalWholeValidatorPassed': False, 'semanticCurrentQualificationPassed': True, 'sourceCoverageQualified': False,
        'providerCalls': 0, 'databaseWrites': 0, 'serviceActions': 0, 'secretValuesExported': False}
    return {'binding': binding, 'reviewHash': sha(encoded(binding)), 'acknowledgementCreated': False}


def capture(expected):
    need(not os.path.lexists(BASE), 'fresh_current_proxy_ack_directory_required')
    checked = review(); need(checked['reviewHash'] == expected, 'exact_fresh_current_proxy_review_required')
    parent = BASE.parent.lstat(); need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and not parent.st_mode & 0o022, 'protected_current_proxy_ack_parent_required')
    BASE.mkdir(mode=0o700); os.chmod(BASE, 0o700)
    s = module(REGISTER, REGISTER_SHA); source, *_ = s.load(); source.sync(BASE.parent)
    latest, _ = observe(); need(latest == checked['binding']['components'], 'current_proxy_changed_before_exclusive_ack_capture')
    result = {'format': FORMAT, 'captured': True, 'reviewHash': expected, 'binding': checked['binding'], 'observedAt': datetime.now(timezone.utc).isoformat(),
        'originalReceiptsRewritten': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    source.save(BASE / 'result.json', result, 0o600)
    return {'format': FORMAT, 'captured': True, 'receiptSha256': sha(protected(BASE / 'result.json')), 'reviewHash': expected,
        'historicalWholeValidatorPassed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def acknowledgement(receipt_sha):
    directory = BASE.lstat(); file = (BASE / 'result.json').lstat()
    need(stat.S_ISDIR(directory.st_mode) and stat.S_IMODE(directory.st_mode) == 0o700 and stat.S_IMODE(file.st_mode) == 0o600,
         'exact_private_current_proxy_ack_modes_required')
    value = document(BASE / 'result.json', receipt_sha); binding = value['binding']
    need(set(value) == {'format', 'captured', 'reviewHash', 'binding', 'observedAt', 'originalReceiptsRewritten', 'databaseWrites', 'serviceActions', 'providerCalls'} and
         set(binding['components']) == {'rpc', 'sourcePreservation'} and value['format'] == FORMAT and value['captured'] is True and binding['format'] == FORMAT and
         binding['operatorSha256'] == producer() and binding['bootId'] == boot() and value['reviewHash'] == sha(encoded(binding)) and
         binding['historicalWholeValidatorPassed'] is False and binding['semanticCurrentQualificationPassed'] is True and
         binding['sourceCoverageQualified'] is False and value['originalReceiptsRewritten'] is False and
         all(value[k] == 0 for k in ('databaseWrites', 'serviceActions', 'providerCalls')), 'exact_same_boot_current_proxy_acknowledgement_required')
    need(binding['components']['rpc']['originalSourceOperationSha256'] == SOURCE_OP and
         binding['components']['rpc']['originalSourceReceiptSha256'] == SOURCE_ACK and
         binding['components']['rpc']['finiteSemanticProxyUnits'] == list(PROXY_UNITS) and
         all(set(binding['components']['rpc'][key]) == set(PROXY_UNITS) for key in ('newProxyRuntimes', 'fullEnvironmentProofs', 'semanticProxySha256')),
         'same_original_source_ancestry_and_exact_five_proxy_scope_in_current_ACK_required')
    return value


def qualified_rpc_components(receipt_sha):
    saved = acknowledgement(receipt_sha); first, _ = observe(False); second, components = observe(False)
    need(first == second and second['rpc'] == saved['binding']['components']['rpc'], 'same_acknowledged_current_RPC_component_required')
    return qualification(receipt_sha, second['rpc']), components


def qualification(receipt_sha, rpc):
    return {'format': FORMAT, 'validated': True, 'receiptSha256': receipt_sha, 'operatorSha256': producer(), 'rpcScopeOnly': True,
        'currentRPCComponentSha256': sha(encoded(rpc)), 'historicalWholeValidatorPassed': False,
        'sourceActorQualified': False, 'temporaryYpalSourceAndApiQualified': False, 'sourceReadinessQualified': False,
        'readerRoleGraphQualified': False, 'financialWriteAuthorityQualified': False, 'freeOnly': True, 'paidAuthority': False,
        'providerCalls': 0, 'databaseWrites': 0, 'serviceActions': 0}


def validate_rpc_current(receipt_sha): return qualified_rpc_components(receipt_sha)[0]


def qualified_source_components(receipt_sha):
    saved = acknowledgement(receipt_sha); first, _ = observe(); second, components = observe()
    need(first == second == saved['binding']['components'], 'same_acknowledged_strict_source_preservation_component_required')
    return {**qualification(receipt_sha, second['rpc']), 'rpcScopeOnly': False, 'sourceActorQualified': True, 'temporaryYpalSourceAndApiQualified': True,
        'sourcePreservationSha256': sha(encoded(second['sourcePreservation'])), 'sourceReadinessQualified': False}, components


def validate_source_current(receipt_sha): return qualified_source_components(receipt_sha)[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    group.add_argument('--capture'); group.add_argument('--validate-rpc'); group.add_argument('--validate-source'); args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_current_proxy_host_required'); os.umask(0o077)
    if args.capture: value = capture(args.capture)
    elif args.validate_rpc: value = validate_rpc_current(args.validate_rpc)
    elif args.validate_source: value = validate_source_current(args.validate_source)
    else: value = review()
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_current_proxy_observation_expired')); signal.alarm(300)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'private_diagnostics_withheld', 'automaticRetryAllowed': False})); raise SystemExit(1)
    finally: signal.alarm(0)
