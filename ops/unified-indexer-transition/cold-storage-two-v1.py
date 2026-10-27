#!/usr/bin/env python3
"""Copy two closed historical DB archives, then preserve their paths by aliases.

Actual paths, file identities and data hashes belong only in the private plan.
No database, service, directory move, pruning or configuration operation exists.
"""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import stat

FORMAT = 'yunipals-cold-storage-two-v1'
BACKUPS = Path('/var/backups')
PLAN = Path('/opt/yunipals-unified/operations/free-replay-20261020/cold-storage-two-v1.plan.json')
BASE = BACKUPS / 'yunipals-cold-storage-two-v1'
LOCK = Path('/run/lock/yunipals-cold-storage-two-v1.lock')
MIN_FREE = 25_000_000_000
CHUNK = 4 * 1024 * 1024
DEADLINE = 600
PATTERNS = {
    'cutover': r'yunipals-indexer-cutover-20260928T[0-9]{6}Z/database\.dump',
    'premerge': r'yunipals-indexer-premerge-20260928T[A-Za-z0-9]{6}/offhost-database/encrypted/database\.dump\.gpg'
}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def signature(path):
    s = path.lstat()
    return dict(dev=s.st_dev, inode=s.st_ino, bytes=s.st_size, mtimeNs=s.st_mtime_ns,
                ctimeNs=s.st_ctime_ns, uid=s.st_uid, gid=s.st_gid,
                mode=stat.S_IMODE(s.st_mode), links=s.st_nlink)


def directory(path):
    for p in [*reversed(path.parents), path]:
        s = p.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
             'protected_directory_ancestry_required')
    return signature(path)


def regular(path):
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_uid == s.st_gid == 0 and
         stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1,
         'root_private_single_link_regular_required')
    return signature(path)


def durable_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def make_dir(path):
    directory(path.parent)
    path.mkdir(mode=0o700)
    durable_dir(path.parent)
    need(stat.S_IMODE(path.lstat().st_mode) == 0o700, 'private_new_directory_required')


def available(path):
    v = os.statvfs(path)
    return v.f_bavail * v.f_frsize


def free(plan, root_extra=0, volume_extra=0):
    values = {'root': available(BACKUPS), 'volume': available(Path(plan['volume']))}
    need(values['root'] >= MIN_FREE + root_extra, 'root_reserve_required')
    need(values['volume'] >= MIN_FREE + volume_extra, 'volume_reserve_required')
    return values


def owner_sha():
    return sha(Path(__file__).read_bytes())


def write_receipt(name, value):
    directory(BASE)
    need(stat.S_IMODE(BASE.stat().st_mode) == 0o700, 'private_operation_directory_required')
    need(re.fullmatch(r'[a-z0-9-]+\.json', name), 'fixed_receipt_name_required')
    raw = encoded(dict(value, format=FORMAT, operatorSha256=owner_sha()))
    fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    durable_dir(BASE)
    return sha(raw)


def read_receipt(name, pin=None):
    directory(BASE)
    need(stat.S_IMODE(BASE.stat().st_mode) == 0o700, 'private_operation_directory_required')
    p = BASE / name
    before = regular(p)
    need(before['bytes'] <= 200000, 'bounded_receipt_required')
    raw = p.read_bytes()
    need(signature(p) == before and (pin is None or sha(raw) == pin), 'receipt_hash_required')
    value = json.loads(raw)
    need(value.get('format') == FORMAT and value.get('operatorSha256') == owner_sha(),
         'same_operator_receipt_required')
    return value, sha(raw)


