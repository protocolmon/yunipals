#!/usr/bin/env python3
"""Reuse approved variant149 to test publication transfer; no generation or production writes."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/boosters"))
import art_lab
import art_runtime

spec = importlib.util.spec_from_file_location("art_installer", Path(__file__).with_name("install-approved-artwork.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SLUG = "base-mainnet-smoke-v1"
RANK = 149


class ApprovedArtworkTransferTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="yunipals-approved-art-test-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.target = self.root / "target"
        for directory in (self.source, self.target):
            art_runtime.init_catalog(art_lab.DEFAULT_LAB, directory, SLUG, "https://api.yunipals.com/yunipals-indexer")
        old = json.loads((ROOT / "docs/boosters/artwork-runtime/catalogs/base-standard-v1-demo/variants/149.json").read_text())
        sha = old["yunipals"]["artworkSha256"]
        (self.source / "masks").mkdir()
        shutil.copyfile(ROOT / "docs/boosters/artwork-runtime/masks" / (sha + ".json"), self.source / "masks" / (sha + ".json"))
        # Existing immutable publisher performs the actual source/QA acceptance.
        published = art_runtime.publish(art_lab.DEFAULT_LAB, self.source, SLUG, old["provenance"]["runId"], old["provenance"]["stage"])
        self.metadata = Path(published["metadata"])
        self.destination = self.target / "catalogs" / SLUG / "variants/149.json"
        self.job = self.target / "jobs" / SLUG / "149.json"
        self.job.parent.mkdir(parents=True)
        document = json.loads(self.metadata.read_text())
        self.job.write_text(json.dumps({"schemaVersion": 1, "catalog": SLUG, "catalogHash": art_runtime.CATALOG_HASH,
            "variantId": RANK, "status": "queued", "traits": {item["trait_type"].lower(): item["value"] for item in document["attributes"]}}))

    def tearDown(self):
        self.temporary.cleanup()

    def test_actual_existing_publisher_output_transfers_all_holo_assets_before_metadata(self):
        review = m.install(self.source, self.target, SLUG, RANK)
        self.assertEqual(review["status"], "REVIEWED")
        self.assertEqual(len(review["assets"]), 4)
        self.assertFalse(self.destination.exists())
        self.assertEqual(m.install(self.source, self.target, SLUG, RANK, True)["status"], "INSTALLED")
        self.assertEqual(self.destination.read_bytes(), self.metadata.read_bytes())
        for name in review["assets"]:
            self.assertEqual((self.target / "assets" / name).read_bytes(), (self.source / "assets" / name).read_bytes())
        self.assertEqual(m.install(self.source, self.target, SLUG, RANK, True)["status"], "ALREADY_PUBLISHED")

    def test_unobserved_or_mismatched_queue_job_never_creates_metadata(self):
        self.job.unlink()
        with self.assertRaisesRegex(RuntimeError, "Missing regular artifact"):
            m.install(self.source, self.target, SLUG, RANK, True)
        self.assertFalse(self.destination.exists())

    def test_failure_after_assets_leaves_metadata_missing_and_retry_is_safe(self):
        original = m.exclusive_file

        def fail_metadata(destination, data):
            if destination == self.destination:
                raise RuntimeError("injected metadata-stage interruption")
            original(destination, data)

        with patch.object(m, "exclusive_file", side_effect=fail_metadata):
            with self.assertRaisesRegex(RuntimeError, "interruption"):
                m.install(self.source, self.target, SLUG, RANK, True)
        self.assertFalse(self.destination.exists())
        self.assertEqual(m.install(self.source, self.target, SLUG, RANK, True)["status"], "INSTALLED")

    def test_existing_variant_and_hashed_assets_cannot_be_overwritten(self):
        m.install(self.source, self.target, SLUG, RANK, True)
        original = self.destination.read_bytes()
        changed = json.loads(self.metadata.read_text())
        changed["description"] = "replacement is forbidden"
        self.metadata.write_text(json.dumps(changed))
        with self.assertRaisesRegex(RuntimeError, "cannot be replaced"):
            m.install(self.source, self.target, SLUG, RANK, True)
        self.assertEqual(self.destination.read_bytes(), original)

    def test_unbound_pixels_or_wrong_trait_metadata_are_refused(self):
        document = json.loads(self.metadata.read_text())
        image = self.source / "assets" / document["image"].rsplit("/", 1)[1]
        image.write_bytes(image.read_bytes() + b"changed")
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            m.install(self.source, self.target, SLUG, RANK, True)
        self.assertFalse(self.destination.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
