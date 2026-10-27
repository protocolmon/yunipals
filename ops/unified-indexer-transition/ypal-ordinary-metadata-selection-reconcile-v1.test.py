"""Reproduce genuine9a post-reload failure; only seal the observed tail."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load(HERE / 'ypal-ordinary-metadata-selection-reconcile-v1.py')
previous = load(HERE / 'ypal-ordinary-metadata-select-completion-v1.test.py')


def fixture(test):
    f = previous.Fixture(test)
    p = previous.m
    f.h.m.NODE = '/opt/node-v24.18.1/bin/node'
    f.h.installer = type('Installer', (), {'TARGET': Path('/opt/public-metadata-runtime')})()
    entry = str(f.h.installer.TARGET / 'dist/metadata-worker.mjs')
    command = '{ path=' + f.h.m.NODE + ' ; argv[]=' + f.h.m.NODE + ' ' + entry + ' ; ignore_errors=no ; start_time=[Sun 2026-10-25 04:00:39 UTC] ; stop_time=[n/a] ; pid=444 ; code=(null) ; status=0/0 }'
    f.actor['unit'].update(ExecStart=command, MainPID='444')
    cleared = command.replace('Sun 2026-10-25 04:00:39 UTC', 'n/a').replace('; pid=444 ;', '; pid=0 ;')
    f.h.m.run = lambda args: json.dumps({'type': 'a(sasbttttuii)', 'data': [[f.h.m.NODE, [f.h.m.NODE, entry], False, 0, 0, 0, 0, 0, 0, 0]]}).encode()
    f.intent()
    f.manager(None, 'start')
    f.save(f.own / 'started-actor.json', f.actor)
    original = f.n.manager
    def reload(_, action):
        original(_, action)
        if action == 'daemon-reload':
            f.actor['unit']['ExecStart'] = cleared
    f.n.manager = reload
    with test.assertRaisesRegex(RuntimeError, 'only_owned_boot_activation_changed'):
        p.finish(f.n, f.h, f.op)
    test.assertFalse((f.base / 'selected.json').exists())
    test.assertTrue((f.base / 'native-observed.json').exists())
    test.assertTrue(f.n.BOOT.is_symlink())
    base = f.base.parent / 'new-reconciliation'
    patcher = patch.object(m, 'BASE', base)
    patcher.start()
    test.addCleanup(patcher.stop)
    original_protected = p.protected
    def protected(path, digest=None):
        if path == m.DIFF:
            return b'actual-fixed-private-diff-observation'
        return original_protected(path, digest)
    patcher = patch.object(p, 'protected', protected)
    patcher.start()
    test.addCleanup(patcher.stop)
    patcher = patch.object(m, 'parent', return_value=p)
    patcher.start()
    test.addCleanup(patcher.stop)
    return f, p


class Controls(unittest.TestCase):
    def test_exact9a_source_and_inert_default(self):
        self.assertEqual(m.sha((HERE / m.PARENT.name).read_bytes()), m.PARENT_SHA)
        out = subprocess.run(['/usr/bin/python3', '-I', '-B', m.__file__], capture_output=True, check=True)
        self.assertTrue(json.loads(out.stdout)['staticOnly'])

    def test_genuine_failed_tail_then_same_actor_sealed_without_service_replay(self):
        f, p = fixture(self)
        before_events = copy.deepcopy(f.events)
        binding, db = m.capture(p, f.n, f.h, f.op)
        result_sha = m.seal(p, f.n, f.h, f.op, m.sha(m.encoded(binding)))
        self.assertEqual(result_sha, m.sha((m.BASE / 'result.json').read_bytes()))
        self.assertEqual(f.document(f.base / 'selected.json')['nativeActor'], f.actor)
        self.assertFalse((f.own / 'result.json').exists())
        self.assertEqual([v for v in f.events if isinstance(v, tuple) and v[0] == 'manager'],
                         [v for v in before_events if isinstance(v, tuple) and v[0] == 'manager'])
        self.assertEqual(len(f.document(f.base / 'native-observed.json')['samples']), 3)
        proof = m.validate_completion(result_sha, f.n, f.h, f.op)
        self.assertTrue(proof['validated'])
        self.assertFalse(proof['parent9aSuccessClaimed'])

    def test_nonstart_text_fields_or_epoch_private_actor_changes_refuse(self):
        for change in ['ignore_errors=no', 'stop_time=[n/a]', 'code=(null)', 'status=0/0', 'argv[]=']:
            f, p = fixture(self)
            f.actor['unit']['ExecStart'] = f.actor['unit']['ExecStart'].replace(change, change + 'foreign')
            self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)
        for key in ['InvocationID', 'MainPID', 'ExecMainStartTimestampMonotonic']:
            f, p = fixture(self)
            f.actor['unit'][key] = '999'
            self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)

    def test_typed_command_requires_actual_program_argv_and_cleared_epoch(self):
        f, p = fixture(self)
        expected = m.typed_command(f.n, f.h)
        for index, value in [(0, '/foreign'), (1, ['/foreign']), (2, True), (3, 1), (4, 1), (7, 444), (8, True), (9, 1)]:
            changed = copy.deepcopy(expected)
            changed['data'][0][index] = value
            f.h.m.run = lambda args, changed=changed: json.dumps(changed).encode()
            self.assertRaises(RuntimeError, m.typed_command, f.n, f.h)

    def test_all_three_original_health_samples_and_live_database_required(self):
        f, p = fixture(self)
        path = f.base / 'native-observed.json'
        value = f.document(path)
        value['samples'][1]['probe'] = False
        path.write_bytes(m.encoded(value))
        self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)
        f, p = fixture(self)
        f.db['probe'] = False
        self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)

    def test_genuine_own_intent_original_prefix_cannot_change(self):
        f, p = fixture(self)
        path = f.base / 'native-start-intent.json'
        path.write_text('{}')
        self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)

    def test_final_actor_drift_refuses_before_selection_write(self):
        f, p = fixture(self)
        binding, _ = m.capture(p, f.n, f.h, f.op)
        original = p.write
        def write(folder, name, value):
            result = original(folder, name, value)
            if name == 'intent.json':
                f.actor['processes'][0]['startTicks'] += 1
            return result
        with patch.object(p, 'write', write):
            self.assertRaises(RuntimeError, m.seal, p, f.n, f.h, f.op, m.sha(m.encoded(binding)))
        self.assertFalse((f.base / 'selected.json').exists())

    def test_lost_own_ACK_finishes_only_exact_existing_selected_and_intent(self):
        f, p = fixture(self)
        binding, db = m.capture(p, f.n, f.h, f.op)
        m.BASE.mkdir(mode=0o700)
        p.write(m.BASE, 'intent.json', {'binding': binding, 'databaseObservation': db, 'effectsReplayed': False})
        f.save(f.base / 'selected.json', binding['selected'])
        inode = (f.base / 'selected.json').stat().st_ino
        result = m.seal(p, f.n, f.h, f.op, m.sha(m.encoded(binding)), finish=True)
        self.assertEqual((f.base / 'selected.json').stat().st_ino, inode)
        self.assertEqual(result, m.sha((m.BASE / 'result.json').read_bytes()))
        self.assertRaises(RuntimeError, m.seal, p, f.n, f.h, f.op, m.sha(m.encoded(binding)), True)

    def test_foreign_selected_or_parent_success_prefix_refuses(self):
        f, p = fixture(self)
        f.save(f.base / 'selected.json', {'foreign': True})
        self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)
        (f.base / 'selected.json').unlink()
        f.save(f.own / 'result.json', {'foreign': True})
        self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)

    def test_both_parent_and_original_inverse_prefixes_refuse(self):
        for own in [True, False]:
            f, p = fixture(self)
            folder = f.own if own else f.base
            f.save(folder / 'inverse-intent.json', {'actual-prefix': True})
            self.assertRaises(RuntimeError, m.capture, p, f.n, f.h, f.op)

    def test_intent_only_crash_explicit_finish_writes_missing_receipts_without_replay(self):
        f, p = fixture(self)
        binding, db = m.capture(p, f.n, f.h, f.op)
        m.BASE.mkdir(mode=0o700)
        p.write(m.BASE, 'intent.json', {'binding': binding, 'databaseObservation': db, 'effectsReplayed': False})
        before = [v for v in f.events if isinstance(v, tuple) and v[0] == 'manager']
        m.seal(p, f.n, f.h, f.op, m.sha(m.encoded(binding)), finish=True)
        self.assertTrue((f.base / 'selected.json').exists())
        self.assertTrue((m.BASE / 'result.json').exists())
        self.assertEqual(before, [v for v in f.events if isinstance(v, tuple) and v[0] == 'manager'])


if __name__ == '__main__':
    unittest.main()
