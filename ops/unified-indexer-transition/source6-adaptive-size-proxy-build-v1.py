#!/usr/bin/env python3
"""Build one public proxy entry from the existing source6 dependency closure."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SOURCE = '6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
MANIFEST_SHA = '905d69f1fddc893e882c1c7695288bed85257e2fe7450b3bdc68db099cb55e38'
INVENTORY = Path('/var/tmp/yunipals-runtime-6e112a0c-20261021/runtime-supplement.inventory.json')
INVENTORY_SHA = 'dbc145f11d13c61ce45b2bcf3c557bd90431bda7ce4a6dbe62136a24db84ab58'
NODE = Path('/opt/node-v24.18.1/bin/node')
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
PREIMAGE_SHA = '0f3731e081401ec41e7bba7ac40c375b71c15834a4019a0b84e521e4ba38fb68'
PATCH = OPS / 'source6-adaptive-log-size-v1.ts'
PATCH_SHA = '6a65cd698c572d59e3d8a0dc28c438278edc800e21cfb7a41a42438852b88633'
OUTPUT = OPS / 'source6-adaptive-size-proxy-v1'
APP = ROOT / 'apps/yunipals-market-api'
FORMAT = 'yunipals-source6-adaptive-size-proxy-build-v1'
ENV = {'PATH': '/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'COREPACK_ENABLE_NETWORK': '0'}


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def protected(path, maximum=2000000):
    path = Path(path)
    for item in [*path.parents, path]:
        st = item.lstat()
        temporary_parent = item in {Path('/tmp'), Path('/var/tmp')} and stat.S_ISDIR(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o1777
        if stat.S_ISLNK(st.st_mode) or st.st_uid != 0 or (st.st_mode & 0o022 and not temporary_parent):
            fail('protected_public_build_input_required')
    st = path.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_size > maximum:
        fail('bounded_public_build_input_required')
    before = (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    raw = path.read_bytes(); st = path.stat()
    if before != (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns):
        fail('public_build_input_changed')
    return raw


def pinned(path, expected, maximum=2000000):
    raw = protected(path, maximum)
    if sha(raw) != expected: fail('exact_public_build_input_required')
    return raw


def fresh():
    if not os.path.lexists(OUTPUT): return
    st = OUTPUT.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != 0 or stat.S_IMODE(st.st_mode) != 0o755 or any(OUTPUT.iterdir()):
        fail('fresh_empty_root0755_candidate_required')


def review():
    fresh()
    manifest = json.loads(pinned(ROOT / 'RELEASE-MANIFEST.json', MANIFEST_SHA))
    if manifest['sourceDigest'] != SOURCE: fail('exact_source6_manifest_required')
    files = {row['path']: row for row in manifest['files']}
    if len(files) != len(manifest['files']): fail('unique_source_manifest_required')
    source_name = 'apps/yunipals-market-api/src/rpcBudgetProxy.ts'
    if files[source_name]['sha256'] != PREIMAGE_SHA: fail('exact_proxy_preimage_required')
    pinned(ROOT / source_name, PREIMAGE_SHA)
    pinned(PATCH, PATCH_SHA)
    pinned(NODE, NODE_SHA, 150000000)
    for name in ['package.json', 'tsconfig.json', 'scripts/build.mjs']:
        pinned(APP / name, files['apps/yunipals-market-api/' + name]['sha256'])
    inventory = json.loads(pinned(INVENTORY, INVENTORY_SHA, 40000000))
    tools = []
    for row in inventory['entries']:
        path = row['path']
        if path.startswith('node_modules/.pnpm/') and any('/' + name + '/' in path for name in ['esbuild', '@esbuild']):
            if row['type'] == 'file':
                pinned(ROOT / path, row['sha256'], 20000000)
                tools.append({'path': path, 'sha256': row['sha256']})
    if len(tools) < 3: fail('existing_esbuild_tool_closure_required')
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'sourceRoot': str(ROOT), 'sourceManifestSha256': MANIFEST_SHA, 'proxyPreimageSha256': PREIMAGE_SHA,
        'patchFile': str(PATCH), 'patchSha256': PATCH_SHA, 'nodeSha256': NODE_SHA,
        'runtimeInventorySha256': INVENTORY_SHA, 'compilerFiles': tools, 'output': str(OUTPUT),
        'packageInstall': False, 'nativePreparation': False, 'providerRequests': 0, 'databaseConnections': 0}
    return {'reviewHash': sha(encoded(binding)), 'binding': binding}, files


BUILD = r'''import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const [app, patch, output] = process.argv.slice(1);
const require = createRequire(app + '/package.json');
const {build} = require('esbuild');
const {dependencies} = JSON.parse(await readFile(app + '/package.json', 'utf8'));
const result = await build({
 stdin:{contents:await readFile(patch,'utf8'),resolveDir:app+'/src',sourcefile:app+'/src/rpcBudgetProxy.ts',loader:'ts'},
 absWorkingDir:app,tsconfig:app+'/tsconfig.json',outfile:output+'/rpc-budget-proxy.mjs',
 bundle:true,platform:'node',format:'esm',target:'node24',sourcemap:true,metafile:true,
 external:Object.keys(dependencies).filter(n=>!['@protopals/yunipals-market-core','@protopals/yunipals-indexer-server'].includes(n))
});
await writeFile(output+'/metafile.json',JSON.stringify(result.metafile));
'''


def verify_sources(mapping, files):
    sources, contents = mapping.get('sources'), mapping.get('sourcesContent')
    if not isinstance(sources, list) or not isinstance(contents, list) or len(sources) != len(contents) or not 1 <= len(sources) <= 300:
        fail('bounded_actual_sourcemap_inputs_required')
    checked = []; candidates = 0
    for name, content in zip(sources, contents):
        if not isinstance(name, str) or not isinstance(content, str): fail('actual_public_sourcemap_content_required')
        path = (OUTPUT / name).resolve()
        try: relative = path.relative_to(ROOT).as_posix()
        except ValueError: fail('only_source6_compiler_inputs_required')
        digest = sha(content.encode())
        expected = PATCH_SHA if relative == 'apps/yunipals-market-api/src/rpcBudgetProxy.ts' else files.get(relative, {}).get('sha256')
        if digest != expected: fail('actual_compiler_source_bytes_changed')
        if digest == PATCH_SHA: candidates += 1
        checked.append({'path': relative, 'sha256': digest})
    if candidates != 1: fail('one_reviewed_proxy_source_required')
    return checked


def create_output():
    fresh()
    OUTPUT.mkdir(mode=0o755, exist_ok=True)
    OUTPUT.chmod(0o755)
    if OUTPUT.stat().st_uid != 0 or stat.S_IMODE(OUTPUT.stat().st_mode) != 0o755:
        fail('candidate_public_traversal_mode_required')


def build(expected):
    reviewed, files = review()
    if expected != reviewed['reviewHash']: fail('exact_offline_build_review_required')
    create_output()
    with (OUTPUT / 'intent.json').open('xb') as stream:
        stream.write(encoded(reviewed)); stream.flush(); os.fsync(stream.fileno())
    result = subprocess.run([str(NODE), '--input-type=module', '-e', BUILD, str(APP), str(PATCH), str(OUTPUT)],
        cwd=APP, env=ENV, stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
    if result.returncode or result.stderr or len(result.stdout) > 10000:
        fail('single_offline_proxy_build_failed')
    mapping = json.loads(protected(OUTPUT / 'rpc-budget-proxy.mjs.map', 5000000))
    actual_inputs = verify_sources(mapping, files)
    entry = OUTPUT / 'rpc-budget-proxy.mjs'
    # External packages resolve through this one exact existing app dependency
    # directory; no package installation, recursive clone or changed package.
    target = APP / 'node_modules'
    if not target.is_dir(): fail('existing_proxy_dependency_directory_required')
    (OUTPUT / 'node_modules').symlink_to(target, target_is_directory=True)
    receipt = {'format': FORMAT, 'reviewHash': expected, 'binding': reviewed['binding'],
        'entry': str(entry), 'entrySha256': sha(protected(entry, 3000000)),
        'mapSha256': sha(protected(OUTPUT / 'rpc-budget-proxy.mjs.map', 5000000)),
        'actualCompilerInputs': actual_inputs, 'dependencyDirectory': str(target),
        'proxyOnly': True, 'indexerBuildUnchanged': True, 'nativePreparation': False,
        'proxyUidReadability': 'requires_actual_proxy_UID_check_before_selection',
        'providerRequests': 0, 'databaseConnections': 0, 'packageInstall': False}
    for path in [entry, OUTPUT / 'rpc-budget-proxy.mjs.map']:
        path.chmod(0o644)
    with (OUTPUT / 'receipt.json').open('xb') as stream:
        stream.write(encoded(receipt)); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(OUTPUT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    return receipt


def validate_saved():
    """Reopen only the small built artifact and its actual consumed sources."""
    receipt = json.loads(protected(OUTPUT / 'receipt.json', 100000))
    binding = receipt['binding']
    expected = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'sourceRoot': str(ROOT), 'sourceManifestSha256': MANIFEST_SHA, 'proxyPreimageSha256': PREIMAGE_SHA,
        'patchFile': str(PATCH), 'patchSha256': PATCH_SHA, 'nodeSha256': NODE_SHA,
        'runtimeInventorySha256': INVENTORY_SHA, 'output': str(OUTPUT), 'packageInstall': False,
        'nativePreparation': False, 'providerRequests': 0, 'databaseConnections': 0}
    if ({k: v for k, v in binding.items() if k != 'compilerFiles'} != expected or
        receipt['reviewHash'] != sha(encoded(binding)) or receipt['entry'] != str(OUTPUT / 'rpc-budget-proxy.mjs') or
        receipt.get('proxyOnly') is not True or receipt.get('indexerBuildUnchanged') is not True or
        any(receipt.get(k) is not False for k in ['packageInstall', 'nativePreparation']) or
        receipt.get('providerRequests') != 0 or receipt.get('databaseConnections') != 0):
        fail('exact_public_candidate_receipt_required')
    manifest = json.loads(pinned(ROOT / 'RELEASE-MANIFEST.json', MANIFEST_SHA))
    files = {row['path']: row for row in manifest['files']}
    pinned(PATCH, PATCH_SHA)
    pinned(OUTPUT / 'rpc-budget-proxy.mjs', receipt['entrySha256'], 3000000)
    mapping = json.loads(pinned(OUTPUT / 'rpc-budget-proxy.mjs.map', receipt['mapSha256'], 5000000))
    if verify_sources(mapping, files) != receipt['actualCompilerInputs']:
        fail('actual_candidate_compiler_inputs_changed')
    for row in receipt['actualCompilerInputs']:
        pinned(ROOT / row['path'], PREIMAGE_SHA if row['sha256'] == PATCH_SHA else row['sha256'])
    target = APP / 'node_modules'; link = OUTPUT / 'node_modules'
    if receipt['dependencyDirectory'] != str(target) or not link.is_symlink() or os.readlink(link) != str(target):
        fail('exact_existing_candidate_dependencies_required')
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('--build'); args = p.parse_args()
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('bounded_proxy_build_expired')))
    signal.alarm(180)
    try:
        if os.geteuid() != 0: fail('root_public_build_required')
        print(json.dumps(build(args.build) if args.build else review()[0], sort_keys=True))
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': error.args[0] if isinstance(error, RuntimeError) else 'fixed_offline_build_failed',
            'providerRequests': 0, 'databaseConnections': 0}))
        raise SystemExit(1)
    finally: signal.alarm(0)