def validate_plan(plan):
    need(set(plan) == {'format', 'volume', 'volumeDevice', 'rootDevice', 'coldParent', 'files'} and
         plan['format'] == FORMAT + '-plan', 'exact_private_plan_shape_required')
    volume = Path(plan['volume'])
    need(re.fullmatch(r'/mnt/HC_Volume_[0-9]+', str(volume)) is not None,
         'attached_volume_path_required')
    need(type(plan['rootDevice']) is int and type(plan['volumeDevice']) is int and
         plan['rootDevice'] > 0 and plan['volumeDevice'] > 0 and
         plan['rootDevice'] != plan['volumeDevice'], 'separate_volume_required')
    directory_keys = {'dev', 'inode', 'uid', 'gid', 'mode'}
    need(set(plan['coldParent']) == directory_keys and all(type(v) is int for v in plan['coldParent'].values()),
         'exact_cold_parent_binding_required')
    need(set(plan['files']) == set(PATTERNS), 'exact_two_payloads_required')
    for key, row in plan['files'].items():
        need(set(row) == {'source', 'identity', 'sha256', 'parents'}, 'exact_payload_shape_required')
        p = Path(row['source'])
        try:
            relative = p.relative_to(BACKUPS).as_posix()
        except ValueError:
            raise RuntimeError('fixed_historical_backup_required')
        need(re.fullmatch(PATTERNS[key], relative) is not None,
             'fixed_historical_backup_required')
        need(re.fullmatch('[0-9a-f]{64}', row['sha256']) is not None,
             'exact_payload_hash_required')
        sig = row['identity']
        need(set(sig) == {'dev', 'inode', 'bytes', 'mtimeNs', 'ctimeNs', 'uid', 'gid', 'mode', 'links'} and
             all(type(v) is int for v in sig.values()) and sig['uid'] == sig['gid'] == 0 and
             sig['mode'] == 0o600 and sig['links'] == 1 and sig['dev'] == plan['rootDevice'] and
             0 < sig['bytes'] < 20_000_000_000, 'fixed_payload_identity_required')
        expected_parents = [str(x) for x in [*reversed(p.parent.parents), p.parent]]
        need(set(row['parents']) == set(expected_parents) and all(set(v) == directory_keys and
             all(type(n) is int for n in v.values()) for v in row['parents'].values()),
             'complete_source_ancestry_required')
    return plan


def load(pin):
    directory(PLAN.parent)
    before = regular(PLAN)
    need(before['bytes'] <= 100000, 'bounded_private_plan_required')
    raw = PLAN.read_bytes()
    need(signature(PLAN) == before and sha(raw) == pin, 'exact_private_plan_required')
    plan = validate_plan(json.loads(raw))
    volume = Path(plan['volume'])
    directory(volume)
    need(volume.stat().st_dev == plan['volumeDevice'] and BACKUPS.stat().st_dev == plan['rootDevice'],
         'exact_filesystems_required')
    mounts = [x.split() for x in Path('/proc/self/mounts').read_text().splitlines()]
    need(any(len(x) >= 4 and x[1] == str(volume) and x[2] == 'ext4' and 'rw' in x[3].split(',')
             for x in mounts), 'mounted_rw_ext4_volume_required')
    cold = volume / 'yunipals-cold-backups'
    directory(cold)
    for key, value in plan['coldParent'].items():
        need(signature(cold)[key] == value, 'cold_parent_identity_required')
    need(stat.S_IMODE(cold.stat().st_mode) == 0o700 and cold.stat().st_dev == plan['volumeDevice'],
         'cold_parent_private_required')
    for row in plan['files'].values():
        for p, sig in row['parents'].items():
            actual = directory(Path(p))
            need(all(actual[k] == v for k, v in sig.items()), 'source_parent_identity_required')
    return plan


def target(plan, key):
    return Path(plan['volume']) / 'yunipals-cold-backups' / Path(plan['files'][key]['source']).relative_to(BACKUPS)


def exact_original(plan, key):
    path = Path(plan['files'][key]['source'])
    need(regular(path) == plan['files'][key]['identity'], 'exact_original_identity_required')
    return signature(path)


