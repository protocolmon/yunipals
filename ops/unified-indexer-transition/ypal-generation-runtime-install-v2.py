#!/usr/bin/env python3
"""Install only the exact native generation and leaderboard bundles, reusing acknowledged dependencies.

Default is read-only. Installation creates one fresh immutable artifact and
receipt; no application imports, dependency installs, SQL or service changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import types

FORMAT = 'yunipals-ypal-generation-runtime-install-v2'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SHARED_SHA = '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416'
DIGEST = 'f81cdb76ae45794599c723085aebd2b9c5e377975dc16d2e1461236229d4b952'
MANIFEST_SHA = '85acb526541fe09acbfd17a87a14be494c02123a61501a41b01e91f1d9c01188'
META_SHA = 'a959bc90aeff7ae85360c35e4133a58754cdf6f8fdec9bd7c330d8a02933bf28'
INCOMING = OPS / 'ypal-generation-snapshot-runtime-v2'
TARGET = Path('/opt/yunipals-unified/nonmarket-consumer-releases') / DIGEST
BASE = Path('/var/backups/yunipals-ypal-generation-runtime-install-v2-20261024')
ENTRIES = ('generation-prepare', 'generation-refresh', 'leaderboard-worker', 'leaderboard-only')
OUTPUTS = {f'dist/{name}.mjs{suffix}' for name in ENTRIES for suffix in ('', '.map')}


def fail(code):
    raise RuntimeError(code)


def shared():
    path = OPS / 'retained-workers-stage-v1.py'
    for item in [*path.parents, path]:
        info = item.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            fail('protected_fixed_shared_helper_required')
    raw = path.read_bytes()
    if len(raw) > 100000 or hashlib.sha256(raw).hexdigest() != SHARED_SHA:
        fail('exact_fixed_shared_helper_required')
    value = types.ModuleType('nonmarket_runtime_primitives')
    value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__)
    return value


def directory(path):
    for item in [*Path(path).parents, Path(path)]:
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            fail('protected_real_directory_required')


def payload(m, root):
    manifest = m.document(root / 'manifest.json', MANIFEST_SHA)
    if (manifest.get('format') != 'yunipals-generation-snapshot-runtime-v2' or manifest.get('artifactDigest') != DIGEST
            or manifest.get('predecessorSourceDigest') != m.SOURCE or manifest.get('scope') != 'native_generation_preparation_snapshot_and_leaderboard_completion'
            or set(row['path'] for row in manifest['files']) != OUTPUTS or len(manifest['files']) != 8):
        fail('exact_nonmarket_only_manifest_required')
    files = {'manifest.json': m.protected(root / 'manifest.json'),
             'metafile.json': m.protected(root / 'metafile.json')}
    if m.sha(files['metafile.json']) != META_SHA:
        fail('exact_compiler_metafile_required')
    for row in manifest['files']:
        raw = m.protected(root / row['path'], 4000000)
        if len(raw) != row['bytes'] or m.sha(raw) != row['sha256']:
            fail('exact_compiled_output_required')
        files[row['path']] = raw
    return manifest, files


def dependencies(m, manifest, meta):
    accepted = m.artifact()
    expected = m.ROOT / 'apps/yunipals-indexer/node_modules'
    if manifest['requiredRuntimeDependencyTarget'] != str(expected):
        fail('acknowledged_dependency_target_required')
    directory(expected)
    if m.sha(m.protected(m.NODE, 200000000)) != manifest['compiler']['nodeSha256']:
        fail('exact_compiler_node_runtime_required')
    # Resolve only package entry names using Node's built-in loader; do not
    # import application/dependency code or rebuild the accepted dependency tree.
    requests = sorted({(item['kind'], item['path']) for output in meta['outputs'].values()
                       for item in output.get('imports', [])
                       if item.get('external') and not item['path'].startswith('node:')})
    if any(kind not in ('import-statement', 'require-call') for kind, _ in requests):
        fail('known_external_resolution_kinds_required')
    # The unchanged metadata legacy.cjs modules resolve require conditions,
    # whereas ESM imports resolve import conditions; verify both actual entries.
    js = ("import{pathToFileURL,fileURLToPath}from'node:url';import{createRequire}from'node:module';"
          "const base=pathToFileURL(process.argv[1]).href;const require=createRequire(base);"
          "console.log(JSON.stringify(JSON.parse(process.argv[2]).map(([kind,name])=>({kind,name,"
          "path:kind==='require-call'?require.resolve(name):fileURLToPath(import.meta.resolve(name,base))}))));")
    rows = json.loads(m.run([m.NODE, '--experimental-import-meta-resolve', '--input-type=module', '-e', js,
                            str(expected.parent / 'package.json'), json.dumps(requests)]))
    inventory_raw = m.protected(m.ARTIFACT.parent / 'runtime-supplement.inventory.json', 40000000)
    if m.sha(inventory_raw) != accepted['runtimeInventorySha256']:
        fail('acknowledged_runtime_inventory_changed')
    inventory = json.loads(inventory_raw)
    entries = {row['path']: row for row in inventory['entries']}
    verified = {}
    for row in rows:
        path = Path(row['path'])
        try:
            rel = str(path.relative_to(m.ROOT))
        except ValueError:
            fail('dependency_resolution_outside_acknowledged_runtime')
        entry = entries.get(rel, {})
        raw = m.protected(path, 4000000)
        if entry.get('type') != 'file' or entry.get('sha256') != m.sha(raw) or entry.get('bytes') != len(raw):
            fail('acknowledged_dependency_entry_changed')
        verified[row['kind'] + ':' + row['name']] = {'path': rel, 'sha256': m.sha(raw)}
    if set(verified) != {kind + ':' + name for kind, name in requests}:
        fail('all_external_dependency_entries_required')
    return {'predecessorInstallReceiptSha256': m.ARTIFACT_SHA,
            'predecessorRuntimeInventorySha256': accepted['runtimeInventorySha256'],
            'target': str(expected), 'externalEntries': verified, 'fullDependencyTreeRehashed': False}


def prepare(m):
    manifest, files = payload(m, INCOMING)
    dep = dependencies(m, manifest, json.loads(files['metafile.json']))
    result = {'format': FORMAT, 'artifactDigest': DIGEST, 'manifestSha256': MANIFEST_SHA,
              'metafileSha256': META_SHA, 'target': str(TARGET), 'dependencies': dep,
              'files': {name: m.sha(raw) for name, raw in files.items()},
              'compiledOutputFiles': 8, 'effectiveSourceAndResolutionInputs': len(manifest['inputs']),
              'olderArtifactsModified': False, 'dependencyInstalls': 0, 'runtimeStarted': False,
              'serviceJobs': 0, 'databaseCalls': 0, 'providerRequests': 0}
    return result, files


def install(m, result, files):
    if os.path.lexists(BASE) or os.path.lexists(TARGET):
        fail('fresh_nonmarket_artifact_and_receipt_required')
    directory(BASE.parent)
    directory(TARGET.parent.parent)
    BASE.mkdir(mode=0o700)
    m.write_new(BASE / 'intent.json', m.encoded(result))
    m.sync_directory(BASE)
    m.sync_directory(BASE.parent)
    if not TARGET.parent.exists():
        TARGET.parent.mkdir(mode=0o755)
        TARGET.parent.chmod(0o755)
        m.sync_directory(TARGET.parent.parent)
    directory(TARGET.parent)
    TARGET.mkdir(mode=0o755)
    TARGET.chmod(0o755)
    (TARGET / 'dist').mkdir(mode=0o755)
    (TARGET / 'dist').chmod(0o755)
    for name, raw in files.items():
        m.write_new(TARGET / name, raw, 0o644)
    (TARGET / 'node_modules').symlink_to(result['dependencies']['target'], target_is_directory=True)
    for path in (TARGET / 'dist', TARGET, TARGET.parent):
        m.sync_directory(path)
    _, copied = payload(m, TARGET)
    if copied != files or dependencies(m, json.loads(files['manifest.json']), json.loads(files['metafile.json'])) != result['dependencies']:
        fail('nonmarket_artifact_changed_during_install')
    if os.readlink(TARGET / 'node_modules') != result['dependencies']['target']:
        fail('exact_installed_dependency_link_required')
    raw = m.encoded({**result, 'installed': True})
    m.write_new(BASE / 'result.json', raw)
    m.sync_directory(BASE)
    return m.sha(raw)


def installed(m, pin):
    value = m.document(BASE / 'result.json', pin)
    manifest, files = payload(m, TARGET)
    if ({p.name for p in TARGET.iterdir()} != {'dist', 'manifest.json', 'metafile.json', 'node_modules'}
            or {str(p.relative_to(TARGET)) for p in (TARGET / 'dist').iterdir()} != OUTPUTS):
        fail('exact_installed_nonmarket_layout_required')
    if (value.get('format') != FORMAT or value.get('installed') is not True or value.get('artifactDigest') != DIGEST
            or value.get('target') != str(TARGET) or value.get('manifestSha256') != MANIFEST_SHA
            or value.get('files') != {name: m.sha(raw) for name, raw in files.items()}
            or value.get('dependencies') != dependencies(m, manifest, json.loads(files['metafile.json']))
            or os.readlink(TARGET / 'node_modules') != manifest['requiredRuntimeDependencyTarget']):
        fail('acknowledged_nonmarket_install_required')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--expected')
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'yunipals-main':
        fail('root_on_exact_host_required')
    os.umask(0o077)
    m = shared()
    result, files = prepare(m)
    binding = m.sha(m.encoded(result))
    if args.install and args.expected != binding:
        fail('fresh_review_binding_required')
    receipt = install(m, result, files) if args.install else None
    print(json.dumps({**result, 'installed': args.install, 'bindingSha256': binding, 'resultSha256': receipt}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch('[a-z0-9_]+', str(error)) else 'nonmarket_runtime_install_failed'
        print(json.dumps({'format': FORMAT, 'completed': False, 'failure': code}))
        raise SystemExit(1)
