#!/usr/bin/env python3
"""Review by default; stage only the two exact public Arena v7/v9 inputs."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import stat
import tarfile

FORMAT = 'yunipals-arena-normal-free-public-stage-v7'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
ARCHIVE_SHA = 'cf9fe5f3b7a67ef4642917d496ad8d9cafbf200d4d75ae6ceebd7b7401289122'
PINS = {
    'arena-normal-adoption-launch-v7.py': '07964f40154d7d524da7e92f36a816ceee393c9ba29638f7b9155ef4d51d623a',
    'arena-renewal-terminal-v9.pending.patch': '0caa01ab85e98cf019f51322ac2e6810bb98549c5eb6822217823c36901a309c'
}
DEPENDENCIES = {
    'arena-owner-migration-v2.py': '70ca16836b8df7f71683ae7999be83bb97186c063133a15b2f6b8d58f074ef65',
    'arena-legacy-origin-adopt-v2.mjs': '26deb0262b61d1c3e937b5968a8cd489a60a82fd28d22d32200bc6e444f70c8b',
    'arena-owner-migration-v2.plan.json': '255e51a3b70eb871b1f5d5799d9f44f39811e72631540fb110bef71bf4058243',
    'source6-normal-replay-successor-v2.py': 'c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb'
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path, maximum=250000):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
             and not before.st_mode & 0o022 and before.st_size <= maximum, 'protected_bounded_regular_input_required')
        with os.fdopen(os.dup(fd), 'rb') as source:
            raw = source.read(maximum + 1)
        after = os.fstat(fd)
        named = path.lstat()
        identity = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_uid,
                                  value.st_gid, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        need(len(raw) == before.st_size and identity(before) == identity(after) == identity(named),
             'input_changed_during_read')
        return raw
    finally:
        os.close(fd)


def payload(archive):
    raw = read(archive, 100000)
    need(sha(raw) == ARCHIVE_SHA, 'exact_reviewed_public_archive_required')
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as bundle:
        members = bundle.getmembers()
        need(len(members) == 3 and {item.name for item in members} == {*PINS, 'SHA256SUMS'}
             and all(item.isfile() and item.size <= 100000 for item in members), 'exact_two_public_files_required')
        files = {name: bundle.extractfile(name).read(100001) for name in PINS}
        need(all(sha(files[name]) == pin for name, pin in PINS.items()), 'public_payload_hash_changed')
        sums = bundle.extractfile('SHA256SUMS').read(10000).decode().splitlines()
        need(dict((line.split()[1], line.split()[0]) for line in sums) == PINS,
             'public_checksum_inventory_changed')
    return files


def review(archive, ops=OPS):
    for path in [*reversed(ops.parents), ops]:
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
             'protected_existing_operations_directory_required')
    files = payload(archive)
    for name, pin in DEPENDENCIES.items():
        need(sha(read(ops / name)) == pin, 'original_public_dependency_changed')
    present = []
    for name, pin in PINS.items():
        if os.path.lexists(ops / name):
            need(sha(read(ops / name)) == pin, 'existing_public_file_must_match_no_overwrite')
            present.append(name)
    return files, present


def execute(archive, stage=False, ops=OPS):
    files, present = review(archive, ops)
    created = []
    if stage:
        for name, raw in files.items():
            if name in present:
                continue
            fd = os.open(ops / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o644)
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            created.append(name)
        fd = os.open(ops, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        review(archive, ops)
    return {'format': FORMAT, 'staged': stage, 'archiveSha256': ARCHIVE_SHA, 'files': PINS,
            'previouslyPresent': present, 'created': created, 'overwritten': 0,
            'materializationExecuted': False, 'databaseCalls': 0, 'serviceJobs': 0,
            'providerRequests': 0, 'privateConfigurationRead': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--stage', action='store_true')
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == 'yunipals-main', 'exact_root_host_required')
    print(json.dumps(execute(args.archive, args.stage), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError else 'public_stage_failed',
                          'privateValuesExported': False}))
        raise SystemExit(1)
