#!/usr/bin/env python3
"""Run one credential-free receipt identity probe, retaining and cleaning its evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
RENDERER = OPS / 'source6-qualified-receipt-probe-v3.py'
RENDERER_SHA = 'f89ced9f929090bc1669daabeaab6c09e801da444b1034f0703c9d4f75d80080'
UNIT = 'yunipals-qualified-receipt-v3-identity-probe.service'
TARGET = Path('/run/systemd/system') / UNIT
BASE = Path('/var/backups/yunipals-qualified-receipt-v3-identity-probe-20261023')
SOURCE = 'yunipals-unified-source6-free-v2.service'
SUPPORT = 'yunipals-unified-support-source6-v2.service'
EXPECTED_SOURCE = ('716994', 'c3463c9a2e1240e8890e318ba1360cf4')
PROPS = 'LoadState,ActiveState,SubState,MainPID,InvocationID,NRestarts,FragmentPath,DropInPaths,Result,ExecMainCode,ExecMainStatus,ExecMainStartTimestampMonotonic'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def command(args, check=True):
    result = subprocess.run(args, capture_output=True, timeout=15)
    if check:
        require(result.returncode == 0, 'manager_command_failed_' + sha(result.stderr))
    return result.stdout


def state(unit):
    raw = command(['systemctl', 'show', unit, '--no-pager', '-p', PROPS])
    return dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)


def protected(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and
            info.st_nlink == 1 and not info.st_mode & 0o022, 'protected_public_input_required')
    return path.read_bytes()


def definition():
    raw = protected(RENDERER)
    require(sha(raw) == RENDERER_SHA, 'reviewed_renderer_required')
    module = types.ModuleType('receipt_v3_renderer')
    exec(compile(raw, str(RENDERER), 'exec'), module.__dict__)
    raw = module.render()
    forbidden = ('ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost', 'ExecCondition',
                 'OnFailure', 'OnSuccess', 'EnvironmentFile', 'LoadCredential', 'LoadCredentialEncrypted',
                 'SetCredential', 'SetCredentialEncrypted')
    require(not any(line.strip().split(b'=', 1)[0].decode() in forbidden
                    for line in raw.splitlines() if b'=' in line), 'definition_must_not_invoke_hooks_or_credentials')
    return raw


def write_new(path, raw, mode):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as handle:
        os.fchmod(handle.fileno(), mode)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
        info = os.fstat(handle.fileno())
        return {"device": info.st_dev, "inode": info.st_ino}


def save(name, value):
    write_new(BASE / name, (json.dumps(value, sort_keys=True) + '\n').encode(), 0o600)


def parents_safe(path):
    for parent in [*path.parents, path]:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and
                not info.st_mode & 0o022, 'protected_parent_required')


def review():
    require(os.geteuid() == 0, 'root_operator_required')
    parents_safe(OPS)
    parents_safe(TARGET.parent)
    parents_safe(BASE.parent)
    require(not os.path.lexists(BASE) and not os.path.lexists(TARGET) and
            not os.path.lexists(str(TARGET) + '.d'), 'fresh_probe_and_receipt_required')
    probe = state(UNIT)
    source, support = state(SOURCE), state(SUPPORT)
    require(probe['LoadState'] == 'not-found' and probe['MainPID'] == '0' and
            probe['ActiveState'] == 'inactive', 'absent_probe_required')
    require((source['MainPID'], source['InvocationID']) == EXPECTED_SOURCE and
            source['ActiveState'] == 'active' and source['NRestarts'] == '0', 'same_live_source_required')
    require(support['MainPID'] == '0' and support['ActiveState'] in {'inactive', 'failed'} and
            support['DropInPaths'] == '', 'retained_support_must_stay_stopped')
    value = {'format': 'yunipals-receipt-v3-hardened-probe-review-v2',
             'definitionSha256': sha(definition()), 'source': source, 'support': support,
             'operatorSha256': sha(protected(Path(__file__).absolute())),
             'rendererSha256': RENDERER_SHA, 'providerCalls': 0, 'databaseCalls': 0,
             'credentialReads': 0, 'maximumRuntimeSeconds': 30}
    return {**value, 'reviewHash': sha(json.dumps(value, sort_keys=True).encode())}


def owned_target():
    receipt = json.loads(protected(BASE / 'unit-created.json'))
    info = TARGET.lstat()
    require(receipt == {'device': info.st_dev, 'inode': info.st_ino}, 'owned_probe_inode_required')
    require(sha(protected(TARGET)) == json.loads(protected(BASE / 'before.json'))['definitionSha256'] and
            not os.path.lexists(str(TARGET) + '.d'), 'only_owned_probe_may_be_removed')


def loaded_definition():
    owned_target()
    current = state(UNIT)
    require(current['FragmentPath'] == str(TARGET) and current['DropInPaths'] == '',
            'owned_probe_manager_definition_required')
    return current


def cleanup():
    before = json.loads(protected(BASE / 'before.json'))
    if os.path.lexists(TARGET):
        current = loaded_definition()
        require(current['MainPID'] == '0' and current['ActiveState'] in {'inactive', 'failed'},
                'wait_for_owned_probe_terminal_before_cleanup')
        owned_target()
        TARGET.unlink()
        command(['systemctl', 'daemon-reload'])
        command(['systemctl', 'reset-failed', UNIT], check=False)
    require(state(UNIT)['LoadState'] == 'not-found' and not os.path.lexists(TARGET), 'probe_cleanup_required')
    source, support = state(SOURCE), state(SUPPORT)
    require(source == before['source'] and support == before['support'], 'source_and_support_must_be_unchanged')
    result = {'removed': True, 'sourceUnchanged': True, 'supportUnchanged': True,
              'sourceRestarted': False, 'workerStarted': False}
    if not (BASE / 'cleanup.json').exists():
        save('cleanup.json', result)
    return result


def apply(pin):
    before = review()
    require(before['reviewHash'] == pin, 'exact_fresh_review_required')
    raw = definition()
    BASE.mkdir(mode=0o700)
    save('before.json', before)
    intent = {'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip().replace('-', ''),
              'startRealtimeUs': time.time_ns() // 1000, 'automaticRetryAllowed': False}
    save('intent.json', intent)
    try:
        created = write_new(TARGET, raw, 0o644)
        save('unit-created.json', created)
        command(['systemctl', 'daemon-reload'])
        loaded_definition()
        # This is the only START. Lost acknowledgement is inspected, never retried.
        command(['systemctl', 'start', '--no-block', UNIT])
        deadline = time.monotonic() + 35
        found = []
        while time.monotonic() < deadline:
            current = state(UNIT)
            journal = command(['journalctl', '-u', UNIT, '--no-pager', '-o', 'json',
                               '--since', '@' + str(intent['startRealtimeUs'] // 1_000_000 - 1)])
            found = []
            manager_terminal = []
            for line in journal.splitlines():
                event = json.loads(line)
                if (event.get('_PID') == '1' and event.get('UNIT') == UNIT and
                        event.get('UNIT_RESULT') == 'success' and
                        event.get('_BOOT_ID') == intent['bootId'] and
                        int(event.get('__REALTIME_TIMESTAMP', '0')) >= intent['startRealtimeUs']):
                    manager_terminal.append(event)
                try:
                    value = json.loads(event.get('MESSAGE', ''))
                except (json.JSONDecodeError, TypeError):
                    continue
                if isinstance(value, dict) and value.get('format') == 'yunipals-qualified-receipt-v3-identity-probe-v1':
                    require(event['_BOOT_ID'] == intent['bootId'] and
                            int(event['__REALTIME_TIMESTAMP']) >= intent['startRealtimeUs'] and
                            len(event.get('_SYSTEMD_INVOCATION_ID', '')) == 32, 'exact_probe_journal_identity_required')
                    found.append({'result': value, 'invocation': event['_SYSTEMD_INVOCATION_ID'],
                                  'pid': event['_PID'], 'realtimeUs': event['__REALTIME_TIMESTAMP']})
            if current['MainPID'] == '0' and current['ActiveState'] in {'inactive', 'failed'}:
                break
            time.sleep(0.5)
        save('terminal.json', current)
        require(len(found) == 1 and current['MainPID'] == '0' and
                current['ActiveState'] in {'inactive', 'failed'},
                'one_actual_successful_probe_required')
        invocation = found[0]['invocation']
        terminal_bound = (current['InvocationID'] == invocation and
                          int(current['ExecMainStartTimestampMonotonic']) > 0 and
                          current['Result'] == 'success' and current['ExecMainStatus'] == '0')
        if not terminal_bound:
            terminal_bound = any(event.get('INVOCATION_ID') == invocation for event in manager_terminal)
        require(terminal_bound, 'actual_terminal_invocation_or_manager_success_required')
        value = found[0]['result']
        require(value['qualified'] is True and value['uid'] == 969 and value['gid'] == 963 and
                value['providerCalls'] == value['databaseCalls'] == value['credentialReads'] == 0 and
                value['workerStarted'] is False and value['noNewPrivileges'] is True and
                value['capabilitiesEmpty'] is True and value['importsVerified'] is True,
                'actual_inherited_security_and_import_checks_required')
        found[0]['terminalStatusBound'] = True
        save('result.json', found[0])
        return {'qualified': True, **found[0], 'cleanup': cleanup()}
    finally:
        if not (BASE / 'cleanup.json').exists():
            cleanup()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--apply')
    actions.add_argument('--cleanup', action='store_true')
    args = parser.parse_args()
    print(json.dumps(apply(args.apply) if args.apply else cleanup() if args.cleanup else review(), sort_keys=True))
