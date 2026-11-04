import importlib.util
from pathlib import Path
import unittest
import json
import os
import tempfile

spec = importlib.util.spec_from_file_location("production_health", Path(__file__).with_name("production-health.py"))
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class AcceptanceTests(unittest.TestCase):
    def previous(self, **changes):
        return {"healthy": True, "bootId": "boot", "checkedAtUnix": 14440, "healthySinceUnix": 100, **changes}

    def test_continuous_samples_reach_both_windows(self):
        result = health.acceptance(self.previous(), 14500, "boot", True)
        self.assertTrue(result["ninetyMinutesPassed"])
        self.assertTrue(result["fourHoursPassed"])

    def test_four_hour_boundary_preserves_existing_healthy_evidence(self):
        previous = self.previous(eightHoursPassed=False)
        for now, passed in [(14499, False), (14500, True)]:
            with self.subTest(now=now):
                result = health.acceptance(previous, now, "boot", True)
                self.assertEqual(result["healthySinceUnix"], 100)
                self.assertEqual(result["fourHoursPassed"], passed)

    def test_failure_clears_observation_window(self):
        result = health.acceptance(self.previous(), 14500, "boot", False)
        self.assertIsNone(result["healthySinceUnix"])
        self.assertFalse(result["ninetyMinutesPassed"])
        self.assertFalse(result["fourHoursPassed"])

    def test_reboot_gap_or_clock_reversal_requires_a_new_window(self):
        for now, boot in [(14500, "new-boot"), (14621, "boot"), (14400, "boot")]:
            with self.subTest(now=now, boot=boot):
                result = health.acceptance(self.previous(), now, boot, True)
                self.assertEqual(result["healthySeconds"], 0)
                self.assertFalse(result["fourHoursPassed"])

    def test_recovery_after_failure_starts_from_current_sample(self):
        result = health.acceptance(self.previous(healthy=False, healthySinceUnix=None), 14500, "boot", True)
        self.assertEqual(result["healthySinceUnix"], 14500)

    def test_probe_requires_current_configuration_owner_and_fresh_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "probe.json"
            path.write_text(json.dumps({"kind": "source", "configurationSha256": "current", "checkedAtUnix": 1000, "healthy": True}))
            path.chmod(0o644)
            self.assertTrue(health.probe_report(path, os.geteuid(), "current", "source", 1060)["healthy"])
            for owner, configuration, kind, now in [(os.geteuid()+1, "current", "source", 1060), (os.geteuid(), "previous", "source", 1060), (os.geteuid(), "current", "budget", 1060), (os.geteuid(), "current", "source", 1121), (os.geteuid(), "current", "source", 999)]:
                with self.subTest(owner=owner, configuration=configuration, kind=kind, now=now):
                    with self.assertRaises(AssertionError):
                        health.probe_report(path, owner, configuration, kind, now)


if __name__ == "__main__":
    unittest.main()
