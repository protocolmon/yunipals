#!/usr/bin/env python3
"""Capability components only: fixed probe + inert policy/timer/cleanup plan.

There is deliberately no production apply/run CLI. The reviewed live ownership,
source6 true-epoch, timer and database adapter is a separate missing integration.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import http.client
import json
from pathlib import Path
import re
import socket
import threading
import time
import types
from typing import Callable

FORMAT = "yunipals-paid-capability-components-v1"
PLANNER_SHA = "c8288f0fdab9a1c2970f6a86dbcfec1419de975b6b3dc3ef0e93e224e7fbb9ef"
SOURCE = "6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6"
RUNTIME = "aba79fc98d904ccbcab48127721139ef7120fa5c65b752d86c4b507b719b20e2"
NATIVE = "bf4939b3ff"
PROFILE = "0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3"
COORDINATOR = "faf1bb8c-4306-4c43-b55e-6ac5fa038567"
TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
CHAINS = {
    56: {"port": 19204, "first": 7716583, "address": "0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d"},
    8453: {"port": 19202, "first": 22224858, "address": "0x98433df878e8c898cb907345c3a7756e5f72240f"}
}
SPANS = (26, 1000, 10000)
MAX_CALLS, MAX_BYTES, MAX_SECONDS, CALL_SECONDS, SPACING = 6, 2_000_000, 90, 20, 1
PROOF_KEYS = {"source6FreeFirst", "sealedLong2", "source6TrueEpoch", "exclusiveSourceLease", "emptyOwnedCoordinatorCaches", "deadlineCleanupTimer", "utcCleanupTimer", "admissionCommit"}
MISSING_LIVE_GATES = (
    "Verify actual sealed long2/false-upgrade/runtime/source proofs and exclusive live source lease.",
    "Create and verify the new owned true proxy epoch; retain original false environment files/drop-ins.",
    "Install/verify both owned cleanup timers before guarded admission; provide durable timer ownership receipts.",
    "Apply planner owner SQL with actual peer/role/row/clock guards and reconcile any uncertain acknowledgement.",
    "Supply fresh live snapshot adapter proving identities, source/coordinator/grants/permits/counters before and after every probe call.",
    "Implement owned permit revocation, probe stop, false-epoch restoration/cache destruction and acknowledged policy/UTC cleanup."
)
FIXED_FAILURES = frozenset({"probe_deadline", "transport_allowance_invalid", "compressed_response_refused", "shared_response_limit", "call_deadline", "http_rate_limited", "http_unauthorized", "http_failure", "invalid_json_response", "response_identity_mismatch", "rpc_invalid_params", "rpc_range_refused", "rpc_failure", "invalid_log_result", "invalid_matching_log", "invalid_erc721_topics", "invalid_log_hash", "invalid_log_quantity", "invalid_fixed_counter", "log_outside_fixed_range", "duplicate_log", "nested_range_response_inconsistent", "live_epoch_or_policy_changed", "invalid_live_counter_shape", "evidence_traffic_changed", "unexpected_paid_or_refused_traffic", "probe_did_not_use_paid_primary", "booked_grant_ceiling_or_baseline_changed", "booked_grants_regressed", "planner_identity_changed", "binding_mutated", "live_receipt_references_required"})


class Refusal(RuntimeError):
    """Only fixed reason labels may escape the probe."""


def fail(reason):
    raise Refusal(reason)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def planner():
    path = Path(__file__).with_name("paid-backfill-policy-plan-v2.py")
    raw = path.read_bytes()
    if sha(raw) != PLANNER_SHA:
        fail("planner_identity_changed")
    module = types.ModuleType("paid_capability_frozen_calculator")
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def integer(value, maximum):
    if type(value) is not int or not 0 <= value <= maximum:
        fail("invalid_fixed_counter")
    return value


def hash_text(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def hex_integer(value, maximum=(1 << 53)-1):
    if not isinstance(value, str) or not re.fullmatch(r"0x(?:0|[1-9a-f][0-9a-f]*)", value):
        fail("invalid_log_quantity")
    return integer(int(value, 16), maximum)


@dataclass(frozen=True)
class ProbeCall:
    id: int
    chain: int
    span: int
    permit: str

    def body(self):
        if self.chain not in CHAINS or self.span not in SPANS or type(self.id) is not int or not 1 <= self.id <= 6 or not re.fullmatch(r"0x[0-9a-f]{64}", self.permit):
            fail("fixed_probe_identity_required")
        c = CHAINS[self.chain]
        return {"jsonrpc": "2.0", "id": self.id, "method": "eth_getLogs", "params": [{"address": c["address"], "fromBlock": hex(c["first"]), "toBlock": hex(c["first"] + self.span - 1), "topics": [TOPIC]}]}

    def headers(self):
        self.body()
        return {"Content-Type": "application/json", "Connection": "close", "x-yunipals-unified-rpc-profile": PROFILE, "x-yunipals-rpc-workload": "unified_source", "x-yunipals-unified-rpc-permit": self.permit}


def calls_for(plan):
    model = planner()
    model.validate_plan(plan)
    rows = model.qualification_permits(plan)
    if model.permit_partition(plan, rows)["maximumCuSum"] != "360":
        fail("fixed_permit_partition_required")
    result = []
    for row in rows:
        chain = row["chainId"]
        if chain not in CHAINS or row["fromBlock"] != str(CHAINS[chain]["first"]) or row["throughBlock"] != str(CHAINS[chain]["first"]+9999) or row["maximumCu"] != "180":
            fail("fixed_permit_range_required")
        for span in SPANS:
            result.append(ProbeCall(len(result)+1, chain, span, row["permitId"]))
    if len(result) != MAX_CALLS:
        fail("fixed_six_calls_required")
    return tuple(result)


class LoopbackTransport:
    """No environment proxy, DNS name, provider URL, redirect or retry path."""

    def __init__(self, monotonic=time.monotonic, connection_factory=http.client.HTTPConnection):
        self.monotonic, self.factory = monotonic, connection_factory

    def __call__(self, call, timeout, remaining_bytes):
        body = encoded(call.body())
        if not 0 < timeout <= CALL_SECONDS or not 0 < remaining_bytes <= MAX_BYTES:
            fail("transport_allowance_invalid")
        deadline = self.monotonic()+timeout
        connection = self.factory("127.0.0.1", CHAINS[call.chain]["port"], timeout=timeout)
        watchdog, expired = None, threading.Event()
        try:
            connection.connect()
            owned_socket = connection.sock
            def remaining_timeout():
                remaining = deadline-self.monotonic()
                if remaining <= 0:
                    fail("call_deadline")
                owned_socket.settimeout(remaining)
            remaining_timeout()
            # A socket timeout is an idle timeout: HTTP header/body parsing can
            # make many internal recv calls while bytes trickle in. Shut down
            # only this owned socket at the absolute deadline as well.
            def interrupt_owned_socket():
                expired.set()
                try:
                    owned_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            watchdog = threading.Timer(max(0, deadline-self.monotonic()), interrupt_owned_socket)
            watchdog.daemon = True
            watchdog.start()
            connection.request("POST", "/unified", body=body, headers=call.headers())
            remaining_timeout()
            response = connection.getresponse()
            if response.getheader("Content-Encoding", "identity") != "identity":
                fail("compressed_response_refused")
            length = response.getheader("Content-Length")
            if length is not None and (not re.fullmatch(r"0|[1-9][0-9]*", length) or int(length) > remaining_bytes):
                fail("shared_response_limit")
            parts, total = [], 0
            # HTTPResponse closes its file (and a Connection: close socket)
            # when the declared body/chunk terminator is fully consumed. Do not
            # set a timeout on that closed descriptor for an unnecessary read.
            while not response.isclosed():
                remaining_timeout()
                part = response.read(min(65536, remaining_bytes-total+1))
                if not part:
                    break
                parts.append(part); total += len(part)
                if total > remaining_bytes:
                    fail("shared_response_limit")
            if length is not None and total != int(length):
                # EOF before Content-Length must remain a transport failure,
                # even when those partial bytes happen to form valid JSON.
                raise http.client.IncompleteRead(b"", int(length)-total)
            if expired.is_set() or self.monotonic() >= deadline:
                fail("call_deadline")
            return response.status, b"".join(parts)
        except (OSError, http.client.HTTPException):
            if expired.is_set() or self.monotonic() >= deadline:
                fail("call_deadline")
            raise
        finally:
            if watchdog is not None:
                watchdog.cancel()
                watchdog.join(timeout=0.1)
            connection.close()


def decode_reply(call, status, raw, prior):
    if type(status) is not int or status != 200:
        fail("http_rate_limited" if status == 429 else "http_unauthorized" if status in {401, 403} else "http_failure")
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        fail("invalid_json_response")
    if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0" or type(payload.get("id")) is not int or payload["id"] != call.id:
        fail("response_identity_mismatch")
    if "error" in payload:
        error = payload["error"]
        code = error.get("code") if isinstance(error, dict) else None
        fail("rpc_invalid_params" if code == -32602 else "rpc_range_refused" if code == -32005 else "rpc_failure")
    if set(payload) != {"jsonrpc", "id", "result"} or not isinstance(payload["result"], list) or len(payload["result"]) > 10000:
        fail("invalid_log_result")
    c, found, known = CHAINS[call.chain], {}, 0
    for log in payload["result"]:
        if not isinstance(log, dict) or not isinstance(log.get("address"), str) or log["address"].lower() != c["address"] or log.get("removed") is not False or log.get("data") != "0x":
            fail("invalid_matching_log")
        topics = log.get("topics")
        if not isinstance(topics, list) or len(topics) != 4 or not all(isinstance(t, str) and re.fullmatch(r"0x[0-9a-fA-F]{64}", t) for t in topics) or topics[0].lower() != TOPIC or any(t[2:26] != "0"*24 for t in topics[1:3]):
            fail("invalid_erc721_topics")
        if any(not isinstance(log.get(k), str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", log[k]) for k in ["blockHash", "transactionHash"]):
            fail("invalid_log_hash")
        block = hex_integer(log.get("blockNumber"))
        if not c["first"] <= block < c["first"]+call.span:
            fail("log_outside_fixed_range")
        normalized = {"block": block, "transactionIndex": hex_integer(log.get("transactionIndex")), "logIndex": hex_integer(log.get("logIndex")), "blockHash": log["blockHash"].lower(), "transactionHash": log["transactionHash"].lower(), "topics": [t.lower() for t in topics], "address": c["address"], "data": "0x"}
        key = sha(encoded([normalized["blockHash"], normalized["transactionHash"], normalized["logIndex"]]))
        if key in found:
            fail("duplicate_log")
        found[key] = sha(encoded(normalized))
        if call.chain == 8453 and block == c["first"]:
            known += 1
    if any(found.get(k) != v for k, v in prior.items()):
        fail("nested_range_response_inconsistent")
    return {"logCount": len(found), "knownBaseBlockLogCount": known, "responseBytes": len(raw), "responseSha256": sha(raw)}, found


@dataclass(frozen=True)
class ProbeBinding:
    """References are not evidence validation. The separate live adapter must verify them."""
    plan: dict
    proof_refs: dict
    proxy_invocations: dict
    sealed_sha256: str = field(init=False)

    def __post_init__(self):
        # Prevent an adapter's reused dictionaries from silently changing the
        # expected epoch while it assembles its next current-state snapshot.
        for name in ["plan", "proof_refs", "proxy_invocations"]:
            object.__setattr__(self, name, json.loads(encoded(getattr(self, name))))
        object.__setattr__(self, "sealed_sha256", sha(encoded([self.plan, self.proof_refs, self.proxy_invocations])))


def validate_binding(binding):
    if sha(encoded([binding.plan, binding.proof_refs, binding.proxy_invocations])) != binding.sealed_sha256:
        fail("binding_mutated")
    planner().validate_plan(binding.plan)
    if set(binding.proof_refs) != PROOF_KEYS or not all(hash_text(h) for h in binding.proof_refs.values()) or set(binding.proxy_invocations) != {"56", "8453"} or any(not isinstance(v, str) or not re.fullmatch(r"[0-9a-f]{32}", v) for v in binding.proxy_invocations.values()):
        fail("live_receipt_references_required")


def validate_guard(binding, value, paid_counts, initial=None):
    """Validate a bounded public projection returned by a separately reviewed live adapter."""
    validate_binding(binding)
    keys = {"sourceDigest", "runtimeSha256", "nativeBuild", "profileId", "profileExpiresAt", "profileEnabled", "coordinatorId", "coordinatorEnabled", "proofRefs", "proxyInvocations", "sourceRouting", "policy", "otherAllocationsSha256", "sourceGrantedCu", "paidCalls", "sourceRefused", "sourceFreeCalls", "evidencePaidCalls", "evidenceRefused", "permitSpentCu", "permitRows", "activePermitIds"}
    p = binding.plan
    if not isinstance(value, dict) or set(value) != keys or any(value[k] != v for k, v in {"sourceDigest": SOURCE, "runtimeSha256": RUNTIME, "nativeBuild": NATIVE, "profileId": PROFILE, "coordinatorId": COORDINATOR, "proofRefs": binding.proof_refs, "proxyInvocations": binding.proxy_invocations, "sourceRouting": {"56": "paid_primary", "8453": "paid_primary"}, "policy": p["temporaryPolicy"], "otherAllocationsSha256": p["otherAllocationsSha256"]}.items()):
        fail("live_epoch_or_policy_changed")
    model = planner()
    if value["profileEnabled"] is not True or value["coordinatorEnabled"] is not True or model.moment(value["profileExpiresAt"]) != model.moment(p["profileExpiresAt"]):
        fail("live_epoch_or_policy_changed")
    expected_rows = model.qualification_permits(p)
    if (not isinstance(value["permitRows"], list) or len(value["permitRows"]) != 2 or
            not isinstance(value["activePermitIds"], list) or len(value["activePermitIds"]) != 2 or
            set(value["activePermitIds"]) != {r["permitId"] for r in expected_rows}):
        fail("live_epoch_or_policy_changed")
    for expected in expected_rows:
        matches = [r for r in value["permitRows"] if isinstance(r, dict) and r.get("permitId") == expected["permitId"]]
        if len(matches) != 1:
            fail("live_epoch_or_policy_changed")
        row = matches[0]
        if (set(row) != set(expected) | {"profileId", "enabled", "spentCu"} or
                any(row[k] != v for k, v in {**expected, "profileId": PROFILE}.items() if k != "expires") or
                type(row["chainId"]) is not int or row["enabled"] is not True or
                model.moment(row["expires"]) != model.moment(expected["expires"]) or
                integer(row["spentCu"], 180) != 60*paid_counts[str(row["chainId"])]):
            fail("unexpected_paid_or_refused_traffic")
    for name in ["paidCalls", "sourceRefused", "sourceFreeCalls", "permitSpentCu"]:
        if not isinstance(value[name], dict) or set(value[name]) != {"56", "8453"}:
            fail("invalid_live_counter_shape")
    for name in ["evidencePaidCalls", "evidenceRefused"]:
        if not isinstance(value[name], dict) or set(value[name]) != {"1", "56", "137", "8453"}:
            fail("invalid_live_counter_shape")
        for chain, n in value[name].items():
            integer(n, (1 << 53)-1)
            if initial is None and n != 0 or initial is not None and n != initial[name][chain]:
                fail("evidence_traffic_changed")
    for chain in ["56", "8453"]:
        if integer(value["paidCalls"][chain], 3) != paid_counts[chain] or integer(value["permitSpentCu"][chain], 180) != 60*paid_counts[chain] or integer(value["sourceRefused"][chain], (1 << 53)-1) != 0:
            fail("unexpected_paid_or_refused_traffic")
        integer(value["sourceFreeCalls"][chain], (1 << 53)-1)
        if initial is not None and value["sourceFreeCalls"][chain] != initial["sourceFreeCalls"][chain]:
            fail("probe_did_not_use_paid_primary")
    booked = planner().cu(value["sourceGrantedCu"]) - planner().cu(p["baselineSourceGrantedCu"])
    if not 0 <= booked <= 2000 or initial is None and booked != 0:
        fail("booked_grant_ceiling_or_baseline_changed")
    return booked


def run_probe(binding: ProbeBinding, *, fresh_guard: Callable, transport: Callable, utc_now=lambda: datetime.now(timezone.utc), monotonic=time.monotonic, sleep=time.sleep):
    """Integration-only; caller owns live lease, receipts, both timers and cleanup.

    No default live guard or transport is provided, and no CLI exposes this.
    The guard must actually verify those obligations; hashes/booleans alone do
    not prove them. Failure always requires the separate owned cleanup path.
    """
    started = monotonic()
    result = {"format": FORMAT, "componentOnly": True, "integrationComplete": False, "status": "failed", "attemptedRpcCalls": 0, "completedRpcCalls": 0, "maximumDispatchCu": 360, "bookedMigrationCu": None, "accountingComplete": False, "responseBytes": 0, "calls": [], "cleanupRequired": True, "productivePromotionAllowed": False, "rawResponsesEmitted": False, "automaticRetryAllowed": False}
    counts, previous, baseline, last_booked = {"56": 0, "8453": 0}, {56: {}, 8453: {}}, None, 0
    try:
        validate_binding(binding)
        calls = calls_for(binding.plan)
        model = planner()
        end = min(model.moment(binding.plan["expires"]), model.moment(binding.plan["qualificationExpiresAt"]))
        def allowance():
            now = utc_now()
            if now < model.moment(binding.plan["start"]) or now >= end or monotonic()-started >= MAX_SECONDS:
                fail("probe_deadline")
            return min(float(CALL_SECONDS), MAX_SECONDS-(monotonic()-started), (end-now).total_seconds())
        allowance()
        baseline = fresh_guard()
        validate_guard(binding, baseline, counts)
        for index, call in enumerate(calls):
            if index:
                if allowance() <= SPACING:
                    fail("probe_deadline")
                sleep(SPACING)
            allowance()
            before = fresh_guard()
            booked = validate_guard(binding, before, counts, baseline)
            if booked < last_booked:
                fail("booked_grants_regressed")
            if result["responseBytes"] >= MAX_BYTES:
                fail("shared_response_limit")
            result["attemptedRpcCalls"] += 1
            status, raw = transport(call, allowance(), MAX_BYTES-result["responseBytes"])
            if not isinstance(raw, bytes) or result["responseBytes"]+len(raw) > MAX_BYTES:
                fail("shared_response_limit")
            result["responseBytes"] += len(raw)
            allowance()
            summary, found = decode_reply(call, status, raw, previous[call.chain])
            previous[call.chain] = found
            counts[str(call.chain)] += 1
            after = fresh_guard()
            last_booked = validate_guard(binding, after, counts, baseline)
            if last_booked < booked:
                fail("booked_grants_regressed")
            result["calls"].append({"chainId": call.chain, "span": call.span, **summary})
            result["completedRpcCalls"] += 1
        known = any(row["chainId"] == 8453 and row["knownBaseBlockLogCount"] > 0 for row in result["calls"])
        result.update(status="capability_responses_qualified" if known else "availability_only_known_event_absent", knownBaseEventObserved=known, allSixRangesAnswered=True, capabilityQualified=known, bookedMigrationCu=last_booked, accountingComplete=True)
    except Refusal as error:
        result["failure"] = str(error) if str(error) in FIXED_FAILURES else "component_guard_refused"
    except TimeoutError:
        result["failure"] = "transport_timeout"
    except Exception:
        result["failure"] = "transport_or_live_guard_failed"
    result["elapsedSeconds"] = round(monotonic()-started, 3)
    return result


def component_plan(snapshot, start, approval):
    """Inert preparation only. Gate booleans are NOT validated operational evidence."""
    model = planner()
    admission = model.admission(snapshot, start, approval)
    calls = calls_for(admission)
    stamp = model.digest(admission)[:16]
    timers = [{"name": "yunipals-paid-capability-deadline-"+stamp, "dueUtc": admission["qualificationExpiresAt"], "action": "revoke_stop_restore_owned_false_epoch_then_current_day_policy"}, {"name": "yunipals-paid-capability-utc-"+stamp, "dueUtc": admission["nextUtc"], "action": "exact_owned_utc_restore_or_partial_admission_boundary_recovery"}]
    return {"format": FORMAT, "componentOnly": True, "productionExecutable": False, "integrationComplete": False, "admissionPlan": admission, "admissionSql": model.owner_sql("admission", admission, snapshot), "exactRevocationSql": model.owner_sql("revoke", admission, {}), "fixedCalls": [{"chainId": c.chain, "span": c.span, "body": c.body(), "headers": c.headers()} for c in calls], "timerSpecifications": timers, "timerUnitsImplementedOrInstalled": False, "cleanupOrder": ["Revoke only the exact owned permits; ambiguous ack is retained without retry.", "Stop only this retained owned probe process/unit/Invocation, even if revocation acknowledgement is uncertain.", "Verify exact owned paid proxy epoch and restore original free-first selectors; restart only those proved instances to destroy cached grants.", "Take fresh durable policy/allocation/current-or-prior-day grant snapshots and exact disabled-permit evidence.", "Generate guarded current-day cleanup or boundary-recovery SQL through the pinned calculator; policy restoration is forbidden on uncertain revoke/cache ownership or policy drift.", "At next UTC, separately recheck owned cleanup receipt/caches/stopped source/exact disabled permits and apply only pinned calculator UTC SQL; never reset counters/refund cache tails."], "missingLiveGates": list(MISSING_LIVE_GATES), "bounds": {"rpcCalls": MAX_CALLS, "responseBytes": MAX_BYTES, "seconds": MAX_SECONDS, "perCallSeconds": CALL_SECONDS, "spacingSeconds": SPACING, "bookedCu": 2000, "permitDispatchCu": 360}, "providerOrDatabaseExecution": False, "automaticProductivePromotion": False}


def cleanup_sql(plan, current, state, *, at=None, cleanup_receipt=None, old_day_grants=None):
    """Inert last step only; caller must first prove revocation/cache/stop receipts."""
    model = planner()
    model.validate_plan(plan)
    if cleanup_receipt is not None:
        if at is None:
            fail("utc_clock_required")
        receipt = cleanup_receipt
        booked = model.cu(receipt["migrationBookedGrantsCu"])
        if (booked > 2000 or any(receipt.get(k) != v for k, v in {
            "format": model.FORMAT, "stage": "prepared_current_day_cleanup_not_executed",
            "admissionPlanSha256": model.digest(plan), "originalPolicy": plan["originalPolicy"],
            "otherAllocationsSha256": plan["otherAllocationsSha256"], "grantDay": plan["grantDay"],
            "nextUtc": plan["nextUtc"], "epochStart": plan["start"], "epochExpires": plan["expires"],
            "approvedAggregateAdditionalBookedCu": plan["approvedAggregateAdditionalBookedCu"],
            "ownedPermits": model.qualification_permits(plan),
            "policy": {"globalDailyCu": str(1_000_000+booked), "foregroundReserveCu": "200000", "unifiedSourceDailyCu": str(25000+booked)}
        }.items()) or not hash_text(receipt.get("currentSnapshotSha256"))):
            fail("owned_cleanup_receipt_required")
        receipt = model.utc_restore(cleanup_receipt, current, at, {k: state[k] for k in ["ownedPermitsRevoked", "ownedPaidProxyCachesDestroyed", "ownedSourceStopped"]})
        return {"receipt": receipt, "sql": model.owner_sql("utc", cleanup_receipt, current, {k: state[k] for k in ["ownedPermitsRevoked", "ownedPaidProxyCachesDestroyed", "ownedSourceStopped"]}, at), "executed": False}
    if old_day_grants is not None:
        receipt, intermediate = model.boundary_recovery(plan, current, old_day_grants, at, state)
        return {"receipt": receipt, "sql": model.owner_sql("utc", intermediate, current, {k: state[k] for k in ["ownedPermitsRevoked", "ownedPaidProxyCachesDestroyed", "ownedSourceStopped"]}, at), "executed": False}
    receipt = model.cleanup(plan, current, state)
    return {"receipt": receipt, "sql": model.owner_sql("cleanup", plan, current, state), "executed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare")
    args = parser.parse_args()
    if args.prepare:
        with Path(args.prepare).open("rb") as handle:
            raw = handle.read(65537)
        if len(raw) > 65536:
            fail("public_input_limit")
        value = json.loads(raw)
        if not isinstance(value, dict) or set(value) != {"snapshot", "start", "approval"}:
            fail("exact_public_preparation_input_required")
        print(json.dumps(component_plan(value["snapshot"], value["start"], value["approval"]), indent=2))
    else:
        print(json.dumps({"format": FORMAT, "componentOnly": True, "productionExecutable": False, "integrationComplete": False, "plannerSha256": PLANNER_SHA, "missingLiveGates": list(MISSING_LIVE_GATES), "providerOrDatabaseExecution": False}, indent=2))


if __name__ == "__main__":
    main()
