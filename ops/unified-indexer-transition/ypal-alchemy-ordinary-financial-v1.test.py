#!/usr/bin/env python3
"""Private FS and held-client lifecycle tests; no production connections."""
import copy
import datetime
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace(".", "_"), HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


o = load("ypal-alchemy-ordinary-financial-v1.py")
fixture = load("ypal-alchemy-ordinary-plan-v1.test.py")
sdk = load("ypal-managed-handover-v1.py")


class OwnerControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix=".ordinary-financial-", dir=HERE.parents[1])
        self.base = Path(self.tmp.name) / "owner"
        self.patch = patch.object(o, "BASE", self.base); self.patch.start()
        prepared, closed, current, profile, ranges, bindings = fixture.fixture()
        self.state = current; self.calls = []; self.proofs = 0; self.authorized = True; self.quiet = True
        self.outcomes = {}; self.next_xid = 100; self.lost_ack = False; self.change_after_intent = False
        self.proof = {"actualCloseValidated": True, "sourceDrained": True, "paidRequestsQuiet": True,
                      "currentFreeActorsSha256": "b" * 64, "sourceActorQualified": False}
        self.h = types.SimpleNamespace(s=sdk, p=fixture.p, m=fixture.p.model(), input_sha="c" * 64,
            input=bindings, docs={"catchupPreparedSha256": prepared, "catchupCloseSha256": closed, "rangeCaptureSha256": ranges}, profile=profile)
        def authorization(expected=None):
            o.need(self.authorized and (expected is None or expected == bindings["ordinaryAuthorizationSha256"]), "actual_authorization_required")
            return bindings["ordinaryAuthorizationSha256"]
        def proof():
            self.proofs += 1
            o.need(self.quiet, "actual_quiet_source_drain_required")
            return copy.deepcopy(self.proof)
        def immutable():
            authorization()
            if self.change_after_intent and (self.base / "admit-intent.json").exists(): raise RuntimeError("fixture_inputs_changed")
        self.h.authorization = authorization; self.h.old_closed_live = proof; self.h.immutable = immutable
        self.h.snapshot = lambda: copy.deepcopy(self.state)
        self.h.query = lambda sql: {"status": self.outcomes[re.search("'([0-9]+)'::xid8", sql)[1]]}
        case = self
        class Client:
            def __init__(self):
                self.work = copy.deepcopy(case.state); self.xid = str(case.next_xid); case.next_xid += 1
                case.outcomes[self.xid] = "in progress"; self.finished = False
            def send(self, sql):
                case.calls.append(sql)
                if sql.startswith("INSERT"):
                    row = case.owner.reviewed(case.review)
                    self.work = case.h.p.expected_admitted(row["before"], row["proposal"])
                elif sql.startswith("UPDATE"):
                    ids = {p["permitId"] for p in case.owner.reviewed(case.review)["proposal"]["permits"]}
                    for row in self.work["permits"]:
                        if row["permitId"] in ids: row["enabled"] = False
            def observe(self, model):
                return {"snapshot": copy.deepcopy(self.work), "xid": self.xid, "backendPid": 90, "backendStart": "fixture-same-backend"}
            def kernel_identity(self):
                return {"pid": 12345, "startTicks": 67, "uid": 111, "gid": 113, "capabilitiesZero": True,
                        "noNewPrivileges": True, "ownProcessGroup": True, "commandSha256": "e" * 64}
            def finish(self, commit):
                case.calls.append("COMMIT" if commit else "ROLLBACK")
                if commit:
                    intent = case.base / ("disable-intent.json" if (case.base / "admitted.json").exists() else "admit-intent.json")
                    case.assertTrue(intent.exists()); case.assertEqual(json.loads(intent.read_bytes())["xid"], self.xid)
                    case.state = copy.deepcopy(self.work)
                case.outcomes[self.xid] = "committed" if commit else "aborted"; self.finished = True
                if commit and case.lost_ack: raise RuntimeError("fixture_lost_commit_ACK")
            def close(self):
                if not self.finished: case.outcomes[self.xid] = "aborted"
        self.h.f = types.SimpleNamespace(Client=Client)
        self.owner = o.Owner(self.h)
        self.review = self.owner.review()["reviewSha256"]
        self.auth = bindings["ordinaryAuthorizationSha256"]

    def tearDown(self): self.patch.stop(); self.tmp.cleanup()
    def rehearsal(self): return self.owner.transaction(self.review)
    def admit(self): self.rehearsal(); return self.owner.transaction(self.review, True, self.auth)

    def test_default_is_inert_without_loading_host(self):
        with patch("sys.argv", [str(HERE / "owner.py")]), patch.object(o, "Host", side_effect=AssertionError("no host")), patch("sys.stdout", new_callable=io.StringIO) as output:
            o.main()
        self.assertEqual(json.loads(output.getvalue())["databaseWrites"], 0)

    def test_real_private_exclusive_review_modes_and_parent_sync(self):
        self.assertEqual(self.base.stat().st_mode & 0o777, 0o700)
        file = self.base / ("review-" + self.review + ".json")
        self.assertEqual(file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(o.sha(file.read_bytes()), self.review)
        self.assertEqual(self.calls, [])

    def test_foreign_private_journal_refuses_without_SQL(self):
        (self.base / "foreign.json").write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "only_owned"): self.rehearsal()
        self.assertEqual(self.calls, [])

    def test_missing_authorization_refuses_before_client_or_attempt(self):
        self.rehearsal(); self.authorized = False; before = list(self.calls)
        with self.assertRaisesRegex(RuntimeError, "authorization"): self.owner.transaction(self.review, True, self.auth)
        self.assertEqual(self.calls, before); self.assertFalse((self.base / "admit-attempt.json").exists())

    def test_exact_authorization_document_includes_real_evidence_hash(self):
        value = {"format": o.FORMAT + "-authorization", "approved": True, "approvalEvidenceSha256": "d" * 64,
            "userDecision": "Approve these ongoing daily caps", "scope": self.h.m.SCOPE, "globalDailyCu": "2000000",
            "sourceDailyCu": "1500000", "foregroundReserveCu": "200000", "profileId": self.h.m.PROFILE,
            "manifestHash": self.h.m.MANIFEST, "existingProfileExpiresAt": "2026-11-19T18:00:00.000Z",
            "existingCatchupExpiryChanged": False, "automaticProfileOrPermitRenewal": False}
        o.permission(value, self.h.m)
        for key, bad in [("globalDailyCu", "2000001"), ("sourceDailyCu", "1500001"), ("foregroundReserveCu", "0"),
                         ("approved", False), ("approvalEvidenceSha256", "0" * 64), ("existingProfileExpiresAt", "2027-01-01T00:00:00Z")]:
            changed = {**value, key: bad}
            with self.assertRaisesRegex(RuntimeError, "authorization"): o.permission(changed, self.h.m)

    def test_commit_requires_explicit_hash_not_just_stored_approval(self):
        self.rehearsal()
        with self.assertRaisesRegex(RuntimeError, "new_authorization_hash"): self.owner.transaction(self.review, True)
        self.assertFalse((self.base / "admit-attempt.json").exists())

    def test_missing_actual_old_source_drain_refuses_before_SQL(self):
        self.quiet = False
        with self.assertRaisesRegex(RuntimeError, "quiet_source_drain"): self.rehearsal()
        self.assertEqual(self.calls, [])

    def test_rollback_and_matching_aborted_XID_required(self):
        with self.assertRaises(FileNotFoundError): self.owner.transaction(self.review, True, self.auth)
        self.assertEqual(self.calls, [])
        result = self.rehearsal(); self.assertTrue(result["rolledBack"])
        self.assertEqual(self.state, fixture.fixture()[2]); self.assertNotIn("COMMIT", self.calls)
        row = self.owner.get("rollback-" + self.review + ".json"); self.outcomes[row["xid"]] = "committed"
        with self.assertRaisesRegex(RuntimeError, "same_review_ROLLBACK"): self.owner.transaction(self.review, True, self.auth)

    def test_held_intent_precedes_single_COMMIT_and_ACK_does_not_claim_runtime(self):
        result = self.admit(); self.assertTrue(result["committed"]); self.assertEqual(self.calls.count("COMMIT"), 1)
        intent, _ = self.owner.intent("admit", self.owner.digest("admit-intent.json"))
        self.assertEqual(self.outcomes[intent["xid"]], "committed")
        self.assertFalse(result["sourceActorQualified"]); self.assertFalse(result["timersRetired"])

    def test_lost_commit_ACK_reconciles_from_intent_without_failure_marker(self):
        self.rehearsal(); self.lost_ack = True
        with self.assertRaisesRegex(RuntimeError, "lost_commit"): self.owner.transaction(self.review, True, self.auth)
        self.assertFalse((self.base / "admitted.json").exists()); self.assertFalse((self.base / "failed.json").exists())
        before = list(self.calls); self.quiet = False
        result = self.owner.reconcile(self.owner.digest("admit-intent.json"))
        self.assertTrue(result["committed"]); self.assertEqual(self.calls, before)

    def test_aborted_or_unknown_XID_never_becomes_success_or_retry(self):
        self.rehearsal(); self.change_after_intent = True
        with self.assertRaisesRegex(RuntimeError, "inputs_changed"): self.owner.transaction(self.review, True, self.auth)
        self.assertEqual(self.calls.count("COMMIT"), 0); self.change_after_intent = False
        intent = self.owner.get("admit-intent.json"); self.outcomes[intent["xid"]] = None
        before = list(self.calls)
        with self.assertRaisesRegex(RuntimeError, "committed_XID"): self.owner.reconcile(self.owner.digest("admit-intent.json"))
        with self.assertRaisesRegex(RuntimeError, "one_attempt"): self.owner.transaction(self.review, True, self.auth)
        self.assertEqual(self.calls, before)

    def test_stale_whole_snapshot_refuses_before_write(self):
        self.rehearsal(); self.state["global"]["foregroundReserveCu"] = "199999"
        before = list(self.calls)
        with self.assertRaisesRegex(RuntimeError, "fresh_same_review"): self.owner.transaction(self.review, True, self.auth)
        self.assertFalse(any(sql.startswith("INSERT") for sql in self.calls[len(before):]))

    def test_expired_five_minute_review_refuses(self):
        self.rehearsal(); self.state["clockMs"] += 300001
        with self.assertRaisesRegex(RuntimeError, "fresh_same_review"): self.owner.transaction(self.review, True, self.auth)

    def test_changed_held_backend_cannot_commit(self):
        self.rehearsal(); original = self.h.f.Client.observe; count = [0]
        def observe(client, model):
            count[0] += 1; value = original(client, model)
            if count[0] == 2: value["backendPid"] += 1
            return value
        with patch.object(self.h.f.Client, "observe", observe):
            with self.assertRaisesRegex(RuntimeError, "same_held_XID"): self.owner.transaction(self.review, True, self.auth)
        self.assertEqual(self.calls.count("COMMIT"), 0)

    def test_financial_current_does_not_requalify_old_source_or_readers(self):
        result = self.admit(); self.quiet = False; count = self.proofs
        with patch.object(o, "saved_owner", return_value=self.owner): value = o.validate_current(result["receiptSha256"])
        self.assertTrue(value["financialQualified"]); self.assertEqual(self.proofs, count)
        self.assertFalse(value["sourceActorQualified"]); self.assertFalse(value["proxyLifecycleQualified"])

    def test_disable_only_four_permits_no_policy_or_counter_restore(self):
        result = self.admit(); before = copy.deepcopy(self.state); calls = len(self.calls); self.quiet = False; count = self.proofs
        disabled = self.owner.transaction(self.review, True, self.auth, True)
        self.assertTrue(disabled["committed"]); self.assertEqual(self.proofs, count)
        for field in ["global", "allocations", "windows", "workloadWindows", "profiles"]: self.assertEqual(self.state[field], before[field])
        sql = [s for s in self.calls[calls:] if s.startswith("UPDATE")]
        self.assertEqual(len(sql), 1); self.assertEqual(sql[0].count("UPDATE"), 1)
        self.assertNotIn("rpc_compute_", sql[0]); self.assertNotIn("spent_cu", sql[0])
        self.assertFalse(any(p["enabled"] for p in self.state["permits"]))
        with patch.object(o, "saved_owner", return_value=self.owner):
            with self.assertRaisesRegex(RuntimeError, "disable_started"): o.validate_current(result["receiptSha256"])

    def test_disable_lost_ACK_reconciles_without_stale_free_actor_proof(self):
        self.admit(); self.quiet = False; self.lost_ack = True
        with self.assertRaisesRegex(RuntimeError, "lost_commit"): self.owner.transaction(self.review, True, self.auth, True)
        before = list(self.calls); count = self.proofs
        result = self.owner.reconcile(self.owner.digest("disable-intent.json"), "disable")
        self.assertTrue(result["committed"]); self.assertEqual(self.calls, before); self.assertEqual(self.proofs, count)

    def test_saved_after_counter_tamper_cannot_be_reconciled(self):
        self.rehearsal(); self.lost_ack = True
        with self.assertRaises(RuntimeError): self.owner.transaction(self.review, True, self.auth)
        self.state["workloadWindows"][0]["grantedCu"] = "1"
        with self.assertRaises(RuntimeError): self.owner.reconcile(self.owner.digest("admit-intent.json"))

    def test_no_source_or_manager_mutator_in_host_owner(self):
        text = (HERE / "ypal-alchemy-ordinary-financial-v1.py").read_text()
        for forbidden in [".manager(", ".close(utc=", ".start_source(", '"systemctl"', '"eth_get']:
            self.assertNotIn(forbidden, text)
        parent = load("ypal-alchemy-source-switch-v2.py")
        self.assertEqual(o.sha((HERE / "ypal-alchemy-source-switch-v2.py").read_bytes()), "440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f")
        self.assertEqual(o.LIFECYCLE, parent.BASE)
        self.assertEqual(o.CLOSE, parent.CLOSE_BASE)


