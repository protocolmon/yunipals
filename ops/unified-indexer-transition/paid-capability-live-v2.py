#!/usr/bin/env python3
"""Exact first paid capability lease, owned timers and cache-safe cleanup.

Default review stores protected evidence only. Explicit reviewed installation and
controller admission are separate. No productive backfill or renewal is exposed.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE = Path('/var/backups/yunipals-paid-capability-live-v1-20261021')
SYSTEMD = Path('/etc/systemd/system')
EPOCH_BASE = Path('/var/backups/yunipals-source6-paid-epoch-v1-20261021')
FORMAT = 'yunipals-paid-capability-live-v2'
EPOCH_SHA = 'eedd6c9a569ce1a805eab4e3b8d8b01674185474e4caab8cd3a293183685815f'
COMPONENT_SHA = 'dd6cd7afe0347e03bcf6bf649a00170c686e487d28c09bcd2ecfed594445f08f'
PLANNER_SHA = 'c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef'
APPROVAL_SHA = 'e9db28160564f82fc403bae760df6882cae7e02664aecfad42d8dd5c11341dc6'
APPROVAL_FILE = OPS / 'alchemy-backfill-allowance-proposal-2026-10-21.json'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
APPROVAL = {'explicitUserApproval': True, 'additionalCu': 20_000_000, 'maximumSeconds': 28800,
    'automaticRenewal': False, 'accountUpgradeAllowed': False}
GATES = {'oldLong2StoppedAndSealed', 'newPackageVerified', 'nativeAndRetainedWorkspaceUnchanged',
    'exclusiveUnifiedSourceWriters', 'noOtherActivePaidPermits', 'ownedDeadlineCleanupPrepared', 'ownedUtcCleanupPrepared', 'newEpochCachesSealed'}


def fail(label): raise RuntimeError(label)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def is_sha(value): return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None
def now(): return datetime.now(timezone.utc)
def stamp(value): return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def protected(path, maximum=2_000_000):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts: fail('protected_absolute_input_required')
    for item in [*path.parents, path]:
        s = item.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022: fail('protected_input_ancestry_changed')
    a = path.stat()
    if not stat.S_ISREG(a.st_mode) or a.st_size > maximum: fail('bounded_regular_input_required')
    raw = path.read_bytes(); b = path.stat()
    if (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) != (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns): fail('input_changed_while_reading')
    return raw


def load(path, expected, name):
    raw = protected(path, 300_000)
    if not is_sha(expected) or sha(raw) != expected: fail('pinned_helper_changed')
    module = types.ModuleType(name); module.__file__ = str(path); sys.modules[name] = module
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def modules():
    epoch = load(OPS / 'source6-paid-epoch-v1.py', EPOCH_SHA, 'live_paid_epoch')
    component = load(OPS / 'paid-capability-controller-v1.py', COMPONENT_SHA, 'live_paid_component')
    model = load(OPS / 'paid-backfill-policy-plan-v2.py', PLANNER_SHA, 'live_paid_model')
    if component.PLANNER_SHA != PLANNER_SHA or epoch.PLANNER_SHA != PLANNER_SHA: fail('model_identity_changed')
    return epoch, component, model


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    for item in [BASE, *[p for p in path.parents if p.is_relative_to(BASE)], path]:
        s = item.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700: fail('private_evidence_directory_required')


def epoch_evidence_root():
    # This root is named in ReadWritePaths before systemd constructs a service
    # namespace. Never let a missing/symlink/writable directory fail after paid
    # admission, and never change an already existing object's mode or owner.
    if not os.path.lexists(EPOCH_BASE):
        os.mkdir(EPOCH_BASE, 0o700)
    value = EPOCH_BASE.lstat()
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or stat.S_IMODE(value.st_mode) != 0o700:
        fail('exact_private_epoch_evidence_root_required')


def save(path, value):
    raw = encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out: out.write(raw); out.flush(); os.fsync(out.fileno())
    sync_directory(Path(path).parent)
    return sha(raw)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def assert_no_unit_environment(epoch, unit):
    for key, signature in [('EnvironmentFiles', 'a(sb)'), ('Environment', 'as')]:
        if epoch.bus_property(unit, 'org.freedesktop.systemd1.Service', key, signature) != []:
            fail('controller_and_cleanup_environment_forbidden')


def run(args, *, data=None, timeout=10, cap=300_000):
    result = subprocess.run(args, input=data, text=True, capture_output=True, env=ENV, timeout=timeout)
    if result.returncode or len(result.stdout.encode()) > cap: fail('bounded_command_failed_private_diagnostics_withheld')
    return result.stdout.strip()


def peer(sql, *, write=False):
    user, group = pwd.getpwnam('postgres'), grp.getgrnam('postgres')
    if user.pw_uid <= 0 or user.pw_gid <= 0 or user.pw_gid != group.gr_gid: fail('exact_nonroot_postgres_peer_required')
    options = '-c statement_timeout=5000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=7000 -c application_name=yunipals_paid_capability_live_v1'
    options += ' -c default_transaction_read_only=' + ('off' if write else 'on')
    command = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
        '/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8', 'TZ=UTC', 'PGHOST=/var/run/postgresql',
        'PGPORT=15438', 'PGUSER=postgres', 'PGDATABASE=yunipals_market_production', 'PGPASSFILE=/dev/null', 'PGOPTIONS=' + options,
        '/usr/bin/psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1']
    # A pidfd stop targets the controller, not an orphaned psql. Reap/terminate
    # this exact child session on interruption before releasing financial locks.
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=ENV, text=True, start_new_session=True)
    try:
        output, _ = process.communicate(sql, timeout=12)
        if process.returncode or len(output.encode()) > 300_000: fail('bounded_peer_command_failed_private_diagnostics_withheld')
        return output.strip()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try: process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=3)
        for stream in [process.stdin, process.stdout, process.stderr]:
            if stream is not None: stream.close()


def snapshot(epoch, model, *, day=None):
    date = "(clock_timestamp() AT TIME ZONE 'UTC')::date" if day is None else model.literal(day) + '::date'
    text = """SELECT jsonb_build_object(
      'identity',jsonb_build_object('session',session_user,'current',current_user,'database',current_database(),'port',current_setting('port'),'local',inet_client_addr() IS NULL),
      'global',(SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled) FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea'),
      'allocations',(SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text)ORDER BY workload)FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea'),
      'grants',jsonb_build_object('day',DAY::text,'global',COALESCE((SELECT granted_cu::text FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start=DAY),'0'),
        'background',COALESCE((SELECT background_granted_cu::text FROM yunipals_market.rpc_compute_window WHERE scope='yunipals-opensea'AND window_start=DAY),'0'),
        'workloads',(SELECT jsonb_object_agg(a.workload,COALESCE(w.granted_cu,0)::text)FROM yunipals_market.rpc_compute_allocation a LEFT JOIN yunipals_market.rpc_compute_workload_window w ON w.scope=a.scope AND w.workload=a.workload AND w.window_start=DAY WHERE a.scope='yunipals-opensea')),
      'profile',(SELECT jsonb_build_object('enabled',p.enabled,'expires',p.expires_at,'policy',p.policy,'coordinatorId',c.coordinator_id::text,'coordinatorEnabled',c.enabled)FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope)WHERE p.profile_id=PROFILE AND p.scope='yunipals-opensea'))""".replace('DAY', date).replace('PROFILE', model.literal(model.PROFILE))
    value = json.loads(peer('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path=pg_catalog;\n' + text + ';\nROLLBACK;'))
    if set(value) != {'identity', 'global', 'allocations', 'grants', 'profile'} or value['identity'] != {'session': 'postgres', 'current': 'postgres', 'database': 'yunipals_market_production', 'port': '15438', 'local': True}: fail('market_peer_identity_changed')
    profile = value.pop('profile'); value.pop('identity')
    if profile['enabled'] is not True or profile['coordinatorEnabled'] is not True or profile['coordinatorId'] != 'faf1bb8c-4306-4c43-b55e-6ac5fa038567': fail('profile_or_coordinator_changed')
    free, n, c, v, _ = epoch.modules()
    if profile['policy'] != json.loads(c.trusted(v.PROFILE)) or v.digest(v.PROFILE) != v.PROFILE_SHA: fail('exact_profile_policy_changed')
    value.update(scope='yunipals-opensea', profileId=model.PROFILE, profileExpiresAt=model.text_time(model.moment(profile['expires'].replace('+00:00', 'Z'))))
    _, _, allocations = model.policy(value); model.grants(value, allocations)
    return value


def row_identity(model, plan, rows, *, disabled=False):
    expected = model.qualification_permits(plan)
    if not isinstance(rows, list) or len(rows) != 2: fail('both_owned_permit_rows_required')
    for original in expected:
        found = [r for r in rows if r.get('permitId') == original['permitId']]
        if len(found) != 1: fail('owned_permit_identity_changed')
        actual = found[0]
        if (set(actual) != set(original) | {'profileId', 'enabled', 'spentCu'} or actual['profileId'] != model.PROFILE or
            any(actual[k] != value for k, value in original.items() if k != 'expires') or
            model.moment(actual['expires'].replace('+00:00', 'Z')) != model.moment(original['expires']) or
            type(actual['enabled']) is not bool or (disabled and actual['enabled'] is not False) or model.cu(actual['spentCu']) > 180): fail('owned_permit_identity_changed')


class Journal:
    def __init__(self, directory): self.directory = directory
    def emit(self, phase, **value):
        path = self.directory / 'journal.jsonl'
        record = {'phase': phase, 'at': stamp(now()), **value}
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'ab') as out:
            info = os.fstat(out.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600: fail('protected_append_only_journal_required')
            out.write(encoded(record) + b'\n'); out.flush(); os.fsync(out.fileno())
        sync_directory(self.directory)
    def rows(self):
        path = self.directory / 'journal.jsonl'
        if not path.exists(): return []
        raw = protected(path, 1_000_000); values = [json.loads(r) for r in raw.splitlines()]
        if len(values) > 1000: fail('journal_bound_exceeded')
        return values
    def latest(self, phase): return next((r for r in reversed(self.rows()) if r['phase'] == phase), None)


def record_callback(journal):
    def callback(path, expected):
        raw = protected(path, 1_000_000)
        if sha(raw) != expected: fail('owned_epoch_phase_checksum_changed')
        sync_directory(Path(path).parent)
        journal.emit('epoch_record', path=str(path), sha256=expected)
    return callback


def run_paths(run_id):
    if not isinstance(run_id, str) or not re.fullmatch('20261021-[a-z0-9-]{1,30}', run_id): fail('fixed_run_id_required')
    return BASE / run_id, OPS / ('source6-paid-' + run_id + '.plan.json'), OPS / ('paid-capability-' + run_id + '.live.json')


def timer_definitions(model, plan, run_id):
    stamp_id = model.digest(plan)[:16]; result = []
    for kind, due in [('deadline', plan['qualificationExpiresAt']), ('utc', plan['nextUtc'])]:
        prefix = 'yunipals-paid-capability-' + kind + '-' + stamp_id; timer, service = prefix + '.timer', prefix + '.service'
        calendar = model.moment(due).strftime('%Y-%m-%d %H:%M:%S.%f UTC')
        timer_text = '[Unit]\nDescription=Yunipals exact owned ' + kind + ' cleanup ' + model.digest(plan) + '\n[Timer]\nOnCalendar=' + calendar + '\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit=' + service + '\n[Install]\nWantedBy=timers.target\n'
        argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-capability-live-v1.py') + ' --run-id ' + run_id + ' --admission-sha256 ' + model.digest(plan) + ' --phase ' + kind
        service_text = '[Unit]\nDescription=Yunipals exact owned ' + kind + ' executor ' + model.digest(plan) + '\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + service_properties()
        result.append({'kind': kind, 'timerUnit': timer, 'serviceUnit': service, 'dueUtc': due, 'timerText': timer_text, 'serviceText': service_text, 'argv': argv,
            'definitions': {str(SYSTEMD / timer): sha(timer_text.encode()), str(SYSTEMD / service): sha(service_text.encode())}})
    return result


def service_properties():
    return ('Restart=no\nUMask=0077\nRuntimeMaxSec=900\nTimeoutStopSec=60\nKillMode=control-group\nNoNewPrivileges=yes\n'
        'AmbientCapabilities=CAP_SETUID CAP_SETGID CAP_KILL\nCapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_KILL\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\n'
        'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=127.0.0.0/8 ::1\nMemoryMax=536870912\nMemorySwapMax=0\nCPUQuota=50%\nTasksMax=64\n'
        'ReadWritePaths=' + str(BASE) + ' ' + str(OPS) + ' /etc/systemd/system /run/lock ' + str(EPOCH_BASE) + '\n')


def service_definition(run_id, admission_sha, phase, marker=None):
    run_paths(run_id)
    if not is_sha(admission_sha) or phase not in {'preflight', 'controller'}: fail('exact_owned_service_definition_required')
    if phase == 'controller' and not is_sha(marker): fail('exact_controller_review_required')
    unit = controller_unit(run_id) if phase == 'controller' else 'yunipals-paid-capability-preflight-' + run_id + '.service'
    description = ('Yunipals bounded paid capability ' if phase == 'controller' else 'Yunipals paid capability sandbox preflight ') + admission_sha
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-capability-live-v1.py') + ' --run-id ' + run_id + ' --admission-sha256 ' + admission_sha + ' --phase ' + phase
    if phase == 'controller': argv += ' --apply ' + marker
    text = '[Unit]\nDescription=' + description + '\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory=' + str(OPS) + '\nExecStart=' + argv + '\n' + service_properties()
    return {'unit': unit, 'definition': text, 'definitionSha256': sha(text.encode())}


def approval():
    raw = protected(APPROVAL_FILE)
    if sha(raw) != APPROVAL_SHA: fail('explicit_one_time_approval_receipt_changed')
    value = json.loads(raw)
    if value.get('approval', {}).get('answer') != 'Approve the one-time allowance' or value.get('modeledAdditionalCuCeiling') != 20_000_000 or value.get('maximumRunSeconds') != 28800 or value.get('automaticRenewal') is not False: fail('explicit_one_time_approval_required')
    return APPROVAL


def prepare(epoch, component, model, spec):
    if set(spec) != {'format', 'runId', 'start', 'stopProofSha256', 'falseProofs'} or spec['format'] != 'yunipals-paid-capability-spec-v1': fail('exact_public_spec_required')
    directory, session_file, live_file = run_paths(spec['runId'])
    free, n, c, v, _ = epoch.modules()
    with c.source_lease():
        n.stop_proof(c, v, spec['stopProofSha256']); source = epoch.source_gate()
        for chain, row in spec['falseProofs'].items():
            if chain not in {'56', '8453'}: fail('only_two_capability_chains')
            result = free.validate_applied(row['directory'], row['expectedBeforeInvocation'])
            if result['resultSha256'] != row['resultSha256'] or result['reviewSha256'] != row['reviewSha256']: fail('exact_false_proof_required')
        if set(spec['falseProofs']) != {'56', '8453'}: fail('both_false_proofs_required')
        current = snapshot(epoch, model)
        if epoch.query("SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()", market=True) != 0: fail('no_active_paid_permit_required')
        # Future timer/cache gates below describe this prepared plan only. Actual
        # controller admission proves them via Session/timer/empty-RAM receipts.
        current.update(gates={key: True for key in GATES}, oldLong2Invocation=model.LONG2,
            oldLong2TerminalProofSha256=spec['stopProofSha256'], newPackageEvidenceSha256=n.EVIDENCE_SHA)
        plan = model.admission(current, spec['start'], approval())
        component.calls_for(plan)
        body = {'format': FORMAT, 'spec': spec, 'snapshot': current, 'admission': plan, 'sourcePeer': source,
            'epochHelperSha256': EPOCH_SHA, 'componentSha256': COMPONENT_SHA, 'plannerSha256': PLANNER_SHA,
            'operatorSha256': sha(protected(Path(__file__).absolute(), 300_000)), 'approvalSha256': APPROVAL_SHA,
            'timers': timer_definitions(model, plan, spec['runId']), 'controllerUnit': 'yunipals-paid-capability-' + spec['runId'] + '.service',
            'sessionPlanFile': str(session_file), 'liveFile': str(live_file), 'productiveExpansionAllowed': False}
        if model.moment(plan['qualificationExpiresAt']) <= now() or now() < model.moment(plan['start']): fail('current_original_qualification_window_required')
        return body


def load_live(model, run_id, admission_sha):
    directory, _, path = run_paths(run_id); value = json.loads(protected(path, 500_000))
    if value.get('format') != FORMAT or value.get('reviewHash') != sha(encoded(value.get('review'))) or model.digest(value['review']['admission']) != admission_sha or value['review']['spec']['runId'] != run_id: fail('exact_installed_live_plan_required')
    if value['review']['operatorSha256'] != sha(protected(Path(__file__).absolute(), 300_000)): fail('live_operator_changed')
    return value, directory


def install(epoch, component, model, review, expected):
    if sha(encoded(review)) != expected: fail('exact_install_review_required')
    run_id = review['spec']['runId']; directory, session_file, live_file = run_paths(run_id)
    free, n, c, v, _ = epoch.modules()
    with c.source_lease():
        if live_file.exists() or session_file.exists(): fail('fresh_live_plan_required')
        n.stop_proof(c, v, review['spec']['stopProofSha256'])
        if epoch.source_gate() != review['sourcePeer']: fail('source_identity_changed_before_timer_install')
        fresh = snapshot(epoch, model); verify_original(model, review, fresh)
        if (model.moment(review['admission']['qualificationExpiresAt']) - now()).total_seconds() < 360: fail('insufficient_setup_and_probe_window')
        private_directory(directory); journal = Journal(directory)
        save(directory / 'review.json', review); journal.emit('install_intent', reviewHash=expected)
        epoch_evidence_root()
        for row in review['timers']:
            for path in row['definitions']:
                if os.path.lexists(path): fail('fresh_timer_definitions_required')
            if os.path.lexists(SYSTEMD / 'timers.target.wants' / row['timerUnit']): fail('fresh_owned_timer_enablement_required')
        for row in review['timers']:
            for key, suffix in [('timerText', row['timerUnit']), ('serviceText', row['serviceUnit'])]:
                path = SYSTEMD / suffix
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
                with os.fdopen(fd, 'wb') as out: os.fchmod(out.fileno(), 0o644); out.write(row[key].encode()); out.flush(); os.fsync(out.fileno())
        sync_directory(SYSTEMD)
        run(['/usr/bin/systemctl', 'daemon-reload'])
        for row in review['timers']: run(['/usr/bin/systemctl', 'enable', '--now', row['timerUnit']], timeout=15)
        wants = SYSTEMD / 'timers.target.wants'
        for row in review['timers']:
            link = wants / row['timerUnit']; info = link.lstat()
            if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or link.resolve(strict=True) != SYSTEMD / row['timerUnit']:
                fail('exact_owned_persistent_timer_enablement_required')
        sync_directory(wants); sync_directory(SYSTEMD)
        timer_rows = []
        for row in review['timers']:
            raw = run(['/usr/bin/systemctl', 'show', '--all', row['serviceUnit'], '--property=ExecStart'])
            if not raw.startswith('ExecStart=') or '\n' in raw: fail('exact_timer_executor_property_required')
            timer_rows.append({key: row[key] for key in ['kind', 'timerUnit', 'serviceUnit', 'dueUtc', 'definitions']} | {'serviceExecStartSha256': sha(raw.split('=', 1)[1].encode())})
        timer_receipt = {'format': 'yunipals-paid-capability-owned-timers-v1', 'admissionPlanSha256': model.digest(review['admission']),
            'executorFile': str(OPS / 'paid-capability-live-v1.py'), 'executorSha256': review['operatorSha256'], 'timers': timer_rows}
        timer_file = OPS / ('source6-paid-' + run_id + '.timers.json'); timer_sha = save(timer_file, timer_receipt)
        session_plan = {'format': epoch.PLAN_FORMAT, 'runId': run_id, 'admission': review['admission'], 'stopProofSha256': review['spec']['stopProofSha256'],
            'falseProofs': review['spec']['falseProofs'], 'timerReceiptFile': str(timer_file), 'timerReceiptSha256': timer_sha}
        epoch.verify_timers(c, model, session_plan)
        session_sha = save(session_file, session_plan)
        value = {'format': FORMAT, 'reviewHash': expected, 'review': review, 'sessionPlanSha256': session_sha, 'timerReceiptSha256': timer_sha}
        live_sha = save(live_file, value); journal.emit('timers_installed', livePlanSha256=live_sha, timerReceiptSha256=timer_sha)
        return {'installed': True, 'reviewHash': expected, 'runId': run_id, 'admissionSha256': model.digest(review['admission']), 'livePlanSha256': live_sha,
            'timersArmedBeforeAdmission': True, 'paidDispatches': 0, 'budgetOrPermitsApplied': False,
            'sandboxPreflightService': service_definition(run_id, model.digest(review['admission']), 'preflight')}


def verify_original(model, review, current):
    saved = review['snapshot']
    if any(current[k] != saved[k] for k in ['scope', 'profileId', 'profileExpiresAt', 'global', 'allocations']): fail('original_policy_changed')
    if current['grants']['day'] != saved['grants']['day'] or current['grants']['workloads']['unified_source'] != saved['grants']['workloads']['unified_source']: fail('source_baseline_changed')
    if any(model.cu(current['grants'][k]) < model.cu(saved['grants'][k]) for k in ['global', 'background']): fail('grant_counters_regressed')


@contextmanager
def mutex(path, *, seconds=0):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600: fail('exact_owned_mutex_required')
        end = time.monotonic() + seconds
        while True:
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); break
            except BlockingIOError:
                if time.monotonic() >= end: fail('owned_mutex_busy')
                time.sleep(0.1)
        yield
    finally: os.close(fd)


def execute_model(model, phase, plan, current, journal, *, state=None, at=None):
    previous = journal.latest('sql_intent_' + phase)
    if previous is not None: fail('sql_phase_already_attempted_reconcile_without_retry')
    text = model.owner_sql(phase, plan, current, state, at)
    if len(text.encode()) > 100_000: fail('bounded_exact_model_sql_required')
    sql_sha = save(journal.directory / ('owner-' + phase + '.sql.json'), {'sql': text, 'sha256': sha(text.encode())})
    journal.emit('sql_intent_' + phase, sqlSha256=sha(text.encode()), sqlFileSha256=sql_sha, planSha256=model.digest(plan))
    try:
        raw = peer(text, write=True)
        lines = [json.loads(line) for line in raw.splitlines() if line.strip()]
        if lines != [{'preparedPlanSha256': model.digest(plan), 'phase': phase, 'applied': True, 'grantCountersReset': False}]: fail('sql_commit_receipt_mismatch')
    except BaseException:
        journal.emit('sql_ambiguous_' + phase, automaticRetryAllowed=False, manualReconcileRequired=True)
        raise
    journal.emit('sql_ack_' + phase, receipt=lines[0])
    return lines[0]


def revoke(epoch, model, plan, journal, run_id):
    """Exact revocation is allowed before source/chain locks, never arbitrary rows."""
    with mutex(journal.directory / 'financial.lock', seconds=12):
        path = OPS / ('source6-paid-' + run_id + '.revoked.json')
        owned = epoch.permit_snapshot(model, plan)
        if path.exists():
            raw = protected(path, 50_000); value = json.loads(raw)
            epoch.validate_revoked(model, plan, value, owned)
            return path, sha(raw)
        if journal.latest('sql_ambiguous_revoke') is not None: fail('ambiguous_revocation_requires_manual_receipt')
        if owned['owned'] == []:
            if journal.latest('sql_ack_admission') is not None or owned['active'] != 0: fail('owned_admission_rows_missing')
            outcome = 'not_admitted_confirmed'
        else:
            row_identity(model, plan, owned['owned'])
            ack = journal.latest('sql_ack_revoke')
            if ack is None:
                execute_model(model, 'revoke', plan, {}, journal)
            elif ack['receipt'] != {'preparedPlanSha256': model.digest(plan), 'phase': 'revoke', 'applied': True, 'grantCountersReset': False}:
                fail('owned_revocation_ack_changed')
            owned = epoch.permit_snapshot(model, plan)
            row_identity(model, plan, owned['owned'], disabled=True)
            outcome = 'commit_confirmed'
        value = {'format': 'yunipals-paid-capability-revocation-v1', 'admissionPlanSha256': model.digest(plan),
            'transactionOutcome': outcome, 'permitIds': [r['permitId'] for r in model.qualification_permits(plan)]}
        epoch.validate_revoked(model, plan, value, owned)
        expected = save(path, value); journal.emit('revoked', receiptFile=str(path), receiptSha256=expected, transactionOutcome=outcome)
        return path, expected


def controller_unit(run_id): return 'yunipals-paid-capability-' + run_id + '.service'


def process_identity(pid, unit):
    if type(pid) is not int or pid <= 1: fail('owned_controller_pid_required')
    root = Path('/proc') / str(pid); raw = (root / 'stat').read_text(); tail = raw[raw.rfind(')') + 2:].split()
    if len(tail) < 20 or not tail[19].isdigit(): fail('controller_start_unavailable')
    if (root / 'cgroup').read_text().splitlines() != ['0::/system.slice/' + unit]: fail('controller_cgroup_changed')
    status = dict(line.split(':', 1) for line in (root / 'status').read_text().splitlines() if ':' in line)
    if status.get('Uid', '').split() != ['0'] * 4 or status.get('Gid', '').split() != ['0'] * 4: fail('root_controller_identity_required')
    return {'pid': pid, 'startTicks': int(tail[19]), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()}


def unit_properties(unit):
    keys = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID', 'User', 'Group', 'ExecStart', 'Description',
        'NoNewPrivileges', 'AmbientCapabilities', 'CapabilityBoundingSet', 'Restart', 'WorkingDirectory', 'Type']
    raw = run(['/usr/bin/systemctl', 'show', '--all', unit, *['--property=' + k for k in keys]], timeout=5)
    result = {}
    for line in raw.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key not in keys or key in result: fail('exact_owned_unit_properties_required')
        result[key] = value
    if set(result) != set(keys): fail('complete_owned_unit_identity_required')
    return result


def actual_root_capabilities():
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if any(int(status.get(k, '-1').strip(), 16) != 0xe0 for k in ['CapEff', 'CapPrm', 'CapAmb']):
        fail('actual_exact_root_identity_and_signal_capabilities_required')


def static_controller_properties(value):
    # ExecStart also contains mutable PID/start/exit/status serialization.
    # Preserve only its actual executable/argv selection in the static proof.
    result = {k: v for k, v in value.items() if k not in {'Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID', 'ExecStart'}}
    result['execSelection'] = {'paths': re.findall(r'(?:^|[ {;])path=([^ ;]+)', value['ExecStart']),
        'argv': re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']),
        'ignoreErrors': re.findall(r'(?:^|[ {;])ignore_errors=([^ ;]+)', value['ExecStart'])}
    if (result['execSelection']['paths'] != ['/usr/bin/python3'] or
        len(result['execSelection']['argv']) != 1 or result['execSelection']['ignoreErrors'] != ['no']):
        fail('exact_controller_exec_selection_required')
    return result


def controller_definition_proof(epoch, unit):
    fragment = epoch.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'FragmentPath', 's')
    drops = epoch.bus_property(unit, 'org.freedesktop.systemd1.Unit', 'DropInPaths', 'as')
    if fragment not in {str(SYSTEMD / unit), '/run/systemd/transient/' + unit} or drops != []:
        fail('exact_owned_controller_definition_required')
    return {'path': fragment, 'sha256': sha(protected(Path(fragment), 50_000)), 'dropInPaths': []}


def original_process_gone(expected, unit, *, proc_root=Path('/proc')):
    if (set(expected) != {'pid', 'startTicks', 'bootId'} or type(expected['pid']) is not int or expected['pid'] <= 1 or
        type(expected['startTicks']) is not int or expected['startTicks'] <= 0 or not isinstance(expected['bootId'], str) or
        not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', expected['bootId'])):
        fail('exact_original_controller_process_required')
    if (proc_root / 'sys/kernel/random/boot_id').read_text().strip() != expected['bootId']:
        fail('controller_boot_changed_manual_reconcile_required')
    try: raw = (proc_root / str(expected['pid']) / 'stat').read_text()
    except FileNotFoundError: return True
    end = raw.rfind(')'); fields = raw[end + 2:].split()
    if len(raw) > 65536 or not raw.startswith(str(expected['pid']) + ' (') or end < 0 or len(fields) < 20 or not fields[19].isdigit():
        fail('original_controller_process_stat_invalid')
    if int(fields[19]) != expected['startTicks']: return True
    # An extant original process in another cgroup or an unreadable /proc path
    # is never silently reclassified as gone. No signal is sent in this path.
    if process_identity(expected['pid'], unit) != expected: fail('original_controller_process_identity_changed')
    return False


def finished_controller(journal):
    ack = journal.latest('controller_finished')
    if ack is None: fail('stopped_controller_requires_actual_finished_ack')
    raw = protected(journal.directory / 'controller-result.json'); result = json.loads(raw)
    if (ack.get('outcomeSha256') != sha(raw) or result.get('format') != FORMAT or result.get('automaticRetryAllowed') is not False or
        type(result.get('cleaned')) is not bool or ack.get('cleaned') is not result['cleaned']):
        fail('stopped_controller_finished_receipt_mismatch')
    return result


def controller_identity(epoch, model, run_id, plan_sha, marker, *, self_required, preflight=False):
    unit = controller_unit(run_id) if not preflight else 'yunipals-paid-capability-preflight-' + run_id + '.service'
    value = unit_properties(unit)
    argv = '/usr/bin/python3 -B ' + str(OPS / 'paid-capability-live-v1.py') + ' --run-id ' + run_id + ' --admission-sha256 ' + plan_sha
    argv += ' --phase preflight' if preflight else ' --phase controller --apply ' + marker
    description = ('Yunipals paid capability sandbox preflight ' if preflight else 'Yunipals bounded paid capability ') + plan_sha
    if (value['Id'] != unit or value['LoadState'] != 'loaded' or value['ActiveState'] != 'active' or value['SubState'] != 'running' or
        not re.fullmatch('[a-f0-9]{32}', value['InvocationID']) or not value['MainPID'].isdigit() or int(value['MainPID']) <= 1 or
        value['User'] not in {'', 'root'} or value['Group'] not in {'', 'root'} or value['Restart'] != 'no' or
        value['WorkingDirectory'] != str(OPS) or value['Description'] != description or
        value['Type'] != 'exec' or value['NoNewPrivileges'] != 'yes' or
        set(value['AmbientCapabilities'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
        set(value['CapabilityBoundingSet'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
        re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) != [argv] or re.findall(r'(?:^|[ {;])path=([^ ;]+)', value['ExecStart']) != ['/usr/bin/python3']): fail('exact_owned_controller_unit_required')
    assert_no_unit_environment(epoch, unit)
    if self_required and int(value['MainPID']) != os.getpid(): fail('controller_must_be_actual_main_process')
    if self_required: actual_root_capabilities()
    return {'unit': unit, 'invocation': value['InvocationID'], 'propertiesSha256': sha(encoded(value)),
        'definition': controller_definition_proof(epoch, unit), 'staticPropertiesSha256': sha(encoded(static_controller_properties(value))),
        'process': process_identity(int(value['MainPID']), unit), 'applyHash': marker, 'admissionSha256': plan_sha}


def sandbox_preflight(epoch, model, value, directory):
    plan = value['review']['admission']; run_id = value['review']['spec']['runId']
    if now() >= model.moment(plan['qualificationExpiresAt']): fail('qualification_window_expired')
    identity = controller_identity(epoch, model, run_id, model.digest(plan), None, self_required=True, preflight=True)
    actual_root_capabilities()
    actual = json.loads(peer("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SELECT jsonb_build_object('session',session_user,'current',current_user,'database',current_database(),'port',current_setting('port'),'local',inet_client_addr() IS NULL); ROLLBACK;"))
    if actual != {'session': 'postgres', 'current': 'postgres', 'database': 'yunipals_market_production', 'port': '15438', 'local': True}: fail('actual_clean_peer_identity_required')
    user, group = pwd.getpwnam('postgres'), grp.getgrnam('postgres')
    if user.pw_uid <= 0 or user.pw_gid != group.gr_gid or group.gr_gid <= 0: fail('exact_nonroot_postgres_peer_required')
    code = "import json,os,pathlib,time; s=dict(l.split(':',1) for l in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in l); print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'caps':[int(s[k].strip(),16)for k in ['CapEff','CapPrm','CapAmb']]}),flush=True); time.sleep(30)"
    process = subprocess.Popen(['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(group.gr_gid), '--clear-groups',
        '/usr/bin/env', '-i', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', '/usr/bin/python3', '-I', '-S', '-c', code],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=ENV, start_new_session=True)
    try:
        if not select.select([process.stdout], [], [], 5)[0]: fail('bounded_child_identity_unavailable')
        raw = os.read(process.stdout.fileno(), 4096)
        if len(raw) > 1024 or not raw.endswith(b'\n') or raw.count(b'\n') != 1: fail('exact_child_identity_required')
        child = json.loads(raw)
        if child != {'uid': user.pw_uid, 'gid': group.gr_gid, 'groups': [], 'caps': [0, 0, 0]}: fail('child_capabilities_or_groups_retained')
        if process.poll() is not None: fail('live_owned_signal_target_required')
        os.killpg(process.pid, signal.SIGTERM)
        if process.wait(timeout=5) != -signal.SIGTERM: fail('actual_owned_child_signal_not_proven')
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=3)
        process.stdout.close()
    result = {'format': FORMAT, 'admissionSha256': model.digest(plan), 'livePlanSha256': sha(encoded(value)),
        'identity': identity, 'cleanPeerIdentityVerified': True, 'actualPostgresChildCapabilitiesZero': True,
        'actualOwnedPostgresChildSignalVerified': True, 'budgetOrPermitsApplied': False, 'paidDispatches': 0}
    digest = save(directory / 'sandbox-preflight.json', result)
    Journal(directory).emit('sandbox_preflight_passed', receiptSha256=digest)
    return {'preflightPassed': True, 'receiptSha256': digest, 'admissionSha256': model.digest(plan), 'paidDispatches': 0, 'budgetOrPermitsApplied': False}


def require_sandbox_preflight(model, value, journal):
    ack = journal.latest('sandbox_preflight_passed'); raw = protected(journal.directory / 'sandbox-preflight.json')
    result = json.loads(raw)
    if (ack is None or ack['receiptSha256'] != sha(raw) or result.get('format') != FORMAT or
        result.get('admissionSha256') != model.digest(value['review']['admission']) or result.get('livePlanSha256') != sha(encoded(value)) or
        any(result.get(k) is not True for k in ['cleanPeerIdentityVerified', 'actualPostgresChildCapabilitiesZero', 'actualOwnedPostgresChildSignalVerified']) or
        result.get('budgetOrPermitsApplied') is not False or result.get('paidDispatches') != 0): fail('actual_owned_sandbox_preflight_required')
    return sha(raw)


def timer_identity(epoch, model, run_id, admission, kind):
    row = next(r for r in timer_definitions(model, admission, run_id) if r['kind'] == kind)
    for path, expected in row['definitions'].items():
        if sha(protected(Path(path), 50_000)) != expected: fail('owned_timer_definition_changed')
    value = unit_properties(row['serviceUnit'])
    if (value['Id'] != row['serviceUnit'] or value['LoadState'] != 'loaded' or value['ActiveState'] != 'active' or value['SubState'] != 'running' or value['Type'] != 'exec' or
        not re.fullmatch('[a-f0-9]{32}', value['InvocationID']) or value['WorkingDirectory'] != str(OPS) or
        value['Description'] != 'Yunipals exact owned ' + kind + ' executor ' + model.digest(admission) or
        value['MainPID'] != str(os.getpid()) or value['User'] not in {'', 'root'} or value['Group'] not in {'', 'root'} or
        value['NoNewPrivileges'] != 'yes' or set(value['AmbientCapabilities'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or
        set(value['CapabilityBoundingSet'].split()) != {'cap_setuid', 'cap_setgid', 'cap_kill'} or value['Restart'] != 'no' or
        re.findall(r'argv\[\]=(.*?)\s+;', value['ExecStart']) != [row['argv']] or
        re.findall(r'(?:^|[ {;])path=([^ ;]+)', value['ExecStart']) != ['/usr/bin/python3']): fail('exact_owned_timer_main_process_required')
    assert_no_unit_environment(epoch, row['serviceUnit'])
    actual_root_capabilities()
    if now() < model.moment(row['dueUtc']): fail('owned_timer_fired_too_early')
    return row


def stop_controller(epoch, model, value, journal):
    receipt = journal.latest('controller_started')
    if receipt is None:
        if journal.latest('sql_intent_admission') is not None: fail('controller_receipt_missing_after_admission')
        return
    expected = receipt['identity']; run_id = value['review']['spec']['runId']
    # No generic PID/name kill. A GC'd old unit is admitted only after its own
    # protected identity plus current absence; any replacement refuses cleanup.
    raw = subprocess.run(['/usr/bin/systemctl', 'show', '--all', expected['unit'], '--property=Id', '--property=LoadState', '--property=InvocationID', '--property=MainPID', '--property=ActiveState'],
        env=ENV, text=True, capture_output=True, timeout=5)
    props = {}
    keys = {'Id', 'LoadState', 'InvocationID', 'MainPID', 'ActiveState'}
    for line in raw.stdout.splitlines():
        key, sep, prop_value = line.partition('=')
        if not sep or key not in keys or key in props: fail('exact_owned_controller_observation_required')
        props[key] = prop_value
    if set(props) != keys or props['Id'] != expected['unit'] or raw.returncode not in {0, 1, 3, 4}: fail('owned_controller_observation_failed')
    terminal = props['ActiveState'] in {'inactive', 'failed'} and props['MainPID'] == '0'
    if terminal and props['InvocationID'] in {'', expected['invocation']}:
        finished_controller(journal)
        if not original_process_gone(expected['process'], expected['unit']): fail('original_controller_still_exists')
        definition = expected['definition']
        if (set(definition) != {'path', 'sha256', 'dropInPaths'} or definition['dropInPaths'] != [] or
            definition['path'] not in {str(SYSTEMD / expected['unit']), '/run/systemd/transient/' + expected['unit']} or
            sha(protected(Path(definition['path']), 50_000)) != definition['sha256']): fail('saved_controller_definition_changed')
        if props['LoadState'] == 'not-found':
            if props['InvocationID'] != '' or props['ActiveState'] != 'inactive': fail('exact_GC_controller_required')
            # A deleted transient fragment is not a durable definition proof;
            # missing bytes above refuse automatic cleanup rather than adopt.
            return
        if props['LoadState'] != 'loaded': fail('known_stopped_controller_required')
        value = unit_properties(expected['unit'])
        if (any(value[k] != props[k] for k in keys) or
            sha(encoded(static_controller_properties(value))) != expected['staticPropertiesSha256'] or
            controller_definition_proof(epoch, expected['unit']) != definition): fail('stopped_controller_selector_or_definition_changed')
        assert_no_unit_environment(epoch, expected['unit'])
        return
    if props.get('InvocationID') != expected['invocation']: fail('replacement_controller_cannot_be_adopted')
    current = controller_identity(epoch, model, run_id, expected['admissionSha256'], expected['applyHash'], self_required=False)
    if current != expected or current['process']['pid'] == os.getpid(): fail('original_owned_controller_required_before_signal')
    pid = current['process']['pid']; fd = os.pidfd_open(pid, 0)
    try:
        if process_identity(pid, expected['unit']) != expected['process']: fail('controller_pid_reused')
        poll = select.poll(); poll.register(fd, select.POLLIN)
        if poll.poll(0): return
        signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0); journal.emit('deadline_controller_sigterm', invocation=expected['invocation'])
        if not poll.poll(360_000): fail('controller_cleanup_still_active_no_force_kill_or_lock_wait')
    finally: os.close(fd)


def guard_snapshot(epoch, component, model, session, binding):
    actual = session.validate_current(zero=False); current = snapshot(epoch, model)
    owned = epoch.permit_snapshot(model, session.plan['admission']); row_identity(model, session.plan['admission'], owned['owned'])
    if owned['active'] != 2: fail('only_both_owned_active_permits_required')
    rows = []
    for row in owned['owned']:
        item = dict(row); item['spentCu'] = int(model.cu(item['spentCu'])); item['expires'] = model.text_time(model.moment(item['expires'].replace('+00:00', 'Z'))); rows.append(item)
    _, _, _, v, _ = epoch.modules(); paid, refused, free, evidence_paid, evidence_refused = {}, {}, {}, {}, {}
    for name, (chain, port) in v.CHAINS.items():
        metrics = v.request(port, '/metrics'); traffic = metrics.get('unified', {}).get('traffic', {})
        evidence_paid[str(chain)] = traffic.get('unified_evidence', {}).get('paidCalls'); evidence_refused[str(chain)] = traffic.get('unified_evidence', {}).get('refused')
        if name in epoch.CHAINS:
            source = traffic.get('unified_source', {}); paid[str(chain)] = source.get('paidCalls'); refused[str(chain)] = source.get('refused'); free[str(chain)] = source.get('freeCalls')
    return {'sourceDigest': component.SOURCE, 'runtimeSha256': component.RUNTIME, 'nativeBuild': component.NATIVE, 'profileId': component.PROFILE,
        'profileExpiresAt': current['profileExpiresAt'], 'profileEnabled': True, 'coordinatorId': component.COORDINATOR, 'coordinatorEnabled': True,
        'proofRefs': binding.proof_refs, 'proxyInvocations': {key: row['invocation'] for key, row in actual['proxies'].items()},
        'sourceRouting': {key: row['sourceRouting'] for key, row in actual['proxies'].items()}, 'policy': {'globalDailyCu': current['global']['dailyCu'],
            'foregroundReserveCu': current['global']['foregroundReserveCu'], 'unifiedSourceDailyCu': next(r['dailyCu'] for r in current['allocations'] if r['workload'] == 'unified_source')},
        'otherAllocationsSha256': model.other_policy(model.policy(current)[2]), 'sourceGrantedCu': current['grants']['workloads']['unified_source'],
        'paidCalls': paid, 'sourceRefused': refused, 'sourceFreeCalls': free, 'evidencePaidCalls': evidence_paid, 'evidenceRefused': evidence_refused,
        'permitSpentCu': {str(r['chainId']): r['spentCu'] for r in rows}, 'permitRows': rows, 'activePermitIds': [r['permitId'] for r in rows if r['enabled']]}


def cleanup_locked(epoch, component, model, value, journal, session, *, only_caches=False):
    review = value['review']; plan = review['admission']; run_id = review['spec']['runId']
    revoked_file, revoked_sha = revoke(epoch, model, plan, journal, run_id)
    if session.record is None:
        latest = journal.latest('epoch_record')
        if latest is None:
            if journal.latest('sql_intent_admission') is not None: fail('acknowledged_epoch_record_required_after_admission')
            journal.emit('cleanup_no_epoch_no_admission'); return {'cleaned': True, 'neverEnabled': True}
        session.restore_record(Path(latest['path']), latest['sha256'])
    result = session.cleanup(revoked_file, revoked_sha)
    cache_sha = save(journal.directory / ('cache-cleanup-' + str(len(journal.rows())) + '.json'), result)
    journal.emit('owned_caches_destroyed', receiptSha256=cache_sha, result=result)
    if not all(result.get('proxies', {}).get(name, {}).get('ownedPaidProxyCacheDestroyed') is True for name in ['base', 'bnb']): fail('both_actual_paid_cache_destruction_receipts_required')
    if only_caches: return result
    with mutex(journal.directory / 'financial.lock', seconds=12):
        current = snapshot(epoch, model)
        if journal.latest('sql_ack_cleanup') is not None:
            receipt = acknowledged_cleanup(model, plan, journal)
            same_policy(model, current, receipt['policy'], plan['otherAllocationsSha256'])
            return result
        if journal.latest('sql_intent_cleanup') is not None: fail('ambiguous_cleanup_contained_manual_policy_reconcile_required')
        if journal.latest('sql_intent_admission') is not None and journal.latest('sql_ack_admission') is None: fail('ambiguous_admission_contained_manual_policy_reconcile_required')
        admitted = journal.latest('sql_ack_admission') is not None
        if not admitted:
            verify_original(model, review, current); journal.emit('never_admitted_policy_unchanged'); return result
        state = {'ownedPermitsRevoked': True, 'ownedSourceStopped': True, 'ownedPaidProxyCachesDestroyed': True, 'ownedSourceWritersUnchanged': True}
        if current['grants']['day'] != plan['grantDay']:
            old = snapshot(epoch, model, day=plan['grantDay'])
            prepared = component.cleanup_sql(plan, current, state, old_day_grants=old['grants'], at=model.text_time(now()))
            # The normal midnight path is handled by the separate exact UTC executor.
            save(journal.directory / 'boundary-recovery-prepared.json', prepared); fail('same_epoch_boundary_requires_utc_executor')
        prepared = component.cleanup_sql(plan, current, state)
        # Prepared evidence survives a crash immediately after COMMIT/ACK. It
        # never proves execution without the separate exact SQL ACK below.
        receipt_sha = save(journal.directory / 'current-day-cleanup.json', prepared['receipt'])
        journal.emit('current_day_cleanup_prepared', receiptSha256=receipt_sha)
        execute_model(model, 'cleanup', plan, current, journal, state=state)
        journal.emit('current_day_policy_restored', receiptSha256=receipt_sha, migrationBookedGrantsCu=prepared['receipt']['migrationBookedGrantsCu'])
        return result


def acknowledged_cleanup(model, plan, journal):
    prepared = journal.latest('current_day_cleanup_prepared'); ack = journal.latest('sql_ack_cleanup')
    raw = protected(journal.directory / 'current-day-cleanup.json')
    if (prepared is None or ack is None or prepared['receiptSha256'] != sha(raw) or
        ack['receipt'] != {'preparedPlanSha256': model.digest(plan), 'phase': 'cleanup', 'applied': True, 'grantCountersReset': False}):
        fail('acknowledged_owned_cleanup_receipt_required')
    return json.loads(raw)


def same_policy(model, current, expected, other_hash):
    daily, reserve, allocations = model.policy(current)
    if daily != model.cu(expected['globalDailyCu']) or reserve != 200000 or model.cu(allocations['unified_source']['dailyCu']) != model.cu(expected['unifiedSourceDailyCu']) or model.other_policy(allocations) != other_hash:
        fail('owned_policy_changed_manual_reconcile_required')


def session_plan(value): return Path(value['review']['sessionPlanFile']), value['sessionPlanSha256']


def review_controller(epoch, component, model, value, journal):
    review = value['review']; plan = review['admission']
    if any(journal.latest(phase) is not None for phase in ['controller_started', 'sql_intent_admission']): fail('controller_attempt_cannot_be_restarted_or_renewed')
    preflight_sha = require_sandbox_preflight(model, value, journal)
    current = snapshot(epoch, model); verify_original(model, review, current)
    path, expected = session_plan(value)
    with epoch.open_session(path, expected) as session:
        true_review = session.review()
    body = {'format': FORMAT, 'phase': 'controller_review', 'livePlanSha256': sha(encoded(value)),
        'admissionSha256': model.digest(plan), 'epochReview': true_review, 'epochReviewHash': sha(encoded(true_review)),
        'operatorSha256': review['operatorSha256'], 'controllerUnit': review['controllerUnit'],
        'sandboxPreflightSha256': preflight_sha,
        'maximumProbeCalls': 6, 'maximumDispatchCu': 360, 'maximumBookedCu': 2000, 'automaticRenewal': False}
    return body


def check_empty_caches(session):
    for name in session.plan['falseProofs']:
        alias = 'bnb' if name == '56' else 'base'; port = session.v.CHAINS[alias][1]
        metrics = session.v.request(port, '/metrics'); budget = metrics.get('workloadBudgets', {}).get('unified_source', {})
        if budget.get('workload') != 'unified_source' or budget.get('priority') != 'background' or any(type(budget.get(k)) is not int or budget[k] != 0 for k in ['grantedCu', 'usedCu', 'remainingCu']):
            fail('fresh_owned_unified_source_caches_required')


def controller(epoch, component, model, value, directory, expected):
    journal = Journal(directory); review = value['review']; plan = review['admission']; run_id = review['spec']['runId']
    prepared = review_controller(epoch, component, model, value, journal)
    if sha(encoded(prepared)) != expected: fail('fresh_exact_controller_review_required')
    identity = controller_identity(epoch, model, run_id, model.digest(plan), expected, self_required=True)
    save(directory / 'controller-identity.json', identity); journal.emit('controller_started', identity=identity, reviewHash=expected)
    path, session_sha = session_plan(value); outcome = {'format': FORMAT, 'qualified': False, 'cleaned': False, 'productiveExpansionAllowed': False}
    try:
        with epoch.open_session(path, session_sha, record_callback=record_callback(journal)) as session:
            try:
                true_review = session.review()
                if sha(encoded(true_review)) != prepared['epochReviewHash']: fail('true_epoch_review_changed_before_enable')
                enabled = session.enable(prepared['epochReviewHash']); check_empty_caches(session)
                epoch_record = journal.latest('epoch_record')
                if epoch_record is None or enabled.get('recordSha256') != epoch_record['sha256']: fail('durable_enabled_epoch_receipt_required')
                with mutex(directory / 'financial.lock', seconds=12):
                    verify_original(model, review, snapshot(epoch, model))
                    epoch.verify_timers(session.c, model, session.plan); session.validate_current(zero=True); check_empty_caches(session)
                    execute_model(model, 'admission', plan, review['snapshot'], journal)
                admitted = epoch.permit_snapshot(model, plan); row_identity(model, plan, admitted['owned'])
                refs = {'source6FreeFirst': sha(encoded(review['spec']['falseProofs'])), 'sealedLong2': review['spec']['stopProofSha256'],
                    'source6TrueEpoch': enabled['recordSha256'], 'exclusiveSourceLease': sha(encoded(identity)),
                    'emptyOwnedCoordinatorCaches': sha(encoded({'epoch': enabled['recordSha256'], 'empty': True})),
                    'deadlineCleanupTimer': value['timerReceiptSha256'], 'utcCleanupTimer': value['timerReceiptSha256'],
                    'admissionCommit': sha(encoded(journal.latest('sql_ack_admission')))}
                binding = component.ProbeBinding(plan, refs, {key: row['invocation'] for key, row in enabled['proxies'].items()})
                # A slow live guard cannot inherit an unbounded part of the
                # ninety-second call allowance. All its syscalls are bounded,
                # and the controller's own alarm also covers this entire probe.
                signal.setitimer(signal.ITIMER_REAL, 90)
                try:
                    probe = component.run_probe(binding, fresh_guard=lambda: guard_snapshot(epoch, component, model, session, binding),
                        transport=component.LoopbackTransport())
                finally: signal.setitimer(signal.ITIMER_REAL, 0)
                probe_sha = save(directory / 'probe-result.json', probe); journal.emit('probe_complete', receiptSha256=probe_sha, capabilityQualified=probe.get('capabilityQualified') is True)
                outcome.update(qualified=probe.get('capabilityQualified') is True, probeReceiptSha256=probe_sha, bookedMigrationCu=probe.get('bookedMigrationCu'))
            except BaseException as error:
                journal.emit('controller_work_failed', errorClass=type(error).__name__, automaticRetryAllowed=False)
                outcome['errorClass'] = type(error).__name__
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                try:
                    cleanup_locked(epoch, component, model, value, journal, session)
                    outcome['cleaned'] = True
                except BaseException as error:
                    journal.emit('controller_cleanup_failed', errorClass=type(error).__name__, manualReconcileRequired=True)
                    outcome['cleanupErrorClass'] = type(error).__name__
    except BaseException as error:
        # The independent timer still revokes and contains a source lease that
        # was never acquired or was interrupted before an acknowledged epoch.
        outcome['outerErrorClass'] = type(error).__name__; journal.emit('controller_outer_failed', errorClass=type(error).__name__)
    outcome.update(automaticRetryAllowed=False, consumerServingAllowed=False, actualAccountQualified=outcome['qualified'])
    save(directory / 'controller-result.json', outcome); journal.emit('controller_finished', outcomeSha256=sha(encoded(outcome)), cleaned=outcome['cleaned'])
    return outcome


def cleanup_executor(epoch, component, model, value, directory, kind):
    review = value['review']; plan = review['admission']; run_id = review['spec']['runId']; journal = Journal(directory)
    timer_identity(epoch, model, run_id, plan, kind)
    # Never wait on the source/chain lease while a controller owning it is
    # waiting on us. Financial authority is revoked before any signal or lease.
    revoke_error = None
    try: revoke(epoch, model, plan, journal, run_id)
    except BaseException as error:
        revoke_error = type(error).__name__; journal.emit('timer_revoke_failed', kind=kind, errorClass=revoke_error, manualReconcileRequired=True)
    stop_controller(epoch, model, value, journal)
    if revoke_error is not None: fail('revocation_unconfirmed_controller_stopped_manual_reconcile')
    with mutex(directory / 'cleanup.lock'):
        path, expected = session_plan(value)
        with epoch.open_session(path, expected, record_callback=record_callback(journal)) as session:
            cleaned = cleanup_locked(epoch, component, model, value, journal, session, only_caches=kind == 'utc')
            if kind == 'utc':
                with mutex(directory / 'financial.lock', seconds=12):
                    current = snapshot(epoch, model)
                    if journal.latest('sql_ack_utc') is not None:
                        same_policy(model, current, plan['originalPolicy'], plan['otherAllocationsSha256'])
                    elif journal.latest('sql_intent_utc') is not None:
                        fail('ambiguous_utc_policy_requires_manual_reconcile')
                    elif journal.latest('sql_intent_admission') is not None and journal.latest('sql_ack_admission') is None:
                        fail('ambiguous_admission_contained_manual_policy_reconcile_required')
                    elif journal.latest('sql_ack_admission') is None:
                        same_policy(model, current, plan['originalPolicy'], plan['otherAllocationsSha256']); journal.emit('utc_never_admitted_no_policy_write')
                    else:
                        state = {'ownedPermitsRevoked': True, 'ownedSourceStopped': True, 'ownedPaidProxyCachesDestroyed': True, 'ownedSourceWritersUnchanged': True}
                        receipt_file = directory / 'current-day-cleanup.json'
                        if journal.latest('sql_ack_cleanup') is not None:
                            receipt = acknowledged_cleanup(model, plan, journal); prepared = component.cleanup_sql(plan, current, state, at=model.text_time(now()), cleanup_receipt=receipt)
                            execute_model(model, 'utc', receipt, current, journal, state={k: state[k] for k in ['ownedPermitsRevoked', 'ownedSourceStopped', 'ownedPaidProxyCachesDestroyed']}, at=model.text_time(now()))
                        else:
                            if receipt_file.exists() or journal.latest('sql_intent_cleanup') is not None: fail('unacknowledged_cleanup_requires_manual_reconcile')
                            old = snapshot(epoch, model, day=plan['grantDay'])
                            _, receipt = model.boundary_recovery(plan, current, old['grants'], model.text_time(now()), state)
                            execute_model(model, 'utc', receipt, current, journal, state={k: state[k] for k in ['ownedPermitsRevoked', 'ownedSourceStopped', 'ownedPaidProxyCachesDestroyed']}, at=model.text_time(now()))
                        journal.emit('utc_original_policy_restored')
    result = {'format': FORMAT, 'kind': kind, 'cleaned': True, 'originalPolicyRestored': kind == 'utc', 'newPermits': False,
        'grantCountersReset': False, 'automaticRetryAllowed': False, 'paidDispatches': 0, 'productiveExpansionAllowed': False}
    filename = directory / ('timer-' + kind + '-result.json')
    if filename.exists(): fail('timer_result_already_retained_no_overwrite')
    save(filename, result); return result


def public_controller_review(epoch, component, model, value, directory):
    result = review_controller(epoch, component, model, value, Journal(directory))
    marker = sha(encoded(result))
    return {'reviewHash': marker, 'admissionSha256': result['admissionSha256'], 'controllerUnit': result['controllerUnit'],
        'controllerService': service_definition(value['review']['spec']['runId'], result['admissionSha256'], 'controller', marker),
        'sourceStarted': False, 'budgetOrPermitsApplied': False, 'maximumDispatchCu': 360, 'maximumBookedCu': 2000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec'); parser.add_argument('--run-id'); parser.add_argument('--admission-sha256')
    parser.add_argument('--phase', choices=['review', 'install', 'preflight', 'controller', 'deadline', 'utc'], default='review'); parser.add_argument('--apply')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main': fail('exact_production_root_host_required')
    os.umask(0o077); epoch, component, model = modules()
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    if args.phase == 'review' and args.spec:
        path = Path(args.spec)
        if path.parent != OPS or not re.fullmatch(r'paid-capability-20261021-[a-z0-9-]{1,30}\.spec\.json', path.name): fail('fixed_public_spec_path_required')
        review = prepare(epoch, component, model, json.loads(protected(path, 50_000))); marker = sha(encoded(review))
        directory, _, _ = run_paths(review['spec']['runId']); private_directory(directory / 'reviews')
        saved = directory / 'reviews' / (marker + '.json')
        if not saved.exists(): save(saved, review)
        elif protected(saved) != encoded(review): fail('retained_review_changed')
        result = {'format': FORMAT, 'reviewHash': marker, 'reviewFile': str(saved), 'admissionSha256': model.digest(review['admission']),
            'timersInstalled': False, 'budgetOrPermitsApplied': False, 'productiveExpansionAllowed': False}
    elif args.phase == 'install':
        if not args.run_id or not is_sha(args.apply): fail('exact_saved_install_review_required')
        directory, _, _ = run_paths(args.run_id); review = json.loads(protected(directory / 'reviews' / (args.apply + '.json'), 500_000))
        result = install(epoch, component, model, review, args.apply)
    else:
        if args.spec or not args.run_id or not is_sha(args.admission_sha256): fail('exact_installed_live_run_required')
        value, directory = load_live(model, args.run_id, args.admission_sha256)
        if args.phase == 'preflight':
            if args.apply: fail('preflight_is_exact_owned_unit_only')
            signal.setitimer(signal.ITIMER_REAL, 45)
            result = sandbox_preflight(epoch, model, value, directory)
        elif args.phase == 'controller':
            if args.apply:
                if not is_sha(args.apply): fail('exact_controller_review_hash_required')
                result = controller(epoch, component, model, value, directory, args.apply)
            else: result = public_controller_review(epoch, component, model, value, directory)
        elif args.phase in {'deadline', 'utc'}:
            if args.apply: fail('timer_execution_is_exact_owned_unit_only')
            result = cleanup_executor(epoch, component, model, value, directory, args.phase)
        else: fail('review_requires_spec')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except BaseException as error:
        if isinstance(error, SystemExit) and error.code == 0: raise
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__, 'privateDiagnosticsExported': False})); raise SystemExit(1)


