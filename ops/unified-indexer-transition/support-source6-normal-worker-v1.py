#!/usr/bin/env python3
"""Review/start one bounded official support worker. No source selection or source restart."""
import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-source6-normal-support-worker-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-source6-normal-support-v1-20261022')
UNIT = 'yunipals-unified-support-source6-v2.service'
UNIT_PATH = Path('/run/systemd/system') / UNIT
SOURCE_UNIT = 'yunipals-unified-source6-free-v2.service'
PROBE_SHA = '4e292d4ab715e9e6efd0e176bbc4263c614a7c6b8d27fd82a1f583e8c49d6969'
INSTALLER_SHA = '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b'
INSTALL_SHA = '87333b9a98b634722e6d6158a0fbf0049045c6edad51dacbb549754594d9fb98'
RUNTIME_SHA = 'd41ec37965ef517496bec80f0c6cf9b2175e01c9d4eaf417970ea3d8778b66cd'
ENTRY_SHA = '9c00d05d2f9ba63a00c69d9d1fad22959b2e0d507977da8415f034c562cf09e6'
SOURCE_CLOCK = {'bootId': 'd1330112-af72-4b2e-a542-25504553ff5e', 'originalRuntimeExpiresMonotonicMicroseconds': 66101373277294, 'parentStartMonotonicUs': 66072633277294}
MAXIMUM = 3600
START_RESERVE = 30
STOP_RESERVE = 30
CLEAN = {'PATH': '/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
# Same-UID inspection follows the frozen source process reader. E0 root cannot
# dereference another UID's /proc/exe without CAP_SYS_PTRACE.
PROCESS_READER = r'''import json,os,pathlib,re,sys
pid=int(sys.argv[1]);entry=sys.argv[2]
if not 0<pid<2147483648 or entry!='/opt/yunipals-unified/nonmarket-consumer-releases/bc540aee6d647ffee7c1e99865569028f15cbaa19c8f007e0e5e7a48764f001b/dist/unified-support.mjs':raise RuntimeError('exact_support_process_selector_required')
me=dict(line.split(':',1)for line in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in line)
if os.getuid()!=969 or os.geteuid()!=969 or os.getgid()!=963 or os.getegid()!=963 or os.getgroups()!=[] or me['NoNewPrivs'].strip()!='1' or int(me['CapBnd'],16)!=224 or any(int(me[k],16)for k in ['CapPrm','CapEff','CapInh','CapAmb']):raise RuntimeError('restricted_support_proc_reader_required')
root=pathlib.Path('/proc')/str(pid)
def snapshot():
 raw=(root/'stat').read_text();end=raw.rfind(') ');fields=raw[end+2:].split()
 if not raw.startswith(str(pid)+' (')or end<0 or len(fields)<20 or not fields[19].isdigit():raise RuntimeError('support_start_ticks_unavailable')
 s=dict(line.split(':',1)for line in(root/'status').read_text().splitlines()if ':'in line)
 if s['Uid'].split()!=['969']*4 or s['Gid'].split()!=['963']*4 or set(s['Groups'].split())-{'963'} or s['NoNewPrivs'].strip()!='1' or any(int(s[k],16)for k in ['CapPrm','CapEff','CapInh','CapAmb','CapBnd']):raise RuntimeError('support_process_boundary_changed')
 if(root/'cgroup').read_text().splitlines()!=['0::/system.slice/yunipals-unified-support-source6-v2.service']:raise RuntimeError('support_cgroup_changed')
 if os.readlink(root/'exe')!='/opt/node-v24.18.1/bin/node' or(root/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')!=[b'/opt/node-v24.18.1/bin/node',entry.encode(),b'worker']:raise RuntimeError('support_command_changed')
 return{'pid':pid,'startTicks':int(fields[19]),'uid':969,'gid':963,'executable':'/opt/node-v24.18.1/bin/node'}
first=snapshot()
if snapshot()!=first:raise RuntimeError('support_identity_changed_during_read')
print(json.dumps(first,sort_keys=True))
'''


def fail(code):
    raise RuntimeError(code)


def dependencies():
    path = OPS / 'support-probe-source6-v11.py'
    for part in [*path.parents, path]:
        s = part.lstat()
        if s.st_uid != 0 or stat.S_ISLNK(s.st_mode) or s.st_mode & 0o022:
            fail('protected_support_helper_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != PROBE_SHA:
        fail('exact_support_helper_required')
    p = types.ModuleType('support_probe'); p.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), p.__dict__)
    runtime = p.load_module(OPS / 'source6-bnb-header-trial-v1.py', p.RUNTIME_HELPER_SHA)
    support = p.load_module(OPS / 'prepare-shadow-support.py', p.SUPPORT_SHA)
    proxy = p.load_module(OPS / 'proxy-upgrade.py', p.PROXY_SHA)
    installer = p.load_module(OPS / 'nonmarket-consumer-runtime-install-v1.py', INSTALLER_SHA)
    return p, runtime, support, proxy, installer, installer.shared()


