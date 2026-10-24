#!/usr/bin/env python3
"""Exclusive public artifact staging and denied-side-effect RPC-user import only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import socket
import stat
import subprocess
import time

FORMAT = 'yunipals-alchemy-primary-stage-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
TARGET = OPS / 'ypal-alchemy-primary-queue-v1'
INPUT = OPS / 'ypal-alchemy-primary-stage-v1-input'
BASE = Path('/var/backups/yunipals-alchemy-primary-stage-v1-20261024')
RELEASE = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
CONTEXT = RELEASE / 'apps/yunipals-market-api/node_modules'
INVENTORY = Path('/var/tmp/yunipals-runtime-6e112a0c-20261021/runtime-supplement.inventory.json')
INVENTORY_SHA = 'dbc145f11d13c61ce45b2bcf3c557bd90431bda7ce4a6dbe62136a24db84ab58'
NODE = Path('/opt/node-v24.18.1/bin/node')
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
RPC_USER = 'yunipals-market-prod-rpc'
COMMIT = '99df016621c50839059237a634d8b727a2e82bd7'
PAYLOAD = {
    'prepare.mjs': ('f74a0f006c8574521fbbe7af28658d1546eb049fa0b47d392cea4867ef53569d', 2268),
    'rpc-budget-proxy.mjs': ('10c34c878d5a617fe31d4fffd6a8b020610b39b988de1cf2aac0cb11e7ac59d8', 111687),
    'artifact.json': ('3828ec734d82eab1b3b96d27e4977c9a29baf0b4e3e284af2d435b1c9f244dec', 949),
    'compiled.test.mjs': ('189e993ede2a29a28039ea0c82f0f8912f7a88b2eaa0fd2b2e529946f1fa177a', 5185),
    'README.md': ('1fa8b7dbe200b56d2777e951c157df225668e3d666f0a19295f0bdbbffca5a4b', 1824)
}
OLD = OPS / 'ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs'
OLD_SHA = '8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c'
ANCHOR = b'const sourceRequest = unifiedSourcePaidLogs && unifiedWorkload === "unified_source" ? new AbortController() : void 0;'
REPLACEMENT = ANCHOR.replace(b'unifiedSourcePaidLogs &&', b'(unifiedSourcePaidPrimary || unifiedSourcePaidLogs) &&')
PACKAGES = {
    'pg': '../../../node_modules/.pnpm/pg@8.23.0/node_modules/pg',
    'viem': '../../../node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem'
}
DEPENDENCIES = {
    'node_modules/.pnpm/pg@8.23.0/node_modules/pg/esm/index.mjs': '5ef4d06556eeb775987759c2c09229dca2139421ee40e819b566612db2b4a8dc',
    'node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js': '3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c',
    'node_modules/.pnpm/pg@8.23.0/node_modules/pg/package.json': 'e42dd36cba6e9dd8dbb6f773a2f7be8a8c3c273e18b155e42e75961a4cb8bc28',
    'node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem/_esm/index.js': 'ef21c6b781a763af96a5503e7ed9288108d6ba229db16210fd4ad40b718db6ec',
    'node_modules/.pnpm/viem@2.38.0_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@4.6.5/node_modules/viem/package.json': '16b801dd5bfceb81ed9efb05c342a3675a865d0ce33446e54fb6e6c907045183'
}
UNITS = ['yunipals-ypal-combined-source.service', 'yunipals-booster-ypal-source.service', 'yunipals-booster-api.service',
         *['yunipals-combined-rpc@' + c + '.service' for c in ('ethereum', 'base', 'polygon', 'bnb')]]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def identity(path):
    row = Path(path).lstat()
    return {k: getattr(row, k) for k in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode', 'st_nlink',
                                        'st_size', 'st_mtime_ns', 'st_ctime_ns')}


def directory(path, mode=None, sticky=False):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'fixed_absolute_public_path_required')
    for parent in [*path.parents, path]:
        row = parent.lstat()
        permitted_sticky = sticky and parent == Path('/var/tmp') and stat.S_IMODE(row.st_mode) == 0o1777
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and
             (not row.st_mode & 0o022 or permitted_sticky), 'protected_real_root_directory_required')
    need(mode is None or stat.S_IMODE(path.lstat().st_mode) == mode, 'exact_owned_directory_mode_required')


def read(path, expected=None, limit=8000000, sticky=False):
    path = Path(path)
    directory(path.parent, sticky=sticky)
    before = identity(path)
    need(stat.S_ISREG(before['st_mode']) and before['st_uid'] == before['st_gid'] == 0 and
         not before['st_mode'] & 0o022 and before['st_nlink'] == 1 and before['st_size'] <= limit,
         'bounded_root_owned_regular_input_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        chunks = []
        while True:
            chunk = os.read(fd, 1048576)
            if not chunk:
                break
            chunks.append(chunk)
            need(sum(map(len, chunks)) <= limit, 'bounded_input_bytes_required')
        raw = b''.join(chunks)
        need(before == identity(path) and all(getattr(os.fstat(fd), key) == value for key, value in before.items()) and
             len(raw) == before['st_size'] and (expected is None or sha(raw) == expected),
             'same_inode_and_exact_accepted_input_bytes_required')
        return raw
    finally:
        os.close(fd)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, raw, mode=0o600):
    directory(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb', closefd=False) as f:
            f.write(raw)
            f.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)
    return {'sha256': sha(raw), 'identity': identity(path)}


def peer():
    row = pwd.getpwnam(RPC_USER)
    need(0 < row.pw_uid < 65536 and 0 < row.pw_gid < 65536, 'actual_nonroot_rpc_account_required')
    return {'name': RPC_USER, 'uid': row.pw_uid, 'gid': row.pw_gid}


def retained():
    old = read(OLD, OLD_SHA)
    need(len(old) == 111657 and old.count(ANCHOR) == 1, 'exact_accepted_free_preimage_required')
    directory(CONTEXT, 0o755)
    info = identity(CONTEXT)
    need((info['st_dev'], info['st_ino']) == (2049, 1430272), 'exact_retained_runtime_context_inode_required')
    links = {}
    for name, target in PACKAGES.items():
        path = CONTEXT / name
        row = path.lstat()
        need(stat.S_ISLNK(row.st_mode) and row.st_uid == row.st_gid == 0 and os.readlink(path) == target,
             'same_retained_pg_viem_package_links_required')
        links[name] = {'target': target, 'identity': identity(path)}
    for name, digest in DEPENDENCIES.items():
        read(RELEASE / name, digest)
    read(NODE, NODE_SHA, 200000000)
    raw = read(INVENTORY, INVENTORY_SHA, 40000000, sticky=True)
    inventory = json.loads(raw)
    entries = inventory['entries']
    need(inventory['sourceDigest'] == RELEASE.name and 1 <= len(entries) <= 100000 and
         len({row['path'] for row in entries}) == len(entries) and
         all(not Path(row['path']).is_absolute() and '..' not in Path(row['path']).parts for row in entries),
         'accepted_finite_retained_runtime_inventory_required')
    read(RELEASE / 'RELEASE-MANIFEST.json', inventory['sourceManifestSha256'])
    return {'oldArtifact': {'sha256': OLD_SHA, 'identity': identity(OLD)}, 'context': info,
            'packageLinks': links, 'dependencies': DEPENDENCIES, 'nodeSha256': NODE_SHA,
            'inventorySha256': INVENTORY_SHA}, {row['path']: row for row in entries}


def actors():
    result = {}
    fields = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'NRestarts',
              'ControlGroup', 'FragmentPath', 'DropInPaths']
    for unit in UNITS:
        raw = subprocess.run(['/usr/bin/systemctl', 'show', unit, *['--property=' + f for f in fields]],
                             capture_output=True, check=True, timeout=8, env={'PATH': '/usr/bin:/bin'})
        need(not raw.stderr and len(raw.stdout) < 100000, 'bounded_readonly_manager_observation_required')
        values = dict(line.split('=', 1) for line in raw.stdout.decode().splitlines())
        need(set(values) == set(fields) and values['Id'] == unit, 'complete_unchanged_actor_frame_required')
        if values['MainPID'] != '0':
            pid = int(values['MainPID'])
            process = Path('/proc') / str(pid)
            start = (process / 'stat').read_text()
            values['processStartTicks'] = int(start[start.rfind(')') + 2:].split()[19])
            values['commandSha256'] = sha((process / 'cmdline').read_bytes())
        result[unit] = values
    return result


def review():
    directory(OPS)
    need(not os.path.lexists(TARGET) and not os.path.lexists(BASE), 'fresh_public_target_and_audit_must_be_absent')
    directory(INPUT)
    need({p.name for p in INPUT.iterdir()} == set(PAYLOAD), 'only_exact_five_published_incoming_files_required')
    rows = {}
    for name, (digest, length) in PAYLOAD.items():
        raw = read(INPUT / name, digest)
        need(len(raw) == length, 'exact_five_public_candidate_file_sizes_required')
        rows[name] = {'sha256': digest, 'bytes': length, 'incomingIdentity': identity(INPUT / name)}
    before, _ = retained()
    need(read(OLD).replace(ANCHOR, REPLACEMENT) == read(INPUT / 'rpc-budget-proxy.mjs'),
         'exact_one_condition_compiled_derivation_required')
    value = {'format': FORMAT, 'operatorSha256': sha(read(Path(__file__).absolute())), 'publicCommit': COMMIT,
             'operationsIdentity': identity(OPS), 'files': rows, 'retained': before, 'peer': peer(), 'actors': actors()}
    return {**value, 'reviewHash': sha(encoded(value)), 'sourceLifecycleQualified': False,
            'financialAuthorityQualified': False, 'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0}


def stage(expected):
    before = review()
    need(before['reviewHash'] == expected, 'exact_fresh_inactive_stage_review_required')
    BASE.mkdir(mode=0o700)
    sync(BASE.parent)
    write_new(BASE / 'stage-intent.json', encoded(before))
    TARGET.mkdir(mode=0o755)
    TARGET.chmod(0o755)  # Only the just-created, exclusive public directory.
    sync(TARGET.parent)
    write_new(BASE / 'directory-created.json', encoded({'identity': identity(TARGET)}))
    for name, (digest, _) in PAYLOAD.items():
        write_new(TARGET / name, read(INPUT / name, digest), 0o644)
    os.symlink(str(CONTEXT), TARGET / 'node_modules')
    sync(TARGET)
    after, _ = retained()
    need(after == before['retained'] and actors() == before['actors'] and peer() == before['peer'],
         'all_retained_runtime_bytes_inputs_and_actors_must_remain_unchanged')
    files = {name: {'sha256': sha(read(TARGET / name, digest)), 'identity': identity(TARGET / name)}
             for name, (digest, _) in PAYLOAD.items()}
    result = {'format': FORMAT, 'staged': True, 'reviewHash': expected, 'operatorSha256': before['operatorSha256'],
              'intentSha256': sha(read(BASE / 'stage-intent.json')), 'files': files,
              'targetIdentity': identity(TARGET), 'dependencyLink': {'identity': identity(TARGET / 'node_modules'),
              'target': str(CONTEXT)}, 'retained': after, 'peer': before['peer'], 'actors': before['actors'],
              'runtimeSelected': False, 'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0}
    write_new(BASE / 'stage-result.json', encoded(result))
    return {'format': FORMAT, 'staged': True, 'stageResultSha256': sha(encoded(result)), 'publicFiles': 5,
            'runtimeSelected': False, 'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0}


IMPORT = r'''import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire,registerHooks,builtinModules,syncBuiltinESMExports} from 'node:module';
import net from 'node:net';import tls from 'node:tls';import http from 'node:http';import https from 'node:https';
import dgram from 'node:dgram';import dns from 'node:dns';import cp from 'node:child_process';
import http2 from 'node:http2';import workers from 'node:worker_threads';
let input='';for await(const chunk of process.stdin){input+=chunk;assert(input.length<=40000000)}
const cfg=JSON.parse(input), counts={network:0,listen:0,database:0,pool:0,spawn:0};
const deny=key=>()=>{counts[key]++;throw Error('import_side_effect_refused_'+key)};
net.Socket.prototype.connect=deny('network');net.connect=net.createConnection=deny('network');net.Server.prototype.listen=deny('listen');
tls.connect=deny('network');http.request=http.get=https.request=https.get=deny('network');
dgram.createSocket=deny('network');dns.lookup=dns.resolve=deny('network');globalThis.fetch=deny('network');
for(const owner of [dns,dns.promises])for(const name of Object.keys(owner))if(/^(resolve|lookup|reverse)/.test(name)&&typeof owner[name]==='function')owner[name]=deny('network');
http2.connect=deny('network');globalThis.WebSocket=class{constructor(){counts.network++;throw Error('websocket_import_refused')}};
workers.Worker=class{constructor(){counts.spawn++;throw Error('worker_import_refused')}};
cp.spawn=cp.spawnSync=cp.exec=cp.execSync=cp.execFile=cp.execFileSync=cp.fork=deny('spawn');syncBuiltinESMExports();
assert.deepEqual(Object.keys(process.env),[]);assert.equal(process.getuid(),cfg.peer.uid);assert.equal(process.getgid(),cfg.peer.gid);
assert(process.getgroups().every(g=>g===cfg.peer.gid));const status=Object.fromEntries(fs.readFileSync('/proc/self/status','utf8').split('\n').filter(x=>x.includes(':')).map(x=>x.split(/:\s*/,2)));
assert.equal(status.Groups,'');assert.equal(status.NoNewPrivs,'1');for(const k of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])assert.equal(BigInt('0x'+status[k]),0n);
const loaded=new Map(),digest=b=>createHash('sha256').update(b).digest('hex');
function checked(file){const real=fs.realpathSync(file);if(real===cfg.candidate){assert.equal(digest(fs.readFileSync(real)),cfg.candidateSha);return real}
assert(real.startsWith(cfg.release+'/'));const relative=path.relative(cfg.release,real), row=cfg.entries[relative];
assert(row&&row.type==='file','unknown_dependency_before_evaluation');const a=fs.lstatSync(real);assert(a.isFile()&&a.uid===0&&a.gid===0&&a.nlink===1&&!(a.mode&0o022));
const raw=fs.readFileSync(real),b=fs.lstatSync(real);assert.equal(raw.length,row.bytes);assert.equal(digest(raw),row.sha256,'changed_dependency_before_evaluation');
assert.equal(a.ino,b.ino);assert.equal(a.mtimeMs,b.mtimeMs);loaded.set(relative,row.sha256);return real}
function packages(specifier,parent){if(specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':')||specifier.startsWith('#')||builtinModules.includes(specifier))return;
const parts=specifier.split('/'),name=specifier.startsWith('@')?parts.slice(0,2).join('/'):parts[0];let directory=path.dirname(fileURLToPath(parent));
for(let i=0;i<30;i++){const candidate=path.join(directory,'node_modules',name);if(fs.existsSync(candidate)){const metadata=path.join(candidate,'package.json');assert(fs.existsSync(metadata),'package_metadata_required');checked(metadata);return}const next=path.dirname(directory);if(next===directory)break;directory=next}
throw Error('unknown_package_resolution_before_evaluation')}
const hook=registerHooks({resolve(specifier,context,next){if(context.parentURL?.startsWith('file:'))packages(specifier,context.parentURL);return next(specifier,context)},
load(url,context,next){let real;if(url.startsWith('file:')){real=checked(fileURLToPath(url));let directory=path.dirname(real);for(let i=0;i<30&&directory.startsWith(cfg.release+'/');i++){const p=path.join(directory,'package.json');if(fs.existsSync(p))checked(p);directory=path.dirname(directory)}}const result=next(url,context);if(real&&['module','commonjs','json'].includes(result.format)){const raw=fs.readFileSync(checked(real));assert.equal(digest(raw),real===cfg.candidate?cfg.candidateSha:cfg.entries[path.relative(cfg.release,real)].sha256);return {...result,source:raw}}return result}});
const dlopen=process.dlopen;process.dlopen=function(module,file,...args){checked(file);return dlopen.call(this,module,file,...args)};
const require=createRequire(pathToFileURL(cfg.context+'/../package.json'));
const pg=require('pg');for(const type of ['Client','Pool','Connection']){const cls=pg[type];if(cls?.prototype)for(const name of ['connect','query','end'])cls.prototype[name]=deny('database');pg[type]=class{constructor(){counts[type==='Pool'?'pool':'database']++;throw Error('pg_construction_refused')}}}
Object.defineProperty(pg,'native',{configurable:true,get:deny('database')});
const actual=await import(pathToFileURL(cfg.candidate).href);
assert.deepEqual(Object.keys(actual).sort(),['createRpcBudgetProxy','isFreeRpcCall','isRpcBudgetProxyMain','readRpcBudgetProxyEnvironment','rpcPrimaryPoolSha256'].sort());
assert.equal(actual.isRpcBudgetProxyMain(),false);assert.deepEqual(counts,{network:0,listen:0,database:0,pool:0,spawn:0});
hook.deregister();const loadedDependencies=[...loaded].sort(),proof={actualUnprivilegedImport:true,uid:process.getuid(),gid:process.getgid(),noNewPrivileges:true,capabilitiesEmpty:true,
loadedDependencyFiles:loaded.size,loadedDependencies,loadedDependencySha256:digest(JSON.stringify(loadedDependencies)),counts,applicationConstructed:false,runtimeSelected:false};
assert(Buffer.byteLength(JSON.stringify(proof))<2000000);console.log(JSON.stringify(proof));
'''


def qualified_stage(stage_sha):
    result = json.loads(read(BASE / 'stage-result.json', stage_sha))
    need(result['format'] == FORMAT and result['staged'] is True and
         result['operatorSha256'] == sha(read(Path(__file__).absolute())) and
         result['intentSha256'] == sha(read(BASE / 'stage-intent.json')), 'actual_same_stager_ACK_required')
    directory(TARGET, 0o755)
    need({p.name for p in TARGET.iterdir()} == {*PAYLOAD, 'node_modules'}, 'only_five_inactive_files_and_owned_link_required')
    # Directory mtime/size changed during creation; result binds its final identity.
    need(identity(TARGET) == result['targetIdentity'], 'same_owned_new_public_directory_required')
    for name, (digest, _) in PAYLOAD.items():
        read(TARGET / name, digest)
        need(identity(TARGET / name) == result['files'][name]['identity'] and
             stat.S_IMODE((TARGET / name).lstat().st_mode) == 0o644, 'same_owned_public0644_file_required')
    link = TARGET / 'node_modules'
    need(stat.S_ISLNK(link.lstat().st_mode) and os.readlink(link) == str(CONTEXT) and
         identity(link) == result['dependencyLink']['identity'], 'same_owned_retained_dependency_link_required')
    current, entries = retained()
    need(current == result['retained'] and actors() == result['actors'] and peer() == result['peer'],
         'same_retained_inputs_peer_and_actors_required')
    return result, entries


def qualify(stage_sha):
    result, entries = qualified_stage(stage_sha)
    write_new(BASE / 'qualification-intent.json', encoded({'format': FORMAT, 'stageResultSha256': stage_sha,
              'operatorSha256': result['operatorSha256'], 'importGuardSha256': sha(IMPORT.encode())}))
    config = {'candidate': str(TARGET / 'rpc-budget-proxy.mjs'), 'candidateSha': PAYLOAD['rpc-budget-proxy.mjs'][0],
              'release': str(RELEASE), 'context': str(CONTEXT),
              'entries': {key: {k: row[k] for k in ('type', 'bytes', 'sha256')}
                          for key, row in entries.items() if row['type'] == 'file'}, 'peer': result['peer']}
    args = ['/usr/bin/setpriv', '--reuid=' + str(result['peer']['uid']), '--regid=' + str(result['peer']['gid']),
            '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs',
            '/usr/bin/env', '-i', str(NODE), '--max-old-space-size=256', '--input-type=module', '-e', IMPORT]
    out = BASE / 'qualification.stdout'; err = BASE / 'qualification.stderr'
    with out.open('xb') as stdout, err.open('xb') as stderr:
        os.chmod(out, 0o600); os.chmod(err, 0o600)
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr, cwd='/', env={}, start_new_session=True)
        try:
            process.communicate(encoded(config), timeout=40)
        except BaseException:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise
    need(process.returncode == 0 and out.stat().st_size <= 2000000 and err.stat().st_size == 0,
         'actual_cap0_rpc_import_must_succeed_without_side_effects_private_logs_retained')
    observation = json.loads(read(out))
    need(observation['actualUnprivilegedImport'] is True and observation['counts'] ==
         {'network': 0, 'listen': 0, 'database': 0, 'pool': 0, 'spawn': 0} and observation['loadedDependencyFiles'] > 0,
         'actual_guarded_dependency_import_and_zero_effect_counters_required')
    loaded = observation['loadedDependencies']
    need(isinstance(loaded, list) and len(loaded) == observation['loadedDependencyFiles'] <= 20000 and
         all(isinstance(row, list) and len(row) == 2 and row[0] in entries and
             entries[row[0]]['type'] == 'file' and row[1] == entries[row[0]]['sha256'] for row in loaded) and
         len({row[0] for row in loaded}) == len(loaded) and
         sha(json.dumps(loaded, separators=(',', ':'), ensure_ascii=False).encode()) == observation['loadedDependencySha256'],
         'exact_bounded_actual_loaded_dependency_subset_required')
    for relative, digest in loaded:
        read(RELEASE / relative, digest, 200000000)
    qualified_stage(stage_sha)
    value = {'format': FORMAT, 'qualified': True, 'stageResultSha256': stage_sha,
             'operatorSha256': result['operatorSha256'], 'observation': observation,
             'qualificationIntentSha256': sha(read(BASE / 'qualification-intent.json')),
             'scope': 'Actual default imported dependency closure only; unused dependency tree not rehashed.',
             'sourceLifecycleQualified': False, 'financialAuthorityQualified': False, 'databaseConnections': 0,
             'providerCalls': 0, 'serviceActions': 0, 'runtimeSelected': False}
    write_new(BASE / 'qualification-result.json', encoded(value))
    return {k: value[k] for k in ('format', 'qualified', 'sourceLifecycleQualified', 'financialAuthorityQualified',
                                'databaseConnections', 'providerCalls', 'serviceActions', 'runtimeSelected')} | {
        'qualificationResultSha256': sha(encoded(value)), 'loadedDependencyFiles': observation['loadedDependencyFiles']}


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply'); group.add_argument('--qualify'); group.add_argument('--describe', action='store_true')
    args = parser.parse_args()
    if args.describe:
        return {'format': FORMAT, 'sourceOnly': True, 'hostQualified': False, 'runtimeSelected': False,
                'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0}
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main', 'fixed_root_production_host_required')
    if args.apply:
        return stage(args.apply)
    if args.qualify:
        return qualify(args.qualify)
    value = review()
    # The raw actor/dependency/inode packet is private to the owner and its
    # root700 stage intent. CLI output never exports host argv/actor values.
    return {'format': FORMAT, 'reviewHash': value['reviewHash'], 'publicFiles': len(PAYLOAD),
            'retainedContextSha256': sha(encoded(value['retained'])),
            'actorFrameSha256': sha(encoded(value['actors'])), 'actorUnits': len(value['actors']),
            'peerBindingSha256': sha(encoded(value['peer'])), 'runtimeSelected': False,
            'sourceLifecycleQualified': False, 'financialAuthorityQualified': False,
            'databaseConnections': 0, 'providerCalls': 0, 'serviceActions': 0}


if __name__ == '__main__':
    print(json.dumps(main(), sort_keys=True))
