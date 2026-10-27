"""Exact three public modules, real sealed FDs and cross-UID import; no DB/providers."""
import base64
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('-','_'),HERE/name); value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('ypal-restored-cache-peer-runtime-v1.py');old=load('ypal-reader-peer-runtime-v1.py')
NODE=Path('/root/.nvm/versions/node/v24.18.1/bin/node')


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.ops=self.root/'private-ops';self.ops.mkdir(mode=0o700)
        for name in m.PINS:
            shutil.copyfile(HERE/name,self.ops/name);(self.ops/name).chmod(0o600)
        self.sentinel=self.ops/'private.env';self.sentinel.write_text('SYNTHETIC_PRIVATE_SENTINEL');self.sentinel.chmod(0o600)
        self.primitives=patch.object(m,'primitives',return_value=old);self.primitives.start();self.addCleanup(self.primitives.stop)
        self.paths=patch.object(m,'OPS',self.ops);self.paths.start();self.addCleanup(self.paths.stop)
        self.template=patch.object(m,'TEMPLATE',HERE/'ypal-reader-peer-runtime-v1.mjs');self.template.start();self.addCleanup(self.template.stop)

    def test_only_pin_table_changes_in_frozen_hook(self):
        original=(HERE/'ypal-reader-peer-runtime-v1.mjs').read_bytes();new=m.loader_bytes(original)
        regex=r'const PINS = Object\.freeze\(\{.*?\}\);'
        import re
        self.assertEqual(re.sub(regex,'PINS',original.decode(),flags=re.S),re.sub(regex,'PINS',new.decode(),flags=re.S))
        self.assertEqual(len(m.PINS),3)
        with self.assertRaises(RuntimeError):m.loader_bytes(original+b'\n')

    def test_exact_three_hashes_and_sealed_descriptor_cleanup(self):
        with m.public_transport()as transport:
            self.assertEqual(len(transport.pass_fds),4);fds=transport.pass_fds
            for fd in fds:
                self.assertEqual(fcntl.fcntl(fd,fcntl.F_GET_SEALS),15)
                with self.assertRaises(PermissionError):os.write(fd,b'foreign')
            self.assertEqual(transport.node_arguments()[-1],str(self.ops/m.ENTRY))
        for fd in fds:
            with self.assertRaises(OSError):os.fstat(fd)

    def test_changed_file_symlink_hardlink_or_writable_input_refused(self):
        path=self.ops/m.ENTRY;original=path.read_bytes();path.write_bytes(original+b'changed')
        with self.assertRaises(RuntimeError):
            with m.public_transport():pass
        path.write_bytes(original);path.chmod(0o660)
        with self.assertRaises(RuntimeError):
            with m.public_transport():pass
        path.chmod(0o600);os.link(path,self.ops/'foreign-hardlink')
        with self.assertRaises(RuntimeError):
            with m.public_transport():pass
        (self.ops/'foreign-hardlink').unlink();path.unlink();path.symlink_to(HERE/m.ENTRY)
        with self.assertRaises(OSError):
            with m.public_transport():pass

    def run_peer(self,script,transport,uid=111,gid=113):
        fd=os.open(NODE,os.O_RDONLY|os.O_CLOEXEC)
        try:
            args=['/usr/bin/setpriv','--reuid='+str(uid),'--regid='+str(gid),'--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','--pdeathsig=KILL','/proc/self/fd/'+str(fd),'--import',transport.preload,'--input-type=module','--eval',script]
            return subprocess.run(args,env={'PATH':'/usr/bin:/bin',**transport.environment},cwd='/',pass_fds=(*transport.pass_fds,fd),capture_output=True,timeout=15)
        finally:os.close(fd)

    def test_actual_three_modules_import_as_postgres_no_network_or_private_access(self):
        script=r"""
import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{syncBuiltinESMExports}from'node:module';
import net from'node:net';import tls from'node:tls';import http from'node:http';import https from'node:https';import dgram from'node:dgram';
let attempts=0;const deny=()=>{attempts++;throw Error('network_forbidden');};
for(const m of[net,tls,http,https,dgram])for(const k of['connect','createConnection','request','get','createSocket'])if(typeof m[k]==='function')m[k]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();
const base='file:///opt/yunipals-unified/operations/free-replay-20261020/';
const expected=PINS;
for(const[name,pin]of Object.entries(expected)){
 const raw=readFileSync(new URL(name,base));assert.equal(createHash('sha256').update(raw).digest('hex'),pin);
 await import(base+name);readFileSync(new URL(name,base)).fill(0);
 assert.equal(createHash('sha256').update(readFileSync(new URL(name,base))).digest('hex'),pin);
}
for(const suffix of['private.env','unlisted.mjs','ypal-restored-cache-sql-v1.mjs?foreign','ypal-restored-cache-sql-v1.mjs#foreign']){
 assert.throws(()=>readFileSync(new URL(suffix,base)),{code:'EACCES'});await assert.rejects(import(base+suffix),{code:'EACCES'});
}
assert.throws(()=>readFileSync(SENTINEL),{code:'EACCES'});
assert.equal(attempts,0);process.stdout.write(JSON.stringify({uid:process.getuid(),modules:3,networkAttempts:attempts,databaseConnections:0}));
""".replace('PINS',json.dumps(m.PINS)).replace('SENTINEL',json.dumps(str(self.sentinel)))
        before={p.name:(p.read_bytes(),p.stat().st_mode,p.stat().st_ino)for p in self.ops.iterdir()}
        with m.public_transport()as transport:result=self.run_peer(script,transport)
        self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(result.stderr,b'')
        self.assertEqual(json.loads(result.stdout),{'uid':111,'modules':3,'networkAttempts':0,'databaseConnections':0})
        self.assertEqual(before,{p.name:(p.read_bytes(),p.stat().st_mode,p.stat().st_ino)for p in self.ops.iterdir()})
        self.assertEqual(self.ops.stat().st_mode&0o777,0o700)

if __name__=='__main__':unittest.main(verbosity=2)
