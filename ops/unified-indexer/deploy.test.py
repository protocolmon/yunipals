#!/usr/bin/env python3
"""Local filesystem and dispatch controls; no systemd, SQL or network calls."""
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("cold_deploy", HERE / "deploy.py")
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
OLD = HERE.parent / "unified-indexer-transition"


class DeployTests(unittest.TestCase):
    def test_timer_and_missing_units_have_no_service_pid_properties(self):
        for unit, load in ((D.TIMERS[0], "loaded"), (D.WRITERS[0], "not-found")):
            raw = ("Id=" + unit + "\nLoadState=" + load +
                   "\nActiveState=inactive\nSubState=dead\nJob=\nInvocationID=\n").encode()
            with patch.object(D, "run", return_value=raw):
                value = D.state(unit)
                self.assertEqual(value["MainPID"], "0")
                self.assertEqual(value["ControlPID"], "0")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=HERE)
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def selector_fixture(self):
        files = {}
        for name, expected in D.RUNTIME_FILES.items():
            raw = (HERE.parent.parent / name).read_bytes()
            self.assertEqual(D.digest(raw), expected)
            files[str(D.INSTALL_ROOT / name)] = raw
        files[str(D.OPS / "staking-support-native-v1.service.example")] = (OLD / "staking-support-native-v1.service.example").read_bytes()
        receipt = {"staged": True, "readSchema": D.READ, "readIdentity": D.IDENTITY, "files": {}}
        for unit, name in ((D.CACHE, "yunipals-read-cache.ownership.env"), (D.LEADER, "yunipals-leaderboard.selectors.env")):
            raw = ("DATABASE_SCHEMA='" + D.PHYSICAL + "'\nOWNERSHIP_READ_SCHEMA='" + D.READ +
                   "'\nOWNERSHIP_RELEASE_ID='" + D.RELEASE + "'\n").encode()
            drop = ("[Service]\nEnvironmentFile=" + str(D.CANDIDATES / name) + "\n").encode()
            for filename, body in ((name, raw), (unit + ".drop-in.candidate", drop)):
                files[str(D.CANDIDATES / filename)] = body
                receipt["files"][filename] = D.digest(body)
        raw = json.dumps(receipt).encode()
        files[str(D.CANDIDATES / "result.json")] = raw

        def read(path, expected=None):
            result = files[str(path)]
            if expected is not None:
                D.need(D.digest(result) == expected, "fixture digest mismatch")
            return result
        return files, receipt, D.digest(raw), read

    def test_public_candidates_and_exact_staking_selector_retarget(self):
        files, receipt, sha, read = self.selector_fixture()
        output = D.configuration(sha, "0123456789", read)
        self.assertEqual(len(output), 6)
        unit = output[str(D.SYSTEM / D.PARENT)]
        self.assertIn(b"/opt/yunipals-unified/indexer/scripts/start-indexer.mjs --env-file=/etc/yunipals-unified/indexer.service.env", unit)
        self.assertNotIn(b"/launcher.mjs", unit)
        self.assertNotIn(b"service.public.env", unit)
        original = (OLD / "ypal-ordinary-managed-indexer-v1/yunipals-indexer.service.example").read_bytes()
        projected = unit.replace(
            b"ExecStart=/opt/node-v24.18.1/bin/node /opt/yunipals-unified/indexer/scripts/start-indexer.mjs --env-file=/etc/yunipals-unified/indexer.service.env\n",
            b"ExecStart=/opt/node-v24.18.1/bin/node /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-managed-indexer-v1/launcher.mjs\n")
        projected = projected.replace(b"EnvironmentFile=\n", b"EnvironmentFile=\nEnvironmentFile=/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-managed-indexer-v1/service.public.env\n", 1)
        self.assertEqual(projected, original)
        before = files[str(D.OPS / "staking-support-native-v1.service.example")]
        after = output[str(D.SYSTEM / D.STAKING)]
        for old, new in (("unified_shadow_20261020_7e7375b0", D.PHYSICAL),
                         ("yunipals_ownership_35cdcb32_v3", D.READ),
                         ("0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c", D.RELEASE),
                         ("0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc", D.IDENTITY),
                         ("bf4939b3ff", "0123456789")):
            after = after.replace(new.encode(), old.encode())
        self.assertEqual(after, before)
        self.assertNotIn(b"Persistent=true", output[str(D.SYSTEM / D.TIMERS[1])])

    def test_selector_private_key_and_digest_drift_refuse(self):
        files, receipt, sha, read = self.selector_fixture()
        files[str(D.CANDIDATES / "yunipals-read-cache.ownership.env")] += b"DATABASE_URL='private'\n"
        with self.assertRaises(RuntimeError):
            D.configuration(sha, "0123456789", read)
        name = "yunipals-read-cache.ownership.env"
        receipt["files"][name] = D.digest(files[str(D.CANDIDATES / name)])
        raw = json.dumps(receipt).encode()
        files[str(D.CANDIDATES / "result.json")] = raw
        with self.assertRaisesRegex(RuntimeError, "public V5"):
            D.configuration(D.digest(raw), "0123456789", read)

    def test_stop_order_and_single_parent_start_after_all_old_writers(self):
        commands, records = [], []
        value = {"LoadState": "loaded", "MainPID": "0", "ControlPID": "0", "InvocationID": "old"}
        with patch.object(D, "state", return_value=value), patch.object(D, "terminal", return_value=value), \
             patch.object(D, "unit_processes", return_value=[]), patch.object(D, "run", side_effect=lambda a, t: commands.append(a)):
            D.stop_all(lambda name, data: records.append(name))
            D.start(D.PARENT, lambda name, data: records.append(name))
        self.assertEqual([args[3:] for args in commands[:-1]], [list(group) for group in D.STOP_GROUPS])
        self.assertEqual(commands[-1], ["/usr/bin/systemctl", "start", "--no-block", D.PARENT])
        self.assertEqual(records[-2:], ["stop-4-complete", "start-" + D.PARENT + "-intent"])
        self.assertNotIn(D.METADATA, sum(D.STOP_GROUPS, ()))

    def test_foreign_writer_and_failed_intent_block_start(self):
        with patch.object(D, "terminal", side_effect=RuntimeError("writer alive")), patch.object(D, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "writer alive"):
                D.start(D.PARENT, Mock())
            command.assert_not_called()
        with patch.object(D, "terminal", return_value={"InvocationID": "old"}), patch.object(D, "run") as command:
            with self.assertRaisesRegex(OSError, "disk full"):
                D.start(D.PARENT, Mock(side_effect=OSError("disk full")))
            command.assert_not_called()

    def test_real_atomic_install_backs_up_bytes_and_retains_private_files(self):
        system = self.root / "system"
        system.mkdir()
        private = self.root / "private.env"
        private.write_bytes(b"UNCHANGED=private\n")
        with patch.object(D, "SYSTEM", system), patch.object(D, "SERVICE_ENV", self.root / "indexer.service.env"):
            _, _, sha, read = self.selector_fixture()
            files = D.configuration(sha, "0123456789", read)
            for name in files:
                path = Path(name)
                path.parent.mkdir(exist_ok=True)
                path.write_bytes(b"original public bytes\n")
            records = []
            with patch.object(D, "terminal"), patch.object(D, "run"):
                D.install_public(files, lambda n, v: records.append((n, v)), self.root / "backup")
            self.assertEqual([p.read_bytes() for p in (self.root / "backup").iterdir()], [b"original public bytes\n"] * 6)
            self.assertEqual({name: Path(name).read_bytes() for name in files}, files)
            self.assertEqual(private.read_bytes(), b"UNCHANGED=private\n")
            self.assertEqual(len({name for name, _ in records}), 12)
            self.assertTrue(all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in (self.root / "backup").iterdir()))

    def test_real_unit_masks_and_parent_override_retirement(self):
        system = self.root / "system"
        system.mkdir()
        for unit in (*D.WRITERS, *D.OLD_ARENA, "yunipals-islands-staking.service"):
            (system / unit).write_bytes((unit + "\n").encode())
        override = system / (D.PARENT + ".d")
        override.mkdir()
        old_drop = override / "98-monorepo.conf"
        old_drop.write_bytes(b"[Service]\nExecStart=old\n")
        metadata = system / D.METADATA
        metadata.write_bytes(b"retained metadata")
        with patch.object(D, "SYSTEM", system), patch.object(D, "terminal"), \
             patch.object(D, "run", side_effect=lambda a, t: (str(old_drop) + "\n").encode() if "--value" in a else b""):
            D.retire_old_units(Mock(), self.root / "retired")
        self.assertTrue(all((system / unit).is_symlink() and (system / unit).readlink() == Path("/dev/null")
                            for unit in (*D.WRITERS, *D.OLD_ARENA, "yunipals-islands-staking.service")))
        self.assertFalse(old_drop.exists())
        self.assertEqual(metadata.read_bytes(), b"retained metadata")
        self.assertIn(b"[Service]\nExecStart=old\n", [p.read_bytes() for p in (self.root / "retired").iterdir()])

    def test_read_public_rejects_symlink_and_changed_digest(self):
        path = self.root / "public"
        path.write_bytes(b"public")
        self.assertEqual(D.read_public(path, D.digest(b"public")), b"public")
        link = self.root / "link"
        link.symlink_to(path)
        with self.assertRaises(RuntimeError):
            D.read_public(link)
        with self.assertRaises(RuntimeError):
            D.read_public(path, "0" * 64)


if __name__ == "__main__":
    unittest.main()
