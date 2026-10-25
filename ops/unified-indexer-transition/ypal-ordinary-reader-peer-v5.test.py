#!/usr/bin/env python3
"""Local-only real cross-UID imports of the frozen reader closure."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('reader_public_runtime', HERE / 'ypal-ordinary-reader-peer-v5.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NODE = Path('/root/.nvm/versions/node/v24.18.1/bin/node')
LOGICAL = '/opt/yunipals-unified/operations/free-replay-20261020/'


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='yunipals-reader-peer-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ops = self.root / 'private-ops'
        self.ops.mkdir(mode=0o700)
        for name in m.PINS:
            target = self.ops / name
            shutil.copyfile(HERE / name, target)
            target.chmod(0o600)
        self.sentinel = self.ops / 'private.env'
        self.sentinel.write_text('SYNTHETIC_PRIVATE_SENTINEL_NOT_INHERITED\n')
        self.sentinel.chmod(0o600)
        self.loader_override=patch.object(m,'LOADER',HERE/'ypal-reader-peer-runtime-v1.mjs');self.loader_override.start();self.addCleanup(self.loader_override.stop)
        self.override = patch.object(m, 'OPS', self.ops)
        self.override.start()
        self.addCleanup(self.override.stop)

    def run_peer(self, transport, script, arguments=(), uid=111, gid=113, entry=None, observer=None):
        executable = os.open(NODE, os.O_RDONLY | os.O_CLOEXEC)
        try:
            args = ['/usr/bin/setpriv', '--reuid=' + str(uid), '--regid=' + str(gid), '--clear-groups',
                    '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--pdeathsig=KILL',
                    '/proc/self/fd/' + str(executable), '--import', transport.preload]
            if observer:
                import base64
                args += ['--import', 'data:text/javascript;base64,' + base64.b64encode(observer.encode()).decode()]
            args += [entry] if entry else ['--input-type=module', '--eval', script, *arguments]
            return subprocess.run(args, env={'PATH': '/usr/bin:/bin', 'YUNIPALS_CUTOVER_PARENT': str(os.getpid()),
                                            **transport.environment},
                                  cwd='/', input=script.encode() if entry else None,
                                  pass_fds=(*transport.pass_fds, executable), capture_output=True, timeout=15)
        finally:
            os.close(executable)

    def test_exact_frozen_manifest_and_eight_inputs(self):
        loader, files = m.inputs()
        self.assertNotEqual(m.sha(loader),m.LOADER_SHA);self.assertIn(b'ypal-ordinary-reader-sql-v5.mjs',loader)
        self.assertEqual(len(files), 12)
        self.assertEqual({k: m.sha(v) for k, v in files.items()}, m.PINS)

    def test_changed_known_public_file_refused_before_descriptor_creation(self):
        path = self.ops / 'ypal-ordinary-reader-probe-v5.mjs'
        path.write_bytes(path.read_bytes() + b'\n// foreign edit\n')
        with self.assertRaisesRegex(RuntimeError, 'exact_unchanged_public_bytes'):
            with m.public_transport():
                self.fail('changed file admitted')

    def test_symlink_and_writable_source_refused(self):
        name = 'ypal-ordinary-reader-sql-v5.mjs'
        path = self.ops / name
        path.unlink()
        path.symlink_to(HERE.resolve() / name)
        with self.assertRaises(OSError):
            m.inputs()
        path.unlink()
        shutil.copyfile(HERE / name, path)
        path.chmod(0o660)
        with self.assertRaisesRegex(RuntimeError, 'fixed_root_owned_public_input'):
            m.inputs()

    def test_sealed_descriptors_are_immutable_and_closed_after_context(self):
        with m.public_transport() as transport:
            descriptors = transport.pass_fds
            self.assertEqual(len(descriptors), 13)
            for fd in descriptors:
                self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), 15)
                with self.assertRaises(PermissionError):
                    os.write(fd, b'changed')
        for fd in descriptors:
            with self.assertRaises(OSError):
                os.fstat(fd)

    def test_only_two_original_logical_entrypoints(self):
        with m.public_transport() as transport:
            self.assertTrue(transport.node_arguments('postgres')[-1].endswith('/ypal-ordinary-reader-sql-v5.mjs'))
            self.assertTrue(transport.node_arguments('main')[-1].endswith('/ypal-ordinary-reader-probe-v5.mjs'))
            with self.assertRaises(RuntimeError):
                transport.node_arguments('private.env')

    def imports(self, uid, gid):
        before = {name: ((self.ops / name).read_bytes(), stat.S_IMODE((self.ops / name).stat().st_mode)) for name in m.PINS}
        with m.public_transport() as transport:
            result = self.run_peer(transport, m.QUALIFY_SCRIPT,
                                   [json.dumps(list(m.PINS)), 'local', '-', '-', '-'], uid, gid)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b'')
        value = json.loads(result.stdout)
        self.assertEqual((value['uid'], value['gid']), (uid, gid))
        self.assertEqual(value['publicModulesImported'], 9)
        self.assertEqual(value['transportAttempts'], 0)
        self.assertEqual(value['databaseConnections'], 0)
        self.assertFalse(value['installedPgImported'])
        self.assertFalse(value['actualActionProbePassed'])
        # Node reports the primary group on this host; /proc Groups remains
        # empty and is asserted inside the actual restricted child.
        self.assertIn(value['groups'], [[], [gid]])
        self.assertEqual(before, {name: ((self.ops / name).read_bytes(), stat.S_IMODE((self.ops / name).stat().st_mode)) for name in m.PINS})
        self.assertEqual(stat.S_IMODE(self.ops.stat().st_mode), 0o700)

    def test_real_uid111_imports_actual_frozen_public_closure(self):
        self.imports(111, 113)

    def test_real_uid967_imports_actual_frozen_public_closure(self):
        # Synthetic numeric UID proves transport mechanics; production main UID
        # is separately resolved from the actual existing OS account.
        self.imports(967, 961)

    def test_unknown_paths_private_sentinel_and_url_suffix_refused(self):
        script = r'''
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
assert.throws(()=>readFileSync(process.argv[1]),{code:'EACCES'});
const base='file:///opt/yunipals-unified/operations/free-replay-20261020/';
for(const suffix of ['private.env','unknown.mjs','ypal-ordinary-reader-sql-v5.mjs?changed','ypal-ordinary-reader-sql-v5.mjs#changed']){
 assert.throws(()=>readFileSync(new URL(suffix,base)),{code:'EACCES'});
 await assert.rejects(import(base+suffix),{code:'EACCES'});
}
process.stdout.write('refused');
'''
        with m.public_transport() as transport:
            result = self.run_peer(transport, script, [str(self.sentinel)])
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'refused', b''))

    def test_returned_buffer_cannot_change_later_self_hash_evidence(self):
        script = r'''
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const url=new URL('file:///opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-reader-sql-v5.mjs');
readFileSync(url).fill(0);
assert.equal(createHash('sha256').update(readFileSync(url)).digest('hex'),process.argv[1]);
process.stdout.write('stable');
'''
        with m.public_transport() as transport:
            result = self.run_peer(transport, script, [m.PINS['ypal-ordinary-reader-sql-v5.mjs']])
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'stable', b''))

    def damaged_descriptor(self, mutate):
        with m.public_transport() as transport:
            descriptor = int(transport.environment['YUNIPALS_READER_PUBLIC_FD'])
            metadata = json.loads(os.pread(descriptor, 16384, 0))
            extra = []
            try:
                mutate(metadata, extra)
                altered = m.sealed('altered-descriptor', m.encoded(metadata))
                extra.append(altered)
                substitute = m.Transport(m.public_bytes(m.LOADER, m.LOADER_SHA), altered, (*transport.pass_fds, *extra))
                result = self.run_peer(substitute, "process.stdout.write('MUST_NOT_EXECUTE')")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, b'')
            finally:
                for fd in extra:
                    os.close(fd)

    def test_child_independently_rejects_changed_public_descriptor_payload(self):
        def mutate(metadata, extra):
            raw = b'// wrong source\n'
            fd = m.sealed('wrong-public-bytes', raw)
            extra.append(fd)
            metadata['files'][0].update(fd=fd, bytes=len(raw))
        self.damaged_descriptor(mutate)

    def test_child_rejects_unknown_public_file_even_with_original_hash(self):
        def mutate(metadata, extra):
            metadata['files'][0]['name'] = 'private.env'
        self.damaged_descriptor(mutate)

    def test_original_main_entry_and_its_uid_gate_execute_without_ops_readability(self):
        # A complete witness request reaches the UNCHANGED UID0-only guard,
        # after the actual manifest/self hashes. No PG branch is entered.
        request = m.encoded({'mode': 'witness', 'sourceManifestSha256': m.PINS['ypal-ordinary-reader-wire-v5.manifest.json']})
        observer = r'''
import fs from 'node:fs';import net from 'node:net';import {syncBuiltinESMExports} from 'node:module';
const original=fs.readFileSync,paths=[];let connections=0;
fs.readFileSync=function(path,...args){paths.push(String(path));return original(path,...args);};
net.Socket.prototype.connect=()=>{connections++;throw Error('fixture_denies_all_connections');};
syncBuiltinESMExports();
process.on('beforeExit',()=>process.stderr.write(JSON.stringify({paths,connections,uid:process.getuid()})));
'''
        with m.public_transport() as transport:
            result = self.run_peer(transport, request.decode(), entry=LOGICAL + 'ypal-ordinary-reader-sql-v5.mjs', observer=observer)
        self.assertNotEqual(result.returncode, 0)
        refusal = json.loads(result.stdout)
        self.assertEqual(refusal['event'], 'refused')
        self.assertEqual(refusal['errorClass'], 'AssertionError')
        observation = json.loads(result.stderr)
        self.assertEqual(observation['uid'], 111)
        self.assertEqual(observation['connections'], 0)
        self.assertIn(LOGICAL + 'ypal-ordinary-reader-wire-v5.manifest.json', observation['paths'])
        self.assertIn('file://' + LOGICAL + 'ypal-ordinary-reader-sql-v5.mjs', observation['paths'])


if __name__ == '__main__':
    unittest.main()
