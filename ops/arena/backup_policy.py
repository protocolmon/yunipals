"""Pure retention policy and atomic private status files for Arena backups."""
import datetime
import json
import os
import re

SNAPSHOT_NAME = re.compile(r'\d{8}T\d{6}Z')
SNAPSHOT_FILES = {'data.tar.gz.gpg', 'complete.json.gpg', 'restore-drill.dump.gpg'}
RETENTION_DAYS = 30


def dump_tables(listing):
    """Read the exact schema table inventory from the completed dump's own TOC."""
    names = []
    for line in listing.splitlines():
        match = re.fullmatch(r'\d+; \d+ \d+ TABLE yunipals_arena ([a-z_][a-z0-9_]*) \S+', line.strip())
        if match:
            names.append(match.group(1))
    assert len(names) == len(set(names)), 'Duplicate database table in dump'
    assert {'deployment', 'tournament', 'submission', 'provider_task', 'frozen_input'} <= set(names), 'Incomplete Arena schema in dump'
    return sorted(names)


def atomic_json(path, value):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + str(os.getpid()) + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def expired_snapshots(names, now):
    # Inspect all names before producing a deletion list; an unexpected directory
    # fails closed. In particular, never accept paths or another app's backups.
    assert len(names) == len(set(names))
    assert all(SNAPSHOT_NAME.fullmatch(name) for name in names), 'Unknown snapshot directory'
    cutoff = now - datetime.timedelta(days=RETENTION_DAYS)
    return sorted(name for name in names if
                  datetime.datetime.strptime(name, '%Y%m%dT%H%M%SZ').replace(tzinfo=datetime.timezone.utc) < cutoff)


def valid_prune_files(names):
    allowed = SNAPSHOT_FILES | {name + '.part' for name in SNAPSHOT_FILES}
    return all(name in allowed for name in names)
