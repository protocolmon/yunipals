"""Local children and exact pass-through objects; no application code executes."""
import ast
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().with_name("ypal-readonly-run-duration-v1.py")
spec = importlib.util.spec_from_file_location("readonly_run_duration_controls", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def fake_original(self, action):
        def run(*args, **kwargs):
            return action(args, kwargs)
        run.__module__ = "subprocess"
        return run

    def fixture(self, original):
        self.enterContext(patch.object(m, "_STDLIB_RUN", original))
        self.enterContext(patch.object(subprocess, "run", original))

    def test_real_child_keeps_input_environment_stdout_stderr_and_nonzero_result(self):
        original = subprocess.run
        env = {**os.environ, "READONLY_TIMER_PRIVATE_FIXTURE": "private-fixture-value"}
        code = "import os,sys;sys.stdout.buffer.write(sys.stdin.buffer.read()+os.environ['READONLY_TIMER_PRIVATE_FIXTURE'].encode());sys.stderr.write('original-stderr');sys.exit(7)"
        observer = m.RunDurations()
        with observer:
            value = subprocess.run([sys.executable, "-I", "-B", "-c", code], input=b"original-input:", env=env,
                capture_output=True, timeout=5, check=False)
        self.assertIs(subprocess.run, original)
        self.assertEqual((value.returncode, value.stdout, value.stderr), (7, b"original-input:private-fixture-value", b"original-stderr"))
        record = observer.snapshot()
        self.assertTrue(record["subprocessRunRestored"])
        self.assertEqual(len(record["calls"]), 1)
        row = record["calls"][0]
        self.assertEqual(row["outcome"], "returned")
        self.assertTrue(row["exactCompletedProcessReturned"])
        self.assertGreater(row["wallNanoseconds"], 0)
        self.assertGreaterEqual(row["parentCPUNanoseconds"], 0)
        self.assertFalse(row["outcomeQualified"])
        text = json.dumps(record)
        for private in ["original-input", "private-fixture-value", "original-stderr", code]:
            self.assertNotIn(private, text)

    def test_arguments_keyword_values_and_unknown_return_object_are_identical(self):
        calls = []
        result = object()
        def action(args, kwargs):
            calls.append((args, kwargs))
            return result
        original = self.fake_original(action)
        self.fixture(original)
        argv = ["/usr/bin/busctl", "private-argument"]
        env = {"PRIVATE": object()}
        data = object()
        observer = m.RunDurations()
        with observer:
            self.assertIs(subprocess.run(argv, input=data, env=env, timeout=8, capture_output=True), result)
        args, kwargs = calls[0]
        self.assertIs(args[0], argv)
        self.assertIs(kwargs["input"], data)
        self.assertIs(kwargs["env"], env)
        self.assertEqual(kwargs["timeout"], 8)
        row = observer.snapshot()["calls"][0]
        self.assertEqual(row["commandKind"], "busctl")
        self.assertFalse(row["exactCompletedProcessReturned"])

    def test_original_exception_identity_is_preserved_and_run_restored(self):
        errors = [subprocess.TimeoutExpired(["private"], 8, output=b"private-out", stderr=b"private-err"),
            subprocess.CalledProcessError(2, ["private"], output=b"private-out"), PermissionError("private-error"),
            KeyboardInterrupt("cancel"), SystemExit(17)]
        for error in errors:
            def action(_args, _kwargs):
                raise error
            original = self.fake_original(action)
            with patch.object(m, "_STDLIB_RUN", original), patch.object(subprocess, "run", original):
                observer = m.RunDurations()
                with self.assertRaises(type(error)) as caught:
                    with observer:
                        subprocess.run(["/usr/bin/ss"], timeout=8)
                self.assertIs(caught.exception, error)
                self.assertIs(subprocess.run, original)
                row = observer.snapshot()["calls"][0]
                self.assertEqual(row["outcome"], "raised")
                self.assertEqual(row["errorClass"], type(error).__name__)
                self.assertFalse(row["outcomeQualified"])

    def test_real_timeout_child_preserves_standard_timeout_and_restores(self):
        original = subprocess.run
        observer = m.RunDurations()
        with self.assertRaises(subprocess.TimeoutExpired):
            with observer:
                subprocess.run([sys.executable, "-I", "-B", "-c", "import time;time.sleep(1)"], timeout=0.05, capture_output=True)
        self.assertIs(subprocess.run, original)
        self.assertEqual(observer.snapshot()["calls"][0]["errorClass"], "TimeoutExpired")

    def test_cap_drops_records_without_dropping_or_retrying_original_calls(self):
        calls = []
        result = object()
        original = self.fake_original(lambda args, kwargs: calls.append((args, kwargs)) or result)
        self.fixture(original)
        observer = m.RunDurations(maximum_calls=2)
        with observer:
            for _ in range(5):
                self.assertIs(subprocess.run(["/usr/bin/systemctl"]), result)
        record = observer.snapshot()
        self.assertEqual((len(calls), len(record["calls"]), record["droppedCalls"]), (5, 2, 3))
        self.assertEqual(record["bookkeepingErrors"], 0)

    def test_finite_clock_bookkeeping_refusals_cannot_replace_original_outcome(self):
        marker = object()
        original = self.fake_original(lambda *_: marker)
        self.fixture(original)
        for values in [[ValueError("start")], [1, ValueError("end")], [-1], [True]]:
            observer = m.RunDurations()
            with patch.object(m.time, "perf_counter_ns", side_effect=values), observer:
                self.assertIs(subprocess.run(["/usr/bin/ss"]), marker)
            self.assertGreater(observer.snapshot()["bookkeepingErrors"], 0)
        error = OSError("original")
        def fail(*_):
            raise error
        original = self.fake_original(fail)
        with patch.object(m, "_STDLIB_RUN", original), patch.object(subprocess, "run", original):
            observer = m.RunDurations()
            with self.assertRaises(OSError) as caught:
                with patch.object(m.time, "perf_counter_ns", side_effect=[1, ValueError("end")]), observer:
                    subprocess.run(["/usr/bin/ss"])
            self.assertIs(caught.exception, error)

    def test_external_deadline_or_cancellation_is_not_swallowed(self):
        error = RuntimeError("external-deadline")
        original = self.fake_original(lambda *_: object())
        self.fixture(original)
        observer = m.RunDurations()
        with self.assertRaises(RuntimeError) as caught:
            with patch.object(m.time, "perf_counter_ns", side_effect=error), observer:
                subprocess.run(["/usr/bin/ss"])
        self.assertIs(caught.exception, error)
        self.assertIs(subprocess.run, original)

    def test_unknown_argv_objects_are_not_stringified_or_inspected(self):
        class Private:
            def __str__(self):
                raise AssertionError("no private str")
            def __repr__(self):
                raise AssertionError("no private repr")
            def __iter__(self):
                raise AssertionError("no private iteration")
        result = object()
        original = self.fake_original(lambda *_: result)
        self.fixture(original)
        observer = m.RunDurations()
        with observer:
            self.assertIs(subprocess.run(Private()), result)
            self.assertIs(subprocess.run(args=[Private()]), result)
        self.assertTrue(all(row["commandKind"] == "other" for row in observer.snapshot()["calls"]))

    def test_foreign_thread_call_is_forwarded_without_cross_thread_timing(self):
        result = object()
        original = self.fake_original(lambda *_: result)
        self.fixture(original)
        seen = []
        observer = m.RunDurations()
        with observer:
            thread = threading.Thread(target=lambda: seen.append(subprocess.run(["/usr/bin/ss"])))
            thread.start()
            thread.join(2)
        self.assertEqual(seen, [result])
        self.assertEqual(observer.snapshot()["calls"], [])
        self.assertEqual(observer.snapshot()["foreignThreadCalls"], 1)

    def test_single_scope_existing_hook_and_manual_exit_guards_restore_original(self):
        original = subprocess.run
        observer = m.RunDurations()
        with self.assertRaises(RuntimeError):
            observer.__exit__(None, None, None)
        self.assertIs(subprocess.run, original)
        with patch.object(subprocess, "run", lambda *_: None):
            with self.assertRaises(RuntimeError):
                observer.__enter__()
        with observer:
            with self.assertRaises(RuntimeError):
                observer.__enter__()
        with self.assertRaises(RuntimeError):
            observer.__enter__()
        self.assertIs(subprocess.run, original)

    def test_scope_body_error_and_foreign_hook_change_restore_before_snapshot(self):
        original = subprocess.run
        error = RuntimeError("body")
        observer = m.RunDurations()
        with self.assertRaises(RuntimeError) as caught:
            with observer:
                subprocess.run = lambda *_: None
                raise error
        self.assertIs(caught.exception, error)
        self.assertIs(subprocess.run, original)
        self.assertTrue(observer.snapshot()["runHookChangedDuringScope"])
        self.assertTrue(observer.snapshot()["subprocessRunRestored"])

    def test_snapshot_is_detached_and_all_authority_flags_are_false(self):
        original = self.fake_original(lambda *_: None)
        self.fixture(original)
        observer = m.RunDurations()
        with observer:
            subprocess.run(args=[b"/usr/bin/psql", b"private-SQL"])
        value = observer.snapshot()
        value["calls"][0]["commandKind"] = "changed"
        self.assertEqual(observer.snapshot()["calls"][0]["commandKind"], "psql")
        for key in ["argumentsEnvironmentTimeoutAndOriginalResultsChanged", "argvOrInputOrEnvironmentRetained",
            "stdoutOrStderrOrSQLRetained", "liveTraceInstalled", "liveProfileInstalled", "PopenOrPipeOrSQLParentWrapped",
            "automaticRetryAllowed", "currentOrSourceOrMetadataQualified", "timingQualificationClaimed",
            "SQLAuthorityQualified", "effectsDispatchedByObserver"]:
            self.assertIs(value[key], False)

    def test_default_CLI_is_inert_and_no_business_or_transport_hooks_exist(self):
        value = json.loads(subprocess.run([sys.executable, "-I", "-B", str(FILE)], capture_output=True, check=True).stdout)
        self.assertTrue(value["staticOnly"])
        self.assertFalse(value["subprocessObserverInstalled"])
        tree = ast.parse(FILE.read_bytes())
        calls = {ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
        for name in ["subprocess.Popen", "sys.settrace", "sys.setprofile", "caller.qualify_held", "cache._sql_child",
            "host.refresh", "host.prerequisites", "os.kill", "os.waitpid"]:
            self.assertNotIn(name, calls)


if __name__ == "__main__":
    unittest.main(verbosity=2)
