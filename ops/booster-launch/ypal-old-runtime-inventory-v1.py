#!/usr/bin/env python3
"""Fixed old booster/runtime observation; no service, SQL or filesystem writes."""
import hashlib
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SOURCE = 'yunipals-booster-launch.service'
COMBINED = 'yunipals-unified-source6-free-v2.service'
API = 'yunipals-booster-api.service'
QUEUE = 'yunipals-booster-artwork-queue.service'
TIMER = 'yunipals-booster-artwork-queue.timer'
ACK = 'add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d'
PINS = {'source6-normal-proxy-requalification-v1.py': '8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658',
        'booster-feature-handover-v7.py': '0f5024cdbb373ce8015f2abf59f459d16d143f3f909ac3382d5170a1d4967984'}
CLEAN = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def run(argv, timeout=8):
    value = subprocess.run(argv, capture_output=True, timeout=timeout, env=CLEAN)
    need(value.returncode == 0 and not value.stderr and len(value.stdout) <= 2_000_000,
         'bounded_readonly_inventory_command_required')
    return value.stdout


def file_pin(path, cap=2_000_000):
    path = Path(path); before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and not before.st_mode & 0o022
         and before.st_size <= cap, 'bounded_owned_regular_inventory_file_required')
    raw = path.read_bytes(); after = path.lstat()
    fields = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
    need(fields(before) == fields(after), 'inventory_file_changed_while_hashing')
    return {'sha256': sha(raw), 'bytes': len(raw), 'uid': before.st_uid, 'gid': before.st_gid,
            'mode': oct(stat.S_IMODE(before.st_mode)), 'device': before.st_dev, 'inode': before.st_ino}


