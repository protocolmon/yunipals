#!/usr/bin/env python3
"""Offline ordinary-policy proposal and held-transaction SQL; never executes SQL.

The caller must authenticate the protected receipts and obtain the separate
ordinary authorization. This module is not a runtime admission/route owner.
"""
import copy
import datetime
import hashlib
import json
from pathlib import Path
import re
import types

FORMAT = "yunipals-ypal-alchemy-ordinary-plan-v1"
MODEL_SHA = "703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14"
GLOBAL_CU = 2_000_000
SOURCE_CU = 1_500_000
RESERVE_CU = 200_000
DAY_MS = 86_400_000
PROFILE_EXPIRY = "2026-11-19T18:00:00.000Z"
BINDINGS = {
    "ordinaryAuthorizationSha256", "catchupPreparedSha256", "catchupCloseSha256",
    "sourceDrainedReceiptSha256", "fourFreeRoutesReceiptSha256", "rangeCaptureSha256"
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def model():
    path = Path(__file__).with_name("ypal-alchemy-catchup-financial-v1.model.py")
    raw = path.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == MODEL_SHA, "unchanged_frozen_financial_model_required")
    module = types.ModuleType("ordinary_frozen_financial_model")
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


def milliseconds(value):
    return int(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def exact_without_clock(value):
    return {key: item for key, item in value.items() if key != "clockMs"}


def plan(prepared, closed, current, profile, ranges, bindings):
    """Derive only from the acknowledged old closure; no forced normalization."""
    m = model()
    need(set(bindings) == BINDINGS and all(m.pin(v) for v in bindings.values()),
         "six_actual_receipt_pins_including_separate_ordinary_authorization_required")
    need(digest(prepared) == bindings["catchupPreparedSha256"] and
         digest(closed) == bindings["catchupCloseSha256"] and
         digest(ranges) == bindings["rangeCaptureSha256"], "exact_supplied_receipt_bytes_required")
    need(closed["phase"] == "close" and closed["committed"] is True and
         closed["preparedSha256"] == bindings["catchupPreparedSha256"], "acknowledged_catchup_close_required")
    old = prepared["plan"]
    expected = m.target_closed(prepared["before"], closed["before"], old,
                              utc=closed["before"]["clockMs"] >= old["nextUtcMs"])
    need(exact_without_clock(closed["after"]) == exact_without_clock(expected),
         "actual_original_additive_close_policy_required")
    m.validate_closed(current, closed["after"], old)
    need(m.day(current["clockMs"]) == old["grantDay"],
         "same_catchup_closure_day_required_use_separate_UTC_receipt_after_midnight")
    need(not any(row["enabled"] and row["expiresMs"] > current["clockMs"] for row in current["permits"]),
         "all_prior_paid_permits_must_be_inactive")
    selected = [row for row in current["profiles"] if row["profile_id"] == m.PROFILE]
    need(len(selected) == 1 and selected[0]["enabled"] is True and selected[0]["policy"] == profile and
         selected[0]["manifest_hash"] == m.MANIFEST and
         milliseconds(selected[0]["expires_at"]) == milliseconds(PROFILE_EXPIRY),
         "unchanged_profile_manifest_and_original_profile_expiry_required")
    start, end = current["clockMs"], milliseconds(PROFILE_EXPIRY)
    need(type(start) is int and 3_600_000 <= end - start <= 32 * DAY_MS,
         "finite_existing_profile_horizon_required_no_renewal")
    # Reuse actual enabled deployment minima and the already-reviewed eight-hour
    # range checks. Scaling this finite margin is range permission, not spending.
    rows = m.range_plan(ranges, start, profile)
    need(ranges["format"] == "yunipals-alchemy-catchup-range-input-v1", "same_fixed_four_chain_range_capture_required")
    days = (end - 1) // DAY_MS - start // DAY_MS + 1
    maximum = SOURCE_CU * days
    need(maximum <= 1_000_000_000, "existing_permit_maximum_constraint_required")
    today = m.day(start)
    global_today = next((int(row["grantedCu"]) for row in current["windows"] if row["day"] == today), 0)
    background_today = next((int(row["backgroundCu"]) for row in current["windows"] if row["day"] == today), 0)
    source_today = m.source_booked(current, today)
    need(global_today < GLOBAL_CU and background_today < GLOBAL_CU - RESERVE_CU and source_today < SOURCE_CU,
         "existing_same_day_bookings_leave_actual_ordinary_headroom_required")
    value = {
        "format": FORMAT, "bindings": bindings, "profileId": m.PROFILE,
        "profileFileSha256": m.PROFILE_FILE_SHA, "manifestHash": m.MANIFEST,
        "releaseId": m.RELEASE, "startMs": start, "expiresMs": end,
        "rangeInput": copy.deepcopy(ranges),
        "baselineSha256": digest(exact_without_clock(current)), "baselineDay": today,
        "baselineSourceDayBookedCu": str(source_today),
        "originalClosedGlobalDailyCu": current["global"]["dailyCu"],
        "originalClosedSourceDailyCu": next(row["dailyCu"] for row in current["allocations"] if row["workload"] == "unified_source"),
        "ordinaryPolicy": {"globalDailyCu": str(GLOBAL_CU), "sourceDailyCu": str(SOURCE_CU),
                           "foregroundReserveCu": str(RESERVE_CU)},
        "firstDayCountsExistingCatchupBookings": True, "UTCDateCount": days,
        "maximumPerPermitCu": str(maximum), "independentPerChainDailyAllocation": False,
        "allFourShareOneSourceDailyAllocation": True, "automaticRenewal": False,
        "changesOriginalCatchupExpiry": False, "runtimeAuthorityQualified": False
    }
    seed = digest(value)
    intervals = (end - start + 28_800_000 - 1) // 28_800_000
    value["permits"] = []
    for chain in sorted(rows):
        row = rows[chain]
        through = ranges["chains"][str(chain)]["headBlock"] + m.MARGINS[chain] * intervals
        value["permits"].append({
            "permitId": "0x" + digest({"planSeed": seed, "chainId": chain}),
            "profileId": m.PROFILE, "chainId": chain, "fromBlock": row["fromBlock"],
            "throughBlock": str(through), "maximumCu": str(maximum), "spentCu": "0",
            "enabled": True, "expiresMs": end, "reviewedMs": start
        })
    return value


def validate_proposal(proposal):
    m = model()
    need(proposal["format"] == FORMAT and proposal["profileId"] == m.PROFILE and
         proposal["manifestHash"] == m.MANIFEST and proposal["releaseId"] == m.RELEASE and
         proposal["profileFileSha256"] == m.PROFILE_FILE_SHA and
         proposal["expiresMs"] == milliseconds(PROFILE_EXPIRY) and
         type(proposal["startMs"]) is int and 3_600_000 <= proposal["expiresMs"] - proposal["startMs"] <= 32 * DAY_MS and
         proposal["ordinaryPolicy"] == {"globalDailyCu": str(GLOBAL_CU), "sourceDailyCu": str(SOURCE_CU), "foregroundReserveCu": str(RESERVE_CU)},
         "exact_finite_ordinary_policy_and_unchanged_profile_required")
    need(set(proposal["bindings"]) == BINDINGS and all(m.pin(v) for v in proposal["bindings"].values()) and
         digest(proposal["rangeInput"]) == proposal["bindings"]["rangeCaptureSha256"], "exact_ordinary_bindings_required")
    profile_path = Path(__file__).with_name("ypal-combined-rpc-profile-v1.json")
    raw = profile_path.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == m.PROFILE_FILE_SHA, "pinned_public_profile_bytes_required")
    rows = m.range_plan(proposal["rangeInput"], proposal["startMs"], json.loads(raw))
    days = (proposal["expiresMs"] - 1) // DAY_MS - proposal["startMs"] // DAY_MS + 1
    need(proposal["UTCDateCount"] == days and proposal["maximumPerPermitCu"] == str(SOURCE_CU * days) and
         len(proposal["permits"]) == 4, "one_identical_horizon_cap_per_chain_required")
    seed = digest({k: v for k, v in proposal.items() if k != "permits"})
    intervals = (proposal["expiresMs"] - proposal["startMs"] + 28_800_000 - 1) // 28_800_000
    for p, chain in zip(proposal["permits"], sorted(rows)):
        expected = {"permitId": "0x" + digest({"planSeed": seed, "chainId": chain}), "profileId": m.PROFILE,
                    "chainId": chain, "fromBlock": rows[chain]["fromBlock"],
                    "throughBlock": str(proposal["rangeInput"]["chains"][str(chain)]["headBlock"] + m.MARGINS[chain] * intervals),
                    "maximumCu": str(SOURCE_CU * days), "spentCu": "0", "enabled": True,
                    "expiresMs": proposal["expiresMs"], "reviewedMs": proposal["startMs"]}
        need(p == expected, "exact_derived_four_permits_required")


