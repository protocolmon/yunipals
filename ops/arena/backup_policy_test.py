import datetime
import json
from pathlib import Path
import tempfile
import unittest

from backup_monitor import check
from backup_policy import atomic_json, dump_tables, expired_snapshots, valid_prune_files

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 15, 13, 0, tzinfo=UTC)


class BackupPolicyTest(unittest.TestCase):
    def test_restore_inventory_tracks_schema_changes_from_dump(self):
        names = ['deployment', 'tournament', 'submission', 'provider_task', 'frozen_input', 'identity_job', 'client_transaction']
        listing = '\n'.join(f'{i}; 1259 {100+i} TABLE yunipals_arena {name} owner' for i, name in enumerate(names))
        self.assertEqual(dump_tables(listing), sorted(names))
        with self.assertRaises(AssertionError):
            dump_tables(listing + '\n1; 1259 999 TABLE yunipals_arena tournament owner')
        with self.assertRaises(AssertionError):
            dump_tables('1; 1259 12 TABLE yunipals_arena deployment owner')

    def test_retention_boundary(self):
        self.assertEqual(expired_snapshots(['20260915T125959Z', '20260915T130000Z', '20261015T130000Z'], NOW),
                         ['20260915T125959Z'])

    def test_unknown_or_traversal_entries_prevent_pruning(self):
        for name in ['../production', 'objects', '20260914T120000Z/file', '20260931T130000Z']:
            with self.assertRaises((AssertionError, ValueError)):
                expired_snapshots(['20260901T120000Z', name], NOW)

    def test_only_owned_snapshot_files_can_be_pruned(self):
        self.assertTrue(valid_prune_files(['data.tar.gz.gpg', 'complete.json.gpg', 'restore-drill.dump.gpg.part']))
        for name in ['keys', '../data.tar.gz.gpg', '.unexpected', 'somebody-elses-backup.gpg']:
            self.assertFalse(valid_prune_files(['data.tar.gz.gpg', name]))

    def test_health_failure_and_recovery(self):
        with tempfile.TemporaryDirectory() as location:
            state = Path(location)
            self.assertEqual(check(state, NOW)['status'], 'needs-attention')
            fresh = {'createdAt': NOW.isoformat(), 'status': 'success'}
            for name in ['latest-success.json', 'latest-restore-drill.json', 'latest-attempt.json']:
                atomic_json(state / name, fresh)
            self.assertEqual(check(state, NOW)['status'], 'healthy')
            atomic_json(state / 'latest-attempt.json', {'status': 'failed'})
            self.assertEqual(check(state, NOW)['status'], 'needs-attention')
            atomic_json(state / 'latest-attempt.json', fresh)
            self.assertEqual(check(state, NOW)['status'], 'healthy')
            self.assertEqual((state / 'latest-attempt.json').stat().st_mode & 0o777, 0o600)

    def test_stale_backup_and_stale_drill(self):
        with tempfile.TemporaryDirectory() as location:
            state = Path(location)
            atomic_json(state / 'latest-success.json', {'createdAt': NOW.isoformat()})
            atomic_json(state / 'latest-restore-drill.json', {'createdAt': NOW.isoformat()})
            self.assertEqual(check(state, NOW + datetime.timedelta(minutes=90))['status'], 'healthy')
            self.assertEqual(check(state, NOW + datetime.timedelta(minutes=91))['status'], 'needs-attention')
            atomic_json(state / 'latest-restore-drill.json', {'createdAt': (NOW - datetime.timedelta(days=10)).isoformat()})
            self.assertEqual(check(state, NOW)['reasons'], ['Restore drill is older than nine days or its clock is invalid'])


if __name__ == '__main__':
    unittest.main()
