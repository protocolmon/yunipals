import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("deadline_host_probe", HERE / "probe.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="deadline-host-controls-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.area_parent = root / "areas"
        self.area_parent.mkdir(mode=0o755)
        self.area = self.area_parent / "probe"
        self.base = root / "audit"
        self.bind(p, "AREA", self.area)
        self.bind(p, "BASE", self.base)
        self.actual = json.loads((HERE / "local-build.json").read_text())
        self.actual.update(uid=970, gid=964)
        self.binding = {"source": {"actor": "actual-fixture"}, "peers": {"fresh": "same"}}
        self.native = {"safe": 10, "latest": 11}
        self.value = {"binding": {"operatorSha256": "a" * 64, "current": self.binding},
                      "reviewHash": "b" * 64, "native": self.native, "localBuild": self.actual}
        self.calls = []
        self.saved = []
        self.chowns = []
        self.sdk = types.SimpleNamespace(lock=contextlib.nullcontext, sync=lambda _: None,
            save=self.save, command=self.command, protected=lambda path: Path(path).read_bytes())
        self.host = types.SimpleNamespace(s=types.SimpleNamespace(resources=lambda: {"reserve": "passed"}))
        self.runtime = types.SimpleNamespace(recovery_floor=self.floor)
        self.snapshots = 0
        self.mutate_after = lambda value: None
        self.bind(p, "review", lambda: (copy.deepcopy(self.value), (None, self.runtime, self.sdk, self.host)))
        self.bind(p, "snapshot", self.snapshot)
        self.bind(p, "unit_state", lambda _: {"LoadState": "not-found", "ActiveState": "inactive",
            "MainPID": "0", "ControlPID": "0", "Job": ""})
        self.bind(p.os, "chown", lambda path, uid, gid: self.chowns.append((path, uid, gid)))
        self.bind(p.time, "sleep", lambda _: None)

    def bind(self, target, name, value):
        change = patch.object(target, name, value)
        change.start()
        self.addCleanup(change.stop)

    def save(self, path, value):
        self.saved.append(path)
        with path.open("xb") as stream:
            stream.write(value if isinstance(value, bytes) else p.encoded(value))

    def command(self, argv, timeout):
        self.assertEqual(argv, p.command())
        self.assertEqual(timeout, 150)
        self.calls.append(argv)
        return p.encoded(self.actual)

    def snapshot(self, _):
        self.snapshots += 1
        value = {"binding": copy.deepcopy(self.binding), "native": copy.deepcopy(self.native)}
        if self.snapshots > 1:
            self.mutate_after(value)
        return value, None

    def floor(self, before, after):
        p.need(after["safe"] >= before["safe"], "synthetic_recovery_floor_regressed")

    def test_exact_build_rejects_wrong_runtime_pool_fixtures_and_hashes(self):
        self.assertEqual(p.validate_build(self.actual), self.actual)
        for key, value in [("buildId", "foreign"), ("effectivePoolMax", 8), ("interceptedFixtureRequests", 11),
                           ("socketAttempts", 1), ("databaseCalls", 1), ("candidateTransportSha256", "f" * 64)]:
            changed = {**self.actual, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "same_build"):
                p.validate_build(changed)

    def test_plan_has_exact_six_mounts_and_one_isolated_clean_build(self):
        argv = p.command()
        self.assertEqual(argv[0], "/usr/bin/systemd-run")
        self.assertIn("--unit=" + p.UNIT, argv)
        for required in ["--collect", "--wait", "--property=PrivateNetwork=yes", "--property=IPAddressDeny=any",
                         "--property=ProtectSystem=strict", "--property=RestrictAddressFamilies=AF_UNIX",
                         "--property=CapabilityBoundingSet=", "--property=AmbientCapabilities=",
                         "--property=RuntimeMaxSec=120", "--property=MemoryMax=2147483648"]:
            self.assertIn(required, argv)
        for prefix in ["--property=BindPaths=", "--property=BindReadOnlyPaths="]:
            values = [arg[len(prefix):] for arg in argv if arg.startswith(prefix)]
            self.assertEqual(len(values), 1)
            self.assertEqual(len(values[0].split()), 3)
        env = argv.index("/usr/bin/env")
        self.assertEqual(argv[env + 1], "-i")
        files = [arg for arg in argv if arg.startswith("--env-file=")]
        self.assertEqual(files, ["--env-file=" + str(p.OPS / "ypal-combined-source-v1-stage/combined.public.env")])
        self.assertFalse(any("PRIVATE" in arg or "enable" == arg or "restart" == arg for arg in argv))

    def test_foreign_review_refuses_before_any_scaffold_or_command(self):
        with self.assertRaisesRegex(RuntimeError, "exact_current_readonly_review"):
            p.run("c" * 64)
        self.assertFalse(self.base.exists())
        self.assertFalse(self.area.exists())
        self.assertEqual(self.calls, [])

    def test_run_accepts_one_build_without_reusing_live_writable_paths(self):
        result = p.run("b" * 64)
        self.assertTrue(result["completed"])
        self.assertEqual(len(self.calls), 1)
        self.assertTrue((self.base / "intent.json").exists())
        self.assertTrue((self.base / "result.json").exists())
        self.assertEqual(result["actualResultSha256"], p.sha((self.base / "result.json").read_bytes()))
        self.assertTrue(all(path.is_relative_to(self.area / "cache") and uid == 970 and gid == 964
                            for path, uid, gid in self.chowns))
        self.assertEqual(len(self.chowns), 4)
        self.assertEqual(result["sourceActions"], 0)
        self.assertFalse(result["runningTransportChanged"])

    def test_progressing_native_observation_does_not_invalidate_stable_runtime(self):
        self.mutate_after = lambda value: value["native"].update(safe=20, latest=22)
        self.assertTrue(p.run("b" * 64)["completed"])

    def test_changed_peer_cannot_receive_success_receipt(self):
        self.mutate_after = lambda value: value["binding"]["peers"].update(fresh="foreign")
        with self.assertRaisesRegex(RuntimeError, "must_remain_unchanged"):
            p.run("b" * 64)
        self.assertEqual(len(self.calls), 1)
        self.assertTrue((self.base / "command-result.json").exists())
        self.assertFalse((self.base / "result.json").exists())

    def test_regressing_recovery_floor_cannot_receive_success_receipt(self):
        self.mutate_after = lambda value: value["native"].update(safe=9)
        with self.assertRaisesRegex(RuntimeError, "floor_regressed"):
            p.run("b" * 64)
        self.assertFalse((self.base / "result.json").exists())

    def test_unknown_command_acknowledgement_cannot_start_second_build(self):
        def timed_out(argv, timeout):
            self.calls.append(argv)
            raise TimeoutError("synthetic observation expired")
        self.sdk.command = timed_out
        with self.assertRaises(TimeoutError):
            p.run("b" * 64)
        self.assertTrue((self.base / "intent.json").exists())
        with self.assertRaisesRegex(RuntimeError, "before_owned_intent"):
            p.run("b" * 64)
        self.assertEqual(len(self.calls), 1)

    def test_uncollected_transient_cannot_receive_success_receipt(self):
        count = 0
        def state(_):
            nonlocal count
            count += 1
            return {"LoadState": "not-found" if count == 1 else "loaded", "ActiveState": "inactive",
                    "MainPID": "0", "ControlPID": "0", "Job": ""}
        self.bind(p, "unit_state", state)
        with self.assertRaisesRegex(RuntimeError, "must_be_collected"):
            p.run("b" * 64)
        self.assertFalse((self.base / "result.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
