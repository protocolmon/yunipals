#!/usr/bin/env python3
"""Synthetic lifecycle/real-filesystem controls; never contacts a service or DB."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recovery', HERE / 'recover.py')
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


def native(latest=300, safe=200, finalized=100):
    return {'schemaOid': '75963410', 'tables': {str(i): {'oid': str(i)} for i in range(44)},
            'cache': {'schemaOid': '2', 'relations': [{'oid': '3'}]},
            'app': {'build_id': r.BUILD, 'is_locked': 1, 'heartbeat_at': 0}, 'clock': 30000,
            'checkpoints': {c: {k: str(v).zfill(75) for k, v in [('latest', latest), ('safe', safe), ('finalized', finalized)]}
                            for c in ['1', '56', '137', '8453']}}


class Pure(unittest.TestCase):
    def test_actual_build_hashes_pool_and_zero_io(self):
        v = {'format': 'yunipals-source-tail-pool8-offline-v1', 'buildId': r.BUILD,
             **dict(zip(['configHash', 'schemaHash', 'indexingHash'], r.EXPECTED_HASHES)),
             'poolMax': 8, 'effectivePoolMax': 8, 'namespace': r.SCHEMA, 'interceptedFixtureRequests': 12,
             'realProviderRequests': 0, 'socketAttempts': 0, 'databaseCalls': 0}
        r.validate_build(v)
        for k, value in [('poolMax', 5), ('buildId', 'other'), ('socketAttempts', 1), ('databaseCalls', 1)]:
            with self.subTest(k=k), self.assertRaises(RuntimeError): r.validate_build({**v, k: value})

    def test_official_latest_recovery_can_return_to_safe(self):
        self.assertFalse(r.recovery_floor(native(), native(200))['latestMonotonicityClaimed'])

    def test_safe_finalized_and_schema_cache_cannot_rewind(self):
        for v in [native(199), native(300, 199), native(300, 200, 99), {**native(), 'schemaOid': '4'}, {**native(), 'cache': {}}]:
            with self.subTest(v=v), self.assertRaises(RuntimeError): r.recovery_floor(native(), v)

    def test_capacity_reserves_both_retained_and_new_maxima(self):
        v = {'roleOid': '73004621', 'roleLimit': 32, 'otherUnattributedWriterSessions': 0,
             'freshSessions': 2, 'sourceSessions': 5, 'clients': 30, 'maximum': 100, 'reserved': 3}
        self.assertEqual(r.capacity(v)['writerWorstCase'], 13)
        for change in [{'roleLimit': 8}, {'otherUnattributedWriterSessions': 1}, {'clients': 96}, {'freshSessions': 6}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError): r.capacity({**v, **change})

    def test_overlay_resets_only_three_readonly_binds(self):
        text = r.drop_bytes().decode()
        self.assertEqual(text.count('BindReadOnlyPaths='), 2)
        self.assertEqual(text.count(':'), 3)
        for forbidden in ['ExecStart=', 'Environment=', 'User=', 'MemoryMax=', 'BindPaths=']:
            self.assertNotIn(forbidden, text)

    def test_sdk_and_current_rpc_are_finite(self):
        self.assertEqual(r.RPC_FILE, 'ypal-retained-proxy-current-v3.py')
        self.assertEqual(r.RPC_ACK, '152178ab94fd1b4c974d392633a201eaf04da412ce1295e29842e9cdeb35722b')
        self.assertIn('f5d34eab', r.SDK_SHA)


class SDK:
    @staticmethod
    def identity(path):
        st = Path(path).lstat()
        return {'dev': st.st_dev, 'ino': st.st_ino, 'uid': st.st_uid, 'gid': st.st_gid, 'mode': st.st_mode}
    @staticmethod
    def protected(path): return Path(path).read_bytes()
    @staticmethod
    def document(path, expected=None):
        raw = Path(path).read_bytes()
        if expected: r.need(r.sha(raw) == expected, 'test_expected_SHA_required')
        return json.loads(raw)
    @staticmethod
    def save(path, value, mode=0o600):
        raw = value if isinstance(value, bytes) else r.encoded(value)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as f: f.write(raw); f.flush(); os.fsync(f.fileno())
    @staticmethod
    def sync(path):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY); os.fsync(fd); os.close(fd)
    @classmethod
    def link_record(cls, path):
        return {'identity': cls.identity(path), 'target': os.readlink(path)} if os.path.lexists(path) else None
    sha = staticmethod(r.sha)
    boot = staticmethod(lambda: 'synthetic-boot')
    mono = staticmethod(lambda: 100)


class Host:
    def __init__(self):
        self.m = SDK; self.manifest_sha = 'manifest'; self.input_sha = 'input'
        self.original = {'unit': {'InvocationID': 'old'}, 'parent': {'pid': 1}, 'processes': []}
        self.current = copy.deepcopy(self.original); self.calls = []; self.owned_calls = []; self.n = native()
        self.fail = None; self.change = False; self.preserved_fails = False
        self.s = types.SimpleNamespace(resources=lambda: {})
    def inputs(self): return {'privateSha': 'synthetic-private-hash'}
    def actor(self, unit, terminal=False):
        if self.change: return {'changed': True}
        return self.current
    def state(self, unit):
        return {'MainPID': '1' if self.current else '0', 'ActiveState': 'active' if self.current else 'inactive', 'SubState': 'running' if self.current else 'dead'}
    def sessions(self, source=None): return {'synthetic-retained': []}
    def preserved(self, op): r.need(not self.preserved_fails, 'synthetic_unavailable')
    def native(self): return copy.deepcopy(self.n)
    def capacity(self, actor): return {'observedSourceSessions': 1}
    def loaded(self, op, pool8): return 'pool8' if pool8 else 'pool5'
    def owned(self, op, prefix='', pool8=True):
        self.owned_calls.append((prefix, pool8)); r.need(self.current is not None, 'synthetic_source_not_live')
        r.need((self.current['unit']['InvocationID'] == 'new8') == pool8, 'synthetic_wrong_pool_epoch')
        return self.current
    def manager(self, verb):
        self.calls.append(verb)
        if verb == 'stop': self.current = None
        elif verb == 'start':
            self.current = {'unit': {'InvocationID': 'new5'}, 'parent': {'pid': 5}, 'processes': []}
            self.n['clock'] += 1; self.n['app']['heartbeat_at'] = self.n['clock']
        if verb == self.fail: raise RuntimeError('synthetic_lost_manager_ACK')


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ypal-pool8-controls-'); self.root = Path(self.temp.name)
        self.base = self.root / 'receipts'; self.base.mkdir(mode=0o700)
        self.hold = self.root / 'hold'; self.hold.mkdir(mode=0o700)
        self.boot = self.root / 'wants/source'; self.boot.parent.mkdir(); self.boot.symlink_to('../source.service')
        self.drop = self.root / 'source.service.d/99.conf'; self.drop.parent.mkdir()
        self.patches = [patch.object(r, k, v) for k, v in [('BASE', self.base), ('HOLD', self.hold), ('BOOT', self.boot), ('DROP', self.drop)]]
        for p in self.patches: p.start()
        self.h = Host(); self.owner = r.Owner(self.h)
        self.op = {'operatorSha256': r.sha(Path(r.__file__).read_bytes()), 'bootId': SDK.boot(),
                   'manifestSha256': 'manifest', 'inputSha256': 'input', 'source': self.h.original,
                   'inputs': self.h.inputs(), 'boot': SDK.link_record(self.boot)}
        self.owner.put('operation.json', self.op)
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def test_boot_moves_preserve_actual_inode_and_reconcile(self):
        self.owner.move_boot(self.op); self.owner.move_boot(self.op)
        self.assertFalse(self.boot.exists()); self.assertEqual(SDK.link_record(self.hold / 'boot'), self.op['boot'])
        self.owner.move_boot(self.op, True); self.owner.move_boot(self.op, True)
        self.assertEqual(SDK.link_record(self.boot), self.op['boot'])
    def test_boot_foreign_replacement_refuses(self):
        self.owner.move_boot(self.op); self.boot.symlink_to('../foreign')
        with self.assertRaises(RuntimeError): self.owner.move_boot(self.op, True)
        self.assertEqual(os.readlink(self.boot), '../foreign')
    def test_stop_CAS_is_after_durable_intent(self):
        original_save = self.owner.put
        def save(name, value):
            original_save(name, value)
            if name == 'stop-original-intent.json': self.h.change = True
        self.owner.put = save
        with self.assertRaisesRegex(RuntimeError, 'post_intent'): self.owner.stop(self.op, 'stop-original', self.h.original)
        self.assertEqual(self.h.calls, []); self.assertTrue((self.base / 'stop-original-sessions.json').exists())
    def test_lost_stop_ack_is_terminal_readonly_reconciliation(self):
        self.h.fail = 'stop'
        with self.assertRaises(RuntimeError): self.owner.stop(self.op, 'stop-original', self.h.original)
        self.h.fail = None; self.owner.stop_ack(self.op, 'stop-original')
        self.assertEqual(self.h.calls, ['stop'])
    def test_stop_ack_does_not_require_pack_rpc_health(self):
        self.h.current = None; self.h.preserved_fails = True
        self.assertTrue(self.owner.stop_ack(self.op, 'stop-original')['terminal'])
    def test_unknown_stop_cannot_blindly_stop_twice(self):
        self.owner.put('stop-original-sessions.json', {}); self.owner.put('stop-original-intent.json', {})
        with self.assertRaises(FileExistsError): self.owner.stop(self.op, 'stop-original', self.h.original)
        self.assertEqual(self.h.calls, [])
    def test_same_owned_install_prefix_inode(self):
        self.h.current = None; self.owner.put('drained.json', {'native': native()}); self.owner.move_boot(self.op)
        self.owner.install(); prepared = self.owner.get('overlay-prepared.json')
        self.assertEqual(SDK.identity(self.drop), prepared['identity']); self.assertEqual(self.drop.read_bytes(), r.drop_bytes())
        self.assertEqual(self.h.calls, ['daemon-reload'])
        with self.assertRaises(RuntimeError): self.owner.install()
    def test_foreign_drop_prevents_install(self):
        self.h.current = None; self.owner.put('drained.json', {}); self.owner.move_boot(self.op); self.drop.write_bytes(b'foreign')
        with self.assertRaises(RuntimeError): self.owner.install()
        self.assertEqual(self.h.calls, []); self.assertEqual(self.drop.read_bytes(), b'foreign')
    def test_official_lock_25s_is_observed_not_written(self):
        self.h.n['app']['is_locked'] = 1; self.h.n['app']['heartbeat_at'] = 6000
        with self.assertRaisesRegex(RuntimeError, '25s'): self.owner.lock_released()
        self.h.n['clock'] = 31000; self.owner.lock_released(); self.assertEqual(self.h.calls, [])
    def test_lost_inverse_start_ack_retains_advanced_work_no_manager_retry(self):
        self.h.current = {'unit': {'InvocationID': 'new5'}, 'parent': {'pid': 5}, 'processes': []}
        self.h.n = native(500, 400, 300)
        self.owner.put('inverse-intent.json', {}); self.owner.put('inverse-start-intent.json', {'notBeforeUs': 100, 'preStartDatabaseClock': 0, 'predecessorHeartbeat': -1})
        self.owner.put('inverse-drained.json', {'native': native()})
        value = self.owner.inverse(True)
        self.assertTrue(value['restored']); self.assertEqual(self.h.calls, []); self.assertEqual(self.h.owned_calls, [('inverse-', False), ('inverse-', False)])
        self.assertEqual(value['native']['checkpoints']['56']['latest'], str(500).zfill(75))
    def test_partial_original_stop_before_effect_can_preserve_same_live_actor(self):
        self.owner.put('stop-original-intent.json', {})
        value = self.owner.inverse()
        self.assertTrue(value['originalActorPreserved']); self.assertEqual(self.h.calls, [])
    def test_inverse_failed_new_source_preserves_exact_overlay_inode(self):
        self.h.current = None; self.owner.put('drained.json', {'native': native()}); self.owner.move_boot(self.op); self.owner.install()
        self.owner.put('start-intent.json', {'notBeforeUs': 100})
        before = SDK.identity(self.drop); value = self.owner.inverse()
        self.assertTrue(value['restored']); self.assertFalse(self.drop.exists())
        self.assertEqual(SDK.identity(self.hold / 'removed-overlay'), before)
        self.assertEqual(SDK.link_record(self.boot), self.op['boot'])
        self.assertEqual(self.h.calls, ['daemon-reload', 'daemon-reload', 'start'])
    def test_foreign_boot_before_restored_ack_refuses(self):
        self.h.current = {'unit': {'InvocationID': 'new5'}, 'parent': {'pid': 5}, 'processes': []}
        self.owner.put('inverse-drained.json', {'native': native()})
        self.owner.put('inverse-start-intent.json', {'preStartDatabaseClock': 0, 'predecessorHeartbeat': -1})
        self.boot.unlink(); self.boot.symlink_to('../foreign')
        with self.assertRaisesRegex(RuntimeError, 'restored_actor_and_boot'): self.owner.restored_ack(self.op)
    def test_restored_actor_without_native_startup_cannot_be_accepted(self):
        self.h.current = {'unit': {'InvocationID': 'new5'}, 'parent': {'pid': 5}, 'processes': []}
        self.owner.put('inverse-drained.json', {'native': native()}); self.owner.put('inverse-start-intent.json', {})
        self.h.n['app']['is_locked'] = 0
        with self.assertRaisesRegex(RuntimeError, 'live_Ponder'): self.owner.restored_ack(self.op)
    def test_inverse_cannot_adopt_a_rewound_observed_safe_floor(self):
        self.owner.put('drained.json', {'native': native()})
        with self.assertRaisesRegex(RuntimeError, 'recovery_floor'): self.owner.inverse_floor(native(300, 199))
    def test_atomic_overlay_publication_does_not_replace_racing_foreign_bytes(self):
        self.h.current = None; self.owner.put('drained.json', {}); self.owner.move_boot(self.op)
        original = self.owner.put
        def put(name, value):
            original(name, value)
            if name == 'overlay-prepared.json': self.drop.write_bytes(b'foreign')
        self.owner.put = put
        with self.assertRaises(FileExistsError): self.owner.install()
        self.assertEqual(self.drop.read_bytes(), b'foreign'); self.assertEqual(self.h.calls, [])
    def test_recent_predecessor_heartbeat_does_not_prove_new_epoch_startup(self):
        n = native(); n['app']['heartbeat_at'] = 10000
        with self.assertRaisesRegex(RuntimeError, 'actual_new_source_epoch'):
            r.epoch_heartbeat(n, {'preStartDatabaseClock': 30000, 'predecessorHeartbeat': 10000})
        n['clock'] = n['app']['heartbeat_at'] = 30001
        r.epoch_heartbeat(n, {'preStartDatabaseClock': 30000, 'predecessorHeartbeat': 10000})
    def test_explicit_inverse_reload_completion_cannot_repeat_manager_or_start(self):
        self.h.current = None; fragment = self.root / 'source.service'; fragment.write_bytes(b'synthetic unit')
        self.op['definitions'] = {str(fragment): {'identity': SDK.identity(fragment), 'sha256': r.sha(fragment.read_bytes())}}
        (self.base / 'operation.json').write_bytes(r.encoded(self.op))
        self.h.state = lambda _: {'FragmentPath': str(fragment), 'DropInPaths': str(self.drop)}
        self.owner.put('inverse-intent.json', {}); self.owner.put('inverse-reload-intent.json', {})
        value = self.owner.complete_inverse_reload(); self.assertTrue(value['configurationOnlyCompleted'])
        self.assertEqual(self.h.calls, ['daemon-reload'])
        with self.assertRaises(FileExistsError): self.owner.complete_inverse_reload()
        self.assertEqual(self.h.calls, ['daemon-reload'])
    def test_escaped_known_process_blocks_terminal_acceptance(self):
        self.h.current = None; text = Path('/proc/self/stat').read_text(); ticks = int(text[text.rfind(')') + 2:].split()[19])
        self.op['source']['processes'] = [{'pid': os.getpid(), 'startTicks': ticks}]
        with self.assertRaisesRegex(RuntimeError, 'not_escaped'): self.owner.stop_ack(self.op, 'stop-original')
    def test_atomic_boot_restore_preserves_foreign_target_race(self):
        self.owner.move_boot(self.op); publish = r.publish_no_replace
        def race(source, target):
            if target == self.boot: self.boot.symlink_to('../foreign')
            return publish(source, target)
        with patch.object(r, 'publish_no_replace', race), self.assertRaises(FileExistsError): self.owner.move_boot(self.op, True)
        self.assertEqual(os.readlink(self.boot), '../foreign')
        self.assertEqual(SDK.link_record(self.hold / 'boot'), self.op['boot'])


if __name__ == '__main__': unittest.main()
