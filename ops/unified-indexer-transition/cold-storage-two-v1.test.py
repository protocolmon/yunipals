"""Synthetic local filesystem only; never opens production plans or archives."""
from pathlib import Path
import copy
import importlib.util
import json
import os
import tempfile
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).with_name('cold-storage-two-v1.py')
spec = importlib.util.spec_from_file_location('cold_storage_two', HERE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ColdStorage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/tmp')
        self.root = Path(self.tmp.name)
        self.backups = self.root / 'backups'
        self.volume = self.root / 'volume'
        self.backups.mkdir(mode=0o700)
        self.volume.mkdir(mode=0o700)
        (self.volume / 'yunipals-cold-backups').mkdir(mode=0o700)
        self.patches = [patch.object(m, 'BACKUPS', self.backups),
                        patch.object(m, 'BASE', self.backups / 'operation'),
                        patch.object(m, 'directory', lambda p: m.signature(p)),
                        patch.object(m, 'free', lambda *a, **k: {'root': 100_000_000_000, 'volume': 100_000_000_000}),
                        patch.object(m, 'no_open_files')]
        for p in self.patches:
            p.start()
        paths = {'cutover': 'yunipals-indexer-cutover-20260928T123456Z/database.dump',
                 'premerge': 'yunipals-indexer-premerge-20260928TABC123/offhost-database/encrypted/database.dump.gpg'}
        files = {}
        for key, path in paths.items():
            p = self.backups / path
            p.parent.mkdir(parents=True, mode=0o700)
            p.write_bytes((key.encode() + b' synthetic fixture bytes\n') * 100)
            p.chmod(0o600)
            parents = {str(x): {k: m.signature(x)[k] for k in ('dev', 'inode', 'uid', 'gid', 'mode')}
                       for x in [*reversed(p.parent.parents), p.parent]}
            files[key] = dict(source=str(p), identity=m.signature(p), sha256=m.sha(p.read_bytes()), parents=parents)
        self.plan = {'format': m.FORMAT + '-plan', 'volume': str(self.volume), 'rootDevice': 1,
                     'volumeDevice': 2, 'coldParent': {}, 'files': files}
        self.pin = m.sha(m.encoded(self.plan))

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def review_copy(self):
        reviewed = m.review(self.plan, self.pin)
        copied = m.copy_phase(self.plan, self.pin, m.sha(m.encoded(reviewed)))
        return copied

    def reclaim(self):
        return m.reclaim_phase(self.plan, self.pin, self.review_copy())

    def test_complete_copy_reclaim_inverse_keeps_every_byte(self):
        self.reclaim()
        state = m.reconcile(self.plan, self.pin)
        self.assertTrue(all(r['state'] == 'owned_alias' for r in state['files'].values()))
        for key, row in self.plan['files'].items():
            self.assertTrue(Path(row['source']).is_symlink())
            self.assertEqual(m.sha(Path(row['source']).read_bytes()), row['sha256'])
            self.assertEqual(m.regular(m.target(self.plan, key))['mode'], 0o600)
        m.inverse_phase(self.plan, self.pin, m.sha(m.encoded(state)))
        state = m.reconcile(self.plan, self.pin)
        self.assertTrue(all(r['state'] == 'owned_restored' for r in state['files'].values()))
        for key, row in self.plan['files'].items():
            self.assertFalse(Path(row['source']).is_symlink())
            self.assertEqual(m.sha(Path(row['source']).read_bytes()), row['sha256'])
            self.assertTrue(m.target(self.plan, key).exists())

    def test_review_does_not_create_operation_or_target(self):
        m.review(self.plan, self.pin)
        self.assertFalse(m.BASE.exists())
        self.assertEqual(list((self.volume / 'yunipals-cold-backups').iterdir()), [])

    def test_foreign_destination_refuses_before_operation(self):
        m.target(self.plan, 'cutover').parent.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'new_destination'):
            m.review(self.plan, self.pin)
        self.assertFalse(m.BASE.exists())

    def test_source_same_size_content_change_refuses(self):
        p = Path(self.plan['files']['cutover']['source'])
        p.write_bytes(b'X' * p.stat().st_size)
        with self.assertRaisesRegex(RuntimeError, 'original_identity|complete_stable_payload_hash'):
            m.review(self.plan, self.pin)

    def test_stale_review_cannot_create_operation(self):
        with self.assertRaisesRegex(RuntimeError, 'fresh_review_hash'):
            m.copy_phase(self.plan, self.pin, '0' * 64)
        self.assertFalse(m.BASE.exists())

    def test_partial_copy_preserved_and_readonly_reconcile(self):
        def interrupt(source, dest, row, plan):
            dest.write_bytes(b'partial')
            dest.chmod(0o600)
            raise RuntimeError('synthetic_interruption')
        with patch.object(m, 'copy_file', interrupt):
            with self.assertRaisesRegex(RuntimeError, 'synthetic_interruption'):
                self.review_copy()
        before = {str(p): p.read_bytes() for p in m.BASE.iterdir()}
        state = m.reconcile(self.plan, self.pin)
        self.assertTrue(state['files']['cutover']['partialCopyPresent'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in m.BASE.iterdir()})
        with self.assertRaisesRegex(RuntimeError, 'new_operation'):
            m.copy_phase(self.plan, self.pin, '0' * 64)
        self.assertEqual(m.target(self.plan, 'cutover').read_bytes(), b'partial')

    def test_copy_hash_drift_blocks_reclaim_before_intent(self):
        copied = self.review_copy()
        p = m.target(self.plan, 'cutover')
        p.write_bytes(b'X' * p.stat().st_size)
        with self.assertRaisesRegex(RuntimeError, 'complete_stable_payload_hash'):
            m.reclaim_phase(self.plan, self.pin, copied)
        self.assertFalse((m.BASE / 'reclaim-intent.json').exists())
        self.assertFalse(Path(self.plan['files']['cutover']['source']).is_symlink())

    def test_lost_copy_ack_reconciliation_never_repeats_copy(self):
        original = m.write_receipt
        def lost(name, value):
            if name == 'copy-result.json':
                raise RuntimeError('synthetic_lost_ack')
            return original(name, value)
        with patch.object(m, 'write_receipt', lost):
            with self.assertRaisesRegex(RuntimeError, 'synthetic_lost_ack'):
                self.review_copy()
        state = m.reconcile(self.plan, self.pin)
        self.assertTrue(all(r['copy'] and r['state'] == 'original' for r in state['files'].values()))
        self.assertFalse((m.BASE / 'copy-result.json').exists())

    def test_lost_alias_ack_recognizes_owned_inode_without_retry(self):
        copied = self.review_copy()
        original = m.write_receipt
        def lost(name, value):
            if name == 'aliased-cutover.json':
                raise RuntimeError('synthetic_lost_ack')
            return original(name, value)
        with patch.object(m, 'write_receipt', lost):
            with self.assertRaisesRegex(RuntimeError, 'synthetic_lost_ack'):
                m.reclaim_phase(self.plan, self.pin, copied)
        state = m.reconcile(self.plan, self.pin)
        self.assertEqual(state['files']['cutover']['state'], 'owned_alias')
        self.assertEqual(state['files']['premerge']['state'], 'original')
        with self.assertRaisesRegex(RuntimeError, 'single_reclaim_attempt'):
            m.reclaim_phase(self.plan, self.pin, copied)

    def test_foreign_same_target_symlink_is_not_owned(self):
        self.reclaim()
        p = Path(self.plan['files']['cutover']['source'])
        old = p.with_name('held-old-link')
        p.rename(old)
        p.symlink_to(m.target(self.plan, 'cutover'))
        with self.assertRaisesRegex(RuntimeError, 'alias_inode_identity'):
            m.reconcile(self.plan, self.pin)

    def test_space_gate_precedes_inverse_intent(self):
        self.reclaim()
        state = m.reconcile(self.plan, self.pin)
        with patch.object(m, 'free', side_effect=RuntimeError('root_reserve_required')):
            with self.assertRaisesRegex(RuntimeError, 'root_reserve'):
                m.inverse_phase(self.plan, self.pin, m.sha(m.encoded(state)))
        self.assertFalse((m.BASE / 'inverse-intent.json').exists())

    def test_lost_inverse_ack_still_recognizes_restored_owned_file(self):
        self.reclaim()
        state = m.reconcile(self.plan, self.pin)
        original = m.write_receipt
        def lost(name, value):
            if name == 'restored-cutover.json':
                raise RuntimeError('synthetic_lost_ack')
            return original(name, value)
        with patch.object(m, 'write_receipt', lost):
            with self.assertRaisesRegex(RuntimeError, 'synthetic_lost_ack'):
                m.inverse_phase(self.plan, self.pin, m.sha(m.encoded(state)))
        state = m.reconcile(self.plan, self.pin)
        self.assertEqual(state['files']['cutover']['state'], 'owned_restored')
        self.assertEqual(state['files']['premerge']['state'], 'owned_alias')

    def test_original_and_copy_fd_refs_checked_before_alias(self):
        self.reclaim()
        calls = m.no_open_files.call_args_list
        self.assertTrue(any(len(c.args[0]) == 4 for c in calls))
        self.assertTrue(any(len(c.args[0]) == 2 for c in calls))

    def test_parent_and_intent_fsync_before_alias_replace(self):
        copied = self.review_copy()
        events = []
        original_write, original_replace = m.write_receipt, os.replace
        def write(name, value):
            value = original_write(name, value)
            events.append(name)
            return value
        def replace(source, dest):
            self.assertIn('reclaim-intent.json', events)
            self.assertIn('alias-staged-cutover.json', events)
            original_replace(source, dest)
        with patch.object(m, 'write_receipt', write), patch.object(m.os, 'replace', replace):
            m.reclaim_phase(self.plan, self.pin, copied)


    def test_plan_allows_only_two_historical_database_payloads(self):
        plan = copy.deepcopy(self.plan)
        plan['volume'] = '/mnt/HC_Volume_123456'
        plan['coldParent'] = {'dev': 2, 'inode': 99, 'uid': 0, 'gid': 0, 'mode': 0o700}
        for row in plan['files'].values():
            row['identity']['dev'] = 1
        self.assertEqual(m.validate_plan(plan), plan)
        for changed in ['foreign_path', 'third_file', 'same_device', 'empty_ancestry']:
            bad = copy.deepcopy(plan)
            if changed == 'foreign_path':
                bad['files']['cutover']['source'] = str(self.backups / 'yunipals-unified-precutover-20261020/database.dump')
            elif changed == 'third_file':
                bad['files']['extra'] = bad['files']['cutover']
            elif changed == 'same_device':
                bad['volumeDevice'] = bad['rootDevice']
            else:
                bad['files']['cutover']['parents'] = {}
            with self.assertRaises(RuntimeError):
                m.validate_plan(bad)

    def test_foreign_alias_temporary_refuses_before_original_replacement(self):
        copied = self.review_copy()
        original = Path(self.plan['files']['cutover']['source'])
        temporary = original.parent / ('.' + original.name + '.cold-storage-two-v1-alias')
        def replace_temporary(identities):
            if len(identities) == 2 and temporary.is_symlink():
                temporary.rename(temporary.with_name('held-foreign-link'))
                temporary.symlink_to(m.target(self.plan, 'cutover'))
        with patch.object(m, 'no_open_files', replace_temporary):
            with self.assertRaisesRegex(RuntimeError, 'staged_alias_identity_changed'):
                m.reclaim_phase(self.plan, self.pin, copied)
        self.assertFalse(original.is_symlink())
        self.assertEqual(m.signature(original), self.plan['files']['cutover']['identity'])

    def test_actual_open_descriptor_is_refused(self):
        real_spec = importlib.util.spec_from_file_location('cold_real_fd', HERE)
        real = importlib.util.module_from_spec(real_spec)
        real_spec.loader.exec_module(real)
        source = Path(self.plan['files']['cutover']['source'])
        with source.open('rb'):
            with self.assertRaisesRegex(RuntimeError, 'payload_open_by_process'):
                real.no_open_files([m.signature(source)])

    def test_saved_receipt_plan_and_operator_tampering_refuse(self):
        self.review_copy()
        path = m.BASE / 'copy-intent.json'
        value = json.loads(path.read_text())
        value['planSha256'] = '0' * 64
        path.write_bytes(m.encoded(value))
        with self.assertRaisesRegex(RuntimeError, 'owned_copy_intent'):
            m.reconcile(self.plan, self.pin)
        value['operatorSha256'] = '0' * 64
        path.write_bytes(m.encoded(value))
        with self.assertRaisesRegex(RuntimeError, 'same_operator_receipt'):
            m.reconcile(self.plan, self.pin)


    def test_exact_sticky_system_lock_parent_is_allowed_only_there(self):
        with patch.object(m, 'LOCK', Path('/run/lock/synthetic-owner.lock')), patch.object(m, 'directory', return_value={}):
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o1777, st_uid=0, st_gid=0)):
                m.lock_directory()
            for uid, mode in [(1, 0o1777), (0, 0o777)]:
                with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=uid, st_gid=0)):
                    with self.assertRaisesRegex(RuntimeError, 'exact_sticky_system_lock'):
                        m.lock_directory()

    def test_real_private_lock_descriptor_is_bound_and_exclusive(self):
        with patch.object(m, 'LOCK', self.root / 'owner.lock'):
            fd = m.lock_operation(True)
            try:
                self.assertEqual(os.fstat(fd).st_ino, m.LOCK.lstat().st_ino)
                with self.assertRaises(BlockingIOError):
                    m.lock_operation(True)
            finally:
                os.close(fd)

    def test_readonly_reconcile_remains_available_below_free_space_gate(self):
        self.review_copy()
        with patch.object(m, 'free', side_effect=RuntimeError('root_reserve_required')):
            state = m.reconcile(self.plan, self.pin)
        self.assertTrue(state['readOnly'])


if __name__ == '__main__':
    unittest.main()