def expected_admitted(before, proposal):
    validate_proposal(proposal)
    need(digest(exact_without_clock(before)) == proposal["baselineSha256"], "same_exact_closed_baseline_required")
    value = copy.deepcopy(before)
    value["global"]["dailyCu"] = str(GLOBAL_CU)
    for row in value["allocations"]:
        if row["workload"] == "unified_source":
            row["dailyCu"] = str(SOURCE_CU)
    value["permits"] = sorted(value["permits"] + copy.deepcopy(proposal["permits"]), key=lambda row: row["permitId"])
    return value


def validate_current(before, current, proposal, active=True):
    """Full immutable policy/ACL comparison plus nonrefundable durable counters."""
    m = model()
    m.validate_ledger(current)
    need(current["clockMs"] >= proposal["startMs"] and
         (not active or current["clockMs"] < proposal["expiresMs"]), "unexpired_ordinary_profile_horizon_required")
    compare = copy.deepcopy(current)
    for field in ["clockMs", "windows", "workloadWindows"]:
        compare[field] = copy.deepcopy(before[field])
    owned = {row["permitId"]: row for row in proposal["permits"]}
    for row in compare["permits"]:
        if row["permitId"] in owned:
            need(0 <= m.number(row["spentCu"]) <= m.number(owned[row["permitId"]]["maximumCu"]), "bounded_owned_permit_spending_required")
            row["spentCu"] = "0"
    need(compare == expected_admitted(before, proposal), "only_owned_permit_spending_and_budget_bookings_may_change")
    for field, keys in [("windows", ["day"]), ("workloadWindows", ["day", "workload"])]:
        actual = {tuple(row[key] for key in keys): row for row in current[field]}
        for prior in before[field]:
            row = actual.get(tuple(prior[key] for key in keys))
            # This existing allocator retains exactly 31 prior UTC days. Its
            # ordinary housekeeping is not a refund or an unlimited history.
            expired = milliseconds(prior["day"] + "T00:00:00Z") < milliseconds(m.day(current["clockMs"]) + "T00:00:00Z") - 31 * DAY_MS
            need((row is None and expired) or (row is not None and all(int(row[k]) >= int(prior[k]) for k in prior if k not in keys)),
                 "durable_counters_never_refunded_except_existing_31_day_retention")
    prior_days = {row["day"] for row in before["windows"] if row["day"] < proposal["baselineDay"]}
    for row in current["windows"]:
        if row["day"] not in prior_days:
            need(int(row["grantedCu"]) <= GLOBAL_CU and int(row["backgroundCu"]) <= GLOBAL_CU - RESERVE_CU,
                 "one_shared_global_and_foreground_reserve_limit_required")
    for row in current["workloadWindows"]:
        if row["workload"] == "unified_source" and row["day"] >= proposal["baselineDay"]:
            need(int(row["grantedCu"]) <= SOURCE_CU, "one_shared_source_daily_limit_required")
    return True