def require_e0():
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if (os.geteuid() != 0 or socket.gethostname() != 'yunipals-main' or status['NoNewPrivs'].strip() != '1'
            or any(int(status[k].strip(), 16) != 224 for k in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'))):
        fail('exact_root_e0_capability_boundary_required')


def call(args, timeout=15):
    cp = subprocess.run(args, capture_output=True, timeout=timeout, env=CLEAN)
    if cp.returncode or cp.stderr or len(cp.stdout) > 262144:
        fail('bounded_fixed_support_command_failed')
    return cp.stdout.decode()


def manager(keys):
    cp = subprocess.run(['/usr/bin/systemctl', 'show', UNIT, *['--property=' + k for k in keys]], capture_output=True, timeout=10, env=CLEAN)
    rows = [line.partition('=') for line in cp.stdout.decode().splitlines()]
    if cp.returncode not in (0, 4) or cp.stderr or len(rows) != len(keys) or {r[0] for r in rows} != set(keys) or any(not r[1] for r in rows):
        fail('exact_support_unit_properties_required')
    return {key: value for key, _, value in rows}


def no_worker():
    keys = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'Job', 'FragmentPath', 'DropInPaths')
    s = manager(keys)
    if (s['Id'] != UNIT or s['LoadState'] != 'not-found' or s['ActiveState'] != 'inactive' or s['SubState'] != 'dead'
            or s['MainPID'] != '0' or s['Job'] not in ('', '0') or s['FragmentPath'] or s['DropInPaths'] or os.path.lexists(UNIT_PATH)):
        fail('fresh_support_unit_required')
    # Exclude any prior normal/finite worker using this dedicated identity.
    for path in Path('/proc').glob('[0-9]*/status'):
        try:
            text = path.read_text()
        except FileNotFoundError:
            continue
        match = re.search(r'^Uid:\s+(\d+)', text, re.M)
        if match and match[1] == '969':
            fail('support_identity_already_in_use')
    return s


def clock_now():
    if Path('/proc/sys/kernel/random/boot_id').read_text().strip() != SOURCE_CLOCK['bootId']:
        fail('original_source_boot_required')
    return time.monotonic_ns() // 1000


def duration(now):
    remaining = (SOURCE_CLOCK['originalRuntimeExpiresMonotonicMicroseconds'] - now) // 1000000
    seconds = min(MAXIMUM, remaining - START_RESERVE - STOP_RESERVE - 30)
    if seconds < 60:
        fail('source_cutoff_has_insufficient_support_headroom')
    return seconds


def unit_text(p, installer, m, seconds):
    if type(seconds) is not int or not 60 <= seconds <= MAXIMUM:
        fail('bounded_worker_duration_required')
    env = ['PATH=/opt/node-v24.18.1/bin:/usr/bin:/bin', 'LANG=C.UTF-8', 'TZ=UTC', 'NODE_OPTIONS=--max-old-space-size=384',
           'UNIFIED_INDEXER_DATABASE_URL=postgresql:///yunipals_backfill?host=/var/run/postgresql&port=5432&user=' + p.ROLE,
           'UNIFIED_INDEXER_RELEASE_ID=' + p.RELEASE, 'UNIFIED_RPC_POLICY_REQUIRED=true', 'UNIFIED_RPC_FREE_ONLY=true',
           'UNIFIED_RPC_PROFILE_FILE=' + str(p.PROFILE_FILE), 'UNIFIED_RPC_PROFILE_ID=' + p.PROFILE]
    env += ['PONDER_RPC_URL_' + str(chain) + '=http://127.0.0.1:' + str(port) + '/unified' for chain, (_, port) in p.CHAINS.items()]
    command = ' '.join(['/usr/bin/env', '-i', *env, p.NODE, str(installer.TARGET / 'dist/unified-support.mjs'), 'worker'])
    return ('[Unit]\nDescription=Yunipals bounded official source008 support worker\nRequisite=' + SOURCE_UNIT +
            '\nAfter=' + SOURCE_UNIT + '\nPartOf=' + SOURCE_UNIT + '\nJobTimeoutSec=15\n[Service]\nType=exec\nUser=' + p.ROLE +
            '\nGroup=' + p.ROLE + '\nWorkingDirectory=' + str(m.ROOT / 'apps/yunipals-indexer') + '\nExecStart=' + command +
            '\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n'
            'RestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=localhost\n'
            'MemoryMax=768M\nCPUQuota=50%\nRuntimeMaxSec=' + str(seconds) + '\nTimeoutStartSec=15\nTimeoutStopSec=30\n'
            'KillMode=control-group\nRestart=no\nUMask=0077\nStandardOutput=journal\nStandardError=journal\n').encode()


def process_identity(pid, installer):
    if type(pid) is not int or not 0 < pid < 2147483648:
        fail('exact_support_pid_required')
    command = ['/usr/bin/setpriv', '--reuid=969', '--regid=963', '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all',
               '--no-new-privs', '/usr/bin/env', '-i', '/usr/bin/python3', '-I', '-c', PROCESS_READER, str(pid),
               str(installer.TARGET / 'dist/unified-support.mjs')]
    cp = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=5, env=CLEAN)
    if cp.returncode or cp.stderr or len(cp.stdout) > 2048:
        fail('bounded_same_uid_support_process_inspection_failed')
    value = json.loads(cp.stdout)
    if (set(value) != {'pid', 'startTicks', 'uid', 'gid', 'executable'} or value['pid'] != pid
            or type(value['startTicks']) is not int or value['startTicks'] <= 0 or value['uid'] != 969 or value['gid'] != 963
            or value['executable'] != '/opt/node-v24.18.1/bin/node'):
        fail('exact_same_uid_support_process_result_required')
    return value