class PostCloseRanges(unittest.TestCase):
    def setUp(self):
        self.cache_fixture = load("ypal-alchemy-restart-cache-v1.test.py")
        native, capture, old_plan = self.cache_fixture.fixture()
        self.cache = self.cache_fixture.m
        prepared, closed, _, _, ranges, _ = fixture.fixture()
        closed_at = closed["after"]["clockMs"]
        native["clock"] = closed_at - 600000  # a slow close does not age new headers
        capture["clock"] = closed_at + 100
        observed = closed_at + 500
        source = {"parent": {"pid": 123, "startTicks": 456}, "invocation": "f" * 32}
        self.h = object.__new__(o.Host)
        self.h.p = fixture.p; self.h.m = fixture.p.model(); self.h.cache = self.cache
        self.h.s = types.SimpleNamespace(document=lambda path, digest: {"source": source})
        self.h.input = {key: str(i + 1) * 64 for i, key in enumerate(o.RECEIPTS)}
        self.raw = {"format": "yunipals-alchemy-ordinary-range-actual-v1",
            "sourceCompletionReceiptSha256": o.COMPLETION_RESULT_SHA, "recordedSource": source,
            "sourceActorCurrent": False, "sourcePhase": "acknowledged-drained",
            **{key: self.h.input[key] for key in ["sourceDrainedReceiptSha256", "catchupCloseSha256", "fourFreeRoutesReceiptSha256"]},
            "sourceActorSha256": o.sha(o.encoded(source)),
            "observedAt": datetime.datetime.fromtimestamp(observed / 1000, datetime.timezone.utc).isoformat(),
            "schemaOid": native["schemaOid"], "buildId": native["app"]["build_id"],
            "checkpoints": copy.deepcopy(native["checkpoints"]), "cacheCapture": capture,
            "syncCoverageKind": "verified_continuous_log_cache", "databaseWrites": 0, "serviceActions": 0,
            "boundedProviderRPCRequests": 8, "heads": []}
        proof = self.cache.validate_capture(capture, old_plan, native)
        ranges.update(sourceActorSha256=self.raw["sourceActorSha256"], observedAt=self.raw["observedAt"])
        ranges["chains"] = {}
        for chain in sorted(self.h.m.PARTITION):
            point = self.h.m.complete_block(native["checkpoints"][str(chain)]["latest"], chain)
            self.raw["heads"].append({"chainId": chain, "headBlock": point + 100, "headTimestamp": observed // 1000,
                                      "headHash": "0x" + "a" * 64})
            ranges["chains"][str(chain)] = {"nativeCommittedBlock": point, "syncCoveredBlock": proof["chains"][str(chain)]["logCachedThrough"],
                "headBlock": point + 100, "headTimestamp": observed // 1000, "marginBlocks": self.h.m.MARGINS[chain]}
        prepared["plan"] = old_plan
        self.h.docs = {"rawRangeSha256": self.raw, "rangeCaptureSha256": ranges, "catchupPreparedSha256": prepared,
            "catchupCloseSha256": closed, "sourceDrainedReceiptSha256": {"terminal": True, "native": native}}

    def test_post_close_capture_after_slow_drain_uses_real_eighty_filter_proof(self):
        self.h.range_binding()
        self.assertEqual(self.h.range_cache["logFilterRows"], 80)
        self.assertFalse(self.h.range_cache["sourceActorQualified"])
        now = self.h.p.milliseconds(self.raw["observedAt"])
        self.h.m.range_plan(self.h.docs["rangeCaptureSha256"], now + 180001, fixture.f.PROFILE)
        with self.assertRaisesRegex(RuntimeError, "fresh_four_chain"):
            self.h.m.range_plan(self.h.docs["rangeCaptureSha256"], now + 900001, fixture.f.PROFILE)

    def test_live_actor_claim_old_capture_or_wrong_drain_refuses(self):
        for key, value in [("sourceActorCurrent", True), ("sourcePhase", "running"), ("sourceDrainedReceiptSha256", "0" * 64)]:
            previous = self.raw[key]; self.raw[key] = value
            with self.assertRaisesRegex(RuntimeError, "post_close"): self.h.range_binding()
            self.raw[key] = previous
        self.raw["cacheCapture"]["clock"] = self.h.docs["catchupCloseSha256"]["after"]["clockMs"] - 1
        with self.assertRaisesRegex(RuntimeError, "post_close"): self.h.range_binding()

    def test_before_drain_checkpoint_or_native44_cache_identity_change_refuses(self):
        self.raw["checkpoints"]["1"]["latest"] = "0" * 75
        with self.assertRaisesRegex(RuntimeError, "post_close"): self.h.range_binding()
        self.raw["checkpoints"] = copy.deepcopy(self.h.docs["sourceDrainedReceiptSha256"]["native"]["checkpoints"])
        for field in ["tables", "cache"]:
            original = self.raw["cacheCapture"][field]
            self.raw["cacheCapture"][field] = {}
            with self.assertRaisesRegex(RuntimeError, "native44_cache"): self.h.range_binding()
            self.raw["cacheCapture"][field] = original

    def test_real_cache_hole_cannot_be_hidden_by_gauge_or_normalized_claim(self):
        row = self.cache.filters()[0]; capture = self.raw["cacheCapture"]
        capture["matrix"][row["key"]][0][1] = str(row["fromBlock"] + 1)
        self.raw["sync"] = {"mainnet": 999999999}
        with self.assertRaisesRegex(RuntimeError, "older_cache_hole"): self.h.range_binding()

    def test_current_cache_can_advance_but_cannot_lose_captured_floor_or_identity(self):
        self.h.range_binding(); current = copy.deepcopy(self.h.range_cache)
        current["chains"]["8453"]["logCachedThrough"] += 1
        with patch.object(self.cache, "validate_restart_capture", return_value=current):
            self.h.current_cache(None, None)
            current["chains"]["8453"]["logCachedThrough"] -= 2
            with self.assertRaisesRegex(RuntimeError, "no_loss"): self.h.current_cache(None, None)
            current["chains"]["8453"]["logCachedThrough"] += 2
            current["nativeIdentitySha256"] = "0" * 64
            with self.assertRaisesRegex(RuntimeError, "no_loss"): self.h.current_cache(None, None)


if __name__ == "__main__": unittest.main()
