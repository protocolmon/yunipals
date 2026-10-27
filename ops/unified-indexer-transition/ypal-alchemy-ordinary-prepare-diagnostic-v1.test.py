import importlib.util
from pathlib import Path
import types
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("readonly_diagnostic", Path(__file__).with_name("ypal-alchemy-ordinary-prepare-diagnostic-v1.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def owner(self):
        calls = []
        value = types.SimpleNamespace(financial_current=lambda: calls.append("financial"),
            terminal=lambda *args: calls.append("terminal"), peers=lambda: {"frame": 1},
            old=types.SimpleNamespace(owner=types.SimpleNamespace(known_source_processes=lambda: []),
                h=types.SimpleNamespace(free_route=lambda chain: {"chain": chain})), p=types.SimpleNamespace(CHAINS=("ethereum", "base", "polygon", "bnb")))
        return value, calls

    def test_runs_only_readonly_explicit_methods(self):
        owner, calls = self.owner()
        with patch.object(m, "source_terminal", lambda _: calls.append("terminal")): proof = m.diagnose(owner)
        self.assertTrue(proof["allReadOnlyPhasesPassed"]); self.assertEqual(calls, ["financial", "terminal", "financial"])
        self.assertEqual(proof["filesystemWrites"], 0); self.assertFalse(proof["historicalPrepareFailureReclassified"])

    def test_records_exact_refusal_and_does_not_continue(self):
        owner, calls = self.owner()
        def fail(*args): raise RuntimeError("all_required_backends_need_unique_positive_stable_kernel_attribution")
        with patch.object(m, "source_terminal", fail): proof = m.diagnose(owner)
        self.assertFalse(proof["allReadOnlyPhasesPassed"]); self.assertEqual(len(proof["phases"]), 2)
        self.assertEqual(proof["phases"][-1]["fixedCode"], "all_required_backends_need_unique_positive_stable_kernel_attribution")
        self.assertEqual(calls, ["financial"])

    def test_does_not_export_arbitrary_private_error(self):
        owner, _ = self.owner()
        def fail(): raise RuntimeError("private value /secret/config")
        owner.financial_current = fail; proof = m.diagnose(owner)
        self.assertIsNone(proof["phases"][0]["fixedCode"]); self.assertNotIn("private value", str(proof))

    def test_refuses_changed_peer_snapshot(self):
        owner, _ = self.owner(); values = iter([{"frame": 1}, {"frame": 2}]); owner.peers = lambda: next(values)
        with patch.object(m, "source_terminal", lambda _: None): proof = m.diagnose(owner)
        self.assertEqual(proof["phases"][-1]["fixedCode"], "current_peer_frame_changed_between_readonly_observations")

    def test_guard_blocks_recursive_save_and_direct_filesystem_write(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "must-not-exist"
            source = "import importlib.util\ns=importlib.util.spec_from_file_location('d'," + repr(m.__file__) + ")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.mutation_guard()\n"
            source += "def save():\n return 1\nfor action in [save,lambda:open(" + repr(str(target)) + ",'w')]:\n try:action()\n except RuntimeError:pass\n else:raise AssertionError('mutation accepted')\nprint('blocked')\n"
            result = subprocess.run([sys.executable, "-I", "-B", "-c", source], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stdout.strip(), "blocked")
            self.assertFalse(target.exists())

    def test_guard_allows_real_subprocess_pipes_but_not_regular_file_FD(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "existing"; target.write_bytes(b"unchanged")
            source = "import importlib.util,os,subprocess\ns=importlib.util.spec_from_file_location('d'," + repr(m.__file__) + ")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nfd=os.open(" + repr(str(target)) + ",os.O_WRONLY)\nm.mutation_guard()\nr=subprocess.run(['/usr/bin/true'],input=b'',capture_output=True,timeout=5)\nassert r.returncode==0 and r.stdout==r.stderr==b''\ntry:open(fd,'w',closefd=False)\nexcept RuntimeError:pass\nelse:raise AssertionError('regular-file FD accepted')\nos.close(fd)\nprint('pipes-only')\n"
            result = subprocess.run([sys.executable, "-I", "-B", "-c", source], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr); self.assertEqual(result.stdout.strip(), "pipes-only")
            self.assertEqual(target.read_bytes(), b"unchanged")


if __name__ == "__main__": unittest.main()
