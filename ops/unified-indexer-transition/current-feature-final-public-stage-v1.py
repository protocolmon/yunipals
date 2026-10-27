#!/usr/bin/env python3
"""Stage fixed public sources only; no runtime receipt, SQL or service checks."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

ROOT = Path('/opt/yunipals-unified/operations')
MANIFEST = Path(__file__).absolute().with_name('current-feature-final-public-stage-v1.files.json')
MANIFEST_SHA = '935eedcc01f8be78dc8ad2dd3cc29999dc3c5d7233468e06acc8d4ebad48902e'
PREFIX = Path('free-replay-20261020')
EVIDENCE = PREFIX / 'current-feature-final-source-v1-20261023'
FORMAT = 'yunipals-current-feature-final-public-source-stage-v1'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def ancestry(path):
    require(path.is_absolute() and '..' not in path.parts, 'absolute_public_stage_path_required')
    for parent in reversed(path.parents):
        info = parent.lstat()
        sticky = parent in {Path('/tmp'), Path('/var/tmp')} and info.st_mode & stat.S_ISVTX
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and
                (not info.st_mode & 0o022 or sticky), 'protected_public_stage_ancestry_required')


def read(path):
    path = Path(path)
    ancestry(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0 and
            before.st_nlink == 1 and not before.st_mode & 0o022 and before.st_size <= 2_000_000,
            'bounded_protected_public_file_required')
    identity = lambda row: (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_gid,
                            row.st_nlink, row.st_size, row.st_mtime_ns, row.st_ctime_ns)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as handle:
        raw = handle.read(2_000_001)
        after = os.fstat(handle.fileno())
    require(identity(before) == identity(after) == identity(path.lstat()) and len(raw) == before.st_size,
            'public_file_changed_while_reading')
    return raw


def relative(value):
    require(isinstance(value, str) and value and not Path(value).is_absolute() and
            all(part not in {'', '.', '..'} for part in value.split('/')), 'fixed_relative_public_path_required')
    return Path(value)


def inputs():
    raw = read(MANIFEST)
    require(sha(raw) == MANIFEST_SHA, 'exact_reviewed_public_file_manifest_required')
    value = json.loads(raw)
    require(value.get('format') == 'yunipals-current-feature-final-public-source-files-v1' and
            value.get('operationalReceiptsRequired') is False and len(value.get('payload', [])) == 21 and
            len(value.get('historicalPublicDependencies', {})) == 23, 'finite_source_only_stage_scope_required')
    sources, targets = set(), set()
    for row in value['payload']:
        source, target = relative(row['source']), relative(row['target'])
        require(source.parent in {Path('ops/unified-indexer-transition'), Path('docs/unified-indexer')} and
                target.parent == (PREFIX if source.parts[0] == 'ops' else EVIDENCE) and
                target.name == source.name and row['source'] not in sources and row['target'] not in targets,
                'exact_new_versioned_public_mapping_required')
        sources.add(row['source']); targets.add(row['target'])
    for name in value['historicalPublicDependencies']:
        relative(name)
    require(not targets & set(value['historicalPublicDependencies']), 'historical_public_files_must_not_be_replaced')
    return value


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def directory(path):
    ancestry(path / 'fixed-entry')
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022,
            'existing_protected_operations_directory_required')


def review(source, root=ROOT):
    require(os.geteuid() == 0, 'root_public_source_stager_required')
    source, root = Path(source), Path(root)
    directory(source); directory(root); directory(root / PREFIX)
    manifest = inputs()
    dependencies = {}
    for name, pin in manifest['historicalPublicDependencies'].items():
        require(sha(read(root / name)) == pin, 'exact_historical_public_dependency_required')
        dependencies[str(root / name)] = pin
    evidence = root / EVIDENCE
    if os.path.lexists(evidence):
        directory(evidence)
    rows = []
    for row in manifest['payload']:
        raw = read(source / row['source'])
        require(sha(raw) == row['sha256'] and len(raw) == row['bytes'], 'exact_new_public_source_required')
        destination = root / row['target']
        present = os.path.lexists(destination)
        if present:
            require(read(destination) == raw, 'different_existing_source_must_not_be_overwritten')
        rows.append({'source': row['source'], 'path': str(destination), 'sha256': row['sha256'],
                     'bytes': len(raw), 'alreadyPresent': present})
    value = {'format': FORMAT, 'sourceDirectory': str(source), 'manifestSha256': MANIFEST_SHA,
             'files': rows, 'historicalPublicDependencies': dependencies,
             'operationalReceiptReads': 0, 'runtimeValidationPerformed': False,
             'serviceActions': 0, 'databaseWrites': 0, 'providerCalls': 0, 'liveSelectionChanged': False}
    return {**value, 'reviewHash': sha(encode(value)), 'staged': False}


def exclusive(path, raw):
    directory(path.parent)
    descriptor, name = tempfile.mkstemp(prefix='.current-feature-public-', dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            os.fchmod(output.fileno(), 0o644)
            output.write(raw); output.flush(); os.fsync(output.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            raise RuntimeError('destination_appeared_after_review') from None
        sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)
        sync(path.parent)


def apply(source, expected, root=ROOT):
    checked = review(source, root)
    require(checked['reviewHash'] == expected, 'fresh_exact_public_source_review_required')
    root, source = Path(root), Path(source)
    for row in checked['files']:
        if row['alreadyPresent']:
            continue
        destination = Path(row['path'])
        if destination.parent == root / EVIDENCE and not os.path.lexists(destination.parent):
            directory(root / PREFIX)
            destination.parent.mkdir(mode=0o755)
            sync(root / PREFIX)
        raw = read(source / row['source'])
        require(sha(raw) == row['sha256'] and len(raw) == row['bytes'], 'public_source_changed_after_review')
        exclusive(destination, raw)
    final = review(source, root)
    require(all(row['alreadyPresent'] for row in final['files']), 'all_exact_public_sources_must_be_present')
    return {**final, 'staged': True, 'approvedReviewHash': expected,
            'runtimeReadinessClaimed': False, 'automaticRetry': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--apply')
    args = parser.parse_args()
    print(json.dumps(apply(args.source, args.apply) if args.apply else review(args.source), sort_keys=True))
