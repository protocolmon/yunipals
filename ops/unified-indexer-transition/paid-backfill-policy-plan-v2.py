#!/usr/bin/env python3
"""Pure paid-backfill policy calculator. No DB, subprocess, network or execution."""
from datetime import datetime, timedelta, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re

FORMAT = "yunipals-paid-backfill-policy-plan-v2"
ALLOWANCE = 20_000_000
SECONDS = 28_800
QUALIFICATION_GRANTS = 2_000
QUALIFICATION_DISPATCH = 360
GLOBAL = 1_000_000
RESERVE = 200_000
SOURCE = 25_000
EVIDENCE = 5_000
MAX_CU = 1_000_000_000_000
LONG2 = "debba27f90b44416bd9399305e3392f7"
PROFILE = "0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3"


def encoded(value): return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
def digest(value): return hashlib.sha256(encoded(value)).hexdigest()
def fail(code): raise ValueError(code)


def cu(value):
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]{0,12}", value) or int(value) > MAX_CU: fail("invalid_cu")
    return int(value)


def moment(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z", value): fail("invalid_utc_time")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def text_time(value): return value.isoformat(timespec="microseconds" if value.microsecond else "seconds").replace("+00:00", "Z")
def sha(value): return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def policy(snapshot):
    if snapshot.get("scope") != "yunipals-opensea" or snapshot.get("profileId") != PROFILE: fail("policy_identity")
    global_row = snapshot["global"]
    if set(global_row) != {"dailyCu", "foregroundReserveCu", "enabled"} or global_row["enabled"] is not True: fail("global_shape")
    daily, reserve = cu(global_row["dailyCu"]), cu(global_row["foregroundReserveCu"])
    if not 0 <= reserve < daily: fail("global_reserve")
    rows = snapshot["allocations"]
    if not isinstance(rows, list) or not 2 <= len(rows) <= 32: fail("allocation_shape")
    allocations = {}
    for row in rows:
        if set(row) != {"workload", "priority", "dailyCu"} or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", row["workload"]) or row["priority"] not in {"background", "foreground"} or row["workload"] in allocations or cu(row["dailyCu"]) < 1: fail("allocation_shape")
        allocations[row["workload"]] = row
    if allocations.get("unified_source", {}).get("priority") != "background" or allocations.get("unified_evidence", {}).get("priority") != "background": fail("source_evidence_priority")
    return daily, reserve, allocations


def grants(snapshot, allocations):
    windows = snapshot["grants"]
    if set(windows) != {"day", "global", "background", "workloads"} or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", windows["day"]) or set(windows["workloads"]) != set(allocations): fail("grant_shape")
    total, background = cu(windows["global"]), cu(windows["background"])
    work = {name: cu(value) for name, value in windows["workloads"].items()}
    if sum(work.values()) != total or sum(work[name] for name in work if allocations[name]["priority"] == "background") != background: fail("grant_conservation")
    return total, background, work


def other_policy(allocations): return digest({name: row for name, row in allocations.items() if name != "unified_source"})


def admission(snapshot, start, approval):
    if encoded(approval) != encoded({"explicitUserApproval": True, "additionalCu": ALLOWANCE, "maximumSeconds": SECONDS, "automaticRenewal": False, "accountUpgradeAllowed": False}): fail("explicit_approval_required")
    at = moment(start)
    daily, reserve, allocations = policy(snapshot)
    total, background, work = grants(snapshot, allocations)
    if daily != GLOBAL or reserve != RESERVE or cu(allocations["unified_source"]["dailyCu"]) != SOURCE or cu(allocations["unified_evidence"]["dailyCu"]) != EVIDENCE: fail("initial_policy_changed")
    if snapshot["grants"]["day"] != at.date().isoformat() or total > GLOBAL or background > GLOBAL - RESERVE or any(work[name] > cu(allocations[name]["dailyCu"]) for name in work): fail("baseline_grants")
    gates = snapshot["gates"]
    required = {"oldLong2StoppedAndSealed", "newPackageVerified", "nativeAndRetainedWorkspaceUnchanged", "exclusiveUnifiedSourceWriters", "noOtherActivePaidPermits", "ownedDeadlineCleanupPrepared", "ownedUtcCleanupPrepared", "newEpochCachesSealed"}
    if set(gates) != required or any(gates[key] is not True for key in required): fail("operational_gate_missing")
    if snapshot.get("oldLong2Invocation") != LONG2 or not sha(snapshot.get("oldLong2TerminalProofSha256")) or not sha(snapshot.get("newPackageEvidenceSha256")): fail("sealed_epoch_proof_missing")
    boundary = at.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    profile_expiry = moment(snapshot["profileExpiresAt"])
    expires = min(at + timedelta(seconds=SECONDS), boundary, profile_expiry)
    remaining = int((expires - at).total_seconds())
    if remaining < 1000: fail("insufficient_same_day_window")
    return {"format": FORMAT, "stage": "prepared_admission_not_executed", "start": start, "expires": text_time(expires), "nextUtc": text_time(boundary), "maximumRemainingSeconds": remaining, "qualificationExpiresAt": text_time(min(at + timedelta(seconds=600), expires)),
        "phase": "capability_qualification_only", "approvedAggregateAdditionalBookedCu": str(ALLOWANCE),
        "additionalBookedGrantCeilingCu": str(QUALIFICATION_GRANTS), "allPermitMaximumCuSumCeiling": str(QUALIFICATION_DISPATCH), "baselineSourceGrantedCu": str(work["unified_source"]),
        "baselineGlobalGrantedCu": str(total), "baselineBackgroundGrantedCu": str(background), "grantDay": snapshot["grants"]["day"],
        "temporaryPolicy": {"globalDailyCu": str(GLOBAL + QUALIFICATION_GRANTS), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(work["unified_source"] + QUALIFICATION_GRANTS)},
        "originalPolicy": {"globalDailyCu": str(GLOBAL), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(SOURCE)},
        "otherAllocationsSha256": other_policy(allocations), "snapshotSha256": digest(snapshot), "approval": approval, "newPackageEvidenceSha256": snapshot["newPackageEvidenceSha256"],
        "profileExpiresAt": snapshot["profileExpiresAt"],
        "ownership": {"oldLong2Invocation": LONG2, "terminalProofSha256": snapshot["oldLong2TerminalProofSha256"]}, "automaticRenewal": False, "executionAuthorizedByThisCalculator": False}


def permit_partition(plan, rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 8: fail("permit_partition")
    total = 0; identifiers = set()
    for row in rows:
        if set(row) != {"permitId", "chainId", "fromBlock", "throughBlock", "maximumCu", "expires"} or not re.fullmatch(r"0x[0-9a-f]{64}", row["permitId"]) or row["permitId"] in identifiers or type(row["chainId"]) is not int or row["chainId"] not in {56, 8453}: fail("permit_identity")
        identifiers.add(row["permitId"])
        if cu(row["fromBlock"]) > cu(row["throughBlock"]) or not 0 < cu(row["maximumCu"]) <= ALLOWANCE or not moment(plan["start"]) < moment(row["expires"]) <= moment(plan["expires"]): fail("permit_bounds")
        total += cu(row["maximumCu"])
    if total > cu(plan["allPermitMaximumCuSumCeiling"]): fail("permit_allowance_exceeded")
    return {"maximumCuSum": str(total), "remainingUnassignedCu": str(cu(plan["allPermitMaximumCuSumCeiling"]) - total), "permitRowsSha256": digest(rows), "automaticRenewal": False}


def validate_plan(plan):
    if plan.get("format") != FORMAT or plan.get("phase") != "capability_qualification_only" or plan.get("automaticRenewal") is not False: fail("plan_identity")
    if plan["originalPolicy"] != {"globalDailyCu": str(GLOBAL), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(SOURCE)}: fail("plan_original_policy")
    if cu(plan["approvedAggregateAdditionalBookedCu"]) != ALLOWANCE or cu(plan["additionalBookedGrantCeilingCu"]) != QUALIFICATION_GRANTS or cu(plan["allPermitMaximumCuSumCeiling"]) != QUALIFICATION_DISPATCH or cu(plan["baselineSourceGrantedCu"]) > SOURCE: fail("plan_allowance")
    if plan["temporaryPolicy"] != {"globalDailyCu": str(GLOBAL + QUALIFICATION_GRANTS), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(cu(plan["baselineSourceGrantedCu"]) + QUALIFICATION_GRANTS)}: fail("plan_temporary_policy")
    start, end = moment(plan["start"]), moment(plan["expires"])
    boundary = start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    if plan["nextUtc"] != text_time(boundary) or plan["grantDay"] != start.date().isoformat() or end != min(start + timedelta(seconds=SECONDS), boundary, moment(plan["profileExpiresAt"])) or plan["qualificationExpiresAt"] != text_time(min(start + timedelta(seconds=600), end)): fail("plan_deadline")
    if int((end - start).total_seconds()) < 1000 or not sha(plan["otherAllocationsSha256"]): fail("plan_bounds")


def cleanup(plan, current, state):
    validate_plan(plan)
    if state != {"ownedPermitsRevoked": True, "ownedSourceStopped": True, "ownedPaidProxyCachesDestroyed": True, "ownedSourceWritersUnchanged": True}: fail("cleanup_quiescence_required")
    daily, reserve, allocations = policy(current)
    expected = plan["temporaryPolicy"]
    if daily != cu(expected["globalDailyCu"]) or reserve != RESERVE or cu(allocations["unified_source"]["dailyCu"]) != cu(expected["unifiedSourceDailyCu"]) or other_policy(allocations) != plan["otherAllocationsSha256"]: fail("cleanup_policy_ownership_drift")
    total, background, work = grants(current, allocations)
    if current["grants"]["day"] != plan["grantDay"]: fail("cleanup_day_changed_use_boundary_recovery")
    migration = work["unified_source"] - cu(plan["baselineSourceGrantedCu"])
    if not 0 <= migration <= cu(plan["additionalBookedGrantCeilingCu"]) or total - cu(plan["baselineGlobalGrantedCu"]) < migration or background - cu(plan["baselineBackgroundGrantedCu"]) < migration: fail("migration_grant_attribution")
    target = {"globalDailyCu": str(GLOBAL + migration), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(SOURCE + migration)}
    return {"format": FORMAT, "stage": "prepared_current_day_cleanup_not_executed", "migrationBookedGrantsCu": str(migration), "grantDay": plan["grantDay"], "nextUtc": plan["nextUtc"], "policy": target,
        "otherAllocationsSha256": plan["otherAllocationsSha256"], "originalPolicy": plan["originalPolicy"], "admissionPlanSha256": digest(plan), "currentSnapshotSha256": digest(current),
        "approvedAggregateAdditionalBookedCu": plan["approvedAggregateAdditionalBookedCu"], "aggregateUnbookedCuRemaining": str(cu(plan["approvedAggregateAdditionalBookedCu"]) - migration),
        "epochStart": plan["start"], "epochExpires": plan["expires"], "ownedPermits": qualification_permits(plan),
        "cachedUnusedGrantsIncluded": True, "refundOrCounterResetAllowed": False, "normalSourceUnspentHeadroomCu": str(SOURCE - cu(plan["baselineSourceGrantedCu"])), "executionAuthorizedByThisCalculator": False}


def utc_restore(receipt, current, at, state):
    if receipt["originalPolicy"] != {"globalDailyCu": str(GLOBAL), "foregroundReserveCu": str(RESERVE), "unifiedSourceDailyCu": str(SOURCE)}: fail("utc_original_policy")
    if moment(at) < moment(receipt["nextUtc"]): fail("utc_restore_too_early")
    if state != {"ownedPermitsRevoked": True, "ownedPaidProxyCachesDestroyed": True, "ownedSourceStopped": True}: fail("utc_restore_quiescence_required")
    daily, reserve, allocations = policy(current)
    expected = receipt["policy"]
    if daily != cu(expected["globalDailyCu"]) or reserve != cu(expected["foregroundReserveCu"]) or cu(allocations["unified_source"]["dailyCu"]) != cu(expected["unifiedSourceDailyCu"]) or other_policy(allocations) != receipt["otherAllocationsSha256"]: fail("utc_restore_policy_ownership_drift")
    return {"format": FORMAT, "stage": "prepared_next_utc_restore_not_executed", "policy": receipt["originalPolicy"], "cleanupReceiptSha256": digest(receipt), "refundOrCounterResetAllowed": False, "executionAuthorizedByThisCalculator": False}




def boundary_recovery(plan, current, old_day_grants, at, state):
    """No cleanup receipt yet: restore only an exact still-owned admission state."""
    if moment(at) < moment(plan["nextUtc"]): fail("boundary_recovery_too_early")
    old = {**current, "grants": old_day_grants}
    receipt = cleanup(plan, old, state)
    receipt.update({"stage": "prepared_partial_admission_boundary_recovery_not_executed", "policy": plan["temporaryPolicy"], "unappliedCurrentDayCleanupPolicy": receipt["policy"]})
    return utc_restore(receipt, current, at, {key: state[key] for key in ["ownedPermitsRevoked", "ownedPaidProxyCachesDestroyed", "ownedSourceStopped"]}), receipt

def qualification_permits(plan):
    return [{"permitId": "0x" + digest({"admission": digest(plan), "chainId": chain, "kind": "one_time_qualification"}),
        "chainId": chain, "fromBlock": str(first), "throughBlock": str(first + 9999), "maximumCu": "180", "expires": plan["qualificationExpiresAt"]}
        for chain, first in [(56, 7716583), (8453, 22224858)]]


def literal(value): return "'" + str(value).replace("'", "''") + "'"


def owner_sql(phase, plan, snapshot, state=None, at=None):
    """Emit inert, atomic owner SQL. Caller must separately prove external gates.

    No command, connection, credential, process or runtime operation occurs here.
    """
    if phase == "revoke":
        daily, reserve, allocations, work = 0, 0, {}, {}
    else:
        daily, reserve, allocations = policy(snapshot)
        _, _, work = grants(snapshot, allocations)
    rows = plan["ownedPermits"] if phase == "utc" else qualification_permits(plan)
    permit_plan = {"start": plan["epochStart"], "expires": plan["epochExpires"], "allPermitMaximumCuSumCeiling": str(QUALIFICATION_DISPATCH)} if phase == "utc" else plan
    permit_partition(permit_plan, rows)
    if phase == "admission":
        validate_plan(plan)
        if plan != admission(snapshot, plan["start"], plan["approval"]): fail("admission_plan_changed")
        if daily != GLOBAL or reserve != RESERVE or cu(allocations["unified_source"]["dailyCu"]) != SOURCE or work["unified_source"] != cu(plan["baselineSourceGrantedCu"]): fail("admission_sql_baseline_changed")
        if other_policy(allocations) != plan["otherAllocationsSha256"] or digest(snapshot) != plan["snapshotSha256"]: fail("admission_sql_snapshot_changed")
        target = plan["temporaryPolicy"]
    elif phase == "cleanup": target = cleanup(plan, snapshot, state)["policy"]
    elif phase == "utc": target = utc_restore(plan, snapshot, at, state)["policy"]
    elif phase == "revoke": target = None
    else: fail("sql_phase")
    allocation_json = json.dumps(sorted(allocations.values(), key=lambda row: row["workload"]), separators=(",", ":"))
    checks = [
      "IF (SELECT jsonb_build_object('dailyCu',daily_cu::text,'foregroundReserveCu',foreground_reserve_cu::text,'enabled',enabled) FROM yunipals_market.rpc_compute_budget WHERE scope='yunipals-opensea') IS DISTINCT FROM " + literal(json.dumps(snapshot.get("global", {}), separators=(",", ":"))) + "::jsonb THEN RAISE EXCEPTION 'owned_global_policy_drift'; END IF;",
      "IF (SELECT jsonb_agg(jsonb_build_object('workload',workload,'priority',priority,'dailyCu',daily_cu::text) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation WHERE scope='yunipals-opensea') IS DISTINCT FROM " + literal(allocation_json) + "::jsonb THEN RAISE EXCEPTION 'owned_allocation_policy_drift'; END IF;"
    ]
    changes = []
    if phase == "admission":
        checks += [
          "PERFORM 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id=" + literal(PROFILE) + " AND p.scope='yunipals-opensea' FOR SHARE OF p,c;",
          "IF clock_timestamp()<" + literal(plan["start"]) + "::timestamptz OR clock_timestamp()>=least(" + literal(plan["qualificationExpiresAt"]) + "::timestamptz," + literal(plan["expires"]) + "::timestamptz)-interval '90 seconds' OR (clock_timestamp() AT TIME ZONE 'UTC')::date<>" + literal(plan["grantDay"]) + "::date THEN RAISE EXCEPTION 'fixed_epoch_window_unavailable'; END IF;",
          "IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile p JOIN yunipals_market.opensea_request_budget c USING(scope) WHERE p.profile_id=" + literal(PROFILE) + " AND p.scope='yunipals-opensea' AND p.enabled AND c.enabled AND c.coordinator_id::text=(p.policy->>'coordinatorId') AND p.expires_at=" + literal(plan["profileExpiresAt"]) + "::timestamptz AND p.expires_at>=" + literal(plan["expires"]) + "::timestamptz) THEN RAISE EXCEPTION 'approved_profile_unavailable'; END IF;",
          "IF coalesce((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start=" + literal(plan["grantDay"]) + "::date),0)<>" + plan["baselineSourceGrantedCu"] + " THEN RAISE EXCEPTION 'source_grant_baseline_changed'; END IF;"
        ]
        for row in rows:
            changes.append("INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at) VALUES(" + ",".join([literal(row["permitId"]), literal(PROFILE), str(row["chainId"]), row["fromBlock"], row["throughBlock"], row["maximumCu"], "true", literal(row["expires"]) + "::timestamptz"]) + ");")
    if phase in {"admission", "cleanup"}:
        checks.append("IF EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea' AND r.enabled AND r.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'unexpected_active_paid_permit'; END IF;")
    if phase == "cleanup":
        checks.append("IF (clock_timestamp() AT TIME ZONE 'UTC')::date<>" + literal(plan["grantDay"]) + "::date OR coalesce((SELECT granted_cu FROM yunipals_market.rpc_compute_workload_window WHERE scope='yunipals-opensea' AND workload='unified_source' AND window_start=" + literal(plan["grantDay"]) + "::date),0)<>" + str(work["unified_source"]) + " THEN RAISE EXCEPTION 'quiesced_grants_changed'; END IF;")
    if phase == "utc":
        checks.append("IF clock_timestamp()<" + literal(plan["nextUtc"]) + "::timestamptz THEN RAISE EXCEPTION 'utc_restore_too_early'; END IF;")
    if phase in {"cleanup", "utc"}:
        for row in rows:
            checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id=" + literal(row["permitId"]) + " AND profile_id=" + literal(PROFILE) + " AND chain_id=" + str(row["chainId"]) + " AND from_block=" + row["fromBlock"] + " AND through_block=" + row["throughBlock"] + " AND maximum_cu=" + row["maximumCu"] + " AND expires_at=" + literal(row["expires"]) + "::timestamptz AND NOT enabled) THEN RAISE EXCEPTION 'owned_permit_not_revoked'; END IF;")
    if phase == "revoke":
        # Revocation is allowed even after an unrelated policy change, but only
        # these exact owned rows may be touched; no global policy restoration.
        checks = []
        for row in rows:
            match = "permit_id=" + literal(row["permitId"]) + " AND profile_id=" + literal(PROFILE) + " AND chain_id=" + str(row["chainId"]) + " AND from_block=" + row["fromBlock"] + " AND through_block=" + row["throughBlock"] + " AND maximum_cu=" + row["maximumCu"] + " AND expires_at=" + literal(row["expires"]) + "::timestamptz"
            checks.append("IF NOT EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_replay_permit WHERE " + match + ") THEN RAISE EXCEPTION 'owned_permit_identity_drift'; END IF;")
            changes.append("UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE " + match + ";")
    if target:
        if set(target) != {"globalDailyCu", "foregroundReserveCu", "unifiedSourceDailyCu"} or any(cu(v) < 1 for v in target.values()) or cu(target["foregroundReserveCu"]) != RESERVE: fail("sql_target_policy")
        changes += ["UPDATE yunipals_market.rpc_compute_budget SET daily_cu=" + target["globalDailyCu"] + " WHERE scope='yunipals-opensea';",
                    "UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=" + target["unifiedSourceDailyCu"] + " WHERE scope='yunipals-opensea' AND workload='unified_source';"]
    return "\n".join(["-- PREPARED OWNER SQL ONLY. No execution is performed by the calculator.", "-- External package/process/cache/owned timer gates must be independently verified.", "BEGIN;", "SET LOCAL statement_timeout='3000ms';", "SET LOCAL lock_timeout='750ms';", "SET LOCAL idle_in_transaction_session_timeout='5000ms';", "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));", "LOCK TABLE yunipals_market.rpc_compute_budget,yunipals_market.rpc_compute_allocation,yunipals_market.rpc_compute_window,yunipals_market.rpc_compute_workload_window,yunipals_market.unified_rpc_replay_permit IN SHARE ROW EXCLUSIVE MODE;", "DO $paid_backfill_guard$ BEGIN", *checks, *changes, "END $paid_backfill_guard$;", "SELECT jsonb_build_object('preparedPlanSha256'," + literal(digest(plan)) + ",'phase'," + literal(phase) + ",'applied',true,'grantCountersReset',false) AS receipt;", "COMMIT;", ""])

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input"); parser.add_argument("--emit-owner-sql", action="store_true"); args = parser.parse_args()
    if args.input is None:
        result = {"format": FORMAT, "mode": "pure_plan_only", "helperSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "additionalCu": ALLOWANCE, "maximumSeconds": SECONDS, "automaticRenewal": False, "databaseOrProviderExecution": False}
    else:
        path = Path(args.input)
        if path.stat().st_size > 65536: fail("public_input_cap")
        value = json.loads(path.read_text()); phase = value["phase"]
        if phase == "admission": result = admission(value["snapshot"], value["start"], value["approval"])
        elif phase == "cleanup": result = cleanup(value["plan"], value["snapshot"], value["state"])
        elif phase == "utc": result = utc_restore(value["receipt"], value["snapshot"], value["now"], value["state"])
        elif phase == "permits": result = permit_partition(value["plan"], value["rows"])
        elif phase == "revoke": result = {"stage":"prepared_owned_permit_revocation_not_executed","permitRows":qualification_permits(value["plan"])}
        elif phase == "boundary-recovery": result, recovery_receipt = boundary_recovery(value["plan"], value["snapshot"], value["oldDayGrants"], value["now"], value["state"])
        else: fail("unknown_phase")
    if args.emit_owner_sql:
        if args.input is None: fail("public_input_required")
        if phase == "permits": fail("sql_phase")
        selected_plan = result if phase == "admission" else value["plan"] if phase in {"cleanup", "revoke"} else recovery_receipt if phase == "boundary-recovery" else value["receipt"]
        selected_state = {key: value["state"][key] for key in ["ownedPermitsRevoked", "ownedPaidProxyCachesDestroyed", "ownedSourceStopped"]} if phase == "boundary-recovery" else value.get("state")
        print(owner_sql("utc" if phase == "boundary-recovery" else phase, selected_plan, value["snapshot"], selected_state, value.get("now")), end="")
    else: print(json.dumps({"reviewHash": digest(result), "plan": result}, indent=2))


if __name__ == "__main__": main()
