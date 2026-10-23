#!/usr/bin/env python3
import copy
import importlib.util
from pathlib import Path
import unittest

FILE = Path(__file__).with_name("ypal-backend-prepare-owner-v2.py")
spec = importlib.util.spec_from_file_location("ypal_prepare_v2", FILE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def snapshot():
    return {"observedAt": "changing", "nativeOld": {"schemaOid": "74518314", "app": {"build_id": "6d581272ce", "version": "6", "is_dev": "0", "is_locked": "1", "heartbeat_at": 1}}, "source": {"actor": {"pid": 1525164, "invocation": "87904b963ba14155b256677d30c824ec"}, "sessionAttribution": {"complete": True, "applicationNameOrAgeInference": False, "sharedRoleZeroSessionsRequired": False, "oldBackends": [{"pid": 1, "backendStart": "old"}], "combinedBackends": [{"pid": 2, "backendStart": "initial"}], "sourceRoleBackendCount": 2}}, "roles": {"collector": {"connectionLimit": 6, "login": True}}, "privateInputHashes": {"file": "fixed"}, "queue": {"service": {"state": {}, "argv": [], "argvSha256": "changing"}, "timer": {"state": {"ActiveState": "active", "SubState": "waiting", "UnitFileState": "enabled"}}}}


class Successor(unittest.TestCase):
    def test_real_frozen_core_and_new_producer_identity(self):
        core = m.core()
        self.assertEqual(core.__file__, str(FILE.absolute()))
        self.assertEqual(core.PHASES, ("prepare",))
        self.assertEqual(core.FORMAT, "yunipals-ypal-backend-owner-v1")

    def test_combined_pool_churn_has_same_review_snapshot(self):
        core = m.core(); first = snapshot(); second = copy.deepcopy(first)
        second["source"]["sessionAttribution"]["combinedBackends"] = [{"pid": 3, "backendStart": "new"}, {"pid": 4, "backendStart": "newer"}]
        second["source"]["sessionAttribution"]["sourceRoleBackendCount"] = 3
        self.assertEqual(core.sha(core.encoded(core.stable_snapshot(first))), core.sha(core.encoded(core.stable_snapshot(second))))
        self.assertNotEqual(first["source"]["sessionAttribution"], second["source"]["sessionAttribution"])

    def test_roles_actors_schema_private_inputs_and_old_tuples_stay_bound(self):
        core = m.core(); original = core.stable_snapshot(snapshot())
        changes = [lambda v: v["roles"]["collector"].update(login=False), lambda v: v["source"]["actor"].update(pid=999), lambda v: v["nativeOld"].update(schemaOid="foreign"), lambda v: v["privateInputHashes"].update(file="changed"), lambda v: v["source"]["sessionAttribution"]["oldBackends"].append({"pid": 9, "backendStart": "unowned"})]
        for mutate in changes:
            value = snapshot(); mutate(value)
            self.assertNotEqual(core.stable_snapshot(value), original)

    def test_incomplete_or_age_inferred_attribution_never_hashes_as_qualified(self):
        core = m.core()
        for key, wrong in [("complete", False), ("applicationNameOrAgeInference", True), ("sharedRoleZeroSessionsRequired", True)]:
            value = snapshot(); value["source"]["sessionAttribution"][key] = wrong
            self.assertRaises(RuntimeError, core.stable_snapshot, value)


if __name__ == "__main__": unittest.main()
