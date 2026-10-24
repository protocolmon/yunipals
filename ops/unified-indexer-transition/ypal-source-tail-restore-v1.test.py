#!/usr/bin/env python3
"""Focused synthetic controller/real-FS controls; no services/providers/DB."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = module(HERE / 'ypal-source-tail-restore-v1.py', 'restore')
old = module(HERE / 'ypal-source-tail-recovery-v2/recover.test.py', 'fixture')


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ypal-one-restore-'); self.root = Path(self.temp.name)
        self.ancestor = self.root / 'ancestor'; self.ancestor.mkdir(mode=0o700)
        self.hold = self.root / 'held'; self.hold.mkdir(mode=0o700)
        self.boot = self.root / 'boot'; self.boot.symlink_to('/synthetic/source.service')
        self.base = self.root / 'new-receipts'; action = patch.object(m, 'BASE', self.base); action.start(); self.addCleanup(action.stop)
        self.sdk = old.SDK(); self.calls = []; self.bad_mount = False; self.bad_public = False; self.backend_count = 1; self.lost = False
        self.project = '/synthetic/project'; self.paths = {}
        for i in range(6):
            path = self.root / ('backing' + str(i)); path.write_bytes(b'fixture'); self.paths[self.project + '/mount' + str(i)] = str(path)
        self.sdk.NAMESPACE = self.paths; self.sdk.NAMESPACE_PEER = 'namespace'; self.sdk.command = self.command
        parent = {'pid': 999999999, 'startTicks': 1, 'argv': ['/node', 'ponder'], 'cwd': self.project,
                  'executable': '/node', 'environmentSha256': 'env', 'startupInjectionAbsent': True}
        self.original = {'unit': {'After': 'db.service network.target', 'InvocationID': 'old', 'ExecMainStartTimestampMonotonic': '1'},
                         'parent': parent, 'processes': [copy.deepcopy(parent)]}
        self.fresh = {'unit': {'After': 'a.service z.service'}, 'identity': 'same-fresh'}
        self.api = {'unit': {'After': 'a.service z.service'}, 'identity': 'same-api'}
        self.op = {'source': self.original, 'fresh': copy.deepcopy(self.fresh), 'api': copy.deepcopy(self.api),
                   'inputs': {'same': 'inputs'}, 'rpc': {'same': 'rpc'}, 'packPackets': {'same': 'pack'},
                   'packBoots': {'same': 'boots'}, 'boot': self.sdk.link_record(self.boot)}
        self.native = old.native(); self.native['app']['is_locked'] = 0; self.source = None
        self.r = types.SimpleNamespace(SOURCE='source.service', FRESH='fresh.service', API='api.service', PROJECT=self.project,
            BASE=self.ancestor, HOLD=self.hold, DROP=self.root / 'removed.conf', drop_bytes=lambda: b'owned original overlay',
            OLD_CFG_SHA='original-config', RELEASE='actual-release', SCHEMA='native-schema', BUILD='71e2a7f3b7',
            recovery_floor=old.r.recovery_floor, epoch_heartbeat=old.r.epoch_heartbeat, BOOT=self.boot)
        self.h = types.SimpleNamespace(inputs=lambda: self.op['inputs'], rpc_current=lambda: self.op['rpc'],
            pack_packets=lambda: self.op['packPackets'], pack_boots=lambda: self.op['packBoots'], pack_ready=lambda: {},
            loaded=lambda *a: self.calls.append('loaded'), actor=self.actor, native=lambda: copy.deepcopy(self.native),
            sessions=lambda *a: {'fresh.service': [1]}, capacity=lambda *a: {'observedSourceSessions': self.backend_count},
            manager=self.manager, s=types.SimpleNamespace(resources=lambda: {}, PUBLIC_ENV_PEER='public', expected_env=lambda: {}))
        self.r.Owner = lambda h: types.SimpleNamespace(inverse_floor=lambda n: old.r.recovery_floor(old.native(), n), lock_released=lambda: copy.deepcopy(self.native))
        self.owner = m.Owner(self.r, self.sdk, self.h, self.op)
        for name, value in [('inverse-intent.json', {'operationSha256': m.OP_SHA}), ('inverse-reload-intent.json', {'operationSha256': m.OP_SHA}),
                            ('boot-restore-intent.json', self.op['boot']), ('inverse-drained.json', {'native': old.native()})]: self.sdk.save(self.ancestor / name, value)
        removed = self.hold / 'removed-overlay'; removed.write_bytes(self.r.drop_bytes())
        record = {'identity': self.sdk.identity(removed), 'sha256': m.sha(removed.read_bytes())}
        self.sdk.save(self.ancestor / 'overlay-prepared.json', record); self.sdk.save(self.ancestor / 'remove-overlay-intent.json', record)

    def tearDown(self): self.temp.cleanup()
    def actor(self, name, terminal=False):
        return copy.deepcopy(self.source if name == self.r.SOURCE else self.fresh if name == self.r.FRESH else self.api)
    def manager(self, verb):
        self.calls.append(verb); self.assertEqual(verb, 'start')
        self.source = copy.deepcopy(self.original); self.source['unit'].update(InvocationID='new-five', ExecMainStartTimestampMonotonic='101')
        self.source['parent']['pid'] = 999999998; self.source['parent']['startTicks'] = 2; self.source['processes'] = [self.source['parent']]
        self.native['clock'] += 1; self.native['app'].update(is_locked=1, heartbeat_at=self.native['clock'])
        if self.lost: raise RuntimeError('synthetic_lost_start_ACK')
    def command(self, argv, body=None, **kwargs):
        if argv[0] == '/usr/bin/busctl':
            return json.dumps({'type': 'a(ssbt)', 'data': [[v, k, False, 0] for k, v in list(self.paths.items())[:3]]}).encode()
        if 'namespace' in argv:
            out = {}
            for inside, backing in self.paths.items():
                s = Path(backing).stat(); out[inside] = {'device': s.st_dev, 'inode': s.st_ino, 'uid': s.st_uid, 'gid': s.st_gid, 'kind': stat.S_IFMT(s.st_mode)}
            if self.bad_mount: next(iter(out.values()))['inode'] += 1
            return json.dumps(out).encode()
        self.assertIn('public', argv)
        return json.dumps({'presentKeysMatch': not self.bad_public, 'environmentSha256': 'env'}).encode()
    def snapshot_old(self): return {str(p): p.read_bytes() for p in self.ancestor.iterdir()}
    def start(self): return self.owner.start(self.owner.review()['reviewHash'])

    def test_only_After_order_is_normalized(self):
        before = self.owner.preserved(); self.fresh['unit']['After'] = 'z.service a.service'; self.api['unit']['After'] = 'z.service a.service'
        self.assertEqual(self.owner.preserved(), before)
        self.fresh['identity'] = 'foreign'
        with self.assertRaisesRegex(RuntimeError, 'only_peer_After'): self.owner.preserved()
    def test_changed_or_duplicate_dependency_refuses(self):
        for value in ['a.service foreign.service', 'a.service a.service', ' a.service z.service']:
            self.fresh['unit']['After'] = value
            with self.subTest(value=value), self.assertRaises(RuntimeError): self.owner.preserved()
    def test_default_review_is_readonly_and_ancestor_receipts_unchanged(self):
        before = self.snapshot_old(); self.owner.review()
        self.assertEqual(self.snapshot_old(), before); self.assertFalse(self.base.exists()); self.assertNotIn('start', self.calls)
    def test_one_start_own_producer_ACK_and_no_old_receipt_writes(self):
        before = self.snapshot_old(); value = self.start(); self.assertFalse(value['acknowledged'])
        self.assertEqual(self.calls.count('start'), 1); result = self.owner.finish()
        self.assertTrue(result['restored']); self.assertFalse(result['prior47abInverseResultClaimed'])
        self.assertEqual(result['operatorSha256'], self.owner.producer()); self.assertEqual(result['poolMaximum'], 5)
        self.assertEqual(self.snapshot_old(), before)
        with self.assertRaises(RuntimeError): self.start()
        self.assertEqual(self.calls.count('start'), 1)
    def test_lost_start_ACK_finishes_without_repeat(self):
        self.lost = True
        with self.assertRaisesRegex(RuntimeError, 'lost_start_ACK'): self.start()
        self.owner.finish(); self.assertEqual(self.calls.count('start'), 1)
    def test_heartbeat_must_be_new_not_old_fresh_lock(self):
        self.start(); self.native['app']['heartbeat_at'] = 0
        with self.assertRaisesRegex(RuntimeError, 'actual_new_source_epoch'): self.owner.finish()
        self.assertFalse((self.base / 'result.json').exists())
    def test_positive_new_backend_required(self):
        self.start(); self.backend_count = 0
        with self.assertRaisesRegex(RuntimeError, 'positive_kernel'): self.owner.finish()
    def test_all_six_mounts_and_public_context_required(self):
        self.start(); self.bad_mount = True
        with self.assertRaisesRegex(RuntimeError, 'six_mounts'): self.owner.finish()
        self.bad_mount = False; self.bad_public = True
        with self.assertRaisesRegex(RuntimeError, 'six_mounts'): self.owner.finish()
    def test_original_boot_inode_and_overlay_bytes_are_preserved(self):
        self.boot.unlink(); self.boot.symlink_to('/foreign')
        with self.assertRaises(RuntimeError): self.owner.review()
    def test_safe_floor_rewind_refuses(self):
        self.start(); self.native['checkpoints']['56']['safe'] = str(199).zfill(75)
        with self.assertRaisesRegex(RuntimeError, 'recovery_floor'): self.owner.finish()
    def test_foreign_source_before_start_fails_postintent_CAS(self):
        save = self.owner.put
        def put(name, value):
            save(name, value)
            if name == 'start-intent.json': self.source = copy.deepcopy(self.original)
        self.owner.put = put
        with self.assertRaisesRegex(RuntimeError, 'terminal'): self.start()
        self.assertNotIn('start', self.calls)
    def test_source_appearing_during_final_peer_observation_prevents_start(self):
        preserved = self.owner.preserved; count = 0
        def race():
            nonlocal count
            value = preserved(); count += 1
            if count == 3: self.source = copy.deepcopy(self.original)
            return value
        self.owner.preserved = race
        with self.assertRaisesRegex(RuntimeError, 'final_terminal_CAS'): self.start()
        self.assertNotIn('start', self.calls)
    def test_current_leaf_preserves_new_ACK_floor_above_original_floor(self):
        self.start(); self.native['checkpoints']['56'].update(latest=str(500).zfill(75), safe=str(400).zfill(75), finalized=str(300).zfill(75))
        self.owner.finish(); pin = m.sha((self.base / 'result.json').read_bytes())
        self.native['checkpoints']['56']['safe'] = str(399).zfill(75)
        with patch.object(m, 'load', return_value=(self.r, self.sdk, self.h, self.op)), self.assertRaisesRegex(RuntimeError, 'recovery_floor'):
            m.validate_source_current(pin)


if __name__ == '__main__': unittest.main(verbosity=2)
