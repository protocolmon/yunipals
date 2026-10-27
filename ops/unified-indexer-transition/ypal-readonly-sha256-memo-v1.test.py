"""Local genuine crypto/file/namespace controls; no application or database work."""
import ast
import builtins
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().with_name("ypal-readonly-sha256-memo-v1.py")
spec = importlib.util.spec_from_file_location("readonly_sha256_memo_controls", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
ORIGINAL = hashlib.sha256
MIB = 1024 * 1024


class Controls(unittest.TestCase):
    def assert_closed(self, memo):
        self.assertIs(hashlib.sha256, ORIGINAL)
        self.assertFalse(memo.active)
        self.assertEqual(memo._entries, [])
        snapshot = memo.snapshot()
        self.assertTrue(snapshot["originalSHA256Restored"])
        self.assertTrue(snapshot["privatePayloadsReleased"])
        self.assertEqual(snapshot["retainedPayloadBytesNow"], 0)

    def original_spy(self, memo):
        calls = []
        actual = memo._original
        def observed(original, args, kwargs, large_bytes=0):
            self.assertIs(original, ORIGINAL)
            result = actual(original, args, kwargs, large_bytes)
            calls.append((args, kwargs, result))
            return result
        self.enterContext(patch.object(memo, "_original", side_effect=observed))
        return calls

    def test_real_crypto_vectors_and_exact_fresh_bytes_hit_returns_original_type(self):
        vectors = [(b"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            (b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
            (b"a" * 1000000, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")]
        raw = b"a" * MIB
        reread = bytes(bytearray(raw))
        self.assertIsNot(raw, reread)
        memo = m.SHA256Memo()
        calls = self.original_spy(memo)
        with memo:
            for data, digest in vectors:
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
            first = hashlib.sha256(raw)
            second = hashlib.sha256(reread)
            self.assertIs(first, calls[-1][2])
            self.assertIsNot(first, second)
            self.assertIs(type(second), type(first))
            self.assertEqual(first.digest(), second.digest())
        self.assert_closed(memo)
        snapshot = memo.snapshot()
        self.assertEqual(snapshot["cacheHits"], 1)
        self.assertEqual(snapshot["largeInputBytesAvoidedByHits"], MIB)
        self.assertEqual(snapshot["originalConstructorCalls"], 4)

    def test_private_state_never_exposed_and_updates_copy_digest_remain_independent(self):
        raw = b"independent-state" * 70000
        expected = ORIGINAL(raw).hexdigest()
        with m.SHA256Memo() as memo:
            first = hashlib.sha256(raw)
            first.update(b"first")
            second = hashlib.sha256(bytes(bytearray(raw)))
            copied = second.copy()
            copied.update(b"copied")
            second.update(b"second")
            third = hashlib.sha256(raw)
            self.assertEqual(third.hexdigest(), expected)
            self.assertEqual(first.hexdigest(), ORIGINAL(raw + b"first").hexdigest())
            self.assertEqual(second.hexdigest(), ORIGINAL(raw + b"second").hexdigest())
            self.assertEqual(copied.hexdigest(), ORIGINAL(raw + b"copied").hexdigest())
            self.assertTrue(all(entry[2] is not value for entry in memo._entries for value in [first, second, copied, third]))
        self.assert_closed(memo)
        self.assertEqual(memo.snapshot()["cacheHits"], 2)

    def test_empty_true_false_security_modes_have_separate_original_states(self):
        raw = b"s" * MIB
        memo = m.SHA256Memo()
        with memo:
            values = [hashlib.sha256(raw), hashlib.sha256(raw, usedforsecurity=True), hashlib.sha256(raw, usedforsecurity=False)]
            repeated = [hashlib.sha256(raw), hashlib.sha256(raw, usedforsecurity=True), hashlib.sha256(raw, usedforsecurity=False)]
            self.assertEqual(len(memo._entries), 3)
            self.assertEqual(len({entry[0] for entry in memo._entries}), 3)
            for first, second in zip(values, repeated):
                self.assertIsNot(first, second)
                self.assertEqual(first.digest(), second.digest())
        self.assertEqual(memo.snapshot()["originalConstructorCalls"], 3)
        self.assertEqual(memo.snapshot()["cacheHits"], 3)
        self.assert_closed(memo)

    def test_changed_file_same_inode_size_and_restored_mtime_cannot_hit_old_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "fresh-source.py"
            path.write_bytes(b"a" * MIB)
            before = path.stat()
            old_expected = ORIGINAL(path.read_bytes()).hexdigest()
            with m.SHA256Memo() as memo:
                first = hashlib.sha256(path.read_bytes()).hexdigest()
                repeated = hashlib.sha256(path.read_bytes()).hexdigest()
                with path.open("r+b") as stream:
                    stream.write(b"b" * MIB)
                os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))
                after = path.stat()
                changed = hashlib.sha256(path.read_bytes()).hexdigest()
                self.assertEqual((after.st_ino, after.st_size, after.st_mtime_ns), (before.st_ino, before.st_size, before.st_mtime_ns))
                self.assertEqual(first, repeated)
                self.assertNotEqual(changed, old_expected)
                with self.assertRaises(RuntimeError):
                    if changed != old_expected:
                        raise RuntimeError("genuine_expected_source_digest_guard_refused_changed_fresh_bytes")
            self.assertEqual(memo.snapshot()["cacheHits"], 1)
            self.assertEqual(memo.snapshot()["cacheLookupMisses"], 2)
            self.assert_closed(memo)

    def test_lru_four_entry_eviction_and_payload_budget_are_bounded(self):
        values = [bytes([number]) * MIB for number in range(6)]
        memo = m.SHA256Memo(maximum_payload_bytes=4 * MIB, maximum_entries=4)
        with memo:
            for raw in values[:4]:
                hashlib.sha256(raw)
            hashlib.sha256(values[0])
            hashlib.sha256(values[4])
            self.assertFalse(any(entry[1] == values[1] for entry in memo._entries))
            self.assertTrue(any(entry[1] == values[0] for entry in memo._entries))
            hashlib.sha256(values[1])
            self.assertLessEqual(len(memo._entries), 4)
            self.assertLessEqual(sum(len(entry[1]) for entry in memo._entries), 4 * MIB)
        self.assertEqual(memo.snapshot()["entriesEvicted"], 2)
        self.assertEqual(memo.snapshot()["peakRetainedPayloadBytes"], 4 * MIB)
        self.assert_closed(memo)
        with m.SHA256Memo(maximum_payload_bytes=2 * MIB) as budget:
            for raw in values[:3]:
                hashlib.sha256(raw)
            self.assertEqual(len(budget._entries), 2)
            self.assertEqual(sum(len(entry[1]) for entry in budget._entries), 2 * MIB)
        self.assertEqual(budget.snapshot()["entriesEvicted"], 1)
        self.assert_closed(budget)

    def test_small_oversize_mutable_subclass_and_keyword_input_delegate_once(self):
        class Bytes(bytes):
            def __len__(self):
                raise AssertionError("do not inspect unsupported subclass")
            def __eq__(self, _other):
                raise AssertionError("do not compare unsupported subclass")
        raw = b"x" * MIB
        mutable = bytearray(raw)
        subclass = Bytes(raw)
        memo = m.SHA256Memo(maximum_payload_bytes=MIB)
        calls = self.original_spy(memo)
        with memo:
            cases = [((), {}), ((b"small",), {}), ((raw + b"x",), {}), ((mutable,), {}),
                ((memoryview(raw),), {}), ((subclass,), {}), ((), {"string": raw}), ((raw,), {"usedforsecurity": 1})]
            for args, kwargs in cases:
                before = len(calls)
                value = hashlib.sha256(*args, **kwargs)
                self.assertEqual(len(calls), before + 1)
                self.assertIs(value, calls[-1][2])
                self.assertEqual(calls[-1][0], args)
                self.assertEqual(calls[-1][1], kwargs)
            mutable[0] = 5
            self.assertEqual(hashlib.sha256(mutable).digest(), ORIGINAL(mutable).digest())
            self.assertEqual(memo._entries, [])
        self.assertEqual(memo.snapshot()["cacheHits"], 0)
        self.assert_closed(memo)

    def test_unknown_security_value_only_original_evaluates_and_original_errors_are_not_cached(self):
        class Flag:
            def __init__(self):
                self.calls = 0
            def __bool__(self):
                self.calls += 1
                return True
        flag = Flag()
        memo = m.SHA256Memo()
        with memo:
            self.assertEqual(hashlib.sha256(b"z" * MIB, usedforsecurity=flag).digest(), ORIGINAL(b"z" * MIB).digest())
            self.assertEqual(flag.calls, 1)
            for _ in range(2):
                with self.assertRaises(TypeError):
                    hashlib.sha256("not-bytes")
            self.assertEqual(memo._entries, [])
        self.assertEqual(memo.snapshot()["originalConstructorCalls"], 3)
        self.assert_closed(memo)

    def test_miss_returns_already_computed_original_when_private_copy_cannot_be_saved(self):
        memo = m.SHA256Memo()
        calls = self.original_spy(memo)
        with patch.object(memo, "_copy_state", side_effect=MemoryError("optional-cache-copy")), memo:
            value = hashlib.sha256(b"m" * MIB)
            self.assertIs(value, calls[0][2])
            self.assertEqual(len(calls), 1)
            self.assertEqual(memo._entries, [])
        self.assertEqual(memo.snapshot()["bookkeepingErrors"], 1)
        self.assert_closed(memo)
        eligibility = m.SHA256Memo()
        calls = self.original_spy(eligibility)
        with patch.object(eligibility, "_supported", side_effect=ValueError("optional-eligibility")), eligibility:
            value = hashlib.sha256(b"m" * MIB)
            self.assertIs(value, calls[0][2])
            self.assertEqual(len(calls), 1)
        self.assertEqual(eligibility.snapshot()["bookkeepingErrors"], 1)
        self.assert_closed(eligibility)

    def test_hit_copy_refusal_falls_back_to_exact_one_original_constructor(self):
        raw = b"h" * MIB
        memo = m.SHA256Memo()
        calls = self.original_spy(memo)
        with memo:
            hashlib.sha256(raw)
            with patch.object(memo, "_copy_state", side_effect=ValueError("optional-hit-copy")):
                value = hashlib.sha256(raw)
            self.assertIs(value, calls[1][2])
            self.assertEqual(len(calls), 2)
        self.assertEqual(memo.snapshot()["cacheHits"], 0)
        self.assertEqual(memo.snapshot()["largeInputBytesAvoidedByHits"], 0)
        self.assert_closed(memo)

    def test_original_error_identity_and_cancellation_propagate_without_a_second_original_call(self):
        for error in [MemoryError("original"), RuntimeError("deadline"), KeyboardInterrupt("cancel"), SystemExit(7)]:
            memo = m.SHA256Memo()
            with patch.object(memo, "_original", side_effect=error) as original:
                with self.assertRaises(type(error)) as caught:
                    with memo:
                        hashlib.sha256(b"e" * MIB)
                self.assertIs(caught.exception, error)
                original.assert_called_once()
            self.assert_closed(memo)
        for body_error in [None, RuntimeError("original-body")]:
            memo = m.SHA256Memo()
            close_refusal = patch.object(m, "sum", side_effect=MemoryError("optional-close-counters"), create=True)
            try:
                def scope():
                    with memo:
                        hashlib.sha256(b"c" * MIB)
                        self.assertEqual(len(memo._entries), 1)
                        close_refusal.start()
                        if body_error is not None:
                            raise body_error
                if body_error is None:
                    scope()
                else:
                    with self.assertRaises(RuntimeError) as caught:
                        scope()
                    self.assertIs(caught.exception, body_error)
            finally:
                close_refusal.stop()
            self.assertEqual(memo.snapshot()["bookkeepingErrors"], 1)
            self.assert_closed(memo)
        memo = m.SHA256Memo()
        deadline = RuntimeError("external-close-deadline")
        close_refusal = patch.object(m, "sum", side_effect=deadline, create=True)
        try:
            with self.assertRaises(RuntimeError) as caught:
                with memo:
                    hashlib.sha256(b"c" * MIB)
                    close_refusal.start()
            self.assertIs(caught.exception, deadline)
        finally:
            close_refusal.stop()
        self.assert_closed(memo)
        for error in [RuntimeError("lookup-deadline"), KeyboardInterrupt("lookup-cancel"), SystemExit(8)]:
            memo = m.SHA256Memo()
            with patch.object(memo, "_lookup", side_effect=error), patch.object(memo, "_original") as original:
                with self.assertRaises(type(error)) as caught:
                    with memo:
                        hashlib.sha256(b"e" * MIB)
                self.assertIs(caught.exception, error)
                original.assert_not_called()
            self.assert_closed(memo)

    def test_captured_alias_and_fresh_namespace_are_original_after_scope_and_release_payloads(self):
        raw = b"namespace-isolation" * 60000
        expected = ORIGINAL(raw).digest()
        source = "from hashlib import sha256\nstate=[]\ndef digest(value):\n state.append(1)\n return sha256(value)\n"
        first = {}; second = {}
        memo = m.SHA256Memo()
        with memo:
            exec(compile(source, "fresh-one", "exec"), first)
            exec(compile(source, "fresh-two", "exec"), second)
            self.assertEqual(first["digest"](raw).digest(), expected)
            self.assertEqual(second["digest"](bytes(bytearray(raw))).digest(), expected)
        self.assert_closed(memo)
        snapshot = memo.snapshot()
        value = first["digest"](raw)
        value.update(b"after-scope")
        self.assertEqual(value.digest(), ORIGINAL(raw + b"after-scope").digest())
        self.assertEqual(memo.snapshot(), snapshot)
        self.assertIsNot(first["digest"].__globals__, second["digest"].__globals__)
        self.assertEqual(second["state"], [1])

    def test_foreign_thread_and_foreign_hook_preserve_original_and_restore(self):
        raw = b"f" * MIB
        expected = ORIGINAL(raw).digest()
        result = []
        with m.SHA256Memo() as memo:
            thread = threading.Thread(target=lambda: result.append(hashlib.sha256(raw).digest()))
            thread.start(); thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(memo._entries, [])
            hashlib.sha256 = lambda *_args, **_kwargs: None
        self.assertEqual(result, [expected])
        self.assertTrue(memo.snapshot()["SHA256HookChangedDuringScope"])
        self.assertEqual(memo.snapshot()["foreignThreadCallsDelegated"], 1)
        self.assert_closed(memo)

    def test_guard_caps_reuse_snapshot_and_compile_context_remain_original(self):
        for kwargs in [{"maximum_entries": 0}, {"maximum_entries": 5}, {"maximum_entries": True},
                {"maximum_payload_bytes": MIB - 1}, {"maximum_payload_bytes": 256 * MIB + 1}, {"maximum_payload_bytes": True}]:
            with self.assertRaises(ValueError):
                m.SHA256Memo(**kwargs)
        memo = m.SHA256Memo()
        with patch.object(hashlib, "sha256", lambda *_: None):
            with self.assertRaises(RuntimeError):
                memo.__enter__()
        original_compile = builtins.compile
        scope = {}
        exec("from __future__ import annotations\ndef build():\n return compile('value: UnknownType','caller-future','exec')", scope)
        with memo:
            with self.assertRaises(RuntimeError):
                memo.__enter__()
            with self.assertRaises(RuntimeError):
                memo.snapshot()
            self.assertIs(builtins.compile, original_compile)
            output = {}; exec(scope["build"](), output)
            self.assertEqual(output["__annotations__"], {"value": "UnknownType"})
        with self.assertRaises(RuntimeError):
            memo.__enter__()
        with self.assertRaises(RuntimeError):
            memo.__exit__(None, None, None)
        self.assert_closed(memo)

    def test_snapshot_scalars_only_detached_and_no_file_fact_JSON_or_application_hooks(self):
        raw = b"private-payload-marker" * 60000
        with m.SHA256Memo() as memo:
            hashlib.sha256(raw)
            hashlib.sha256(bytes(bytearray(raw)))
        value = memo.snapshot()
        self.assertTrue(all(type(item) in (str, bool, int) for item in value.values()))
        value["cacheHits"] = -1
        self.assertEqual(memo.snapshot()["cacheHits"], 1)
        self.assertNotIn("private-payload-marker", json.dumps(memo.snapshot()))
        self.assertNotIn(ORIGINAL(raw).hexdigest(), json.dumps(memo.snapshot()))
        self.assertLessEqual(len(memo.counts), 20)
        self.assert_closed(memo)
        tree = ast.parse(FILE.read_bytes())
        called = {ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
        for name in ["open", "os.stat", "os.lstat", "subprocess.run", "subprocess.Popen", "sys.settrace", "sys.setprofile",
                "sys._getframe", "host.refresh", "host.prerequisites", "caller.qualify_held"]:
            self.assertNotIn(name, called)
        for key in ["mutableInputsCached", "fileMetadataUsedForHits", "sourceOrActorOrCatalogOrReadinessFactsCached",
                "compileJSONApplicationOrProfileHooksInstalled", "deadlinesChanged", "automaticRetryAllowed",
                "currentOrTimingOrSQLAuthorityQualified", "effectsDispatchedByHelper"]:
            self.assertIs(memo.snapshot()[key], False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