def inverse_target(before, current, proposal):
    validate_current(before, current, proposal, active=False)
    m = model()
    today = m.day(current["clockMs"])
    same_day = today == proposal["baselineDay"]
    additional = m.source_booked(current, today) - (int(proposal["baselineSourceDayBookedCu"]) if same_day else 0)
    need(additional >= 0, "same_day_ordinary_bookings_must_not_rewind")
    global_base = int(proposal["originalClosedGlobalDailyCu"]) if same_day else 1_000_000
    source_base = int(proposal["originalClosedSourceDailyCu"]) if same_day else 25_000
    value = copy.deepcopy(current)
    # Preserve ordinary spend in the row ceiling, without raising the new daily
    # authorization during inverse. No ledger or spent_cu is rewritten.
    value["global"]["dailyCu"] = str(min(GLOBAL_CU, global_base + additional))
    for row in value["allocations"]:
        if row["workload"] == "unified_source":
            row["dailyCu"] = str(min(SOURCE_CU, source_base + additional))
    for row in value["permits"]:
        if row["permitId"] in {item["permitId"] for item in proposal["permits"]}:
            row["enabled"] = False
    return value


def writes(before, proposal, phase="admit", current=None):
    m = model()
    if phase == "admit":
        target = expected_admitted(before, proposal)
        rows = []
        for p in proposal["permits"]:
            values = [m.literal(p["permitId"]), m.literal(m.PROFILE), str(p["chainId"]), p["fromBlock"], p["throughBlock"], p["maximumCu"], "true",
                      "to_timestamp(" + str(p["expiresMs"]) + "::numeric/1000)", "to_timestamp(" + str(p["reviewedMs"]) + "::numeric/1000)"]
            rows.append("INSERT INTO yunipals_market.unified_rpc_replay_permit(permit_id,profile_id,chain_id,from_block,through_block,maximum_cu,enabled,expires_at,reviewed_at)VALUES(" + ",".join(values) + ");")
    else:
        need(phase == "inverse" and current is not None, "fixed_admit_or_quiet_inverse_phase_required")
        target = inverse_target(before, current, proposal)
        ids = ",".join(m.literal(p["permitId"]) for p in proposal["permits"])
        rows = ["UPDATE yunipals_market.unified_rpc_replay_permit SET enabled=false WHERE permit_id IN(" + ids + ");"]
    source = next(row["dailyCu"] for row in target["allocations"] if row["workload"] == "unified_source")
    rows += ["UPDATE yunipals_market.rpc_compute_budget SET daily_cu=" + target["global"]["dailyCu"] + " WHERE scope='yunipals-opensea';",
             "UPDATE yunipals_market.rpc_compute_allocation SET daily_cu=" + source + " WHERE scope='yunipals-opensea'AND workload='unified_source';"]
    return "\n".join(rows)


