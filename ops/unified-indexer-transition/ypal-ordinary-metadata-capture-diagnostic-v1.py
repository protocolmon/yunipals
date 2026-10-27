#!/usr/bin/env python3
"""One exact read-only metadata capture; failed subprocess details stay private."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import traceback
import types

FORMAT = 'yunipals-ordinary-metadata-capture-diagnostic-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
EXECUTOR = OPS / 'ypal-ordinary-metadata-drain-v1.py'
EXECUTOR_SHA = '920982e39c4a5aa6e2eebd20f7850a1497a2905b6b6031813f9d96e59c6de51e'
BASE = Path('/var/backups/yunipals-ypal-ordinary-metadata-capture-diagnostic-v1-20261025')
PUBLIC_INVENTORY = 'ops/booster-launch/ypal-old-runtime-inventory-v1.py'
PUBLIC_INVENTORY_SHA = '7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'
PEER_FDS_SCRIPT_SHA = 'fc771208678d07b7e76b1a7407439b553f1f1fb031272ad58d2391c51707be28'
MAX_RAW_FAILURES = 8
MAX_RAW_BYTES = 2_000_000


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def private(name, raw):
    need(re.fullmatch(r'[a-z0-9-]+\.(json|txt)', name), 'fixed_private_diagnostic_name_required')
    fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    fd = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return sha(raw)


def bytes_value(value):
    if value is None:
        return b''
    return value if isinstance(value, bytes) else value.encode()


def command_summary(argv):
    values = [os.fsdecode(v) for v in argv] if isinstance(argv, (list, tuple)) else []
    executable = Path(values[0]).name if values else ''
    kinds = {'setpriv', 'systemctl', 'busctl', 'psql', 'python3', 'node', 'ss', 'find', 'readlink', 'stat', 'true'}
    result = {'commandKind': executable if executable in kinds else 'other',
              'clearGroups': '--clear-groups' in values, 'noNewPrivileges': '--no-new-privs' in values,
              'capabilityOptionsPresent': any(v.startswith(('--inh-caps=', '--ambient-caps=', '--bounding-set=')) for v in values)}
    for key, flag in [('uid', '--reuid'), ('gid', '--regid')]:
        found = [v[len(flag) + 1:] for v in values if v.startswith(flag + '=')]
        for index, value in enumerate(values[:-1]):
            if value == flag:
                found.append(values[index + 1])
        result[key] = int(found[0]) if len(found) == 1 and re.fullmatch('[0-9]+', found[0]) else None
    return result


def frames(error):
    return [{'file': Path(row.filename).name, 'function': row.name, 'line': row.lineno}
            for row in traceback.extract_tb(error.__traceback__)]


def public_fd_peer(argv):
    """Authenticate every script byte and the entire public-only argv shape."""
    if not isinstance(argv, (list, tuple)) or len(argv) != 14 or not all(isinstance(v, str) for v in argv):
        return False
    if (argv[0] != '/usr/bin/setpriv' or not re.fullmatch(r'--reuid=[0-9]+', argv[1]) or
        not re.fullmatch(r'--regid=[0-9]+', argv[2]) or argv[3:11] != [
            '--clear-groups', '--no-new-privs', '--inh-caps=-all', '--ambient-caps=-all',
            '/usr/bin/python3', '-I', '-B', '-c'] or sha(argv[11].encode()) != PEER_FDS_SCRIPT_SHA or
        argv[13] != argv[1].split('=', 1)[1]):
        return False
    try:
        pids = json.loads(argv[12])
        return type(pids) is list and len(pids) <= 64 and all(type(pid) is int and pid > 0 for pid in pids)
    except (ValueError, TypeError):
        return False


class SubprocessDiagnostics:
    """Observe run() without changing command, environment, timeout or result."""
    def __init__(self, original, save):
        self.original, self.save = original, save
        self.calls, self.failures = [], []
        self.raw_failures = 0

    def __call__(self, *args, **kwargs):
        argv = args[0] if args else kwargs.get('args')
        summary = {**command_summary(argv), 'argumentCount': len(argv) if isinstance(argv, (list, tuple)) else None}
        try:
            result = self.original(*args, **kwargs)
        except BaseException as error:
            out = bytes_value(getattr(error, 'stdout', getattr(error, 'output', None)))
            err = bytes_value(getattr(error, 'stderr', None))
            summary.update(exitCode=getattr(error, 'returncode', None), stdoutBytes=len(out), stderrBytes=len(err),
                           traceback=frames(error))
            self.failed(argv, out, err, error, summary)
            raise
        out, err = bytes_value(result.stdout), bytes_value(result.stderr)
        summary.update(exitCode=result.returncode, stdoutBytes=len(out), stderrBytes=len(err))
        self.calls.append(summary)
        # Match the genuine inventory producer's refusal conditions exactly.
        if result.returncode != 0 or err or len(out) > 2_000_000:
            self.failed(argv, out, err, None, summary)
        return result

    def failed(self, argv, out, err, error, summary):
        index = len(self.failures) + 1
        payload = {'summary': summary, 'exceptionClass': type(error).__name__ if error else None,
                   'traceback': frames(error) if error else [
                       {'file': Path(row.filename).name, 'function': row.name, 'line': row.lineno}
                       for row in traceback.extract_stack()], 'rawPublicPeerEvidenceRetained': False}
        if public_fd_peer(argv) and max(len(out), len(err)) <= MAX_RAW_BYTES and self.raw_failures < MAX_RAW_FAILURES:
            self.raw_failures += 1
            payload.update(argv=argv, stdoutBase64=base64.b64encode(out).decode(),
                           stderrBase64=base64.b64encode(err).decode(), rawPublicPeerEvidenceRetained=True,
                           publicProducer=PUBLIC_INVENTORY, publicProducerSha256=PUBLIC_INVENTORY_SHA,
                           scriptSha256=PEER_FDS_SCRIPT_SHA)
        digest = self.save('failed-command-' + str(index) + '.json', encoded(payload))
        self.failures.append({**summary, 'privateEvidenceSha256': digest})


def executor():
    for path in [*EXECUTOR.parents, EXECUTOR]:
        row = path.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_exact_metadata_executor_required')
    raw = EXECUTOR.read_bytes()
    need(len(raw) < 100000 and sha(raw) == EXECUTOR_SHA, 'exact_frozen920_metadata_executor_required')
    value = types.ModuleType('exact_metadata_executor_diagnostic')
    value.__file__ = str(EXECUTOR)
    exec(compile(raw, str(EXECUTOR), 'exec'), value.__dict__)
    need(EXECUTOR.read_bytes() == raw, 'executor_changed_during_load')
    return value


def capture(value):
    """Same constructor and capture as 920 main; no main/save/apply/drain call."""
    owner = value.module(value.OWNER, value.OWNER_SHA)
    context = value.module(value.COMMON, value.COMMON_SHA)
    actual_input = context.load_input(value.INPUT_SHA)
    value.need(actual_input['candidateReceiptSha256'] == value.CANDIDATE_SHA and
               actual_input['candidateInputSha256'] == value.CANDIDATE_INPUT_SHA,
               'exact_existing_staged_metadata_candidate_required')
    namespace = owner.namespace(value.INPUT_SHA)
    host = owner.cli_context(value.INPUT_SHA)
    observations = []
    value.install_session_observer(namespace, host, observations)
    return value.capture(namespace, host, value.INPUT_SHA, observations)


def run():
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_diagnostic_host_required')
    os.umask(0o077)
    for parent in BASE.parents:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022, 'protected_diagnostic_parent_required')
    BASE.mkdir(mode=0o700)
    row = BASE.lstat()
    need(row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o700, 'exclusive_private_diagnostic_directory_required')
    private('intent.json', encoded({'format': FORMAT, 'operatorSha256': sha(Path(__file__).read_bytes()),
            'executorSha256': EXECUTOR_SHA, 'maximumCaptures': 1, 'maximumSeconds': 750,
            'businessFunctionsCalled': ['namespace', 'cli_context', 'install_session_observer', 'capture'],
            'rawFailedEvidencePolicy': {'scriptSha256': PEER_FDS_SCRIPT_SHA, 'publicProducerSha256': PUBLIC_INVENTORY_SHA,
                                        'maximumBytesPerStream': MAX_RAW_BYTES, 'maximumFailures': MAX_RAW_FAILURES},
            'effectsInvoked': False}))
    trace = SubprocessDiagnostics(subprocess.run, private)
    subprocess.run = trace
    error = None
    result = None
    try:
        result = capture(executor())
    except BaseException as caught:
        error = caught
        private('capture-traceback.json', encoded({'exceptionClass': type(caught).__name__, 'traceback': frames(caught),
                'fixedCode': str(caught) if type(caught) is RuntimeError and str(caught) == 'bounded_readonly_inventory_command_required' else None}))
    finally:
        subprocess.run = trace.original
    private('result.json', encoded({'format': FORMAT, 'completed': error is None,
                      'commandSummaries': trace.calls, 'failedCommands': trace.failures,
                      'traceback': frames(error) if error else [], 'effectsInvoked': False}))
    return {'format': FORMAT, 'completed': error is None,
            'commandSummaries': trace.calls,
            'failedCommands': [{k: v for k, v in item.items() if k != 'privateEvidenceSha256'} for item in trace.failures],
            'traceback': frames(error) if error else [], 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true')
    args = parser.parse_args()
    if not args.capture:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'maximumCaptures': 1,
                          'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}))
        return
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_readonly_metadata_diagnostic_expired'))
    signal.alarm(750)
    try:
        print(json.dumps(run(), sort_keys=True))
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    main()
