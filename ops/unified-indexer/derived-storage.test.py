#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('derived_storage', Path(__file__).with_name('derived-storage.py'))
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


def catalog():
    rows = [{'oid': str(1000 + i), 'file': str(2000 + i), 'schema': schema,
             'name': name, 'kind': 'r', 'owner': '16388', 'acl': None,
             'tablespace': '0', 'bytes': '2800000000'}
            for i, (schema, name) in enumerate((s, n) for s, names in storage.TABLES.items() for n in names)]
    return {'databaseOid': '17584', 'port': '5432', 'cluster': '16/main',
            'tableCount': 14, 'relations': rows, 'existingTablespace': None,
            'pointer': {'current_id': 103}, 'sourceLayout': 'source-hash',
            'generationState': [{'id': i, 'state': 'ready'} for i in (103, 105, 107)],
            'nextGenerationBytes': '10000000000', 'snapshotInputBytes': '6000000000'}


class StorageAdmission(unittest.TestCase):
    def test_other_database_cluster_relation_and_existing_placement_are_refused(self):
        for mutate in [lambda v: v.update(databaseOid='999'),
                       lambda v: v.update(port='15438'),
                       lambda v: v.update(cluster='16/other'),
                       lambda v: v['relations'][0].update(schema='unified_ypal_20261023_v1'),
                       lambda v: v['relations'][0].update(tablespace='555'),
                       lambda v: v['relations'].pop(),
                       lambda v: v['pointer'].update(current_id=107)]:
            value = catalog()
            mutate(value)
            with self.assertRaises(RuntimeError):
                storage.validate_catalog(value)

    def test_capacity_counts_both_filesystems_and_existing_backup_reserve(self):
        def filesystem(path):
            return {'device': 1 if path == Path('/') else 2,
                    'freeBytes': 44_000_000_000 if path == Path('/') else 84_000_000_000}
        with patch.object(storage, 'catalog', side_effect=catalog), \
                patch.object(storage, 'filesystem', side_effect=filesystem), \
                patch.object(storage, 'mount', return_value={'uuid': 'fixed-volume'}), \
                patch.object(Path, 'exists', return_value=False):
            value = storage.plan()
            self.assertEqual(value['regularRefreshRequiredBytes'], 76_000_000_000)
            self.assertEqual(value['postMoveRootFreeEstimate'], 83_200_000_000)
            self.assertEqual(value['postMoveVolumeFreeEstimate'], 44_800_000_000)
            self.assertEqual(value['reserveBytesPerFilesystem'], 25_000_000_000)
            with patch.object(storage, 'filesystem', return_value={'device': 1, 'freeBytes': 60_000_000_000}):
                with self.assertRaisesRegex(RuntimeError, 'volume_must_cover'):
                    storage.plan()

    def test_changed_layout_or_snapshot_refuses_before_any_write(self):
        value = {'format': 'yunipals-derived-storage-v1', 'layoutSha256': 'old',
                 'mount': {}, 'observed': catalog()}
        current = {**value, 'layoutSha256': 'changed'}
        with patch.object(storage, 'plan', return_value=current), \
                patch.object(storage, 'sql') as sql, \
                patch.object(storage, 'save') as save:
            with self.assertRaisesRegex(RuntimeError, 'same_catalog'):
                storage.apply(value, Path('/tmp/unused'))
            sql.assert_not_called()
            save.assert_not_called()

    def test_running_collection_reader_refuses_before_any_write(self):
        value = {'format': 'yunipals-derived-storage-v1', 'layoutSha256': 'same',
                 'mount': {}, 'observed': catalog()}
        with patch.object(storage, 'plan', return_value=value), \
                patch.object(storage.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='active\n')), \
                patch.object(storage, 'sql') as sql, \
                patch.object(storage, 'save') as save:
            with self.assertRaisesRegex(RuntimeError, 'readers_must_remain_stopped'):
                storage.apply(value, Path('/tmp/unused'))
            sql.assert_not_called()
            save.assert_not_called()

    def test_ddl_identifiers_cannot_expand_the_reviewed_scope(self):
        for value in ['x.y', 'x;DROP TABLE t', '"source"', '123', 'a' * 64]:
            with self.assertRaises(RuntimeError):
                storage.identifier(value)


if __name__ == '__main__':
    unittest.main()
