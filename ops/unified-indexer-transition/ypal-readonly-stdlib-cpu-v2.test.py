"""Pure local stdlib work only; exact forwarding, isolation and overhead controls."""
import ast
import builtins
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().with_name("ypal-readonly-stdlib-cpu-v2.py")
spec = importlib.util.spec_from_file_location("readonly_stdlib_cpu_controls", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def assert_restored(self):
        for _label, owner, attribute, original in m._TARGETS:
            self.assertIs(getattr(owner, attribute), original)

    def test_all_five_real_functions_keep_results_and_leave_compile_unchanged(self):
        text = "value = {'number': 7}\nclass Item:\n    def get(self): return value['number']\n"
        data = {"rows": [{"number": i, "value": "local-private-fixture"} for i in range(40)]}
        expected_json = json.dumps(data, sort_keys=True)
        expected_digest = hashlib.sha256(b"abc").hexdigest()
        observer = m.StdlibCPUDurations()
        with observer:
            self.assertIs(builtins.compile, m._ORIGINAL_COMPILE)
            parsed = ast.parse(text)
            code = compile(parsed, "local-isolated-fixture.py", "exec")
            namespace = {}
            exec(code, namespace)
            cloned = copy.deepcopy(data)
            encoded = json.dumps(cloned, sort_keys=True)
            decoded = json.loads(encoded)
            digest = hashlib.sha256(b"abc")
        self.assert_restored()
        self.assertEqual(namespace["Item"]().get(), 7)
        self.assertEqual(decoded, data)
        self.assertIsNot(cloned, data)
        self.assertEqual(encoded, expected_json)
        self.assertEqual(digest.hexdigest(), expected_digest)
        value = observer.snapshot()
        self.assertTrue(value["allOriginalStdlibObjectsRestored"])
        self.assertEqual(value["outerCallsObserved"], 5)
        self.assertEqual(value["timedOuterCalls"], 5)
        rows = {row["label"]: row for row in value["functions"]}
        self.assertNotIn("builtins.compile", rows)
        self.assertTrue(all(row["timedOuterCalls"] == 1 for row in rows.values()))
        self.assertNotIn("local-private-fixture", json.dumps(value))

    def test_deepcopy_keeps_cycles_shared_aliases_and_custom_memo_identity(self):
        source = []
        source.append(source)
        shared = {"same": []}
        graph = [source, shared, shared]
        memo = {}
        with m.StdlibCPUDurations() as observer:
            result = copy.deepcopy(graph, memo)
        self.assertIs(result[0], result[0][0])
        self.assertIs(result[1], result[2])
        self.assertIs(memo[id(graph)], result)
        self.assertEqual(observer.snapshot()["functions"][1]["timedOuterCalls"], 1)

    def test_custom_deepcopy_global_reentry_is_executed_but_not_double_timed(self):
        class Item:
            def __init__(self, value):
                self.value = value
            def __deepcopy__(self, memo):
                return Item(copy.deepcopy(self.value, memo))
        with m.StdlibCPUDurations() as observer:
            result = copy.deepcopy(Item([1, 2]))
        self.assertEqual(result.value, [1, 2])
        value = observer.snapshot()
        row = next(row for row in value["functions"] if row["label"] == "copy.deepcopy")
        self.assertEqual(row["timedOuterCalls"], 1)
        self.assertEqual(row["nestedCallsNotSeparatelyTimed"], 1)

    def test_compile_exec_keeps_independent_fresh_namespaces_and_code_globals(self):
        raw = b"state=[]\nclass Item:\n    def append(self, item): state.append(item)\n    def values(self): return list(state)\n"
        namespaces = []
        codes = []
        with m.StdlibCPUDurations() as observer:
            for _ in range(2):
                code = compile(raw, "actual-same-source.py", "exec", dont_inherit=True, optimize=0)
                value = {}
                exec(code, value)
                namespaces.append(value)
                codes.append(code)
        self.assertIsNot(codes[0], codes[1])
        self.assertIsNot(namespaces[0]["Item"], namespaces[1]["Item"])
        self.assertIsNot(namespaces[0]["Item"].append.__globals__, namespaces[1]["Item"].append.__globals__)
        namespaces[0]["Item"]().append(1)
        self.assertEqual(namespaces[1]["Item"]().values(), [])
        self.assertEqual(observer.snapshot()["timedOuterCalls"], 0)

    def test_original_compile_retains_real_callers_future_flags(self):
        namespace = {}
        exec("from __future__ import annotations\ndef build():\n return compile('value: UnknownType', 'caller-future.py', 'exec')", namespace)
        original = builtins.compile
        plain = {}
        exec(namespace["build"](), plain)
        with m.StdlibCPUDurations() as observer:
            self.assertIs(builtins.compile, original)
            value = {}
            exec(namespace["build"](), value)
        self.assertEqual(value["__annotations__"], plain["__annotations__"])
        self.assertEqual(value["__annotations__"], {"value": "UnknownType"})
        self.assertIs(builtins.compile, original)
        self.assertFalse(observer.snapshot()["builtinsCompileObserved"])
        self.assertTrue(observer.snapshot()["originalCompileObjectUnchanged"])

    def test_sha256_returns_original_hash_object_and_excludes_update_hexdigest(self):
        observer = m.StdlibCPUDurations()
        with observer:
            value = hashlib.sha256(b"abc")
            before = observer.outer_calls
            value.update(b"def")
            digest = value.hexdigest()
            self.assertEqual(observer.outer_calls, before)
        self.assertEqual(digest, hashlib.sha256(b"abcdef").hexdigest())
        result = observer.snapshot()
        self.assertTrue(result["SHA256ConstructionOnly"])
        self.assertFalse(result["SHA256UpdateOrHexdigestTimed"])

    def test_exact_arguments_unknown_result_and_exception_objects_are_preserved(self):
        class Unknown:
            def __repr__(self):
                raise AssertionError("no private repr")
            def __str__(self):
                raise AssertionError("no private str")
        marker = Unknown()
        calls = []
        owner = types.SimpleNamespace()
        def original(*args, **kwargs):
            calls.append((args, kwargs))
            return marker
        owner.call = original
        targets = (("json.loads", owner, "call", original),)
        args = [marker]
        keywords = {"unknown": marker}
        with patch.object(m, "_TARGETS", targets):
            with m.StdlibCPUDurations() as observer:
                self.assertIs(owner.call(args, option=keywords), marker)
            self.assertIs(owner.call, original)
            self.assertIs(calls[0][0][0], args)
            self.assertIs(calls[0][1]["option"], keywords)
            self.assertEqual(observer.snapshot()["timedOuterCalls"], 1)
        for error in [ValueError("private"), RuntimeError("original"), KeyboardInterrupt("cancel"), SystemExit(9)]:
            def fail(*_args, **_kwargs):
                raise error
            owner.call = fail
            with patch.object(m, "_TARGETS", (("json.loads", owner, "call", fail),)):
                observer = m.StdlibCPUDurations()
                with self.assertRaises(type(error)) as caught:
                    with observer:
                        owner.call(marker)
                self.assertIs(caught.exception, error)
                self.assertIs(owner.call, fail)
                self.assertEqual(observer.snapshot()["functions"][0]["raisedCalls"], 1)

    def test_real_stdlib_errors_and_scope_body_error_restore_all_originals(self):
        with self.assertRaises(json.JSONDecodeError):
            with m.StdlibCPUDurations():
                json.loads("not-json")
        self.assert_restored()
        error = RuntimeError("original-body")
        observer = m.StdlibCPUDurations()
        with self.assertRaises(RuntimeError) as caught:
            with observer:
                ast.parse("value=1")
                raise error
        self.assertIs(caught.exception, error)
        self.assert_restored()

    def test_cap_and_finite_clock_errors_never_change_original_calls(self):
        self.assertEqual(m.MAXIMUM_OUTER_CALLS, 50000)
        self.assertEqual(m.StdlibCPUDurations().maximum_outer_calls, 50000)
        self.assertEqual(m.StdlibCPUDurations(maximum_outer_calls=50000).maximum_outer_calls, 50000)
        for limit in [0, 50001, True]:
            with self.assertRaises(ValueError):
                m.StdlibCPUDurations(maximum_outer_calls=limit)
        # A genuine local public-entrypoint population matching the incomplete
        # historical observation count; these are no production/current facts.
        with m.StdlibCPUDurations() as coverage:
            for _ in range(21699):
                json.loads("null")
        full = coverage.snapshot()
        self.assertEqual((full["outerCallsObserved"], full["timedOuterCalls"], full["droppedOuterCalls"]), (21699, 21699, 0))
        self.assertEqual(full["bookkeepingErrors"], 0)
        self.assertEqual(len(full["functions"]), 5)
        with m.StdlibCPUDurations(maximum_outer_calls=2) as observer:
            class Item:
                def __deepcopy__(self, memo):
                    return copy.deepcopy([7], memo)
            values = [copy.deepcopy(Item()) for _ in range(5)]
        self.assertEqual(values, [[7]] * 5)
        value = observer.snapshot()
        self.assertEqual((value["outerCallsObserved"], value["timedOuterCalls"], value["droppedOuterCalls"]), (5, 2, 3))
        self.assertEqual(value["functions"][1]["nestedCallsNotSeparatelyTimed"], 5)
        for clock_values in [[ValueError("start")], [1, ValueError("end")], [-1], [True]]:
            observer = m.StdlibCPUDurations()
            with patch.object(m.time, "perf_counter_ns", side_effect=clock_values), observer:
                value = json.loads('{"value":7}')
            self.assertEqual(value, {"value": 7})
            self.assertGreater(observer.snapshot()["bookkeepingErrors"], 0)
            self.assert_restored()

    def test_external_deadline_is_not_swallowed_and_depth_resets(self):
        error = RuntimeError("external-deadline")
        observer = m.StdlibCPUDurations()
        with self.assertRaises(RuntimeError) as caught:
            with patch.object(m.time, "perf_counter_ns", side_effect=error), observer:
                json.loads("null")
        self.assertIs(caught.exception, error)
        self.assertEqual(observer.depth, 0)
        self.assert_restored()

    def test_guard_reuse_foreign_hook_and_snapshot_before_exit(self):
        observer = m.StdlibCPUDurations()
        with patch.object(json, "loads", lambda *_: None):
            with self.assertRaises(RuntimeError):
                observer.__enter__()
        self.assert_restored()
        with self.assertRaises(RuntimeError):
            observer.__exit__(None, None, None)
        with observer:
            with self.assertRaises(RuntimeError):
                observer.snapshot()
            with self.assertRaises(RuntimeError):
                observer.__enter__()
        with self.assertRaises(RuntimeError):
            observer.__enter__()
        self.assert_restored()

    def test_foreign_thread_forwards_and_hook_mutation_is_reported_after_restore(self):
        result = []
        observer = m.StdlibCPUDurations()
        with observer:
            thread = threading.Thread(target=lambda: result.append(json.loads("[1,2,3]")))
            thread.start()
            thread.join(2)
            json.loads = lambda *_: None
        self.assertEqual(result, [[1, 2, 3]])
        value = observer.snapshot()
        self.assertTrue(value["allOriginalStdlibObjectsRestored"])
        self.assertTrue(value["stdlibHookChangedDuringScope"])
        row = next(row for row in value["functions"] if row["label"] == "json.loads")
        self.assertEqual(row["foreignThreadCallsNotTimed"], 1)
        self.assert_restored()

    def test_snapshot_detached_and_no_business_trace_profile_transport_or_cache(self):
        with m.StdlibCPUDurations() as observer:
            json.dumps({"value": 1})
        value = observer.snapshot()
        value["functions"][0]["wallNanoseconds"] = -1
        self.assertGreaterEqual(observer.snapshot()["functions"][0]["wallNanoseconds"], 0)
        for key in ["SHA256UpdateOrHexdigestTimed", "argumentsResultsOrExceptionMessagesRetained",
            "originalArgumentsResultsOrExceptionsChanged", "codeOrProofOrFactsCached",
            "businessFunctionOrSourceOrSQLHookInstalled", "liveTraceOrProfileOrCallstackHookInstalled",
            "PopenOrPipeOrSQLParentWrapped", "automaticRetryAllowed", "currentOrSourceOrMetadataQualified",
            "timingQualificationClaimed", "effectsDispatchedByObserver"]:
            self.assertIs(value[key], False)
        tree = ast.parse(FILE.read_bytes())
        names = {ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
        for forbidden in ["subprocess.run", "subprocess.Popen", "sys.setprofile", "sys.settrace", "sys._getframe",
            "inspect.currentframe", "caller.qualify_held", "host.prerequisites", "host.refresh"]:
            self.assertNotIn(forbidden, names)


if __name__ == "__main__":
    unittest.main(verbosity=2)
