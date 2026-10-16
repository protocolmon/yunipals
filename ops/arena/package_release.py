"""Build an allowlisted Arena server archive from the current compiled checkout.

No credentials, private job folders, frontend media archive or absolute symlinks.
Published island images are reused and checked on the production server.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--dependencies', type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
output = args.output.resolve()
assert output.is_relative_to('/tmp') and not output.exists(), 'Use a new /tmp output directory'
stage = output / 'release'
stage.mkdir(parents=True)


def copy(source, target):
    source = root / source
    assert source.is_file(), f'Missing release input: {source}'
    assert not source.name.endswith(('.env', '.key', '.pem')), 'Private/configuration file excluded'
    target = stage / target
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    # The deployer unlock helper is an interactive, root-only executable.
    # Preserve that contract in packaged releases, not just the installed copy.
    target.chmod(0o700 if source.name == 'unlock-deployer.sh' else 0o644)


api = 'apps/yunipals-market-api'
for file in sorted((root / api / 'dist').glob('arena-*.mjs')):
    copy(str(file.relative_to(root)), f'{api}/dist/{file.name}')
assert (stage / api / 'dist/arena-monitor.mjs').is_file(), 'Build the updated API first'
copy('ops/arena/release-package.json', f'{api}/package.json')
copy('ops/arena/release-lock.yaml', f'{api}/pnpm-lock.yaml')
dependencies = args.dependencies.resolve()
assert dependencies.name == 'node_modules' and dependencies.is_dir()
assert (dependencies.parent / 'package.json').read_bytes() == (stage / api / 'package.json').read_bytes()
assert (dependencies.parent / 'pnpm-lock.yaml').read_bytes() == (stage / api / 'pnpm-lock.yaml').read_bytes()
assert all(p.resolve().is_relative_to(dependencies) for p in dependencies.rglob('*') if p.is_symlink()), 'External dependency symlink'
assert not any(p.name.endswith(('.env', '.key', '.pem')) for p in dependencies.rglob('*') if p.is_file())
shutil.copytree(dependencies, stage / api / 'node_modules', symlinks=True)
for directory in ['docs/arena/rules-v2', 'docs/arena/identity-registry-v1', 'ops/arena']:
    for file in sorted((root / directory).rglob('*')):
        if file.is_file() and not file.is_symlink() and '__pycache__' not in file.parts:
            copy(str(file.relative_to(root)), str(file.relative_to(root)))
copy('docs/arena/mainnet-rules-manifest-v1.json', 'docs/arena/mainnet-rules-manifest-v1.json')
copy('docs/islands/arena-reveal-results-v1/assignments.json', 'docs/islands/arena-reveal-results-v1/assignments.json')
published = 'docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public'
for directory in ['metadata', 'profiles']:
    for file in sorted((root / published / directory).glob('*.json')):
        copy(str(file.relative_to(root)), str(file.relative_to(root)))
for name in ['media_tools.py', 'referee.py', 'render.py', 'produce.py', 'validate_candidate.py']:
    copy(f'scripts/arena/{name}', f'scripts/arena/{name}')
for name in ['split-in-synapse-original.mp3', 'CREDITS.txt', 'music-source.json']:
    source = f'docs/islands/race-film-v4/audio/{name}'
    if (root / source).is_file():
        copy(source, source)
assert (stage / 'docs/islands/race-film-v4/audio/split-in-synapse-original.mp3').is_file()
for directory in ['src', 'script', 'lib']:
    for file in sorted((root / 'contracts/arena' / directory).rglob('*')):
        if file.is_file() and not file.is_symlink() and '.git' not in file.parts and not file.name.endswith(('.env', '.key', '.pem')):
            copy(str(file.relative_to(root)), str(file.relative_to(root)))
copy('contracts/arena/foundry.toml', 'contracts/arena/foundry.toml')
for name in ['YunipalsArena.abi.json', 'constructor-arguments.hex', 'creation-data.hex']:
    copy(f'contracts/arena/config/{name}', f'contracts/arena/config/{name}')
artifact = 'contracts/arena/out/YunipalsArena.sol/YunipalsArena.json'
copy(artifact, artifact)
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
files = {str(p.relative_to(stage)): digest(p) for p in sorted(stage.rglob('*')) if p.is_file() and not p.is_symlink()}
links = {str(p.relative_to(stage)): p.readlink().as_posix() for p in sorted(stage.rglob('*')) if p.is_symlink()}
manifest = {'version': 'arena-server-release-v1', 'files': files, 'symlinks': links, 'credentialsIncluded': False,
            'publishedIslandImages': 'reuse verified production v2 images', 'entriesEnabled': False}
(stage / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
archive = output / 'arena-release.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    tar.add(stage, arcname='release', recursive=True)
report = {'archive': str(archive), 'archiveSha256': digest(archive), 'bytes': archive.stat().st_size,
          'files': len(files), 'credentialsIncluded': False}
(output / 'package-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
