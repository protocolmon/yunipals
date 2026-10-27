"""Retained nineteen executor controls plus real false-coverage wait seams."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load('ypal-ordinary-metadata-drain-v2.py')
old = load('ypal-ordinary-metadata-drain-v1.test.py')
RAW = (HERE / m.PREVIOUS.name).read_bytes()
successor = m.namespace(RAW)
old.m = successor


class RetainedControls(old.Controls):
    pass


def database(covered=False):
    return {'scan': {'name': 'base_metadata_v1', 'chain_id': 8453,
            'contract_address': '0x98433df878e8c898cb907345c3a7756e5f72240f',
            'deployment_block': 22224075, 'next_block': 53053717, 'ingestion_mode': 'rpc',
            'target_block': 53053727, 'target_hash': 'public-target', 'last_scanned_hash': 'public-scan', 'updated_at': 'fixed'},
            'approval': None, 'frame': {'block_number': '53053725'} if covered else {'block_number': '53053715'}}


class CoverageControls(unittest.TestCase):
    def fixture(self, snapshots, stopped=False):
        folder = tempfile.TemporaryDirectory(dir=HERE)
        self.addCleanup(folder.cleanup)
        n = old.namespace()
        self.enterContext(patch.object(n, 'BASE', Path(folder.name) / 'operation'))
        self.enterContext(patch.object(n, 'BOOT', Path(folder.name) / 'boot'))
        clock = types.SimpleNamespace(now=0.0)
        self.enterContext(patch.object(m.time, 'monotonic', side_effect=lambda: clock.now))
        self.enterContext(patch.object(m.time, 'sleep', side_effect=lambda seconds: setattr(clock, 'now', clock.now + seconds)))
        counts = {'database': 0, 'terminal': 0, 'private': 0}
        state = {'actor': {'pid': 17, 'epoch': 'actual-epoch'}, 'private': {'definitions': 'fixed'}}
        op = {'oldActor': copy.deepcopy(state['actor']), 'oldWriter': copy.deepcopy(state['private'])}
        def document(path):
            return json.loads(Path(path).read_bytes())
        def terminal(*args):
            counts['terminal'] += 1
            m.need(not state.get('reactivated'), 'genuine_terminal_refusal')
        host = types.SimpleNamespace(actor=lambda: copy.deepcopy(state['actor']),
            m=types.SimpleNamespace(snapshot=lambda _: (copy.deepcopy(state['private']), {})),
            s=types.SimpleNamespace(document=document), _coverage_operation_binding=None,
            private=lambda _: counts.update(private=counts['private'] + 1), terminal=terminal)
        if stopped:
            n.BASE.mkdir()
            (n.BASE / 'original-boot-link').symlink_to('/etc/systemd/system/' + n.UNIT)
            op['oldBoot'] = n.link(n.BASE / 'original-boot-link')
            (n.BASE / 'operation.json').write_text(json.dumps(op))
            (n.BASE / 'stop-old-intent.json').write_text('{}')
            (n.BASE / 'drain-session-proof.json').write_text('{"sessions":{"owned":[],"otherPeers":[]}}')
            host._coverage_operation_binding = copy.deepcopy(op)
        def read(_):
            index = min(counts['database'], len(snapshots) - 1)
            counts['database'] += 1
            item = snapshots[index]
            return item() if callable(item) else item
        observations, audit = [], []
        invoke = lambda: m.coverage_observation(n, host, read, observations, lambda item: audit.append(copy.deepcopy(item)))
        return invoke, state, clock, counts, observations, audit, n, host

    def test_actual_false_then_covered_snapshot_is_returned_unchanged(self):
        first, last = database(), database(True)
        run, _, _, counts, observations, audit, _, _ = self.fixture([first, last])
        original = copy.deepcopy([first, last])
        self.assertIs(run(), last)
        self.assertEqual([first, last], original)
        self.assertEqual(counts['database'], 2)
        self.assertTrue(observations[0]['covered'])
        self.assertEqual(audit, observations)

    def test_immediate_true_uses_exact_original_predicate_without_wait(self):
        last = database(True)
        run, _, _, counts, observations, audit, _, _ = self.fixture([last])
        self.assertIs(run(), last)
        self.assertEqual(counts['database'], 1)
        self.assertEqual((observations, audit), ([], []))

    def test_missing_frame_ready_halt_or_stale_snapshots_never_turn_true(self):
        for reason in ['not-ready', 'halted', 'stale']:
            snapshot = database()
            snapshot.update(frame=None, sourceDiagnostic=reason)
            run, _, _, counts, observations, audit, _, _ = self.fixture([snapshot])
            with self.subTest(reason=reason), self.assertRaisesRegex(RuntimeError, 'coverage_wait_expired'):
                run()
            self.assertLessEqual(counts['database'], 90)
            self.assertFalse(observations[0]['covered'])
            self.assertEqual(audit, observations)

    def test_live_cursor_may_advance_but_identity_mode_and_rewind_refuse(self):
        first, last = database(), database(True)
        last['scan'].update(next_block=53053718, target_block=53053728, target_hash='advanced', updated_at='later')
        self.assertIs(self.fixture([first, last])[0](), last)
        for key, value in [('chain_id', 1), ('contract_address', 'foreign'), ('deployment_block', 1), ('ingestion_mode', 'native'), ('next_block', 53053716)]:
            bad = database(True)
            bad['scan'][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.fixture([database(), bad])[0]()

    def test_actor_private_or_approval_change_refuses_without_effects(self):
        for key in ['actor', 'private', 'approval']:
            fixture = self.fixture([database(), database(True)])
            run, state, _, counts, observations, audit, _, _ = fixture
            good = database(True)
            def changed():
                if key == 'approval':
                    good['approval'] = {'state': 'ready'}
                else:
                    state[key] = {'foreign': True}
                return good
            run, state, _, counts, observations, audit, _, _ = self.fixture([database(), changed])
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                run()
            self.assertFalse(observations[0]['covered'])
            self.assertEqual(audit, observations)

    def test_post_stop_uses_genuine_drained_before_and_after_same_scan_wait(self):
        run, _, _, counts, observations, _, _, _ = self.fixture([database(), database(True)], stopped=True)
        self.assertTrue(run()['frame'])
        self.assertGreaterEqual(counts['terminal'], 3)
        self.assertGreaterEqual(counts['private'], 3)
        self.assertEqual(observations[0]['phase'], 'stopped')

    def test_post_stop_any_scan_or_operation_or_terminal_change_refuses(self):
        for key in ['next_block', 'updated_at', 'operation', 'terminal']:
            snapshots = [database()]
            run, state, _, _, observations, _, n, host = self.fixture(snapshots, stopped=True)
            def changed():
                good = database(True)
                if key == 'operation':
                    (n.BASE / 'operation.json').write_text('{}')
                elif key == 'terminal':
                    state['reactivated'] = True
                else:
                    good['scan'][key] = 'changed' if key == 'updated_at' else 53053718
                return good
            snapshots.append(changed)
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                run()
            self.assertFalse(observations[0]['covered'])

    def test_arbitrary_database_errors_are_not_retried(self):
        for error in [RuntimeError('database_unknown'), ValueError('unparseable')]:
            def fail():
                raise error
            run, _, _, counts, observations, _, _, _ = self.fixture([database(), fail])
            with self.assertRaises(type(error)) as caught:
                run()
            self.assertIs(caught.exception, error)
            self.assertEqual(counts['database'], 2)
            self.assertFalse(observations[0]['covered'])

    def test_slow_success_does_not_escape90_second_bound(self):
        snapshots = [database()]
        run, _, clock, _, observations, _, _, _ = self.fixture(snapshots)
        def slow():
            clock.now = 91
            return database(True)
        snapshots.append(slow)
        with self.assertRaisesRegex(RuntimeError, 'coverage_wait_expired'):
            run()
        self.assertFalse(observations[0]['covered'])

    def test_original_full_source_fence_still_refuses_after_coverage_wait(self):
        run, _, _, _, _, _, n, _ = self.fixture([database(), database(True)])
        self.assertTrue(n.covered(run()))
        binding = old.binding()
        original_phase = old.phase()
        expected = successor.authority(binding, original_phase, successor.INPUT_SHA)
        changed_phase = copy.deepcopy(original_phase)
        changed_phase['sourceBinding'] = {'foreign': 'current-source'}
        h = types.SimpleNamespace(refresh=lambda: changed_phase, private=lambda _: None,
            m=types.SimpleNamespace(snapshot=lambda _: (binding['oldWriter'], {})), actor=lambda: binding['oldActor'])
        with patch.object(n, 'link', return_value=binding['oldBoot']), patch.object(n, 'DROP', n.BASE.parent / 'absent-drop'):
            with self.assertRaisesRegex(RuntimeError, 'source_or_READ_changed_before_metadata_first_effect'):
                successor.fence(n, h, binding, expected)
        self.assertFalse(n.BASE.exists())

    def test_namespaces_original_drain_fences_and_own_ack_producer(self):
        previous = load('ypal-ordinary-metadata-drain-v1.py')
        self.assertEqual(successor.PREVIOUS_SHA if hasattr(successor, 'PREVIOUS_SHA') else m.PREVIOUS_SHA, m.PREVIOUS_SHA)
        self.assertNotEqual(successor.FORMAT, previous.FORMAT)
        self.assertNotEqual(successor.BASE, previous.BASE)
        self.assertEqual(successor.OWNER_SHA, previous.OWNER_SHA)
        self.assertEqual(successor.INPUT_SHA, previous.INPUT_SHA)
        self.assertEqual(successor.drain_body.__code__.co_code, previous.drain_body.__code__.co_code)
        self.assertEqual(successor.fence.__code__.co_code, previous.fence.__code__.co_code)
        self.assertEqual(successor.completed.__code__.co_code, previous.completed.__code__.co_code)
        self.assertNotEqual(successor.own_sha(), m.PREVIOUS_SHA)
        self.assertEqual(successor.own_sha(), m.sha(Path(m.__file__).read_bytes()))


if __name__ == '__main__':
    unittest.main(verbosity=2)
