import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("ypal-ordinary-provenance-completion-v2.py")
spec = importlib.util.spec_from_file_location("completion", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def environment(self, root, proof=None, actor=None):
        base = root / "original"
        base.mkdir()
        journal = root / "completion"
        binding = {"nativeActor": {"pid": "123"}, "boot": {"inode": 1},
                   "operatorSha256": "producer", "query": {"readOnly": True},
                   "officialResult": {"event": "base_metadata_native-provenance", "stamped": 0}}
        proof = proof or {"publishedRows": 440194, "canonicalRows": 440194,
                          "allPublishedCanonical": True, "probe": True}

        def save(path, value):
            raw = m.encoded(value)
            with path.open("xb") as out:
                out.write(raw)
            return hashlib.sha256(raw).hexdigest()

        h = types.SimpleNamespace(
            s=types.SimpleNamespace(save=save, sync=lambda path: None),
            publication_proof=lambda: proof, refresh=lambda: None,
            actor=lambda op, native: actor or binding["nativeActor"],
            database=lambda: {"remainingPublished": 0, "probe": True}
        )
        n = types.SimpleNamespace(BASE=base, BOOT=root / "boot", link=lambda path: binding["boot"])
        return n, h, binding, journal

    def test_new_receipt_retains_original_ack_and_records_separate_producer(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, binding, journal = self.environment(Path(folder))
            with patch.object(m, "BASE", journal):
                result = m.complete(n, h, {}, None, binding, m.sha(m.encoded(binding)))
            observed = json.loads((n.BASE / "provenance-2-observed.json").read_bytes())
            self.assertTrue(result["completed"])
            self.assertEqual(observed["officialResult"]["stamped"], 0)
            self.assertFalse(observed["officialCommandResent"])
            self.assertFalse(observed["originalPhaseCliAcknowledgementClaimed"])
            self.assertEqual(observed["completionOperatorSha256"], "producer")
            self.assertEqual(result["databaseWrites"], 0)
            self.assertEqual(result["serviceActions"], 0)
            self.assertEqual(result["observedReceiptSha256"], m.sha((n.BASE / "provenance-2-observed.json").read_bytes()))

    def test_failed_comparison_never_creates_observed_success(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, binding, journal = self.environment(Path(folder), {"allPublishedCanonical": False})
            with patch.object(m, "BASE", journal):
                self.assertRaises(RuntimeError, m.complete, n, h, {}, None, binding, m.sha(m.encoded(binding)))
            self.assertTrue((journal / "intent.json").exists())
            self.assertFalse((journal / "result.json").exists())
            self.assertFalse((n.BASE / "provenance-2-observed.json").exists())

    def test_changed_actor_after_comparison_never_records_success(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, binding, journal = self.environment(Path(folder), actor={"pid": "456"})
            with patch.object(m, "BASE", journal):
                self.assertRaises(RuntimeError, m.complete, n, h, {}, None, binding, m.sha(m.encoded(binding)))
            self.assertFalse((n.BASE / "provenance-2-observed.json").exists())

    def test_unknown_attempt_is_not_replayed_and_existing_receipts_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, binding, journal = self.environment(Path(folder))
            journal.mkdir()
            (journal / "intent.json").write_text("preserve")
            with patch.object(m, "BASE", journal):
                self.assertRaises(RuntimeError, m.complete, n, h, {}, None, binding, m.sha(m.encoded(binding)))
            self.assertEqual((journal / "intent.json").read_text(), "preserve")
            self.assertFalse((n.BASE / "provenance-2-observed.json").exists())

    def test_changed_review_stops_before_journal_creation(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, binding, journal = self.environment(Path(folder))
            with patch.object(m, "BASE", journal):
                self.assertRaises(RuntimeError, m.complete, n, h, {}, None, binding, "stale")
            self.assertFalse(journal.exists())


if __name__ == "__main__":
    unittest.main()
