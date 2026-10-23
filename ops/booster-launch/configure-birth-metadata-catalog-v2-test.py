#!/usr/bin/env python3
"""Real-file config-only owner tests; synthetic manager and loopback HTTP."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result
m = load("catalog_owner", HERE / "configure-birth-metadata-catalog-v2.py")
frozen = load("catalog_test_frozen_core", HERE / "rollout-birth-metadata-api-v1.py")


class Configuration(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix=".catalog-v2-test-", dir=HERE)))
        self.base = root / "evidence"; self.unit = root / "api.service"
        self.api = root / "unchanged-api"; self.api.mkdir()
        actual_artifacts = HERE.parents[1] / "apps/yunipals-indexer/artifacts/booster-api"
        for name in frozen.FILES: (self.api / name).write_bytes((actual_artifacts / name).read_bytes())
        self.old_unit = ("[Service]\nWorkingDirectory=" + str(self.api) + "\nEnvironmentFile=/etc/yunipals-unified/booster-api.env\nEnvironment=" + m.BAD_ENV + "\nExecStart=" + frozen.NODE + " --max-old-space-size=256 " + str(self.api / "booster-api.mjs") + "\n").encode()
        self.unit.write_bytes(self.old_unit)
        self.current = copy.deepcopy(m.OLD_API); self.live_env = m.BAD_ENV; self.actions = []
        self.independent = {"same-source": {"pid": "716994", "invocation": "c346"}}
        self.bad_birth = False
        self.shared = {"name": "Yunidragon", "image": "https://api.yunipals.com/approved/dragon.png",
                       "attributes": [{"trait_type": key, "value": value} for key, value in [("Type", "Yunidragon"), ("Color", "Blue"), ("Horn", "Spiral"), ("Glitter", "Glitter + holo")]],
                       "yunipals": {"variantId": 73, "status": "ready", "holo": {"effect": "approved-foil"}}}
        self.catalogs = {}; pins = []
        directory = root / "catalogs"
        for pack, slug, _ in m.CATALOGS:
            document = {"slug": slug, "catalogHash": "0x" + "63" * 32, "metadataBaseURI": "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/" + slug + "/"}
            raw = frozen.encoded(document); target = directory / slug / "manifest.json"
            target.parent.mkdir(parents=True); target.write_bytes(raw)
            self.catalogs[slug] = document; pins.append((pack, slug, frozen.sha(raw)))
        self.original_catalogs = m.CATALOGS
        self.prior = {"bootId": "same-boot", "approvedSharedVariantSha256": frozen.sha(frozen.encoded(self.shared)), "independentActors": self.independent}

        def get(route):
            if route == "/readyz": return 200, {"ready": True, "engine": frozen.ENGINE, "collection": frozen.COLLECTION, "indexedBlock": "52979700"}
            if route == "/v1/boosters/types": return 200, {"items": [{"packTypeId": str(i + 1), "registry": "0xeaee2da120a398f21729d50672ac5d1dd71d7274", "engine": frozen.ENGINE, "metadataBaseUri": doc["metadataBaseURI"], "catalogHash": doc["catalogHash"]} for i, doc in enumerate(self.catalogs.values())]}
            for slug, doc in self.catalogs.items():
                if route == "/v1/boosters/art/" + slug + "/manifest.json": return 200, copy.deepcopy(doc)
            if route == frozen.REQUEST_PATH: return 200, {"item": {"id": frozen.REQUEST_KEY, "status": "completed", "quantity": 1}}
            if route == frozen.REQUEST_PATH + "/monsters": return 200, {"status": "completed", "quantity": 1, "items": [{"requestKey": frozen.REQUEST_KEY, "collection": frozen.COLLECTION, "tokenId": "1"}]}
            if route == frozen.SHARED_VARIANT_PATH: return 200, copy.deepcopy(self.shared)
            self.assertEqual(route, frozen.METADATA_PATH)
            if self.live_env == m.BAD_ENV: return 503, {"error": "booster_birth_metadata_unavailable"}
            result = copy.deepcopy(self.shared)
            result["attributes"] += [{"trait_type": "Birth day", "display_type": "number", "value": 0}, {"trait_type": "Born", "display_type": "date", "value": 1792498510}]
            result["yunipals"].update({"birthMetadataVersion": 1, "chainId": 8453, "collection": frozen.COLLECTION, "tokenId": "73" if self.bad_birth else "1", "originalTokenId": "1", "isOriginal": True, "birthDay": 0, "bornAt": "1792498510", "originalBornAt": "1792498510", "mint": {"blockNumber": "52848700"}, "originalMint": {"blockNumber": "52848700"}})
            return 200, result

        def actor(root):
            self.assertEqual(root, self.api); return copy.deepcopy(self.current)

        def run(args, **_):
            self.actions.append(args)
            if args == ["/usr/bin/systemctl", "daemon-reload"]: return b""
            self.assertEqual(args, ["/usr/bin/systemctl", "restart", frozen.UNIT])
            self.live_env = m.GOOD_ENV if m.GOOD_ENV.encode() in self.unit.read_bytes() else m.BAD_ENV
            self.current = {"pid": 1700000 + len(self.actions), "invocation": ("a" if self.live_env == m.GOOD_ENV else "b") * 32,
                            "startTicks": m.time.monotonic_ns() * os.sysconf("SC_CLK_TCK") // 1000000000 + 1, "restarts": 0}
            return b""

        self.c = types.SimpleNamespace(**{name: getattr(frozen, name) for name in ["read", "sha", "encoded", "save", "sync", "ENGINE", "COLLECTION", "REQUEST_PATH", "REQUEST_KEY", "SHARED_VARIANT_PATH", "METADATA_PATH", "FILES", "NEW_SHA", "UNIT"]})
        self.c.NEW_ROOT = self.api; self.c.UNIT_FILE = self.unit; self.c.get = get; self.c.actor = actor; self.c.run = run
        self.c.independent = lambda: copy.deepcopy(self.independent)
        self.c.operation = lambda pin: (copy.deepcopy(self.prior), pin)
        self.c.inspect = lambda: {"operationSha256": m.PRIOR_SHA, "unitSha256": frozen.sha(self.unit.read_bytes()), "api": copy.deepcopy(self.current)}
        self.c.state = lambda _: {"ActiveState": "active", "MainPID": str(self.current["pid"]), "Job": ""}
        self.stack.enter_context(patch.object(frozen, "get", get))
        self.c.wait_checks = lambda new: frozen.checks(new)
        for name, value in {"BASE": self.base, "OLD_UNIT_SHA": frozen.sha(self.old_unit), "CATALOG_DIRECTORY": directory, "CATALOGS": tuple(pins), "core": lambda: self.c}.items():
            self.stack.enter_context(patch.object(m, name, value))

    def apply(self): return m.apply(m.review()["reviewHash"])

    def test_readonly_review_one_line_change_same_bundle_and_owned_inverse(self):
        original_bundle = (self.api / "booster-api.mjs").read_bytes()
        checked = m.review(); self.assertFalse(self.base.exists()); self.assertFalse(self.actions)
        self.assertEqual(checked["baseline"]["birthMetadataStatus"], 503)
        result = m.apply(checked["reviewHash"])
        self.assertTrue(result["completed"]); self.assertEqual(result["artifactInstallations"], 0)
        self.assertEqual(self.unit.read_bytes(), self.old_unit.replace(m.BAD_ENV.encode(), m.GOOD_ENV.encode()))
        self.assertEqual((self.api / "booster-api.mjs").read_bytes(), original_bundle)
        restored = m.rollback(result["operationSha256"])
        self.assertTrue(restored["birthMetadataRestoredToKnownFailure"])
        self.assertEqual(self.unit.read_bytes(), self.old_unit)
        self.assertEqual([args for args in self.actions if "restart" in args], [["/usr/bin/systemctl", "restart", frozen.UNIT]] * 2)

    def test_authoritative_catalog_names_and_raw_pins(self):
        self.assertEqual(self.original_catalogs[1], ("2", "base-mainnet-standard-v1", "79e85ccfa753bb81d8115a17e963f3b427e276f5e68b24d0a3ee284d85c3c2bf"))
        self.assertEqual(m.GOOD_ENV, "BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1")

    def test_wrong_old_actor_or_unit_refuses_without_actions(self):
        self.current["invocation"] = "f" * 32
        with self.assertRaisesRegex(RuntimeError, "failed_rollout"): m.review()
        self.assertFalse(self.actions); self.assertFalse(self.base.exists())
        self.current = copy.deepcopy(m.OLD_API); self.unit.write_bytes(self.old_unit + b"# foreign\n")
        with self.assertRaisesRegex(RuntimeError, "failed_rollout"): m.review()
        self.assertFalse(self.actions)

    def test_wrong_catalog_or_raw_manifest_refuses_before_intent(self):
        self.catalogs["base-mainnet-standard-v1"]["metadataBaseURI"] = "https://wrong.example/"
        with self.assertRaisesRegex(RuntimeError, "pack_catalog_match"): m.review()
        self.assertFalse(self.actions); self.assertFalse(self.base.exists())

    def test_bad_birth_cannot_get_success_receipt_and_explicit_inverse_still_works(self):
        self.bad_birth = True
        with self.assertRaisesRegex(RuntimeError, "original_birth_metadata"): self.apply()
        self.assertFalse((self.base / "result.json").exists())
        self.assertTrue(m.rollback(m.inspect()["operationSha256"])["restored"])

    def test_lost_restart_ack_inspection_and_single_explicit_inverse(self):
        original = self.c.run
        def lost(args, **kwargs):
            result = original(args, **kwargs)
            if "restart" in args: raise RuntimeError("lost_restart_ack")
            return result
        with patch.object(self.c, "run", lost), self.assertRaisesRegex(RuntimeError, "lost_restart_ack"): self.apply()
        inspected = m.inspect(); self.assertNotEqual(inspected["api"], m.OLD_API)
        self.assertTrue(m.rollback(inspected["operationSha256"])["restored"])
        with self.assertRaisesRegex(RuntimeError, "existing_inverse"): m.rollback(inspected["operationSha256"])

    def test_lost_reload_ack_restores_config_without_restart(self):
        original = self.c.run
        def lost(args, **kwargs): original(args, **kwargs); raise RuntimeError("lost_reload_ack")
        with patch.object(self.c, "run", lost), self.assertRaisesRegex(RuntimeError, "lost_reload_ack"): self.apply()
        self.assertTrue(m.rollback(m.inspect()["operationSha256"])["restored"])
        self.assertFalse(any("restart" in args for args in self.actions))

    def test_foreign_replacement_or_independent_actor_change_refuses_inverse_actions(self):
        result = self.apply(); before = list(self.actions)
        self.current["startTicks"] += 120 * os.sysconf("SC_CLK_TCK")
        with self.assertRaisesRegex(RuntimeError, "owned_api_start"): m.rollback(result["operationSha256"])
        self.assertEqual(self.actions, before)
        self.independent["same-source"]["pid"] = "foreign"
        with self.assertRaisesRegex(RuntimeError, "independent_indexer"): m.inspect()


if __name__ == "__main__": unittest.main()
