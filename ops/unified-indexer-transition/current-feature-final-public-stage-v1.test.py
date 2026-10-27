"""Real-file, source-only staging/refusal controls. No host or provider access."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
spec = importlib.util.spec_from_file_location('public_stage', HERE / 'current-feature-final-public-stage-v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class PublicSourceStage(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='.current-feature-public-stage-', dir=HERE)
        self.addCleanup(self.folder.cleanup)
        self.base = Path(self.folder.name)
        self.source, self.root = self.base / 'source', self.base / 'operations'
        self.source.mkdir(); self.root.mkdir(); (self.root / m.PREFIX).mkdir()
        self.real = json.loads(m.MANIFEST.read_bytes())
        self.manifest = copy.deepcopy(self.real)
        for row in self.manifest['payload']:
            target = self.source / row['source']; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((REPO / row['source']).read_bytes())
        for name in self.manifest['historicalPublicDependencies']:
            target = self.root / name; target.parent.mkdir(parents=True, exist_ok=True)
            raw = ('synthetic immutable public fixture: ' + name).encode(); target.write_bytes(raw)
            self.manifest['historicalPublicDependencies'][name] = m.sha(raw)
        self.manifest_file = self.base / 'files.json'
        self.manifest_file.write_bytes(m.encode(self.manifest))
        self.addCleanup(patch.stopall)
        patch.object(m, 'MANIFEST', self.manifest_file).start()
        patch.object(m, 'MANIFEST_SHA', m.sha(self.manifest_file.read_bytes())).start()

    def hashes(self):
        return {str(path.relative_to(self.root)): (m.sha(path.read_bytes()), path.stat().st_ino)
                for path in self.root.rglob('*') if path.is_file()}

    def test_actual_finite_manifest_and_current_bindings_are_exact(self):
        actual = (HERE / 'current-feature-final-public-stage-v1.files.json').read_bytes()
        source = (HERE / 'current-feature-final-public-stage-v1.py').read_text()
        self.assertIn("MANIFEST_SHA = '" + m.sha(actual) + "'", source)
        self.assertEqual(len(self.real['payload']), 21)
        self.assertEqual(len(self.real['historicalPublicDependencies']), 23)
        files = {row['source']: row for row in self.real['payload']}
        for path, row in files.items():
            self.assertEqual(m.sha((REPO / path).read_bytes()), row['sha256'])
            self.assertEqual((REPO / path).stat().st_size, row['bytes'])
        self.assertEqual(files['ops/unified-indexer-transition/consumer-operational-live-booster-v1.py']['sha256'],
                         '7fc0f645067be01406c4643abf4a4473a936fdbea54bfce68943a739e3a25f1b')
        self.assertEqual(files['ops/unified-indexer-transition/booster-feature-handover-v6.py']['sha256'],
                         '114dd95754dce1280d3d93553150b02b07e8cd77f328aab355b4d39a7f60d12b')
        self.assertIn('docs/unified-indexer/final-supervisor-v3-independent-review-2026-10-23.json', files)

    def test_readonly_review_needs_no_runtime_receipt_or_new_directory(self):
        before = self.hashes(); read = m.read; observed = []
        def public_only(path):
            path = Path(path); observed.append(path)
            self.assertTrue(path == self.manifest_file or path.is_relative_to(self.root) or path.is_relative_to(self.source))
            return read(path)
        with patch.object(m, 'read', side_effect=public_only):
            checked = m.review(self.source, self.root)
        self.assertFalse(checked['staged']); self.assertEqual(checked['operationalReceiptReads'], 0)
        self.assertFalse(checked['runtimeValidationPerformed'])
        self.assertEqual(self.hashes(), before); self.assertFalse((self.root / m.EVIDENCE).exists())
        self.assertFalse(any('grants-review' in str(path) or 'switch-result' in str(path) for path in observed))

    def test_apply_creates_only_exact_new_public_files_preserving_historical_inodes(self):
        old = self.hashes(); checked = m.review(self.source, self.root)
        result = m.apply(self.source, checked['reviewHash'], self.root)
        self.assertTrue(result['staged']); self.assertFalse(result['runtimeReadinessClaimed'])
        after = self.hashes()
        for name, value in old.items(): self.assertEqual(after[name], value)
        self.assertEqual(set(after) - set(old), {row['target'] for row in self.manifest['payload']})
        for row in self.manifest['payload']:
            self.assertEqual(m.sha((self.root / row['target']).read_bytes()), row['sha256'])
        self.assertEqual(result['serviceActions'], 0); self.assertEqual(result['databaseWrites'], 0)

    def test_identical_existing_sources_are_not_rewritten(self):
        m.apply(self.source, m.review(self.source, self.root)['reviewHash'], self.root)
        before = self.hashes(); checked = m.review(self.source, self.root)
        self.assertTrue(all(row['alreadyPresent'] for row in checked['files']))
        m.apply(self.source, checked['reviewHash'], self.root)
        self.assertEqual(self.hashes(), before)

    def test_changed_dependency_source_manifest_or_apply_hash_refuses_before_writes(self):
        baseline = self.hashes(); checked = m.review(self.source, self.root)
        with self.assertRaisesRegex(RuntimeError, 'fresh_exact_public_source_review'):
            m.apply(self.source, '0' * 64, self.root)
        self.assertEqual(self.hashes(), baseline)
        dependency = self.root / next(iter(self.manifest['historicalPublicDependencies']))
        original = dependency.read_bytes(); dependency.write_bytes(b'changed historical helper')
        with self.assertRaisesRegex(RuntimeError, 'historical_public_dependency'):
            m.apply(self.source, checked['reviewHash'], self.root)
        dependency.write_bytes(original)
        payload = self.source / self.manifest['payload'][0]['source']
        original = payload.read_bytes(); payload.write_bytes(original + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'exact_new_public_source'):
            m.review(self.source, self.root)
        payload.write_bytes(original); self.manifest_file.write_bytes(self.manifest_file.read_bytes() + b' ')
        with self.assertRaisesRegex(RuntimeError, 'reviewed_public_file_manifest'):
            m.review(self.source, self.root)
        self.assertEqual(self.hashes(), baseline)

    def test_foreign_existing_target_symlink_or_hardlink_is_never_overwritten(self):
        row = self.manifest['payload'][0]; target = self.root / row['target']
        target.write_bytes(b'foreign'); original = target.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'must_not_be_overwritten'): m.review(self.source, self.root)
        self.assertEqual(target.read_bytes(), original); target.unlink()
        other = self.base / 'foreign'; other.write_bytes(b'outside')
        target.symlink_to(other)
        with self.assertRaisesRegex(RuntimeError, 'bounded_protected_public_file'): m.review(self.source, self.root)
        target.unlink(); os.link(self.source / row['source'], target)
        with self.assertRaisesRegex(RuntimeError, 'bounded_protected_public_file'): m.review(self.source, self.root)

    def test_unsafe_manifest_paths_and_dependency_overlap_refuse(self):
        for kind in ('traversal', 'absolute', 'target', 'old'):
            value = copy.deepcopy(self.manifest)
            if kind == 'traversal': value['payload'][0]['source'] = '../private.env'
            elif kind == 'absolute': value['payload'][0]['source'] = '/etc/private.env'
            elif kind == 'target': value['payload'][0]['target'] = 'free-replay-20261020/not-the-file.py'
            else:
                value['historicalPublicDependencies'].pop(next(iter(value['historicalPublicDependencies'])))
                value['historicalPublicDependencies'][value['payload'][0]['target']] = 'a' * 64
            raw = m.encode(value); self.manifest_file.write_bytes(raw)
            with patch.object(m, 'MANIFEST_SHA', m.sha(raw)), self.assertRaises(RuntimeError): m.inputs()

    def test_partial_source_write_requires_fresh_review_and_keeps_exact_created_inodes(self):
        original = m.exclusive; count = 0
        def interrupted(path, raw):
            nonlocal count
            if count == 2: raise OSError('synthetic interrupted public staging')
            count += 1; return original(path, raw)
        checked = m.review(self.source, self.root)
        with patch.object(m, 'exclusive', side_effect=interrupted), self.assertRaises(OSError):
            m.apply(self.source, checked['reviewHash'], self.root)
        partial = self.hashes()
        with self.assertRaisesRegex(RuntimeError, 'fresh_exact_public_source_review'):
            m.apply(self.source, checked['reviewHash'], self.root)
        result = m.apply(self.source, m.review(self.source, self.root)['reviewHash'], self.root)
        self.assertTrue(result['staged'])
        for name, value in partial.items(): self.assertEqual(self.hashes()[name], value)

    def test_file_appearing_at_exclusive_boundary_is_preserved_without_overwrite(self):
        link = os.link
        def race(source, target, **kwargs):
            Path(target).write_bytes(b'foreign concurrent public file')
            return link(source, target, **kwargs)
        with patch.object(m.os, 'link', side_effect=race), self.assertRaisesRegex(RuntimeError, 'destination_appeared'):
            m.apply(self.source, m.review(self.source, self.root)['reviewHash'], self.root)
        path = self.root / self.manifest['payload'][0]['target']
        self.assertEqual(path.read_bytes(), b'foreign concurrent public file')
        self.assertFalse(list(path.parent.glob('.current-feature-public-*')))

    def test_no_operational_receipt_is_interpreted_as_staging_authority(self):
        (self.root / m.PREFIX / 'grants-result.json').write_bytes(b'not an operational receipt')
        checked = m.review(self.source, self.root)
        self.assertTrue(m.apply(self.source, checked['reviewHash'], self.root)['staged'])
        self.assertEqual((self.root / m.PREFIX / 'grants-result.json').read_bytes(), b'not an operational receipt')

    def test_nonroot_and_writable_ancestry_are_refused(self):
        with patch.object(m.os, 'geteuid', return_value=1), patch.object(m, 'read') as read:
            with self.assertRaisesRegex(RuntimeError, 'root_public_source_stager'): m.review(self.source, self.root)
            read.assert_not_called()
        self.source.chmod(0o777)
        with self.assertRaisesRegex(RuntimeError, 'protected_public_stage_ancestry'): m.review(self.source, self.root)


if __name__ == '__main__': unittest.main()
