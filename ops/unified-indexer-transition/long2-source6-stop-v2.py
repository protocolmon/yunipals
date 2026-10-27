#!/usr/bin/env python3
"""Review or gracefully stop/seal exactly the retained source5 long2 actor."""
from contextlib import contextmanager
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import stat
import subprocess
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-long2-source6-stop-v1-20261021')
LONG2 = Path('/var/lib/yunipals-unified-shadow/source5-resumes/20261020-008028af-long2')
CONTROLLER = 'yunipals-unified-source5-controller-20261021-long2.service'
NATIVE = 'yunipals-unified-persistent-20261020-008028af-long2.service'
INVOCATIONS = {CONTROLLER: '96f4790c1de04b1e9b2e324e722bc185', NATIVE: 'debba27f90b44416bd9399305e3392f7'}
REVIEW_HASH = '54e4b170af9e688ddc77757fe0a241bd783ce7afa508774be09bcd319c00ff8e'
RESUME_SHA = '3756ad3a2eb27f21fe9f1f7005847ff42952838f220cced1db53d8a6759a539b'
COMMON_SHA = '25a595d23d8584977df4d02438fc5fe021ef5b077569585cf6a42a853b3bab3c'
FORMAT = 'yunipals-long2-source6-stop-operator-v2'
PROJECTION = OPS / 'long2-source6-stop-proof.json'
WITNESS = OPS / 'long2-source6-terminal-witness.json'
LOCK = Path('/run/lock/yunipals-long2-source6-stop.lock')
SOURCE_LOCK = Path('/run/lock/yunipals-unified-shadow.lock')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
STOP_KEYS = ('Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'Result', 'ExecMainStatus', 'MainPID')
UNIT_KEYS = (*STOP_KEYS, 'Description', 'ExecMainStartTimestampMonotonic', 'ExecMainExitTimestampMonotonic')
DIAGNOSIS = 'manual_stop_for_explicitly_approved_one_time_paid_capability_epoch'


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()


def trusted(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts: fail('Protected fixed input required.')
    for item in [*path.parents, path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            fail('Protected input ancestry differs.')
    before = path.stat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum: fail('Bounded regular input required.')
    raw = path.read_bytes(); after = path.stat()
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if len(raw) > maximum or identity(before) != identity(after): fail('Input changed while reading.')
    return raw


def load(path, expected, name):
    raw = trusted(path)
    if sha(raw) != expected: fail('Frozen stop prerequisite changed.')
    module = types.ModuleType(name); module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def modules():
    r = load(OPS / 'persistent-source5-resume.py', RESUME_SHA, 'stop_frozen_source5_resume')
    c, v, p = r.modules()
    if r.COMMON_SHA != COMMON_SHA: fail('Frozen source5 helper identity differs.')
    return r, c, v, p


def command(args, timeout=3):
    result = subprocess.run(args, env=ENV, capture_output=True, text=True, timeout=timeout)
    if result.returncode or len(result.stdout.encode()) > 64_000: fail('Bounded fixed unit observation failed.')
    return result.stdout


def unit_state(unit):
    if unit not in INVOCATIONS: fail('Only the two exact owned units may be observed.')
    raw = command(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in UNIT_KEYS]])
    value = {}
    for line in raw.splitlines():
        key, sep, item = line.partition('=')
        if not sep or key not in UNIT_KEYS or key in value: fail('Unexpected fixed unit properties.')
        value[key] = item
    if set(value) != set(UNIT_KEYS) or value['Id'] != unit or value['LoadState'] != 'loaded' or value['InvocationID'] != INVOCATIONS[unit]:
        fail('Actual loaded owned invocation required; GC cannot be adopted.')
    return value


def active(value):
    if value['ActiveState'] != 'active' or value['SubState'] != 'running' or not value['MainPID'].isdigit() or int(value['MainPID']) <= 1:
        fail('Exact owned actor must still be running.')
    if not value['ExecMainStartTimestampMonotonic'].isdigit() or int(value['ExecMainStartTimestampMonotonic']) <= 0:
        fail('Actual owned monotonic start required.')


def stopped(value, *, controller=False):
    if value['ActiveState'] not in {'inactive', 'failed'} or value['SubState'] not in {'dead', 'failed'} or value['MainPID'] != '0' or value['ExecMainStatus'] == '75':
        fail('Exact gracefully stopped actor required; exit75 is not adopted.')
    if controller and (value['Result'] != 'success' or value['ExecMainStatus'] != '0'):
        fail('Controller must finish its actual graceful cleanup successfully.')
    if not controller and (value['Result'] not in {'success', 'signal'} or value['ExecMainStatus'] not in {'0', '15', '143'}):
        fail('Owned native cleanup did not have the expected termination outcome.')


def terminal_states():
    # pidfd readability may precede systemd's SIGCHLD bookkeeping. Observe that
    # bounded transition without sending another signal or adopting a new unit.
    deadline = time.monotonic() + 5
    while True:
        controller, native = unit_state(CONTROLLER), unit_state(NATIVE)
        if all(value['ActiveState'] in {'inactive', 'failed'} and value['MainPID'] == '0' for value in (controller, native)):
            stopped(controller, controller=True); stopped(native)
            return controller, native
        if time.monotonic() >= deadline: fail('Owned units did not finish systemd cleanup; no force kill/retry.')
        time.sleep(0.1)


def process_identity(pid):
    if type(pid) is not int or pid <= 1: fail('Exact controller PID required.')
    root = Path('/proc') / str(pid)
    raw = (root / 'stat').read_text(); end = raw.rfind(')')
    fields = raw[end + 2:].split()
    if not raw.startswith(str(pid) + ' (') or end < 0 or len(fields) < 20 or not fields[19].isdigit(): fail('Actual controller process start unavailable.')
    status = {}
    for line in (root / 'status').read_text().splitlines():
        key, sep, item = line.partition(':')
        if key in {'Uid', 'Gid'} and sep: status[key] = item.split()
    if status != {'Uid': ['0'] * 4, 'Gid': ['0'] * 4}: fail('Original root controller process identity required.')
    if (root / 'cgroup').read_text().splitlines() != ['0::/system.slice/' + CONTROLLER]: fail('Controller moved outside its exact owned cgroup.')
    return {'pid': pid, 'startTicks': int(fields[19]), 'clockTicksPerSecond': os.sysconf('SC_CLK_TCK')}


def validate_binding(c, review):
    binding = review.get('binding', {}); plan = binding.get('plan', {})
    if (review.get('reviewHash') != REVIEW_HASH or sha(encoded(binding)) != REVIEW_HASH or
        binding.get('format') != 'yunipals-persistent-source5-manual-resume-v1' or binding.get('helperSha256') != RESUME_SHA or
        binding.get('commonHelperSha256') != COMMON_SHA or binding.get('sourceDigest') != c.ACTOR or binding.get('nativeBuild') != c.NATIVE or
        binding.get('originalCacheBytes') != 531472384 or binding.get('freeOnly') is not True or binding.get('launchGrantIds') != [] or
        binding.get('sourceOrCacheReset') is not False or binding.get('newWorkspaceCopy') is not False or binding.get('automaticRetryAllowed') is not False or
        plan.get('runId') != '20261020-008028af-long2' or plan.get('maximumSeconds') != 28800 or binding.get('liveEpoch', {}).get('activeSelector') != []):
        fail('Exact saved long2 review/source/free-only lineage required.')
    return binding


def validate_monitor(c, review, rows, *, terminal):
    binding = validate_binding(c, review); epoch = binding['liveEpoch']
    if not isinstance(rows, list) or not 2 <= len(rows) <= 10000: fail('Bounded actual long2 monitor required.')
    first = rows[0]
    if (first.get('event') != 'started' or first.get('reviewHash') != REVIEW_HASH or first.get('source5ResumeBinding') != binding or
        first.get('unit') != NATIVE or first.get('invocation') != INVOCATIONS[NATIVE]): fail('Long2 started lineage differs.')
    samples = [row for row in rows if row.get('event') == 'sample']
    if not samples: fail('Actual long2 running samples required.')
    for sample in samples:
        if sample.get('own', {}).get('InvocationID') != INVOCATIONS[NATIVE] or sample['own'].get('ActiveState') != 'active': fail('Foreign or exited native monitor sample.')
    values = list(samples)
    if terminal:
        last = rows[-1]
        if (last.get('event') != 'stopped' or last.get('reason') != 'operator_interrupt' or last.get('stopError') is not None or
            last.get('quarantined') is not True or last.get('automaticRetryAllowed') is not False or last.get('requiredSeconds') != 28800 or
            last.get('measuredEightHourCompletion') is not None or last.get('runtimeExpiryEvidence') is not None): fail('Only an actual successful manual-stop tail may be sealed.')
        if any(row.get('event') not in {'started', 'sample', 'stopped'} for row in rows) or sum(row.get('event') == 'stopped' for row in rows) != 1:
            fail('Unexpected failed/duplicate terminal event.')
        values.append(last.get('after', {}))
    elif any(row.get('event') not in {'started', 'sample'} for row in rows): fail('An already stopped or failed monitor cannot be signalled.')
    for value in values:
        metrics = value.get('metrics', {}); points = metrics.get('checkpoints', [])
        if (value.get('legacyUnits') != epoch['legacyUnits'] or value.get('activeSelector') != [] or any(c.counters(value['proxies']).values()) or
            metrics.get('runtime', {}).get('buildId') != c.NATIVE or len(points) != 4 or {row.get('chain') for row in points} != {1, 56, 137, 8453} or
            any(not isinstance(row.get(k), str) or re.fullmatch(r'[0-9]{75}', row[k]) is None for row in points for k in ['safe', 'latest', 'finalized'])):
            fail('Actual retained source/checkpoint/legacy/zero-counter monitor differs.')
    return rows[-1]


def read_monitor(c, review, *, terminal):
    raw = trusted(LONG2 / 'monitor.jsonl')
    rows = [json.loads(line) for line in raw.splitlines()]
    last = validate_monitor(c, review, rows, terminal=terminal)
    return raw, rows, last


def prepare(r, c, v, p, review):
    record = c.history(); old_plan = record['binding']['plan']; helper = p.load_epoch(old_plan['epochHelper'])
    p.validate_plan(old_plan, helper)
    ctx, _, artifact, _, _, _ = p.historical_prerequisite(old_plan, helper)
    if r.package(c, v, p, helper, ctx, artifact, old_plan) != {**review['binding']['source5Package'], 'inventory': c.pinned_json(c.INVENTORY, c.INVENTORY_SHA)}:
        fail('Original source5 package/release changed.')
    if str(ctx.workspace) != review['binding']['retainedWorkspace'] or ctx.old.SCHEMA != review['binding']['retainedSchema']:
        fail('Retained actor workspace/schema changed.')
    return helper, ctx, record, None


def snapshot(r, c, v, p, review, prepared, own):
    _, ctx, _, _ = prepared
    sample = {'freeBytes': __import__('shutil').disk_usage(ctx.candidate.SOURCE).free, 'metrics': ctx.old.source_metrics(),
        'legacyUnits': ctx.old.service_states(ctx.old.LEGACY_UNITS), 'activeSelector': ctx.old.active_selector(),
        'proxies': ctx.old.proxy_observation(), 'policy': ctx.cont.free_policy_snapshot(ctx.old, ctx.env, ctx.profile)}
    r.validate_running(c, v, p, review['binding']['plan'], prepared, review, sample, own, INVOCATIONS[NATIVE], 0)
    return sample


def typed_empty_controller_property(name):
    expected = {'EnvironmentFiles': 'a(sb)', 'Environment': 'as'}
    if name not in expected: fail('Only two fixed empty controller properties may be queried.')
    args = ['/usr/bin/busctl', '--json=short']
    value = json.loads(command([*args, 'call', 'org.freedesktop.systemd1', '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager', 'GetUnit', 's', CONTROLLER]))
    if (not isinstance(value, dict) or set(value) != {'type', 'data'} or value['type'] != 'o' or not isinstance(value['data'], list) or len(value['data']) != 1 or
        not isinstance(value['data'][0], str) or re.fullmatch(r'/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+', value['data'][0]) is None):
        fail('Actual fixed controller D-Bus object required.')
    result = json.loads(command([*args, 'get-property', 'org.freedesktop.systemd1', value['data'][0], 'org.freedesktop.systemd1.Service', name]))
    if result != {'type': expected[name], 'data': []}: fail('Typed empty controller property required; missing is never assumed empty.')


def controller_properties(v):
    raw = command(['/usr/bin/systemctl', 'show', '--all', CONTROLLER, *['--property=' + key for key in v.STATE_KEYS]])
    props, repeated = {}, {'EnvironmentFiles': [], 'Environment': []}
    for line in raw.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in v.STATE_KEYS: fail('Unexpected fixed controller properties.')
        if key in repeated: repeated[key].append(value)
        elif key in props: fail('Duplicate fixed controller property.')
        else: props[key] = value
    for key, values in repeated.items():
        if not values: typed_empty_controller_property(key)
        props[key] = ' '.join(values)
    props['EnvironmentFilesEntries'] = repeated['EnvironmentFiles']
    if any(key not in props for key in v.STATE_KEYS): fail('Complete fixed controller properties required.')
    return props


def controller_binding(v, value):
    # The frozen generic proxy reader requires EnvironmentFiles even when the
    # host omits that empty complex property. This local reader proves emptiness
    # by typed D-Bus observation and preserves repeated selectors/assignments.
    props = controller_properties(v)
    expected = ['/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8', 'TZ=UTC', '/usr/bin/python3',
        str(OPS / 'persistent-source5-resume.py'), '--plan', str(OPS / 'persistent-source5-resume.plan.json'), '--apply', REVIEW_HASH]
    if (props['InvocationID'] != INVOCATIONS[CONTROLLER] or props['MainPID'] != value['MainPID'] or props['ActiveState'] != value['ActiveState'] or props['SubState'] != value['SubState'] or props['User'] not in {'', 'root'} or props['Group'] not in {'', 'root'} or
        props['WorkingDirectory'] != str(OPS) or props['Environment'] != '' or any(x for x in props['EnvironmentFilesEntries']) or
        re.findall(r'argv\[\]=(.*?)\s+;', props['ExecStart']) != [' '.join(expected)] or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', props['ExecStart']) != ['/usr/bin/env'] or
        value['Description'] != 'Yunipals bounded source5 retained-state controller ' + REVIEW_HASH): fail('Exact original controller command/settings required.')
    return {'definitions': v.definitions(props), 'privateSettings': v.private_settings(props),
        'execArgv': expected, 'workingDirectory': str(OPS), 'startMonotonicMicroseconds': value['ExecMainStartTimestampMonotonic'],
        'process': process_identity(int(value['MainPID'])) if int(value['MainPID']) > 1 else None}


def proxy_states(c, v, binding):
    result = {}
    for chain, name in c.CHAINS.items():
        props = v.state('yunipals-market-production-rpc@' + name + '.service')
        row = {'invocation': props['InvocationID'], 'definitions': v.definitions(props), 'privateSettings': v.private_settings(props),
               'environmentFileHashes': c.environment_hashes(v, props)}
        summary = next(row for row in binding['liveEpoch']['proxies']['proofs'] if row['chainId'] == int(chain))
        if (row['invocation'] != summary['invocation'] or sha(encoded(row['definitions'])) != summary['definitionsSha256'] or
            sha(encoded(row['privateSettings'])) != summary['privateSettingsSha256']): fail('Original source5 proxy lineage changed.')
        result[chain] = row
    return result


def review(r, c, v, p):
    if any(path.exists() or path.is_symlink() for path in (PROJECTION, WITNESS)): fail('Never overwrite/adopt a prior stop receipt.')
    raw = trusted(LONG2 / 'review.json', 2_000_000); saved = json.loads(raw); binding = validate_binding(c, saved)
    plan_raw = trusted(OPS / 'persistent-source5-resume.plan.json', 16000)
    if json.loads(plan_raw) != binding['plan']: fail('Original launch plan changed.')
    controller, native = unit_state(CONTROLLER), unit_state(NATIVE)
    active(controller); active(native)
    controller_proof = controller_binding(v, controller)
    monitor, rows, _ = read_monitor(c, saved, terminal=False)
    prepared = prepare(r, c, v, p, saved)
    sample = snapshot(r, c, v, p, saved, prepared, native)
    proxies = proxy_states(c, v, binding)
    native_resources = p.actual_resources(binding['plan'], prepared[1], INVOCATIONS[NATIVE], REVIEW_HASH)
    if unit_state(CONTROLLER) != controller or process_identity(controller_proof['process']['pid']) != controller_proof['process']:
        fail('Controller changed during read-only review.')
    stable = {'format': FORMAT, 'helperSha256': sha(trusted(Path(__file__).absolute())), 'resumeSha256': RESUME_SHA,
        'commonSha256': COMMON_SHA, 'reviewSha256': sha(raw), 'launchPlanSha256': sha(plan_raw), 'controller': controller,
        'controllerProof': controller_proof, 'nativeInvocation': INVOCATIONS[NATIVE], 'nativeStart': native['ExecMainStartTimestampMonotonic'],
        'nativeResourcePropertiesSha256': native_resources['resourcePropertiesSha256'], 'proxyStates': proxies,
        'liveEpochSha256': sha(encoded(binding['liveEpoch'])), 'sourceDigest': c.ACTOR, 'nativeBuild': c.NATIVE,
        'retainedWorkspace': binding['retainedWorkspace'], 'retainedSchema': binding['retainedSchema'], 'originalCacheBytes': 531472384,
        'signal': 'one_pidfd_SIGTERM_to_exact_controller', 'temporaryGcReferences': [CONTROLLER, NATIVE], 'diagnosis': DIAGNOSIS,
        'automaticRetryAllowed': False, 'forceKillAllowed': False, 'sourceOrCacheReset': False, 'paidAuthorityChanged': False}
    return {'reviewHash': sha(encoded(stable)), 'binding': stable, 'observation': {'monitorSha256': sha(monitor), 'monitorBytes': len(monitor),
        'samples': len(rows) - 1, 'runtimeSha256': sha(encoded(sample['metrics']['runtime'])), 'checkpointsSha256': sha(encoded(sample['metrics']['checkpoints']))}}, (saved, prepared)


class UnitReferences:
    """One owned system-bus connection; only two GC references, no job control."""
    def __init__(self):
        self.lib = ctypes.CDLL('libsystemd.so.0'); self.bus = ctypes.c_void_p(); self.held = []
        self.lib.sd_bus_open_system.argtypes = [ctypes.POINTER(ctypes.c_void_p)]; self.lib.sd_bus_open_system.restype = ctypes.c_int
        self.lib.sd_bus_set_method_call_timeout.argtypes = [ctypes.c_void_p, ctypes.c_uint64]; self.lib.sd_bus_set_method_call_timeout.restype = ctypes.c_int
        self.lib.sd_bus_call_method.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p]
        self.lib.sd_bus_call_method.restype = ctypes.c_int
        self.lib.sd_bus_close.argtypes = [ctypes.c_void_p]; self.lib.sd_bus_close.restype = None
        self.lib.sd_bus_unref.argtypes = [ctypes.c_void_p]; self.lib.sd_bus_unref.restype = ctypes.c_void_p
    def call(self, method, unit):
        if method not in {'RefUnit', 'UnrefUnit'} or unit not in INVOCATIONS: fail('No arbitrary D-Bus mutation allowed.')
        result = self.lib.sd_bus_call_method(self.bus, b'org.freedesktop.systemd1', b'/org/freedesktop/systemd1', b'org.freedesktop.systemd1.Manager',
            method.encode(), None, None, b's', ctypes.c_char_p(unit.encode()))
        if result < 0: fail('Bounded typed unit-reference call failed.')
    def __enter__(self):
        try:
            if self.lib.sd_bus_open_system(ctypes.byref(self.bus)) < 0 or self.lib.sd_bus_set_method_call_timeout(self.bus, 3000000) < 0:
                fail('Bounded system-bus reference connection unavailable.')
            for unit in (CONTROLLER, NATIVE): self.call('RefUnit', unit); self.held.append(unit)
            return self
        except BaseException:
            self.__exit__(None, None, None); raise
    def __exit__(self, *_):
        try:
            for unit in reversed(self.held):
                try: self.call('UnrefUnit', unit)
                except Exception: pass  # Closing the same connection drops its references.
        finally:
            if self.bus:
                self.lib.sd_bus_close(self.bus)
                self.lib.sd_bus_unref(self.bus)


