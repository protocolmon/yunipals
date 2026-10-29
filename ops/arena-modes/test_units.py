import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("render_units", Path(__file__).with_name("render_units.py"))
units = importlib.util.module_from_spec(spec)
spec.loader.exec_module(units)


class SharedArenaUnitSecurityTest(unittest.TestCase):
    def test_role_keys_and_provider_access_are_scoped(self):
        policy = (ROOT / "apps/yunipals-market-api/src/arena/live/privateFile.ts").read_text()
        for mode in ("video", "anime"):
            for role in units.ROLES:
                with self.subTest(mode=mode, role=role):
                    value = units.render(mode, role)
                    name = f"yunipals-arena-v2-{mode}-{role}.service"
                    self.assertIn(f'"{name}":', policy)
                    credentials = re.findall(r"^LoadCredential=([^:]+):", value, re.M)
                    expected = ["strategy-encryption.key"]
                    if role in ("api", "lobby", "settlement"):
                        expected.append({"api": "admission.key", "lobby": "operator.key", "settlement": "referee.key"}[role])
                    self.assertEqual(credentials, expected)
                    providers = re.findall(r"^EnvironmentFile=(/etc/(?:yunipals-arena/(?:arena|runware)|yunipals-anime-arena/openrouter)\.env)$", value, re.M)
                    expected_provider = "/etc/yunipals-arena/arena.env" if role == "referee" else (
                        ("/etc/yunipals-arena/runware.env" if mode == "video" else "/etc/yunipals-anime-arena/openrouter.env")
                        if role in ("media", "capacity") else None)
                    self.assertEqual(providers, [expected_provider] if expected_provider else [])
                    if providers:
                        self.assertLess(value.index("EnvironmentFile=" + providers[0]), value.index(f"EnvironmentFile=/etc/yunipals-arena-modes/{mode}/runtime.env"))
                    self.assertIn("ProtectSystem=strict", value)
                    self.assertIn("ProtectHome=true", value)
                    self.assertNotIn("deployer", value)


if __name__ == "__main__":
    unittest.main()
