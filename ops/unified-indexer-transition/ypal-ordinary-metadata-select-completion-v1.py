#!/usr/bin/env python3
"""Complete one proved no-start metadata selection; preserve original journals."""
import argparse
import ast
import copy
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import types

FORMAT = 'yunipals-ypal-ordinary-metadata-select-completion-v1'
BASE = Path('/var/backups/yunipals-ypal-ordinary-metadata-select-completion-v1-20261025')
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
COMMON = OPS / 'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA = 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
OWNER = OPS / 'ypal-ordinary-metadata-handover-v5.py'
OWNER_SHA = '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
TEMPLATE = OPS / 'ypal-restored-metadata-handover-v1.py'
TEMPLATE_SHA = 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
INPUT_SHA = 'bc618a8559a94d4a34d5a6da91c98d2241161f2edd91e540857a5089e5bbe306'
OPERATION_SHA = '8aa248a21585cfffd2dc936968f214a2b007b3460f866e2d1346c1432d42a70d'
FAILURE = Path('/var/backups/yunipals-root-metadata-after-drain-v2-20261025/select/stdout')
FAILURE_SHA = 'dd433167b6ac958e80980b9f337000e151f2d0ef52d4ba92db5c77be60491dc8'
FAILURE_CODE = 'exact_acknowledged_terminal_metadata_invocation_required'
TAIL_FILES = ('native-started.json', 'native-observed.json', 'boot-publish-intent.json', 'selected.json')


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def protected(path, digest=None):
    for p in [*path.parents, path]:
        s = p.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
             'protected_select_completion_path_required')
    s = path.lstat()
    raw = path.read_bytes()
    after = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and len(raw) < 2000000 and
         all(getattr(s, k) == getattr(after, k) for k in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns']) and
         (digest is None or sha(raw) == digest), 'exact_select_completion_source_or_receipt_required')
    return raw


def module(path, digest):
    raw = protected(path, digest)
    value = types.ModuleType(path.stem)
    value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def context(inverse=False):
    c, owner = module(COMMON, COMMON_SHA), module(OWNER, OWNER_SHA)
    n = owner.namespace(INPUT_SHA)
    h = c.metadata_context(INPUT_SHA, inverse)
    op = n.operation(h, OPERATION_SHA)
    return c, n, h, op


def document(h, path, digest=None):
    raw = h.s.protected(path)
    need(digest is None or sha(raw) == digest, 'exact_original_metadata_prefix_receipt_required')
    return h.s.document(path, sha(raw)), sha(raw)


def failed_select():
    value = json.loads(protected(FAILURE, FAILURE_SHA))
    need(value.get('completed') is False and value.get('fixedCode') == FAILURE_CODE,
         'actual_original_select_failed_before_manager_start_required')
    # The pinned select body performs this terminal call before its sole start.
    tree = ast.parse(protected(TEMPLATE, TEMPLATE_SHA))
    fn = next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'select')
    calls = [ast.unparse(v.func) + ':' + (str(v.args[-1].value) if v.args and isinstance(v.args[-1], ast.Constant) else '')
             for row in fn.body for v in ast.walk(row) if isinstance(v, ast.Call)]
    need(calls.index('h.terminal:') < calls.index('manager:start') and calls.count('manager:start') == 1,
         'original_failure_must_precede_only_original_manager_start')


