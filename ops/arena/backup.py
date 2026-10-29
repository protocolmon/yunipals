"""Encrypted Arena snapshots, plus an optional isolated storage-box restore drill.

Uses the installed production backup transport and encryption credentials. Never
starts workers. Every restored database is quarantined before it may be examined.
Keys are archived separately; the storage box never receives the GPG passphrase.
"""
import argparse
import datetime
import fcntl
import signal
import traceback
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile

from backup_policy import atomic_json, dump_tables, expired_snapshots, valid_prune_files, anime_backup_files


def interrupted(signum, frame):
    raise RuntimeError('Backup interrupted')


signal.signal(signal.SIGTERM, interrupted)
attempt = datetime.datetime.now(datetime.timezone.utc).isoformat()
try:
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', default=os.environ.get('ARENA_BACKUP_RELEASE'))
    parser.add_argument('--drill', action='store_true')
    args = parser.parse_args()
    assert os.geteuid() == 0 and os.uname().nodename == 'yunipals-main'
    os.umask(0o077)
    lock = open('/var/lib/yunipals-arena/backups/backup.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX)
    attempt = datetime.datetime.now(datetime.timezone.utc).isoformat()
    atomic_json(Path('/var/lib/yunipals-arena/backups/latest-attempt.json'), {'status': 'running', 'createdAt': attempt})
    current = Path('/srv/yunipals-arena/current')
    release = current.resolve() if current.exists() else Path(args.release).resolve()
    assert release.is_relative_to('/srv/yunipals-arena/releases') and release.is_dir()
    root = Path('/var/lib/yunipals-arena')
    private = Path('/etc/yunipals-arena')
    now = datetime.datetime.now(datetime.timezone.utc)
    stamp = now.strftime('%Y%m%dT%H%M%SZ')
    spec = importlib.util.spec_from_file_location('existing_backup', '/opt/yunipals-market-backup-recovery/20261012/offhost-backup-agent.py')
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)
    config = {}
    for line in Path('/etc/yunipals-marketplace/production/backup/offhost.env').read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            words = shlex.split(value)
            assert len(words) == 1
            config[key] = words[0]
    assert re.fullmatch(r'[A-Za-z0-9._-]+@[A-Za-z0-9.-]+', config['MARKET_BACKUP_SSH_TARGET'])
    prefix = config['MARKET_BACKUP_REMOTE_ROOT'].rstrip('/')
    assert re.fullmatch(r'[A-Za-z0-9._/-]+', prefix) and '..' not in Path(prefix).parts and not prefix.startswith('/')
    arena_prefix = prefix + '/arena/v2'
    remote_dir = arena_prefix + '/snapshots/' + stamp
    remote = backup.Remote(config)


    def sql(statement, database='postgres'):
        result = subprocess.run(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-p', '15438', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'],
                                input=statement, text=True, capture_output=True, timeout=60)
        assert result.returncode == 0, 'Database recovery check failed; output suppressed'
        return result.stdout.strip()


    def dump(database, target):
        with target.open('wb') as out:
            result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-p', '15438', '-Fc', '--no-owner', '--no-privileges', database],
                                    stdout=out, stderr=subprocess.PIPE, timeout=300)
        assert result.returncode == 0, 'Database dump failed; output suppressed'


    def restore(source, database):
        with source.open('rb') as data:
            result = subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_restore', '-p', '15438', '--exit-on-error', '--no-owner', '--no-privileges', '-d', database],
                                    stdin=data, capture_output=True, timeout=300)
        assert result.returncode == 0, 'Database restore failed; output suppressed'
        sql("UPDATE yunipals_arena.deployment SET halted=true,halt_reason='RESTORE_QUARANTINE'; DELETE FROM yunipals_arena.capacity;", database)


    def decrypt(source, target, temporary):
        key = temporary / 'recovery-passphrase'
        key.write_text(config['MARKET_BACKUP_ENCRYPTION_PASSPHRASE'] + '\n')
        key.chmod(0o600)
        try:
            backup.run(['gpg', '--batch', '--yes', '--no-options', '--homedir', str(temporary), '--pinentry-mode', 'loopback', '--passphrase-file', str(key), '--output', str(target), '--decrypt', str(source)])
        finally:
            key.unlink()


    def send(source, name):
        remote.upload(source, remote_dir + '/' + name)
        remote.command('chmod 600 ' + shlex.quote(remote_dir + '/' + name))


    def receive(name, target):
        backup.run(['sshpass', '-e', 'scp', '-P', str(config['MARKET_BACKUP_SSH_PORT']), *remote.options,
                    remote.target + ':' + remote_dir + '/' + name, str(target)], env=remote.environment)


    cache_path = root / 'backups' / 'objects.json'
    object_cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}


    def object_download(path, target):
        assert path.startswith(arena_prefix + '/objects/') and re.fullmatch(r'[A-Za-z0-9._/-]+', path)
        assert '..' not in Path(path).parts
        backup.run(['sshpass', '-e', 'scp', '-P', str(config['MARKET_BACKUP_SSH_PORT']), *remote.options,
                    remote.target + ':' + path, str(target)], env=remote.environment, timeout=600)


    def store_object(source, kind, temporary):
        digest = backup.digest(source)
        path = arena_prefix + '/objects/' + kind + '/' + digest + '.gpg'
        # The storage box exposes a restricted shell; use its supported ls and
        # sha256sum commands instead of shell conditionals.
        listing = remote.command('ls -1 ' + shlex.quote(str(Path(path).parent))).splitlines()
        existing = remote.command('sha256sum ' + shlex.quote(path)) if Path(path).name in listing else ''
        cached = object_cache.get(path)
        if existing:
            cipher_hash = existing.split()[0]
            if cached:
                assert cached['cipherSha256'] == cipher_hash, 'Stored object checksum changed'
                value = cached
            else:
                # A lost local cache must not cause unverified reuse or overwrite.
                downloaded = temporary / 'existing.gpg'
                recovered = temporary / 'existing.plain'
                object_download(path, downloaded)
                assert backup.digest(downloaded) == cipher_hash
                decrypt(downloaded, recovered, temporary)
                assert backup.digest(recovered) == digest
                value = {'path': path, 'sha256': digest, 'cipherSha256': cipher_hash, 'bytes': downloaded.stat().st_size}
                downloaded.unlink()
                recovered.unlink()
            report['objectsReused'] += 1
        else:
            encrypted = temporary / 'object.gpg'
            backup.encrypt(source, encrypted, config['MARKET_BACKUP_ENCRYPTION_PASSPHRASE'], compress=True)
            assert backup.digest(source) == digest, 'Source changed during backup'
            remote.upload(encrypted, path)
            remote.command('chmod 600 ' + shlex.quote(path))
            value = {'path': path, 'sha256': digest, 'cipherSha256': backup.digest(encrypted), 'bytes': encrypted.stat().st_size}
            encrypted.unlink()
            report['objectsUploaded'] += 1
        object_cache[path] = value
        atomic_json(cache_path, object_cache)
        return value


    def recover_object(value, target, temporary):
        downloaded = temporary / 'recover-object.gpg'
        object_download(value['path'], downloaded)
        assert backup.digest(downloaded) == value['cipherSha256']
        decrypt(downloaded, target, temporary)
        assert backup.digest(target) == value['sha256']
        downloaded.unlink()


    created_databases = []
    report = {'version': 'arena-storage-backup-v2', 'createdAt': now.isoformat(), 'remoteDirectory': remote_dir,
              'keysStoredSeparately': True, 'allUploadsEncrypted': True, 'workersStarted': False,
              'providerRequests': 0, 'transactionsBroadcast': 0, 'restoreDrill': False,
              'objectsUploaded': 0, 'objectsReused': 0, 'snapshotRetentionDays': 30}
    with tempfile.TemporaryDirectory(prefix='arena-backup-', dir=root / 'backups') as location:
        temporary = Path(location)
        database_dump = temporary / 'arena.dump'
        dump('yunipals_arena', database_dump)
        media = root / 'media'
        paths = sorted(media.rglob('*'))
        assert all(not p.is_symlink() for p in paths), 'Unexpected symlink in private media'
        files = [p for p in paths if p.is_file()]
        directories = [arena_prefix, arena_prefix + '/objects', arena_prefix + '/snapshots', remote_dir]
        directories += [arena_prefix + '/objects/' + kind for kind in ['media', 'keys', 'release', 'runtime', 'tools', 'anime']]
        remote.command('mkdir -p ' + ' '.join(map(shlex.quote, directories)))
        remote.command('chmod 700 ' + ' '.join(map(shlex.quote, directories)))
        # Stable tar metadata permits reuse until a recovery key changes.
        key_names = ['admission.key', 'referee.key', 'operator.key', 'strategy-encryption.key', 'service-identities.json']
        secrets_tar = temporary / 'keys.tar'
        with tarfile.open(secrets_tar, 'w') as archive:
            for name in key_names:
                source = private / name
                assert source.is_file() and not source.is_symlink()
                assert source.stat().st_uid == 0 and source.stat().st_mode & 0o077 == 0
                archive.add(source, arcname=name)
        keys = store_object(secrets_tar, 'keys', temporary)
        verification = json.loads((release.parent / 'verification.json').read_text())
        release_archives = [p for p in release.parent.parent.glob('*.tar.gz')
                            if backup.digest(p) == verification['archiveSha256']]
        assert len(release_archives) == 1, 'Exact release archive required'
        release_archive = release_archives[0]
        with tarfile.open(release_archive) as archive:
            assert not any(Path(member.name).name.endswith(('.env', '.key')) or
                           'keystores' in Path(member.name).parts for member in archive.getmembers())
        tools_tar = temporary / 'tools.tar'
        with tarfile.open(tools_tar, 'w') as archive:
            archive.add('/opt/yunipals-market-backup-recovery/20261012/offhost-backup-agent.py', arcname='offhost-backup-agent.py')
            for path in sorted(Path(__file__).parent.iterdir()):
                if path.name in {'backup.py', 'backup_monitor.py', 'backup_policy.py'} or path.name.startswith('yunipals-arena-backup'):
                    if path.is_file():
                        archive.add(path, arcname=path.name)
        recovery = {'release': store_object(release_archive, 'release', temporary),
                    'node': store_object(Path('/srv/yunipals-arena/runtime/node-v24.18.1'), 'runtime', temporary),
                    'tools': store_object(tools_tar, 'tools', temporary)}
        metadata_backup = Path('/srv/yunipals-islands/v2/storage-box-verification.json')
        manifest = {'version': 'arena-recovery-v2', 'createdAt': now.isoformat(), 'release': str(release),
                    'databaseSha256': backup.digest(database_dump),
                    'databaseTables': dump_tables(backup.run(['pg_restore', '--list', str(database_dump)])),
                    'mediaFiles': {str(p.relative_to(media)): store_object(p, 'media', temporary) for p in files},
                    'animeFiles': {name: store_object(path, 'anime', temporary) for name, path in anime_backup_files().items()},
                    'keys': keys, 'recovery': recovery,
                    'islandsBackup': json.loads(metadata_backup.read_text()),
                    'restoreRule': 'Keep all workers stopped. Restore quarantined. Compare canonical chain and provider tasks before resuming. Never generate replacement UUIDs for missing or uncertain jobs.'}
        (temporary / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        data_tar = temporary / 'data.tar.gz'
        with tarfile.open(data_tar, 'w:gz') as archive:
            archive.add(database_dump, arcname='arena.dump')
            archive.add(temporary / 'manifest.json', arcname='manifest.json')
        encrypted = temporary / 'data.tar.gz.gpg'
        backup.encrypt(data_tar, encrypted, config['MARKET_BACKUP_ENCRYPTION_PASSPHRASE'])
        send(encrypted, encrypted.name)
        report['data'] = {'sha256': backup.digest(encrypted), 'bytes': encrypted.stat().st_size}
        report['releaseArchiveSha256'] = verification['archiveSha256']
        report['mediaFileCount'] = len(files)
        if args.drill:
            try:
                download = temporary / 'data.download.gpg'
                receive('data.tar.gz.gpg', download)
                assert backup.digest(download) == report['data']['sha256']
                restored = temporary / 'data.download.tar.gz'
                decrypt(download, restored, temporary)
                with tarfile.open(restored) as archive:
                    assert set(archive.getnames()) == {'arena.dump', 'manifest.json'}
                    assert all(member.isfile() for member in archive.getmembers())
                    assert json.load(archive.extractfile('manifest.json')) == manifest
                    recovered_dump = temporary / 'download.dump'
                    recovered_dump.write_bytes(archive.extractfile('arena.dump').read())
                    assert backup.digest(recovered_dump) == manifest['databaseSha256']
                restored_keys = temporary / 'recovered-keys.tar'
                recover_object(keys, restored_keys, temporary)
                with tarfile.open(restored_keys) as archive:
                    assert set(archive.getnames()) == set(key_names)
                    assert all(member.isfile() for member in archive.getmembers())
                    for member in archive.getmembers():
                        content = archive.extractfile(member).read()
                        assert content == (private / member.name).read_bytes()
                        if member.name == 'strategy-encryption.key':
                            (temporary / member.name).write_bytes(content)
                for value in [*manifest['mediaFiles'].values(), *manifest.get('animeFiles', {}).values(), *recovery.values()]:
                    recovered = temporary / 'verified-object'
                    recover_object(value, recovered, temporary)
                    recovered.unlink()
                # Restore the actual snapshot to a unique non-production database.
                suffix = now.strftime('%Y%m%d%H%M%S')
                source_db = 'yunipals_arena_restore_' + suffix + '_source'
                target_db = 'yunipals_arena_restore_' + suffix + '_target'
                for db in [source_db, target_db]:
                    assert not sql("SELECT datname FROM pg_database WHERE datname='" + db + "';")
                    sql('CREATE DATABASE ' + db + ';')
                    created_databases.append(db)
                restore(recovered_dump, source_db)
                restored_tables = sql("SELECT tablename FROM pg_tables WHERE schemaname='yunipals_arena' ORDER BY tablename;", source_db).splitlines()
                assert restored_tables == manifest['databaseTables'], 'Restored table inventory differs from dump'
                tables = len(restored_tables)
                # Add only a synthetic unfinished job to the isolated copy. Use the
                # actual encryption format and key, then round-trip it via the box.
                node = '/srv/yunipals-arena/runtime/node-v24.18.1'
                program = """const fs=require('fs'),c=require('crypto');
    const key=Buffer.from(fs.readFileSync('/etc/yunipals-arena/strategy-encryption.key','utf8').trim(),'hex');
    const nonce=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,nonce);
    cipher.setAAD(Buffer.from('restore-fixture/1/0'));
    const data=Buffer.concat([cipher.update(JSON.stringify({strategy:'Defend, then counter.'}),'utf8'),cipher.final()]);
    process.stdout.write(Buffer.concat([nonce,cipher.getAuthTag(),data]).toString('base64'));"""
                ciphertext = backup.run([node, '-e', program])
                assert re.fullmatch(r'[A-Za-z0-9+/=]+', ciphertext)
                task = '00000000-0000-4000-8000-000000000001'
                sql("INSERT INTO yunipals_arena.deployment(id,contract,start_block,halted,halt_reason) VALUES('restore-fixture','0x1111111111111111111111111111111111111111',1,true,'RESTORE_QUARANTINE');\n"
                    "INSERT INTO yunipals_arena.tournament(deployment,id,state) VALUES('restore-fixture',1,'{\"phase\":\"resolving\"}');\n"
                    "INSERT INTO yunipals_arena.frozen_input(deployment,tournament_id,input_hash,ciphertext) VALUES('restore-fixture',1,'fixture-hash','" + ciphertext + "');\n"
                    "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,kind,asset,request_id,state,provider_id,request,reserved_microusd) VALUES('restore-fixture',1,'video','sf1-opening','" + task + "','submitted','saved-provider-task','{}',100000);", source_db)
                fixture_dump = temporary / 'unfinished.dump'
                dump(source_db, fixture_dump)
                fixture_encrypted = temporary / 'unfinished.dump.gpg'
                backup.encrypt(fixture_dump, fixture_encrypted, config['MARKET_BACKUP_ENCRYPTION_PASSPHRASE'])
                send(fixture_encrypted, 'restore-drill.dump.gpg')
                fixture_download = temporary / 'unfinished.download.gpg'
                receive('restore-drill.dump.gpg', fixture_download)
                assert backup.digest(fixture_download) == backup.digest(fixture_encrypted)
                fixture_restored = temporary / 'unfinished.download.dump'
                decrypt(fixture_download, fixture_restored, temporary)
                restore(fixture_restored, target_db)
                saved = sql("SELECT request_id||'|'||state||'|'||provider_id FROM yunipals_arena.provider_task WHERE deployment='restore-fixture';", target_db)
                assert saved == task + '|submitted|saved-provider-task'
                restored_ciphertext = sql("SELECT ciphertext FROM yunipals_arena.frozen_input WHERE deployment='restore-fixture';", target_db)
                assert restored_ciphertext == ciphertext
                verification = """const fs=require('fs'),c=require('crypto');
    const key=Buffer.from(fs.readFileSync(process.argv[1],'utf8').trim(),'hex');
    const data=Buffer.from(fs.readFileSync(0,'utf8').trim(),'base64'),cipher=c.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    cipher.setAAD(Buffer.from('restore-fixture/1/0'));cipher.setAuthTag(data.subarray(12,28));
    const value=JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString());
    if(value.strategy!=='Defend, then counter.') process.exit(2);"""
                checked = subprocess.run([node, '-e', verification, str(temporary / 'strategy-encryption.key')], input=restored_ciphertext, text=True, capture_output=True, timeout=20)
                assert checked.returncode == 0, 'Restored strategy did not decrypt'
                assert sql("SELECT bool_and(halted) FROM yunipals_arena.deployment;", target_db) == 't'
                assert sql('SELECT count(*) FROM yunipals_arena.capacity;', target_db) == '0'
                report.update(restoreDrill=True, restoredTables=tables, privateKeysRoundTripVerified=True,
                              encryptedStrategyRecovered=True, unfinishedProviderIdPreserved=True,
                              restoredDeploymentQuarantined=True, recoveryBinariesVerified=True, testData='synthetic unfinished job in isolated database; no production tournament modified')
            finally:
                for db in reversed(created_databases):
                    sql('DROP DATABASE ' + db + ';')
        report.update(status='success', completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        atomic_json(temporary / 'complete.json', report)
        backup.encrypt(temporary / 'complete.json', temporary / 'complete.json.gpg', config['MARKET_BACKUP_ENCRYPTION_PASSPHRASE'])
        send(temporary / 'complete.json.gpg', 'complete.json.gpg')
        atomic_json(root / 'backups' / 'receipts' / (stamp + '.json'), report)
        atomic_json(root / 'backups' / 'latest-success.json', report)
        if args.drill:
            atomic_json(root / 'backups' / 'latest-restore-drill.json', report)
        # Prune only our v2 snapshot directories, after a verified new backup.
        snapshot_root = arena_prefix + '/snapshots'
        expired = expired_snapshots(remote.command('ls -1 ' + shlex.quote(snapshot_root)).splitlines(), now)
        plan = []
        for name in expired:
            directory = snapshot_root + '/' + name
            members = remote.command('ls -1A ' + shlex.quote(directory)).splitlines()
            assert valid_prune_files(members), 'Unknown old snapshot files; pruning refused'
            plan.append((name, directory, members))
        for name, directory, members in plan:
            for member in members:
                remote.command('rm ' + shlex.quote(directory + '/' + member))
            remote.command('rmdir ' + shlex.quote(directory))
            (root / 'backups' / 'receipts' / (name + '.json')).unlink(missing_ok=True)
        report['expiredSnapshotsRemoved'] = len(plan)
        atomic_json(root / 'backups' / 'latest-attempt.json', report)
        print(json.dumps(report, indent=2))
except Exception as error:
    # Exception messages/tracebacks may include sensitive subprocess arguments.
    frames = traceback.extract_tb(error.__traceback__)
    report = {'status': 'failed', 'createdAt': attempt, 'errorType': type(error).__name__,
              'sourceLine': next((frame.lineno for frame in reversed(frames) if frame.filename == __file__), None)}
    atomic_json(Path('/var/lib/yunipals-arena/backups/latest-attempt.json'), report)
    print(json.dumps(report))
    raise SystemExit(1)
