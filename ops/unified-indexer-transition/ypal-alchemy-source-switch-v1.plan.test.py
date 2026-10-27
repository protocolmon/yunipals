#!/usr/bin/env python3
"""Real filesystem recovery and bounded Alchemy plan controls; no providers."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shlex
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
            mixed = chain == "bnb"
            self.assertEqual(flags["MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY"], "false" if mixed else "true")
            self.assertEqual(flags["MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS"], "true" if mixed else "false")
            self.assertEqual(p.proxy_mode(chain), "paid_logs_free_blocks" if mixed else "paid_primary")

    def test_source_keeps_pool5_config_booster_backing_and_writable_mounts(self):
        raw = p.source_drop().decode()
        self.assertIn("ypal-combined-source-v1-stage/ponder.config.ts:", raw)
        self.assertIn("ypal-combined-source-v1-stage/booster-config.ts:", raw)
        self.assertIn("ypal-rpc-deadline-host-build-v1/rpc-preflight.ts:", raw)
        self.assertNotIn("BindPaths=", raw)
        self.assertNotIn("pool8", raw)

    def test_source_command_preserves_original_argv_with_one_fourth_node_env_file(self):
        original = (HERE / "ypal-combined-source-v1/yunipals-ypal-combined-source.service.example").read_text()
        retained = next(line for line in original.splitlines() if line.startswith("ExecStart="))[len("ExecStart="):]
        command = next(line for line in p.source_drop().decode().splitlines() if line.startswith("ExecStart=/"))[len("ExecStart="):]
        before, after = shlex.split(retained), shlex.split(command)
        addition = "--env-file=" + str(p.STAGE / "source.public.env")
        self.assertEqual(after.count(addition), 1)
        self.assertEqual([arg for arg in after if arg != addition], before)
        files = [arg for arg in after if arg.startswith("--env-file=")]
        self.assertEqual(len(files), 4)
        self.assertEqual(files[-1], addition)
        self.assertNotIn("EnvironmentFile=", p.source_drop().decode())

    def test_exact_deadline_targets_and_real_oneshot_timeout(self):
        value = fixture(); digest = p.sha(p.encoded(value)); definitions = p.deadline_definitions(value, digest)
        self.assertEqual(len(definitions), 4)
        for label, due in [("close", value["expiresMs"]), ("utc", value["nextUtcMs"])]:
            stem = "yunipals-alchemy-catchup-" + label + "-v1"
            lines = definitions[stem + ".service"].decode().splitlines()
            self.assertIn("TimeoutStartSec=900", lines)
            self.assertIn("TimeoutStopSec=90", lines)
            self.assertIn("PrivateTmp=yes", lines)
            self.assertIn("BindReadOnlyPaths=" + str(p.IMPORT_INVENTORY), lines)
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

    def test_real_node_env_i_four_files_keeps_retained_values_and_overrides_old_permit(self):
        node = Path("/root/.nvm/versions/node/v24.18.1/bin/node")
        if not node.exists(): self.skipTest("Node24 fixture executable unavailable")
        files = []
        for name, raw in [("launch", "RETAINED_PRIVATE_FIXTURE=retained\nUNIFIED_RPC_REPLAY_PERMIT_ID_56=old-launch\n"),
                          ("runtime", "UNIFIED_RPC_REPLAY_PERMIT_ID_56=old-runtime\n"),
                          ("combined", "UNIFIED_RPC_POLICY_REQUIRED=true\nUNIFIED_RPC_REPLAY_PERMIT_ID_56=old-combined\n"),
                          ("paid", p.source_environment(fixture()).decode())]:
            path = self.base / (name + ".env"); path.write_text(raw); files.append(path)
        code = "console.log(JSON.stringify({retained:process.env.RETAINED_PRIVATE_FIXTURE,policy:process.env.UNIFIED_RPC_POLICY_REQUIRED,permit:process.env.UNIFIED_RPC_REPLAY_PERMIT_ID_56,cleared:process.env.YUNIPALS_TEST_PARENT_MARKER===undefined}))"
        result = subprocess.run(["/usr/bin/env", "-i", str(node), *["--env-file=" + str(path) for path in files],
                                 "--input-type=module", "-e", code], capture_output=True, check=True, text=True, timeout=5,
                                env={**os.environ, "YUNIPALS_TEST_PARENT_MARKER": "must-clear"})
        self.assertEqual(json.loads(result.stdout), {"retained": "retained", "policy": "true", "cleared": True,
                                                     "permit": p.validate_plan(fixture())["bnb"]["permitId"]})


if __name__ == "__main__":
    unittest.main()
