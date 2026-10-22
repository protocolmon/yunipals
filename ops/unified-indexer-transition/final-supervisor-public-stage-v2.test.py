"""Actual temporary-filesystem staging boundaries; no runtime or host changes."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
REPO = HERE.parents[1]
spec = importlib.util.spec_from_file_location("stage", HERE / "final-supervisor-public-stage-v2.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PublicStage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="yunipals-public-supervisor-stage-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "operations"
        self.root.mkdir()
        self.source = Path(self.tmp.name) / "payload"
        self.source.mkdir()
        sources = {
            "final-supervisor-handover-v2.py": HERE / "final-supervisor-handover-v2.py",
            "final-supervisor-resources-v1.conf.example": HERE / "final-supervisor-resources-v1.conf.example",
            "supervisor-handover-state-v1.sql": REPO / "ops/solana-acceptance/supervisor-handover-state-v1.sql",
            "normal-transport-final-v4.conf": REPO / "ops/unified-indexer/solana-consolidation-20261021/normal-transport-final-v4.conf.example"
        }
        for name, source in sources.items():
            shutil.copyfile(source, self.source / name)
        for relative, name in [
            ("free-replay-20261020/final-supervisor-handover-v1.py", HERE / "final-supervisor-handover-v1.py"),
            ("free-replay-20261020/consumer-operational-marketplace-ack-v2.py", HERE / "consumer-operational-marketplace-ack-v2.py"),
            ("free-replay-20261020/consumer-accepted-marketplace-acl-v2.py", HERE / "consumer-accepted-marketplace-acl-v2.py"),
            ("free-replay-20261020/normal-rpc-profile-v1.json", HERE / "normal-rpc-profile-v1.json"),
            ("solana-consolidation-final-20261021-v1/ponder-normal-final-v1.public.env", REPO / "ops/unified-indexer/solana-consolidation-20261021/ponder-normal-final-v1.public.env")
        ]:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(name, target)
        self.feature = "free-replay-20261020/future-qualified-feature-fixture.py"
        raw = b"# Future peer-qualified owner fixture; never executed.\n"
        (self.root / self.feature).write_bytes(raw)
        feature_review = Path(self.tmp.name) / "qualified-feature-review.json"
        binding = {"operatorSha256": m.sha(raw), "format": "yunipals-booster-seven-read-admission-v1"}
        review_hash = m.sha((json.dumps(binding, sort_keys=True, separators=(",", ":")) + "\n").encode())
        feature_review.write_text(json.dumps({"binding": binding, "reviewHash": review_hash, "actualRollbackRehearsed": True}))
        self.pins = patch.multiple(m, FINAL_HELPER_SHA=m.sha((self.source / "final-supervisor-handover-v2.py").read_bytes()),
                                   FEATURE_RELATIVE=self.feature, FEATURE_SHA=m.sha(raw),
                                   FEATURE_REVIEW=feature_review, FEATURE_REVIEW_SHA=m.sha(feature_review.read_bytes()),
                                   FEATURE_REVIEW_HASH=review_hash)
        self.pins.start()
        self.addCleanup(self.pins.stop)

    def test_four_public_files_stage_atomically_and_identical_repeat_preserves_inodes(self):
        review = m.stage(self.source, root=self.root)
        self.assertFalse(review["staged"])
        self.assertFalse((self.root / "solana-consolidation-final-20261022-v4").exists())
        result = m.stage(self.source, root=self.root, apply=True)
        before = {row["path"]:Path(row["path"]).stat().st_ino for row in result["files"]}
        repeat = m.stage(self.source, root=self.root, apply=True)
        self.assertEqual(before, {row["path"]:Path(row["path"]).stat().st_ino for row in repeat["files"]})
        self.assertTrue(all(row["alreadyPresent"] for row in repeat["files"]))
        self.assertEqual(result["serviceActions"], 0)
        self.assertEqual(result["privateFilesCopied"], 0)

    def test_any_foreign_destination_refuses_before_new_files_or_directory(self):
        target = self.root / "free-replay-20261020/final-supervisor-resources-v1.conf.example"
        target.write_bytes(b"foreign existing artifact")
        with self.assertRaisesRegex(RuntimeError, "cannot_be_overwritten"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertEqual(target.read_bytes(), b"foreign existing artifact")
        self.assertFalse((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())
        self.assertFalse((self.root / "solana-consolidation-final-20261022-v4").exists())

    def test_changed_retained_feature_owner_refuses_without_mutations(self):
        (self.root / self.feature).write_bytes(b"superseded or foreign owner")
        with self.assertRaisesRegex(RuntimeError, "retained_public_dependency_changed"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertFalse((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())

    def test_changed_receipt_specific_installer_entry_refuses_without_payload_copies(self):
        (self.root / "free-replay-20261020/consumer-operational-marketplace-ack-v2.py").write_bytes(b"unacknowledged or foreign installer")
        with self.assertRaisesRegex(RuntimeError, "retained_public_dependency_changed"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertFalse((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())
        self.assertFalse((self.root / "solana-consolidation-final-20261022-v4").exists())

    def test_changed_actual_feature_qualification_refuses_before_any_payload_copy(self):
        m.FEATURE_REVIEW.write_bytes(b"changed or unqualified review")
        with self.assertRaisesRegex(RuntimeError, "actual_qualified_feature_rehearsal_file_required"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertFalse((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())
        self.assertFalse((self.root / "solana-consolidation-final-20261022-v4").exists())

    def test_missing_final_owner_pin_refuses_before_any_file_access(self):
        with patch.object(m, "FEATURE_SHA", None), patch.object(m, "read") as read:
            with self.assertRaisesRegex(RuntimeError, "peer_qualified_feature_owner_and_final_helper_pins"):
                m.stage(self.source, root=self.root, apply=True)
            read.assert_not_called()

    def test_exact_v2_successor_and_unchanged_dependency_payload_pins(self):
        self.assertEqual(m.FINAL_HELPER_SHA, "8ad5845ef641ad74bd4fbead7b01be74e5db4fbf54c8bbe140366267e5c06eab")
        self.assertEqual(set(m.PAYLOADS), {"final-supervisor-handover-v2.py", "final-supervisor-resources-v1.conf.example",
            "supervisor-handover-state-v1.sql", "normal-transport-final-v4.conf"})
        for name, (_, pin) in m.PAYLOADS.items():
            self.assertEqual(m.sha((self.source / name).read_bytes()), m.FINAL_HELPER_SHA if pin is None else pin)
        self.assertEqual(m.RETAINED["free-replay-20261020/final-supervisor-handover-v1.py"],
                         "848150920dd624b65832b9a9a87e35f8d6f8831052b3598ac8b93275c886dd92")

    def test_staged_v1_bytes_permissions_and_inode_remain_unchanged(self):
        old = self.root / "free-replay-20261020/final-supervisor-handover-v1.py"
        before = (old.read_bytes(), old.stat().st_ino, old.stat().st_mode)
        result = m.stage(self.source, root=self.root, apply=True)
        self.assertEqual((old.read_bytes(), old.stat().st_ino, old.stat().st_mode), before)
        self.assertNotIn(str(old), {row['path'] for row in result['files']})
        self.assertTrue((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())

    def test_changed_staged_v1_refuses_before_any_successor_copy(self):
        old = self.root / "free-replay-20261020/final-supervisor-handover-v1.py"
        old.write_bytes(b"foreign historical helper")
        with self.assertRaisesRegex(RuntimeError, "retained_public_dependency_changed"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertEqual(old.read_bytes(), b"foreign historical helper")
        self.assertFalse((self.root / "free-replay-20261020/final-supervisor-handover-v2.py").exists())

    def test_foreign_v2_destination_is_never_overwritten(self):
        new = self.root / "free-replay-20261020/final-supervisor-handover-v2.py"
        new.write_bytes(b"foreign successor")
        with self.assertRaisesRegex(RuntimeError, "cannot_be_overwritten"):
            m.stage(self.source, root=self.root, apply=True)
        self.assertEqual(new.read_bytes(), b"foreign successor")
        self.assertFalse((self.root / "solana-consolidation-final-20261022-v4").exists())


if __name__ == "__main__":
    unittest.main()
