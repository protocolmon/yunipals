#!/usr/bin/env python3
"""Seal an already healthy metadata selection after proved ExecStart reset."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat

FORMAT = 'yunipals-ypal-ordinary-metadata-selection-reconcile-v1'
BASE = Path('/var/backups/yunipals-ypal-ordinary-metadata-selection-reconcile-v1-20261025')
PARENT = Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-metadata-select-completion-v1.py')
PARENT_SHA = '9a1dd6344bacac8dfcad75cc67f769c0ba46aec9db6f752f2b672cde9a59b8b5'
DIFF = Path('/var/backups/yunipals-root-metadata-boot-diff-20261025/observation.json')
DIFF_SHA = '63cff6abe64ec3dd4c15ce74f7d4b2a8ba1e3cf10abf0405cf75856374b12c31'
RAW_PATTERN = re.compile(r'^\{ path=(.*?) ; argv\[\]=(.*?) ; ignore_errors=(.*?) ; start_time=\[(.*?)\] ; stop_time=\[(.*?)\] ; pid=([0-9]+) ; code=(.*?) ; status=(.*?) \}$')


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def parent():
    import types
    for path in [*PARENT.parents, PARENT]:
        info = path.lstat()
        need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             'protected_original_completion_source_required')
    raw = PARENT.read_bytes()
    need(sha(raw) == PARENT_SHA and PARENT.lstat().st_nlink == 1, 'exact_original9a_completion_source_required')
    value = types.ModuleType('original9a_completion')
    value.__file__ = str(PARENT)
    exec(compile(raw, str(PARENT), 'exec'), value.__dict__)
    return value


def parsed(text, node, entry):
    found = RAW_PATTERN.fullmatch(text)
    need(found is not None, 'exact_recorded_metadata_ExecStart_presentation_required')
    path, argv, ignore, start, stop, pid, code, status = found.groups()
    need(path == node and argv == node + ' ' + entry and ignore == 'no' and stop == 'n/a' and
         code == '(null)' and status == '0/0', 'metadata_command_and_all_nonstart_ExecStart_fields_must_match')
    return start, int(pid)


def same_actor(recorded, current, node, entry):
    before = copy.deepcopy(recorded)
    after = copy.deepcopy(current)
    start, pid = parsed(before['unit'].pop('ExecStart'), node, entry)
    cleared, zero = parsed(after['unit'].pop('ExecStart'), node, entry)
    need(re.fullmatch('[A-Za-z]{3} [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} UTC', start) and
         pid == int(before['unit']['MainPID']) > 0 and cleared == 'n/a' and zero == 0,
         'only_actual_recorded_start_presentation_reset_to_empty_zero_allowed')
    before['unit'].update(UnitFileState='enabled', WantedBy='multi-user.target')
    need(before == after, 'all_metadata_actor_process_epoch_environment_and_other_unit_fields_must_match')


def typed_command(n, h):
    obj = '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in n.UNIT)
    value = json.loads(h.m.run(['/usr/bin/busctl', '--system', '--json=short', 'get-property',
        'org.freedesktop.systemd1', obj, 'org.freedesktop.systemd1.Service', 'ExecStart']))
    need(type(value) is dict and set(value) == {'type', 'data'} and value['type'] == 'a(sasbttttuii)' and
         type(value['data']) is list and len(value['data']) == 1, 'actual_typed_single_metadata_ExecStart_required')
    row = value['data'][0]
    entry = str(h.installer.TARGET / 'dist/metadata-worker.mjs')
    need(type(row) is list and len(row) == 10 and row[:3] == [h.m.NODE, [h.m.NODE, entry], False] and
         type(row[2]) is bool and all(type(v) is int and v >= 0 for v in row[3:8]) and
         all(type(v) is int for v in row[8:]) and row[3] == row[4] == row[7] == row[8] == row[9] == 0,
         'actual_metadata_typed_command_and_cleared_start_fields_required')
    return value


def capture(p, n, h, op):
    p.protected(DIFF, DIFF_SHA)
    need(not os.path.lexists(p.BASE / 'result.json') and
         not any(v.name.startswith('inverse') or v.name == 'restored.json' for folder in [n.BASE, p.BASE] for v in folder.iterdir()),
         'original9a_must_remain_failed_without_inverse_prefix')
    intent = p.own_intent(h)
    started, started_sha = p.document(h, n.BASE / 'native-started.json')
    own_started, own_started_sha = p.document(h, p.BASE / 'started-actor.json')
    need(started == own_started, 'same_genuine9a_acknowledged_native_start_required')
    current = h.actor(op, True)
    same_actor(started, current, h.m.NODE, str(h.installer.TARGET / 'dist/metadata-worker.mjs'))
    need(intent['monotonicUs'] <= int(current['unit']['ExecMainStartTimestampMonotonic']) <= intent['deadlineUs'],
         'same_actual9a_owned_start_window_required')
    command = typed_command(n, h)
    observed, observed_sha = p.document(h, n.BASE / 'native-observed.json')
    need(observed['nativeWorkerFunctional'] is True and observed['elapsedSeconds'] == 20 and len(observed['samples']) == 3 and
         all(v['scan']['ingestion_mode'] == 'native' and v['probe'] is True and v['approval']['state'] == 'ready' and
             v['approval']['read_identity'] == h.meta.IDENTITY for v in observed['samples']),
         'actual_original_three_successful_native_health_samples_required')
    need(n.link(n.BOOT) == op['oldBoot'] == h.s.document(n.BASE / 'boot-publish-intent.json') and
         not os.path.lexists(n.BASE / 'original-boot-link') and n.loaded(h, op, True, True),
         'already_completed_original_boot_move_and_loaded_native_definition_required')
    h.private(op['oldWriter'])
    n.no_live_cli(h)
    db = h.database()
    need(db['scan']['ingestion_mode'] == 'native' and db['probe'] is True and
         db['approval']['read_identity'] == h.meta.IDENTITY and db['approval']['state'] == 'ready',
         'actual_current_healthy_native_metadata_required')
    h.refresh()
    need(h.actor(op, True) == current and typed_command(n, h) == command and n.link(n.BOOT) == op['oldBoot'],
         'actual_current_metadata_epoch_command_or_boot_changed')
    selected = {'nativeActor': current, 'boot': n.link(n.BOOT), 'selected': True, 'provenanceComplete': False}
    if os.path.lexists(n.BASE / 'selected.json'):
        need(h.s.document(n.BASE / 'selected.json') == selected, 'only_exact_already_observed_selection_can_reconcile')
    binding = {'format': FORMAT, 'operatorSha256': sha(p.protected(Path(__file__).absolute())),
        'originalOperationSha256': p.OPERATION_SHA, 'originalInputSha256': p.INPUT_SHA, 'parentProducerSha256': PARENT_SHA,
        'ownStartIntentSha256': sha(p.protected(p.BASE / 'start-intent.json')), 'nativeStartedSha256': started_sha,
        'ownStartedSha256': own_started_sha, 'nativeObservedSha256': observed_sha, 'actualBootDiffSha256': DIFF_SHA,
        'selected': selected, 'typedCommand': command, 'bootId': h.s.boot()}
    return binding, db


def seal(p, n, h, op, review_sha, finish=False):
    binding, db = capture(p, n, h, op)
    need(sha(encoded(binding)) == review_sha, 'same_actual_readonly_selection_reconciliation_review_required')
    if finish:
        old = json.loads(p.protected(BASE / 'intent.json'))
        need(old['binding'] == binding and old['effectsReplayed'] is False and
             not os.path.lexists(BASE / 'result.json'), 'exact_intent_and_already_written_selection_required_for_finish')
    else:
        need(not os.path.lexists(BASE), 'exclusive_new_selection_reconciliation_required')
        BASE.mkdir(mode=0o700)
        p.sync(BASE.parent)
        p.write(BASE, 'intent.json', {'binding': binding, 'databaseObservation': db, 'effectsReplayed': False})
    again, db = capture(p, n, h, op)
    need(again == binding, 'metadata_changed_after_durable_selection_reconciliation_intent')
    if not os.path.lexists(n.BASE / 'selected.json'):
        h.s.save(n.BASE / 'selected.json', binding['selected'])
    selected_sha = sha(h.s.protected(n.BASE / 'selected.json'))
    h.refresh()
    need(h.actor(op, True) == binding['selected']['nativeActor'] and n.link(n.BOOT) == binding['selected']['boot'],
         'metadata_changed_after_actual_selection_receipt')
    return p.write(BASE, 'result.json', {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'completed': True,
        'originalOperationSha256': p.OPERATION_SHA, 'actualSelectedReceiptSha256': selected_sha,
        'ownStartIntentSha256': binding['ownStartIntentSha256'], 'parentProducerSha256': PARENT_SHA,
        'originalFailedSelectReclassified': False, 'parent9aSuccessClaimed': False, 'managerActions': 0})


def validate_completion(result_sha, n, h, op):
    """Explicit new producer proof for later callers; never a9a success alias."""
    p = parent()
    h._completion_base = n.BASE
    result, digest = p.document(h, BASE / 'result.json', result_sha)
    binding, _ = capture(p, n, h, op)
    intent = json.loads(p.protected(BASE / 'intent.json'))
    selected_sha = sha(h.s.protected(n.BASE / 'selected.json'))
    expected = {'format': FORMAT, 'operatorSha256': binding['operatorSha256'], 'completed': True,
        'originalOperationSha256': p.OPERATION_SHA, 'actualSelectedReceiptSha256': selected_sha,
        'ownStartIntentSha256': binding['ownStartIntentSha256'], 'parentProducerSha256': PARENT_SHA,
        'originalFailedSelectReclassified': False, 'parent9aSuccessClaimed': False, 'managerActions': 0}
    need(result == expected and intent['binding'] == binding and intent['effectsReplayed'] is False,
         'actual_new_selection_reconciliation_ACK_and_live_same_epoch_required')
    return {'validated': True, 'operatorSha256': binding['operatorSha256'], 'receiptSha256': digest,
        'selectedReceiptSha256': selected_sha, 'originalOperationSha256': p.OPERATION_SHA,
        'startIntentSha256': binding['ownStartIntentSha256'], 'currentActor': binding['selected']['nativeActor'],
        'parent9aSuccessClaimed': False, 'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', action='store_true')
    parser.add_argument('--apply')
    parser.add_argument('--finish')
    a = parser.parse_args()
    if not a.review and a.apply is None and a.finish is None:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'serviceActions': 0, 'databaseWrites': 0}))
        return
    need(sum(bool(v) for v in [a.review, a.apply, a.finish]) == 1 and os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main',
         'fixed_root_explicit_metadata_selection_reconciliation_required')
    os.umask(0o077)
    p = parent()
    c, n, h, op = p.context()
    h._completion_base = n.BASE
    with n.lock():
        if a.review:
            binding, db = capture(p, n, h, op)
            # Use the already accepted private observation writer, in this new domain.
            folder = BASE.with_name(BASE.name + '-observations')
            if not os.path.lexists(folder):
                folder.mkdir(mode=0o700)
                p.sync(folder.parent)
            info = folder.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
                 'private_root_selection_observation_directory_required')
            import time
            path = 'review-' + str(time.time_ns()) + '.json'
            digest = p.write(folder, path, {'binding': binding, 'databaseObservation': db})
            print(json.dumps({'format': FORMAT, 'effects': False, 'reviewSha256': sha(encoded(binding)), 'privateObservationSha256': digest}))
        else:
            print(json.dumps({'format': FORMAT, 'completed': True, 'resultSha256': seal(p, n, h, op, a.apply or a.finish, bool(a.finish)), 'managerActions': 0}))


if __name__ == '__main__':
    import signal
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_readonly_tail_reconciliation_expired'))
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