def inspect(d):
    p, runtime, support, proxy, installer, m = d
    installed = installer.installed(m, INSTALL_SHA)
    if installed['files'].get('dist/unified-support.mjs') != ENTRY_SHA:
        fail('exact_corrected_support_entry_required')
    if os.path.lexists(BASE):
        fail('one_support_start_attempt_only')
    state = no_worker()
    account, group = pwd.getpwnam(p.ROLE), grp.getgrnam(p.ROLE)
    if (account.pw_uid != 969 or account.pw_gid != 963 or group.gr_gid != 963 or account.pw_shell != '/usr/sbin/nologin'
            or sorted(set(os.getgrouplist(p.ROLE, account.pw_gid))) != [963]):
        fail('exact_dedicated_support_identity_required')
    rights = json.loads(support.sql('BEGIN READ ONLY; SET LOCAL statement_timeout=\'5s\'; ' + support.privilege_query() + '; ROLLBACK;'))
    if rights != support.desired_privileges():
        fail('exact_existing_support_acl_required')
    selected = p.controls(support)
    plan = {'runtimeReceiptFile': str(p.RUNTIME_RECEIPT), 'runtimeReceiptSha256': RUNTIME_SHA}
    actual = p.runtime_state(runtime, plan)
    if json.loads(p.trusted(p.RUNTIME_RECEIPT))['clock'] != SOURCE_CLOCK:
        fail('unchanged_source_cutoff_required')
    proxies = p.proxy_state(proxy, actual, sorted(p.CHAINS))
    runner = p.trusted(OPS / 'support-probe-runner-v5.mjs')
    if p.sha(runner) != p.RUNNER_SHA:
        fail('exact_readonly_peer_inspector_required')
    observed = p.run_peer(account, runner, {'chains': sorted(p.CHAINS), 'task': 'worker', 'profileId': p.PROFILE,
                          'queueLimit': 8, 'receiptLimit': 2, 'maxRpcCalls': 8, 'maxSeconds': 60, 'maxResponseBytes': 2097152}, 'inspect')
    value = observed['result']
    if observed['returnCode'] or value.get('writes') is not False or value.get('rpcCalls') != 0 or value.get('releaseId') != p.RELEASE or value.get('before', {}).get('running') is not True:
        fail('actual_restricted_peer_readonly_proof_required')
    if no_worker() != state or p.runtime_state(runtime, plan) != actual:
        fail('source_changed_during_readonly_support_review')
    duration(clock_now())
    binding = {'format': FORMAT, 'operatorSha256': p.sha(p.trusted(Path(__file__).absolute())), 'installerSha256': INSTALLER_SHA,
               'installReceiptSha256': INSTALL_SHA, 'artifactDigest': installer.DIGEST, 'entrySha256': ENTRY_SHA,
               'runtimeReceiptSha256': RUNTIME_SHA, 'ordinary': actual, 'clock': SOURCE_CLOCK,
               'maximumRuntimeSeconds': MAXIMUM, 'startReserveSeconds': START_RESERVE, 'stopReserveSeconds': STOP_RESERVE,
               'unitTemplateSha256': p.sha(unit_text(p, installer, m, MAXIMUM)), 'unit': state,
               'identity': {'uid': 969, 'gid': 963}, 'privileges': rights, 'controls': selected, 'proxies': proxies,
               'observerWitnessRequiredToStart': False, 'peerReadOnlyVerified': True, 'providerCallsDuringReview': 0,
               'paidAuthority': False, 'sourceRestarted': False, 'sourceSelectionChanged': False}
    return binding, value['before']


