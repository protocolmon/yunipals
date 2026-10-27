#!/usr/bin/env python3
"""Fixed ordinary financial owner. No source/proxy/timer/provider lifecycle.

Default is inert. Review needs the real old closure and new authorization.
All transaction outcomes are one-shot and reconciled read-only by held XID.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = "yunipals-ypal-alchemy-ordinary-financial-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-alchemy-ordinary-financial-v1-20261024")
INPUT = OPS / "ypal-alchemy-ordinary-financial-v1.input.json"
AUTHORIZATION = Path("/var/backups/yunipals-alchemy-ordinary-authorization-v1-20261024/approval.json")
RANGES = Path("/var/backups/yunipals-alchemy-ordinary-range-v1-20261024")
CLOSE = Path("/var/backups/yunipals-ypal-alchemy-close-v2-20261024")
LIFECYCLE = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v2-20261024")
COMPLETION_BASE = Path("/var/backups/yunipals-alchemy-source-completion-v1-20261024")
FINANCIAL = "ypal-alchemy-catchup-financial-v1.py"
FINANCIAL_SHA = "19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803"
PLAN = "ypal-alchemy-ordinary-plan-v1.py"
PLAN_SHA = "cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980"
COMPLETION = "ypal-alchemy-source-completion-v1.py"
COMPLETION_SHA = "0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0"
CACHE = "ypal-alchemy-restart-cache-v1.py"
CACHE_SHA = "35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4"
COMPLETION_RESULT_SHA = "dd98ef06f05d88c1e0af0ff7bf9329f79bfb171cce1e10690a628c678f7e2ea6"
ORIGINAL_ADMISSION_SHA = "546cd1d3273fc400e001b1816b635b1ec8d9c8adf2537d776357bddc3916d170"
RECEIPTS = {
    "ordinaryAuthorizationSha256": AUTHORIZATION,
    "catchupPreparedSha256": CLOSE / "prepared.json",
    "catchupCloseSha256": CLOSE / "close-result.json",
    "sourceDrainedReceiptSha256": LIFECYCLE / "source-paid-stopped.json",
    "fourFreeRoutesReceiptSha256": LIFECYCLE / "paid-quiet.json",
    "rangeCaptureSha256": RANGES / "input.json",
    "rawRangeSha256": RANGES / "raw.json"
}


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64
def exact(value): return {key: item for key, item in value.items() if key != "clockMs"}


def fixed_financial():
    path = OPS / FINANCIAL
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == 0 and not row.st_mode & 0o022 and not stat.S_ISLNK(row.st_mode), "protected_fixed_financial_source_required")
    raw = path.read_bytes(); need(len(raw) < 100000 and sha(raw) == FINANCIAL_SHA, "exact_fixed_financial_Client_required")
    value = types.ModuleType("ordinary_fixed_financial"); value.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), value.__dict__)
    return value


def permission(value, m):
    need(isinstance(value, dict) and pin(value.get("approvalEvidenceSha256")) and
         {key: item for key, item in value.items() if key != "approvalEvidenceSha256"} == {
        "format": FORMAT + "-authorization", "approved": True,
        "userDecision": "Approve these ongoing daily caps", "scope": m.SCOPE,
        "globalDailyCu": "2000000", "sourceDailyCu": "1500000", "foregroundReserveCu": "200000",
        "profileId": m.PROFILE, "manifestHash": m.MANIFEST,
        "existingProfileExpiresAt": "2026-11-19T18:00:00.000Z", "existingCatchupExpiryChanged": False,
        "automaticProfileOrPermitRenewal": False
    }, "exact_separate_ordinary_daily_budget_authorization_required")


def disable_delta(m, proposal, current):
    ids = {p["permitId"] for p in proposal["permits"]}
    need(len(ids) == 4 and all(isinstance(value, str) and re.fullmatch("0x[a-f0-9]{64}", value) for value in ids),
         "exact_four_literal_owned_permit_ids_required")
    expected = copy.deepcopy(current)
    for p in expected["permits"]:
        if p["permitId"] in ids: p["enabled"] = False
    return expected, "UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE permit_id IN(" + ",".join(m.literal(p) for p in sorted(ids)) + ");"


def monotonic(m, before, current):
    need(current["clockMs"] >= before["clockMs"], "financial_clock_must_not_rewind")
    for field, keys, counters in [
        ("windows", ["day"], ["grantedCu", "backgroundCu"]),
        ("workloadWindows", ["day", "workload"], ["grantedCu"]),
        ("permits", ["permitId"], ["spentCu"])
    ]:
        actual = {tuple(row[key] for key in keys): row for row in current[field]}
        for prior in before[field]:
            row = actual.get(tuple(prior[key] for key in keys))
            expired = field != "permits" and m.day(current["clockMs"] - 31 * 86400000) > prior["day"]
            need((row is None and expired) or (row is not None and all(int(row[key]) >= int(prior[key]) for key in counters)),
                 "actual_bookings_and_permit_spending_must_not_be_refunded")


class Host:
    def __init__(self, input_sha):
        need(pin(input_sha), "actual_ordinary_input_sha_required")
        self.f = fixed_financial(); self.s = self.f.primitives()
        self.p = self.s.module(OPS / PLAN, PLAN_SHA); self.m = self.p.model()
        self.cache = self.s.module(OPS / CACHE, CACHE_SHA)
        self.input_sha = input_sha; self.input = self.s.document(INPUT, input_sha)
        need(set(self.input) == {"format", *RECEIPTS} and self.input["format"] == FORMAT + "-input" and
             all(pin(self.input[key]) for key in RECEIPTS), "fixed_receipt_hashes_only_no_arbitrary_paths_required")
        self.docs = {key: self.s.document(path, self.input[key]) for key, path in RECEIPTS.items()}
        self.profile = self.s.document(OPS / "ypal-combined-rpc-v1/profile.json", self.m.PROFILE_FILE_SHA)
        need(self.s.document(OPS / "ypal-combined-rpc-profile-v1.json", self.m.PROFILE_FILE_SHA) == self.profile,
             "same_pinned_public_profile_at_frozen_model_relative_path_required")
        self.authorization(); self.range_binding()

    def authorization(self, expected=None):
        need(expected is None or expected == self.input["ordinaryAuthorizationSha256"], "explicit_actual_ordinary_authorization_sha_required")
        value = self.s.document(AUTHORIZATION, self.input["ordinaryAuthorizationSha256"])
        permission(value, self.m)
        return self.input["ordinaryAuthorizationSha256"]

    def immutable(self):
        need(self.s.document(INPUT, self.input_sha) == self.input and
             all(self.s.document(path, self.input[key]) == self.docs[key] for key, path in RECEIPTS.items()) and
             sha(self.s.protected(OPS / FINANCIAL)) == FINANCIAL_SHA and sha(self.s.protected(OPS / PLAN)) == PLAN_SHA and
             sha(self.s.protected(OPS / "ypal-alchemy-catchup-financial-v1.model.py")) == self.p.MODEL_SHA and
             sha(self.s.protected(OPS / CACHE)) == CACHE_SHA and
             self.s.document(OPS / "ypal-combined-rpc-v1/profile.json", self.m.PROFILE_FILE_SHA) == self.profile and
             self.s.document(OPS / "ypal-combined-rpc-profile-v1.json", self.m.PROFILE_FILE_SHA) == self.profile,
             "all_fixed_financial_sources_and_receipts_must_stay_exact")
        self.authorization()

    def range_binding(self):
        """Fresh headers captured after the old close; no stopped-actor liveness claim."""
        raw = self.docs["rawRangeSha256"]; ranges = self.docs["rangeCaptureSha256"]
        source = self.s.document(COMPLETION_BASE / "result.json", COMPLETION_RESULT_SHA)["source"]
        drained = self.docs["sourceDrainedReceiptSha256"]
        capture = raw["cacheCapture"]
        observed = self.p.milliseconds(raw["observedAt"])
        need(raw["format"] == "yunipals-alchemy-ordinary-range-actual-v1" and
             raw["sourceCompletionReceiptSha256"] == COMPLETION_RESULT_SHA and raw["recordedSource"] == source and
             raw["sourceActorCurrent"] is False and raw["sourcePhase"] == "acknowledged-drained" and
             all(raw[key] == self.input[key] for key in ["sourceDrainedReceiptSha256", "catchupCloseSha256", "fourFreeRoutesReceiptSha256"]) and
             drained["terminal"] is True and raw["sourceActorSha256"] == sha(encoded(source)) == ranges["sourceActorSha256"] and
             raw["observedAt"] == ranges["observedAt"] and raw["schemaOid"] == ranges["schemaOid"] == "75963410" and
             raw["buildId"] == ranges["buildId"] == "71e2a7f3b7" and
             raw["databaseWrites"] == raw["serviceActions"] == 0 and raw["boundedProviderRPCRequests"] == 8 and
             len(raw["heads"]) == 4 and {head["chainId"] for head in raw["heads"]} == {1, 56, 137, 8453} and
             raw["checkpoints"] == drained["native"]["checkpoints"] == capture["checkpoints"] and
             set(raw["checkpoints"]) == {"1", "56", "137", "8453"} and
             type(capture["clock"]) is int and
             max(drained["native"]["clock"], self.docs["catchupCloseSha256"]["after"]["clockMs"]) <= capture["clock"] <= observed and
             raw["syncCoverageKind"] == "verified_continuous_log_cache",
             "exact_post_close_drained_native_and_fresh_four_chain_capture_required")
        # The frozen decoder proves all80 actual filters, adjacent-ID unions,
        # namespace/cache OIDs and the acknowledged native44 state. No process
        # metric is presented as downloaded head or continuous cache coverage.
        self.range_cache = self.cache.validate_capture(capture, self.docs["catchupPreparedSha256"]["plan"], drained["native"])
        expected = {}
        for head in raw["heads"]:
            chain = head["chainId"]; point = self.m.complete_block(raw["checkpoints"][str(chain)]["latest"], chain)
            need(point is not None and re.fullmatch("0x[a-f0-9]{64}", head["headHash"]),
                 "exact_drained_complete_boundary_and_fresh_header_identity_required")
            expected[str(chain)] = {"nativeCommittedBlock": point,
                "syncCoveredBlock": self.range_cache["chains"][str(chain)]["logCachedThrough"],
                "headBlock": head["headBlock"], "headTimestamp": head["headTimestamp"], "marginBlocks": self.m.MARGINS[chain]}
        need(ranges["chains"] == expected, "normalized_ranges_must_equal_post_close_native_and_proven_cache_capture")

    def current_cache(self, query, native):
        current = self.cache.validate_restart_capture(query, self.docs["catchupPreparedSha256"]["plan"], native)
        need(current["nativeIdentitySha256"] == self.range_cache["nativeIdentitySha256"] and
             current["filterArtifactSha256"] == self.range_cache["filterArtifactSha256"] and
             all(current["chains"][chain]["logCachedThrough"] >= row["logCachedThrough"]
                 for chain, row in self.range_cache["chains"].items()),
             "same_native44_cache_identity_and_no_loss_of_captured_continuous_coverage_required")
        return current

    def query(self, sql):
        raw = self.s.command(self.f.args(True), ("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + sql + ";ROLLBACK;").encode(), timeout=25)
        need(len(raw) <= 16000000, "bounded_readonly_financial_packet_required")
        values = [json.loads(line) for line in raw.decode().splitlines() if line.strip()]
        need(len(values) == 1, "one_readonly_financial_packet_required")
        return values[0]

    def snapshot(self): return self.query(self.m.snapshot_sql())

    def old_closed_live(self):
        """Initial admission only. Never called by current/disable/reconcile."""
        module = self.s.module(OPS / COMPLETION, COMPLETION_SHA); c = module.load(); owner = c.owner
        need(c.v.BASE == LIFECYCLE and c.v.CLOSE_BASE == CLOSE, "actual_frozen_successor_receipt_paths_required")
        need(c.record("result.json")["source"] == self.s.document(COMPLETION_BASE / "result.json", COMPLETION_RESULT_SHA)["source"],
             "actual_original_completion_ACK_required")
        need(c.c.fowner.prepared() == self.docs["catchupPreparedSha256"] and
             c.c.fowner.receipt("close-result.json", "close") == self.docs["catchupCloseSha256"] and
             owner.journal("source-paid-stopped.json") == self.docs["sourceDrainedReceiptSha256"] and
             owner.journal("paid-quiet.json") == self.docs["fourFreeRoutesReceiptSha256"], "actual_frozen_close_and_own_drain_receipt_chain_required")
        drained = self.docs["sourceDrainedReceiptSha256"]
        need(drained["terminal"] is True, "acknowledged_complete_source_drain_required")
        owner.process_terminal(module.SOURCE, owner.known_source_processes())
        # close(resume=False) intentionally leaves the source stopped with its
        # paid ExecStart overlay still owned, and moves the completion mount
        # fix without promising a loaded free-source configuration. Do not call
        # an active/free-source validator here. Disk ownership and terminal
        # process/session proofs are the relevant financial admission boundary.
        owner.source_context(); c.bindfix(); c.guards_current()
        c.c.remaining_source_facts()
        native = c.h.source.native()
        need(native["tables"] == drained["native"]["tables"] and native["checkpoints"] == drained["native"]["checkpoints"] and
             native["schemaOid"] == "75963410" and native["app"]["build_id"] == "71e2a7f3b7", "same_drained_native_namespace_build_and_checkpoint_state_required")
        self.current_cache(c.h.source.query, native)
        quiet = c.leaf.validate_paid_quiet(self.input["fourFreeRoutesReceiptSha256"], ORIGINAL_ADMISSION_SHA)
        owner.process_terminal(module.SOURCE, owner.known_source_processes())
        need(quiet["validated"] is quiet["paidRequestsQuiet"] is True, "all_four_restored_free_routes_must_be_quiet")
        self.immutable()
        return {"oldCloseProducerSha256": COMPLETION_SHA, "actualCloseValidated": True, "sourceDrained": True,
                "paidRequestsQuiet": True, "currentFreeActorsSha256": quiet["currentFreeActorsSha256"],
                "sourceActorQualified": False, "sourceActorCurrent": False, "sourcePhase": "acknowledged-drained",
                "sourceDrainedReceiptSha256": self.input["sourceDrainedReceiptSha256"],
                "rangeCacheCaptureSha256": self.range_cache["captureSha256"],
                "sourceReadinessQualified": False, "serviceActions": 0, "providerCalls": 0}


class Owner:
    def __init__(self, host): self.h = host; self.s = host.s; self.m = host.m; self.p = host.p
    def producer(self): return sha(self.s.protected(Path(__file__).absolute()))
    def get(self, name): return self.s.document(BASE / name)
    def digest(self, name): return sha(self.s.protected(BASE / name))
    def put(self, name, value): return self.s.save(BASE / name, value)

    def directory(self, create=False):
        if not os.path.lexists(BASE):
            need(create, "actual_existing_ordinary_review_directory_required")
            BASE.mkdir(mode=0o700); self.s.sync(BASE.parent)
            self.put("context.json", self.envelope())
        row = BASE.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o700,
             "one_root0700_ordinary_private_directory_required")
        names = {path.name for path in BASE.iterdir()}
        need(len(names) <= 64 and all(name in {"context.json", "admit-attempt.json", "admit-intent.json", "admitted.json",
                 "disable-attempt.json", "disable-intent.json", "disabled.json"} or
                 re.fullmatch("review-[a-f0-9]{64}\\.json|rollback-[a-f0-9]{64}(?:-attempt)?\\.json", name) for name in names) and
             self.get("context.json") == self.envelope(), "only_owned_same_boot_ordinary_context_and_journals_allowed")

    def envelope(self, **values):
        return {"format": FORMAT, "operatorSha256": self.producer(), "planProducerSha256": PLAN_SHA,
                "clientProducerSha256": FINANCIAL_SHA, "inputSha256": self.h.input_sha, "bootId": self.s.boot(), **values}

    def review(self):
        need(not os.path.lexists(BASE / "admit-attempt.json"), "no_new_review_after_any_admission_commit_attempt")
        self.h.immutable(); proof = self.h.old_closed_live(); before = self.h.snapshot()
        bindings = {key: self.h.input[key] for key in self.p.BINDINGS}
        proposal = self.p.plan(self.h.docs["catchupPreparedSha256"], self.h.docs["catchupCloseSha256"], before,
                               self.h.profile, self.h.docs["rangeCaptureSha256"], bindings)
        need(self.h.old_closed_live() == proof, "same_drained_source_and_free_proxy_epochs_during_review")
        value = self.envelope(before=before, proposal=proposal, proposalSha256=sha(encoded(proposal)), oldClosureProof=proof,
                              ordinaryAuthorizationSha256=self.h.authorization(), databaseWrites=0, providerCalls=0, serviceActions=0)
        digest = sha(encoded(value)); self.directory(create=True); name = "review-" + digest + ".json"
        if not os.path.lexists(BASE / name): self.put(name, value)
        need(self.digest(name) == digest, "actual_exclusive_review_hash_required")
        return {"reviewed": True, "reviewSha256": digest, "proposalSha256": value["proposalSha256"], "databaseWrites": 0,
                "sourceActorQualified": False, "providerCalls": 0, "serviceActions": 0}

    def reviewed(self, digest):
        need(pin(digest), "actual_saved_ordinary_review_sha_required"); self.directory()
        row = self.s.document(BASE / ("review-" + digest + ".json"), digest)
        need(all(row[key] == value for key, value in self.envelope().items()) and
             row["ordinaryAuthorizationSha256"] == self.h.authorization() and
             row["proposalSha256"] == sha(encoded(row["proposal"])) and row["oldClosureProof"]["actualCloseValidated"] is True and
             row["oldClosureProof"]["sourceDrained"] is row["oldClosureProof"]["paidRequestsQuiet"] is True and
             row["proposal"] == self.p.plan(self.h.docs["catchupPreparedSha256"], self.h.docs["catchupCloseSha256"], row["before"],
                 self.h.profile, self.h.docs["rangeCaptureSha256"], {key: self.h.input[key] for key in self.p.BINDINGS}),
             "same_boot_producer_authorization_and_exact_reviewed_proposal_required")
        self.h.immutable(); return row

    def disabled(self, before, current, proposal):
        owned = {p["permitId"] for p in proposal["permits"]}; normalized = copy.deepcopy(current)
        need(sum(p["permitId"] in owned for p in current["permits"]) == 4 and
             all(not p["enabled"] for p in current["permits"] if p["permitId"] in owned), "all_four_owned_permits_must_be_disabled")
        for p in normalized["permits"]:
            if p["permitId"] in owned: p["enabled"] = True
        self.p.validate_current(before, normalized, proposal, active=False)

    def transaction(self, review_sha, commit=False, authorization_sha=None, disable=False):
        row = self.reviewed(review_sha); proposal = row["proposal"]
        if commit: self.h.authorization(authorization_sha); need(pin(authorization_sha), "new_authorization_hash_required_before_COMMIT")
        if disable:
            self.receipt("admitted.json"); phase = "disable"
        else:
            phase = "admit" if commit else "rollback"
            need(self.h.old_closed_live() == row["oldClosureProof"], "same_reviewed_paid_quiet_source_drained_state_required")
        label = phase if commit else "rollback-" + review_sha
        need(not os.path.lexists(BASE / (label + "-attempt.json")), "one_attempt_only_unknown_outcome_requires_readonly_reconcile")
        if commit and not disable:
            rehearsal = self.get("rollback-" + review_sha + ".json")
            need(rehearsal["reviewSha256"] == review_sha and rehearsal["rolledBack"] is True and
                 self.xid_status(rehearsal["xid"]) == "aborted" and
                 all(rehearsal[key] == value for key, value in self.envelope().items()) and
                 exact(rehearsal["before"]) == exact(row["before"]) and
                 exact(rehearsal["after"]) == exact(self.p.expected_admitted(row["before"], proposal)),
                 "actual_same_review_ROLLBACK_and_aborted_XID_required")
        self.put(label + "-attempt.json", self.envelope(reviewSha256=review_sha, phase=phase, commitRequested=commit, automaticRetryAllowed=False))
        client = self.h.f.Client()
        try:
            client.send("BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='30s';SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));LOCK TABLE " +
                        ",".join("yunipals_market." + name for name in self.m.TABLES) + " IN SHARE ROW EXCLUSIVE MODE;\n")
            packet = client.observe(self.m); before = packet["snapshot"]; kernel = client.kernel_identity()
            if disable:
                self.p.validate_current(row["before"], before, proposal, active=False)
                expected, sql = disable_delta(self.m, proposal, before)
            else:
                need(exact(before) == exact(row["before"]) and row["before"]["clockMs"] <= before["clockMs"] <= row["before"]["clockMs"] + 300000,
                     "fresh_same_review_full_catalog_and_bookings_required")
                expected = self.p.expected_admitted(row["before"], proposal)
                sql = self.p.writes(row["before"], proposal)
            client.send(sql + "\n"); after_packet = client.observe(self.m); after = after_packet["snapshot"]
            need(packet["xid"] == after_packet["xid"] and packet["backendPid"] == after_packet["backendPid"] and
                 packet["backendStart"] == after_packet["backendStart"] and exact(after) == exact(expected),
                 "same_held_XID_backend_and_exact_owned_financial_delta_required")
            if not commit:
                client.finish(False); current = self.h.snapshot()
                need(self.xid_status(packet["xid"]) == "aborted" and self.m.static(current) == self.m.static(before), "actual_ROLLBACK_and_unchanged_policy_required")
                monotonic(self.m, before, current)
                self.put("rollback-" + review_sha + ".json", self.envelope(reviewSha256=review_sha, rolledBack=True, xid=packet["xid"], before=before, after=after))
                return {"rolledBack": True, "reviewSha256": review_sha, "databaseCommitted": False}
            intent = self.envelope(reviewSha256=review_sha, phase=phase, xid=packet["xid"], backendPid=packet["backendPid"], backendStart=packet["backendStart"],
                clientProcess=kernel, before=before, after=after, sqlSha256=sha(sql.encode()), ordinaryAuthorizationSha256=authorization_sha,
                oldClosureProof=row["oldClosureProof"] if not disable else None, automaticRetryAllowed=False)
            self.put(phase + "-intent.json", intent)
            if not disable: need(self.h.old_closed_live() == row["oldClosureProof"], "final_same_drained_source_free_proxy_CAS_required")
            self.h.authorization(authorization_sha); self.h.immutable()
            need(self.producer() == row["operatorSha256"] and client.kernel_identity() == kernel, "same_operator_and_held_child_immediately_before_single_COMMIT")
            client.finish(True)
        finally: client.close()
        return self.reconcile(self.digest(phase + "-intent.json"), phase)

    def xid_status(self, xid):
        need(isinstance(xid, str) and re.fullmatch("[1-9][0-9]{0,19}", xid), "literal_held_transaction_XID_required")
        return self.h.query("SELECT jsonb_build_object('status',pg_xact_status('" + xid + "'::xid8))")["status"]

    def intent(self, phase, intent_sha):
        need(phase in {"admit", "disable"} and pin(intent_sha), "exact_owned_phase_and_intent_sha_required")
        value = self.s.document(BASE / (phase + "-intent.json"), intent_sha); row = self.reviewed(value["reviewSha256"])
        need(all(value[key] == item for key, item in self.envelope().items()) and value["phase"] == phase and
             value["ordinaryAuthorizationSha256"] == self.h.authorization() and value["automaticRetryAllowed"] is False and
             re.fullmatch("[1-9][0-9]{0,19}", value["xid"]) and type(value["backendPid"]) is int and value["backendPid"] > 0 and
             isinstance(value["backendStart"], str) and bool(value["backendStart"]), "exact_held_XID_and_authorization_intent_chain_required")
        kernel = value["clientProcess"]
        need(kernel["uid"] == 111 and kernel["gid"] == 113 and type(kernel["pid"]) is type(kernel["startTicks"]) is int and
             kernel["pid"] > 0 and kernel["startTicks"] > 0 and pin(kernel["commandSha256"]) and
             kernel["capabilitiesZero"] is kernel["noNewPrivileges"] is kernel["ownProcessGroup"] is True, "actual_fixed_peer_kernel_proof_required")
        if phase == "admit":
            need(exact(value["before"]) == exact(row["before"]) and value["oldClosureProof"] == row["oldClosureProof"], "exact_admission_baseline_and_initial_quiet_proof_required")
            expected = self.p.expected_admitted(row["before"], row["proposal"]); sql = self.p.writes(row["before"], row["proposal"])
        else:
            self.receipt("admitted.json")
            self.p.validate_current(row["before"], value["before"], row["proposal"], active=False)
            expected, sql = disable_delta(self.m, row["proposal"], value["before"])
            need(value["oldClosureProof"] is None, "disable_must_not_claim_stale_runtime_qualification")
        need(exact(value["after"]) == exact(expected) and value["after"]["clockMs"] >= value["before"]["clockMs"] and
             value["sqlSha256"] == sha(sql.encode()), "exact_six_statement_admission_or_four_permit_disable_only_required")
        return value, row

    def receipt(self, name):
        need(name in {"admitted.json", "disabled.json"}, "fixed_financial_receipt_required")
        phase = "admit" if name == "admitted.json" else "disable"; value = self.get(name)
        intent, row = self.intent(phase, value["intentSha256"])
        need(all(value[key] == item for key, item in self.envelope().items()) and value["phase"] == phase and value["committed"] is True and
             value["reviewSha256"] == intent["reviewSha256"] and value["xid"] == intent["xid"] and value["before"] == intent["before"] and
             value["sourceActorQualified"] is value["proxyLifecycleQualified"] is value["timersRetired"] is value["countersReset"] is False,
             "exact_own_ordinary_financial_ACK_required")
        if phase == "admit": self.p.validate_current(row["before"], value["after"], row["proposal"], active=False)
        else: self.disabled(row["before"], value["after"], row["proposal"])
        monotonic(self.m, intent["after"], value["after"])
        return value

    def reconcile(self, intent_sha, phase="admit"):
        intent, row = self.intent(phase, intent_sha)
        need(self.xid_status(intent["xid"]) == "committed", "actual_committed_XID_required_no_SQL_retry")
        current = self.h.snapshot()
        if phase == "admit": self.p.validate_current(row["before"], current, row["proposal"], active=False)
        else: self.disabled(row["before"], current, row["proposal"])
        monotonic(self.m, intent["after"], current); self.h.immutable()
        name = "admitted.json" if phase == "admit" else "disabled.json"
        if not os.path.lexists(BASE / name):
            self.put(name, self.envelope(phase=phase, reviewSha256=intent["reviewSha256"], intentSha256=intent_sha, xid=intent["xid"],
                before=intent["before"], after=current, committed=True, sourceActorQualified=False, proxyLifecycleQualified=False,
                timersRetired=False, countersReset=False, providerCalls=0, serviceActions=0))
        self.receipt(name)
        return {"committed": True, "phase": phase, "receiptSha256": self.digest(name), "reviewSha256": intent["reviewSha256"],
                "sourceActorQualified": False, "proxyLifecycleQualified": False, "timersRetired": False, "countersReset": False,
                "fourOrdinaryPermitsDisabled": phase == "disable", "originalDailyPolicyRestored": False,
                "providerCalls": 0, "serviceActions": 0}


def saved_owner():
    f = fixed_financial(); s = f.primitives(); value = s.document(BASE / "admitted.json")
    return Owner(Host(value["inputSha256"]))


def validate_current(receipt_sha):
    """Financial/profile only: no stale source, free actors or reader graph."""
    owner = saved_owner(); need(pin(receipt_sha) and owner.digest("admitted.json") == receipt_sha, "actual_ordinary_financial_ACK_sha_required")
    ack = owner.receipt("admitted.json"); row = owner.reviewed(ack["reviewSha256"])
    need(not os.path.lexists(BASE / "disable-attempt.json"), "ordinary_disable_started_no_new_paid_authority")
    current = owner.h.snapshot(); owner.p.validate_current(row["before"], current, row["proposal"])
    monotonic(owner.m, ack["after"], current); owner.h.immutable()
    return {"format": FORMAT + "-current", "validated": True, "receiptSha256": receipt_sha, "financialQualified": True,
            "profileId": owner.m.PROFILE, "profileFileSha256": owner.m.PROFILE_FILE_SHA, "manifestHash": owner.m.MANIFEST,
            "permits": row["proposal"]["permits"], "expiresMs": row["proposal"]["expiresMs"], "dailyPolicy": row["proposal"]["ordinaryPolicy"],
            "sourceActorQualified": False, "proxyLifecycleQualified": False, "timersRetired": False, "providerCalls": 0, "serviceActions": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input-sha"); parser.add_argument("--authorization-sha")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--review", action="store_true")
    for name in ["rollback", "commit", "reconcile", "disable", "validate"]: group.add_argument("--" + name)
    parser.add_argument("--phase", choices=["admit", "disable"], default="admit"); args = parser.parse_args()
    if not any([args.review, args.rollback, args.commit, args.reconcile, args.disable, args.validate]):
        need(not args.input_sha and not args.authorization_sha, "explicit_phase_required_for_runtime_inputs")
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_production_root_financial_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_financial_outcome_unknown_no_retry")); signal.alarm(180)
    if args.validate: value = validate_current(args.validate)
    else:
        host = Host(args.input_sha); owner = Owner(host)
        # Same fixed shared lifecycle lock as the old deadlines, before finance.
        with host.s.lock(), host.f.financial_lock():
            if args.review: value = owner.review()
            elif args.rollback: value = owner.transaction(args.rollback)
            elif args.commit: value = owner.transaction(args.commit, True, args.authorization_sha)
            elif args.disable: value = owner.transaction(args.disable, True, args.authorization_sha, True)
            else: value = owner.reconcile(args.reconcile, args.phase)
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "automaticRetryAllowed": False,
            "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__,
            "providerCalls": 0, "serviceActions": 0})); raise SystemExit(1)
