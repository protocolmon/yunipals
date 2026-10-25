import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load("ypal-ordinary-provenance-finish-v1.py")
p = load("ypal-ordinary-provenance-completion-v2.py")
fixtures = load("ypal-ordinary-provenance-completion-v2.test.py")


class Controls(unittest.TestCase):
    def test_actual_finish_writes_separate_producer_and_keeps_acknowledged_command(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, original, journal = fixtures.Controls().environment(Path(folder))
            binding = {"originalBinding": original, "parentIntentSha256": "retained-parent",
                       "operatorSha256": "new-finish-producer"}
            with patch.object(m, "BASE", journal):
                result = m.finish(p, n, h, {}, types.SimpleNamespace(), binding, p.sha(p.encoded(binding)))
            observed = json.loads((n.BASE / "provenance-2-observed.json").read_bytes())
            self.assertTrue(result["completed"])
            self.assertEqual(observed["officialResult"]["stamped"], 0)
            self.assertEqual(observed["completionOperatorSha256"], "new-finish-producer")
            self.assertFalse(observed["officialCommandResent"])
            self.assertFalse(observed["originalPhaseCliAcknowledgementClaimed"])
            self.assertEqual(observed["priorReadOnlyAttemptSha256"], "retained-parent")

    def test_comparison_failure_never_records_success_or_replays_command(self):
        with tempfile.TemporaryDirectory() as folder:
            n, h, original, journal = fixtures.Controls().environment(Path(folder), {"allPublishedCanonical": False})
            binding = {"originalBinding": original, "parentIntentSha256": "retained-parent", "operatorSha256": "new"}
            with patch.object(m, "BASE", journal):
                self.assertRaises(RuntimeError, m.finish, p, n, h, {}, types.SimpleNamespace(), binding, p.sha(p.encoded(binding)))
            self.assertTrue((journal / "intent.json").exists())
            self.assertFalse((journal / "result.json").exists())
            self.assertFalse((n.BASE / "provenance-2-observed.json").exists())

    def test_trace_preserves_arguments_status_and_both_private_streams(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            stored = {}
            class Process:
                returncode = 3
                pid = 123
                def communicate(self, payload, timeout):
                    self.received = payload, timeout
                    return b"count-only", b"retained-diagnostic"
            process = Process()
            h = types.SimpleNamespace(s=types.SimpleNamespace(save=lambda path, raw: stored.update({path.name: raw})))
            q = types.SimpleNamespace()
            with patch.object(m, "BASE", root), patch.object(m.subprocess, "Popen", return_value=process) as launch:
                m.attach_trace(p, h, q)
                child = q.subprocess.Popen(["actual-args"], cwd="/")
                self.assertEqual(child.communicate(b"actual-sql", timeout=80), (b"count-only", b"retained-diagnostic"))
                launch.assert_called_once_with(["actual-args"], cwd="/")
            self.assertEqual(process.received, (b"actual-sql", 80))
            self.assertEqual(child.returncode, 3)
            self.assertEqual(stored, {"publication.stdout.private": b"count-only", "publication.stderr.private": b"retained-diagnostic"})


if __name__ == "__main__":
    unittest.main()
