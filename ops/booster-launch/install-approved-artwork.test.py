#!/usr/bin/env python3
"""Test hash-bound publication transfer with deterministic local fixtures."""
import hashlib
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

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
        # Transfer validation does not need an operator's untracked generation
        # runs. The real publisher's generation/visual QA is tested separately.
        assets = self.source / "assets"
        assets.mkdir()
        def save(data, suffix):
            digest = hashlib.sha256(data).hexdigest()
            name = digest + suffix
            (assets / name).write_bytes(data)
            return m.PUBLIC + name, digest
        png = BytesIO()
        Image.new("RGBA", (16, 24), (100, 130, 160, 255)).save(png, format="PNG")
        old["image"], old["yunipals"]["artworkSha256"] = save(png.getvalue(), ".png")
        old["yunipals"]["holo"] = {
            key: save(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1536"><rect id="{key}" width="1024" height="1536" fill="white"/></svg>'.encode(), ".svg")[0]
            for key in ["foreground", "background", "stars"]
        }
        manifest = json.loads((self.source / "catalogs" / SLUG / "manifest.json").read_text())
        old["yunipals"]["catalogCommitment"] = manifest["artworkHash"]
        self.metadata = self.source / "catalogs" / SLUG / "variants/149.json"
        self.metadata.parent.mkdir()
        self.metadata.write_text(json.dumps(old))
        self.destination = self.target / "catalogs" / SLUG / "variants/149.json"
        self.job = self.target / "jobs" / SLUG / "149.json"
        self.job.parent.mkdir(parents=True)
        document = json.loads(self.metadata.read_text())
        self.job.write_text(json.dumps({"schemaVersion": 1, "catalog": SLUG, "catalogHash": art_runtime.CATALOG_HASH,
            "variantId": RANK, "status": "queued", "traits": {item["trait_type"].lower(): item["value"] for item in document["attributes"]}}))

    def tearDown(self):
        self.temporary.cleanup()

    def test_verified_bundle_transfers_all_holo_assets_before_metadata(self):
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

    def test_explicit_prepublishing_allows_missing_job_and_remains_immutable(self):
        self.job.unlink()
        proof = m.install(self.source, self.target, SLUG, RANK, allow_unrevealed=True)
        self.assertEqual(proof["status"], "REVIEWED")
        self.assertTrue(proof["allowUnrevealed"])
        self.assertFalse(self.destination.exists())
        result = m.install(self.source, self.target, SLUG, RANK, True, True)
        self.assertEqual(result["status"], "INSTALLED")
        original = self.destination.read_bytes()
        document = json.loads(self.metadata.read_text())
        document["description"] = "Replacement is still forbidden"
        self.metadata.write_text(json.dumps(document))
        with self.assertRaisesRegex(RuntimeError, "cannot be replaced"):
            m.install(self.source, self.target, SLUG, RANK, True, True)
        self.assertEqual(self.destination.read_bytes(), original)

    def test_prepublishing_still_rejects_an_existing_invalid_job(self):
        document = json.loads(self.job.read_text())
        document["variantId"] = RANK + 1
        self.job.write_text(json.dumps(document))
        with self.assertRaisesRegex(RuntimeError, "No matching observed queue job"):
            m.install(self.source, self.target, SLUG, RANK, True, True)
        self.assertFalse(self.destination.exists())

    def test_prepublishing_does_not_allow_unbound_image_bytes(self):
        self.job.unlink()
        document = json.loads(self.metadata.read_text())
        image = self.source / "assets" / document["image"].rsplit("/", 1)[1]
        image.write_bytes(image.read_bytes() + b"changed")
        with self.assertRaisesRegex(RuntimeError, "hash mismatch"):
            m.install(self.source, self.target, SLUG, RANK, True, True)
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
