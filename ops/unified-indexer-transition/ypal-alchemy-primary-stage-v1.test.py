#!/usr/bin/env python3
"""Real exclusive FS plus actual Node CJS/ESM pre-evaluation denial controls."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('alchemy_stage', HERE / 'ypal-alchemy-primary-stage-v1.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
SOURCE = HERE / 'ypal-alchemy-primary-queue-v1'
NODE = Path('/root/.nvm/versions/node/v24.18.1/bin/node')


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='.alchemy-stage-test-', dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ops = self.root / 'ops'; self.ops.mkdir()
        self.input = self.root / 'input'; self.input.mkdir()
        self.context = self.root / 'context'; self.context.mkdir()
        self.old = self.root / 'original.mjs'
        self.old.write_bytes((HERE / 'ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs').read_bytes())
        for name in m.PAYLOAD:
            shutil.copyfile(SOURCE / name, self.input / name)
        self.actor = {'source': {'pid': 100, 'startTicks': 200}}
        self.retained = {'fixedFixtureDependencyIdentity': 'same'}
        for key, value in dict(OPS=self.ops, TARGET=self.ops / 'candidate', INPUT=self.input,
                BASE=self.root / 'audit', CONTEXT=self.context, OLD=self.old).items():
            p = patch.object(m, key, value); p.start(); self.addCleanup(p.stop)
        for key, value in dict(retained=lambda: (copy.deepcopy(self.retained), {}),
                actors=lambda: copy.deepcopy(self.actor), peer=lambda: {'name': 'fixture', 'uid': 111, 'gid': 113}).items():
            p = patch.object(m, key, value); p.start(); self.addCleanup(p.stop)

    def test_actual_five_public_bytes_stage_exclusively_preserving_preimage(self):
        old = m.identity(self.old)
        review = m.review()
        result = m.stage(review['reviewHash'])
        self.assertTrue(result['staged'])
        self.assertEqual(m.identity(self.old), old)
        self.assertEqual(os.readlink(m.TARGET / 'node_modules'), str(self.context))
        self.assertEqual(m.TARGET.stat().st_mode & 0o777, 0o755)
        for name, (digest, size) in m.PAYLOAD.items():
            self.assertEqual(m.sha((m.TARGET / name).read_bytes()), digest)
            self.assertEqual((m.TARGET / name).stat().st_size, size)
            self.assertEqual((m.TARGET / name).stat().st_mode & 0o777, 0o644)
        self.assertEqual(m.qualified_stage(result['stageResultSha256'])[0]['reviewHash'], review['reviewHash'])
        with self.assertRaisesRegex(RuntimeError, 'must_be_absent'):
            m.stage(review['reviewHash'])

    def test_no_overwrite_or_unknown_incoming_file(self):
        (self.input / 'unreviewed.mjs').write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'exact_five'):
            m.review()
        self.assertFalse(m.TARGET.exists())

    def test_changed_public_candidate_and_foreign_same_path_refuse(self):
        (self.input / 'rpc-budget-proxy.mjs').write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'accepted_input'):
            m.review()
        self.assertFalse(m.BASE.exists())

    def test_stale_review_refuses_before_any_journal(self):
        review = m.review()
        self.actor['source']['startTicks'] += 1
        with self.assertRaisesRegex(RuntimeError, 'exact_fresh'):
            m.stage(review['reviewHash'])
        self.assertFalse(m.BASE.exists())

    def test_default_review_cli_exports_only_aggregate_frame_hashes(self):
        with patch.object(sys, 'argv', ['stage.py']), patch.object(m.socket, 'gethostname', return_value='yunipals-main'):
            result = m.main()
        self.assertIn('actorFrameSha256', result)
        self.assertNotIn('actors', result)
        self.assertNotIn('peer', result)
        self.assertNotIn('retained', result)
        self.assertFalse(m.BASE.exists())

    def test_lost_stage_ack_retains_partial_and_never_retries(self):
        review = m.review()
        original = m.write_new
        def fail_after_intent(path, raw, mode=0o600):
            if Path(path).name == 'directory-created.json':
                raise RuntimeError('injected_lost_write_ack')
            return original(path, raw, mode)
        with patch.object(m, 'write_new', side_effect=fail_after_intent):
            with self.assertRaisesRegex(RuntimeError, 'injected'):
                m.stage(review['reviewHash'])
        self.assertTrue((m.BASE / 'stage-intent.json').exists())
        self.assertTrue(m.TARGET.exists())
        with self.assertRaisesRegex(RuntimeError, 'must_be_absent'):
            m.stage(review['reviewHash'])

    def test_same_byte_foreign_staged_inode_refuses(self):
        review = m.review(); result = m.stage(review['reviewHash'])
        target = m.TARGET / 'rpc-budget-proxy.mjs'
        raw = target.read_bytes(); target.unlink(); target.write_bytes(raw); target.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'same_owned_'):
            m.qualified_stage(result['stageResultSha256'])

    def test_protected_reader_refuses_symlink_and_hardlink(self):
        target = self.root / 'input-file'; target.write_bytes(b'public')
        link = self.root / 'link'; link.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, 'regular_input'):
            m.read(link)
        link.unlink(); os.link(target, link)
        with self.assertRaisesRegex(RuntimeError, 'regular_input'):
            m.read(target)


class NodeGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='alchemy-import-guard-')
        cls.root = Path(cls.tmp.name); cls.root.chmod(0o755)
        cls.node = cls.root / 'node'; shutil.copyfile(NODE, cls.node); cls.node.chmod(0o755)
        assert m.sha(cls.node.read_bytes()) == m.NODE_SHA

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def fixture(self):
        root = Path(tempfile.mkdtemp(prefix='fixture-', dir=self.root)); root.chmod(0o755)
        release = root / 'release'; release.mkdir(mode=0o755)
        context = release / 'app/node_modules'; context.mkdir(mode=0o755, parents=True)
        context.parent.chmod(0o755)
        pkg = context / 'pg'; pkg.mkdir(mode=0o755)
        (pkg / 'package.json').write_text('{"name":"pg","main":"index.js"}')
        (pkg / 'index.js').write_text("const C=require('./client.js');module.exports={Client:C,Pool:class{},Connection:class{}};")
        client = pkg / 'client.js'; client.write_text('module.exports=class Client{connect(){}query(){}};'.ljust(512))
        candidate = root / 'candidate.mjs'
        candidate.write_text("export function createRpcBudgetProxy(){};export function isFreeRpcCall(){};export function isRpcBudgetProxyMain(){return false};export function readRpcBudgetProxyEnvironment(){};export function rpcPrimaryPoolSha256(){};")
        for path in [*pkg.iterdir(), candidate]: path.chmod(0o644)
        entries = {str(p.relative_to(release)): {'type': 'file', 'bytes': p.stat().st_size,
                    'sha256': m.sha(p.read_bytes())} for p in pkg.iterdir()}
        return root, client, candidate, {'candidate': str(candidate), 'candidateSha': m.sha(candidate.read_bytes()),
            'release': str(release), 'context': str(context), 'entries': entries, 'peer': {'uid': 111, 'gid': 113}}

    def execute(self, root, cfg):
        args = ['/usr/bin/setpriv', '--reuid=111', '--regid=113', '--clear-groups', '--inh-caps=-all',
                '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '/usr/bin/env', '-i',
                str(self.node), '--max-old-space-size=256', '--input-type=module', '-e', m.IMPORT]
        out, err = root / 'out', root / 'err'
        with out.open('wb') as stdout, err.open('wb') as stderr:
            value = subprocess.run(args, input=m.encoded(cfg), stdout=stdout, stderr=stderr,
                                   cwd='/', env={}, timeout=20)
        return value.returncode, out.read_bytes(), err.read_bytes()

    def test_actual_cap0_cross_uid_import_and_zero_effect_counters(self):
        root, _, _, cfg = self.fixture()
        code, out, err = self.execute(root, cfg)
        self.assertEqual(code, 0, err.decode())
        self.assertEqual(err, b'')
        proof = json.loads(out)
        self.assertEqual(proof['uid'], 111); self.assertEqual(proof['gid'], 113)
        self.assertEqual(proof['counts'], {'network': 0, 'listen': 0, 'database': 0, 'pool': 0, 'spawn': 0})
        self.assertFalse(proof['applicationConstructed'])
        self.assertEqual(len(proof['loadedDependencies']), proof['loadedDependencyFiles'])
        self.assertEqual(m.sha(json.dumps(proof['loadedDependencies'], separators=(',', ':')).encode()),
                         proof['loadedDependencySha256'])
        self.assertTrue(any(row[0].endswith('client.js') for row in proof['loadedDependencies']))

    def test_changed_transitive_cjs_refuses_before_marker_evaluation(self):
        root, client, _, cfg = self.fixture()
        marker = root / 'scratch'; marker.mkdir(mode=0o777); marker.chmod(0o777)
        path = marker / 'sentinel'
        client.write_text(("require('fs').writeFileSync(" + json.dumps(str(path)) + ",'EXECUTED');module.exports=class{};").ljust(512))
        code, _, err = self.execute(root, cfg)
        self.assertNotEqual(code, 0)
        self.assertIn(b'changed_dependency_before_evaluation', err)
        self.assertFalse(path.exists())

    def test_unknown_transitive_module_refuses_before_evaluation(self):
        root, client, _, cfg = self.fixture()
        del cfg['entries'][next(key for key in cfg['entries'] if key.endswith('client.js'))]
        code, _, err = self.execute(root, cfg)
        self.assertNotEqual(code, 0)
        self.assertIn(b'unknown_dependency_before_evaluation', err)

    def test_guarded_candidate_may_not_construct_pool_or_open_socket(self):
        for body, message in [("import pg from 'pg';new pg.Pool();", b'pg_construction_refused'),
                              ("import net from 'node:net';net.createServer().listen(0);", b'import_side_effect_refused_listen')]:
            with self.subTest(body=message):
                root, _, candidate, cfg = self.fixture()
                # Candidate lives beside the same exact retained dependency link.
                (root / 'node_modules').symlink_to(cfg['context'])
                candidate.write_text(body)
                cfg['candidateSha'] = m.sha(candidate.read_bytes())
                code, _, err = self.execute(root, cfg)
                self.assertNotEqual(code, 0)
                self.assertIn(message, err)


if __name__ == '__main__':
    unittest.main()
