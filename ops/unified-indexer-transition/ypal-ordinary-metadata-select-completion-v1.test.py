"""Genuine selection tail and terminal formal-argument path, private real FS."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load(HERE / 'ypal-ordinary-metadata-select-completion-v1.py')
c = load(HERE / m.COMMON.name)


def local(path, digest=None):
    path = Path(path)
    public = HERE / path.name
    if path.parent == m.OPS and public.exists():
        raw = public.read_bytes()
    elif path == m.FAILURE:
        raw = m.encoded({'completed': False, 'fixedCode': m.FAILURE_CODE})
    else:
        raw = path.read_bytes()
    if digest is not None and path != m.FAILURE:
        m.need(m.sha(raw) == digest, 'exact_local_component_required')
    return raw


def namespace():
    with patch.object(c, 'public', local):
        return c.metadata_namespace('c' * 64)


class Fixture:
    def __init__(self, test):
        self.tmp = tempfile.TemporaryDirectory()
        test.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.base, self.own = root / 'metadata', root / 'completion'
        self.base.mkdir(mode=0o700)
        self.n = namespace()
        self.n.BASE, self.n.BOOT, self.n.DROP = self.base, root / 'boot', root / 'native-drop'
        self.n.UNIT = 'yunipals-metadata-completion-unit-test.service'
        (self.base / 'original-boot-link').symlink_to('/etc/systemd/system/' + self.n.UNIT)
        self.n.DROP.write_text('owned native definition')
        self.boot = self.n.link(self.base / 'original-boot-link')
        self.old = {'unit': {'InvocationID': 'original', 'ExecMainStartTimestampMonotonic': '10'},
                    'processes': [{'pid': 222, 'startTicks': 333}]}
        self.actor = {'unit': {'InvocationID': 'new-own', 'ExecMainStartTimestampMonotonic': '101',
                              'UnitFileState': 'disabled', 'WantedBy': ''},
                      'processes': [{'pid': 444, 'startTicks': 555}]}
        self.op = {'oldActor': self.old, 'oldBoot': self.boot, 'oldWriter': {'definitions': 'private-original'},
                   'bootId': 'boot', 'candidateDropSha256': m.sha(self.n.DROP.read_bytes())}
        self.current = {'MainPID': '0', 'ControlPID': '0', 'Job': '', 'ActiveState': 'inactive',
                        'InvocationID': '', 'ExecMainStartTimestampMonotonic': '0'}
        self.events = []
        self.sessions = {'owned': [], 'otherPeers': [{'pid': 901, 'backendStart': 'fresh-attempt'}]}
        self.db = {'scan': {'ingestion_mode': 'native', 'next_block': 100},
                   'approval': {'state': 'ready', 'read_identity': 'v5'}, 'probe': False}
        self.meta = types.SimpleNamespace(IDENTITY='v5', RELEASE='release')
        self.h = types.SimpleNamespace(s=types.SimpleNamespace(document=self.document, protected=lambda p, *args: p.read_bytes(),
            save=self.save, sync=lambda p: None, boot=lambda: 'boot'), meta=self.meta, m=types.SimpleNamespace(),
            refresh=lambda: self.events.append('source-current'), private=lambda old: self.events.append('private'),
            actor=lambda *a, **k: copy.deepcopy(self.actor), database=lambda: copy.deepcopy(self.db),
            terminal=self.formal_terminal)
        self.h._completion_base = self.base
        self.common = types.SimpleNamespace(terminal_sessions=lambda h, actor: copy.deepcopy(self.sessions))
        self.n.state = lambda _: copy.deepcopy(self.current)
        self.n.loaded = lambda *args: True
        self.n.identity_alive = lambda *args: False
        self.n.no_live_cli = lambda _: self.events.append('no-live-cli')
        self.n.manager = self.manager
        adopt = {'adopted': True, 'releaseId': 'release', 'readIdentity': 'v5'}
        for name, value in {'operation.json': self.op, 'drained.json': {'scan': {'next_block': 100}},
            'adopted.json': {'officialAcknowledgementPresent': True, 'result': adopt, 'after': self.db},
            'adopt-result.json': adopt, 'native-drop-intent.json': {'path': str(self.n.DROP)},
            'native-drop-created.json': self.n.file_identity(self.n.DROP),
            'native-start-intent.json': {'bootId': 'boot', 'monotonicUs': 1}}.items():
            self.save(self.base / name, value)
        self.op_sha = m.sha((self.base / 'operation.json').read_bytes())
        self.patchers = [patch.object(m, 'BASE', self.own), patch.object(m, 'OPERATION_SHA', self.op_sha),
                         patch.object(m, 'protected', local), patch.object(self.n.time, 'sleep', lambda _: None)]
        for p in self.patchers:
            p.start()
            test.addCleanup(p.stop)

    def document(self, path, digest=None):
        raw = path.read_bytes()
        m.need(digest is None or m.sha(raw) == digest, 'exact_fixture_receipt_required')
        return json.loads(raw)

    def save(self, path, value):
        raw = m.encoded(value)
        with path.open('xb') as f:
            f.write(raw)
        path.chmod(0o600)
        return m.sha(raw)

    def formal_terminal(self, op, actor, sessions=None):
        m.need(sessions is not None, 'actual_formal_sessions_required')
        self.events.append(('formal-terminal', copy.deepcopy(sessions)))
        self.h.private(op['oldWriter'])
        self.h.refresh()

    def manager(self, _, action):
        self.events.append(('manager', action))
        if action == 'start':
            self.current.update(MainPID='444', ActiveState='active', InvocationID='new-own', ExecMainStartTimestampMonotonic='101')
            self.db['probe'] = True
        elif action == 'daemon-reload' and self.n.BOOT.is_symlink():
            self.actor['unit'].update(UnitFileState='enabled', WantedBy='multi-user.target')

    def intent(self):
        self.own.mkdir(mode=0o700)
        value = {'format': m.FORMAT, 'operatorSha256': m.sha(Path(m.__file__).read_bytes()),
            'originalOperationSha256': self.op_sha, 'originalInputSha256': m.INPUT_SHA, 'bootId': 'boot',
            'monotonicUs': 100, 'deadlineUs': 900000100, 'binding': {'records': {'native-start-intent.json': m.sha((self.base / 'native-start-intent.json').read_bytes())}}}
        self.save(self.own / 'start-intent.json', value)


class Controls(unittest.TestCase):
    def test_exact_dependencies_and_static_default(self):
        for path, digest in [(m.COMMON, m.COMMON_SHA), (m.OWNER, m.OWNER_SHA), (m.TEMPLATE, m.TEMPLATE_SHA)]:
            self.assertEqual(m.sha((HERE / path.name).read_bytes()), digest)
        result = subprocess.run(['/usr/bin/python3', '-I', '-B', m.__file__], capture_output=True, check=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly'])
        with patch.object(m, 'protected', local):
            m.failed_select()

    def test_forgotten_epoch_requires_actual_formal_sessions_private_source_and_loaded(self):
        f = Fixture(self)
        result = m.terminal(f.common, f.n, f.h, f.op, f.old)
        self.assertFalse(result['terminalInvocationClaimed'])
        self.assertIn(('formal-terminal', f.sessions), f.events)
        self.assertIn('source-current', f.events)
        f.n.loaded = lambda *args: False
        self.assertRaises(RuntimeError, m.terminal, f.common, f.n, f.h, f.op, f.old)

    def test_foreign_terminal_epoch_refuses_exact_recorded_epoch_accepts(self):
        f = Fixture(self)
        f.current.update(InvocationID='foreign', ExecMainStartTimestampMonotonic='99')
        self.assertRaises(RuntimeError, m.terminal, f.common, f.n, f.h, f.op, f.old)
        f.current.update(InvocationID='original', ExecMainStartTimestampMonotonic='10')
        self.assertFalse(m.terminal(f.common, f.n, f.h, f.op, f.old)['terminalInvocationClaimed'])

    def test_known_old_process_or_late_manager_change_refuses(self):
        f = Fixture(self)
        f.n.identity_alive = lambda *a: True
        self.assertRaises(RuntimeError, m.terminal, f.common, f.n, f.h, f.op, f.old)
        f.n.identity_alive = lambda *a: False
        def late(*a, **k):
            f.current['MainPID'] = '999'
        f.h.terminal = late
        self.assertRaises(RuntimeError, m.terminal, f.common, f.n, f.h, f.op, f.old)

    def test_full_prefix_accepts_aged_probe_but_never_scan_approval_or_drop_drift(self):
        f = Fixture(self)
        self.assertFalse(f.db['probe'])
        value = m.prefix(f.common, f.n, f.h, f.op)
        self.assertEqual(value['originalOperationSha256'], f.op_sha)
        for field in ['scan', 'approval']:
            saved = copy.deepcopy(f.db)
            f.db[field]['changed'] = True
            self.assertRaises(RuntimeError, m.prefix, f.common, f.n, f.h, f.op)
            f.db = saved
        f.n.DROP.write_text('changed definition')
        self.assertRaises(RuntimeError, m.prefix, f.common, f.n, f.h, f.op)

    def test_unrelated_sessions_observed_without_stale_action_digest(self):
        f = Fixture(self)
        observations = []
        first = m.prefix(f.common, f.n, f.h, f.op, observations)
        f.sessions['otherPeers'] = [{'pid': 902, 'backendStart': 'genuine-new-reconnect'}]
        second = m.prefix(f.common, f.n, f.h, f.op, observations)
        self.assertEqual(first, second)
        self.assertNotEqual(observations[0]['sessions'], observations[1]['sessions'])
        self.assertTrue(first['sessionObservationsExcludedFromActionDigest'])

    def test_existing_tail_or_inverse_forbids_start_prefix(self):
        for name in ['native-started.json', 'selected.json', 'inverse-intent.json']:
            f = Fixture(self)
            f.save(f.base / name, {})
            self.assertRaises(RuntimeError, m.prefix, f.common, f.n, f.h, f.op)

    def test_genuine_tail_three_samples_boot_and_new_epoch(self):
        f = Fixture(self)
        f.intent()
        f.manager(None, 'start')
        result = m.finish(f.n, f.h, f.op)
        self.assertEqual(result, m.sha((f.own / 'result.json').read_bytes()))
        selected = f.document(f.base / 'selected.json')
        self.assertEqual(selected['nativeActor'], f.actor)
        self.assertEqual(f.document(f.base / 'native-observed.json')['elapsedSeconds'], 20)
        self.assertEqual(len(f.document(f.base / 'native-observed.json')['samples']), 3)
        self.assertTrue(f.n.BOOT.is_symlink())
        self.assertFalse((f.base / 'original-boot-link').exists())
        self.assertFalse(f.document(f.own / 'result.json')['originalSelectCliAcknowledgementClaimed'])
        self.assertEqual(f.events.count(('manager', 'start')), 1)

    def test_old_intent_cannot_qualify_new_worker_without_own_new_clock(self):
        f = Fixture(self)
        f.intent()
        f.actor['unit']['ExecMainStartTimestampMonotonic'] = '99'
        self.assertRaises(RuntimeError, m.start_actor, f.n, f.h, f.op)
        self.assertFalse((f.base / 'native-started.json').exists())

    def test_original_poststart_probe_refusal_keeps_partial_tail_no_fake_ACK(self):
        f = Fixture(self)
        f.intent()
        self.assertRaises(RuntimeError, m.finish, f.n, f.h, f.op)
        self.assertTrue((f.base / 'native-started.json').exists())
        self.assertFalse((f.base / 'native-observed.json').exists())
        self.assertFalse((f.own / 'result.json').exists())
        self.assertRaises(RuntimeError, m.finish, f.n, f.h, f.op)
        self.assertNotIn(('manager', 'start'), f.events)

    def test_lost_start_ACK_observation_only_finish_never_dispatches_start(self):
        f = Fixture(self)
        f.intent()
        f.db['probe'] = True
        f.current.update(MainPID='444', ActiveState='active')
        m.finish(f.n, f.h, f.op)
        self.assertNotIn(('manager', 'start'), f.events)

    def test_completed_tail_lost_helper_ACK_reconciles_without_replay(self):
        f = Fixture(self)
        f.intent()
        f.manager(None, 'start')
        m.finish(f.n, f.h, f.op)
        (f.own / 'result.json').unlink()
        before = {p.name: p.stat().st_ino for p in f.base.iterdir()}
        events = list(f.events)
        m.finish(f.n, f.h, f.op)
        self.assertEqual(before, {p.name: p.stat().st_ino for p in f.base.iterdir()})
        self.assertEqual([v for v in events if isinstance(v, tuple) and v[0] == 'manager'],
                         [v for v in f.events if isinstance(v, tuple) and v[0] == 'manager'])

    def test_real_no_replace_boot_publish_refuses_racing_foreign_target(self):
        f = Fixture(self)
        foreign = f.n.BOOT
        foreign.symlink_to('/foreign-preserved')
        before = foreign.lstat().st_ino
        self.assertRaises(OSError, m.rename_no_replace, f.base / 'original-boot-link', foreign)
        self.assertEqual(foreign.lstat().st_ino, before)
        self.assertTrue((f.base / 'original-boot-link').is_symlink())

    def test_inverse_terminal_keeps_real_Host_bound_methods(self):
        f = Fixture(self)
        original = f.h.terminal
        m.inverse_terminal(f.common, f.n, f.h, f.op)
        f.h.terminal(f.op, f.old)
        self.assertIn(('formal-terminal', f.sessions), f.events)
        self.assertIn('source-current', f.events)
        self.assertIsNot(f.h.terminal, original)

    def test_full_start_is_once_only_and_keeps_original_pending_intent(self):
        f = Fixture(self)
        before = (f.base / 'native-start-intent.json').read_bytes()
        review = m.sha(m.encoded(m.prefix(f.common, f.n, f.h, f.op)))
        with patch.object(m.time, 'monotonic_ns', return_value=100000):
            m.start(f.common, f.n, f.h, f.op, review)
        self.assertEqual(before, (f.base / 'native-start-intent.json').read_bytes())
        self.assertEqual(f.events.count(('manager', 'start')), 1)
        self.assertRaises(RuntimeError, m.start, f.common, f.n, f.h, f.op, review)
        self.assertEqual(f.events.count(('manager', 'start')), 1)

    def test_recorded_actor_and_finite_own_window_refuse_foreign_restart(self):
        f = Fixture(self)
        f.intent()
        f.save(f.own / 'started-actor.json', f.actor)
        f.actor['processes'][0]['startTicks'] += 1
        self.assertRaises(RuntimeError, m.start_actor, f.n, f.h, f.op)
        f.actor['processes'][0]['startTicks'] -= 1
        f.actor['unit']['ExecMainStartTimestampMonotonic'] = '900000101'
        self.assertRaises(RuntimeError, m.start_actor, f.n, f.h, f.op)

    def test_foreign_start_during_final_durable_save_is_not_adopted(self):
        f = Fixture(self)
        review = m.sha(m.encoded(m.prefix(f.common, f.n, f.h, f.op)))
        original = m.save
        def save(name, value):
            result = original(name, value)
            if name == 'prestart-terminal.json':
                f.current.update(MainPID='999', ActiveState='active', InvocationID='foreign')
            return result
        with patch.object(m, 'save', save), patch.object(m.time, 'monotonic_ns', return_value=100000):
            self.assertRaises(RuntimeError, m.start, f.common, f.n, f.h, f.op, review)
        self.assertNotIn(('manager', 'start'), f.events)

    def test_changed_original_pending_intent_cannot_be_relabelled(self):
        f = Fixture(self)
        f.intent()
        (f.base / 'native-start-intent.json').write_text('{}')
        self.assertRaises(RuntimeError, m.start_actor, f.n, f.h, f.op)

    def test_own_acknowledged_actor_must_be_gone_for_terminal_inverse(self):
        f = Fixture(self)
        f.intent()
        f.save(f.own / 'started-actor.json', f.actor)
        f.current.update(InvocationID='new-own', ExecMainStartTimestampMonotonic='101')
        self.assertFalse(m.terminal(f.common, f.n, f.h, f.op, f.old)['terminalInvocationClaimed'])
        f.n.identity_alive = lambda _, p: p['pid'] == 444
        self.assertRaises(RuntimeError, m.terminal, f.common, f.n, f.h, f.op, f.old)

    def test_completed_inverse_lost_helper_ACK_validates_without_effect_replay(self):
        f = Fixture(self)
        writer = {'definitions': {'original': 'same'}, 'environmentFileHashes': {'original-private': 'same'},
                  'configuredEnvironmentSha256': 'same'}
        f.op['oldWriter'] = writer
        f.h.m.snapshot = lambda _: (copy.deepcopy(writer), {})
        f.n.DROP.unlink()
        m.rename_no_replace(f.base / 'original-boot-link', f.n.BOOT)
        f.save(f.base / 'inverse-boot-publish-intent.json', f.boot)
        f.save(f.base / 'old-start-intent.json', {'bootId': 'boot', 'monotonicUs': 100, 'scan': {'next_block': 100, 'ingestion_mode': 'rpc'}})
        f.save(f.base / 'inverse-intent.json', {'nativeActor': None})
        f.save(f.base / 'inverse-sql-intent.json', {'actual': True})
        record = {'restored': True, 'oldWriter': writer, 'journalOrProvenanceRowsDeleted': 0,
                  'sourceSelectionChanged': False, 'readGrantsChanged': False}
        digest = f.save(f.base / 'inverse-result.json', record)
        f.db = {'scan': {'next_block': 101, 'ingestion_mode': 'rpc'}, 'approval':
                {'read_identity': 'v5', 'state': 'blocked', 'error_code': 'owned_metadata_inverse'}}
        f.current['ExecMainStartTimestampMonotonic'] = '101'
        before = {p.name: p.read_bytes() for p in f.base.iterdir() if not p.is_symlink()}
        self.assertEqual(m.completed_inverse(f.n, f.h, f.op), digest)
        self.assertEqual(before, {p.name: p.read_bytes() for p in f.base.iterdir() if not p.is_symlink()})
        self.assertFalse(any(isinstance(v, tuple) and v[0] == 'manager' for v in f.events))

    def test_inverse_body_keeps_original_logic_with_only_two_no_replace_moves(self):
        f = Fixture(self)
        fn = m.inverse_body(f.n)
        self.assertEqual(fn.__code__.co_names.count('completion_rename'), 1)
        self.assertNotIn('rename', fn.__code__.co_names)


if __name__ == '__main__':
    unittest.main()
