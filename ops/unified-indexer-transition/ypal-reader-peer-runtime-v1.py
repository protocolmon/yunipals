#!/usr/bin/env python3
"""Exact public-file transport, not an installed reader/admission authority."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
NODE = '/opt/node-v24.18.1/bin/node'
FORMAT = 'yunipals-reader-peer-runtime-v1'
LOADER = Path(__file__).with_suffix('.mjs')
LOADER_SHA = '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1'
PINS = {
    'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7',
    'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f',
    'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168',
    'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21',
    'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2',
    'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c',
    'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e',
    'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920'
}
PROJECT = '/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer'
MAIN = '/opt/yunipals-unified/nonmarket-consumer-releases/40e35c622534b9030622759116cf3b85361ad914211a76a7fd47ee06b60968f9'
MAIN_MANIFEST_SHA = '986a288dcebe5e7ce910b36d83f97178ce7c47336a0e9910e0d013e3ff3e347a'


def need(value, reason):
    if not value:
        raise RuntimeError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def public_bytes(path, expected):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0 and before.st_nlink == 1 and
             before.st_mode & 0o022 == 0 and 0 < before.st_size <= 1048576, 'fixed_root_owned_public_input_required')
        raw = b''
        while len(raw) <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             len(raw) == before.st_size and sha(raw) == expected, 'exact_unchanged_public_bytes_required')
        return raw
    finally:
        os.close(fd)


def inputs():
    loader = public_bytes(LOADER, LOADER_SHA)
    files = {name: public_bytes(OPS / name, digest) for name, digest in PINS.items()}
    manifest = json.loads(files['ypal-native-cutover-v1.manifest.json'])
    need(manifest['format'] == 'yunipals-ypal-native-cutover-source-v1', 'frozen_reader_source_manifest_required')
    for name, digest in PINS.items():
        if not name.endswith('.manifest.json'):
            need(manifest.get('files', {}).get(name, manifest.get('dependencies', {}).get(name)) == digest,
                 'exact_original_manifest_closure_required')
    return loader, files


def sealed(name, raw):
    fd = os.memfd_create(name, os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            need(count > 0, 'complete_sealed_public_write_required')
            view = view[count:]
        os.lseek(fd, 0, os.SEEK_SET)
        seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, seals)
        need(fcntl.fcntl(fd, fcntl.F_GET_SEALS) == seals, 'all_four_public_memfd_seals_required')
        return fd
    except BaseException:
        os.close(fd)
        raise


class Transport:
    """Arguments only: a future explicit coordinator owns its child lifecycle."""
    def __init__(self, loader, descriptor, descriptors):
        self.preload = 'data:text/javascript;base64,' + base64.b64encode(loader).decode()
        self.environment = {'YUNIPALS_READER_PUBLIC_FD': str(descriptor)}
        self.pass_fds = tuple(descriptors)

    def node_arguments(self, kind):
        need(kind in {'postgres', 'main'}, 'only_two_fixed_restricted_reader_entrypoints_allowed')
        entry = 'ypal-native-cutover-v1.mjs' if kind == 'postgres' else 'ypal-native-reader-probe-v1.mjs'
        return [NODE, '--import', self.preload, str(OPS / entry)]


@contextmanager
def public_transport():
    """Read ONLY fixed pinned public files; no chmod/copy/install or secret read."""
    need(os.geteuid() == 0, 'root_parent_required_to_open_private_operations_public_files')
    loader, files = inputs()
    descriptors = []
    try:
        rows = []
        for name, raw in files.items():
            fd = sealed('yunipals-reader-public', raw)
            descriptors.append(fd)
            rows.append({'name': name, 'fd': fd, 'bytes': len(raw), 'sha256': PINS[name]})
        descriptor = sealed('yunipals-reader-public-descriptor', encoded({'format': 'yunipals-reader-sealed-public-v1', 'files': rows}))
        descriptors.append(descriptor)
        yield Transport(loader, descriptor, descriptors)
    finally:
        for fd in descriptors:
            os.close(fd)


# Imports only. None of the frozen child main functions run. The hook also
# proves the v4 top-level reads of its own and the original peer-v2 bytes.
QUALIFY_SCRIPT = r'''
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import net from 'node:net';import tls from 'node:tls';
import http from 'node:http';import https from 'node:https';import dgram from 'node:dgram';
let attempts=0;
function deny(){attempts++;throw Error('qualification_network_and_database_transport_denied');}
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;
for(const module of [net,tls,http,https,dgram])
 for(const key of ['connect','createConnection','request','get','createSocket'])
  if(typeof module[key]==='function')module[key]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();
const base='file:///opt/yunipals-unified/operations/free-replay-20261020/';
const names=JSON.parse(process.argv[1]);
for(const name of names){
 const bytes=readFileSync(new URL(name,base));
 if(name.endsWith('.mjs'))await import(new URL(name,base).href);
 assert(bytes.length>0);
}
await assert.rejects(import(base+'unknown-private.mjs'),{code:'EACCES'});
assert.throws(()=>readFileSync(new URL('unknown-private.env',base)),{code:'EACCES'});
const mode=process.argv[2];
if(mode==='installed'){
 const pg=createRequire(process.argv[3]+'/package.json')('pg');
 assert.equal(typeof pg.Client,'function');
 assert.equal(typeof pg.Pool,'function');
 if(process.argv[4]!=='-'){
  const root=process.argv[4],raw=readFileSync(root+'/manifest.json');
  assert.equal(createHash('sha256').update(raw).digest('hex'),process.argv[5]);
  const manifest=JSON.parse(raw),row=manifest.files.find(r=>r.path==='dist/main-api.mjs');
  assert(row&&Number.isSafeInteger(row.bytes)&&row.bytes>0);
  const code=readFileSync(root+'/dist/main-api.mjs');
  assert.equal(code.length,row.bytes);
  assert.equal(createHash('sha256').update(code).digest('hex'),row.sha256);
 }
}
const status=readFileSync('/proc/self/status','utf8');
for(const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])
 assert.equal(status.match(new RegExp('^'+name+':\\s*([a-f0-9]+)$','m'))?.[1],'0000000000000000');
assert.equal(status.match(/^NoNewPrivs:\s*(\d+)$/m)?.[1],'1');
assert.equal((status.match(/^Groups:[ \t]*(.*)$/m)?.[1]??'missing').trim(),'');
assert.equal(attempts,0);
process.stdout.write(JSON.stringify({publicModulesImported:7,publicFiles:8,uid:process.getuid(),gid:process.getgid(),
 groups:process.getgroups(),capabilitiesEmpty:true,noNewPrivileges:true,transportAttempts:attempts,
 databaseConnections:0,installedPgImported:mode==='installed',installedMainCodeReadable:mode==='installed'&&process.argv[4]!=='-',
 installedAppImported:false,actualActionProbePassed:false}));
'''


def peer(kind):
    need(kind in {'postgres', 'main'}, 'fixed_restricted_reader_peer_required')
    if kind == 'postgres':
        return 111, 113
    user = pwd.getpwnam('yunipals_unified_api')
    need(user.pw_uid > 0 and user.pw_gid > 0, 'existing_main_API_OS_peer_required')
    return user.pw_uid, user.pw_gid


def qualify(kind):
    uid, gid = peer(kind)
    with public_transport() as transport:
        args = ['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups',
                '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL',
                NODE, '--import', transport.preload, '--input-type=module', '--eval', QUALIFY_SCRIPT,
                json.dumps(list(PINS)), 'installed', PROJECT, MAIN if kind == 'main' else '-', MAIN_MANIFEST_SHA]
        result = subprocess.run(args, env={'PATH': '/usr/bin:/bin', **transport.environment},
                                cwd='/', pass_fds=transport.pass_fds, capture_output=True, timeout=30)
        need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 8192,
             'restricted_peer_public_runtime_qualification_refused')
        value = json.loads(result.stdout)
        need(value['uid'] == uid and value['gid'] == gid and value['transportAttempts'] == value['databaseConnections'] == 0,
             'actual_expected_restricted_peer_no_transport_required')
        return {'format': FORMAT, 'qualifiedPublicTransport': True, 'peer': kind,
                'sourceManifestSha256': PINS['ypal-native-cutover-v1.manifest.json'], 'loaderSha256': LOADER_SHA,
                'qualification': value, 'serviceChanges': 0, 'filesystemPermissionChanges': 0,
                'coordinatorIntegrated': False, 'provesNativeCutover': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qualify', choices=['postgres', 'main'])
    args = parser.parse_args()
    if args.qualify:
        value = qualify(args.qualify)
    else:
        inputs()
        value = {'format': FORMAT, 'publicInputsVerified': True, 'files': PINS, 'loaderSha256': LOADER_SHA,
                 'qualifiedPublicTransport': False, 'childProcesses': 0, 'serviceChanges': 0,
                 'databaseConnections': 0, 'filesystemPermissionChanges': 0, 'coordinatorIntegrated': False}
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    main()