def live_definition(p, installer, m, raw, seconds, active):
    if p.trusted(UNIT_PATH) != raw:
        fail('owned_support_definition_changed')
    keys = ('Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'Job', 'InvocationID', 'FragmentPath', 'DropInPaths', 'User', 'Group',
            'WorkingDirectory', 'ExecStart', 'Restart', 'Type', 'RuntimeMaxUSec', 'TimeoutStartUSec', 'TimeoutStopUSec', 'JobTimeoutUSec',
            'ExecMainStartTimestampMonotonic', 'EnvironmentFiles', 'Environment', 'PassEnvironment', 'UnsetEnvironment', 'UnitFileState')
    s = manager(keys)
    expected = {'Id': UNIT, 'LoadState': 'loaded', 'FragmentPath': str(UNIT_PATH), 'DropInPaths': '', 'User': p.ROLE, 'Group': p.ROLE,
                'WorkingDirectory': str(m.ROOT / 'apps/yunipals-indexer'), 'Restart': 'no', 'Type': 'exec',
                'TimeoutStartUSec': '15s', 'TimeoutStopUSec': '30s', 'JobTimeoutUSec': '15s',
                'EnvironmentFiles': '', 'Environment': '', 'PassEnvironment': '', 'UnsetEnvironment': '', 'UnitFileState': 'static'}
    expected_command = next(line.removeprefix('ExecStart=') for line in raw.decode().splitlines() if line.startswith('ExecStart='))
    if any(s[k] != v for k, v in expected.items()) or s['Job'] not in ('', '0') or re.findall(r'argv\[\]=(.*?)\s+;', s['ExecStart']) != [expected_command]:
        fail('exact_effective_support_unit_required')
    # systemd formats whole-minute durations rather than a numeric microsecond string.
    runtime = call(['/usr/bin/systemctl', 'show', UNIT, '--property=RuntimeMaxUSec', '--value']).strip()
    values = re.findall(r'(\d+)(h|min|s)', runtime)
    if not values or sum(int(v) * {'h': 3600, 'min': 60, 's': 1}[u] for v, u in values) != seconds:
        fail('effective_support_runtime_bound_changed')
    if active:
        if s['ActiveState'] != 'active' or s['SubState'] != 'running' or not re.fullmatch('[1-9][0-9]*', s['MainPID']) or not re.fullmatch('[a-f0-9]{32}', s['InvocationID']):
            fail('support_start_not_acknowledged')
        start = int(s['ExecMainStartTimestampMonotonic'])
        if start + (seconds + STOP_RESERVE) * 1000000 > SOURCE_CLOCK['originalRuntimeExpiresMonotonicMicroseconds']:
            fail('actual_support_start_exceeds_source_cutoff')
        s['processIdentity'] = process_identity(int(s['MainPID']), installer)
    elif s['ActiveState'] != 'inactive' or s['SubState'] != 'dead' or s['MainPID'] != '0':
        fail('dormant_support_definition_required')
    return s