def terminal(c, n, h, op, actor, checker=None):
    before = n.state(h.m)
    need(before['MainPID'] == before['ControlPID'] == '0' and before['Job'] == '' and
         before['ActiveState'] in {'inactive', 'failed'}, 'actual_metadata_unit_must_be_terminal')
    group = Path('/sys/fs/cgroup/system.slice') / n.UNIT / 'cgroup.procs'
    need(not group.exists() or not group.read_text().split(), 'actual_metadata_cgroup_must_be_empty')
    known = [actor, op['oldActor']]
    for name in ['native-started.json', 'selected.json']:
        if os.path.lexists(n.BASE / name):
            record = h.s.document(n.BASE / name)
            known.append(record.get('nativeActor', record))
    if os.path.lexists(BASE / 'started-actor.json'):
        known.append(json.loads(protected(BASE / 'started-actor.json')))
    need(not any(n.identity_alive(h.m, p) for row in known for p in row['processes']), 'all_recorded_metadata_process_epochs_must_be_gone')
    epoch = (before['InvocationID'], before['ExecMainStartTimestampMonotonic'])
    epochs = {(row['unit']['InvocationID'], row['unit']['ExecMainStartTimestampMonotonic']) for row in known}
    need(epoch == ('', '0') or epoch in epochs, 'only_forgotten_or_exact_recorded_terminal_metadata_epoch_allowed')
    native, enabled = os.path.lexists(n.DROP), os.path.lexists(n.BOOT)
    need(n.loaded(h, op, native, enabled), 'exact_current_metadata_loaded_command_definitions_required')
    boot = n.BOOT if enabled else n.BASE / 'original-boot-link'
    need(n.link(boot) == op['oldBoot'], 'original_metadata_boot_inode_must_be_preserved')
    if native:
        need(n.file_identity(n.DROP) == h.s.document(n.BASE / 'native-drop-created.json') and
             sha(h.s.protected(n.DROP)) == op['candidateDropSha256'], 'exact_owned_native_metadata_overlay_required')
    h.private(op['oldWriter'])
    sessions = c.terminal_sessions(h, actor)
    # Explicit actual sessions select the genuine formal argument path. It
    # retains PID/cgroup/backend/private/current fences without asserting that
    # systemd still remembers a terminal InvocationID after daemon-reload.
    (h.terminal if checker is None else checker)(op, actor, sessions=sessions)
    need(n.state(h.m) == before, 'terminal_metadata_changed_during_actual_residual_kernel_capture')
    return {'state': before, 'sessions': sessions, 'terminalInvocationClaimed': False}


def prefix(c, n, h, op, observations=None):
    failed_select()
    need(not any(os.path.lexists(n.BASE / name) for name in TAIL_FILES) and
         not any(p.name.startswith('inverse') or p.name == 'restored.json' for p in n.BASE.iterdir()),
         'only_actual_failed_select_before_start_tail_allowed')
    records = {name: document(h, n.BASE / name) for name in ['operation.json', 'drained.json', 'adopted.json',
        'adopt-result.json', 'native-drop-intent.json', 'native-drop-created.json', 'native-start-intent.json']}
    need(records['operation.json'][1] == OPERATION_SHA and records['operation.json'][0] == op,
         'actual_original_metadata_operation_required')
    adopted = records['adopted.json'][0]
    need(adopted['officialAcknowledgementPresent'] is True and adopted['result'] == records['adopt-result.json'][0] and
         adopted['result']['adopted'] is True and adopted['result']['releaseId'] == h.meta.RELEASE and
         adopted['result']['readIdentity'] == h.meta.IDENTITY, 'actual_committed_native_adoption_required')
    original_start = records['native-start-intent.json'][0]
    need(original_start['bootId'] == h.s.boot() == op['bootId'] and type(original_start['monotonicUs']) is int and
         not os.path.lexists(n.BOOT) and n.link(n.BASE / 'original-boot-link') == op['oldBoot'],
         'same_boot_original_pending_start_and_retained_boot_required')
    n.no_live_cli(h)
    db = h.database()
    need(db['scan'] == adopted['after']['scan'] and db['approval'] == adopted['after']['approval'] and
         db['scan']['ingestion_mode'] == 'native' and db['approval']['read_identity'] == h.meta.IDENTITY,
         'unchanged_adopted_native_scan_and_approval_required')
    actual = terminal(c, n, h, op, op['oldActor'])
    if observations is not None:
        observations.append(copy.deepcopy(actual))
    return {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'bootId': h.s.boot(),
        'originalOperatorSha256': OWNER_SHA, 'originalInputSha256': INPUT_SHA, 'originalOperationSha256': OPERATION_SHA,
        'failedOriginalSelectSha256': FAILURE_SHA, 'records': {k: v[1] for k, v in records.items()},
        'database': {'scan': db['scan'], 'approval': db['approval']},
        'terminal': {'state': actual['state'], 'terminalInvocationClaimed': False},
        'sessionObservationsExcludedFromActionDigest': True}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write(folder, name, value):
    raw = encoded(value)
    fd = os.open(folder / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(folder)
    return sha(raw)


def save(name, value):
    return write(BASE, name, value)


def report(kind, value):
    folder = BASE.with_name(BASE.name + '-observations')
    if not os.path.lexists(folder):
        folder.mkdir(mode=0o700)
        sync(folder.parent)
    s = folder.lstat()
    need(stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 0 and stat.S_IMODE(s.st_mode) == 0o700,
         'private_completion_observation_directory_required')
    name = kind + '-' + str(time.time_ns()) + '-' + str(os.getpid()) + '.json'
    digest = write(folder, name, value)
    output = {'format': FORMAT, 'privateObservationSha256': digest, 'privateObservationFile': str(folder / name),
              'effects': False, 'automaticRetryAllowed': False}
    if 'reviewSha256' in value:
        output['reviewSha256'] = value['reviewSha256']
    print(json.dumps(output))


def own_intent(h):
    value = json.loads(protected(BASE / 'start-intent.json'))
    need(value['format'] == FORMAT and value['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         value['originalOperationSha256'] == OPERATION_SHA and value['originalInputSha256'] == INPUT_SHA and
         value['bootId'] == h.s.boot(), 'same_actual_completion_start_intent_required')
    for name, digest in value['binding']['records'].items():
        need(re.fullmatch('[a-z-]+\\.json', name), 'literal_original_completion_receipt_name_required')
        base = h._completion_base
        need(sha(h.s.protected(base / name)) == digest, 'original_completion_prefix_receipt_changed')
    return value


def rename_no_replace(source, target):
    libc = ctypes.CDLL(None, use_errno=True)
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def start_actor(n, h, op):
    intent = own_intent(h)
    actor = n.start_intent_actor(h, op)
    need(intent['monotonicUs'] <= int(actor['unit']['ExecMainStartTimestampMonotonic']) <= intent['deadlineUs'],
         'new_metadata_actor_must_follow_own_completion_start_intent')
    if os.path.lexists(BASE / 'started-actor.json'):
        saved = json.loads(protected(BASE / 'started-actor.json'))
        enabled = {**saved, 'unit': {**saved['unit'], 'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target'}}
        need(actor in [saved, enabled], 'same_recorded_completion_native_actor_required')
    return actor


def select_tail(n):
    tree = ast.parse(protected(TEMPLATE, TEMPLATE_SHA))
    fn = copy.deepcopy(next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'select'))
    offsets = [i for i, row in enumerate(fn.body) if isinstance(row, ast.Assign) and
               ast.unparse(row.value) == 'start_intent_actor(h, op)']
    need(len(offsets) == 1, 'exact_original_select_start_acceptance_boot_tail_required')
    fn.name = 'completion_tail'
    fn.body = fn.body[offsets[0]:]
    fn.body.insert(1, ast.parse('completion_actor_fence(h, op, actor)').body[0])
    renames = 0
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and ast.unparse(node.func) == 'os.rename':
            need(ast.unparse(node.args[0]) == "BASE / 'original-boot-link'" and ast.unparse(node.args[1]) == 'BOOT',
                 'only_original_boot_publication_rename_seam_allowed')
            node.func = ast.Name(id='completion_rename', ctx=ast.Load())
            renames += 1
    need(renames == 1, 'one_original_select_tail_boot_rename_required')
    scope = {**n.__dict__, 'completion_actor_fence': lambda h, op, actor: need(actor == start_actor(n, h, op),
        'same_new_owned_completion_actor_before_original_tail'), 'completion_rename': rename_no_replace}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(TEMPLATE), 'exec'), scope)
    return scope['completion_tail']


