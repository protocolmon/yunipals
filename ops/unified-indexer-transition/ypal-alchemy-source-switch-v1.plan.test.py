#!/usr/bin/env python3
"""Real filesystem recovery and bounded Alchemy plan controls; no providers."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).absolute().parent
SPEC = importlib.util.spec_from_file_location("alchemy_switch_plan", HERE / "ypal-alchemy-source-switch-v1.plan.py")
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)


def fixture():
    start = 1792857600000
    utc = ((start // 86400000) + 1) * 86400000
    end = min(start + 28800000, utc - 900000)
    allocations = {1: 1000000, 56: 9000000, 137: 2000000, 8453: 3000000}
    return {
        "format": "yunipals-ypal-alchemy-catchup-financial-v1-plan", "profileId": p.PROFILE,
        "automaticRenewal": False, "normalDaily10MApproved": False, "maximumSeconds": 28800,
        "originalAllowanceCu": "20000000", "maximumAdditionalBookedCu": "15000000",
        "startMs": start, "expiresMs": end, "nextUtcMs": utc,
        "permits": [{"chainId": chain, "permitId": "0x" + p.sha(str(chain).encode()), "profileId": p.PROFILE,
                     "enabled": True, "spentCu": "0", "expiresMs": end, "reviewedMs": start,
                     "maximumCu": str(maximum)} for chain, maximum in allocations.items()]
    }


class Plan(unittest.TestCase):
    def test_exact_four_chain_partition_without_new_ongoing_budget(self):
        value = fixture()
        self.assertEqual(set(p.validate_plan(value)), set(p.CHAINS))
        for key, wrong in [("automaticRenewal", True), ("normalDaily10MApproved", True),
                           ("maximumAdditionalBookedCu", "20000000"), ("originalAllowanceCu", "25000000")]:
            changed = copy.deepcopy(value); changed[key] = wrong
            with self.subTest(key=key), self.assertRaises(RuntimeError): p.validate_plan(changed)

    def test_cross_utc_and_missing_shutdown_margin_refused(self):
        for end in [fixture()["nextUtcMs"], fixture()["nextUtcMs"] + 1, fixture()["startMs"] + 1000]:
            value = fixture(); value["expiresMs"] = end
            for row in value["permits"]: row["expiresMs"] = end
            with self.subTest(end=end), self.assertRaises(RuntimeError): p.validate_plan(value)

    def test_chain_permit_transplant_and_noncanonical_amount_refused(self):
        for field, replacement in [("permitId", fixture()["permits"][1]["permitId"]), ("maximumCu", "+1000000"),
                                   ("chainId", True), ("spentCu", "1"), ("profileId", "0x" + "f" * 64)]:
            value = fixture(); value["permits"][0][field] = replacement
            with self.subTest(field=field), self.assertRaises(RuntimeError): p.validate_plan(value)

    def test_source_public_environment_has_only_four_scoped_permits(self):
        value = fixture(); rows = p.validate_plan(value)
        actual = dict(line.split("=", 1) for line in p.source_environment(value).decode().splitlines())
        self.assertEqual(actual, {"UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(p.CHAINS[chain]): row["permitId"]
                                  for chain, row in rows.items()})

    def test_proxy_last_environment_file_overrides_earlier_free_flag(self):
        for chain in p.CHAINS:
            actual = p.proxy_drop(chain).decode().splitlines()
            self.assertEqual(actual.count("ExecStart="), 1)
            self.assertIn("EnvironmentFile=" + str(p.STAGE / (chain + ".public.env")), actual)
            self.assertNotIn("Environment=", "\n".join(actual))
            flags = dict(line.split("=", 1) for line in p.proxy_environment(chain).decode().splitlines())
            self.assertEqual(flags["MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY"], "true")
            self.assertEqual(flags["MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS"], "false")

    def test_source_keeps_pool5_config_booster_backing_and_writable_mounts(self):
        raw = p.source_drop().decode()
        self.assertIn("ypal-combined-source-v1-stage/ponder.config.ts:", raw)
        self.assertIn("ypal-combined-source-v1-stage/booster-config.ts:", raw)
        self.assertIn("ypal-rpc-deadline-host-build-v1/rpc-preflight.ts:", raw)
        self.assertNotIn("BindPaths=", raw)
        self.assertNotIn("pool8", raw)

    def test_exact_deadline_targets_and_real_oneshot_timeout(self):
        value = fixture(); digest = p.sha(p.encoded(value)); definitions = p.deadline_definitions(value, digest)
        self.assertEqual(len(definitions), 4)
        for label, due in [("close", value["expiresMs"]), ("utc", value["nextUtcMs"])]:
            stem = "yunipals-alchemy-catchup-" + label + "-v1"
            lines = definitions[stem + ".service"].decode().splitlines()
            self.assertIn("TimeoutStartSec=900", lines)
            self.assertIn("TimeoutStopSec=90", lines)
            self.assertIn("ExecStart=/usr/bin/python3 -I -B " + str(p.LIFECYCLE) + " --deadline-" + label + " " + digest, lines)
            self.assertNotIn("RuntimeMaxSec=900", lines)
            timer = definitions[stem + ".timer"].decode().splitlines()
            self.assertIn("OnCalendar=" + p.calendar(due), timer)
            self.assertIn("Unit=" + stem + ".service", timer)
            self.assertIn("Persistent=true", timer)
        with self.assertRaises(RuntimeError): p.deadline_definitions(value, "f" * 64)


class Filesystem(unittest.TestCase):
    def setUp(self):
        # Production uses protected /var paths. The shared /tmp parent is
        # intentionally outside this journal's accepted protection boundary.
        self.temp = tempfile.TemporaryDirectory(prefix=".alchemy-journal-", dir=HERE)
        self.base = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_original_wire_bytes_and_exclusive_intent_survive_lost_ack(self):
        path = self.base / "intent.json"
        raw = b'{ "wire": [3, 1], "key": "exact" }\n'
        record = p.exclusive(path, raw)
        self.assertEqual(p.read(path, record["sha256"]), raw)
        with self.assertRaises(FileExistsError): p.exclusive(path, b'{}\n')
        self.assertEqual(p.read(path), raw)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_symlink_hardlink_and_byte_drift_refused(self):
        target = self.base / "original.json"; record = p.exclusive(target, b'{}\n')
        link = self.base / "alias.json"; link.symlink_to(target)
        with self.assertRaises(RuntimeError): p.read(link)
        link.unlink(); os.link(target, link)
        with self.assertRaises(RuntimeError): p.read(target)
        link.unlink(); target.write_bytes(b'{"changed":true}\n')
        with self.assertRaises(RuntimeError): p.read(target, record["sha256"])

    def test_owned_move_fsyncs_both_dirs_preserves_inode_and_cannot_overwrite(self):
        source_dir = self.base / "source"; source_dir.mkdir()
        hold = self.base / "hold"; hold.mkdir()
        source = source_dir / "drop.conf"; target = hold / "drop.conf"
        record = p.exclusive(source, b'[Service]\n')
        calls = []; real = p.sync
        with patch.object(p, "sync", side_effect=lambda path: (calls.append(Path(path)), real(path))[1]):
            moved = p.move_owned(source, target, record)
        self.assertEqual(calls, [source_dir, hold])
        self.assertEqual(moved["identity"]["st_ino"], record["identity"]["st_ino"])
        self.assertFalse(source.exists())
        other = source_dir / "other.conf"; other_record = p.exclusive(other, b'[Service]\n')
        with self.assertRaises(OSError): p.move_owned(other, target, other_record)
        self.assertEqual(p.read(target), b'[Service]\n')

    def test_unknown_changed_inode_cannot_be_parked(self):
        path = self.base / "drop.conf"; old = p.exclusive(path, b'one\n')
        path.unlink(); p.exclusive(path, b'two\n')
        with self.assertRaises(RuntimeError): p.move_owned(path, self.base / "held", old)
        self.assertEqual(p.read(path), b'two\n')

    def test_default_cli_has_no_host_side_effects(self):
        result = subprocess.run(["python3", "-I", "-B", str(HERE / "ypal-alchemy-source-switch-v1.plan.py")],
                                capture_output=True, check=True, text=True, timeout=5)
        value = json.loads(result.stdout)
        self.assertTrue(value["sourceOnly"])
        self.assertFalse(value["sourceLifecycleQualified"])
        self.assertEqual((value["databaseWrites"], value["serviceActions"], value["providerCalls"]), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