def hash_file(path, row):
    before = regular(path)
    need(before['bytes'] == row['identity']['bytes'], 'exact_payload_size_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        s = os.fstat(stream.fileno())
        need((s.st_dev, s.st_ino) == (before['dev'], before['inode']), 'opened_identity_required')
        h = hashlib.sha256()
        while chunk := stream.read(CHUNK):
            h.update(chunk)
    need(signature(path) == before and h.hexdigest() == row['sha256'], 'complete_stable_payload_hash_required')
    return before


def no_open_files(identities):
    targets = {(x['dev'], x['inode']) for x in identities}
    for p in Path('/proc').iterdir():
        if not p.name.isdigit():
            continue
        try:
            for fd in (p / 'fd').iterdir():
                try:
                    s = fd.stat()
                    need((s.st_dev, s.st_ino) not in targets, 'payload_open_by_process')
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            pass


def review(plan, pin):
    need(not os.path.lexists(BASE), 'new_operation_directory_required')
    signatures = {}
    for key, row in plan['files'].items():
        exact_original(plan, key)
        signatures[key] = hash_file(Path(row['source']), row)
        need(not os.path.lexists(Path(plan['volume']) / 'yunipals-cold-backups' / Path(row['source']).relative_to(BACKUPS).parts[0]),
             'new_destination_backup_directory_required')
    no_open_files(list(signatures.values()))
    free(plan, volume_extra=sum(x['identity']['bytes'] for x in plan['files'].values()) + 64 * 1024 * 1024)
    return {'format': FORMAT + '-review', 'operatorSha256': owner_sha(), 'planSha256': pin,
            'sources': signatures, 'preserveBytes': True, 'directoryMoves': False}


def copy_file(source, dest, row, plan):
    before = hash_file(source, row)
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    outfd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    durable_dir(dest.parent)
    h = hashlib.sha256()
    with os.fdopen(fd, 'rb') as inp, os.fdopen(outfd, 'wb') as out:
        need((os.fstat(inp.fileno()).st_dev, os.fstat(inp.fileno()).st_ino) ==
             (before['dev'], before['inode']), 'opened_source_identity_required')
        while chunk := inp.read(CHUNK):
            free(plan)
            h.update(chunk)
            out.write(chunk)
        out.flush()
        os.fsync(out.fileno())
    need(signature(source) == before and h.hexdigest() == row['sha256'], 'copy_source_changed')
    os.utime(dest, ns=(row['identity']['mtimeNs'], row['identity']['mtimeNs']), follow_symlinks=False)
    fd = os.open(dest, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    durable_dir(dest.parent)
    return hash_file(dest, row)


def copy_phase(plan, pin, expected):
    current = review(plan, pin)
    need(sha(encoded(current)) == expected, 'fresh_review_hash_required')
    make_dir(BASE)
    write_receipt('copy-intent.json', {'planSha256': pin, 'review': current, 'reviewSha256': expected})
    for key, row in plan['files'].items():
        dest = target(plan, key)
        absent = []
        p = dest.parent
        while not p.exists():
            absent.append(p)
            p = p.parent
        for p in reversed(absent):
            make_dir(p)
        exact_original(plan, key)
        copied = copy_file(Path(row['source']), dest, row, plan)
        exact_original(plan, key)
        write_receipt('copied-' + key + '.json', {'planSha256': pin, 'target': str(dest), 'identity': copied})
    return write_receipt('copy-result.json', {'planSha256': pin, 'allCopied': True,
        'copies': {key: read_receipt('copied-' + key + '.json')[0] for key in PATTERNS}})


def alias_identity(path, dest):
    s = path.lstat()
    need(stat.S_ISLNK(s.st_mode) and s.st_uid == s.st_gid == 0 and s.st_nlink == 1 and
         os.readlink(path) == str(dest), 'owned_exact_alias_required')
    return signature(path)


def rename_identity(actual, staged):
    return all(actual[k] == v for k, v in staged.items() if k != 'ctimeNs')


def owned_alias(plan, key):
    source = Path(plan['files'][key]['source'])
    staged, _ = read_receipt('alias-staged-' + key + '.json')
    need(staged['target'] == str(target(plan, key)) and staged['source'] == str(source), 'alias_record_required')
    actual = alias_identity(source, target(plan, key))
    need(rename_identity(actual, staged['identity']), 'alias_inode_identity_required')
    return actual


def reclaim_phase(plan, pin, expected):
    copy, _ = read_receipt('copy-result.json', expected)
    need(copy['planSha256'] == pin and copy['allCopied'] is True, 'complete_copy_receipt_required')
    need(not os.path.lexists(BASE / 'reclaim-intent.json'), 'single_reclaim_attempt_required')
    for key, row in plan['files'].items():
        exact_original(plan, key)
        need(hash_file(target(plan, key), row) == copy['copies'][key]['identity'], 'exact_saved_copy_required')
    no_open_files([row['identity'] for row in plan['files'].values()] +
                  [copy['copies'][key]['identity'] for key in PATTERNS])
    free(plan)
    write_receipt('reclaim-intent.json', {'planSha256': pin, 'copyReceiptSha256': expected})
    for key, row in plan['files'].items():
        source, dest = Path(row['source']), target(plan, key)
        temporary = source.parent / ('.' + source.name + '.cold-storage-two-v1-alias')
        need(not os.path.lexists(temporary), 'new_alias_temporary_required')
        write_receipt('alias-intent-' + key + '.json', {'planSha256': pin, 'source': str(source),
            'target': str(dest), 'original': exact_original(plan, key), 'copy': signature(dest)})
        os.symlink(str(dest), temporary)
        durable_dir(source.parent)
        staged_alias = alias_identity(temporary, dest)
        write_receipt('alias-staged-' + key + '.json', {'planSha256': pin, 'source': str(source),
            'target': str(dest), 'identity': staged_alias})
        exact_original(plan, key)
        need(regular(dest) == copy['copies'][key]['identity'], 'copy_changed_before_alias')
        no_open_files([row['identity'], regular(dest)])
        free(plan)
        need(alias_identity(temporary, dest) == staged_alias, 'staged_alias_identity_changed')
        need(regular(dest) == copy['copies'][key]['identity'], 'copy_changed_before_alias')
        exact_original(plan, key)
        os.replace(temporary, source)
        durable_dir(source.parent)
        write_receipt('aliased-' + key + '.json', {'planSha256': pin, 'identity': owned_alias(plan, key)})
    return write_receipt('reclaim-result.json', {'planSha256': pin, 'copyReceiptSha256': expected,
        'aliases': {key: owned_alias(plan, key) for key in PATTERNS}, 'allOriginalPathsResolve': True,
        'allArchiveBytesPreserved': True})


def reconcile(plan, pin):
    intent, intent_sha = read_receipt('copy-intent.json')
    need(intent['planSha256'] == pin and intent['review']['planSha256'] == pin and
         intent['reviewSha256'] == sha(encoded(intent['review'])), 'owned_copy_intent_required')
    files = {}
    for key, row in plan['files'].items():
        source, dest = Path(row['source']), target(plan, key)
        copied = None
        if os.path.lexists(dest):
            s = regular(dest)
            if s['bytes'] == row['identity']['bytes']:
                copied = hash_file(dest, row)
            else:
                need(s['bytes'] < row['identity']['bytes'], 'unexpected_oversize_copy')
        if source.is_symlink():
            identity = owned_alias(plan, key)
            need(copied is not None, 'complete_copy_required_for_alias')
            state = 'owned_alias'
        elif regular(source) == row['identity']:
            identity = exact_original(plan, key)
            state = 'original'
        else:
            restored, _ = read_receipt('inverse-staged-' + key + '.json')
            identity = hash_file(source, row)
            need(rename_identity(identity, restored['identity']), 'owned_restored_file_required')
            state = 'owned_restored'
        files[key] = {'state': state, 'source': identity, 'copy': copied,
                      'partialCopyPresent': os.path.lexists(dest) and copied is None}
    return {'format': FORMAT + '-reconciliation', 'operatorSha256': owner_sha(),
            'planSha256': pin, 'copyIntentSha256': intent_sha, 'files': files,
            'readOnly': True, 'automaticRetryAllowed': False}


def inverse_phase(plan, pin, expected):
    state = reconcile(plan, pin)
    need(sha(encoded(state)) == expected, 'fresh_reconciliation_hash_required')
    need(all(row['state'] == 'owned_alias' for row in state['files'].values()),
         'exact_two_owned_aliases_required')
    need(not os.path.lexists(BASE / 'inverse-intent.json'), 'single_inverse_attempt_required')
    free(plan, root_extra=sum(row['identity']['bytes'] for row in plan['files'].values()) + 64 * 1024 * 1024)
    write_receipt('inverse-intent.json', {'planSha256': pin, 'reconciliationSha256': expected, 'before': state})
    for key, row in plan['files'].items():
        source, dest = Path(row['source']), target(plan, key)
        temporary = source.parent / ('.' + source.name + '.cold-storage-two-v1-restore')
        need(not os.path.lexists(temporary), 'new_inverse_temporary_required')
        copied = copy_file(dest, temporary, row, plan)
        write_receipt('inverse-staged-' + key + '.json', {'planSha256': pin, 'identity': copied})
        need(owned_alias(plan, key) == state['files'][key]['source'], 'exact_alias_before_inverse_required')
        no_open_files([regular(dest)])
        free(plan)
        need(regular(temporary) == copied, 'inverse_temporary_changed')
        need(owned_alias(plan, key) == state['files'][key]['source'], 'exact_alias_before_inverse_required')
        os.replace(temporary, source)
        durable_dir(source.parent)
        write_receipt('restored-' + key + '.json', {'planSha256': pin, 'identity': hash_file(source, row)})
    return write_receipt('inverse-result.json', {'planSha256': pin, 'files': reconcile(plan, pin)['files'],
                                               'volumeCopiesPreserved': True})


def lock_directory():
    if LOCK.parent == Path('/run/lock'):
        directory(LOCK.parent.parent)
        s = LOCK.parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == s.st_gid == 0 and
             stat.S_IMODE(s.st_mode) == 0o1777, 'exact_sticky_system_lock_directory_required')
    else:
        directory(LOCK.parent)


def lock_operation(create):
    if not create and not LOCK.exists():
        return None
    lock_directory()
    fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW | (os.O_CREAT if create else 0), 0o600)
    try:
        before = regular(LOCK)
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino) == (before['dev'], before['inode']),
             'opened_lock_identity_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(signature(LOCK) == before, 'stable_lock_identity_required')
        return fd
    except BaseException:
        os.close(fd)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['review', 'copy', 'reclaim', 'reconcile', 'inverse'])
    parser.add_argument('--plan-sha', required=True)
    parser.add_argument('--expect')
    args = parser.parse_args()
    need(os.geteuid() == 0 and os.uname().nodename == 'yunipals-main', 'fixed_root_host_required')
    need(re.fullmatch('[0-9a-f]{64}', args.plan_sha) is not None and
         (args.expect is None or re.fullmatch('[0-9a-f]{64}', args.expect) is not None), 'sha256_required')
    need((args.phase in {'copy', 'reclaim', 'inverse'}) == (args.expect is not None), 'phase_expectation_required')
    lock = lock_operation(args.phase in {'copy', 'reclaim', 'inverse'})
    try:
        plan = load(args.plan_sha)
        if args.phase == 'review':
            result = review(plan, args.plan_sha)
        elif args.phase == 'reconcile':
            result = reconcile(plan, args.plan_sha)
        else:
            receipt = {'copy': copy_phase, 'reclaim': reclaim_phase, 'inverse': inverse_phase}[args.phase](
                plan, args.plan_sha, args.expect)
            result = {'format': FORMAT + '-ack', 'phase': args.phase, 'receiptSha256': receipt,
                      'planSha256': args.plan_sha, 'completed': True}
        print(json.dumps({'result': result, 'resultSha256': sha(encoded(result))}, sort_keys=True))
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('bounded_operation_expired')))
    signal.alarm(DEADLINE)
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[a-z_]+', str(error)) else 'bounded_operation_failed'
        print(json.dumps({'format': FORMAT + '-failure', 'fixedCode': code, 'automaticRetryAllowed': False}))
        raise SystemExit(1)
