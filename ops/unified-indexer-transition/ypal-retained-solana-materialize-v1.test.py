import os
from pathlib import Path
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name("ypal-retained-solana-materialize-v1.py").absolute()
m = types.ModuleType("materialize_controls")
m.__file__ = str(SOURCE)
exec(compile(SOURCE.read_bytes(), str(SOURCE), "exec"), m.__dict__)


class Controls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix=".restored-materialize-control-", dir=Path.cwd())
        self.root = Path(self.tmp.name)
        self.target = self.root / "new-etc" / "solana.env"
        self.audit = self.root / "audit"
        self.raw = b"SYNTHETIC_CONFIGURATION=local-only\n"
        self.selected = {"sourceSha256": m.sha(self.raw), "existingIdentity": "fixture"}
        self.requested_ownership = []
        real_chown = os.fchown

        def fixture_chown(fd, uid, gid):
            # The executor maps only gid0. Record the exact production request,
            # but exercise filesystem effects with the mapped local fixture gid.
            self.requested_ownership.append((uid, gid))
            real_chown(fd, uid, os.getgid())

        self.patches = [patch.object(m, "TARGET", self.target), patch.object(m, "BASE", self.audit),
                        patch.object(m, "inputs", return_value=(self.selected, self.raw)),
                        patch.object(m.os, "fchown", side_effect=fixture_chown)]
        for p in self.patches:
            p.start()
        case = self

        class Host:
            def snapshot(self):
                return {"source": "same", "peers": "same", "inputs": "same", "solanaActor": "same",
                        "solanaActivation": "same", "native": {"safe": 42}}

            def unchanged(self, before, after):
                case.assertEqual(before, after)

            def readable(self, expected):
                case.assertEqual(expected, m.sha(case.target.read_bytes()))
                case.assertEqual(stat.S_IMODE(case.target.stat().st_mode), 0o640)
                case.assertEqual(case.target.stat().st_gid, os.getgid())
                case.assertIn((0, 964), case.requested_ownership)

        self.host = Host()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_static_cli_cannot_construct_a_host(self):
        with patch.object(sys, "argv", [str(SOURCE)]), patch.object(m, "Host", side_effect=AssertionError("host")):
            m.main()

    def test_review_does_not_create_private_or_audit_paths(self):
        value, raw = m.review(self.host)
        self.assertEqual(raw, self.raw)
        self.assertEqual(value["binding"]["selected"], self.selected)
        self.assertFalse(self.target.parent.exists())
        self.assertFalse(self.audit.exists())

    def test_materializes_exact_bytes_with_existing_child_permissions_and_no_runtime_authority(self):
        value, _ = m.review(self.host)
        result = m.stage(self.host, value["reviewHash"])
        self.assertEqual(self.target.read_bytes(), self.raw)
        self.assertEqual(stat.S_IMODE(self.audit.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.target.parent.stat().st_mode), 0o755)
        self.assertEqual(result["newTargetGid"], 964)
        self.assertFalse(result["managedActivationQualified"])
        self.assertFalse(result["newCredentialsCreated"])
        self.assertFalse(result["newPrincipalAdmitted"])
        self.assertEqual(result["databaseWrites"], result["serviceActions"])
        receipt = self.audit / "result.json"
        self.assertEqual(m.sha(receipt.read_bytes()), result["actualResultSha256"])
        self.assertEqual(stat.S_IMODE(receipt.stat().st_mode), 0o600)

    def test_existing_target_and_symlink_are_never_overwritten(self):
        self.target.parent.mkdir(mode=0o755)
        self.target.write_bytes(b"retained")
        with self.assertRaisesRegex(RuntimeError, "fresh_absent"):
            m.review(self.host)
        self.assertEqual(self.target.read_bytes(), b"retained")
        self.target.unlink()
        self.target.symlink_to(self.root / "missing")
        with self.assertRaisesRegex(RuntimeError, "fresh_absent"):
            m.review(self.host)

    def test_review_hash_drift_stops_before_any_effect(self):
        value, _ = m.review(self.host)
        with patch.object(m, "inputs", return_value=({**self.selected, "existingIdentity": "changed"}, self.raw)):
            with self.assertRaisesRegex(RuntimeError, "exact_actual_private"):
                m.stage(self.host, value["reviewHash"])
        self.assertFalse(self.audit.exists())
        self.assertFalse(self.target.exists())

    def test_source_drift_after_durable_prefix_prevents_copy_and_result(self):
        value, _ = m.review(self.host)
        changed = ({**self.selected, "existingIdentity": "changed"}, b"changed")
        with patch.object(m, "inputs", side_effect=[(self.selected, self.raw), changed]):
            with self.assertRaisesRegex(RuntimeError, "selected_private_source_changed"):
                m.stage(self.host, value["reviewHash"])
        self.assertTrue((self.audit / "before.json").exists())
        self.assertFalse(self.target.exists())
        self.assertFalse((self.audit / "result.json").exists())

    def test_failed_child_readability_preserves_partial_copy_without_success_receipt_or_retry(self):
        value, _ = m.review(self.host)
        with patch.object(self.host, "readable", side_effect=RuntimeError("fixture_child_refusal")):
            with self.assertRaisesRegex(RuntimeError, "fixture_child_refusal"):
                m.stage(self.host, value["reviewHash"])
        self.assertEqual(self.target.read_bytes(), self.raw)
        self.assertTrue((self.audit / "copy-intent.json").exists())
        self.assertFalse((self.audit / "result.json").exists())
        with self.assertRaisesRegex(RuntimeError, "fresh_absent"):
            m.stage(self.host, value["reviewHash"])

    def test_exclusive_writer_and_protected_reader_refuse_links_foreign_bytes_and_extra_links(self):
        file = self.root / "exclusive"
        m.exclusive(file, self.raw)
        before = m.identity(file)
        with self.assertRaises(FileExistsError):
            m.exclusive(file, b"overwrite")
        self.assertEqual(before, m.identity(file))
        with self.assertRaisesRegex(RuntimeError, "same_recorded_input"):
            m.protected(file, "0" * 64)
        link = self.root / "link"
        link.symlink_to(file)
        with self.assertRaisesRegex(RuntimeError, "protected_single"):
            m.protected(link)
        link.unlink()
        os.link(file, link)
        with self.assertRaisesRegex(RuntimeError, "protected_single"):
            m.protected(file)


if __name__ == "__main__":
    unittest.main()
