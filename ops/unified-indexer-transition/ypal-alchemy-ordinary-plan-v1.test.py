#!/usr/bin/env python3
"""Synthetic ordinary financial preparation; no host/DB/provider actions."""
import copy
import datetime
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


p = load("ordinary", HERE / "ypal-alchemy-ordinary-plan-v1.py")
f = load("catchup_fixture", HERE / "ypal-alchemy-catchup-financial-v1.test.py")


def fixture():
    m = p.model()
    before, ranges = f.fixture()
    old = m.plan(before, ranges, "d" * 64, before["clockMs"], f.PROFILE)
    prepared = {"before": before, "plan": old}
    paid = m.expected_admitted(before, old)
    paid["clockMs"] += 6 * 3_600_000
    paid["windows"].append({"day": old["grantDay"], "grantedCu": "103000", "backgroundCu": "103000"})
    paid["workloadWindows"] += [{"day": old["grantDay"], "workload": "unified_source", "grantedCu": "100000"},
                               {"day": old["grantDay"], "workload": "order_projection", "grantedCu": "3000"}]
    closed = {"phase": "close", "committed": True, "preparedSha256": p.digest(prepared), "before": paid,
              "after": m.target_closed(before, paid, old)}
    ranges["observedAt"] = datetime.datetime.fromtimestamp(paid["clockMs"] / 1000, datetime.timezone.utc).isoformat()
    for row in ranges["chains"].values():
        row["headTimestamp"] = paid["clockMs"] // 1000
    bindings = {key: "a" * 64 for key in p.BINDINGS}
    bindings.update(catchupPreparedSha256=p.digest(prepared), catchupCloseSha256=p.digest(closed), rangeCaptureSha256=p.digest(ranges))
    return prepared, closed, copy.deepcopy(closed["after"]), copy.deepcopy(f.PROFILE), ranges, bindings


