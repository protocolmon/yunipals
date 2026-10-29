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


# Optional before anime launch; required together once its private config exists.
ANIME_BACKUP_ROOTS = {
    'assets': '/var/www/assets-anime.yunipals.com',
    'media': '/var/lib/yunipals-anime-arena/media',
    'studio': '/var/lib/yunipals-anime-arena/studio',
    'configuration': '/etc/yunipals-anime-arena',
    'release': '/srv/yunipals-anime-arena/recovery',
    'chromium': '/srv/yunipals-arena/runtime/chromium-151.0.7922.34',
    'node': '/srv/yunipals-arena/runtime/node-v24.22.1'
}


def anime_backup_files(roots=None):
    from pathlib import Path
    selected = {key: Path(value) for key, value in (roots or ANIME_BACKUP_ROOTS).items()}
    if not selected['configuration'].exists():
        return {}
    result = {}
    for kind, root in selected.items():
        assert root.exists() and not root.is_symlink(), 'Missing anime recovery root'
        if root.is_file():
            result[kind + '/' + root.name] = root
            continue
        assert root.is_dir(), 'Invalid anime recovery root'
        paths = sorted(root.rglob('*'))
        assert all(not p.is_symlink() for p in paths), 'Unexpected anime backup symlink'
        for path in paths:
            if path.is_file():
                result[kind + '/' + str(path.relative_to(root))] = path
    return result


def shared_arena_backup_files(roots=None):
    # Optional until shared configuration exists, then require every recovery
    # root together. Reuse the same traversal and symlink checks as anime.
    return anime_backup_files(roots or {
        'configuration': '/etc/yunipals-arena-modes',
        'release': '/srv/yunipals-arena-modes/recovery',
        'sourceConfiguration': '/etc/yunipals-arena-modes-source',
        'sourceRpc': '/etc/yunipals-arena-modes-source-rpc',
        'sourceObserver': '/etc/yunipals-arena-modes-source-observer',
        'videoMedia': '/var/lib/yunipals-arena-modes/video/media',
        'animeMedia': '/var/lib/yunipals-arena-modes/anime/media'
    })