def completed_tail(n, h, op):
    selected, selected_sha = document(h, n.BASE / 'selected.json')
    started = h.s.document(n.BASE / 'native-started.json')
    observed = h.s.document(n.BASE / 'native-observed.json')
    need(selected['selected'] is True and selected['provenanceComplete'] is False and
         selected['nativeActor'] == {**started, 'unit': {**started['unit'], 'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target'}} and
         selected['nativeActor'] == start_actor(n, h, op) and n.link(n.BOOT) == selected['boot'] == op['oldBoot'] and
         h.s.document(n.BASE / 'boot-publish-intent.json') == op['oldBoot'] and not os.path.lexists(n.BASE / 'original-boot-link'),
         'actual_completed_original_select_actor_and_boot_chain_required')
    need(observed['nativeWorkerFunctional'] is True and observed['elapsedSeconds'] == 20 and len(observed['samples']) == 3 and
         all(v['scan']['ingestion_mode'] == 'native' and v['probe'] is True and v['approval']['state'] == 'ready' and
             v['approval']['read_identity'] == h.meta.IDENTITY for v in observed['samples']),
         'actual_original_three_native_acceptance_samples_required')
    h.refresh()
    need(selected['nativeActor'] == start_actor(n, h, op) and n.link(n.BOOT) == selected['boot'],
         'completed_tail_changed_during_current_source_fence')
    return selected_sha


