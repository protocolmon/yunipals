#!/usr/bin/env python3
"""Real-file API rollout/inverse controls with synthetic manager/HTTP only."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("api_rollout", HERE / "rollout-collection-booster-api-v1.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ARTIFACTS = HERE.parents[1] / "apps/yunipals-indexer/artifacts/booster-api"


class Rollout(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack(); self.addCleanup(self.stack.close)
        root = Path(self.stack.enter_context(tempfile.TemporaryDirectory(prefix=".api-rollout-test-", dir=HERE)))
        self.old, self.new, self.stage, self.base = [root / n for n in ["old", "new", "stage", "evidence"]]
        for p in [self.old, self.stage, root / "units"]: p.mkdir(mode=0o755)
        self.unit = root / "units" / m.UNIT
        raw = ("[Service]\nUser=yunipals_unified_collector\nGroup=yunipals_unified_collector\n"
               "WorkingDirectory=" + str(self.old) + "\nEnvironmentFile=/etc/yunipals-unified/booster-api.env\nEnvironment=" + m.PUBLIC_ENVIRONMENT + "\n"
               "ExecStart=" + m.NODE + " --max-old-space-size=256 " + str(self.old / "booster-api.mjs") + "\n").encode()
        self.unit.write_bytes(raw); self.original_unit = raw
        old_program = b"unchanged original public API"
        (self.old / "booster-api.mjs").write_bytes(old_program)
        (self.old / "node_modules").mkdir(mode=0o755)
        (self.old / "node_modules" / "untouched").write_bytes(b"retained dependencies")
        for name in m.FILES: (self.stage / name).write_bytes((ARTIFACTS / name).read_bytes())
        for name, value in {"HERE": self.stage, "BASE": self.base, "OLD_ROOT": self.old,
                            "NEW_ROOT": self.new, "UNIT_FILE": self.unit,
                            "OLD_UNIT_SHA": m.sha(raw), "OLD_SHA": m.sha(old_program)}.items():
            self.stack.enter_context(patch.object(m, name, value))
        self.old_actor = {**m.OLD_API, "startTicks": 100, "restarts": 0}
        self.current_actor = dict(self.old_actor)
        self.process_root = self.loaded_root = self.old
        self.running = True; self.bad_response = False
        self.global_rows = [{"id": "8453:" + m.COLLECTION + ":1", "collection": m.COLLECTION, "tokenId": "1", "originalKey": "8453:" + m.COLLECTION + ":1", "requestKey": m.REQUEST_KEY, "isOriginal": True, "burned": False}]
        self.cursor = None
        self.bad_birth = None; self.bad_art = None; self.change_shared = False
        self.shared = {
            "name": "Yunidragon", "image": "https://api.yunipals.com/approved/dragon.png",
            "attributes": [{"trait_type": key, "value": value} for key, value in
                           [("Type", "Yunidragon"), ("Color", "Blue"), ("Horn", "Spiral"), ("Glitter", "Glitter + holo")]],
            "yunipals": {"variantId": 73, "status": "ready", "holo": {"effect": "locked-approved-foil", "mask": "https://api.yunipals.com/approved/mask.png"}}
        }
        self.independent = {"source": {"pid": "716994", "invocation": "fixed-source"}}
        self.actions = []
        # Exercise the real protected prior-receipt validator, using a finite
        # synthetic acknowledged catalog operation rather than a bypass boolean.
        prior = root / "catalog-success"; prior.mkdir()
        prior_operation = {"operatorSha256": m.PRIOR_OWNER_SHA, "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                           "independentActors": self.independent}
        raw_operation = m.encoded(prior_operation)
        prior_result = {"format": "yunipals-booster-birth-metadata-catalog-config-v2", "completed": True,
                        "operationSha256": m.sha(raw_operation), "unitSha256": m.OLD_UNIT_SHA,
                        "publicEnvironment": m.PUBLIC_ENVIRONMENT,
                        "api": {**m.OLD_API, "startTicks": 6617701491, "restarts": 0},
                        "readiness": {"birthMetadataVerified": True, "sharedMetadataSha256": m.sha(m.encoded(self.shared))}}
        raw_result = m.encoded(prior_result)
        (prior / "operation.json").write_bytes(raw_operation); (prior / "result.json").write_bytes(raw_result)
        pins = {name: m.sha((self.stage / name).read_bytes()) for name in m.FILES}
        for name, value in {"PRIOR_BASE": prior, "PRIOR_OPERATION_SHA": m.sha(raw_operation),
                            "PRIOR_RESULT_SHA": m.sha(raw_result), "FILES": pins,
                            "NEW_SHA": json.loads((self.stage / "manifest.json").read_text())["sha256"]}.items():
            self.stack.enter_context(patch.object(m, name, value))

        def state(unit):
            self.assertEqual(unit, m.UNIT)
            return {"ActiveState": "active" if self.running else "failed", "MainPID": str(self.current_actor["pid"]) if self.running else "0",
                    "InvocationID": self.current_actor["invocation"], "WorkingDirectory": str(self.loaded_root), "Job": ""}

        def actor(root, loaded_root=None):
            self.assertEqual(self.process_root, root)
            self.assertEqual(self.loaded_root, root if loaded_root is None else loaded_root)
            self.assertTrue(self.running)
            return dict(self.current_actor)

        def run(args, **kwargs):
            self.actions.append(args)
            if args == ["/usr/bin/systemctl", "daemon-reload"]:
                self.loaded_root = self.new if str(self.new).encode() in self.unit.read_bytes() else self.old
            else:
                self.assertEqual(args, ["/usr/bin/systemctl", "restart", m.UNIT])
                self.process_root = self.loaded_root; self.running = True
                self.current_actor = {"pid": 600001 if self.process_root == self.new else 600002,
                                      "invocation": ("a" if self.process_root == self.new else "b") * 32,
                                      "startTicks": m.time.monotonic_ns() * os.sysconf("SC_CLK_TCK") // 1000000000 + 1,
                                      "restarts": 0}
            return b""

        def get(path):
            if path == "/readyz": return 200, {"ready": True, "engine": m.ENGINE, "collection": m.COLLECTION, "indexedBlock": "123"}
            if path == "/v1/boosters/types": return 200, {"items": [{"packTypeId": "1"}, {"packTypeId": "2"}]}
            if path == m.REQUEST_PATH: return 200, {"item": {"id": m.REQUEST_KEY, "status": "completed", "quantity": 1}}
            if path == m.REQUEST_PATH + "/monsters":
                return 200, {"status": "completed", "quantity": 1, "items": [{"requestKey": "foreign" if self.bad_response and self.process_root == self.new else m.REQUEST_KEY,
                             "collection": m.COLLECTION, "tokenId": "1", "burned": False}]}
            shared = copy.deepcopy(self.shared)
            if self.change_shared and self.process_root == self.new: shared["image"] = "https://api.yunipals.com/foreign/changed.png"
            if path == m.SHARED_VARIANT_PATH: return 200, shared
            if path == m.GLOBAL_PATH:
                return (200, {"enabled": True, "chainId": 8453, "collection": m.COLLECTION, "engine": m.ENGINE, "items": copy.deepcopy(self.global_rows), "nextCursor": self.cursor}) if self.process_root == self.new else (404, {})
            self.assertEqual(path, m.METADATA_PATH)
            metadata = copy.deepcopy(shared)
            metadata["attributes"] += [{"trait_type": "Birth day", "display_type": "number", "value": 0},
                                       {"trait_type": "Born", "display_type": "date", "value": 1792498510}]
            metadata["yunipals"].update({"birthMetadataVersion": 1, "chainId": 8453, "collection": m.COLLECTION,
                "tokenId": "1", "originalTokenId": "1", "isOriginal": True, "birthDay": 0, "bornAt": "1792498510", "originalBornAt": "1792498510",
                "mint": {"blockNumber": "52848700"}, "originalMint": {"blockNumber": "52848700"}})
            if self.bad_birth == "variant-as-token": metadata["yunipals"]["tokenId"] = "73"
            if self.bad_birth == "wrong-day": metadata["yunipals"]["birthDay"] = 1
            if self.bad_birth == "unproven-time": metadata["yunipals"]["bornAt"] = "0"
            if self.bad_art == "image": metadata["image"] = "https://api.yunipals.com/foreign/changed.png"
            if self.bad_art == "holo": metadata["yunipals"]["holo"]["effect"] = "foreign"
            if self.bad_art == "trait": metadata["attributes"][1]["value"] = "wrong-color"
            return 200, metadata

        for name, value in {"state": state, "actor": actor, "run": run, "get": get,
                            "independent": lambda: copy.deepcopy(self.independent),
                            "wait_checks": lambda new: m.checks(new)}.items():
            self.stack.enter_context(patch.object(m, name, value))

    def apply(self):
        checked = m.review()
        return m.apply(checked["reviewHash"])

    def test_readonly_review_and_atomic_api_only_rollout_and_owned_inverse(self):
        checked = m.review()
        self.assertFalse(self.base.exists()); self.assertFalse(self.actions)
        result = m.apply(checked["reviewHash"])
        self.assertTrue(result["completed"])
        self.assertEqual((self.new / "booster-api.mjs").read_bytes(), (self.stage / "booster-api.mjs").read_bytes())
        self.assertEqual(self.new.stat().st_mode & 0o777, 0o755)
        self.assertEqual((self.new / "booster-api.mjs").stat().st_mode & 0o777, 0o644)
        self.assertIn(b"EnvironmentFile=/etc/yunipals-unified/booster-api.env\n", self.unit.read_bytes())
        self.assertEqual(self.unit.read_bytes().count(b"Environment=" + m.PUBLIC_ENVIRONMENT.encode() + b"\n"), 1)
        self.assertTrue(result["readiness"]["birthMetadataVerified"])
        self.assertEqual(result["readiness"]["requestMonstersStatus"], 200)
        self.assertEqual(result["grantChanges"], 0)
        restored = m.rollback(result["operationSha256"])
        self.assertTrue(restored["restored"]); self.assertEqual(self.unit.read_bytes(), self.original_unit)
        self.assertEqual((self.old / "node_modules" / "untouched").read_bytes(), b"retained dependencies")
        self.assertEqual([x for x in self.actions if "restart" in x], [["/usr/bin/systemctl", "restart", m.UNIT]] * 2)
        self.assertTrue((self.new / "booster-api.mjs").exists())

    def test_wrong_old_invocation_or_foreign_unit_refuses_before_intent(self):
        self.current_actor["invocation"] = "f" * 32
        with self.assertRaisesRegex(RuntimeError, "recorded_old_api"): m.review()
        self.assertFalse(self.base.exists()); self.assertFalse(self.actions)
        self.current_actor = dict(self.old_actor); self.unit.write_bytes(self.original_unit + b"Environment=FOREIGN=1\n")
        with self.assertRaisesRegex(RuntimeError, "old_unit_bytes"): m.review()
        self.assertFalse(self.actions)

    def test_changed_artifact_or_wrong_review_has_no_manager_action(self):
        checked = m.review()
        with self.assertRaisesRegex(RuntimeError, "fresh_api_review"): m.apply("0" * 64)
        self.assertFalse(self.base.exists())
        (self.stage / "booster-api.mjs").write_bytes(b"foreign")
        with self.assertRaisesRegex(RuntimeError, "built_candidate"): m.apply(checked["reviewHash"])
        self.assertFalse(self.actions)

    def test_lost_restart_ack_inspects_actual_owned_new_actor_then_rolls_back_once(self):
        actual_run = m.run
        def lost_ack(args, **kwargs):
            actual_run(args, **kwargs)
            if "restart" in args: raise RuntimeError("simulated_restart_ack_loss")
        with patch.object(m, "run", lost_ack), self.assertRaisesRegex(RuntimeError, "ack_loss"): self.apply()
        current = m.inspect(); self.assertEqual(current["api"]["pid"], 600001)
        self.assertTrue(m.rollback(current["operationSha256"])["restored"])
        with self.assertRaisesRegex(RuntimeError, "inspect_existing_inverse"): m.rollback(current["operationSha256"])

    def test_reload_ack_loss_before_restart_restores_unit_without_restarting_old_actor(self):
        actual_run = m.run
        def lost_ack(args, **kwargs):
            actual_run(args, **kwargs); raise RuntimeError("simulated_reload_ack_loss")
        with patch.object(m, "run", lost_ack), self.assertRaisesRegex(RuntimeError, "ack_loss"): self.apply()
        current = m.inspect(); self.assertEqual(current["api"], self.old_actor)
        restored = m.rollback(current["operationSha256"])
        self.assertTrue(restored["restored"])
        self.assertFalse(any("restart" in args for args in self.actions))

    def test_failed_candidate_can_be_explicitly_restored_with_no_other_service_changes(self):
        result = self.apply(); self.running = False
        restored = m.rollback(result["operationSha256"])
        self.assertTrue(restored["restored"])
        self.assertTrue(all(args[-1] == m.UNIT for args in self.actions if "restart" in args))

    def test_foreign_new_actor_or_changed_independent_actor_is_not_restarted(self):
        result = self.apply(); actions = list(self.actions)
        self.current_actor["startTicks"] += 120 * os.sysconf("SC_CLK_TCK")
        with self.assertRaisesRegex(RuntimeError, "owned_api_start"): m.rollback(result["operationSha256"])
        self.assertEqual(self.actions, actions)
        self.independent["source"]["pid"] = "foreign"
        with self.assertRaisesRegex(RuntimeError, "independent_indexer"): m.inspect()

    def test_wrong_request_scoped_result_cannot_produce_success_receipt(self):
        self.bad_response = True
        with self.assertRaisesRegex(RuntimeError, "request_scoped_monster"): self.apply()
        self.assertFalse((self.base / "result.json").exists())
        current = m.inspect(); self.bad_response = False
        self.assertTrue(m.rollback(current["operationSha256"])["restored"])

    def test_changed_original_or_installed_bundle_refuses_before_inverse_actions(self):
        result = self.apply(); actions = list(self.actions)
        (self.old / "booster-api.mjs").write_bytes(b"foreign original program")
        with self.assertRaisesRegex(RuntimeError, "immutable_original_bundle"):
            m.rollback(result["operationSha256"])
        self.assertEqual(self.actions, actions)
        self.assertFalse((self.base / "rollback-intent.json").exists())
        (self.new / "booster-api.mjs").write_bytes(b"foreign installed program")
        with self.assertRaisesRegex(RuntimeError, "installed_api_bundle"):
            m.inspect()
        self.assertEqual(self.actions, actions)

    def test_new_birth_identity_day_and_timestamp_must_match_actual_original(self):
        checked = m.review()
        self.assertEqual(checked["readiness"]["birthMetadataStatus"], 200)
        self.process_root = self.new
        for invalid in ["variant-as-token", "wrong-day", "unproven-time"]:
            self.bad_birth = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "original_birth_metadata"):
                m.checks(True)
        self.bad_birth = None
        self.assertTrue(m.checks(True)["birthMetadataVerified"])

    def test_changed_artwork_traits_or_foil_fail_before_success_receipt(self):
        self.process_root = self.new
        for invalid in ["image", "holo", "trait"]:
            self.bad_art = invalid
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "artwork_and_traits"):
                m.checks(True)
        self.bad_art = None
        self.assertTrue(m.checks(True)["birthMetadataVerified"])

    def test_shared_variant_drift_cannot_be_relabelled_as_approved_by_new_api(self):
        self.change_shared = True
        with self.assertRaisesRegex(RuntimeError, "shared_artwork_changed_during_rollout"):
            self.apply()
        self.assertFalse((self.base / "result.json").exists())
        current = m.inspect()
        self.change_shared = False
        self.assertTrue(m.rollback(current["operationSha256"])["restored"])

    def test_public_catalog_line_does_not_accept_duplicate_or_foreign_unit_bytes(self):
        expected = self.original_unit.replace(str(self.old).encode(), str(self.new).encode())
        self.assertEqual(m.new_unit(self.original_unit), expected)
        with self.assertRaisesRegex(RuntimeError, "old_unit_bytes"):
            m.new_unit(self.original_unit + b"Environment=BOOSTER_ARTWORK_CATALOGS=foreign\n")

    def test_legitimate_additional_mints_and_full_page_do_not_block_rollout(self):
        for token in range(2, 25):
            self.global_rows.append({"id": "8453:" + m.COLLECTION + ":" + str(token), "collection": m.COLLECTION,
                                     "tokenId": str(token), "originalKey": "8453:" + m.COLLECTION + ":" + str(token),
                                     "requestKey": "8453:" + m.ENGINE + ":" + str(token), "isOriginal": True, "burned": False})
        self.cursor = "24"
        result = self.apply()
        self.assertEqual(result["readiness"]["page"], {"pageRows": 24, "nextCursor": "24", "knownTokenId": "1"})
        self.assertTrue(result["readiness"]["birthMetadataVerified"])

    def test_wrong_global_identity_duplicates_order_and_cursor_are_refused(self):
        good = {"enabled": True, "chainId": 8453, "collection": m.COLLECTION, "engine": m.ENGINE,
                "items": copy.deepcopy(self.global_rows), "nextCursor": None}
        self.assertEqual(m.verify_global(good)["pageRows"], 1)
        for invalid in ["collection", "request", "duplicate", "cursor"]:
            bad = copy.deepcopy(good)
            if invalid == "collection": bad["items"][0]["collection"] = "0x" + "ff" * 20
            if invalid == "request": bad["items"][0]["requestKey"] = "foreign"
            if invalid == "duplicate": bad["items"].append(copy.deepcopy(bad["items"][0]))
            if invalid == "cursor": bad["nextCursor"] = "1"
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeError): m.verify_global(bad)

    def test_changed_acknowledged_catalog_result_refuses_before_actions(self):
        checked = m.review()
        result_path = m.PRIOR_BASE / "result.json"
        result_path.write_bytes(result_path.read_bytes() + b" ")
        with self.assertRaisesRegex(RuntimeError, "catalog_correction"):
            m.apply(checked["reviewHash"])
        self.assertFalse(self.actions); self.assertFalse(self.base.exists())

    def test_replaced_api_after_reload_is_not_restarted(self):
        original = m.run
        def replace_after_reload(args, **kwargs):
            result = original(args, **kwargs)
            if args == ["/usr/bin/systemctl", "daemon-reload"]:
                self.current_actor["invocation"] = "f" * 32
            return result
        with patch.object(m, "run", replace_after_reload), self.assertRaisesRegex(RuntimeError, "before_api_restart"):
            self.apply()
        self.assertFalse(any("restart" in args for args in self.actions))
        self.assertFalse((self.base / "result.json").exists())


if __name__ == "__main__": unittest.main()
