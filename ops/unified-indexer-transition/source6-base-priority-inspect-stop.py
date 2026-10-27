#!/usr/bin/env python3
"""Inspect the one bounded Base1 resume, or stop only its exact owned invocation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
RESUME_SHA = '5cc85866637259fbc18dc3c665bd5175d078d483bc544418b996a22a566496ae'
PREPARED_SHA = '7412f9fbff11daa40296c6e62049f6c547bfabc26796618fc58b49cdab00c6ef'
DEADLINE = 66121294848380
FORMAT = 'yunipals-source6-base-priority-inspect-stop'


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()


def modules():
    path = OPS / 'source6-base-priority-resume.py'; raw = path.read_bytes()
    if sha(raw) != RESUME_SHA: fail('frozen_gc_safe_resume_required')
    b = types.ModuleType('bounded_base_resume'); b.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), b.__dict__)
    s = b.module()
    if sha(s.protected(path)) != RESUME_SHA: fail('protected_gc_safe_resume_required')
    return b, s


def gone(identity):
    try:
        raw = Path('/proc', str(identity['pid']), 'stat').read_text()
        return int(raw.rpartition(')')[2].split()[19]) != identity['startTicks']
    except FileNotFoundError:
        return True


def stopped(p, identity, job, absent):
    if (p['MainPID'] != '0' or p['ActiveState'] not in {'inactive', 'failed'} or
            p['SubState'] not in {'dead', 'failed'} or job != 0 or not absent or
            p['InvocationID'] not in {'', identity['invocation']} or
            int(p['ExecMainStartTimestampMonotonic']) not in {0, identity['startMonotonicMicroseconds']}):
        fail('owned_source_stop_not_terminal')


def check_configuration(b, s, intent, p):
    expected = {'operatorSha256': RESUME_SHA, 'pauseReceiptSha256': b.PAUSE_SHA,
                'preparedReceiptSha256': PREPARED_SHA, 'rpcSha256': b.RPC_SHA,
                'originalDeadlineMonotonicMicroseconds': DEADLINE,
                'baseSourceConcurrency': 1, 'windowExtension': False,
                'freeOnly': True, 'paidAuthority': False, 'schema': s.SCHEMA, 'buildId': s.BUILD}
    if any(intent.get(k) != v for k, v in expected.items()): fail('actual_owned_bounded_resume_intent_required')
    seconds = intent.get('remainingRuntimeSeconds')
    if type(seconds) is not int or not 300 <= seconds <= 14400: fail('finite_owned_resume_window_required')
    raw = ('[Service]\nRuntimeMaxSec=' + str(seconds) + '\nBindReadOnlyPaths=\n' +
           '\n'.join(b.bindings(s)) + '\n').encode()
    command = s.argv(); command.insert(3, '--max-old-space-size=4096')
    if (sha(raw) != intent.get('dropSha256') or s.protected(b.drop_path(s)) != raw or
            sha(s.protected(s.ORIGINAL)) != s.UNIT_SHA or s.protected(s.DROP) != s.drop_bytes() or
            sha(s.protected(b.AREA / 'rpc-preflight.ts')) != b.RPC_SHA):
        fail('exact_owned_source_files_required')
    if (p['command'] != ' '.join(command) or p['DropInPaths'].split() != [str(s.DROP), str(b.drop_path(s))] or
            p['MemoryMax'] != '6442450944' or p['MemorySwapMax'] != '0' or p['Restart'] != 'no' or
            p['LimitCORE'] != '0' or b.runtime_limit(s) != seconds * 1000000):
        fail('exact_owned_bounded_source_configuration_required')


def inspect(b, s):
    path = b.BASE / 'resume-intent.json'; raw = s.protected(path); intent = json.loads(raw)
    p = s.unit(); check_configuration(b, s, intent, p)
    runtime_path = b.BASE / 'runtime.json'; runtime = None
    if runtime_path.exists():
        runtime = json.loads(s.protected(runtime_path))
        if (runtime.get('dropSha256') != intent['dropSha256'] or runtime.get('rpcSha256') != b.RPC_SHA or
                runtime.get('originalDeadlineMonotonicMicroseconds') != DEADLINE or runtime.get('windowExtension') is not False):
            fail('current_bounded_runtime_receipt_required')
    identity = s.process_identity(p) if p['ActiveState'] == 'active' and p['SubState'] == 'running' else None
    if identity:
        if (s.job() != 0 or identity['invocation'] in {'', '7f600db4a1d3453cb8a14305404c4c15', s.OLD_INVOCATION} or
                identity['startMonotonicMicroseconds'] < DEADLINE - (intent['remainingRuntimeSeconds'] + 16) * 1000000):
            fail('new_owned_resume_invocation_required')
        if runtime is not None and runtime.get('runtime') != identity: fail('current_owned_resume_invocation_required')
    return {'format': FORMAT, 'resumeIntentSha256': sha(raw), 'runtimeReceiptExists': runtime is not None,
            'runtimeReceiptSha256': sha(s.protected(runtime_path)) if runtime is not None else None,
            'state': {k: p[k] for k in ['ActiveState', 'SubState', 'MainPID', 'InvocationID', 'ExecMainStartTimestampMonotonic']},
            'runtime': identity, 'originalDeadlineMonotonicMicroseconds': DEADLINE,
            'dropSha256': intent['dropSha256'], 'baseSourceConcurrency': 1,
            'freeOnly': True, 'paidAuthority': False, 'serviceActions': 0,
            'operatorProviderCalls': 0, 'databaseWrites': 0, 'at': s.now()}


def stop(b, s, invocation, intent_sha):
    if not re.fullmatch('[0-9a-f]{32}', invocation) or not re.fullmatch('[0-9a-f]{64}', intent_sha):
        fail('exact_invocation_and_intent_checksum_required')
    with s.lease(s.SOURCE_LEASE):
        checked = inspect(b, s)
        if checked['resumeIntentSha256'] != intent_sha: fail('exact_owned_resume_intent_required')
        stop_intent = b.BASE / 'priority-stop-intent.json'
        previously_requested = stop_intent.exists()
        if previously_requested:
            saved = json.loads(s.protected(stop_intent))
            if saved['resumeIntentSha256'] != intent_sha or saved['runtime']['invocation'] != invocation:
                fail('exact_existing_owned_stop_required')
            identity = saved['runtime']
            stopped(s.unit(), identity, s.job(), gone(identity))
        else:
            identity = checked['runtime']
            if identity is None or identity['invocation'] != invocation: fail('only_exact_owned_invocation_may_be_stopped')
            s.save(stop_intent, {'resumeIntentSha256': intent_sha, 'runtime': identity, 'at': s.now()})
            s.run(['/usr/bin/systemctl', 'stop', s.UNIT], timeout=55)
            inspect(b, s)
            stopped(s.unit(), identity, s.job(), gone(identity))
        terminal = s.unit()
        value = {**checked, 'beforeState': checked['state'], 'beforeRuntime': checked['runtime'],
                 'state': {k: terminal[k] for k in checked['state']}, 'runtime': None,
                 'stopped': True, 'stoppedRuntime': identity, 'sourceRemainsStopped': True,
                 'serviceActions': 0 if previously_requested else 1,
                 'serviceActionsThisCall': 0 if previously_requested else 1,
                 'stopPreviouslyRequested': previously_requested,
                 'schemaCacheAndDefinitionsPreserved': True, 'automaticRestart': False, 'at': s.now()}
        receipt = b.BASE / 'priority-stopped.json'
        if not receipt.exists(): s.save(receipt, value)
        return value


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--stop'); parser.add_argument('--intent-sha')
    args = parser.parse_args(); signal.signal(signal.SIGALRM, lambda *_: fail('bounded_inspect_stop_expired')); signal.alarm(110)
    if os.geteuid() != 0 or os.uname().nodename != 'yunipals-main': fail('fixed_root_host_required')
    b, s = modules()
    if Path('/proc/sys/kernel/random/boot_id').read_text().strip() != s.BOOT: fail('same_source_boot_required')
    value = stop(b, s, args.stop, args.intent_sha or '') if args.stop else inspect(b, s)
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z_]+', str(error)) else 'private_diagnostics_withheld'
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': code, 'errorClass': type(error).__name__, 'automaticRetryAllowed': False})); raise SystemExit(1)