def save(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out: out.write(encoded(value)); out.flush(); os.fsync(out.fileno())


def signal_controller(identity, recheck):
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'): fail('Exact kernel pidfd signalling required; no PID/name fallback.')
    descriptor = os.pidfd_open(identity['pid'], 0)
    try:
        if process_identity(identity['pid']) != identity or recheck() != identity: fail('Controller PID/start fence changed before signal.')
        poll = select.poll(); poll.register(descriptor, select.POLLIN)
        if poll.poll(0): fail('Controller exited before the single graceful signal.')
        signal.pidfd_send_signal(descriptor, signal.SIGTERM, None, 0)
        if not poll.poll(75000): fail('Controller graceful cleanup deadline exceeded; no force kill/retry.')
    finally: os.close(descriptor)


@contextmanager
def lock(path, *, create):
    descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW | (os.O_CREAT if create else 0), 0o600)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022: fail('Owned protected stop/source lease required.')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally: os.close(descriptor)


def apply(r, c, v, p, expected):
    with lock(LOCK, create=True), UnitReferences():
        checked, retained = review(r, c, v, p)
        if checked['reviewHash'] != expected: fail('Fresh exact stop review required; no signal sent.')
        BASE.mkdir(mode=0o700, exist_ok=True)
        if BASE.is_symlink() or BASE.stat().st_uid != 0 or BASE.stat().st_mode & 0o077: fail('Protected private stop attempt root required.')
        directory = BASE / expected; directory.mkdir(mode=0o700)
        save(directory / 'review.json', checked); save(directory / 'signal-intent.json', {'controller': checked['binding']['controllerProof']['process'], 'singleSignal': 'SIGTERM', 'automaticRetryAllowed': False})
        result = {'format': FORMAT, 'reviewHash': expected, 'sealed': False, 'signalOutcome': 'unconfirmed_requires_manual_reconcile'}
        try:
            identity = checked['binding']['controllerProof']['process']
            def recheck():
                value = unit_state(CONTROLLER); active(value)
                current = controller_binding(v, value)
                if current != checked['binding']['controllerProof'] or value != checked['binding']['controller']: fail('Controller identity/settings changed before signal.')
                return current['process']
            signal_controller(identity, recheck); result['signalOutcome'] = 'single_pidfd_SIGTERM_sent_controller_exited'
            controller, native = terminal_states()
            final_controller = controller_binding(v, controller)
            if {k: value for k, value in final_controller.items() if k != 'process'} != {k: value for k, value in checked['binding']['controllerProof'].items() if k != 'process'}:
                fail('Controller definitions/private settings changed during graceful cleanup.')
            saved, prepared = retained
            raw, _, last = read_monitor(c, saved, terminal=True)
            if any(last['ownedTerminalState'].get(k) != native[k] for k in STOP_KEYS if k != 'MainPID'): fail('Actual native terminal state differs from completed monitor.')
            with lock(SOURCE_LOCK, create=False):
                sample = snapshot(r, c, v, p, saved, prepared, native)
                for key in ('runtime', 'checkpoints'):
                    if sample['metrics'][key] != last['after']['metrics'][key]: fail('Retained physical state differs from actual completed long2 tail.')
                proxies = proxy_states(c, v, saved['binding'])
                if proxies != checked['binding']['proxyStates'] or sample['legacyUnits'] != last['after']['legacyUnits'] or any(c.counters(sample['proxies']).values()): fail('Source/proxy/legacy evidence changed during stop.')
                if sha(trusted(LONG2 / 'review.json', 2_000_000)) != checked['binding']['reviewSha256']:
                    fail('Original saved long2 review changed during stop.')
                terminal = {'format': 'yunipals-long2-source6-terminal-v1', 'monitorSha256': sha(raw),
                    'native': {k: native[k] for k in STOP_KEYS}, 'controller': {k: controller[k] for k in STOP_KEYS}}
                save(WITNESS, terminal)  # Actual loaded states saved before releasing D-Bus refs.
                projection = {'format': 'yunipals-long2-source6-stopped-v1', 'reviewSha256': checked['binding']['reviewSha256'], 'monitorSha256': sha(raw),
                    'terminalWitnessFile': str(WITNESS), 'terminalWitnessSha256': sha(encoded(terminal)), 'nativeUnit': NATIVE, 'nativeInvocation': INVOCATIONS[NATIVE],
                    'controllerUnit': CONTROLLER, 'controllerInvocation': INVOCATIONS[CONTROLLER], 'runtimeSha256': sha(encoded(sample['metrics']['runtime'])),
                    'checkpointsSha256': sha(encoded(sample['metrics']['checkpoints'])), 'retainedWorkspace': saved['binding']['retainedWorkspace'],
                    'sourceDigest': c.ACTOR, 'nativeBuild': c.NATIVE, 'originalCacheBytes': 531472384, 'proxyStates': proxies, 'diagnosis': DIAGNOSIS}
                save(PROJECTION, projection)
                result.update(sealed=True, stopProofSha256=sha(encoded(projection)), terminalWitnessSha256=sha(encoded(terminal)), monitorSha256=sha(raw),
                    sourceLeaseAcquiredAfterExit=True, savedReviewUnchanged=True, monitorRetainedWithActualStopAppend=True, sourceOrCacheReset=False, paidAuthorityChanged=False)
        except BaseException as error:
            result['errorClass'] = type(error).__name__
            raise
        finally: save(directory / 'result.json', result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply'); args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main': fail('Exact root/host required.')
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError())); signal.alarm(900)
    try:
        r, c, v, p = modules()
        if args.apply:
            if not re.fullmatch(r'[0-9a-f]{64}', args.apply): fail('Exact review hash required.')
            result = apply(r, c, v, p, args.apply)
            print(json.dumps({k: result[k] for k in ('format', 'reviewHash', 'sealed', 'stopProofSha256', 'terminalWitnessSha256', 'monitorSha256', 'sourceLeaseAcquiredAfterExit', 'sourceOrCacheReset', 'paidAuthorityChanged')}))
        else:
            checked, _ = review(r, c, v, p)
            print(json.dumps({'format': FORMAT, 'reviewHash': checked['reviewHash'], 'signalSent': False, 'proofWritten': False,
                'controllerInvocation': INVOCATIONS[CONTROLLER], 'nativeInvocation': INVOCATIONS[NATIVE], 'automaticRetryAllowed': False}))
    finally: signal.alarm(0)


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        if isinstance(error, SystemExit) and error.code == 0: raise
        print(json.dumps({'completed': False, 'errorClass': type(error).__name__, 'rawDiagnosticsExported': False})); raise SystemExit(1)
