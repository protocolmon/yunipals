"""Real AST entrypoints and explicit observation-failure fixtures; no DB/SSH."""
import ast
import builtins
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load("ypal-readonly-ast-cost-v1.py")
ORIGINAL_DUMP = ast.dump
ORIGINAL_FIX = ast.fix_missing_locations


def broken(error, entry):
    class Broken(ast.AST):
        _fields = ("value",) if entry == "dump" else ()
        _attributes = () if entry == "dump" else ("lineno",)
        accesses = 0

        @property
        def value(self):
            self.accesses += 1
            raise error

        @property
        def lineno(self):
            self.accesses += 1
            raise error
    return Broken()


class Controls(unittest.TestCase):
    def tearDown(self):
        self.assertIs(ast.dump, ORIGINAL_DUMP)
        self.assertIs(ast.fix_missing_locations, ORIGINAL_FIX)

    def test_real_source_dump_and_mutating_fix_keep_exact_results_and_tree_identity(self):
        source = "def f(x):\n    return x + 1\n"
        expected = ast.parse(source)
        expected.body[0].body[0].value = ast.BinOp(left=ast.Name(id="x", ctx=ast.Load()), op=ast.Add(), right=ast.Constant(7))
        actual = copy.deepcopy(expected)
        ORIGINAL_FIX(expected)
        observer = m.ASTCosts()
        with observer:
            result = ast.fix_missing_locations(actual)
            dumped = ast.dump(result, annotate_fields=True, include_attributes=True, indent=2)
        self.assertIs(result, actual)
        self.assertEqual(dumped, ORIGINAL_DUMP(expected, annotate_fields=True, include_attributes=True, indent=2))
        self.assertEqual(compile(actual, "explicit-local-AST", "exec").co_code, compile(expected, "explicit-local-AST", "exec").co_code)
        rows = {row["label"]: row for row in observer.snapshot()["functions"]}
        for row in rows.values():
            self.assertEqual((row["calls"], row["timedOuterCalls"], row["returnedOuterCalls"], row["raisedOuterCalls"]), (1, 1, 1, 0))
            self.assertGreaterEqual(row["wallNanoseconds"], 0)
            self.assertGreaterEqual(row["threadCPUNanoseconds"], 0)

    def test_exact_argument_return_and_exception_identity_at_pass_through_boundary(self):
        value, keyword, sentinel = object(), object(), object()
        spy = Mock(return_value=sentinel)
        observer = m.ASTCosts()
        with observer:
            result = observer._observe("ast.dump", spy, (value,), {"explicit": keyword})
        self.assertIs(result, sentinel)
        spy.assert_called_once_with(value, explicit=keyword)
        for entry in ["dump", "fix_missing_locations"]:
            error = ValueError("private-AST-message-not-recorded")
            node = broken(error, "dump" if entry == "dump" else "fix")
            observer = m.ASTCosts()
            with self.assertRaises(ValueError) as caught:
                with observer:
                    getattr(ast, entry)(node)
            self.assertIs(caught.exception, error)
            self.assertEqual(node.accesses, 1)
            self.assertNotIn("private-AST", json.dumps(observer.snapshot()))
            row = next(row for row in observer.snapshot()["functions"] if row["label"] == "ast." + entry)
            self.assertEqual((row["calls"], row["raisedOuterCalls"]), (1, 1))

    def test_actual_cancellation_and_scope_body_errors_restore_both_objects(self):
        for error in [TimeoutError("actual-deadline-fixture"), KeyboardInterrupt(), SystemExit(7)]:
            observer = m.ASTCosts(); node = broken(error, "dump")
            with self.assertRaises(type(error)) as caught:
                with observer:
                    ast.dump(node)
            self.assertIs(caught.exception, error)
            self.assertEqual(node.accesses, 1)
            self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])
        error = RuntimeError("body-refusal")
        observer = m.ASTCosts()
        with self.assertRaises(RuntimeError) as caught:
            with observer:
                raise error
        self.assertIs(caught.exception, error)
        self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])

    def test_cross_label_nested_original_executes_once_without_double_timing(self):
        child = ast.Constant(4)
        class Nested(ast.AST):
            _fields = ("value",)
            accesses = 0

            @property
            def value(self):
                self.accesses += 1
                return ast.fix_missing_locations(child)
        tree = Nested(); observer = m.ASTCosts()
        with patch.object(observer, "_clock", side_effect=[(100, 10), (160, 35)]) as clock:
            with observer:
                ast.dump(tree)
        rows = {row["label"]: row for row in observer.snapshot()["functions"]}
        self.assertEqual(tree.accesses, 1)
        self.assertEqual(clock.call_count, 2)
        self.assertEqual(rows["ast.dump"]["wallNanoseconds"], 60)
        self.assertEqual(rows["ast.dump"]["threadCPUNanoseconds"], 25)
        self.assertEqual(rows["ast.fix_missing_locations"]["calls"], 1)
        self.assertEqual(rows["ast.fix_missing_locations"]["nestedCallsNotSeparatelyTimed"], 1)
        self.assertEqual(rows["ast.fix_missing_locations"]["timedOuterCalls"], 0)

    def test_clock_bookkeeping_errors_do_not_skip_original_or_replace_result_or_error(self):
        for clocks in [[ValueError("clock-fixture")], [(100, 10), ValueError("clock-fixture")], [(100, 10), (90, 9)]]:
            observer = m.ASTCosts(); value = object(); original = Mock(return_value=value)
            with patch.object(observer, "_clock", side_effect=clocks):
                with observer:
                    self.assertIs(observer._observe("ast.dump", original, (), {}), value)
            original.assert_called_once_with()
            self.assertEqual(observer.snapshot()["bookkeepingErrors"], 1)
        error = RuntimeError("original-refusal")
        observer = m.ASTCosts(); original = Mock(side_effect=error)
        with patch.object(observer, "_clock", side_effect=[(100, 10), ValueError("clock-fixture")]):
            with self.assertRaises(RuntimeError) as caught:
                with observer:
                    observer._observe("ast.dump", original, (), {})
        self.assertIs(caught.exception, error)
        original.assert_called_once_with()
        # A real deadline raised during optional bookkeeping remains cancellation.
        error = TimeoutError("deadline-during-clock")
        observer = m.ASTCosts()
        with patch.object(observer, "_clock", side_effect=error), self.assertRaises(TimeoutError) as caught:
            with observer:
                ast.dump(ast.Constant(1))
        self.assertIs(caught.exception, error)

    def test_thread_owner_foreign_delegation_and_closed_imported_alias(self):
        observer = m.ASTCosts(); results = []; errors = []
        with observer:
            alias = ast.dump
            def foreign():
                results.append(alias(ast.Constant(3)))
                try: observer.__exit__(None, None, None)
                except RuntimeError as error: errors.append(error)
            thread = threading.Thread(target=foreign); thread.start(); thread.join()
            self.assertEqual(len(errors), 1)
            self.assertTrue(observer.active)
        before = observer.snapshot()
        self.assertEqual(results, [ORIGINAL_DUMP(ast.Constant(3))])
        self.assertEqual(before["functions"][0]["foreignThreadCallsDelegated"], 1)
        self.assertEqual(before["functions"][0]["calls"], 0)
        self.assertEqual(alias(ast.Constant(9)), ORIGINAL_DUMP(ast.Constant(9)))
        self.assertEqual(observer.snapshot(), before)

    def test_public_original_error_survives_secondary_deadline_and_counter_failures(self):
        for original_error in [ValueError("original-body-refusal"), TimeoutError("original-body-deadline"), KeyboardInterrupt()]:
            for secondary in [TimeoutError("secondary-clock-deadline"), MemoryError("secondary-clock-memory")]:
                with self.subTest(original=type(original_error).__name__, secondary=type(secondary).__name__):
                    observer = m.ASTCosts(); node = broken(original_error, "dump")
                    with patch.object(observer, "_clock", side_effect=[(100, 10), secondary]):
                        with self.assertRaises(type(original_error)) as caught:
                            with observer:
                                ast.dump(node)
                    self.assertIs(caught.exception, original_error)
                    self.assertEqual(node.accesses, 1)
                    self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])
                    self.assertEqual(observer.snapshot()["bookkeepingErrors"], 1)
        class FailedCounter:
            def __iadd__(self, _value):
                raise MemoryError("counter-update-memory-fixture")
        original_error = RuntimeError("original-body-refusal")
        observer = m.ASTCosts(); node = broken(original_error, "dump")
        # The ordinary clock refusal calls the real fallible counter helper.
        with patch.object(observer, "_clock", side_effect=[(100, 10), ValueError("secondary-clock-refusal")]):
            with self.assertRaises(RuntimeError) as caught:
                with observer:
                    observer.bookkeeping_errors = FailedCounter()
                    ast.dump(node)
        self.assertIs(caught.exception, original_error)
        self.assertFalse(observer.bookkeeping_error_count_complete)
        self.assertTrue(observer.restored)
        self.assertIsNone(observer.snapshot()["bookkeepingErrors"])
        json.dumps(observer.snapshot())

    def test_public_success_keeps_secondary_deadline_and_counter_refusal_is_reported(self):
        error = TimeoutError("deadline-after-original-success")
        observer = m.ASTCosts()
        with patch.object(observer, "_clock", side_effect=[(100, 10), error]):
            with self.assertRaises(TimeoutError) as caught:
                with observer:
                    ast.dump(ast.Constant(1))
        self.assertIs(caught.exception, error)
        self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])
        class FailedCounter:
            def __iadd__(self, _value):
                raise MemoryError("counter-update-memory-fixture")
        observer = m.ASTCosts()
        with patch.object(observer, "_clock", side_effect=ValueError("clock-refusal")):
            with observer:
                observer.bookkeeping_errors = FailedCounter()
                self.assertEqual(ast.dump(ast.Constant(2)), ORIGINAL_DUMP(ast.Constant(2)))
        self.assertFalse(observer.bookkeeping_error_count_complete)
        self.assertTrue(observer.restored)
        self.assertIsNone(observer.snapshot()["bookkeepingErrors"])
        json.dumps(observer.snapshot())

    def test_scope_ownership_snapshot_and_foreign_hook_refusal(self):
        observer = m.ASTCosts()
        with observer:
            with self.assertRaises(RuntimeError): observer.snapshot()
            with self.assertRaises(RuntimeError): observer.__enter__()
            with self.assertRaises(RuntimeError): m.ASTCosts().__enter__()
            duplicate = load("ypal-readonly-ast-cost-v1.py")
            with self.assertRaises(RuntimeError): duplicate.ASTCosts().__enter__()
        with self.assertRaises(RuntimeError): observer.__enter__()
        with self.assertRaises(RuntimeError): observer.__exit__(None, None, None)
        with patch.object(ast, "dump", lambda *_: "foreign"):
            with self.assertRaises(RuntimeError): m.ASTCosts().__enter__()
        observer = m.ASTCosts()
        with observer:
            ast.dump = lambda *_: "unexpected-scope-change"
        self.assertTrue(observer.snapshot()["ASTHookChangedDuringScope"])
        self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])

    def test_only_two_AST_hooks_and_real_SHA2_coexist_without_other_global_hooks(self):
        untouched = [builtins.compile, ast.parse, copy.deepcopy, json.loads, json.dumps, sys.gettrace(), sys.getprofile()]
        memo = load("ypal-readonly-sha256-memo-v2.py"); raw = b"a" * (1024 * 1024); digest = hashlib.sha256(raw).hexdigest()
        observer = m.ASTCosts()
        with memo.SHA256Memo() as cache:
            sha_hook = hashlib.sha256
            with observer:
                self.assertEqual(hashlib.sha256(raw).hexdigest(), digest)
                self.assertEqual(hashlib.sha256(raw).hexdigest(), digest)
                tree = ast.parse("x = 1")
                self.assertIs(ast.fix_missing_locations(tree), tree)
                self.assertIn("Assign", ast.dump(tree))
                self.assertIs(hashlib.sha256, sha_hook)
                self.assertEqual([builtins.compile, ast.parse, copy.deepcopy, json.loads, json.dumps, sys.gettrace(), sys.getprofile()], untouched)
            self.assertIs(hashlib.sha256, sha_hook)
        self.assertEqual(cache.snapshot()["cacheHits"], 1)
        value = observer.snapshot(); value["functions"][0]["calls"] = -99
        self.assertEqual(observer.snapshot()["functions"][0]["calls"], 1)
        for key in ["argumentsTreesResultsExceptionsOrFramesRetained", "SHACompileJSONApplicationOrProfileHooksInstalled",
                    "codeOrProofOrFreshFactsCached", "automaticRetryAllowed", "currentOrTimingAuthorityQualified", "effectsDispatchedByObserver"]:
            self.assertIs(observer.snapshot()[key], False)
        self.assertTrue(cache.snapshot()["originalSHA256Restored"])
        self.assertTrue(observer.snapshot()["bothOriginalASTObjectsRestored"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
