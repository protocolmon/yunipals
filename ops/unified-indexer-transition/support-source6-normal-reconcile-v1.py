#!/usr/bin/env python3
"""Finish the exact dormant support installation after its empty-array display failure."""
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
import stat
import subprocess
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PARENT_SHA = '2feb11d08ab5e7d034e4b7b55591758227668ff3be8faec9c4a710f88873a9ae'
FILES = {'failed.json': 'dd2c46ef2879399abcba07c7323edd33129a7fba366b3453e5bcb28268dbbd01',
         'intent.json': 'ccf55593528ab9f8c61bcf8c0d4a6a900142cdea9d619ff27a18bcceb9d7c7ab',
         'unit.json': '8060c8d6aa765eb634d7d88e244a3733934ff381c8a6fce7689b442ba668db91'}
FORMAT = 'yunipals-source6-normal-support-reconcile-v1'
BUS_PATH = '/org/freedesktop/systemd1/unit/yunipals_2dunified_2dsupport_2dsource6_2dv2_2eservice'


def fail(code): raise RuntimeError(code)


def parent():
    path = OPS / 'support-source6-normal-worker-v1.py'
    for item in [*path.parents, path]:
        s = item.lstat()
        if s.st_uid != 0 or stat.S_ISLNK(s.st_mode) or s.st_mode & 0o022:
            fail('protected_parent_required')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != PARENT_SHA:
        fail('exact_failed_parent_required')
    old = types.ModuleType('frozen_support'); old.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), old.__dict__)
    # systemctl's printer omits the empty array even with --all. Use the exact
    # service D-Bus property, whose type and length were observed on this host.
    old.manager = lambda keys: manager(old, keys)
    return old


def manager(old, keys):
    printed = tuple(key for key in keys if key != 'EnvironmentFiles')
    cp = subprocess.run(['/usr/bin/systemctl', 'show', old.UNIT, *['--property=' + key for key in printed]],
                        capture_output=True, timeout=10, env=old.CLEAN)
    rows = [line.partition('=') for line in cp.stdout.decode().splitlines()]
    if cp.returncode or cp.stderr or len(rows) != len(printed) or {row[0] for row in rows} != set(printed) or any(not row[1] for row in rows):
        fail('exact_printed_support_properties_required')
    value = {key: data for key, _, data in rows}
    if 'EnvironmentFiles' in keys:
        raw = old.call(['/usr/bin/busctl', 'get-property', 'org.freedesktop.systemd1', BUS_PATH,
                        'org.freedesktop.systemd1.Service', 'EnvironmentFiles']).strip()
        if raw != 'a(sb) 0': fail('exact_empty_effective_environment_files_required')
        value['EnvironmentFiles'] = ''
    return value


def saved(old, p):
    values = {}
    for name, pin in FILES.items():
        raw = p.trusted(old.BASE / name)
        if p.sha(raw) != pin: fail('exact_failed_installation_receipts_required')
        values[name] = json.loads(raw)
    failure = values['failed.json']
    if failure != {'automaticRetryAllowed': False, 'phase': 'install', 'runtimeAndSourceCutoffRemainEnforced': True, 'startMayHaveCompleted': False}:
        fail('only_never_started_install_failure_supported')
    for name in ('result.json', 'reconcile-intent.json', 'reconcile-result.json', 'reconcile-failed.json'):
        if os.path.lexists(old.BASE / name): fail('single_explicit_reconciliation_only')
    intent, unit = values['intent.json'], values['unit.json']
    if intent['automaticRetryAllowed'] is not False or p.sha(p.encoded(intent['binding'])) != intent['reviewSha256']:
        fail('exact_original_review_required')
    return intent, unit


