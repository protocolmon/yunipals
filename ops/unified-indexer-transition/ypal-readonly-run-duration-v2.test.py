"""Exact public bridge bytes, retained observer and explicit child-I/O fixtures."""
import ast
import copy
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
FILE = HERE / "ypal-readonly-run-duration-v2.py"
spec = importlib.util.spec_from_file_location("readonly_timer2_controls", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def public(path, digest):
    raw = (HERE / Path(path).name).read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise RuntimeError("actual_public_source_fixture_digest_required")
    return raw


def need(value, code):
    if not value:
        raise RuntimeError(code)


class Controls(unittest.TestCase):
    def reference(self):
        with patch.object(m, "public", side_effect=public):
            return m.references()

    def factory(self, base, argv):
        return patch.object(m, "references", return_value=(base, argv))

    def original(self, base, action):
        def run(*args, **kwargs):
            return action(args, kwargs)
        run.__module__ = "subprocess"
        self.enterContext(patch.object(base, "_STDLIB_RUN", run))
        self.enterContext(patch.object(subprocess, "run", run))
        return run

    def test_all_actual_sources_authenticate_before_eval_and_default_is_inert(self):
        seen = []
        def observe(path, digest):
            seen.append(Path(path).name)
            return public(path, digest)
        with patch.object(m, "public", side_effect=observe):
            base, argv = m.references()
        self.assertEqual(seen, list(m.SOURCE_PINS))
        self.assertEqual(base.FORMAT, "yunipals-readonly-run-duration-v1")
        self.assertEqual(hashlib.sha256(argv[-1].encode()).hexdigest(), m.BRIDGE_SHA)
        for refused in m.SOURCE_PINS:
            def refuse(path, digest):
                if Path(path).name == refused:
                    raise RuntimeError("actual_missing_or_modified_public_source")
                return public(path, digest)
            with self.subTest(source=refused), patch.object(m, "public", side_effect=refuse), self.assertRaises(RuntimeError):
                m.references()
        result = subprocess.run([sys.executable, "-I", "-B", str(FILE)], capture_output=True, timeout=5, check=True)
        self.assertTrue(json.loads(result.stdout)["staticOnly"])
        self.assertFalse(json.loads(result.stdout)["subprocessObserverInstalled"])

    def test_expected_bridge_is_actual_counted_V5_transform_not_raw_template(self):
        _, argv = self.reference()
        raw = public(m.OPS / m.GENERATION, m.SOURCE_PINS[m.GENERATION])
        tree = ast.parse(raw)
        original = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "BRIDGE" for t in n.targets))
        old = ast.literal_eval(original.value)
        self.assertNotEqual(old, argv[-1])
        v5 = ast.parse(public(m.OPS / m.ORDINARY, m.SOURCE_PINS[m.ORDINARY]))
        namespace = next(n for n in v5.body if isinstance(n, ast.FunctionDef) and n.name == "namespace")
        transform = next(n for n in namespace.body if isinstance(n, ast.FunctionDef) and n.name == "transform")
        scope = {"ast": ast, "need": need, "changes": {"capsule-import": 0}}
        exec(compile(ast.Module(body=[transform], type_ignores=[]), str(m.OPS / m.ORDINARY), "exec"), scope)
        changed = scope["transform"](copy.deepcopy(original))
        self.assertEqual(scope["changes"]["capsule-import"], 1)
        self.assertEqual(ast.literal_eval(changed.value), argv[-1])
        self.assertEqual(argv[:6], ("/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "/usr/bin/env", "-i"))

    def test_complete_frozen_observer_bodies_are_inherited(self):
        base, argv = self.reference()
        with self.factory(base, argv):
            observed = m.RunDurations()
        parent = type(observed).__mro__[1]
        self.assertIs(parent, base.RunDurations)
        for name in ["__init__", "__enter__", "__exit__", "_observe", "_finish"]:
            self.assertIs(getattr(type(observed), name), getattr(base.RunDurations, name))

    def test_genuine_read_bridge_both_phases_match_same_family_with_unchanged_transport(self):
        base, argv = self.reference()
        raw = public(m.OPS / m.GENERATION, m.SOURCE_PINS[m.GENERATION])
        fn = next(n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name == "read_bridge")
        capsule = (HERE / "ypal-ordinary-generation-recovery-semantic-v1.mjs").read_bytes()
        guard = (HERE / "ypal-ordinary-cache-transition-v5.mjs").read_bytes()
        encoded = lambda value: (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        scope = {"need": need, "sha": lambda value: hashlib.sha256(value).hexdigest(), "CAPSULE": Path("/public/capsule"),
                 "GUARD": Path("/public/guard"), "CAPSULE_SHA": hashlib.sha256(capsule).hexdigest(),
                 "GUARD_SHA": hashlib.sha256(guard).hexdigest(), "BRIDGE": argv[-1], "encoded": encoded,
                 "subprocess": subprocess, "json": json}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), str(m.OPS / m.GENERATION), "exec"), scope)
        h = types.SimpleNamespace(s=types.SimpleNamespace(protected=lambda p: capsule if p == scope["CAPSULE"] else guard),
                                  m=types.SimpleNamespace(CLEAN={"PATH": "/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"},
                                                          NODE="/opt/node-v24.18.1/bin/node", PROJECT=Path("/public/project")))
        calls = []
        def transport(args, kwargs):
            calls.append((args, kwargs))
            return subprocess.CompletedProcess(args[0], 0, b'{"result":{"explicitChildIOFixture":true}}', b"")
        original = self.original(base, transport)
        with self.factory(base, argv), patch.object(pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=111, pw_gid=113)), patch.object(grp, "getgrnam", return_value=types.SimpleNamespace(gr_gid=113)):
            observer = m.RunDurations()
            with observer:
                for phase in ["verify-capsule", "observe"]:
                    value = scope["read_bridge"](h, phase, {"receipt": {"explicitPrivateReceiptIOFixture": True}})
                    self.assertTrue(value["explicitChildIOFixture"])
        self.assertIs(subprocess.run, original)
        rows = observer.snapshot()["calls"]
        self.assertEqual([row["publicCommandFamily"] for row in rows], ["generation-recovery-read-bridge"] * 2)
        for phase, (args, kwargs) in zip(["verify-capsule", "observe"], calls):
            self.assertEqual(tuple(args[0]), argv)
            self.assertEqual(kwargs["timeout"], 90)
            self.assertTrue(kwargs["capture_output"])
            self.assertIs(kwargs["env"], h.m.CLEAN)
            self.assertEqual(json.loads(kwargs["input"])["phase"], phase)
        snapshot = observer.snapshot()
        self.assertFalse(snapshot["stdinReadOrParsed"])
        self.assertFalse(snapshot["bridgePhaseClassified"])
        self.assertNotIn("explicitPrivateReceiptIOFixture", json.dumps(snapshot))
        self.assertNotIn(argv[-1], json.dumps(snapshot))

    def test_every_shape_or_public_byte_mutation_remains_unclassified_without_inspecting_input(self):
        _, argv = self.reference()
        self.assertEqual(m.command_family((list(argv),), {}, argv), "generation-recovery-read-bridge")
        self.assertEqual(m.command_family((), {"args": argv}, argv), "generation-recovery-read-bridge")
        for index in range(len(argv)):
            changed = list(argv)
            changed[index] += "changed"
            with self.subTest(index=index):
                self.assertEqual(m.command_family((changed,), {}, argv), "unclassified")
        class Private:
            def __iter__(self):
                raise AssertionError("no private iteration")
            def __str__(self):
                raise AssertionError("no private stringification")
            def __eq__(self, other):
                raise AssertionError("no private comparison")
        self.assertEqual(m.command_family((Private(),), {"input": Private()}, argv), "unclassified")
        self.assertEqual(m.command_family(([Private()] * len(argv),), {"input": Private()}, argv), "unclassified")
        self.assertEqual(m.command_family((argv,), {"input": Private()}, argv), "generation-recovery-read-bridge")

    def test_family_bookkeeping_refusal_preserves_original_return_and_exception(self):
        base, argv = self.reference()
        result = object()
        original = self.original(base, lambda *_: result)
        with self.factory(base, argv), patch.object(m, "command_family", side_effect=ValueError("diagnosticRefusal")):
            observer = m.RunDurations()
            with observer:
                self.assertIs(subprocess.run(list(argv), input=object(), timeout=90), result)
        self.assertIs(subprocess.run, original)
        self.assertEqual(observer.snapshot()["bookkeepingErrors"], 1)
        error = PermissionError("originalFixtureRefusal")
        def fail(*_):
            raise error
        original = self.original(base, fail)
        with self.factory(base, argv), patch.object(m, "command_family", side_effect=ValueError("diagnosticRefusal")):
            observer = m.RunDurations()
            with self.assertRaises(PermissionError) as caught:
                with observer:
                    subprocess.run(list(argv), input=object(), timeout=90)
        self.assertIs(caught.exception, error)
        self.assertIs(subprocess.run, original)

    def test_unknown_real_child_and_real_timeout_keep_original_results_and_cleanup(self):
        base, argv = self.reference()
        original = subprocess.run
        with self.factory(base, argv):
            observer = m.RunDurations()
            with observer:
                value = subprocess.run([sys.executable, "-I", "-B", "-c", "import sys;sys.stdout.buffer.write(sys.stdin.buffer.read());sys.exit(7)"], input=b"private-local-fixture", capture_output=True, timeout=5)
            self.assertEqual((value.returncode, value.stdout), (7, b"private-local-fixture"))
            self.assertEqual(observer.snapshot()["calls"][0]["publicCommandFamily"], "unclassified")
            observer = m.RunDurations()
            with self.assertRaises(subprocess.TimeoutExpired):
                with observer:
                    subprocess.run([sys.executable, "-I", "-B", "-c", "import time;time.sleep(1)"], timeout=0.05)
        self.assertIs(subprocess.run, original)
        self.assertNotIn("private-local-fixture", json.dumps(observer.snapshot()))

    def test_cap_external_deadline_and_no_authority_or_stack_hooks(self):
        base, argv = self.reference()
        calls = []
        original = self.original(base, lambda *values: calls.append(values) or None)
        with self.factory(base, argv):
            observer = m.RunDurations(maximum_calls=1)
            with observer:
                subprocess.run(list(argv))
                subprocess.run(list(argv))
            self.assertEqual(len(calls), 2)
            self.assertEqual(observer.snapshot()["droppedCalls"], 1)
            observer = m.RunDurations()
            error = RuntimeError("externalDeadlineFixture")
            with patch.object(m, "command_family", side_effect=error), self.assertRaises(RuntimeError) as caught:
                with observer:
                    subprocess.run(list(argv))
            self.assertIs(caught.exception, error)
        self.assertIs(subprocess.run, original)
        snapshot = observer.snapshot()
        for key in ["stdinReadOrParsed", "bridgePhaseClassified", "rawArgumentsOrCodeRetained", "stackOrFrameHooksInstalled",
                    "timingQualificationClaimed", "currentOrSourceOrMetadataQualified", "SQLAuthorityQualified", "effectsDispatchedByObserver"]:
            self.assertIs(snapshot[key], False)
        tree = ast.parse(FILE.read_bytes())
        called = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
        for name in ["sys._getframe", "sys.settrace", "sys.setprofile", "subprocess.Popen", "host.refresh", "host.prerequisites"]:
            self.assertNotIn(name, called)


if __name__ == "__main__":
    unittest.main(verbosity=2)
