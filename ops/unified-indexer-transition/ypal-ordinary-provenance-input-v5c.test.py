"""Genuine prior() and real exclusive FS, with synthetic receipt facts only."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(path):
    spec = importlib.util.spec_from_file_location(Path(path).stem.replace('-', '_'), path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load(HERE / 'ypal-ordinary-provenance-input-v5c.py')


class Fixture:
    def __init__(self, test):
        tmp = tempfile.TemporaryDirectory()
        test.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.meta, self.complete = self.root / 'metadata', self.root / 'completion'
        self.meta.mkdir(mode=0o700)
        self.complete.mkdir(mode=0o700)
        self.r = load(HERE / m.RUNNER.name)
        self.r.INPUT = self.root / 'new-v5c/input.json'
        self.r.OPERATION_SHA = self.save(self.meta / 'operation.json', {'actual': 'operation'})
        selected = self.save(self.meta / 'selected.json', {'actual': 'selected'})
        self.save(self.complete / 'result.json', {'format': 'yunipals-ypal-ordinary-metadata-selection-reconcile-v1',
            'operatorSha256': self.r.COMPLETION_SHA, 'completed': True, 'originalOperationSha256': self.r.OPERATION_SHA,
            'actualSelectedReceiptSha256': selected, 'parent9aSuccessClaimed': False})
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.ack(0)
        for patcher in [patch.object(m, 'METADATA', self.meta), patch.object(m, 'COMPLETION', self.complete),
                        patch.object(m, 'protected', self.protected)]:
            patcher.start()
            test.addCleanup(patcher.stop)

    def save(self, path, value):
        raw = m.encoded(value)
        path.write_bytes(raw)
        path.chmod(0o600)
        return m.sha(raw)

    def protected(self, path, digest=None):
        self_row = path.lstat()
        m.need(not path.is_symlink() and self_row.st_nlink == 1, 'fixture_regular_owned_receipt_required')
        raw = path.read_bytes()
        m.need(digest is None or m.sha(raw) == digest, 'fixture_actual_receipt_hash_required')
        return raw

    def ack(self, index):
        prefix = 'provenance-' + str(index)
        result = {'event': 'base_metadata_native-provenance', 'stamped': 5000}
        self.save(self.meta / (prefix + '-intent.json'), {'command': 'native-provenance', 'bootId': self.boot})
        self.save(self.meta / (prefix + '-result.json'), result)
        self.save(self.meta / (prefix + '-child.json'), {'pid': 2000000000, 'startTicks': 10, 'bootId': self.boot})
        return self.save(self.meta / (prefix + '-observed.json'), {'officialResult': result, 'remainingPublished': 333474 - index * 5000,
            'completeForCurrentPublishedArchiveBase': False, 'publicationProof': None, 'unmatchedRowsNotDeletedOrManufactured': True})


class Controls(unittest.TestCase):
    def test_exact_runner_source_default_inert(self):
        self.assertEqual(m.sha((HERE / m.RUNNER.name).read_bytes()), m.RUNNER_SHA)
        import subprocess
        v = subprocess.run(['/usr/bin/python3', '-I', '-B', m.__file__], capture_output=True, check=True)
        self.assertTrue(json.loads(v.stdout)['staticOnly'])

    def test_latest_contiguous_receipt_determines_first_index_and_remaining_limit(self):
        f = Fixture(self)
        first = m.capture(f.r, 127, 3600)
        self.assertEqual((first['input']['firstIndex'], first['input']['maxBatches']), (1, 127))
        f.ack(1)
        second = m.capture(f.r, 127, 3600)
        self.assertEqual((second['input']['firstIndex'], second['input']['maxBatches']), (2, 126))
        self.assertEqual(len(second['prior']), 2)
        self.assertFalse(second['original97b6RunClaimed'])

    def test_inflight_unknown_or_noncontiguous_next_prefix_refuses(self):
        for name in ['provenance-1-intent.json', 'provenance-1-child.json', 'provenance-2-observed.json']:
            f = Fixture(self)
            f.save(f.meta / name, {'unknown': True})
            self.assertRaises(RuntimeError, m.capture, f.r, 127, 3600)

    def test_busy_zero_complete_or_wrong_original_result_refuses(self):
        for mode in ['busy', 'zero', 'complete', 'result']:
            f = Fixture(self)
            path = f.meta / 'provenance-0-observed.json'
            value = json.loads(path.read_bytes())
            if mode == 'busy': value['busy'] = True
            if mode == 'zero':
                value['officialResult']['stamped'] = 0
                f.save(f.meta / 'provenance-0-result.json', value['officialResult'])
            if mode == 'complete': value['completeForCurrentPublishedArchiveBase'] = True
            if mode == 'result': value['officialResult']['stamped'] = 1
            f.save(path, value)
            self.assertRaises(RuntimeError, m.capture, f.r, 127, 3600)

    def test_live_original_child_refuses_actual_PID_epoch(self):
        f = Fixture(self)
        raw = Path('/proc/self/stat').read_bytes()
        f.save(f.meta / 'provenance-0-child.json', {'pid': os.getpid(), 'startTicks': int(raw[raw.rfind(b')') + 2:].split()[19]), 'bootId': f.boot})
        self.assertRaises(RuntimeError, m.capture, f.r, 127, 3600)

    def test_fresh_input_is_root600_no_prior_namespace_overwrite(self):
        f = Fixture(self)
        old = f.root / 'unused-v5b-input.json'
        old.write_bytes(b'107-unused-preserved')
        inode = old.stat().st_ino
        binding = m.capture(f.r, 127, 3600)
        digest, _ = m.write(f.r, m.sha(m.encoded(binding)), 127, 3600)
        self.assertEqual(digest, m.sha(f.r.INPUT.read_bytes()))
        self.assertEqual(f.r.INPUT.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(f.r.INPUT.read_bytes())['firstIndex'], 1)
        self.assertEqual(old.read_bytes(), b'107-unused-preserved')
        self.assertEqual(old.stat().st_ino, inode)
        self.assertRaises(RuntimeError, m.write, f.r, m.sha(m.encoded(binding)), 127, 3600)

    def test_new_ack_after_review_invalidates_old_input_hash_before_writes(self):
        f = Fixture(self)
        binding = m.capture(f.r, 127, 3600)
        f.ack(1)
        self.assertRaises(RuntimeError, m.write, f.r, m.sha(m.encoded(binding)), 127, 3600)
        self.assertFalse(f.r.INPUT.parent.exists())

    def test_same_metadata_lock_and_changed_a25_receipt_refuse(self):
        f = Fixture(self)
        with patch.object(m, 'LOCK', f.root / 'metadata.lock'), m.lock():
            with self.assertRaises(BlockingIOError):
                with m.lock():
                    self.fail('second executor acquired lock')
        value = json.loads((f.complete / 'result.json').read_bytes())
        value['parent9aSuccessClaimed'] = True
        f.save(f.complete / 'result.json', value)
        self.assertRaises(RuntimeError, m.capture, f.r, 127, 3600)


if __name__ == '__main__':
    unittest.main()