def apply(d, expected):
    p, runtime, support, proxy, installer, m = d
    # Reuse source and support leases while submitting the one start. The worker
    # is an official separate service; no lease is held throughout its hour.
    with runtime.modules().c.source_lease():
        binding, _ = inspect(d)
        if p.sha(p.encoded(binding)) != expected:
            fail('fresh_exact_support_review_required')
        installer.directory(BASE.parent)
        BASE.mkdir(mode=0o700); p.sync_directory(BASE.parent)
        p.save(BASE / 'intent.json', {'reviewSha256': expected, 'binding': binding, 'automaticRetryAllowed': False})
        phase = 'install'
        try:
            seconds = duration(clock_now())
            raw = unit_text(p, installer, m, seconds)
            p.save(BASE / 'unit.json', {'sha256': p.sha(raw), 'maximumRuntimeSeconds': seconds, 'text': raw.decode()})
            m.write_new(UNIT_PATH, raw, 0o644); p.sync_directory(UNIT_PATH.parent)
            call(['/usr/bin/systemctl', 'daemon-reload'], timeout=30)
            live_definition(p, installer, m, raw, seconds, False)
            if clock_now() + (seconds + START_RESERVE + STOP_RESERVE) * 1000000 > SOURCE_CLOCK['originalRuntimeExpiresMonotonicMicroseconds']:
                fail('source_cutoff_start_headroom_expired')
            phase = 'start'
            call(['/usr/bin/systemctl', 'start', UNIT], timeout=35)
            actual = live_definition(p, installer, m, raw, seconds, True)
            phase = 'acknowledge'
            plan = {'runtimeReceiptFile': str(p.RUNTIME_RECEIPT), 'runtimeReceiptSha256': RUNTIME_SHA}
            if p.runtime_state(runtime, plan) != binding['ordinary'] or p.controls(support) != binding['controls']:
                fail('source_changed_during_support_start')
            result = {'format': FORMAT, 'started': True, 'reviewSha256': expected, 'installReceiptSha256': INSTALL_SHA,
                      'runtimeReceiptSha256': RUNTIME_SHA, 'unitSha256': p.sha(raw), 'unit': actual, 'maximumRuntimeSeconds': seconds,
                      'clock': SOURCE_CLOCK, 'paidAuthority': False, 'sourceRestarted': False, 'sourceSelectionChanged': False,
                      'observerAcceptanceClaimed': False, 'receiptHistoryCompleteClaimed': False, 'automaticRestart': False}
            p.save(BASE / 'result.json', result)
            return result
        except BaseException:
            p.save(BASE / 'failed.json', {'phase': phase, 'startMayHaveCompleted': phase in ('start', 'acknowledge'),
                                        'automaticRetryAllowed': False, 'runtimeAndSourceCutoffRemainEnforced': True})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply'); args = parser.parse_args()
    require_e0(); os.umask(0o077)
    d = dependencies(); p = d[0]
    fd = os.open(p.LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        s = os.fstat(lock.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077:
            fail('protected_support_lease_required')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.apply:
            if not re.fullmatch('[a-f0-9]{64}', args.apply): fail('exact_review_hash_required')
            value = apply(d, args.apply)
            print(json.dumps({'format': FORMAT, 'started': True, 'reviewSha256': args.apply, 'unit': UNIT,
                              'receiptFile': str(BASE / 'result.json'), 'receiptSha256': p.sha(p.trusted(BASE / 'result.json')),
                              'maximumRuntimeSeconds': value['maximumRuntimeSeconds'], 'sourceSelectionChanged': False, 'paidAuthority': False}))
        else:
            value, observation = inspect(d)
            print(json.dumps({'format': FORMAT, 'started': False, 'reviewSha256': p.sha(p.encoded(value)), 'binding': value,
                              'observation': observation, 'providerCalls': 0, 'databaseWrites': 0}))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('support_start_operator_deadline')); signal.alarm(180)
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'support_start_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code, 'automaticRetryAllowed': False})); raise SystemExit(1)
    finally:
        signal.alarm(0)
