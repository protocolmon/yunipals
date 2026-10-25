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
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
NODE = '/opt/node-v24.18.1/bin/node'
FORMAT = 'yunipals-ordinary-reader-peer-v5'
LOADER = OPS / 'ypal-reader-peer-runtime-v1.mjs'
LOADER_SHA = '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1'
PINS = {'ypal-ordinary-reader-sql-v5.mjs': 'c027ec84402efd09a5a8d07371c010203e314c346aa8e15873cdf58fdb0f03b7', 'ypal-ordinary-reader-probe-v5.mjs': '8657ad1b047c62c33b13312795adcbef6b8e05839793c0df68e7340ee7a2c62f', 'ypal-ordinary-reader-wire-v5.manifest.json': 'c38ddda22c242d165e609bf5321f174d0214d1f9c7dabe13b59a27c945f19972', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2'}
PROJECT = '/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer'
MAIN = '/opt/yunipals-unified/nonmarket-consumer-releases/f2fa474602b2df9012b9ce05561445a2247b16bb76808d8c3d6ca1d14b378d9f'
MAIN_MANIFEST_SHA = 'bba6126ae55299eeb885a3ef72a17155398ad4e0c604f582898abd3952b2e6a2'


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
    template = public_bytes(LOADER, LOADER_SHA)
    pattern = rb'const PINS = Object\.freeze\(\{.*?\}\);'
    import re
    matches=list(re.finditer(pattern,template,re.S));need(len(matches)==1,'one_frozen_reader_hook_pin_table_required')
    row=matches[0];loader=template[:row.start()]+('const PINS = Object.freeze('+json.dumps(PINS,sort_keys=True)+');').encode()+template[row.end():]
    files = {name: public_bytes(OPS / name, digest) for name, digest in PINS.items()}
    manifest = json.loads(files['ypal-ordinary-reader-wire-v5.manifest.json'])
    need(manifest['format'] == 'yunipals-ypal-ordinary-reader-wire-v5', 'frozen_reader_source_manifest_required')
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
        entry = 'ypal-ordinary-reader-sql-v5.mjs' if kind == 'postgres' else 'ypal-ordinary-reader-probe-v5.mjs'
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
process.stdout.write(JSON.stringify({publicModulesImported:9,publicFiles:12,uid:process.getuid(),gid:process.getgid(),
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


DEPENDENCY_QUALIFIER=Path('/var/tmp/yunipals-reader-peer-runtime-input-v1-20261024/ypal-reader-peer-runtime-host-v1.py')
DEPENDENCY_QUALIFIER_SHA='06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76'
DEPENDENCY_RECEIPT=Path('/var/backups/yunipals-reader-peer-runtime-host-v1-20261024/qualification-result.json')
DEPENDENCY_RECEIPT_SHA='521e0bb514f1f6ba306b82d489f19ea53183dcdd2aa1e76aa65498cc184f1899'
BASE=Path('/var/backups/yunipals-ypal-ordinary-reader-peer-v5-20261025')
_dependency_proof=None

def dependency_current():
    global _dependency_proof
    raw=public_bytes(DEPENDENCY_QUALIFIER,DEPENDENCY_QUALIFIER_SHA)
    helper=types.ModuleType('acknowledged_reader_dependency_qualification');helper.__file__=str(DEPENDENCY_QUALIFIER)
    exec(compile(raw,str(DEPENDENCY_QUALIFIER),'exec'),helper.__dict__)
    receipt=helper.document(DEPENDENCY_RECEIPT,DEPENDENCY_RECEIPT_SHA)
    if _dependency_proof is None:
        current,entries=helper.production()
        need(current==receipt['productionDependencies'],'same_acknowledged_dependency_programs_required')
        proof=helper.preauthorize_dependencies(entries)
        need(proof==receipt['preEvaluationDependencyProof'],'exact_accepted_dependencies_before_evaluation_required')
        _dependency_proof=proof
    return _dependency_proof


def qualify(kind):
    dependency_current()
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
                'sourceManifestSha256': PINS['ypal-ordinary-reader-wire-v5.manifest.json'], 'loaderSha256': LOADER_SHA,
                'qualification': value, 'serviceChanges': 0, 'filesystemPermissionChanges': 0,
                'coordinatorIntegrated': False, 'provesNativeCutover': False}


def capture():
    need(os.geteuid()==os.getegid()==0,'root_exclusive_public_transport_capture_required')
    dependency=dependency_current();inputs()
    BASE.mkdir(mode=0o700)
    need(BASE.lstat().st_uid==BASE.lstat().st_gid==0 and stat.S_IMODE(BASE.lstat().st_mode)==0o700,'private_new_qualification_directory_required')
    def save(name,value):
        fd=os.open(BASE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            raw=encoded(value);view=memoryview(raw)
            while view:
                count=os.write(fd,view);need(count>0,'complete_private_qualification_write_required');view=view[count:]
            os.fsync(fd)
        finally:os.close(fd)
        fd=os.open(BASE,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    own=public_bytes(Path(__file__).absolute(),sha(Path(__file__).read_bytes()))
    intent={'format':FORMAT,'producerSha256':sha(own),'publicFiles':PINS,'historicalDependencyReceiptSha256':DEPENDENCY_RECEIPT_SHA}
    save('qualification-intent.json',intent)
    peers={kind:qualify(kind)for kind in['postgres','main']}
    inputs();need(public_bytes(Path(__file__).absolute(),sha(own))==own,'qualification_producer_changed')
    record={**intent,'qualified':True,'wireManifestSha256':PINS['ypal-ordinary-reader-wire-v5.manifest.json'],
            'peers':peers,'preEvaluationDependencyProof':dependency,'databaseConnections':0,'providerCalls':0,'serviceActions':0,'permissionChanges':0}
    save('qualification-result.json',record)
    return {'format':FORMAT,'qualified':True,'qualificationSha256':sha(encoded(record)),'peers':2,'publicFiles':len(PINS),
            'databaseConnections':0,'providerCalls':0,'serviceActions':0,'permissionChanges':0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group()
    group.add_argument('--qualify', choices=['postgres', 'main'])
    group.add_argument('--capture-qualification',action='store_true')
    args = parser.parse_args()
    if args.capture_qualification:
        value=capture()
    elif args.qualify:
        value = qualify(args.qualify)
    else:
        inputs()
        value = {'format': FORMAT, 'publicInputsVerified': True, 'files': PINS, 'loaderSha256': LOADER_SHA,
                 'qualifiedPublicTransport': False, 'childProcesses': 0, 'serviceChanges': 0,
                 'databaseConnections': 0, 'filesystemPermissionChanges': 0, 'coordinatorIntegrated': False}
    print(json.dumps(value, sort_keys=True))


if __name__ == '__main__':
    main()
