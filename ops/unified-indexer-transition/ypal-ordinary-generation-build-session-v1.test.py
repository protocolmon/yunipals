"""Source composition and controlled filesystem tests; no Host or service run."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load("ypal-ordinary-generation-build-session-v1.py")
REAL_LOAD_OWNER = m.load_owner


def real_owner():
    original_read, original_stat = Path.read_bytes, Path.lstat
    def local(path):
        if str(path).startswith(str(m.OPS)):
            return HERE / path.relative_to(m.OPS)
        if str(path).startswith("/opt/yunipals-unified"):
            return HERE
        return path
    def protected(path, digest=None):
        raw = original_read(local(path))
        if digest is not None: assert hashlib.sha256(raw).hexdigest() == digest
        return raw
    with patch.object(Path, "read_bytes", lambda path: original_read(local(path))), \
            patch.object(Path, "lstat", lambda path: original_stat(local(path))), \
            patch.object(m, "protected", side_effect=protected):
        return REAL_LOAD_OWNER()


class Controls(unittest.TestCase):
    def setUp(self):
        self.owner = real_owner()
        self.temporary = self.enterContext(tempfile.TemporaryDirectory())
        self.folder = Path(self.temporary)
        self.caller = self.folder / "caller"
        self.base = self.folder / "original"; self.base.mkdir()
        self.unit_file = self.folder / "system-unit"
        self.work = self.folder / "work"
        self.events = []; self.started = False; self.fail_capacity_at = None; self.capacities = 0
        owner = self.owner
        owner.BASE, owner.WORK = self.base, self.work
        self.enterContext(patch.object(m, "BASE", self.caller))
        self.enterContext(patch.object(m, "load_owner", return_value=owner))
        self.enterContext(patch.object(m, "protected", return_value=(HERE / m.FILE.name).read_bytes()))
        self.enterContext(patch.object(m, "directory", side_effect=lambda: self.caller.mkdir(mode=0o700)))
        self.host = types.SimpleNamespace(input_sha="1" * 64, config={"maximumSeconds": 2400})
        @contextlib.contextmanager
        def lock():
            self.events.append("lock-enter")
            try: yield
            finally: self.events.append("lock-exit")
        self.host.retained = types.SimpleNamespace(lock=lock)
        self.host.qualify = lambda: self.events.append("qualify")
        def state(_):
            return {"LoadState":"not-found", "MainPID":"0", "ActiveState":"active" if self.started else "inactive",
                    "InvocationID":"a" * 32}
        self.host.legacy = types.SimpleNamespace(state=state)
        self.host.meta = types.SimpleNamespace(file_identity=lambda _: {"fixtureIdentity": True})
        self.host.m = types.SimpleNamespace(env_bytes=lambda value: json.dumps(value).encode(),
                                             process=lambda _: {"fixtureProcess": True})
        def manager(action):
            self.events.append("manager-" + action)
            if action == "start": self.started = True
        self.host.manager = manager
        self.constructor = self.enterContext(patch.object(owner, "Host", return_value=self.host))
        self.operation = self.enterContext(patch.object(owner, "operation", side_effect=self.operation_record))
        self.enterContext(patch.object(owner, "retained_current", side_effect=lambda *_: self.events.append("retained-current")))
        self.enterContext(patch.object(owner, "capacity_preflight", side_effect=self.capacity))
        self.enterContext(patch.object(owner, "unit_bytes", return_value=b"fixture-unit\n"))
        self.enterContext(patch.object(owner, "capacity_policy", return_value={"maximumSeconds":2400}))
        self.enterContext(patch.object(owner, "document", return_value={"preservedGenerations":["103","102"]}))
        original_save = owner.save
        def mapped(path):
            return self.unit_file if Path(path) == Path("/etc/systemd/system") / owner.UNIT else Path(path)
        self.enterContext(patch.object(owner, "save", side_effect=lambda path,value,mode=0o600: original_save(mapped(path),value,mode)))
        def protected(path, expected=None, maximum=4000000):
            path = Path(path)
            raw = b"actual-operation" if path == self.base / "operation.json" else mapped(path).read_bytes()
            if expected is not None: self.assertEqual(hashlib.sha256(raw).hexdigest(), expected)
            return raw
        self.enterContext(patch.object(owner, "protected", side_effect=protected))
        self.reconciler = self.enterContext(patch.object(owner, "reconcile", side_effect=self.reconcile))

    def operation_record(self, host, digest):
        self.assertIs(host, self.host); self.assertEqual(digest, "2" * 64)
        self.events.append("operation")
        return {"actualOperationFixture":True}

    def capacity(self, host):
        self.assertIs(host, self.host); self.capacities += 1; self.events.append("capacity")
        if self.fail_capacity_at == self.capacities: raise RuntimeError("actual_backup_window_no_longer_fits")
        return {"fixtureCapacity":True}

    def reconcile(self, host, operation):
        self.assertIs(host, self.host); self.events.append("readonly-reconcile")
        return {"phase":"running" if self.started else "unknown-start-prefix", "automaticRetryAllowed":False}

    def run_start(self):
        return m.run("1" * 64, "2" * 64, True)

    def test_real_fixed_V2_composition_and_original_bodies_are_unchanged(self):
        self.assertEqual(self.owner.__file__, str(m.OWNER))
        original = load("ypal-ordinary-generation-attempt-v1.py")
        for name in ["build_review", "build", "reconcile", "capacity_preflight", "unit_bytes"]:
            actual = real_owner()
            self.assertEqual(getattr(actual,name).__code__.co_code, getattr(original,name).__code__.co_code, name)
            self.assertEqual(getattr(actual,name).__code__.co_consts, getattr(original,name).__code__.co_consts, name)
        self.assertEqual(len(self.owner.SOURCE_PINS), 164)
        actual = real_owner()
        self.assertEqual(actual.Host.__init__.__code__.co_code, original.Host.__init__.__code__.co_code)
        self.assertEqual(actual.Host.__init__.__code__.co_consts, original.Host.__init__.__code__.co_consts)

    def test_one_Host_same_real_lock_exact_review_then_original_build_repeats_all_checks(self):
        result = self.run_start()
        self.constructor.assert_called_once_with("1" * 64)
        self.operation.assert_called_once_with(self.host, "2" * 64)
        self.assertEqual(self.events.count("qualify"), 3)
        self.assertEqual(self.events.count("retained-current"), 3)
        self.assertEqual(self.events.count("capacity"), 3)
        self.assertEqual(self.events.count("manager-start"), 1)
        self.assertEqual(self.events[0], "lock-enter"); self.assertEqual(self.events[-1], "lock-exit")
        self.assertTrue(result["generationStartedByCaller"])
        self.assertFalse(result["originalMainInvoked"])
        self.assertFalse(result["generationPreparedClaimed"])
        self.assertEqual(set(result["stageDurationsNanoseconds"]), {"hostConstructor", "buildReview", "buildCall"})
        self.assertTrue(all(type(v) is int and v >= 0 for v in result["stageDurationsNanoseconds"].values()))
        review = json.loads((self.caller / "review.json").read_bytes())
        self.assertEqual(review["reviewHash"], self.owner.sha(self.owner.encoded(review["review"])))
        self.assertEqual(result["originalWorkerStartReceiptSha256"], self.owner.sha((self.base / (self.owner.UNIT + "-started.json")).read_bytes()))

    def test_original_second_review_and_prestart_capacity_failure_prevent_start(self):
        self.fail_capacity_at = 2
        with self.assertRaisesRegex(RuntimeError, "actual_backup_window"):
            self.run_start()
        self.assertNotIn("manager-start", self.events)
        failure = json.loads((self.caller / "failure.json").read_bytes())
        self.assertEqual(failure["incompleteStage"], "build-call")
        self.assertEqual(set(failure["stageDurationsNanoseconds"]), {"hostConstructor", "buildReview"})

    def test_backup_failure_after_unit_publication_is_preserved_for_reconcile(self):
        self.fail_capacity_at = 3
        with self.assertRaisesRegex(RuntimeError, "actual_backup_window"): self.run_start()
        self.assertTrue(self.unit_file.exists())
        self.assertNotIn("manager-start", self.events)
        result = self.run_start()
        self.assertTrue(result["readonlyReconciliation"])
        self.reconciler.assert_called_once()
        self.assertNotIn("manager-start", self.events)

    def test_existing_original_prefix_delegates_readonly_without_new_caller_journal(self):
        (self.base / "build-intent.json").write_text("fixture-existing-prefix")
        result = self.run_start()
        self.assertTrue(result["readonlyReconciliation"])
        self.assertFalse(self.caller.exists())
        self.assertEqual(self.capacities, 0)
        self.assertNotIn("manager-start", self.events)

    def test_lost_start_ACK_never_replays_and_original_outcome_is_not_claimed(self):
        def unknown(action):
            self.events.append("manager-" + action)
            if action == "start": self.started = True; raise RuntimeError("new_attempt_manager_ACK_unknown_reconcile_without_retry")
        self.host.manager = unknown
        with self.assertRaisesRegex(RuntimeError, "ACK_unknown"): self.run_start()
        failure = json.loads((self.caller / "failure.json").read_bytes())
        self.assertTrue(failure["originalOutcomeMustBeReconciled"])
        self.assertFalse(failure["generationStartedClaimed"])
        result = self.run_start()
        self.assertTrue(result["readonlyReconciliation"])
        self.assertEqual(self.events.count("manager-start"), 1)

    def test_readonly_mode_and_existing_caller_never_write_or_start(self):
        result = m.run("1" * 64, "2" * 64)
        self.assertTrue(result["readonlyReconciliation"])
        self.assertFalse(self.caller.exists())
        self.assertEqual(self.capacities,0)
        self.assertNotIn("manager-start", self.events)

    def test_bad_actual_input_or_operation_ref_fails_before_Host(self):
        for values in [("0" * 64,"2" * 64), ("1" * 64,"future-operation")]:
            with self.assertRaises(RuntimeError): m.run(*values,True)
        self.constructor.assert_not_called()

    def test_constructor_failure_retains_actual_incomplete_stage_without_build(self):
        self.constructor.side_effect = RuntimeError("actual_source_constructor_refused")
        with self.assertRaisesRegex(RuntimeError, "actual_source_constructor_refused"):
            self.run_start()
        failure = json.loads((self.caller / "failure.json").read_bytes())
        self.assertEqual(failure["incompleteStage"], "host-constructor")
        self.assertEqual(failure["stageDurationsNanoseconds"], {})
        self.assertGreaterEqual(failure["incompleteStageElapsedNanoseconds"], 0)
        self.operation.assert_not_called()
        self.assertFalse((self.base / "build-intent.json").exists())

    def test_default_and_import_are_inert_and_parent_is_explicitly_bounded(self):
        raw = (HERE / m.FILE.name).read_bytes()
        with patch.object(Path,"read_bytes",side_effect=AssertionError("read")), \
             patch.object(Path,"lstat",side_effect=AssertionError("stat")), \
             patch.object(m,"load_owner",side_effect=AssertionError("Host")), contextlib.redirect_stdout(io.StringIO()) as output:
            m.main([])
            exec(compile(raw,"inert_build_session.py","exec"),{"__name__":"inert_build_session"})
        self.assertTrue(json.loads(output.getvalue())["staticOnly"])
        self.assertEqual(m.PARENT_SECONDS,900)


if __name__ == "__main__": unittest.main()
