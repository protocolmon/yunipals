#!/usr/bin/env python3
"""Move backup workspaces to the existing project volume, retaining their paths.

Run as root on yunipals-main. Copies and checksums precede bind mounts and
removal of the old copies. Application databases, keys and selectors are unchanged.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

VOLUME = Path('/mnt/HC_Volume_107222036')
WORK = VOLUME / 'yunipals-shared-transition-storage'
ROOTS = {
    '/var/lib/yunipals-arena/backups': ('arena', ['yunipals-arena-backup', 'yunipals-arena-backup-drill', 'yunipals-arena-backup-monitor']),
    '/var/lib/yunipals-marketplace/production/backup': ('market', ['yunipals-market-production-base-backup', 'yunipals-market-production-backup-prune', 'yunipals-market-production-backup-monitor']),
    '/var/backups/yunipal-islands': ('native-islands', ['yunipal-islands-backup']),
    '/var/backups/yunipals-islands-indexer': ('islands', ['yunipals-islands-backup']),
    '/var/backups/yunipals-shared-transition-20261102': ('transition-recovery', [])
}
FIXTURE = Path('/tmp/yunipals-indexer-transition-pg-20261102')


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def state(unit):
    return run(['systemctl', 'show', unit, '-p', 'ActiveState', '--value'])


def record(path, value):
    with path.open('x') as out:
        os.chmod(path, 0o600)
        json.dump(value, out, indent=2)
        out.write('\n')
        out.flush()
        os.fsync(out.fileno())


def protected(path):
    assert path.is_dir() and not path.is_symlink() and not path.stat().st_mode & 0o002


def copy_checked(source, target, resume=False):
    assert not target.exists() or resume
    target.mkdir(mode=0o700, exist_ok=resume)
    assert not target.is_symlink() and target.stat().st_dev == VOLUME.stat().st_dev
    run(['rsync', '-aHAXS', '--numeric-ids', '--delete', str(source) + '/', str(target) + '/'])
    changes = run(['rsync', '-aHAXnci', '--numeric-ids', '--delete', str(source) + '/', str(target) + '/'])
    assert not changes, 'Copied workspace differs; original retained'
    assert source.stat().st_uid == target.stat().st_uid
    assert source.stat().st_gid == target.stat().st_gid
    assert source.stat().st_mode & 0o7777 == target.stat().st_mode & 0o7777


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--journal', type=Path, required=True)
    args.add_argument('--resume', action='store_true')
    cfg = args.parse_args()
    assert os.geteuid() == 0 and run(['hostname']) == 'yunipals-main'
    protected(VOLUME)
    assert VOLUME.is_mount() and VOLUME.stat().st_dev != Path('/').stat().st_dev
    assert any(len(row) > 1 and row[1] == str(VOLUME)
               for row in (line.split() for line in Path('/etc/fstab').read_text().splitlines())
               if row and not row[0].startswith('#')), 'Persistent volume required'
    assert WORK.exists() == cfg.resume, 'Use the recorded journal to resume a partial migration'
    cfg.journal.mkdir(mode=0o700, exist_ok=cfg.resume)
    WORK.mkdir(mode=0o755, exist_ok=cfg.resume)
    timers = json.loads((cfg.journal / 'before.json').read_text())['activeTimers'] if cfg.resume else []
    services = [name + '.service' for _, names in ROOTS.values() for name in names]
    for unit in services:
        assert state(unit) in ('inactive', 'failed'), 'Wait for active backups to finish'
        timer = unit.removesuffix('.service') + '.timer'
        if state(timer) == 'active':
            if timer not in timers:
                timers.append(timer)
    record(cfg.journal / ('resume-timers.json' if cfg.resume else 'before.json'), {'roots': ROOTS, 'activeTimers': timers})
    for timer in timers:
        run(['systemctl', 'stop', timer])
    # Do not interrupt a backup that raced the first state capture.
    assert all(state(unit) in ('inactive', 'failed') for unit in services)
    for path, (name, units) in ROOTS.items():
        source = Path(path)
        protected(source)
        target = WORK / name
        if (cfg.journal / (name + '-completed.json')).exists():
            assert cfg.resume and source.is_mount() and os.path.samefile(source, target)
            for unit in units:
                directory = Path('/etc/systemd/system') / (unit + '.service.d')
                directory.mkdir(exist_ok=True)
                dropin = directory / '91-shared-backup-storage.conf'
                expected = f'[Unit]\nRequiresMountsFor={source}\n\n[Service]\nEnvironment=TMPDIR={source}/.temporary\n'
                if dropin.exists():
                    assert dropin.read_text() == expected
                else:
                    dropin.write_text(expected)
            continue
        assert source.stat().st_dev == Path('/').stat().st_dev
        assert not (cfg.journal / (name + '-intent.json')).exists(), 'Inspect an incomplete mount intent before resuming'
        print(json.dumps({'phase': 'copy-and-checksum', 'workspace': name}), flush=True)
        copy_checked(source, target, resume=cfg.resume)
        mount_name = run(['systemd-escape', '--path', '--suffix=mount', str(source)])
        unit_file = Path('/etc/systemd/system') / mount_name
        assert not unit_file.exists()
        text = (f'[Unit]\nDescription=Yunipals {name} backup workspace on project volume\n'
                f'RequiresMountsFor={VOLUME}\n\n[Mount]\nWhat={target}\nWhere={source}\n'
                'Type=none\nOptions=bind\n\n[Install]\nWantedBy=local-fs.target\n')
        unit_file.write_text(text)
        os.chmod(unit_file, 0o644)
        for unit in units:
            directory = Path('/etc/systemd/system') / (unit + '.service.d')
            directory.mkdir(exist_ok=True)
            dropin = directory / '91-shared-backup-storage.conf'
            assert not dropin.exists()
            dropin.write_text(f'[Unit]\nRequiresMountsFor={source}\n\n[Service]\nEnvironment=TMPDIR={source}/.temporary\n')
        original = source.with_name(source.name + '.before-volume-20261103')
        assert not original.exists()
        record(cfg.journal / (name + '-intent.json'), {'source': str(source), 'target': str(target), 'original': str(original), 'mountUnit': mount_name})
        source.rename(original)
        source.mkdir(mode=original.stat().st_mode & 0o777)
        os.chown(source, original.stat().st_uid, original.stat().st_gid)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', '--now', mount_name])
        assert source.is_mount() and source.stat().st_dev == VOLUME.stat().st_dev
        assert not run(['rsync', '-aHAXnci', '--numeric-ids', '--delete', str(original) + '/', str(source) + '/'])
        assert original.stat().st_dev == Path('/').stat().st_dev and not original.is_symlink()
        shutil.rmtree(original)
        if units:
            temporary = source / '.temporary'
            temporary.mkdir(mode=0o700)
            os.chown(temporary, source.stat().st_uid, source.stat().st_gid)
        record(cfg.journal / (name + '-completed.json'), {'copiedAndVerified': True, 'mounted': True, 'originalCopyRemoved': True})
        print(json.dumps({'phase': 'mounted-and-verified', 'workspace': name}), flush=True)
    # Preserve the completed disposable restore/test cluster off the main disk.
    assert FIXTURE.is_dir() and not (FIXTURE / 'data/postmaster.pid').exists()
    target = WORK / 'completed-test-cluster'
    print(json.dumps({'phase': 'copy-and-checksum', 'workspace': 'completed-test-cluster'}), flush=True)
    copy_checked(FIXTURE, target)
    assert FIXTURE.stat().st_dev == Path('/').stat().st_dev
    account = FIXTURE.stat()
    shutil.rmtree(FIXTURE)
    FIXTURE.mkdir(mode=account.st_mode & 0o777)
    os.chown(FIXTURE, account.st_uid, account.st_gid)
    for timer in timers:
        run(['systemctl', 'start', timer])
    result = {'completed': True, 'backupDirectories': list(ROOTS), 'fixtureData': str(target / 'data'), 'restoredTimers': timers,
              'filesystems': {str(p): {'device': p.stat().st_dev, 'freeBytes': os.statvfs(p).f_bavail * os.statvfs(p).f_frsize} for p in [Path('/'), VOLUME]}}
    record(cfg.journal / 'result.json', result)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