def source_environment(proposal):
    """Only four public permit selectors; never a private environment rewrite."""
    validate_proposal(proposal)
    return "".join("UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(row["chainId"]) + "=" + row["permitId"] + "\n"
                   for row in proposal["permits"]).encode()


def held_packet_sql(before, proposal, phase="admit", current=None):
    """Stops with a live XID. Caller must verify, fsync intent, then commit once.

    Reuse the frozen financial Client/kernel_identity/observe/finish protocol.
    This string contains no COMMIT and cannot produce an admission ACK itself.
    """
    m = model()
    snapshot = before if phase == "admit" else current
    expected = expected_admitted(before, proposal) if phase == "admit" else inverse_target(before, current, proposal)
    def assertion(value):
        want = m.literal(json.dumps(exact_without_clock(value), sort_keys=True, separators=(",", ":")))
        return "DO $ordinary$ BEGIN IF (SELECT jsonb_build_object-'clockMs'FROM(" + m.snapshot_sql() + ")q)IS DISTINCT FROM " + want + "::jsonb THEN RAISE EXCEPTION 'ordinary_exact_financial_snapshot_changed';END IF;END $ordinary$;"
    freshness = ("DO $ordinary$ BEGIN IF floor(extract(epoch FROM clock_timestamp())*1000)::bigint NOT BETWEEN " +
                 str(snapshot["clockMs"]) + " AND " + str(snapshot["clockMs"] + 300000) +
                 " THEN RAISE EXCEPTION 'ordinary_fresh_financial_snapshot_required';END IF;END $ordinary$;\n")
    return ("BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='30s';\n"
            "SELECT pg_advisory_xact_lock(hashtextextended('yunipals-unified-paid-backfill:yunipals-opensea',0));\n"
            "LOCK TABLE " + ",".join("yunipals_market." + name for name in m.TABLES) + " IN SHARE ROW EXCLUSIVE MODE;\n" +
            freshness + assertion(snapshot) + "\n" + writes(before, proposal, phase, current) + "\n" + assertion(expected) + "\n" +
            "SELECT jsonb_build_object('xid',pg_current_xact_id()::text,'backendPid',pg_backend_pid(),'backendStart',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()),'transactionHeld',true);\n")


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "sourceOnly": True, "proposalOnly": True,
                      "ordinaryAuthorizationPresent": False, "globalDailyCu": GLOBAL_CU,
                      "sourceDailyCu": SOURCE_CU, "foregroundReserveCu": RESERVE_CU,
                      "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0,
                      "currentCatchupDeadlineUnchanged": True}, sort_keys=True))
