#!/usr/bin/env python3
"""Two public files only; real exclusive publication and refusal controls."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
ROOT = HERE.parent.parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


m = load('consumer-current-main-observation-stage-v1')
p = load('current-feature-final-public-stage-v2')
real_helper = load('consumer-current-main-observation-v1')


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.source = self.root / 'input'; self.ops = self.root / 'operations'
        self.source.mkdir(); self.ops.mkdir()
        for name in m.PAYLOAD: (self.source / name).write_bytes((HERE / name).read_bytes())
        deps = {}
        for name in real_helper.DEPS:
            if name == m.OBSERVER: deps[name] = m.PAYLOAD[name]; continue
            raw = ('public fixture:' + name).encode(); (self.ops / name).write_bytes(raw); deps[name] = m.sha(raw)
        old = b'original protected selectors'; accepted = b'accepted protected runtime baseline'
        (self.ops / real_helper.SELECTORS).write_bytes(old); (self.ops / real_helper.ACCEPTED).write_bytes(accepted)
        evidence = json.loads((ROOT / 'docs/unified-indexer/current-main-reader-observation-source-qualification-2026-10-23.json').read_bytes())
        self.observation = evidence['actualSourceQualification']['result']
        self.fake = types.SimpleNamespace(DEPS=deps, SELECTORS=real_helper.SELECTORS, SELECTORS_SHA=m.sha(old),
            ACCEPTED=real_helper.ACCEPTED, ACCEPTED_SHA=m.sha(accepted), load=lambda name: None,
            review=lambda: copy.deepcopy(self.observation))
        self.identities = {'threeFixedActors': 'unchanged'}
        self.addCleanup(patch.stopall)
        patch.object(m, 'OPS', self.ops).start(); patch.object(m, 'primitives', return_value=p).start()
        patch.object(m, 'module', side_effect=lambda raw, path: self.fake if Path(path).name == m.HELPER else object()).start()
        patch.object(m, 'identities', side_effect=lambda primitive: copy.deepcopy(self.identities)).start()
        patch.object(m, 'installed_default', side_effect=lambda: m.summary(self.observation)).start()

    def test_exact_current_sources_and_dependency_contract(self):
        self.assertEqual(len(m.PAYLOAD), 2)
        for name, pin in m.PAYLOAD.items(): self.assertEqual(m.sha((HERE / name).read_bytes()), pin)
        self.assertEqual(len(real_helper.DEPS), 5)
        self.assertEqual(real_helper.DEPS[m.OBSERVER], m.PAYLOAD[m.OBSERVER])

    def test_default_review_has_no_publication(self):
        checked = m.review(self.source)
        self.assertFalse(checked['staged'])
        self.assertEqual(len(checked['binding']['existingDependenciesAndBaselines']), 6)
        self.assertTrue(all(not row['alreadyPresent'] for row in checked['binding']['files']))
        self.assertFalse(any((self.ops / name).exists() for name in m.PAYLOAD))

    def test_apply_only_two_root0644_files_then_default_observation(self):
        before = set(self.ops.iterdir()); checked = m.review(self.source)
        result = m.apply(self.source, checked['reviewHash'])
        self.assertTrue(result['installedDefaultQualified'])
        self.assertEqual(set(self.ops.iterdir()) - before, {self.ops / name for name in m.PAYLOAD})
        for name, pin in m.PAYLOAD.items():
            path = self.ops / name; self.assertEqual(m.sha(path.read_bytes()), pin)
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
        self.assertEqual(result['privateAcknowledgementWrites'], 0)

    def test_identical_existing_files_keep_inodes(self):
        checked = m.review(self.source); m.apply(self.source, checked['reviewHash'])
        before = {name: (self.ops / name).stat().st_ino for name in m.PAYLOAD}
        checked = m.review(self.source); m.apply(self.source, checked['reviewHash'])
        self.assertEqual(before, {name: (self.ops / name).stat().st_ino for name in m.PAYLOAD})

    def test_foreign_existing_bytes_symlink_and_mode_refuse(self):
        for mode in ('bytes', 'symlink', 'mode'):
            target = self.ops / m.HELPER
            if mode == 'bytes': target.write_text('foreign bytes')
            elif mode == 'symlink': target.symlink_to(self.source / m.HELPER)
            else: target.write_bytes((self.source / m.HELPER).read_bytes()); target.chmod(0o600)
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.review(self.source)
            target.unlink()

    def test_changed_dependency_baseline_or_source_refuses(self):
        targets = [self.ops / next(name for name in self.fake.DEPS if name != m.OBSERVER),
            self.ops / self.fake.SELECTORS, self.ops / self.fake.ACCEPTED, self.source / m.HELPER]
        for target in targets:
            old = target.read_bytes(); target.write_bytes(old + b'changed')
            with self.assertRaises(RuntimeError): m.review(self.source)
            target.write_bytes(old)

    def test_stale_review_or_identity_change_writes_nothing(self):
        checked = m.review(self.source)
        with self.assertRaises(RuntimeError): m.apply(self.source, '0' * 64)
        self.identities['threeFixedActors'] = 'different'
        with self.assertRaises(RuntimeError): m.apply(self.source, checked['reviewHash'])
        self.assertFalse(any((self.ops / name).exists() for name in m.PAYLOAD))

    def test_identity_change_immediately_before_link_refuses(self):
        checked = m.review(self.source)
        values = [copy.deepcopy(self.identities)] * 2 + [{'threeFixedActors': 'changed'}]
        with patch.object(m, 'identities', side_effect=values):
            with self.assertRaises(RuntimeError): m.apply(self.source, checked['reviewHash'])
        self.assertFalse(any((self.ops / name).exists() for name in m.PAYLOAD))

    def test_foreign_race_and_partial_publication_need_new_review(self):
        checked = m.review(self.source); original = p.exclusive; calls = 0
        def publish(path, raw):
            nonlocal calls
            calls += 1
            if calls == 2: path.write_text('foreign arrival')
            return original(path, raw)
        with patch.object(p, 'exclusive', side_effect=publish), self.assertRaises(RuntimeError):
            m.apply(self.source, checked['reviewHash'])
        self.assertEqual((self.ops / m.OBSERVER).read_text(), 'foreign arrival')
        with self.assertRaises(RuntimeError): m.review(self.source)
        (self.ops / m.OBSERVER).unlink()
        with self.assertRaises(RuntimeError): m.apply(self.source, checked['reviewHash'])
        fresh = m.review(self.source); m.apply(self.source, fresh['reviewHash'])

    def test_default_output_change_never_backs_out_or_overwrites_public_sources(self):
        checked = m.review(self.source)
        with patch.object(m, 'installed_default', return_value={'unexpected': True}), self.assertRaises(RuntimeError):
            m.apply(self.source, checked['reviewHash'])
        for name, pin in m.PAYLOAD.items(): self.assertEqual(m.sha((self.ops / name).read_bytes()), pin)

    def test_installed_command_has_no_acknowledgement_or_run_id(self):
        # Exercise the actual function, not setUp's host-fixture replacement.
        actual = load('consumer-current-main-observation-stage-v1')
        with patch.object(actual, 'run', return_value=json.dumps(self.observation).encode()) as command:
            result = actual.installed_default()
            command.assert_called_once_with(['/usr/bin/python3', '-I', '-B', str(actual.OPS / actual.HELPER)], timeout=45)
            self.assertFalse(result['acknowledged'])
        self.assertNotIn('private-never-export', json.dumps(result))


if __name__ == '__main__': unittest.main()
