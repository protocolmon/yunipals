#!/usr/bin/env python3
"""Fresh V5c input from contiguous genuine original receipts; no execution."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT = 'yunipals-ypal-ordinary-provenance-input-v5c'
RUNNER = Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-metadata-provenance-batches-v5c.py')
RUNNER_SHA = '49ee7f792591b456d5e6ef4f7345dca5789b6fa74e993cb652fff5f5220badb0'
METADATA = Path('/var/backups/yunipals-ypal-ordinary-metadata-handover-v5-20261025')
COMPLETION = Path('/var/backups/yunipals-ypal-ordinary-metadata-selection-reconcile-v1-20261025')
LOCK = Path('/run/lock/yunipals-ypal-native-metadata-transition.lock')


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
        need(s.st_uid == s.st_gid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022,
             'protected_V5c_input_source_or_record_required')
    before = path.lstat()
    raw = path.read_bytes()
    after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and len(raw) < 2000000 and
         all(getattr(before, k) == getattr(after, k) for k in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns']) and
         (digest is None or sha(raw) == digest), 'exact_V5c_input_source_or_record_required')
    return raw


def document(path, digest=None):
    return json.loads(protected(path, digest))


def runner():
    raw = protected(RUNNER, RUNNER_SHA)
    value = types.ModuleType('genuine_V5c_runner')
    value.__file__ = str(RUNNER)
    exec(compile(raw, str(RUNNER), 'exec'), value.__dict__)
    return value


@contextlib.contextmanager
def lock():
    parent = LOCK.parent.lstat()
    need(parent.st_uid == parent.st_gid == 0 and stat.S_ISDIR(parent.st_mode) and
         (not parent.st_mode & 0o022 or stat.S_IMODE(parent.st_mode) == 0o1777), 'protected_original_metadata_lock_parent_required')
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info, current = os.fstat(fd), LOCK.lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and info.st_nlink == 1 and
             stat.S_IMODE(info.st_mode) == 0o600 and (info.st_dev, info.st_ino) == (current.st_dev, current.st_ino),
             'same_original_metadata_lock_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def capture(r, limit, seconds):
    need(type(limit) is type(seconds) is int and 1 <= limit <= 128 and 720 <= seconds <= 3600,
         'finite_requested_original_batch_limit_and_window_required')
    need(not os.path.lexists(r.INPUT.parent), 'fresh_V5c_input_namespace_required')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    first = 0
    while first < 128 and os.path.lexists(METADATA / ('provenance-' + str(first) + '-observed.json')):
        first += 1
    need(0 < first < 128, 'actual_original_prior_batch_acknowledgement_and_remaining_indices_required')
    shim = types.SimpleNamespace(s=types.SimpleNamespace(protected=protected, document=document, boot=lambda: boot))
    # Exact original pure receipt authentication, without constructing a Host,
    # querying a database or claiming current source/metadata authority.
    prior = r.prior(types.SimpleNamespace(BASE=METADATA), shim, first)
    for index in range(first, 128):
        need(not r.attempt_files(METADATA, index), 'unknown_or_noncontiguous_original_prefix_requires_reconciliation')
    for index in range(first):
        child = document(METADATA / ('provenance-' + str(index) + '-child.json'))
        need(child['bootId'] == boot and type(child['pid']) is type(child['startTicks']) is int and
             child['pid'] > 0 and child['startTicks'] > 0, 'actual_original_child_epoch_required')
        try:
            raw = (Path('/proc') / str(child['pid']) / 'stat').read_bytes()
        except (FileNotFoundError, ProcessLookupError):
            continue
        need(int(raw[raw.rfind(b')') + 2:].split()[19]) != child['startTicks'], 'original_official_child_must_be_gone')
    last = document(METADATA / ('provenance-' + str(first - 1) + '-observed.json'))
    result = last['officialResult']
    need(last.get('busy') is not True and last['completeForCurrentPublishedArchiveBase'] is False and
         type(result.get('stamped')) is int and 0 < result['stamped'] <= 5000 and
         type(last.get('remainingPublished')) is int and last['remainingPublished'] > 0 and
         last['publicationProof'] is None and last['unmatchedRowsNotDeletedOrManufactured'] is True,
         'latest_actual_prior_ack_must_be_positive_and_incomplete')
    need(sha(protected(METADATA / 'operation.json')) == r.OPERATION_SHA, 'same_actual_original_metadata_operation_required')
    selected_sha = sha(protected(METADATA / 'selected.json'))
    completion_raw = protected(COMPLETION / 'result.json')
    completion = json.loads(completion_raw)
    need(completion['format'] == 'yunipals-ypal-ordinary-metadata-selection-reconcile-v1' and completion['completed'] is True and
         completion['operatorSha256'] == r.COMPLETION_SHA and completion['originalOperationSha256'] == r.OPERATION_SHA and
         completion['actualSelectedReceiptSha256'] == selected_sha and completion['parent9aSuccessClaimed'] is False,
         'actual_a25_reconciled_selection_receipt_required')
    value = {'format': r.FORMAT + '-input', 'metadataInputSha256': r.METADATA_INPUT_SHA, 'metadataOperationSha256': r.OPERATION_SHA,
        'selectedReceiptSha256': selected_sha, 'selectionCompletionSha256': sha(completion_raw), 'firstIndex': first,
        'maxBatches': min(limit, 128 - first), 'maxSeconds': seconds}
    r.config(value)
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())), 'runnerSha256': RUNNER_SHA,
        'bootId': boot, 'input': value, 'inputSha256': sha(encoded(value)), 'prior': prior,
        'sourceAuthorityQualified': False, 'metadataCurrentQualified': False, 'original97b6RunClaimed': False}
    return binding


def write(r, expected, limit, seconds):
    binding = capture(r, limit, seconds)
    need(sha(encoded(binding)) == expected, 'same_actual_contiguous_prior_receipts_and_input_review_required')
    folder = r.INPUT.parent
    r.mkdir(folder)
    r.save(folder, 'intent.json', binding)
    # Same metadata flock remains held; original attempted indices cannot be
    # produced concurrently by another cooperating official executor.
    for name, refs in binding['prior'].items():
        need(sha(protected(METADATA / (name + '-observed.json'))) == refs['observedSha256'] and
             sha(protected(METADATA / (name + '-result.json'))) == refs['resultSha256'] and
             sha(protected(METADATA / (name + '-intent.json'))) == refs['intentSha256'],
             'original_prior_ack_changed_after_input_intent')
    for index in range(binding['input']['firstIndex'], 128):
        need(not r.attempt_files(METADATA, index), 'new_unknown_original_attempt_after_input_intent')
    digest = r.save(folder, r.INPUT.name, binding['input'])
    need(digest == binding['inputSha256'] and stat.S_IMODE(r.INPUT.lstat().st_mode) == 0o600,
         'exact_root600_fresh_V5c_input_required')
    result = r.save(folder, 'created.json', {'format': FORMAT, 'created': True, 'inputSha256': digest,
        'firstIndex': binding['input']['firstIndex'], 'priorReceiptCount': len(binding['prior']),
        'original97b6RunClaimed': False, 'currentSourceAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0})
    return digest, result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--review', action='store_true')
    p.add_argument('--write')
    p.add_argument('--max-batches', type=int, default=127)
    p.add_argument('--max-seconds', type=int, default=3600)
    a = p.parse_args()
    if not a.review and a.write is None:
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0}))
        return
    need(not (a.review and a.write) and os.geteuid() == os.getegid() == 0 and os.uname().nodename == 'yunipals-main',
         'fixed_root_explicit_input_factory_phase_required')
    os.umask(0o077)
    r = runner()
    with lock():
        if a.review:
            binding = capture(r, a.max_batches, a.max_seconds)
            print(json.dumps({'format': FORMAT, 'effects': False, 'reviewSha256': sha(encoded(binding)),
                'inputSha256': binding['inputSha256'], 'firstIndex': binding['input']['firstIndex'],
                'maxBatches': binding['input']['maxBatches'], 'priorReceiptCount': len(binding['prior']), 'currentSourceAuthorityQualified': False}))
        else:
            digest, result = write(r, a.write, a.max_batches, a.max_seconds)
            print(json.dumps({'format': FORMAT, 'created': True, 'inputSha256': digest, 'receiptSha256': result,
                'original97b6RunClaimed': False, 'databaseWrites': 0, 'serviceActions': 0}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'private_diagnostics_withheld',
            'automaticRetryAllowed': False}))
        raise SystemExit(1)
