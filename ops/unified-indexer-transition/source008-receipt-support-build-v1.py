#!/usr/bin/env python3
"""Offline receipt-support overlay; never edits or starts the frozen source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
SOURCE = '008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78'
ROOT = Path('/opt/yunipals-unified/releases') / SOURCE
APP = ROOT / 'apps/yunipals-indexer'
MANIFEST_SHA = '55017c503920ddf2d4083bee2425d4daed656cafd0d36e4f88a6352d5903d15d'
INVENTORY = Path('/var/tmp/yunipals-runtime-008028af-20261020/runtime-supplement.inventory.json')
INVENTORY_SHA = 'ebeb5a3f1ab9a2152500ff7bf859b81e62101fe8b15b9c0e4d5bb51d5b40da40'
NODE = Path('/opt/node-v24.18.1/bin/node')
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
WORKER_NAME = 'apps/yunipals-indexer/lib/unified/receipt-worker.ts'
WORKER_OLD_SHA = '30c67afcd74cc8a036c8ed0248e3e9f302f44d264f3256fbfe2caefedbed7e65'
WORKER = OPS / 'source008-receipt-worker-v1.ts'
WORKER_SHA = 'b242b3ca13e88921617ca26678721088eb0214d9692691b562e29b25bea7eebf'
TOPICS_NAME = 'packages/yunipals-indexer-server/src/event-topics.ts'
TOPICS = OPS / 'source008-event-topics-v1.ts'
TOPICS_SHA = 'a430efe9b80bded34cdbc8cc115d6c4e7f197d6991b20743e5519427f938960a'
OUTPUT = OPS / 'source008-receipt-support-v1'
FORMAT = 'yunipals-source008-receipt-support-build-v1'
EXPORTS = ['claimReceiptJobs', 'decodeTransactionEvidence', 'enrichReceiptJob', 'queueReceiptCandidates']
ENV = {'PATH': '/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'COREPACK_ENABLE_NETWORK': '0'}


def fail(code): raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def protected(path, maximum=2_000_000):
    path = Path(path)
    for item in [*path.parents, path]:
        info = item.lstat()
        temporary = item in {Path('/tmp'), Path('/var/tmp')} and stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o1777
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not temporary):
            fail('protected_public_overlay_input_required')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        fail('bounded_regular_overlay_input_required')
    before = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    raw = path.read_bytes(); info = path.stat()
    if len(raw) > maximum or before != (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns):
        fail('overlay_input_changed_during_read')
    return raw


def pinned(path, pin, maximum=2_000_000):
    raw = protected(path, maximum)
    if sha(raw) != pin: fail('exact_overlay_input_required')
    return raw


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, raw, mode=0o644):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fchmod(stream.fileno(), mode); os.fsync(stream.fileno())
    sync(path.parent)


def fresh():
    if not os.path.lexists(OUTPUT): return
    info = OUTPUT.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o755 or any(OUTPUT.iterdir()):
        fail('fresh_empty_overlay_required')


def inputs():
    manifest = json.loads(pinned(ROOT / 'RELEASE-MANIFEST.json', MANIFEST_SHA))
    files = {row['path']: row for row in manifest['files']}
    if manifest['sourceDigest'] != SOURCE or len(files) != len(manifest['files']) or files[WORKER_NAME]['sha256'] != WORKER_OLD_SHA or TOPICS_NAME in files or os.path.lexists(ROOT / TOPICS_NAME):
        fail('exact_frozen_source008_required')
    pinned(ROOT / WORKER_NAME, WORKER_OLD_SHA)
    pinned(WORKER, WORKER_SHA); pinned(TOPICS, TOPICS_SHA); pinned(NODE, NODE_SHA, 150_000_000)
    config = []
    for name in ['package.json', 'tsconfig.json']:
        rel = 'apps/yunipals-indexer/' + name
        pinned(ROOT / rel, files[rel]['sha256'])
        config.append({'path': rel, 'sha256': files[rel]['sha256']})
    inventory = json.loads(pinned(INVENTORY, INVENTORY_SHA, 40_000_000))
    tools = []
    for row in inventory['entries']:
        name = row['path']
        if name.startswith('node_modules/.pnpm/') and any('/' + part + '/' in name for part in ['esbuild', '@esbuild']) and row['type'] == 'file':
            pinned(ROOT / name, row['sha256'], 20_000_000)
            tools.append({'path': name, 'sha256': row['sha256']})
    compiler = (ROOT / 'apps/yunipals-market-api/node_modules/esbuild/lib/main.js').resolve()
    try: compiler_relative = compiler.relative_to(ROOT).as_posix()
    except ValueError: fail('compiler_must_belong_to_frozen_source008')
    mains = [row for row in tools if row['path'] == compiler_relative and row['path'].endswith('/esbuild/lib/main.js')]
    if len(mains) != 1 or len(tools) < 3: fail('exact_existing_esbuild_closure_required')
    binding = {'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'sourceDigest': SOURCE, 'sourceRoot': str(ROOT), 'sourceManifestSha256': MANIFEST_SHA,
        'runtimeInventorySha256': INVENTORY_SHA, 'nodeSha256': NODE_SHA, 'compilerFiles': tools,
        'compilerMain': str(compiler), 'configFiles': config,
        'workerPreimageSha256': WORKER_OLD_SHA, 'workerFile': str(WORKER), 'workerSha256': WORKER_SHA,
        'topicsFile': str(TOPICS), 'topicsSha256': TOPICS_SHA, 'output': str(OUTPUT),
        'exports': EXPORTS, 'sourceRestarted': False, 'sourceModified': False, 'packageInstall': False,
        'providerRequests': 0, 'databaseConnections': 0, 'serviceJobs': 0}
    return binding, files


def review():
    fresh(); binding, files = inputs()
    return {'reviewHash': sha(encoded(binding)), 'binding': binding}, files


BUILD = r'''import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const [root, compiler, worker, topics, output] = process.argv.slice(1);
const app = root + '/apps/yunipals-indexer';
const workerPath = root + '/apps/yunipals-indexer/lib/unified/receipt-worker.ts';
const topicsPath = root + '/packages/yunipals-indexer-server/src/event-topics.ts';
const require = createRequire(compiler);
const {build} = require(compiler);
const options = {entryPoints:[workerPath],absWorkingDir:app,tsconfig:app+'/tsconfig.json',
 outfile:output+'/receipt-worker.mjs',write:false,bundle:true,platform:'node',format:'esm',target:'node24',
 sourcemap:true,metafile:true,external:['viem','pg'],logLevel:'silent',
 plugins:[{name:'exact-two-receipt-inputs',setup(plugin){
   plugin.onResolve({filter:/event-topics\.js$/},args=>{
     if(resolve(args.resolveDir,args.path)!==topicsPath.replace(/\.ts$/,'.js'))return;
     return {path:topicsPath};
   });
   plugin.onLoad({filter:/\.ts$/},async args=>{
     const source=args.path===workerPath?worker:args.path===topicsPath?topics:null;
     if(!source)return;
     return {contents:await readFile(source,'utf8'),loader:'ts',resolveDir:dirname(args.path)};
   });
 }}]};
const a=await build(options), b=await build(options);
if(JSON.stringify(a.metafile)!==JSON.stringify(b.metafile)||a.outputFiles.length!==b.outputFiles.length||
 a.outputFiles.some((f,i)=>f.path!==b.outputFiles[i].path||!Buffer.from(f.contents).equals(Buffer.from(b.outputFiles[i].contents))))
 throw Error('nonidentical_offline_receipt_builds');
for(const f of a.outputFiles)await writeFile(f.path,f.contents,{flag:'wx',mode:0o644});
await writeFile(output+'/metafile.json',JSON.stringify(a.metafile),{flag:'wx',mode:0o644});
'''


def source_row(name, content, files):
    path = (OUTPUT / name).resolve()
    try: rel = path.relative_to(ROOT).as_posix()
    except ValueError: fail('only_frozen_source008_inputs_allowed')
    expected = {WORKER_NAME: WORKER_SHA, TOPICS_NAME: TOPICS_SHA}.get(rel, files.get(rel, {}).get('sha256'))
    if not isinstance(content, str) or sha(content.encode()) != expected: fail('compiled_source_content_changed')
    return {'path': rel, 'sha256': expected}


def verify_compilation(files):
    mapping = json.loads(protected(OUTPUT / 'receipt-worker.mjs.map', 5_000_000))
    names, contents = mapping.get('sources'), mapping.get('sourcesContent')
    if not isinstance(names, list) or not isinstance(contents, list) or not 1 <= len(names) == len(contents) <= 100:
        fail('bounded_actual_compiler_inputs_required')
    rows = [source_row(name, content, files) for name, content in zip(names, contents)]
    if len({row['path'] for row in rows}) != len(rows) or not {WORKER_NAME, TOPICS_NAME} <= {row['path'] for row in rows}:
        fail('exact_worker_and_decoder_required')
    meta = json.loads(protected(OUTPUT / 'metafile.json', 1_000_000))
    actual = []
    for name in meta['inputs']:
        path = (APP / name).resolve()
        try: rel = path.relative_to(ROOT).as_posix()
        except ValueError: fail('unapproved_compiler_input')
        original = WORKER if rel == WORKER_NAME else TOPICS if rel == TOPICS_NAME else path
        pin = {WORKER_NAME: WORKER_SHA, TOPICS_NAME: TOPICS_SHA}.get(rel, files.get(rel, {}).get('sha256'))
        pinned(original, pin)
        actual.append({'path': rel, 'sha256': pin})
    if not 1 <= len(actual) <= 100: fail('bounded_compiler_closure_required')
    outputs = meta['outputs']
    entry = next((v for k, v in outputs.items() if (APP / k).resolve() == OUTPUT / 'receipt-worker.mjs'), None)
    if entry is None or sorted(entry.get('exports', [])) != EXPORTS or len(outputs) != 2:
        fail('exact_receipt_worker_exports_required')
    externals = sorted({i['path'] for row in outputs.values() for i in row.get('imports', []) if i.get('external')})
    if externals != ['node:crypto', 'viem']: fail('exact_receipt_external_dependencies_required')
    return {'actualCompilerInputs': sorted(actual, key=lambda row: row['path']), 'sourceMapInputs': rows,
            'externalImports': externals, 'exports': EXPORTS, 'identicalSecondBuild': True}


def build(expected):
    reviewed, files = review()
    if expected != reviewed['reviewHash']: fail('exact_offline_receipt_review_required')
    OUTPUT.mkdir(mode=0o755, exist_ok=True); OUTPUT.chmod(0o755); sync(OUTPUT.parent)
    save(OUTPUT / 'intent.json', encoded(reviewed))
    result = subprocess.run([str(NODE), '--input-type=module', '-e', BUILD, str(ROOT), reviewed['binding']['compilerMain'], str(WORKER), str(TOPICS), str(OUTPUT)],
        cwd=APP, env=ENV, stdin=subprocess.DEVNULL, capture_output=True, timeout=120)
    if result.returncode or result.stderr or len(result.stdout) > 10000: fail('bounded_offline_receipt_build_failed')
    compiled = verify_compilation(files)
    # Original frozen sources must still match after the actual compiler read.
    for row in compiled['actualCompilerInputs']:
        if row['path'] != TOPICS_NAME: pinned(ROOT / row['path'], WORKER_OLD_SHA if row['path'] == WORKER_NAME else row['sha256'])
    target = APP / 'node_modules'
    if not target.is_dir() or target.is_symlink(): fail('existing_source008_dependency_directory_required')
    (OUTPUT / 'node_modules').symlink_to(target, target_is_directory=True)
    outputs = {}
    for name, maximum in [('receipt-worker.mjs', 3_000_000), ('receipt-worker.mjs.map', 5_000_000), ('metafile.json', 1_000_000)]:
        path = OUTPUT / name; path.chmod(0o644); raw = protected(path, maximum)
        with path.open('rb') as stream: os.fsync(stream.fileno())
        outputs[name] = {'bytes': len(raw), 'sha256': sha(raw)}
    artifact = {'sourceDigest': SOURCE, 'workerSha256': WORKER_SHA, 'topicsSha256': TOPICS_SHA,
                'nodeSha256': NODE_SHA, 'files': outputs, 'compilerInputs': compiled['actualCompilerInputs']}
    receipt = {'format': FORMAT, 'reviewHash': expected, 'binding': reviewed['binding'], **compiled,
        'artifactDigest': sha(encoded(artifact)), 'artifact': artifact, 'entry': str(OUTPUT / 'receipt-worker.mjs'),
        'entrySha256': outputs['receipt-worker.mjs']['sha256'], 'dependencyDirectory': str(target),
        'sourceRestarted': False, 'sourceModified': False, 'packageInstall': False,
        'providerRequests': 0, 'databaseConnections': 0, 'serviceJobs': 0,
        'supportOnly': True, 'workerExecutionPerformed': False}
    save(OUTPUT / 'receipt.json', encoded(receipt)); sync(OUTPUT)
    return receipt


def validate_saved():
    receipt = json.loads(protected(OUTPUT / 'receipt.json', 200_000))
    binding, files = inputs()
    if receipt.get('format') != FORMAT or receipt.get('binding') != binding or receipt.get('reviewHash') != sha(encoded(binding)):
        fail('exact_receipt_artifact_binding_required')
    compiled = verify_compilation(files)
    if any(receipt.get(k) != v for k, v in compiled.items()): fail('receipt_compiler_closure_changed')
    artifact = receipt['artifact']
    if (receipt.get('artifactDigest') != sha(encoded(artifact)) or artifact.get('compilerInputs') != compiled['actualCompilerInputs'] or
        any(artifact.get(key) != value for key, value in {'sourceDigest': SOURCE, 'workerSha256': WORKER_SHA,
            'topicsSha256': TOPICS_SHA, 'nodeSha256': NODE_SHA}.items())):
        fail('exact_receipt_artifact_identity_required')
    if set(artifact['files']) != {'receipt-worker.mjs', 'receipt-worker.mjs.map', 'metafile.json'}:
        fail('exact_receipt_artifact_files_required')
    for name, row in artifact['files'].items():
        if len(pinned(OUTPUT / name, row['sha256'], 5_000_000)) != row['bytes']: fail('receipt_artifact_length_changed')
    target = APP / 'node_modules'
    if (receipt.get('entry') != str(OUTPUT / 'receipt-worker.mjs') or receipt.get('entrySha256') != artifact['files']['receipt-worker.mjs']['sha256'] or
        receipt.get('dependencyDirectory') != str(target) or os.readlink(OUTPUT / 'node_modules') != str(target) or
        any(receipt.get(k) is not False for k in ['sourceRestarted', 'sourceModified', 'packageInstall', 'workerExecutionPerformed']) or
        any(receipt.get(k) != 0 for k in ['providerRequests', 'databaseConnections', 'serviceJobs']) or receipt.get('supportOnly') is not True):
        fail('unchanged_support_only_artifact_required')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); group = parser.add_mutually_exclusive_group()
    group.add_argument('--build'); group.add_argument('--validate', action='store_true'); args = parser.parse_args()
    signal.signal(signal.SIGALRM, lambda *_: fail('bounded_receipt_build_expired')); signal.alarm(180)
    try:
        if os.geteuid() != 0: fail('root_public_receipt_build_required')
        print(json.dumps(build(args.build) if args.build else validate_saved() if args.validate else review()[0], sort_keys=True))
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
            'fixedCode': str(error) if type(error) is RuntimeError else 'offline_receipt_build_failed', 'providerRequests': 0, 'databaseConnections': 0}))
        raise SystemExit(1)
    finally: signal.alarm(0)