class OrdinaryPlan(unittest.TestCase):
    def setUp(self):
        self.inputs = fixture()
        self.before = self.inputs[2]
        self.plan = p.plan(*self.inputs)

    def current(self, source=4000, other=1000):
        current = p.expected_admitted(self.before, self.plan)
        current["clockMs"] += 1000
        for row in current["windows"]:
            if row["day"] == self.plan["baselineDay"]:
                row["grantedCu"] = str(int(row["grantedCu"]) + source + other)
                row["backgroundCu"] = str(int(row["backgroundCu"]) + source + other)
        for row in current["workloadWindows"]:
            if row["day"] == self.plan["baselineDay"]:
                if row["workload"] == "unified_source": row["grantedCu"] = str(int(row["grantedCu"]) + source)
                if row["workload"] == "order_projection": row["grantedCu"] = str(int(row["grantedCu"]) + other)
        next(row for row in current["permits"] if row["permitId"] == self.plan["permits"][2]["permitId"])["spentCu"] = str(source)
        return current

    def test_closed_additive_rows_not_forced_to_original_numbers(self):
        self.assertEqual(self.before["global"]["dailyCu"], "1100000")
        self.assertEqual(self.plan["originalClosedSourceDailyCu"], "125000")
        self.assertEqual(self.plan["baselineSourceDayBookedCu"], "100000")
        self.assertEqual(p.expected_admitted(self.before, self.plan)["workloadWindows"], self.before["workloadWindows"])

    def test_exact_daily_limits_and_no_per_chain_daily_partitions(self):
        self.assertEqual(self.plan["ordinaryPolicy"], {"globalDailyCu": "2000000", "sourceDailyCu": "1500000", "foregroundReserveCu": "200000"})
        self.assertEqual({r["maximumCu"] for r in self.plan["permits"]}, {"40500000"})
        self.assertEqual(self.plan["UTCDateCount"], 27)
        self.assertFalse(self.plan["independentPerChainDailyAllocation"])
        self.assertFalse(self.plan["automaticRenewal"])

    def test_no_original_expiry_extension(self):
        self.assertEqual(self.plan["expiresMs"], p.milliseconds(p.PROFILE_EXPIRY))
        changed = list(copy.deepcopy(self.inputs))
        changed[2]["profiles"][0]["expires_at"] = "2026-12-19T18:00:00Z"
        with self.assertRaises(RuntimeError): p.plan(*changed)

    def test_missing_specific_authorization_or_close_refuses(self):
        for key in p.BINDINGS:
            changed = list(copy.deepcopy(self.inputs)); changed[5][key] = "0" * 64
            with self.assertRaises(RuntimeError): p.plan(*changed)
        changed = list(copy.deepcopy(self.inputs)); changed[1]["committed"] = False
        changed[5]["catchupCloseSha256"] = p.digest(changed[1])
        with self.assertRaises(RuntimeError): p.plan(*changed)

    def test_active_catchup_or_other_permit_refuses(self):
        changed = list(copy.deepcopy(self.inputs)); changed[2]["permits"][-1]["enabled"] = True
        with self.assertRaises(RuntimeError): p.plan(*changed)

    def test_changed_old_policy_or_close_receipt_refuses(self):
        changed = list(copy.deepcopy(self.inputs)); changed[1]["after"]["global"]["dailyCu"] = "1000000"
        changed[5]["catchupCloseSha256"] = p.digest(changed[1])
        with self.assertRaisesRegex(RuntimeError, "additive_close"): p.plan(*changed)

    def test_old_and_foreign_policy_acl_and_permits_unchanged(self):
        value = self.current(); self.assertTrue(p.validate_current(self.before, value, self.plan))
        for edit in [lambda v: v["global"].update(foregroundReserveCu="1"),
                     lambda v: v["relationCatalog"][0]["columns"][0].update(acl="foreign"),
                     lambda v: v["allocations"][0].update(dailyCu="999999"),
                     lambda v: v["permits"][0].update(enabled=True)]:
            changed = copy.deepcopy(value); edit(changed)
            with self.assertRaises(RuntimeError): p.validate_current(self.before, changed, self.plan)

    def test_same_day_legacy_catchup_spend_is_not_refunded(self):
        value = self.current(source=1_400_001, other=0)
        with self.assertRaisesRegex(RuntimeError, "source_daily_limit"): p.validate_current(self.before, value, self.plan)

    def test_global_reserve_never_spent_by_background(self):
        value = self.current(source=1000, other=1_700_000)
        with self.assertRaisesRegex(RuntimeError, "foreground_reserve"): p.validate_current(self.before, value, self.plan)

    def test_counter_decrease_refuses_and_old_retention_is_explicit(self):
        value = self.current(); value["windows"][0]["grantedCu"] = "4546999"
        with self.assertRaises(RuntimeError): p.validate_current(self.before, value, self.plan)
        value = self.current(); value["windows"] = value["windows"][1:]; value["workloadWindows"] = value["workloadWindows"][1:]
        with self.assertRaisesRegex(RuntimeError, "never_refunded"): p.validate_current(self.before, value, self.plan)

    def test_same_day_inverse_preserves_all_spend_and_remaining_normal_allowance(self):
        value = self.current(); target = p.inverse_target(self.before, value, self.plan)
        self.assertEqual(target["global"]["dailyCu"], "1104000")
        self.assertEqual(next(r["dailyCu"] for r in target["allocations"] if r["workload"] == "unified_source"), "129000")
        self.assertEqual(target["windows"], value["windows"])
        self.assertEqual(target["workloadWindows"], value["workloadWindows"])
        self.assertEqual([r["spentCu"] for r in target["permits"]], [r["spentCu"] for r in value["permits"]])
        self.assertFalse(any(r["enabled"] for r in target["permits"]))

    def test_inverse_never_expands_two_million_ceiling(self):
        target = p.inverse_target(self.before, self.current(source=1_300_000, other=0), self.plan)
        self.assertEqual(target["global"]["dailyCu"], "2000000")

    def test_inverse_can_disable_expired_permits_without_new_authority(self):
        value = self.current(); value["clockMs"] = self.plan["expiresMs"] + 1000
        with self.assertRaisesRegex(RuntimeError, "unexpired"): p.validate_current(self.before, value, self.plan)
        target = p.inverse_target(self.before, value, self.plan)
        self.assertFalse(any(row["enabled"] for row in target["permits"]))
        self.assertEqual(target["global"]["dailyCu"], "1000000")

    def test_same_day_close_cannot_claim_UTC_cleanup_was_completed(self):
        changed = list(copy.deepcopy(self.inputs)); changed[2]["clockMs"] += p.DAY_MS
        with self.assertRaisesRegex(RuntimeError, "separate_UTC_receipt"): p.plan(*changed)

    def test_sql_only_four_inserts_two_updates_no_commit(self):
        sql = p.held_packet_sql(self.before, self.plan)
        self.assertEqual(sql.count("INSERT INTO"), 4)
        self.assertEqual(sql.count("UPDATE yunipals_market."), 2)
        for forbidden in ["COMMIT;", "DELETE ", "GRANT ", "CREATE ", "spent_cu=", "granted_cu="]:
            self.assertNotIn(forbidden, sql)
        self.assertIn("pg_current_xact_id()", sql)
        self.assertIn("SERIALIZABLE", sql)
        self.assertIn("ordinary_exact_financial_snapshot_changed", sql)

    def test_derived_permit_field_tamper_cannot_enter_sql(self):
        for key, value in [("throughBlock", "0;DELETE"), ("chainId", 10), ("maximumCu", "999999999"), ("spentCu", "1")]:
            changed = copy.deepcopy(self.plan); changed["permits"][0][key] = value
            with self.assertRaises(RuntimeError): p.held_packet_sql(self.before, changed)

    def test_source_env_has_exact_four_public_selectors_only(self):
        lines = p.source_environment(self.plan).decode().splitlines()
        self.assertEqual(len(lines), 4)
        self.assertEqual(dict(line.split("=", 1) for line in lines),
                         {"UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(row["chainId"]): row["permitId"] for row in self.plan["permits"]})

    def test_unchanged_manifest_minimums_and_bounded_scaled_ranges(self):
        self.assertEqual({r["chainId"]: r["fromBlock"] for r in self.plan["permits"]}, {1: "12134519", 56: "7579197", 137: "21814218", 8453: "22224075"})
        for row in self.plan["permits"]:
            self.assertLess(int(row["throughBlock"]), 210_000_000)


if __name__ == "__main__":
    unittest.main()
