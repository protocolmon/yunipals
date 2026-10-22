#!/usr/bin/env python3
"""Offline installer admission controls; no production or database access."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("modern_installer", HERE / "arena-modern-install-v1.py")
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
ROOT = HERE.parent.parent


def fixture():
    proof = {
        "format": "yunipals-arena-modern-package-v1", "status": "passed", "reviewHash": "a" * 64,
        "sourceDigest": installer.SOURCE,
        "source": {"manifestSha256": installer.MANIFEST_SHA, "files": 1796},
        "runtime": {"entries": 60922, "separateRelocatedTreeRebuildByteIdentical": True},
        "verification": {"twoFullTypechecks": True, "ordinaryMarketBuilds": 2, "bundleCount": 36, "dependencyPackages": 330,
                         "targetedCredentialReaderSuites": 2, "credentialControlsPerSuite": 79, "modernAcceptanceSuites": 2, "modernChecksPerSuite": 21,
                         "catalog": {"rulesHash": "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80", "poolHash": "0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c", "islands": 898}}
    }
    receipt = {"status": "passed", "proofSha256": "b" * 64, "reviewHash": "a" * 64}
    steps = [{"name": name, "exitCode": 0} for name in ["credential-reader-controls", "relocated-credential-reader-controls", "modern-acceptance", "relocated-modern-acceptance"]]
    return proof, {**receipt, "steps": steps}, receipt


class Admission(unittest.TestCase):
    def test_actual_public_overlay_composition_matches_installer(self):
        before = json.loads((HERE / "frozen-baseline-source" / "3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d" / "RELEASE-MANIFEST.json").read_bytes())
        overlay = json.loads((ROOT / "docs/unified-indexer/arena-live-compat-build-overlay-manifest-2026-10-22.json").read_bytes())
        replacements = {row["path"]: row for row in overlay["files"]}
        rows, seen = [], set()
        for row in before["files"]:
            seen.add(row["path"])
            replacement = replacements.get(row["path"])
            rows.append({key: replacement[key] for key in ["path", "bytes", "sha256"]} if replacement else row)
        rows.extend({key: replacements[name][key] for key in ["path", "bytes", "sha256"]} for name in sorted(set(replacements) - seen))
        manifest = {**before, "files": rows, "sourceDigest": hashlib.sha256(installer.encoded(rows)).hexdigest()}
        self.assertEqual(len(rows), 1796)
        self.assertEqual(manifest["sourceDigest"], installer.SOURCE)
        self.assertEqual(hashlib.sha256(installer.encoded(manifest)).hexdigest(), installer.MANIFEST_SHA)

    def test_only_completed_bound_build_is_admitted(self):
        proof, result, output = fixture()
        self.assertIs(installer.validate_proof(proof, result, output, "b" * 64, "a" * 64), proof)
        for target, key, value in [(proof, "status", "failed"), (proof, "sourceDigest", "c" * 64), (result, "reviewHash", "c" * 64), (output, "proofSha256", "c" * 64)]:
            old = target[key]
            target[key] = value
            with self.assertRaises(RuntimeError):
                installer.validate_proof(proof, result, output, "b" * 64, "a" * 64)
            target[key] = old

    def test_both_actual_test_runs_are_required(self):
        proof, result, output = fixture()
        for bad in [result["steps"][:-1], result["steps"] + [result["steps"][0]], [{**row, "exitCode": 1} for row in result["steps"]]]:
            with self.assertRaisesRegex(RuntimeError, "both_actual"):
                installer.validate_proof(proof, {**result, "steps": bad}, output, "b" * 64, "a" * 64)

    def test_original_or_partial_runtime_cannot_be_installed(self):
        proof, result, output = fixture()
        for section, key, value in [("source", "files", 1748), ("source", "manifestSha256", "c" * 64), ("runtime", "entries", 60918), ("runtime", "separateRelocatedTreeRebuildByteIdentical", False), ("verification", "bundleCount", 34), ("verification", "dependencyPackages", 331)]:
            changed = copy.deepcopy(proof)
            changed[section][key] = value
            with self.assertRaises(RuntimeError):
                installer.validate_proof(changed, result, output, "b" * 64, "a" * 64)

    def test_empty_suites_or_wrong_actual_catalog_are_refused(self):
        proof, result, output = fixture()
        for key, value in [("credentialControlsPerSuite", 0), ("modernChecksPerSuite", 0), ("targetedCredentialReaderSuites", 1), ("modernAcceptanceSuites", 1), ("catalog", {"islands": 898, "rulesHash": "0x" + "0" * 64})]:
            changed = copy.deepcopy(proof)
            changed["verification"][key] = value
            with self.assertRaises(RuntimeError):
                installer.validate_proof(changed, result, output, "b" * 64, "a" * 64)

    def test_install_requires_fresh_exact_review_before_filesystem_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "artifact"
            with patch.object(installer, "ARTIFACT", artifact):
                with self.assertRaisesRegex(RuntimeError, "exact_fresh_install_review"):
                    installer.install(({"reviewed": True}, None, None, None, None, None), "0" * 64)
            self.assertFalse(artifact.exists())

    def test_existing_artifact_is_retained_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "artifact"
            artifact.mkdir()
            retained = artifact / "retained"
            retained.write_bytes(b"existing artifact")
            value = {"reviewed": True}
            with patch.object(installer, "ARTIFACT", artifact):
                with self.assertRaises(FileExistsError):
                    installer.install((value, None, None, None, None, None), installer.sha(installer.encoded(value)))
            self.assertEqual(retained.read_bytes(), b"existing artifact")

    def test_missing_or_placeholder_pins_are_refused(self):
        for value in [None, "", "0" * 64, "A" * 64, "../artifact"]:
            with self.assertRaises(RuntimeError):
                installer.pin(value)


if __name__ == "__main__":
    unittest.main()