def finish(n, h, op):
    start_actor(n, h, op)
    if not os.path.lexists(n.BASE / 'selected.json'):
        need(not any(os.path.lexists(n.BASE / name) for name in TAIL_FILES),
             'partial_original_select_tail_requires_explicit_reconciliation_or_inverse')
        select_tail(n)(h, op)
    selected_sha = completed_tail(n, h, op)
    return save('result.json', {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'originalOperationSha256': OPERATION_SHA, 'actualSelectedReceiptSha256': selected_sha,
        'ownStartIntentSha256': sha(protected(BASE / 'start-intent.json')), 'completed': True,
        'originalFailedSelectReclassified': False, 'originalSelectCliAcknowledgementClaimed': False})


def start(c, n, h, op, review_sha):
    observations = []
    binding = prefix(c, n, h, op, observations)
    need(sha(encoded(binding)) == review_sha and not os.path.lexists(BASE), 'exact_current_completion_review_and_fresh_journal_required')
    BASE.mkdir(mode=0o700)
    sync(BASE.parent)
    save('review.json', {'binding': binding, 'terminalObservations': observations})
    now = time.monotonic_ns() // 1000
    save('start-intent.json', {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'originalOperationSha256': OPERATION_SHA, 'originalInputSha256': INPUT_SHA, 'bootId': h.s.boot(),
        'monotonicUs': now, 'deadlineUs': now + 900000000, 'binding': binding, 'automaticRetryAllowed': False})
    # All slow current-source/private/kernel checks precede this final terminal
    # CAS; its actual formal sessions argument avoids no manager epoch claim.
    observations = []
    need(prefix(c, n, h, op, observations) == binding, 'original_prefix_changed_after_completion_intent')
    save('prestart-terminal.json', {'binding': binding, 'terminalObservations': observations})
    need(time.monotonic_ns() // 1000 <= own_intent(h)['deadlineUs'], 'completion_dispatch_window_expired_no_start')
    need(n.state(h.m) == binding['terminal']['state'], 'metadata_changed_after_durable_completion_start_intent')
    n.manager(h.m, 'start')
    save('started-actor.json', start_actor(n, h, op))
    return finish(n, h, op)


def reconcile(n, h, op):
    intent = own_intent(h)
    state = n.state(h.m)
    result = {'format': FORMAT, 'ownStartIntentSha256': sha(protected(BASE / 'start-intent.json')),
        'originalOperationSha256': OPERATION_SHA, 'managerActions': 0, 'automaticRetryAllowed': False,
        'originalTailFiles': [name for name in TAIL_FILES if os.path.lexists(n.BASE / name)]}
    if state['MainPID'] != '0':
        result['actualOwnedNativeActor'] = start_actor(n, h, op)
    else:
        result['sourceWorkerTerminal'] = True
    result['originalStartIntentSha256'] = intent['binding']['records']['native-start-intent.json']
    return result


def inverse_terminal(c, n, h, op):
    original = h.terminal
    def current(self, operation, actor, sessions=None):
        if sessions is not None:
            return original(operation, actor, sessions=sessions)
        need(operation == op and sha(h.s.protected(n.BASE / 'operation.json')) == OPERATION_SHA,
             'same_original_operation_before_explicit_completion_inverse')
        # The original formal sessions path still owns the full terminal body.
        return terminal(c, n, h, operation, actor, checker=original)['state']
    h.terminal = types.MethodType(current, h)


def inverse_body(n):
    tree = ast.parse(protected(TEMPLATE, TEMPLATE_SHA))
    fn = copy.deepcopy(next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'inverse'))
    changed = 0
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and ast.unparse(node.func) == 'os.rename':
            node.func = ast.Name(id='completion_rename', ctx=ast.Load())
            changed += 1
    need(changed == 2, 'exact_two_original_inverse_boot_moves_required')
    scope = {**n.__dict__, 'completion_rename': rename_no_replace}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(TEMPLATE), 'exec'), scope)
    return scope['inverse']