def load(name):
    path = OPS / name; pin = file_pin(path)
    raw = path.read_bytes()
    need(pin['sha256'] == sha(raw) == PINS[name], 'exact_frozen_inventory_dependency_required')
    value = types.ModuleType(name.replace('-', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


PEER_FDS = r'''import json,os,pathlib,sys
pids=json.loads(sys.argv[1]);uid=int(sys.argv[2]);assert os.geteuid()==uid and len(pids)<=64
result={}
for pid in pids:
 p=pathlib.Path('/proc')/str(pid)
 def identity():
  s=(p/'stat').read_text();return int(s[s.rindex(')')+2:].split()[19])
 before=identity();status=dict(x.split(':',1)for x in(p/'status').read_text().splitlines()if':'in x)
 assert all(int(x)==uid for x in status['Uid'].split())
 sockets=[];fds=list((p/'fd').iterdir());assert len(fds)<=512
 for f in fds:
  try:target=os.readlink(f)
  except FileNotFoundError:continue
  if target.startswith('socket:[')and target.endswith(']'):sockets.append(int(target[8:-1]))
 assert identity()==before
 result[str(pid)]={'startTicks':before,'socketInodes':sorted(set(sockets))}
print(json.dumps(result,sort_keys=True))
'''


def peer_fds(pids, uid, gid):
    need(all(type(p) is int and p > 0 for p in pids) and len(pids) <= 64, 'bounded_fixed_actor_pids_required')
    return json.loads(run(['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid),
        '--clear-groups', '--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all',
        '/usr/bin/python3', '-I', '-B', '-c', PEER_FDS, json.dumps(pids), str(uid)]))


def unix_peers(raw):
    result = {}
    for line in raw.decode().splitlines():
        cols = line.split()
        if len(cols) >= 8 and cols[0] in {'u_str', 'u_seq'} and cols[5].isdigit() and cols[7].isdigit():
            inode, peer = int(cols[5]), int(cols[7])
            if inode and peer:
                need(inode not in result or result[inode] == peer, 'ambiguous_unix_socket_peer_refused')
                result[inode] = peer
    return result


def tcp_clients(raw, ipv6=False):
    result = {}
    for line in raw.decode().splitlines()[1:]:
        cols = line.split()
        if len(cols) < 10 or cols[3] != '01': continue
        local, remote = cols[1].split(':'), cols[2].split(':')
        if int(remote[1], 16) != 5432: continue
        # IPv4 and IPv6 words in /proc/net/tcp are native little endian.
        data = bytes.fromhex(local[0])
        data = b''.join(data[i:i+4][::-1] for i in range(0, len(data), 4))
        result[int(cols[9])] = {'clientAddress': str(ipaddress.ip_address(data)),
                                'clientPort': int(local[1], 16), 'transport': 'tcp6' if ipv6 else 'tcp'}
    return result


def map_owned_backends(actor_fds, backend_fds, rows, peers, tcp):
    """Pure exact FD/peer or TCP endpoint join; never application-name/age inference."""
    need(len(rows) <= 64 and len({r['pid'] for r in rows}) == len(rows), 'bounded_unique_source_backends_required')
    matches = []; socket_set = {i for value in actor_fds.values() for i in value['socketInodes']}
    for inode in sorted(socket_set):
        peer = peers.get(inode)
        unix = [r for r in rows if peer is not None and peer in backend_fds[str(r['pid'])]['socketInodes']]
        endpoint = tcp.get(inode)
        remote = [r for r in rows if endpoint is not None and r['clientAddress'] is not None
                  and ipaddress.ip_address(r['clientAddress']) == ipaddress.ip_address(endpoint['clientAddress'])
                  and r['clientPort'] == endpoint['clientPort']]
        candidates = unix + remote
        need(len(candidates) <= 1, 'ambiguous_owned_source_backend_refused')
        if candidates:
            r = candidates[0]
            need(not any(v['pid'] == r['pid'] for v in matches), 'duplicate_owned_backend_socket_refused')
            matches.append({'pid': r['pid'], 'backendStart': r['backendStart'],
                            'transport': 'unix-peer-inode' if unix else endpoint['transport']})
    return sorted(matches, key=lambda r: r['pid'])


def source_rows(host):
    return host.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,"
        "'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)"
        "FROM pg_stat_activity WHERE usename='yunipals_unified_shadow' AND datname='yunipals_backfill'")


def actor(host, unit):
    state = host.state(unit); pid = int(state['MainPID'])
    need(pid > 0 and state['ActiveState'] == 'active' and state['SubState'] == 'running'
         and state['ControlGroup'] == '/system.slice/' + unit and state['Job'] in {'', '0'}, 'fixed_running_source_actor_required')
    group = Path('/sys/fs/cgroup' + state['ControlGroup'])
    pids = sorted(int(v) for v in (group / 'cgroup.procs').read_text().split())
    need(pid in pids and 1 <= len(pids) <= 2, 'bounded_source_Node_and_esbuild_cgroup_required')
    proofs = []
    for item in pids:
        peer = host.peer_process_properties(item)
        status = dict(line.split(':', 1) for line in (Path('/proc') / str(item) / 'status').read_text().splitlines() if ':' in line)
        host_module = load('booster-feature-handover-v7.py'); host_module.validate_source_status(status)
        need((item == pid and peer['nodeExecutable']) or (item != pid and peer['esbuildExecutable']), 'only_actual_Node_and_pinned_esbuild_allowed')
        if item != pid:
            argv = (Path('/proc') / str(item) / 'cmdline').read_bytes().rstrip(b'\0').decode().split('\0')
            host_module.validate_esbuild_child(host_module.ESBUILD, host_module.protected(host_module.ESBUILD, 150000000), argv, int(status['PPid']), pid)
        proofs.append({'pid': item, **peer})
    return {'unit': unit, 'pid': pid, 'invocation': state['InvocationID'], 'startTicks': next(p['startTicks'] for p in proofs if p['pid'] == pid),
            'cgroup': state['ControlGroup'], 'actorPids': pids, 'peerProofs': proofs}


def attribute_old_sessions(old_actor, rows, *, combined_actor=None):
    host = load('booster-feature-handover-v7.py').Host()
    current = actor(host, SOURCE); combined = actor(host, COMBINED)
    need(current == old_actor and (combined_actor is None or combined == combined_actor), 'source_identity_changed_before_socket_attribution')
    old_fds = peer_fds(current['actorPids'], 970, 964)
    shared_fds = peer_fds(combined['actorPids'], 970, 964)
    backends = peer_fds([r['pid'] for r in rows], 111, 113)
    peers = unix_peers(run(['/usr/bin/ss', '-xHn']))
    tcp = {**tcp_clients(Path('/proc/net/tcp').read_bytes()), **tcp_clients(Path('/proc/net/tcp6').read_bytes(), True)}
    old = map_owned_backends(old_fds, backends, rows, peers, tcp)
    shared = map_owned_backends(shared_fds, backends, rows, peers, tcp)
    need(not {r['pid'] for r in old} & {r['pid'] for r in shared}, 'old_and_combined_backend_ownership_must_be_disjoint')
    need({r['pid'] for r in rows} == {r['pid'] for r in old + shared}, 'all_shared_writer_backends_must_have_actual_socket_ownership')
    need(source_rows(host) == rows, 'source_backend_set_changed_during_socket_observation')
    need(actor(host, SOURCE) == current, 'old_source_actor_changed_during_socket_observation')
    need(actor(host, COMBINED) == combined, 'combined_actor_changed_during_socket_observation')
    return {'method': 'actual-owned-client-FD-to-Unix-peer-or-TCP-endpoint', 'complete': True,
            'oldBackends': old, 'combinedBackends': shared, 'sourceRoleBackendCount': len(rows),
            'applicationNameOrAgeInference': False, 'sharedRoleZeroSessionsRequired': False}


UNIT_KEYS = ('Id,LoadState,ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic,FragmentPath,DropInPaths,Job,UnitFileState,'
        'User,Group,WorkingDirectory,EnvironmentFiles,ControlGroup,NRestarts,Triggers,TriggeredBy,WantedBy,RequiredBy,UpheldBy,'
        'NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp,PrivateDevices,ProtectKernelTunables,ProtectKernelModules,ProtectControlGroups,'
        'RestrictSUIDSGID,RestrictAddressFamilies,ReadOnlyPaths,ReadWritePaths,InaccessiblePaths,CapabilityBoundingSet,AmbientCapabilities,MemoryMax,TasksMax,UMask')


def unit_packet(name):
    need(name in {SOURCE, COMBINED, API, QUEUE, TIMER, 'yunipals-api.service'}, 'fixed_public_unit_inventory_required')
    raw = run(['/usr/bin/systemctl', 'show', name, '--property=' + UNIT_KEYS])
    state = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
    files = {path: file_pin(path) for path in [state['FragmentPath'], *state.get('DropInPaths', '').split()]}
    argv = []
    if state.get('MainPID', '0') != '0':
        argv = (Path('/proc') / state['MainPID'] / 'cmdline').read_bytes().rstrip(b'\0').decode().split('\0')
    definition = Path(state['FragmentPath']).read_text()
    declared = [shlex.split(line.split('=', 1)[1]) for line in definition.splitlines() if line.startswith('ExecStart=')]
    public_args = argv + [value for row in declared for value in row]
    need(all('://' not in value and not re.search(r'(?:password|secret|api.key)=', value, re.I) for value in public_args), 'private_argv_may_not_be_exported')
    env_paths = [shlex.split(line.split('=', 1)[1])[0].lstrip('-') for line in definition.splitlines() if line.startswith('EnvironmentFile=')]
    private = {path: file_pin(path) for path in env_paths}
    return {'state': state, 'definitionFiles': files, 'argv': argv, 'declaredArgv': declared,
            'argvSha256': sha(json.dumps(argv, sort_keys=True, separators=(',', ':')).encode()),
            'privateInputHashes': private}


def independent():
    q = load('source6-normal-proxy-requalification-v1.py'); proof = q.validate_current(ACK)
    main = unit_packet('yunipals-api.service')
    state = main['state']; pid = int(state['MainPID'])
    raw = (Path('/proc') / str(pid) / 'stat').read_text()
    main['actor'] = {'pid': pid, 'invocation': state['InvocationID'], 'startTicks': int(raw[raw.rindex(')') + 2:].split()[19])}
    need(state['ActiveState'] == 'active' and state['SubState'] == 'running', 'independent_OG_API_must_stay_active')
    need(q.validate_current(ACK) == proof and unit_packet('yunipals-api.service') == {k: v for k, v in main.items() if k != 'actor'}, 'independent_actor_or_private_inputs_changed')
    return {'format': 'yunipals-ypal-independent-runtime-v1', 'qualifiedCombined': proof,
            'main': main, 'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0}


def current_source_backends():
    return source_rows(load('booster-feature-handover-v7.py').Host())


def workspace_packet(root):
    root = Path(root)
    need(root == Path('/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer'), 'fixed_old_workspace_required')
    names = ['package.json', 'ponder.boosters.launch.config.ts', 'ponder.config.ts', 'ponder.schema.ts',
             'src/index.ts', '../../RELEASE-MANIFEST.json']
    source_dir = root / 'src'
    if source_dir.is_dir():
        direct = list(source_dir.glob('*.ts')); need(len(direct) <= 64, 'bounded_old_source_overlay_required')
        names += [str(p.relative_to(root)) for p in direct]
    files = {str(root / name): file_pin(root / name) for name in sorted(set(names)) if (root / name).is_file()}
    links = {}
    for parent in [root / 'node_modules', root / 'node_modules/@protopals']:
        if not parent.is_dir(): continue
        entries = list(parent.iterdir()); need(len(entries) <= 128, 'bounded_old_dependency_link_layout_required')
        for path in sorted(entries):
            info = path.lstat()
            if path.is_symlink(): links[str(path)] = {'target': os.readlink(path), 'uid': info.st_uid, 'gid': info.st_gid}
    config = root / 'ponder.boosters.launch.config.ts'
    code = config.read_text(); need(len(code) < 100000 and 'sk-proj-' not in code, 'bounded_public_launch_config_required')
    # Only public code dataflow excerpts; no environment values or private source text.
    excerpts = [{'line': i, 'text': line.strip()} for i, line in enumerate(code.splitlines(), 1)
                if any(key in line.lower() for key in ['import ', 'preflight', 'profile', 'manifest', 'transport', 'pool', 'database', 'booster', 'createconfig'])
                and '://' not in line]
    public_env = root / 'launch.public.env'
    env_keys = sorted(line.split('=', 1)[0] for line in public_env.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    return {'root': str(root), 'publicFilePins': files, 'dependencyLinks': links,
            'publicLaunchConfig': {'file': str(config), 'sha256': files[str(config)]['sha256'], 'codeExcerpts': excerpts},
            'publicEnvironmentFile': str(public_env), 'publicEnvironmentKeys': env_keys}


def port_inventory():
    result = []
    for line in run(['/usr/bin/ss', '-Hlnpt']).decode().splitlines():
        fields = line.split()
        if len(fields) < 5: continue
        endpoint = fields[3]
        match = re.search(r':([0-9]+)$', endpoint)
        if match and int(match[1]) in {9011, 9024, 9026, 9030, 19201, 19202, 19203, 19204}:
            result.append({'endpoint': endpoint, 'port': int(match[1]), 'pids': sorted(set(int(v) for v in re.findall(r'pid=([0-9]+)', line)))})
    return result


def capture():
    need(os.geteuid() == 0 and os.uname().nodename == 'yunipals-main', 'root_on_exact_main_required')
    q = load('source6-normal-proxy-requalification-v1.py'); qualified = q.validate_current(ACK)
    module = load('booster-feature-handover-v7.py'); host = module.Host()
    old = actor(host, SOURCE); shared = actor(host, COMBINED)
    need((shared['pid'], shared['invocation']) == (716994, 'c3463c9a2e1240e8890e318ba1360cf4'), 'same_authoritative_combined_actor_required')
    inputs = host.source_inputs(); catalog = host.admission.validate(host.admission.capture())
    api = host.admission.api_binding()
    units = {name: unit_packet(name) for name in (SOURCE, API, QUEUE, TIMER)}
    private = {path: file_pin(path) for path in inputs['environmentFiles']}
    for packet in units.values(): private.update(packet['privateInputHashes'])
    native = host.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='yunipals_boosters_launch_v1'),"
        "'app',(SELECT value FROM yunipals_boosters_launch_v1._ponder_meta WHERE key='app'))")
    source_role = host.query("SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'connectionLimit',rolconnlimit,"
        "'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDatabase',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls)"
        "FROM pg_roles WHERE rolname='yunipals_unified_shadow'")
    try: source_sessions = attribute_old_sessions(old, source_rows(host), combined_actor=shared)
    except RuntimeError as error:
        need(str(error) in {'source_backend_set_changed_during_socket_observation',
            'old_source_actor_changed_during_socket_observation', 'combined_actor_changed_during_socket_observation'},
            'unqualified_socket_inventory_requires_manual_diagnosis')
        source_sessions = {'complete': False, 'fixedCode': str(error), 'stopAuthorized': False}
    need(q.validate_current(ACK)['runtime'] == qualified['runtime'] and actor(host, SOURCE) == old and host.admission.api_binding() == api,
         'fixed_source_or_API_changed_during_inventory')
    return {'format': 'yunipals-old-booster-runtime-inventory-v1', 'operatorSha256': sha(Path(__file__).read_bytes()),
        'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
        'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': {'actor': old, 'inputs': inputs, 'sessionAttribution': source_sessions, 'unit': units[SOURCE], 'workspace': workspace_packet(inputs['workingDirectory'])},
        'api': {'binding': api, 'unit': units[API]}, 'queue': {'service': units[QUEUE], 'timer': units[TIMER]},
        'privateInputHashes': private, 'roles': {'source': source_role, 'collector': catalog['role']},
        'nativeOld': {**native, 'readTableOids': {r['name']: r['oid'] for r in catalog['tables']}},
        'independentActors': {'combined': shared, 'sourceQualification': qualified, 'current': independent()},
        'ports': port_inventory(),
        'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0, 'productionFileWrites': 0}


if __name__ == '__main__':
    try: print(json.dumps(capture(), sort_keys=True))
    except Exception as error:
        print(json.dumps({'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld',
            'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0}))
        raise SystemExit(1)
