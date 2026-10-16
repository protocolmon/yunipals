"""Verify and stage one immutable Arena archive. Never starts services or broadcasts."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--sha256', required=True)
args = parser.parse_args()
assert os.geteuid() == 0 and os.uname().nodename == 'yunipals-main'
archive = args.archive.resolve()
releases = Path('/srv/yunipals-arena/releases')
assert archive.parent == releases and archive.is_file()
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert digest(archive) == args.sha256, 'Archive checksum differs'
target = releases / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d') + '-' + args.sha256[:8])
assert not target.exists(), 'Stage already exists; inspect instead of overwriting'
target.mkdir(mode=0o755)
with tarfile.open(archive) as tar:
    for member in tar.getmembers():
        path = PurePosixPath(member.name)
        assert path.parts[0] == 'release' and not path.is_absolute() and '..' not in path.parts
        assert member.isfile() or member.isdir() or member.issym(), 'Unsupported archive entry'
        assert not path.name.endswith(('.env', '.key', '.pem')) and 'keystores' not in path.parts
        if member.issym():
            assert not PurePosixPath(member.linkname).is_absolute()
            resolved = posixpath.normpath(posixpath.join(str(path.parent), member.linkname))
            assert resolved.startswith('release/'), 'External archive symlink'
    tar.extractall(target, filter='data')
release = target / 'release'
manifest = json.loads((release / 'release-manifest.json').read_text())
assert manifest['credentialsIncluded'] is False
for name, checksum in manifest['files'].items():
    path = release / name
    assert path.resolve().is_relative_to(release) and path.is_file() and not path.is_symlink()
    assert digest(path) == checksum, f'Release file differs: {name}'
for name, link in manifest['symlinks'].items():
    path = release / name
    assert path.is_symlink() and path.readlink().as_posix() == link
    assert path.resolve().is_relative_to(release) and path.exists()
expected = set(manifest['files']) | set(manifest['symlinks']) | {'release-manifest.json'}
actual = {str(p.relative_to(release)) for p in release.rglob('*') if p.is_file() or p.is_symlink()}
assert expected == actual, 'Unlisted release files'
public = release / 'docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public'
images = Path('/srv/yunipals-islands/v2/public/images').resolve()
assert images.is_relative_to('/srv/yunipals-islands/v2') and images.is_dir()
(public / 'images').symlink_to(images, target_is_directory=True)
node = '/srv/yunipals-arena/runtime/node-v24.18.1'
result = subprocess.run(['runuser', '-u', 'yunipals-arena', '--', 'env',
    'ARENA_REPOSITORY_ROOT=' + str(release), node,
    str(release / 'apps/yunipals-market-api/dist/arena-inspect.mjs')],
    capture_output=True, text=True, timeout=60)
assert result.returncode == 0, 'Offline service-user verification failed; details suppressed'
verification = json.loads(result.stdout)
assert verification['externalRequests'] == 0 and verification['publishedImageChecksumsVerified']
published = json.loads((release / 'docs/arena/mainnet-rules-manifest-v1.json').read_text())
assert published['rulesHash'] == verification['rulesHash']
report = {'version': 'arena-server-stage-v4', 'release': str(release),
    'archiveSha256': args.sha256, 'archiveBytes': archive.stat().st_size,
    'credentialsIncluded': False, 'entriesEnabled': False, 'serverActivation': False,
    'servicesStarted': False, 'transactionsBroadcast': 0, 'serviceUserReadCheck': True,
    'verification': verification}
(target / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
