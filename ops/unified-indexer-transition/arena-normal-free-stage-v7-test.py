#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('arena_stage', HERE / 'arena-normal-free-stage-v7.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
ARCHIVE = Path('/tmp/yunipals-arena-normal-free-launch-v7-20261022.tar.gz')


class Tests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='.arena-stage-test-', dir=HERE)
        self.addCleanup(self.directory.cleanup)
        self.ops = Path(self.directory.name)
        for name in M.DEPENDENCIES:
            shutil.copyfile(HERE / name, self.ops / name)

    def test_default_review_does_not_stage_or_execute(self):
        result = M.execute(ARCHIVE, ops=self.ops)
        self.assertFalse(result['staged'])
        self.assertEqual(result['created'], [])
        self.assertEqual(result['providerRequests'], 0)
        self.assertTrue(all(not (self.ops / name).exists() for name in M.PINS))

    def test_exact_stage_and_repeated_stage_preserve_existing_inode(self):
        result = M.execute(ARCHIVE, True, self.ops)
        self.assertEqual(set(result['created']), set(M.PINS))
        before = {name: (self.ops / name).stat().st_ino for name in M.PINS}
        again = M.execute(ARCHIVE, True, self.ops)
        self.assertEqual(again['created'], [])
        self.assertEqual(before, {name: (self.ops / name).stat().st_ino for name in M.PINS})
        for name, pin in M.PINS.items():
            self.assertEqual(M.sha((self.ops / name).read_bytes()), pin)
            self.assertEqual((self.ops / name).stat().st_mode & 0o777, 0o644)

    def test_foreign_second_target_refused_before_any_write(self):
        names = list(M.PINS)
        (self.ops / names[1]).write_text('foreign')
        with self.assertRaisesRegex(RuntimeError, 'no_overwrite'):
            M.execute(ARCHIVE, True, self.ops)
        self.assertFalse((self.ops / names[0]).exists())
        self.assertEqual((self.ops / names[1]).read_text(), 'foreign')

    def test_symlink_target_refused(self):
        name = next(iter(M.PINS))
        (self.ops / name).symlink_to(HERE / name)
        with self.assertRaises(OSError):
            M.execute(ARCHIVE, True, self.ops)

    def test_changed_original_dependency_refused(self):
        (self.ops / next(iter(M.DEPENDENCIES))).write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'dependency_changed'):
            M.execute(ARCHIVE, True, self.ops)

    def test_changed_archive_refused(self):
        archive = self.ops / 'changed.tar.gz'
        archive.write_bytes(ARCHIVE.read_bytes() + b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'reviewed_public_archive'):
            M.execute(archive, True, self.ops)


if __name__ == '__main__':
    unittest.main()
