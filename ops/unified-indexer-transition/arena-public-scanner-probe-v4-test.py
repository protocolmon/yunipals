#!/usr/bin/env python3
"""Finite local controls. Never invokes systemd, a DB or an RPC provider."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("arena-public-scanner-probe-v4.py")
spec = importlib.util.spec_from_file_location("scanner_probe", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ProbeControls(unittest.TestCase):
    def test_finite_fake_only_definition(self):
        text = m.definition().decode()
        for line in ["DynamicUser=yes", "PrivateNetwork=yes", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes", "CapabilityBoundingSet=", "AmbientCapabilities=", "RuntimeMaxSec=45s", "Restart=no", "MemoryMax=512M", "TasksMax=32", "RestrictAddressFamilies=AF_UNIX AF_INET"]:
            self.assertIn(line + "\n", text)
        self.assertIn("LoadCredential=public-db.env:" + str(m.BASE / "fake-public-db.env"), text)
        self.assertNotIn("[Install]", text)
        self.assertNotIn("--scanner", text)
        self.assertNotIn("public-rollback-writer.env", text)

    def test_public_directory_is_traversable_under_actual_umask077(self):
        with tempfile.TemporaryDirectory(prefix="yunipals-probe-umask-") as root:
            target = Path(root) / "public"
            old = os.umask(0o077)
            try:
                with patch.object(m, "PUBLIC", target):
                    m.public_directory()
                self.assertEqual(target.stat().st_mode & 0o7777, 0o755)
                self.assertEqual(target.stat().st_uid, 0)
            finally:
                os.umask(old)

    def test_only_known_omitted_properties_accept_exact_typed_empty(self):
        for key, signature in [("EnvironmentFiles", "a(sb)"), ("Environment", "as"), ("LoadCredential", "a(ss)"), ("ExecStart", "a(sasbttttuii)")]:
            with self.subTest(key=key):
                with patch.object(m, "run", return_value=json.dumps({"type": signature, "data": []}).encode()) as command:
                    self.assertEqual(m.typed_empty(key, signature), "")
                    argv = command.call_args.args[0]
                    self.assertEqual(argv[:3], ["/usr/bin/busctl", "--json=short", "get-property"])
                    self.assertIn("/org/freedesktop/systemd1/unit/yunipals_2darena_2dpublic_2drollback_2dreader_2dprobe_2dv1_2eservice", argv)
                    self.assertNotIn("GetUnit", argv)
                for bad in [{"type": signature, "data": [["foreign"]]}, {"type": "wrong", "data": []}]:
                    with patch.object(m, "run", return_value=json.dumps(bad).encode()), self.assertRaises(m.Refusal):
                        m.typed_empty(key, signature)
        with self.assertRaises(m.Refusal):
            m.typed_empty("DropInPaths", "as")

    def absent_props(self):
        values = {key: "" for key in m.PROPS}
        values.update(Id=m.UNIT, LoadState="not-found", ActiveState="inactive", SubState="dead", MainPID="0")
        return values

    def test_actual_absent_host_omissions_require_exact_typed_proofs(self):
        values = self.absent_props()
        for key in ["EnvironmentFiles", "ExecStart"]:
            values.pop(key)
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        with patch.object(m, "run", side_effect=[raw, b'{"type":"a(sb)","data":[]}', b'{"type":"a(sasbttttuii)","data":[]}']) as command:
            got = m.props()
            self.assertEqual(got["EnvironmentFiles"], "")
            self.assertEqual(got["ExecStart"], "")
            self.assertEqual(command.call_count, 3)

    def test_omitted_exec_start_in_loaded_or_active_unit_refuses_without_fallback(self):
        for key, value in [("LoadState", "loaded"), ("ActiveState", "active"), ("MainPID", "10"), ("Job", "3"), ("FragmentPath", "/run/foreign.service"), ("DropInPaths", "/run/foreign.conf")]:
            with self.subTest(key=key):
                values = self.absent_props(); values[key] = value; values.pop("ExecStart")
                raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
                with patch.object(m, "run", return_value=raw) as command, self.assertRaisesRegex(m.Refusal, "fresh_absent"):
                    m.props()
                self.assertEqual(command.call_count, 1)

    def test_unknown_missing_or_duplicate_property_still_refuses(self):
        values = self.absent_props(); values.pop("WorkingDirectory")
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        with patch.object(m, "run", return_value=raw), self.assertRaises(m.Refusal):
            m.props()
        values = self.absent_props()
        raw = ("\n".join(key + "=" + value for key, value in values.items()) + "\nId=" + m.UNIT).encode()
        with patch.object(m, "run", return_value=raw), self.assertRaises(m.Refusal):
            m.props()

    def test_opaque_display_requires_exact_typed_fake_credential_source(self):
        values = self.absent_props(); values.update(LoadState="loaded", LoadCredential="[unprintable]")
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        typed = {"type": "a(ss)", "data": [["public-db.env", str(m.BASE / "fake-public-db.env")]]}
        with patch.object(m, "run", side_effect=[raw, json.dumps(typed).encode()]) as command:
            value = m.props()
            self.assertEqual(value["LoadCredential"], "public-db.env:" + str(m.BASE / "fake-public-db.env"))
            self.assertEqual(command.call_count, 2)
            self.assertEqual(command.call_args.args[0][-1], "LoadCredential")

    def test_absent_opaque_credential_requires_exact_empty_tuple(self):
        values = self.absent_props(); values["LoadCredential"] = "[unprintable]"
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        with patch.object(m, "run", side_effect=[raw, b'{"type":"a(ss)","data":[]}']) as command:
            value = m.props()
            self.assertEqual(value["LoadCredential"], "")
            self.assertEqual(value["LoadState"], "not-found")
            self.assertEqual(command.call_count, 2)
            self.assertEqual(command.call_args.args[0], [
                "/usr/bin/busctl", "--json=short", "get-property",
                "org.freedesktop.systemd1",
                "/org/freedesktop/systemd1/unit/yunipals_2darena_2dpublic_2drollback_2dreader_2dprobe_2dv1_2eservice",
                "org.freedesktop.systemd1.Service", "LoadCredential"
            ])

    def test_absent_opaque_credential_refuses_nonempty_or_wrongly_typed_values(self):
        values = self.absent_props(); values["LoadCredential"] = "[unprintable]"
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        for typed in [
            {"type": "as", "data": []},
            {"type": "a(ss)", "data": [["public-db.env", str(m.BASE / "fake-public-db.env")]]},
            {"type": "a(ss)", "data": [["public-db.env", "/etc/yunipals-arena/public-rollback-writer.env"]]},
            {"type": "a(ss)", "data": [], "extra": True}
        ]:
            with self.subTest(typed=typed), patch.object(m, "run", side_effect=[raw, json.dumps(typed).encode()]), self.assertRaisesRegex(m.Refusal, "typed_empty_absent"):
                m.props()

    def test_empty_opaque_credential_requires_every_absent_manager_field(self):
        for key, value in [
            ("LoadState", "loaded"), ("ActiveState", "active"),
            ("SubState", "running"), ("MainPID", "12"), ("Job", "7"),
            ("FragmentPath", str(m.FRAGMENT)),
            ("DropInPaths", "/run/systemd/system/foreign.conf")
        ]:
            with self.subTest(key=key):
                values = self.absent_props(); values.update({key: value, "LoadCredential": "[unprintable]"})
                raw = "\n".join(k + "=" + v for k, v in values.items()).encode()
                with patch.object(m, "run", side_effect=[raw, b'{"type":"a(ss)","data":[]}']), self.assertRaisesRegex(m.Refusal, "typed_fake"):
                    m.props()

    def test_default_review_accepts_actual_absent_opaque_shape_without_writes(self):
        values = self.absent_props(); values["LoadCredential"] = "[unprintable]"
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m, "activation_paths", return_value=[]), patch.object(m, "source_binding", return_value={"fixture": True}), patch.object(m, "run", side_effect=[raw, b'{"type":"a(ss)","data":[]}']) as command, patch.object(m, "save") as save:
            result = m.review()
        self.assertEqual(result["format"], "yunipals-arena-public-scanner-probe-owner-v4")
        self.assertEqual(result["databaseRequests"], 0)
        self.assertEqual(result["providerRequests"], 0)
        self.assertEqual(command.call_count, 2)
        self.assertTrue(all(call.args[0][0] in {"/usr/bin/systemctl", "/usr/bin/busctl"} for call in command.call_args_list))
        save.assert_not_called()

    def test_opaque_display_rejects_foreign_extra_or_wrongly_typed_credentials(self):
        values = self.absent_props(); values.update(LoadState="loaded", LoadCredential="[unprintable]")
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        source = str(m.BASE / "fake-public-db.env")
        for typed in [
            {"type": "as", "data": []},
            {"type": "a(ss)", "data": []},
            {"type": "a(ss)", "data": [["public-db.env", "/etc/yunipals-arena/public-rollback-writer.env"]]},
            {"type": "a(ss)", "data": [["other.env", source]]},
            {"type": "a(ss)", "data": [["public-db.env", source], ["other.env", source]]}
        ]:
            with self.subTest(typed=typed), patch.object(m, "run", side_effect=[raw, json.dumps(typed).encode()]), self.assertRaisesRegex(m.Refusal, "exact_typed_fake"):
                m.props()

    def test_unknown_credential_display_is_not_normalized(self):
        _, _, _, _, values = self.fixture()
        values["LoadCredential"] = "foreign-opaque-value"
        raw = "\n".join(key + "=" + value for key, value in values.items()).encode()
        with patch.object(m, "run", return_value=raw) as command:
            value = m.props()
            self.assertEqual(command.call_count, 1)
        with self.assertRaises(m.Refusal):
            m.static_state(value)

    def test_changed_review_refuses_before_any_file_or_command(self):
        with patch.object(m, "review", return_value={"binding": "fresh"}), patch.object(m, "run") as command:
            with self.assertRaisesRegex(m.Refusal, "exact_fresh"):
                m.apply("0" * 64)
            command.assert_not_called()

    def fixture(self):
        temporary = tempfile.TemporaryDirectory(prefix="yunipals-synthetic-probe-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        base, public = root / "evidence", root / "public"
        base.mkdir(mode=0o700); public.mkdir(mode=0o755)
        fragment = root / m.UNIT
        for name, value in [("BASE", base), ("PUBLIC", public), ("FRAGMENT", fragment)]:
            replacement = patch.object(m, name, value); replacement.start(); self.addCleanup(replacement.stop)
        replacement = patch.object(m, "protected", side_effect=lambda path, *a, **kw: Path(path).read_bytes())
        replacement.start(); self.addCleanup(replacement.stop)
        replacement = patch.object(m, "activation_paths", return_value=[])
        replacement.start(); self.addCleanup(replacement.stop)
        bodies = {fragment: m.definition(), public / "probe.mjs": b"public probe", public / "child.mjs": b"public child", base / "fake-public-db.env": m.SYNTHETIC}
        files = {}
        for name, raw in bodies.items():
            m.save(name, raw)
            files[str(name)] = {"identity": m.identity(name), "sha256": m.sha(raw)}
        m.save(base / "files.json", files)
        m.save(base / "operation.json", {"operatorSha256": m.sha(FILE.read_bytes()), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip()})
        current = {key: "" for key in m.PROPS}
        current.update({"Id": m.UNIT, "LoadState": "loaded", "MainPID": "0", "ActiveState": "inactive", "FragmentPath": str(fragment), "WorkingDirectory": str(m.ROOT / "apps/yunipals-market-api"), "User": "yunipals-arena-public-recovery", "DynamicUser": "yes", "NoNewPrivileges": "yes", "ProtectSystem": "strict", "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes", "PrivateNetwork": "yes", "RestrictSUIDSGID": "yes", "Restart": "no", "KillMode": "control-group", "MemoryMax": "536870912", "TasksMax": "32", "RuntimeMaxUSec": "45s", "Environment": "NODE_OPTIONS=--max-old-space-size=256 TSX_DISABLE_CACHE=1", "LoadCredential": "public-db.env:" + str(base / "fake-public-db.env"), "RestrictAddressFamilies": "AF_UNIX AF_INET", "ExecStart": "{ path=" + str(m.NODE) + " ; argv[]=" + str(m.NODE) + " " + str(public / "probe.mjs") + " ; ignore_errors=no ; }"})
        return base, public, fragment, files, current

    def test_terminal_cleanup_removes_only_exact_owned_files_and_reconciles_lost_ack(self):
        base, public, fragment, _, current = self.fixture()
        with patch.object(m, "props", return_value=current), patch.object(m, "quiet", return_value=current), patch.object(m, "run", return_value=b"") as command:
            self.assertTrue(m.cleanup()["cleanupComplete"])
            self.assertFalse(fragment.exists()); self.assertFalse(public.exists())
            self.assertFalse((base / "fake-public-db.env").exists())
            self.assertTrue((base / "operation.json").exists())
            self.assertTrue(m.cleanup()["cleanupComplete"])
            self.assertEqual(command.call_args_list[0].args[0], ["/usr/bin/systemctl", "daemon-reload"])
            self.assertTrue(all(call.args[0] == ["/usr/bin/systemctl", "daemon-reload"] for call in command.call_args_list))

    def test_changed_inode_is_preserved(self):
        base, public, fragment, _, current = self.fixture()
        target = public / "probe.mjs"
        raw = target.read_bytes()
        target.unlink(); target.write_bytes(raw)
        with patch.object(m, "props", return_value=current), patch.object(m, "quiet", return_value=current), patch.object(m, "run") as command:
            with self.assertRaisesRegex(m.Refusal, "exact_owned_probe_inode"):
                m.cleanup()
            self.assertTrue(target.exists())
            command.assert_not_called()

    def test_foreign_active_invocation_is_not_stopped(self):
        base, _, fragment, _, current = self.fixture()
        current.update({"MainPID": "1234", "ActiveState": "active"})
        prior = {"pid": 1234, "invocation": "a" * 32}
        m.save(base / "actor.json", prior)
        foreign = {"pid": 1234, "invocation": "b" * 32}
        with patch.object(m, "props", return_value=current), patch.object(m, "actor", return_value=foreign), patch.object(m, "run") as command:
            with self.assertRaisesRegex(m.Refusal, "foreign_probe"):
                m.cleanup()
            command.assert_not_called()
            self.assertTrue(fragment.exists())

    def test_fresh_cas_refuses_replacement_after_stop_intent(self):
        base, _, fragment, _, current = self.fixture()
        current.update({"MainPID": "1234", "ActiveState": "active"})
        prior = {"pid": 1234, "invocation": "a" * 32}
        m.save(base / "actor.json", prior)
        with patch.object(m, "props", return_value=current), patch.object(m, "actor", side_effect=[prior, {**prior, "invocation": "b" * 32}]), patch.object(m, "run") as command:
            with self.assertRaisesRegex(m.Refusal, "changed_before_stop"):
                m.cleanup()
            command.assert_not_called()
            self.assertTrue((base / "stop-intent.json").exists())
            self.assertTrue(fragment.exists())

    def test_dropin_or_loaded_real_credential_is_not_accepted(self):
        _, _, _, _, current = self.fixture()
        for key, value in [("DropInPaths", "/run/foreign.conf"), ("LoadCredential", "public-db.env:/etc/yunipals-arena/public-rollback-writer.env"), ("PrivateNetwork", "no")]:
            with self.subTest(key=key), self.assertRaises(m.Refusal):
                m.static_state({**current, key: value})

    def test_cleanup_retry_does_not_overwrite_another_unlink_intent(self):
        base, _, fragment, _, current = self.fixture()
        m.save(base / (fragment.name + ".unlink-intent.json"), {"foreign": True})
        with patch.object(m, "props", return_value=current), patch.object(m, "quiet", return_value=current), patch.object(m, "run") as command:
            with self.assertRaisesRegex(m.Refusal, "cleanup_intent_changed"):
                m.cleanup()
            self.assertTrue(fragment.exists())
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