def inspect(old, d):
    p, runtime, support, proxy, installer, m = d
    intent, unit = saved(old, p)
    binding = intent['binding']
    installed = installer.installed(m, old.INSTALL_SHA)
    if installed['files'].get('dist/unified-support.mjs') != old.ENTRY_SHA or binding['operatorSha256'] != PARENT_SHA:
        fail('original_corrected_artifact_required')
    seconds = unit['maximumRuntimeSeconds']
    raw = old.unit_text(p, installer, m, seconds)
    if unit['text'].encode() != raw or unit['sha256'] != p.sha(raw): fail('unchanged_installed_unit_required')
    state = old.live_definition(p, installer, m, raw, seconds, False)
    if state['InvocationID'] or state['ExecMainStartTimestampMonotonic'] != '0':
        fail('never_started_support_identity_required')
    for path in Path('/proc').glob('[0-9]*/status'):
        try: text = path.read_text()
        except FileNotFoundError: continue
        match = re.search(r'^Uid:\s+(\d+)', text, re.M)
        if match and match[1] == '969': fail('support_identity_in_use')
    account, group = pwd.getpwnam(p.ROLE), grp.getgrnam(p.ROLE)
    if (account.pw_uid != 969 or account.pw_gid != 963 or group.gr_gid != 963 or account.pw_shell != '/usr/sbin/nologin'
            or sorted(set(os.getgrouplist(p.ROLE, account.pw_gid))) != [963]): fail('exact_support_account_required')
    rights = json.loads(support.sql("BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; " + support.privilege_query() + '; ROLLBACK;'))
    plan = {'runtimeReceiptFile': str(p.RUNTIME_RECEIPT), 'runtimeReceiptSha256': old.RUNTIME_SHA}
    actual = p.runtime_state(runtime, plan)
    if (rights != support.desired_privileges() or rights != binding['privileges'] or p.controls(support) != binding['controls']
            or actual != binding['ordinary'] or p.proxy_state(proxy, actual, sorted(p.CHAINS)) != binding['proxies']
            or json.loads(p.trusted(p.RUNTIME_RECEIPT))['clock'] != old.SOURCE_CLOCK): fail('original_source_authority_changed')
    runner = p.trusted(OPS / 'support-probe-runner-v5.mjs')
    if p.sha(runner) != p.RUNNER_SHA: fail('exact_readonly_peer_inspector_required')
    observed = p.run_peer(account, runner, {'chains': sorted(p.CHAINS), 'task': 'worker', 'profileId': p.PROFILE,
                          'queueLimit': 8, 'receiptLimit': 2, 'maxRpcCalls': 8, 'maxSeconds': 60, 'maxResponseBytes': 2097152}, 'inspect')
    value = observed['result']
    if (observed['returnCode'] or value.get('writes') is not False or value.get('rpcCalls') != 0 or value.get('releaseId') != p.RELEASE
            or value.get('before', {}).get('running') is not True): fail('fresh_restricted_readonly_source_proof_required')
    if old.live_definition(p, installer, m, raw, seconds, False) != state or p.runtime_state(runtime, plan) != actual:
        fail('source_or_dormant_unit_changed_during_review')
    headroom(old, seconds)
    result = {'format': FORMAT, 'operatorSha256': p.sha(p.trusted(Path(__file__).absolute())), 'parentOperatorSha256': PARENT_SHA,
              'originalReceipts': FILES, 'originalReviewSha256': intent['reviewSha256'], 'unitSha256': unit['sha256'],
              'unit': state, 'maximumRuntimeSeconds': seconds, 'runtimeReceiptSha256': old.RUNTIME_SHA,
              'installReceiptSha256': old.INSTALL_SHA, 'clock': old.SOURCE_CLOCK, 'freeOnly': True, 'sourceChanged': False}
    return result, raw, seconds, binding


def headroom(old, seconds):
    if old.clock_now() + (seconds + old.START_RESERVE + old.STOP_RESERVE) * 1000000 > old.SOURCE_CLOCK['originalRuntimeExpiresMonotonicMicroseconds']:
        fail('original_installed_runtime_no_longer_fits_source_cutoff')


def apply(old, d, expected):
    p, runtime, support, proxy, installer, m = d
    with runtime.modules().c.source_lease():
        review, raw, seconds, binding = inspect(old, d)
        if p.sha(p.encoded(review)) != expected: fail('fresh_explicit_reconciliation_review_required')
        p.save(old.BASE / 'reconcile-intent.json', {'reviewSha256': expected, 'binding': review, 'automaticRetryAllowed': False})
        phase = 'pre-start'
        try:
            headroom(old, seconds)
            old.live_definition(p, installer, m, raw, seconds, False)
            phase = 'start'
            old.call(['/usr/bin/systemctl', 'start', old.UNIT], timeout=35)
            actual = old.live_definition(p, installer, m, raw, seconds, True)
            phase = 'acknowledge'
            plan = {'runtimeReceiptFile': str(p.RUNTIME_RECEIPT), 'runtimeReceiptSha256': old.RUNTIME_SHA}
            if p.runtime_state(runtime, plan) != binding['ordinary'] or p.controls(support) != binding['controls']:
                fail('source_changed_during_reconciled_start')
            result = {'format': FORMAT, 'started': True, 'reviewSha256': expected, 'originalReceipts': FILES,
                      'runtimeReceiptSha256': old.RUNTIME_SHA, 'installReceiptSha256': old.INSTALL_SHA,
                      'unitSha256': p.sha(raw), 'unit': actual, 'maximumRuntimeSeconds': seconds, 'clock': old.SOURCE_CLOCK,
                      'paidAuthority': False, 'sourceRestarted': False, 'sourceSelectionChanged': False,
                      'unitBytesChanged': False, 'automaticRestart': False}
            p.save(old.BASE / 'reconcile-result.json', result)
            return result
        except BaseException:
            p.save(old.BASE / 'reconcile-failed.json', {'phase': phase, 'startMayHaveCompleted': phase in ('start', 'acknowledge'), 'automaticRetryAllowed': False})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--apply'); args = parser.parse_args()
    old = parent(); old.require_e0(); os.umask(0o077); d = old.dependencies(); p = d[0]
    fd = os.open(p.LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as lock:
        s = os.fstat(lock.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o077: fail('protected_support_lease_required')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.apply:
            if not re.fullmatch('[a-f0-9]{64}', args.apply): fail('exact_review_hash_required')
            result = apply(old, d, args.apply)
            print(json.dumps({'format': FORMAT, 'started': True, 'unit': old.UNIT, 'invocation': result['unit']['InvocationID'],
                              'receiptFile': str(old.BASE / 'reconcile-result.json'), 'receiptSha256': p.sha(p.trusted(old.BASE / 'reconcile-result.json'))}))
        else:
            review, _, _, _ = inspect(old, d)
            print(json.dumps({'format': FORMAT, 'started': False, 'reviewSha256': p.sha(p.encoded(review)), 'binding': review, 'providerCalls': 0, 'databaseWrites': 0}))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: fail('support_reconciliation_deadline')); signal.alarm(180)
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'support_reconciliation_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code, 'automaticRetryAllowed': False})); raise SystemExit(1)
    finally: signal.alarm(0)