def completed_inverse(n, h, op):
    record, digest = document(h, n.BASE / 'inverse-result.json')
    need(record['restored'] is True and record['journalOrProvenanceRowsDeleted'] == 0 and
         record['sourceSelectionChanged'] is False and record['readGrantsChanged'] is False and
         all(record['oldWriter'][key] == op['oldWriter'][key] for key in
             ['definitions', 'environmentFileHashes', 'configuredEnvironmentSha256']),
         'actual_original_completed_inverse_receipt_required')
    actor = h.actor()
    need(n.loaded(h, op, False, True) and int(actor['unit']['ExecMainStartTimestampMonotonic']) >=
         h.s.document(n.BASE / 'old-start-intent.json')['monotonicUs'], 'actual_owned_original_resume_epoch_required')
    tree = ast.parse(protected(TEMPLATE, TEMPLATE_SHA))
    fn = copy.deepcopy(next(v for v in tree.body if isinstance(v, ast.FunctionDef) and v.name == 'finish_original_resume'))
    need(isinstance(fn.body[-1], ast.Return) and isinstance(fn.body[-1].value, ast.Call) and
         ast.unparse(fn.body[-1].value.func) == 'h.s.save', 'exact_original_inverse_resume_validation_tail_required')
    fn.body[-1] = ast.Return(value=fn.body[-1].value.args[1])
    scope = dict(n.__dict__)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), str(TEMPLATE), 'exec'), scope)
    scope['finish_original_resume'](h, op, h.s.document(n.BASE / 'inverse-intent.json'))
    need(h.actor() == actor, 'original_resume_actor_changed_during_inverse_reconciliation')
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--review', action='store_true')
    actions.add_argument('--start')
    actions.add_argument('--reconcile', action='store_true')
    actions.add_argument('--finish', action='store_true')
    actions.add_argument('--inverse', action='store_true')
    actions.add_argument('--finish-inverse', action='store_true')
    a = parser.parse_args()
    if not any(vars(a).values()):
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'serviceActions': 0, 'databaseWrites': 0}))
        return
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_metadata_completion_host_required')
    os.umask(0o077)
    c, n, h, op = context(a.inverse or a.finish_inverse)
    h._completion_base = n.BASE
    with n.lock():
        if a.review:
            observations = []
            value = prefix(c, n, h, op, observations)
            report('review', {'format': FORMAT, 'reviewSha256': sha(encoded(value)), 'effects': False,
                'binding': value, 'terminalObservations': observations})
            return
        if a.start:
            result = start(c, n, h, op, a.start)
        elif a.reconcile:
            report('reconcile', reconcile(n, h, op))
            return
        elif a.finish:
            result = finish(n, h, op)  # Observation-only start reconciliation; never manager(start).
        else:
            if os.path.lexists(BASE / 'start-intent.json'):
                own_intent(h)
            elif not a.finish_inverse:
                observations = []
                binding = prefix(c, n, h, op, observations)
                if not os.path.lexists(BASE):
                    BASE.mkdir(mode=0o700)
                    sync(BASE.parent)
                save('inverse-prefix.json', {'binding': binding, 'terminalObservations': observations})
            else:
                old = json.loads(protected(BASE / 'inverse-prefix.json'))
                need(old['binding']['originalOperationSha256'] == OPERATION_SHA and
                     old['binding']['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
                     old['binding']['bootId'] == h.s.boot(), 'actual_owned_prestart_inverse_prefix_required')
            if n.state(h.m)['MainPID'] != '0' and os.path.lexists(n.DROP):
                actor = start_actor(n, h, op)
                if not os.path.lexists(BASE / 'started-actor.json'):
                    save('started-actor.json', actor)
            elif os.path.lexists(BASE / 'start-intent.json'):
                need(os.path.lexists(BASE / 'started-actor.json') or os.path.lexists(n.BASE / 'native-started.json'),
                     'unknown_completion_start_terminal_requires_explicit_process_reconciliation')
            if a.finish_inverse:
                need(json.loads(protected(BASE / 'inverse-intent.json')) == {'originalOperationSha256': OPERATION_SHA, 'bootId': h.s.boot()},
                     'same_owned_completion_inverse_intent_required')
            else:
                save('inverse-intent.json', {'originalOperationSha256': OPERATION_SHA, 'bootId': h.s.boot()})
            inverse_terminal(c, n, h, op)
            original = completed_inverse(n, h, op) if os.path.lexists(n.BASE / 'inverse-result.json') else inverse_body(n)(h, op, a.finish_inverse)
            result = save('inverse-result.json', {'format': FORMAT, 'originalInverseResultSha256': original,
                'originalOperationSha256': OPERATION_SHA, 'restored': True, 'originalFailedSelectReclassified': False})
        print(json.dumps({'format': FORMAT, 'completed': True, 'resultSha256': result, 'originalFailedSelectReclassified': False}))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_completion_unknown_outcome_do_not_retry'))
    signal.alarm(900)
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
            'automaticRetryAllowed': False}))
        raise SystemExit(1)
    finally:
        signal.alarm(0)
