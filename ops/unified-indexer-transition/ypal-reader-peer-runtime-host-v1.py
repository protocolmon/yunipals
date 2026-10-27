#!/usr/bin/env python3
"""Stage fixed public reader files and qualify isolated restricted-user imports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import stat
import subprocess
import time

FORMAT = 'yunipals-reader-peer-runtime-host-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
INPUT = Path('/var/tmp/yunipals-reader-peer-runtime-input-v1-20261024')
BASE = Path('/var/backups/yunipals-reader-peer-runtime-host-v1-20261024')
REVIEW_SHA = 'a6ea297e6b2e4df82b32bc8f83796552697de4ffeea9772773d6cdd36e759678'
TRANSPORT = 'ypal-reader-peer-runtime-v1.py'
PAYLOAD = {
    'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa',
    'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1',
    'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d',
    'ypal-reader-peer-runtime-v1.md': 'b62d716da3283368a84fa89f93fea032baf866e9820a1acc94013af994f45abb',
    'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1',
    'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7',
    'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f',
    'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168',
    'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21',
    'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2',
    'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c',
    'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e',
    'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920'
}
ROOT = Path('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b')
PROJECT = ROOT / 'apps/yunipals-indexer'
NODE = Path('/opt/node-v24.18.1/bin/node')
ARTIFACT = Path('/var/tmp/yunipals-runtime-41e5b5fd-20261021')
ARTIFACT_SHA = '0093abc56f8942b552a601d2eea925af04ebb834f01dd57ea596deaa8ee2ca42'
SOURCE_SHA = '6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801'
ARTIFACTS = (
    ('40e35c622534b9030622759116cf3b85361ad914211a76a7fd47ee06b60968f9',
     '986a288dcebe5e7ce910b36d83f97178ce7c47336a0e9910e0d013e3ff3e347a',
     '0f71a781abc649e48e72c20364fe9e3b3ce34afa7a4ff73c5a1b4e35be9522d8', ('main-api',)),
    ('2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe',
     '1a8174b05977bd6ef1adfd50a9f5679543c6be1325bbbf126a81cafec23c7b84',
     '77b7dc151f29892925820447270a3d594f000f7f4ac478c6c6d09e240dd024b2',
     ('native-leaderboard-preparation', 'projection-publication'))
)
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def identity(path, directory=False):
    for parent in reversed(path.parents):
        row = parent.lstat()
        sticky = parent in {Path('/tmp'), Path('/var/tmp')} and row.st_mode & stat.S_ISVTX
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and (not row.st_mode & 0o022 or sticky),
             'protected_fixed_parent_required')
    row = path.lstat()
    need((stat.S_ISDIR(row.st_mode) if directory else stat.S_ISREG(row.st_mode) and row.st_nlink == 1) and
         row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022, 'protected_fixed_file_or_directory_required')
    return {'dev': row.st_dev, 'ino': row.st_ino, 'mode': stat.S_IMODE(row.st_mode), 'uid': row.st_uid, 'gid': row.st_gid}


def read(path, pin=None, maximum=4_000_000):
    before = identity(path)
    need(path.stat().st_size <= maximum, 'bounded_public_or_receipt_file_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        row = os.fstat(fd)
        need((row.st_dev, row.st_ino) == (before['dev'], before['ino']), 'same_public_input_inode_required')
        chunks, size = [], 0
        while size <= maximum:
            chunk = os.read(fd, min(65536, maximum + 1 - size))
            if not chunk: break
            chunks.append(chunk); size += len(chunk)
        raw = b''.join(chunks)
        after = os.fstat(fd)
        need(len(raw) == row.st_size <= maximum and before == identity(path) and
             (row.st_size, row.st_mtime_ns, row.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             (pin is None or sha(raw) == pin), 'exact_unchanged_public_or_receipt_bytes_required')
        return raw
    finally:
        os.close(fd)


def sync(path):
    fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)


def exclusive(path, raw):
    identity(path.parent, True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(raw); stream.flush(); os.fsync(fd)
    finally:
        os.close(fd)
        sync(path.parent)


def document(path, pin=None): return json.loads(read(path, pin))


def peers():
    values = {}
    for name in ('postgres', 'yunipals_unified_api'):
        user = pwd.getpwnam(name)
        need(user.pw_uid > 0 and user.pw_gid > 0 and pwd.getpwuid(user.pw_uid).pw_name == name,
             'exact_existing_unprivileged_OS_account_required')
        values[name] = {'uid': user.pw_uid, 'gid': user.pw_gid}
    need(values['postgres'] == {'uid': 111, 'gid': 113}, 'exact_postgres_peer_mapping_required')
    return values


def run(args, timeout=20):
    result = subprocess.run(args, env=CLEAN, cwd='/', capture_output=True, timeout=timeout)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 2_000_000,
         'bounded_readonly_public_dependency_resolution_refused')
    return json.loads(result.stdout)


def production():
    # Direct immutable artifact checks only. No whole-runtime/source/role guard,
    # systemd, private configuration, application import or DB/provider calls.
    accepted = document(ARTIFACT / 'install-result.json', ARTIFACT_SHA)
    need(accepted.get('format') == 'yunipals-consumer-final-artifact-install-v1' and accepted.get('installed') is True and
         accepted.get('target') == str(ROOT) and accepted.get('manifestSha256') == SOURCE_SHA,
         'exact_predecessor_public_runtime_install_required')
    read(ROOT / 'RELEASE-MANIFEST.json', SOURCE_SHA)
    inventory_raw = read(ARTIFACT / 'runtime-supplement.inventory.json', accepted['runtimeInventorySha256'], 40_000_000)
    inventory = json.loads(inventory_raw)
    need(inventory.get('sourceDigest') == ROOT.name and inventory.get('sourceManifestSha256') == SOURCE_SHA and
         len(inventory.get('entries', [])) == 60918, 'exact_acknowledged_dependency_inventory_required')
    entries = {row['path']: row for row in inventory['entries']}
    requests = {('require-call', 'pg')}
    files, node_pin = {}, None
    for digest, manifest_pin, meta_pin, names in ARTIFACTS:
        root = Path('/opt/yunipals-unified/nonmarket-consumer-releases') / digest
        manifest = document(root / 'manifest.json', manifest_pin)
        meta = document(root / 'metafile.json', meta_pin)
        expected = {'dist/' + name + '.mjs' + suffix for name in names for suffix in ('', '.map')}
        need(manifest.get('artifactDigest') == digest and len(manifest['files']) == len(expected) and
             {row['path'] for row in manifest['files']} == expected and
             manifest['requiredRuntimeDependencyTarget'] == str(PROJECT / 'node_modules') and
             os.readlink(root / 'node_modules') == str(PROJECT / 'node_modules'), 'exact_installed_public_artifact_required')
        for row in manifest['files']:
            raw = read(root / row['path'], row['sha256'])
            need(len(raw) == row['bytes'], 'exact_installed_bundle_size_required')
            files[str(root / row['path'])] = sha(raw)
        current_pin = manifest['compiler']['nodeSha256']
        need(node_pin is None or node_pin == current_pin, 'same_compiler_Node_required')
        node_pin = current_pin
        for output in meta['outputs'].values():
            for item in output.get('imports', []):
                if item.get('external') and not item['path'].startswith('node:'):
                    need(item['kind'] in ('import-statement', 'require-call'), 'known_dependency_resolution_kind_required')
                    requests.add((item['kind'], item['path']))
    read(NODE, node_pin, 200_000_000)
    script = ("import{pathToFileURL,fileURLToPath}from'node:url';import{createRequire}from'node:module';"
              "const base=pathToFileURL(process.argv[1]).href,r=createRequire(base);"
              "console.log(JSON.stringify(JSON.parse(process.argv[2]).map(([kind,name])=>({kind,name,path:"
              "kind==='require-call'?r.resolve(name):fileURLToPath(import.meta.resolve(name,base))}))));")
    resolved = run([str(NODE), '--experimental-import-meta-resolve', '--input-type=module', '-e', script,
                    str(PROJECT / 'package.json'), json.dumps(sorted(requests))])
    need(len(resolved) == len(requests) and {(row['kind'], row['name']) for row in resolved} == requests,
         'every_exact_external_dependency_resolution_required')
    for row in resolved:
        path = Path(row['path']); relative = str(path.relative_to(ROOT))
        entry = entries[relative]
        raw = read(path, entry.get('sha256'))
        need(entry.get('type') == 'file' and entry.get('bytes') == len(raw), 'acknowledged_public_dependency_entry_required')
        files[str(path)] = sha(raw)
    return {'sourceInstallSha256': ARTIFACT_SHA, 'inventorySha256': sha(inventory_raw), 'nodeSha256': node_pin,
            'publicFilesVerified': len(files), 'publicFilesSha256': sha(encoded(files)),
            'externalEntries': len(resolved), 'fullDependencyTreeRehashed': False}, entries


def review():
    identity(OPS, True); identity(INPUT, True)
    independent = document(INPUT / 'independent-review.json', REVIEW_SHA)
    need(independent.get('verdict') == 'pass' and independent.get('independentTestsPassed') == 12 and
         {Path(row['path']).name: row['sha256'] for row in independent['reviewedFiles']} ==
         {name: pin for name, pin in PAYLOAD.items() if name.startswith('ypal-reader-peer-runtime-v1.')},
         'exact_independent_five_file_review_required')
    rows = []
    for name, pin in PAYLOAD.items():
        raw = read(INPUT / name, pin)
        path = OPS / name; present = os.path.lexists(path)
        existing = identity(path) if present else None
        if present:
            need(read(path, pin) == raw and existing['mode'] in {0o600, 0o644},
                 'existing_exact_readonly_public_file_required_no_overwrite')
        rows.append({'name': name, 'sha256': pin, 'bytes': len(raw), 'present': present, 'identity': existing})
    dependencies, _ = production()
    binding = {'format': FORMAT, 'producerSha256': sha(read(Path(__file__).absolute())), 'operations': identity(OPS, True),
               'files': rows, 'peers': peers(), 'productionDependencies': dependencies, 'independentReviewSha256': REVIEW_SHA}
    return {**binding, 'reviewHash': sha(encoded(binding)), 'serviceActions': 0, 'databaseConnections': 0, 'providerCalls': 0}


def stage(expected):
    value = review()
    need(value['reviewHash'] == expected and not os.path.lexists(BASE), 'fresh_exact_source_stage_review_and_absent_audit_required')
    BASE.mkdir(mode=0o700)
    need(identity(BASE, True)['mode'] == 0o700, 'exclusive_root700_audit_required')
    sync(BASE.parent)
    exclusive(BASE / 'stage-intent.json', encoded(value))
    for row in value['files']:
        path = OPS / row['name']
        if row['present']:
            need(identity(path) == row['identity'] and sha(read(path)) == row['sha256'], 'unchanged_existing_public_file_required')
        else:
            exclusive(path, read(INPUT / row['name'], row['sha256']))
    final = review()
    need(all(row['present'] for row in final['files']) and final['operations'] == value['operations'] and
         final['productionDependencies'] == value['productionDependencies'] and final['peers'] == value['peers'],
         'exact_staged_public_closure_and_unchanged_dependencies_required')
    result = {'format': FORMAT, 'staged': True, 'approvedReviewHash': expected, 'binding': final,
              'newPublicFiles': sum(not row['present'] for row in value['files']), 'existingPermissionChanges': 0,
              'serviceActions': 0, 'databaseConnections': 0, 'providerCalls': 0}
    exclusive(BASE / 'stage-result.json', encoded(result))
    return {'format': FORMAT, 'staged': True, 'stageResultSha256': sha(encoded(result)),
            'publicFiles': len(PAYLOAD), 'newPublicFiles': result['newPublicFiles'], 'existingPermissionChanges': 0}


def preauthorize_dependencies(entries):
    """Authenticate ALL accepted dependency bytes before any pg evaluation.

    Bare entry hashes or a post-import require.cache check cannot authorize
    transitive code. Walking only declared dependency roots also refuses added
    files, without importing a package or assuming static dependency metadata
    describes every dynamic/optional require.
    """
    expected = {name: row for name, row in entries.items() if 'node_modules' in Path(name).parts}
    need(expected and all(not Path(name).is_absolute() and all(part not in {'', '.', '..'} for part in name.split('/'))
                          for name in expected), 'finite_accepted_dependency_tree_required')
    roots = [ROOT / name for name in expected if Path(name).name == 'node_modules' and
             'node_modules' not in Path(name).parts[:-1]]
    need(roots and all(entries[str(path.relative_to(ROOT))]['type'] == 'directory' for path in roots),
         'exact_top_level_dependency_roots_required')
    for root in roots:
        identity(root, True)
    seen = set(); files = links = 0; deadline = time.monotonic() + 120
    stack = list(roots)
    while stack:
        need(time.monotonic() < deadline, 'dependency_preauthorization_deadline_expired_no_module_evaluation')
        path = stack.pop(); relative = str(path.relative_to(ROOT))
        need(relative in expected and relative not in seen, 'unlisted_or_duplicate_dependency_node_refused_before_evaluation')
        seen.add(relative); row = expected[relative]; before = path.lstat()
        need(before.st_uid == before.st_gid == 0 and stat.S_IMODE(before.st_mode) == row['mode'],
             'exact_root_owned_dependency_metadata_required_before_evaluation')
        if row['type'] == 'directory':
            need(stat.S_ISDIR(before.st_mode) and not before.st_mode & 0o022,
                 'protected_dependency_directory_required_before_evaluation')
            stack.extend(path.iterdir())
        elif row['type'] == 'symlink':
            need(stat.S_ISLNK(before.st_mode) and os.readlink(path) == row['target'],
                 'exact_dependency_link_required_before_evaluation')
            links += 1
        elif row['type'] == 'file':
            need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and not before.st_mode & 0o022 and
                 before.st_size == row['bytes'] <= 200_000_000, 'exact_dependency_file_required_before_evaluation')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                opened = os.fstat(fd)
                need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino),
                     'same_dependency_inode_required_before_evaluation')
                digest = hashlib.sha256(); size = 0
                while True:
                    need(time.monotonic() < deadline, 'dependency_preauthorization_deadline_expired_no_module_evaluation')
                    chunk = os.read(fd, 1_048_576)
                    if not chunk: break
                    digest.update(chunk); size += len(chunk)
                    need(size <= row['bytes'], 'bounded_dependency_bytes_required_before_evaluation')
                after = os.fstat(fd)
                final = path.lstat()
                fields = ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_mtime_ns', 'st_ctime_ns')
                need(size == row['bytes'] and digest.hexdigest() == row['sha256'] and
                     all(getattr(before, key) == getattr(after, key) == getattr(final, key) for key in fields),
                     'exact_unchanged_dependency_bytes_required_before_evaluation')
            finally:
                os.close(fd)
            files += 1
        else:
            need(False, 'unknown_dependency_type_refused_before_evaluation')
    need(seen == set(expected), 'all_exact_dependency_nodes_required_before_evaluation')
    return {'dependencyRoots': len(roots), 'dependencyNodes': len(seen), 'dependencyFiles': files, 'dependencyLinks': links,
            'inventoryDependencyGraphSha256': sha(encoded(expected)), 'allDependencyTreesMatchedBeforeEvaluation': True,
            'moduleEvaluationPerformed': False, 'databaseConnections': 0, 'providerCalls': 0}


def pg_closure(entries):
    # One additional isolated import records every actually loaded pg CJS file,
    # including transitive helpers. No Pool/Client instance is constructed.
    script = r'''
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import {createRequire,syncBuiltinESMExports} from 'node:module';
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';
let attempts=0;const deny=()=>{attempts++;throw Error('no_transport_allowed');};
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;
for(const m of [net,tls,http,https])for(const key of ['connect','createConnection','request','get'])
 if(typeof m[key]==='function')m[key]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();
const require=createRequire(process.argv[1]+'/package.json'),pg=require('pg');
assert.equal(typeof pg.Client,'function');assert.equal(typeof pg.Pool,'function');
const files=Object.keys(require.cache).sort().map(path=>{const raw=readFileSync(path);return{path,bytes:raw.length,
 sha256:createHash('sha256').update(raw).digest('hex')};});
assert(files.length>0&&files.length<=200);assert.equal(attempts,0);
process.stdout.write(JSON.stringify({uid:process.getuid(),gid:process.getgid(),files,attempts}));
'''
    args = ['/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups', '--inh-caps=-all',
            '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL',
            str(NODE), '--input-type=module', '-e', script, str(PROJECT)]
    child = subprocess.run(args, env=CLEAN, cwd='/', capture_output=True, timeout=20)
    exclusive(BASE / 'pg-closure.stdout', child.stdout); exclusive(BASE / 'pg-closure.stderr', child.stderr)
    need(child.returncode == 0 and not child.stderr and len(child.stdout) <= 200000,
         'isolated_actual_pg_dependency_import_refused')
    value = json.loads(child.stdout)
    need(value['uid'] == 111 and value['gid'] == 113 and value['attempts'] == 0 and
         0 < len(value['files']) <= 200, 'exact_restricted_pg_import_with_no_transports_required')
    for row in value['files']:
        path = Path(row['path']); entry = entries[str(path.relative_to(ROOT))]
        need(entry.get('type') == 'file' and entry.get('sha256') == row['sha256'] and entry.get('bytes') == row['bytes'],
             'all_loaded_pg_dependency_bytes_must_match_accepted_inventory')
        need(len(read(path, row['sha256'])) == row['bytes'], 'loaded_pg_dependency_must_remain_unchanged')
    return {'loadedFiles': len(value['files']), 'loadedFileGraphSha256': sha(encoded(value['files'])),
            'inventoryMatched': True, 'databaseConnections': 0, 'poolConstructed': False, 'transportAttempts': 0}


def qualify(stage_sha):
    recorded = document(BASE / 'stage-result.json', stage_sha)
    current = review()
    need(recorded.get('staged') is True and recorded['binding'] == current,
         'same_owned_source_stage_and_current_dependencies_required')
    need(not os.path.lexists(BASE / 'qualification-intent.json'), 'qualification_already_attempted_no_automatic_repeat')
    exclusive(BASE / 'qualification-intent.json', encoded({'stageResultSha256': stage_sha, 'reviewHash': current['reviewHash']}))
    dependency_proof, inventory_entries = production()
    need(dependency_proof == current['productionDependencies'], 'unchanged_dependencies_before_peer_execution_required')
    preevaluation = preauthorize_dependencies(inventory_entries)
    results = {}
    for kind in ('postgres', 'main'):
        child = subprocess.run(['/usr/bin/python3', '-I', '-B', str(OPS / TRANSPORT), '--qualify', kind],
                               env=CLEAN, cwd='/', capture_output=True, timeout=40)
        exclusive(BASE / (kind + '.stdout'), child.stdout)
        exclusive(BASE / (kind + '.stderr'), child.stderr)
        need(child.returncode == 0 and not child.stderr and len(child.stdout) <= 16384,
             'actual_restricted_peer_qualification_refused_private_logs_retained')
        value = json.loads(child.stdout)
        need(value.get('format') == 'yunipals-reader-peer-runtime-v1' and value.get('qualifiedPublicTransport') is True and
             value.get('peer') == kind and value['qualification']['installedPgImported'] is True and
             value['qualification']['installedMainCodeReadable'] is (kind == 'main') and
             value['qualification']['installedAppImported'] is False and value['qualification']['databaseConnections'] == 0 and
             value['qualification']['transportAttempts'] == 0, 'exact_no_application_no_database_qualification_required')
        expected = current['peers']['postgres' if kind == 'postgres' else 'yunipals_unified_api']
        need(value['qualification']['uid'] == expected['uid'] and value['qualification']['gid'] == expected['gid'],
             'same_reviewed_actual_OS_peer_mapping_required')
        results[kind] = value
    loaded_pg = pg_closure(inventory_entries)
    need(review() == current, 'public_files_permissions_peers_and_dependencies_must_remain_unchanged')
    result = {'format': FORMAT, 'qualified': True, 'stageResultSha256': stage_sha, 'reviewHash': current['reviewHash'],
              'peers': current['peers'], 'results': results, 'publicFiles': len(PAYLOAD), 'existingPermissionChanges': 0,
              'productionDependencies': current['productionDependencies'], 'preEvaluationDependencyProof': preevaluation,
              'loadedPgDependencies': loaded_pg,
              'applicationStarted': False, 'poolConstructed': False,
              'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0, 'coordinatorIntegrated': False}
    exclusive(BASE / 'qualification-result.json', encoded(result))
    return {key: result[key] for key in ('format', 'qualified', 'peers', 'publicFiles', 'productionDependencies',
                                        'preEvaluationDependencyProof', 'loadedPgDependencies',
                                        'existingPermissionChanges', 'applicationStarted', 'poolConstructed', 'databaseConnections',
                                        'providerCalls', 'serviceActions', 'coordinatorIntegrated')} | {
        'qualificationResultSha256': sha(encoded(result)), 'peerCount': len(results)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--stage')
    mode.add_argument('--qualify')
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == 'yunipals-main', 'root_on_exact_production_host_required')
    os.umask(0o077)
    try:
        value = stage(args.stage) if args.stage else qualify(args.qualify) if args.qualify else review()
        if not args.stage and not args.qualify:
            value = {'format': FORMAT, 'reviewHash': value['reviewHash'], 'payloadFiles': len(value['files']),
                     'alreadyPresent': sum(row['present'] for row in value['files']), 'peers': value['peers'],
                     'productionDependencies': value['productionDependencies'], 'operationsMode': oct(value['operations']['mode']),
                     'producerSha256': value['producerSha256'], 'existingPermissionChanges': 0,
                     'serviceActions': 0, 'databaseConnections': 0, 'providerCalls': 0}
        print(json.dumps(value, sort_keys=True))
    except Exception as error:
        reason = str(error) if isinstance(error, RuntimeError) and re.fullmatch('[a-zA-Z0-9_]+', str(error)) else 'public_peer_qualification_refused'
        print(json.dumps({'format': FORMAT, 'completed': False, 'reason': reason, 'errorClass': type(error).__name__,
                          'automaticRetry': False, 'serviceActions': 0, 'databaseConnections': 0, 'providerCalls': 0}, sort_keys=True))
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
