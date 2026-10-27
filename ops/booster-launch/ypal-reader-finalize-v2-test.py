#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('ypal-reader-finalize-v2.py')
spec = importlib.util.spec_from_file_location('finalizer', FILE); f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
reader = FILE.with_name('ypal-reader-cutover-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.finalize-test-', dir=FILE.parent); self.root = Path(self.temp.name)
        self.loader = patch.object(f, 'CORE_FILE', reader.absolute()); self.loader.start(); self.m = f.core(); m = self.m
        m.BASE = self.root / 'base'; m.BASE.mkdir(); m.PUBLIC_ENV = self.root / 'public.env'; m.DROPS = {m.API: self.root / 'api.d/95-ypal.conf', m.QUEUE: self.root / 'queue.d/95-ypal.conf'}
        m.UNIT_PINS = {u: m.sha(u.encode()) for u in (m.API, m.QUEUE, m.TIMER)}
        original_read = m.protected
        m.protected = lambda path, *args: str(path).split('/')[-1].encode() if str(path).startswith('/etc/systemd/system/') else original_read(path, *args)
        for n, phase in enumerate(f.PHASES): m.save(m.BASE / (phase + '-intent.json'), {'bootId': m.boot(), 'automaticRetryAllowed': False, 'monotonicUs': (n + 1) * 100}); m.save(m.BASE / (phase + '-result.json'), {'completed': True})
        self.published = [m.create_overlay(path, b'public=value\n') for path in (m.PUBLIC_ENV, *m.DROPS.values())]
        self.graph = {'exact': True}; m.save(m.BASE / 'admission.json', {'after': self.graph})
        self.binding = {'operatorSha256': f.CORE_SHA, 'sourceReceiptSha256': f.SOURCE_SHA, 'admissionSha256': m.sha(m.protected(m.BASE / 'admission.json')), 'bootId': m.boot(), 'inputs': {'values': {'public': 'value'}, 'deployment': {'fresh': True}}, 'definitions': {'exact': True}, 'independent': {'unchanged': True}}
        m.save(m.BASE / 'switch-review.json', self.binding)
        self.pins = [patch.object(f, 'ADMISSION_SHA', self.binding['admissionSha256']), patch.object(f, 'SWITCH_SHA', m.sha(m.protected(m.BASE / 'switch-review.json')))]
        for p in self.pins: p.start()
        parity = FILE.parents[1] / 'unified-indexer-transition/booster-feature-handover-v7.py'
        sp = importlib.util.spec_from_file_location('frozen_queue', parity); self.q = importlib.util.module_from_spec(sp); sp.loader.exec_module(self.q)
        outer = self
        class H:
            busy = 0
            def source(self): return {'receiptSha256': f.SOURCE_SHA, 'native': {'ready': True}}
            def inputs(self): return outer.binding['inputs'], b'public', b'drop'
            def catalog(self): return outer.graph
            def independent(self): return {'unchanged': True}
            def definitions(self, overlay):
                assert overlay
                if self.busy: self.busy -= 1; raise RuntimeError('same_reader_base_definitions_required')
                return outer.binding['definitions']
            def state(self, u): return {'FragmentPath': '/etc/systemd/system/' + u, 'DropInPaths': str(m.DROPS[u]) if u in m.DROPS else '', 'Job': '', 'ActiveState': 'active', 'UnitFileState': 'enabled'}
            def actor(self, u, values): return {**f.API_IDENTITY, 'Id': m.API, 'ExecMainStartTimestampMonotonic': '350', 'startTicks': 35}
            def availability(self, deployment): return {'localAndPublicReady': True}
            def ready(self): return {'completeBlock': f.BOUNDARY + 100, 'buildId': m.BUILD}
            def manager(self, *args): raise AssertionError('No service actions permitted')
            def sql(self, *args): raise AssertionError('No SQL mutations permitted')
        self.h = H(); self.h.core_module = self.q
        event = {'_SYSTEMD_UNIT': m.QUEUE, '_UID': '967', '_GID': '961', '_EXE': '/opt/node-v24.18.1/bin/node', '_SYSTEMD_INVOCATION_ID': 'b' * 32, '__MONOTONIC_TIMESTAMP': '450', 'MESSAGE': json.dumps({'event': 'booster_artwork_queue_sync', 'skipped': False, 'queued': 0, 'indexedBlock': str(f.BOUNDARY + 5)})}
        self.events = [event]
        def journal(args, timeout): assert args[0] == '/usr/bin/journalctl'; return '\n'.join(json.dumps(v) for v in self.events)
        self.h.core = types.SimpleNamespace(run=journal)

    def tearDown(self):
        for p in reversed(self.pins): p.stop()
        self.loader.stop(); self.temp.cleanup()

    def test_exact_frozen_original_loader(self): self.assertEqual(self.m.sha(self.m.protected(reader.absolute())), f.CORE_SHA)

    def test_review_and_apply_acknowledge_only_preserving_missing_original_result(self):
        reviewed = f.review(self.m, self.h); result = f.apply(self.m, self.h, reviewed['reviewHash'])
        self.assertTrue(result['completed']); self.assertTrue(result['reconciledAcknowledgementOnly']); self.assertEqual(result['serviceActions'], 0)
        self.assertFalse((self.m.BASE / 'result.json').exists()); self.assertTrue((self.m.BASE / 'finalization-v2-result.json').exists())
        self.assertRaises(RuntimeError, f.apply, self.m, self.h, reviewed['reviewHash'])

    def test_missing_phase_ack_never_creates_completion(self):
        (self.m.BASE / 'fresh-queue-once-result.json').unlink()
        self.assertRaises(FileNotFoundError, f.review, self.m, self.h)
        self.assertFalse((self.m.BASE / 'finalization-v2-result.json').exists())

    def test_foreign_same_byte_publication_inode_refuses(self):
        self.m.PUBLIC_ENV.rename(self.root / 'retained'); self.m.PUBLIC_ENV.write_bytes(b'public=value\n')
        self.assertRaises(RuntimeError, f.review, self.m, self.h)

    def test_normal_queue_job_gets_bounded_readonly_wait_with_original_guard(self):
        self.h.busy = 1
        with patch.object(f.time, 'sleep'): self.assertEqual(f.definitions(self.m, self.h, self.binding['definitions']), self.binding['definitions'])
        self.h.busy = 99
        with patch.object(f.time, 'monotonic', side_effect=[0, 1]), patch.object(f.time, 'sleep'):
            self.assertRaisesRegex(RuntimeError, 'did_not_become_terminal', f.definitions, self.m, self.h, self.binding['definitions'], 0.5)

    def test_static_definition_drift_is_not_waited_away(self):
        self.h.busy = 1; original = self.h.state
        self.h.state = lambda u: {**original(u), 'FragmentPath': '/foreign'}
        self.assertRaisesRegex(RuntimeError, 'definition_drift', f.definitions, self.m, self.h, self.binding['definitions'])

    def test_wrong_API_or_start_window_refuses(self):
        self.h.actor = lambda *args: {**f.API_IDENTITY, 'MainPID': '999', 'ExecMainStartTimestampMonotonic': '350'}
        self.assertRaises(RuntimeError, f.review, self.m, self.h)
        self.h.actor = lambda *args: {**f.API_IDENTITY, 'ExecMainStartTimestampMonotonic': '550'}
        self.assertRaises(RuntimeError, f.review, self.m, self.h)

    def test_queue_requires_original_interval_coverage_and_non_skipped_completion(self):
        self.events[0]['__MONOTONIC_TIMESTAMP'] = '501'
        self.assertRaises(RuntimeError, f.review, self.m, self.h)
        self.events[0]['__MONOTONIC_TIMESTAMP'] = '450'
        self.events[0]['MESSAGE'] = json.dumps({'event': 'booster_artwork_queue_sync', 'skipped': True, 'queued': 0, 'indexedBlock': str(f.BOUNDARY + 5)})
        self.assertRaises(RuntimeError, f.review, self.m, self.h)


if __name__ == '__main__': unittest.main()
