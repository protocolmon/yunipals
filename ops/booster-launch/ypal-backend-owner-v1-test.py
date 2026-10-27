#!/usr/bin/env python3
"""Focused local controls; no systemd, production DB or provider actions."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("ypal-backend-owner-v1.py")
spec = importlib.util.spec_from_file_location("ypal_owner", FILE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
REPO = Path(__file__).resolve().parents[2]
DEPLOYMENT = json.loads((REPO / "docs/boosters/ypal-fresh-launch-2026-10-23/deployment.confirmed.json").read_bytes())
PROFILE = json.loads((Path(__file__).with_name("ypal-rpc-profile-v1.json")).read_bytes())


def proposal():
    return {"prepared": True, "indexPolicyAdmitted": False, "freeOnly": True, "paidAuthority": False, "emptyPermits": True, "endpoint": "http://127.0.0.1:19212/unified", "profileId": m.PROFILE_ID, "profileFile": str(m.PROFILE_FILE), "sourceManifest": PROFILE["manifest"]}


def old_definition():
    # Actual retained public argv and declared writable paths. Other fields
    # below are a synthetic service text, not a production-unit byte proof.
    argv = [m.NODE, "--max-old-space-size=1024", "--env-file=/var/lib/yunipals-unified-shadow/20261020-008028af-a/launch.env", "--env-file=" + str(m.PROJECT / "launch.public.env"), str(m.PROJECT / "node_modules/ponder/dist/esm/bin/ponder.js"), "start", "--root", str(m.PROJECT), "--config", "ponder.boosters.launch.config.ts", "--schema", m.OLD_SCHEMA, "--hostname", "127.0.0.1", "--port", "9026"]
    text = "[Unit]\nAfter=postgresql.service\n[Service]\nUser=yunipals_unified_shadow\nGroup=yunipals_unified_shadow\nWorkingDirectory=" + str(m.PROJECT) + "\nExecStart=/usr/bin/env -i " + " ".join(argv) + "\nRestart=on-failure\nRuntimeMaxSec=infinity\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nRestrictSUIDSGID=yes\nMemoryMax=2147483648\nReadWritePaths=" + " ".join(str(m.PROJECT / p) for p in (".ponder", "ponder-env.d.ts", "node_modules/.vite-temp")) + "\n[Install]\nWantedBy=multi-user.target\n"
    return text.encode(), argv


class OwnerControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".ypal-owner-test-", dir=FILE.parent)
        self.root = Path(self.temp.name)

    def tearDown(self): self.temp.cleanup()

    def test_actual_source_profile_is_frozen_and_has_individual_real_proxy_starts(self):
        self.assertEqual(hashlib.sha256(Path(__file__).with_name("ypal-rpc-profile-v1.json").read_bytes()).hexdigest(), m.PROFILE_SHA)
        code = m.source_config(DEPLOYMENT, proposal()).decode()
        for key, block in (("BoosterRegistry", "52995007"), ("BoosterMonsters", "52995029"), ("BoosterEngine", "52995174")):
            self.assertIn(key + ":{", code); self.assertIn("startBlock:" + block, code)
        self.assertIn("poolConfig:{max:5}", code)
        altered = proposal(); altered["sourceManifest"] = json.loads(json.dumps(altered["sourceManifest"]))
        altered["sourceManifest"]["sources"][0]["startBlock"] = DEPLOYMENT["sourceStartBlock"]
        self.assertRaises(RuntimeError, m.source_config, DEPLOYMENT, altered)

    def test_namespace_mounts_are_three_outputs_and_readonly_config_not_old_tree(self):
        raw, argv = old_definition(); candidate = m.source_candidates(raw, argv, DEPLOYMENT, proposal())
        body = candidate["definition"].decode()
        self.assertIn("BindReadOnlyPaths=" + str(m.ROOT / "ponder.ypal.config.ts") + ":" + str(m.PROJECT / "ponder.boosters.launch.config.ts"), body)
        self.assertEqual(body.count("BindPaths="), 1)
        self.assertIn(str(m.ROOT / ".ponder") + ":" + str(m.PROJECT / ".ponder"), body)
        self.assertIn("NoNewPrivileges=yes", body); self.assertIn("ProtectSystem=strict", body)
        self.assertIn("RuntimeMaxSec=infinity", body); self.assertNotIn("--schema " + m.OLD_SCHEMA, body)
        self.assertNotIn("ReadWritePaths=" + str(m.OLD_ROOT) + "\n", body)
        self.assertEqual(candidate["argv"][candidate["argv"].index("--schema") + 1], m.SCHEMA)

    def test_hooks_broad_writes_changed_port_or_old_environment_refuse(self):
        raw, argv = old_definition()
        for bad in (raw.replace(b"[Service]\n", b"[Service]\nExecStartPre=/bin/true\n"), raw.replace(b"ReadWritePaths=", b"ReadWritePaths=/etc "), raw.replace(b"RuntimeMaxSec=infinity", b"RuntimeMaxSec=0")):
            self.assertRaises(RuntimeError, m.source_candidates, bad, argv, DEPLOYMENT, proposal())
        altered = argv.copy(); altered[-1] = "9999"
        self.assertRaises(RuntimeError, m.source_candidates, raw, altered, DEPLOYMENT, proposal())

    def test_fresh_public_environment_no_old_deployment_no_paid_authority(self):
        raw, argv = old_definition(); c = m.source_candidates(raw, argv, DEPLOYMENT, proposal())
        env = c["sourceEnv"].decode()
        self.assertIn("UNIFIED_RPC_PROFILE_ID=" + m.PROFILE_ID, env)
        self.assertIn("PONDER_RPC_URL_8453=http://127.0.0.1:19212/unified", env)
        self.assertIn("UNIFIED_RPC_REPLAY_PERMIT_ID=\n", env)
        self.assertNotIn("DATABASE_URL=", env)
        self.assertNotIn("0x455fabad", env.lower())
        self.assertIn(DEPLOYMENT["engine"].lower(), env)
        self.assertNotIn("smoke", c["readerEnv"].decode())
        self.assertIn("BOOSTER_DATABASE_SCHEMA=" + m.SCHEMA, c["readerEnv"].decode())

    def test_exact_inode_cas_refuses_same_byte_foreign_replacement(self):
        path = self.root / "owned"; recorded = m.write_new(path, b"public")
        original = path.with_name("retained-original"); path.rename(original)
        m.write_new(path, b"public")
        self.assertRaises(RuntimeError, m.remove_owned, path, recorded)
        self.assertTrue(path.exists()); self.assertTrue(original.exists())

    def test_owned_file_cleanup_checks_exact_bytes_and_inode(self):
        path = self.root / "owned"; recorded = m.write_new(path, b"public", 0o600)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        m.owned_file(path, recorded); m.remove_owned(path, recorded)
        self.assertFalse(path.exists())

    def test_durable_failed_intent_blocks_duplicate_effect(self):
        journal = m.Journal(self.root); entries = []
        def failed(): entries.append("first"); raise RuntimeError("lost_ack")
        self.assertRaises(RuntimeError, journal.action, "probe", {"scope": "fixed"}, failed)
        self.assertTrue((self.root / "probe-intent.json").exists())
        self.assertFalse((self.root / "probe-result.json").exists())
        self.assertRaises(RuntimeError, journal.action, "probe", {}, lambda: entries.append("duplicate"))
        self.assertEqual(entries, ["first"])

    def test_success_journal_ack_binds_actual_intent_bytes(self):
        journal = m.Journal(self.root)
        self.assertEqual(journal.action("probe", {"scope": "fixed"}, lambda: {"completed": True}), {"completed": True})
        receipt = m.load(self.root / "probe-result.json")
        self.assertEqual(receipt["bindingSha256"], m.sha(m.protected(self.root / "probe-intent.json")))
        self.assertFalse(m.load(self.root / "probe-intent.json")["automaticRetryAllowed"])

    def test_old_backend_tuple_drain_never_requires_global_role_zero(self):
        old = {"pid": 1, "backendStart": "old"}; combined = {"pid": 2, "backendStart": "shared"}
        packet = {"source": {"sessionAttribution": {"complete": True, "applicationNameOrAgeInference": False, "sharedRoleZeroSessionsRequired": False, "oldBackends": [old], "combinedBackends": [combined]}}}
        self.assertFalse(m.verify_drain(packet, [combined])["sharedRoleZeroSessionsRequired"])
        self.assertRaises(RuntimeError, m.verify_drain, packet, [old, combined])
        self.assertRaises(RuntimeError, m.verify_drain, packet, [])
        self.assertRaises(RuntimeError, m.verify_drain, packet, [{"pid": 2, "backendStart": "foreign-reused-PID"}])

    def test_frozen_socket_mapper_requires_real_peer_identity_not_name_or_age(self):
        observer = m.pinned_module(FILE.with_name("ypal-old-runtime-inventory-v1.py"), m.OBSERVER_SHA)
        rows = [{"pid": 100, "backendStart": "fixed", "clientAddress": None, "clientPort": -1}]
        clients = {"1": {"startTicks": 1, "socketInodes": [10]}}
        backends = {"100": {"startTicks": 2, "socketInodes": [20]}}
        result = observer.map_owned_backends(clients, backends, rows, {10: 20, 20: 10}, {})
        self.assertEqual([r["pid"] for r in result], [100])
        self.assertEqual(observer.map_owned_backends(clients, backends, rows, {10: 99}, {}), [])

    def test_active_unit_cannot_be_treated_as_terminal_inverse(self):
        self.assertRaises(RuntimeError, m.quiet, {"Id": m.SOURCE, "MainPID": "123", "ActiveState": "active", "Job": ""})
        self.assertRaises(RuntimeError, m.quiet, {"Id": m.TIMER, "ActiveState": "active", "Job": ""})

    def test_preparation_only_cli_has_no_source_or_reader_transition_phase(self):
        self.assertEqual(m.PHASES, ("prepare",))
        self.assertNotIn("start-source", m.PHASES)
        self.assertNotIn("admit-reads", m.PHASES)
        self.assertNotIn("switch-readers", m.PHASES)


if __name__ == "__main__": unittest.main()
