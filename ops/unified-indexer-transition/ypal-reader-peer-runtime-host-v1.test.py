#!/usr/bin/env python3
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
spec = importlib.util.spec_from_file_location('peer_host', HERE / 'ypal-reader-peer-runtime-host-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='yunipals-peer-host-')
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.incoming = root / 'input'; self.incoming.mkdir(mode=0o700)
        self.ops = root / 'ops'; self.ops.mkdir(mode=0o700)
        self.base = root / 'audit'
        for name in m.PAYLOAD:
            path = self.incoming / name
            shutil.copyfile(HERE / name, path); path.chmod(0o600)
        review = HERE / 'ypal-reader-peer-runtime-host-v1.transport-review.json'
        shutil.copyfile(review, self.incoming / 'independent-review.json')
        (self.incoming / 'independent-review.json').chmod(0o600)
        self.dep = {'fixture': True, 'authority': 'source-stage-only'}
        self.mapping = {'postgres': {'uid': 111, 'gid': 113}, 'yunipals_unified_api': {'uid': 967, 'gid': 961}}
        for key, value in [('OPS', self.ops), ('INPUT', self.incoming), ('BASE', self.base),
                           ('production', lambda: (self.dep, {})), ('peers', lambda: self.mapping)]:
            mocked = patch.object(m, key, value); mocked.start(); self.addCleanup(mocked.stop)

    def staged(self):
        result = m.stage(m.review()['reviewHash'])
        return result['stageResultSha256']

    def test_default_stage_review_is_readonly_and_does_not_create_audit(self):
        value = m.review()
        self.assertEqual(len(value['files']), 13)
        self.assertFalse(any(row['present'] for row in value['files']))
        self.assertFalse(self.base.exists())
        self.assertEqual(list(self.ops.iterdir()), [])
        self.assertEqual(stat.S_IMODE(self.ops.stat().st_mode), 0o700)

    def test_stage_exact_public_files_root600_and_preserves_existing_public644_inode(self):
        name = 'ownership-parity-peer-v2.mjs'
        existing = self.ops / name
        shutil.copyfile(self.incoming / name, existing); existing.chmod(0o644)
        original = m.identity(existing)
        receipt = m.stage(m.review()['reviewHash'])
        self.assertEqual(receipt['newPublicFiles'], 12)
        self.assertEqual(m.identity(existing), original)
        self.assertEqual(stat.S_IMODE(self.ops.stat().st_mode), 0o700)
        for name, pin in m.PAYLOAD.items():
            self.assertEqual(m.sha((self.ops / name).read_bytes()), pin)
            if self.ops / name != existing:
                self.assertEqual(stat.S_IMODE((self.ops / name).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.base.stat().st_mode), 0o700)
        self.assertFalse((self.ops / 'ypal-native-cutover-v1.py').exists())

    def test_changed_payload_and_foreign_existing_file_refuse_without_audit(self):
        name = next(iter(m.PAYLOAD))
        (self.ops / name).write_bytes(b'foreign'); (self.ops / name).chmod(0o600)
        with self.assertRaises(RuntimeError): m.review()
        self.assertEqual((self.ops / name).read_bytes(), b'foreign')
        self.assertFalse(self.base.exists())
        (self.ops / name).unlink()
        (self.incoming / name).write_bytes(b'changed')
        with self.assertRaises(RuntimeError): m.review()

    def test_actual_UID_mapping_drift_invalidates_approved_review(self):
        review = m.review()['reviewHash']
        self.mapping['yunipals_unified_api']['uid'] = 968
        with self.assertRaisesRegex(RuntimeError, 'fresh_exact_source_stage_review'):
            m.stage(review)
        self.assertFalse(self.base.exists())

    def test_same_bytes_foreign_inode_after_review_is_not_overwritten(self):
        approved = m.review()['reviewHash']
        real = m.exclusive
        victim = self.ops / next(iter(m.PAYLOAD))
        def race(path, raw):
            if path == victim:
                path.write_bytes(raw); path.chmod(0o600)
            return real(path, raw)
        with patch.object(m, 'exclusive', race):
            with self.assertRaises(FileExistsError): m.stage(approved)
        self.assertTrue((self.base / 'stage-intent.json').exists())
        self.assertFalse((self.base / 'stage-result.json').exists())
        self.assertEqual(m.sha(victim.read_bytes()), m.PAYLOAD[victim.name])

    def test_owned_stage_drift_refuses_before_any_qualification_process(self):
        pin = self.staged()
        name = next(iter(m.PAYLOAD))
        (self.ops / name).write_bytes(b'changed')
        with patch.object(m.subprocess, 'run', side_effect=AssertionError('must not spawn')):
            with self.assertRaises(RuntimeError): m.qualify(pin)
        self.assertFalse((self.base / 'qualification-intent.json').exists())

    def test_failed_actual_qualification_keeps_private_logs_and_never_repeats(self):
        pin = self.staged()
        failed = subprocess.CompletedProcess([], 1, b'', b'synthetic private diagnostic')
        with patch.object(m, 'preauthorize_dependencies', return_value={'fixture': True}), \
             patch.object(m.subprocess, 'run', return_value=failed) as child:
            with self.assertRaisesRegex(RuntimeError, 'actual_restricted_peer_qualification_refused'):
                m.qualify(pin)
            self.assertEqual(child.call_count, 1)
            with self.assertRaisesRegex(RuntimeError, 'qualification_already_attempted'):
                m.qualify(pin)
            self.assertEqual(child.call_count, 1)
        self.assertEqual((self.base / 'postgres.stderr').read_bytes(), failed.stderr)
        self.assertEqual(stat.S_IMODE((self.base / 'postgres.stderr').stat().st_mode), 0o600)
        self.assertFalse((self.base / 'qualification-result.json').exists())

    def test_pg_transitive_file_must_match_acknowledged_inventory(self):
        self.staged()
        path = self.incoming / next(iter(m.PAYLOAD))
        row = {'path': str(path), 'bytes': path.stat().st_size, 'sha256': m.sha(path.read_bytes())}
        raw = m.encoded({'uid': 111, 'gid': 113, 'attempts': 0, 'files': [row]})
        expected = {str(path.relative_to(self.incoming)): {'type': 'file', 'bytes': row['bytes'], 'sha256': '0' * 64}}
        with patch.object(m, 'ROOT', self.incoming), patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, raw, b'')):
            with self.assertRaisesRegex(RuntimeError, 'all_loaded_pg_dependency_bytes'):
                m.pg_closure(expected)

    def dependency_fixture(self):
        root = self.incoming / 'dependency-runtime'; root.mkdir(mode=0o755)
        tree = root / 'node_modules'; tree.mkdir(mode=0o755)
        package = tree / 'pg'; package.mkdir(mode=0o755)
        (package / 'index.js').write_text("require('./client.js');module.exports={};\n")
        (package / 'client.js').write_text('module.exports={};\n' + ' ' * 256)
        (tree / 'alias').symlink_to('pg')
        entries = {}
        for path in [tree, package, package / 'index.js', package / 'client.js', tree / 'alias']:
            relative = str(path.relative_to(root)); info = path.lstat()
            row = {'path': relative, 'mode': stat.S_IMODE(info.st_mode)}
            if path.is_symlink(): row.update(type='symlink', target=os.readlink(path))
            elif path.is_dir(): row.update(type='directory')
            else:
                path.chmod(0o644); row.update(type='file', mode=0o644, bytes=info.st_size, sha256=m.sha(path.read_bytes()))
            entries[relative] = row
        return root, entries

    def test_all_dependency_file_and_link_metadata_authenticated_without_module_evaluation(self):
        root, entries = self.dependency_fixture()
        with patch.object(m, 'ROOT', root), patch.object(m.subprocess, 'run', side_effect=AssertionError('no evaluation allowed')):
            proof = m.preauthorize_dependencies(entries)
        self.assertEqual(proof['dependencyNodes'], 5)
        self.assertEqual(proof['dependencyFiles'], 2)
        self.assertEqual(proof['dependencyLinks'], 1)
        self.assertFalse(proof['moduleEvaluationPerformed'])

    def test_changed_transitive_refuses_before_any_qualification_subprocess(self):
        pin = self.staged()
        root, entries = self.dependency_fixture()
        marker = root / 'MUST-NOT-EXIST'
        client = root / 'node_modules/pg/client.js'
        malicious = ("require('node:fs').writeFileSync(" + repr(str(marker)) + ",'executed');\n").encode()
        client.write_bytes(malicious.ljust(client.stat().st_size, b' '))
        self.assertEqual(client.stat().st_size, entries['node_modules/pg/client.js']['bytes'])
        with patch.object(m, 'ROOT', root), patch.object(m, 'production', return_value=(self.dep, entries)), \
             patch.object(m.subprocess, 'run', side_effect=AssertionError('no module can execute')) as child:
            with self.assertRaisesRegex(RuntimeError, 'dependency_file_required_before_evaluation|dependency_bytes_required_before_evaluation'):
                m.qualify(pin)
            self.assertEqual(child.call_count, 0)
        self.assertFalse(marker.exists())
        self.assertTrue((self.base / 'qualification-intent.json').exists())
        self.assertFalse((self.base / 'postgres.stdout').exists())

    def test_unlisted_dependency_file_refuses_before_evaluation(self):
        root, entries = self.dependency_fixture()
        (root / 'node_modules/pg/unknown.js').write_text('module.exports={};\n')
        with patch.object(m, 'ROOT', root):
            with self.assertRaisesRegex(RuntimeError, 'unlisted_or_duplicate_dependency_node'):
                m.preauthorize_dependencies(entries)


if __name__ == '__main__': unittest.main()
