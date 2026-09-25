import json
import tempfile
import unittest
from pathlib import Path
from health_contract import load_frontend_manifest, policy_is_valid


class HealthContractTests(unittest.TestCase):
    def policy(self, **changes):
        return dict(source="opensea", chain="polygon", maxDurationSeconds="2592000",
                    fees=[{"basisPoints": 100}], expiresAt="2000", **changes)

    def test_approved_policy(self):
        self.assertTrue(policy_is_valid(200, self.policy(), "polygon", 1000))

    def test_rejects_wrong_duration_expiry_fees_and_identity(self):
        for key, value in [("maxDurationSeconds", "86400"), ("maxDurationSeconds", "2592001"),
                           ("expiresAt", "1000"), ("expiresAt", "invalid"),
                           ("fees", [{"basisPoints": 101}]), ("fees", [{"basisPoints": -1}]),
                           ("fees", [{"basisPoints": True}]), ("fees", None),
                           ("chain", "base"), ("source", "unknown")]:
            with self.subTest(key=key, value=value):
                p = self.policy()
                p[key] = value
                self.assertFalse(policy_is_valid(200, p, "polygon", 1000))
        self.assertFalse(policy_is_valid(503, self.policy(), "polygon", 1000))

    def test_manifest_rejects_missing_or_unsafe_values(self):
        manifest = dict(formatVersion=1, gitRevision="a" * 40, deploymentId="dpl_test",
                        htmlSha256="b" * 64, jsSha256="c" * 64, jsPath="/assets/index-test.js")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            self.assertEqual(load_frontend_manifest(path), manifest)
            for changes in [{"jsPath": "/assets/../../secret.js"}, {"gitRevision": "main"},
                            {"jsSha256": None}, {"formatVersion": 2}]:
                path.write_text(json.dumps(manifest | changes))
                with self.assertRaises(ValueError):
                    load_frontend_manifest(path)
            path.write_text("{}")
            with self.assertRaises(ValueError):
                load_frontend_manifest(path)


if __name__ == "__main__":
    unittest.main()
