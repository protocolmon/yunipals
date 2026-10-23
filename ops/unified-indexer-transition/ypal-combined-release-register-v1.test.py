import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('ypal-combined-release-register-v1.py')
spec = importlib.util.spec_from_file_location('registration_owner', FILE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Owner(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.base = Path(self.directory.name) / 'operation'
        self.base_patch = patch.object(m, 'BASE', self.base); self.base_patch.start()
        self.saved = []; self.syncs = []
        def save(path, value):
            self.saved.append(path.name)
            with path.open('xb') as file: file.write(m.encoded(value))
        def document(path, pin=None):
            raw = path.read_bytes()
            if pin is not None: m.need(m.sha(raw) == pin, 'exact_receipt')
            return json.loads(raw)
        self.s = types.SimpleNamespace(save=save, document=document, sync=self.syncs.append,
                                       boot=lambda: 'boot', protected=lambda path: Path(path).read_bytes())
        self.bind = {'same': 'source'}
        self.original = {'phase': 'review', 'reviewHash': '0x' + '3' * 64, 'targetRegistered': False}
        self.snapshot = {'format': m.FORMAT, 'binding': self.bind, 'official': self.original,
                         'operatorSha256': m.sha(FILE.read_bytes()), 'activeReleaseChanged': False,
                         'consumersChanged': False, 'nativeDataWritten': False, 'providerRequests': 0}
        self.snapshot['reviewHash'] = m.sha(m.encoded(self.snapshot))
        self.h = object(); self.op = {'schema': 'unified_ypal_20261023_v1', 'buildId': '71e2a7f3b7'}; self.ack = {}

    def tearDown(self):
        self.base_patch.stop(); self.directory.cleanup()

    def phase(self, phase, expected=None):
        if phase == 'review': return copy.deepcopy(self.original)
        return {'phase': phase, 'registered': phase != 'rehearse'}

    def prepared(self):
        self.base.mkdir()
        self.s.save(self.base / 'before.json', self.snapshot)
        self.s.save(self.base / 'rehearsed.json', {'rehearsed': True, 'reviewHash': self.snapshot['reviewHash'], 'catalogUnchanged': True})

    def test_runner_exact_hash_and_seven_unchanged_official_modules(self):
        self.assertEqual(m.sha(FILE.with_suffix('.mjs').read_bytes()), m.RUNNER_SHA)
        text = FILE.with_suffix('.mjs').read_text()
        self.assertNotIn('buildSourceManifest(', text)
        self.assertIn('api.registerIndexerRelease(bounded', text)
        self.assertIn('max: 1,', text)

    def test_rehearsal_durable_parent_before_intent_and_rollback_only(self):
        with patch.object(m, 'binding', return_value=self.bind), patch.object(m, 'official', side_effect=lambda h, p, e=None: self.phase(p, e)):
            result = m.rehearse(self.s, self.h, self.op, self.ack, self.snapshot['reviewHash'])
        self.assertEqual(self.syncs, [self.base.parent])
        self.assertEqual(self.saved, ['before.json', 'rehearsal-intent.json', 'rehearsed.json'])
        self.assertFalse(result['databaseCommitted'])

    def test_stale_review_refuses_before_creating_operation(self):
        with patch.object(m, 'review', return_value=self.snapshot):
            with self.assertRaisesRegex(RuntimeError, 'fresh_registration_review_hash_required'):
                m.rehearse(self.s, self.h, self.op, self.ack, '0' * 64)
        self.assertFalse(self.base.exists())

    def test_commit_intent_precedes_driver_and_only_one_attempt(self):
        self.prepared()
        def run(h, phase, expected=None):
            if phase == 'commit': self.assertTrue((self.base / 'commit-intent.json').exists())
            return self.phase(phase, expected)
        with patch.object(m, 'binding', return_value=self.bind), patch.object(m, 'official', side_effect=run):
            value = m.commit(self.s, self.h, self.op, self.ack, self.snapshot['reviewHash'])
            with self.assertRaisesRegex(RuntimeError, 'one_registration_commit_attempt_only'):
                m.commit(self.s, self.h, self.op, self.ack, self.snapshot['reviewHash'])
        self.assertTrue(value['registered']); self.assertFalse(value['activeReleaseChanged'])

    def test_lost_ack_seals_unknown_commit_then_reconcile_is_read_only(self):
        self.prepared()
        def fail(h, phase, expected=None):
            if phase == 'commit': raise RuntimeError('ack_lost')
            return self.phase(phase, expected)
        with patch.object(m, 'binding', return_value=self.bind), patch.object(m, 'official', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'ack_lost'):
                m.commit(self.s, self.h, self.op, self.ack, self.snapshot['reviewHash'])
        failure = self.s.document(self.base / 'failed.json')
        self.assertTrue(failure['commitOutcomeMayBeUnknown']); self.assertFalse(failure['automaticRetryAllowed'])
        calls = []
        def reconcile(h, phase, expected=None):
            calls.append(phase); return self.phase(phase, expected)
        with patch.object(m, 'binding', return_value=self.bind), patch.object(m, 'official', side_effect=reconcile):
            value = m.reconcile(self.s, self.h, self.op, self.ack, m.sha((self.base / 'failed.json').read_bytes()))
        self.assertEqual(calls, ['reconcile', 'reconcile']); self.assertTrue(value['reconciledAfterUnknownAck'])

    def test_changed_source_prevents_commit_without_intent(self):
        self.prepared()
        with patch.object(m, 'binding', return_value={'changed': True}):
            with self.assertRaisesRegex(RuntimeError, 'source_changed_since_registration_review'):
                m.commit(self.s, self.h, self.op, self.ack, self.snapshot['reviewHash'])
        self.assertFalse((self.base / 'commit-intent.json').exists())

    def test_sigkill_without_failed_marker_reconciles_only_owned_durable_intent(self):
        self.prepared()
        intent = {'reviewHash': self.snapshot['reviewHash'], 'officialReviewHash': self.original['reviewHash'],
                  'bootId': 'boot', 'automaticRetryAllowed': False}
        self.s.save(self.base / 'commit-intent.json', intent)
        self.assertFalse((self.base / 'failed.json').exists())
        calls = []
        def run(h, phase, expected=None):
            calls.append(phase); return self.phase(phase, expected)
        with patch.object(m, 'binding', return_value=self.bind), patch.object(m, 'official', side_effect=run):
            value = m.reconcile(self.s, self.h, self.op, self.ack, m.sha((self.base / 'commit-intent.json').read_bytes()))
        self.assertEqual(calls, ['reconcile', 'reconcile'])
        self.assertTrue(value['registered']); self.assertTrue(value['reconciledAfterUnknownAck'])

    def test_exact_bootstrap_receipt_fixture_has_used_keys(self):
        fixture = Path(__file__).parent / 'fixtures/combined-source-start-v1.json'
        raw = fixture.read_bytes(); value = json.loads(raw)
        self.assertEqual(m.sha(raw), m.SOURCE_ACK_SHA)
        self.assertEqual(value['operatorSha256'], m.SOURCE_SHA)
        self.assertEqual(value['operationSha256'], m.SOURCE_OPERATION)
        self.assertEqual(value['native']['schemaOid'], '75963410')
        self.assertEqual(len(value['native']['tables']), 44)
        self.assertFalse(value['nativeCoverageAccepted'])


if __name__ == '__main__': unittest.main()
