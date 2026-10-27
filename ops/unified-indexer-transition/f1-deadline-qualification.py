#!/usr/bin/env python3
"""Qualify only the immutable F1 timeout/shutdown race; never change its reports."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

REVIEW_SHA = "aeecf2ae04ab5b2d59dec64755eea19b9ee09aad5dde39bb5897a68df2794533"
MONITOR_SHA = "cffd7444a54679248ad00419a6b05e0b98f92623262d3073fae3108f30c8845e"
WITNESS_SHA = "754d15a241dcad4199c1ce304435fc21b9b2b58f28ebb1aba2fd136a22fbcf8f"
EPOCH_SHA = "d4013f4025d2b49c32cc561c3e673c119fb3ac47529d75c7009b55c962d49961"
UNIT = "yunipals-unified-shadow-20261020-008028af-f1.service"
INVOCATION = "3c40db428297466babcfd8a341114f1f"
NATIVE = "bf4939b3ff"
FORMAT = "yunipals-explicit-f1-timed-out-deactivating-qualification-v1"


def fail(message):
    raise RuntimeError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def positions(metrics):
    result = {}
    for row in metrics["checkpoints"]:
        chain = str(row["chain"])
        if chain not in {"1", "56", "137", "8453"}:
            fail("F1 checkpoint chain differs.")
        for key in ["latest", "safe", "finalized"]:
            value = row[key]
            if not re.fullmatch(r"[0-9]{1,100}", str(value)) or (chain, key) in result:
                fail("Exact nonduplicate F1 native checkpoints required.")
            result[(chain, key)] = int(value)
    if len(result) != 12:
        fail("All four F1 native chains required.")
    return result


def qualify_data(origin, rows, witness):
    """Pure validation; callers additionally pin all three raw immutable files."""
    if not isinstance(rows, list) or len(rows) < 3 or len(rows) > 1000:
        fail("Bounded complete F1 monitor required.")
    first, last = rows[0], rows[-1]
    samples = rows[1:-1]
    binding = origin["binding"]
    epoch = binding["epoch"]
    if (first.get("event") != "started" or last.get("event") != "stopped" or
            any(row.get("event") != "sample" for row in samples) or
            digest(encoded(binding)) != origin.get("reviewHash") or
            first.get("reviewHash") != origin["reviewHash"] or first.get("proxyEpochBinding") != binding or
            binding.get("helperSha256") != EPOCH_SHA or binding["plan"]["runId"] != "20261020-008028af-f1" or
            binding["plan"]["mode"] != "epoch" or first.get("unit") != UNIT or first.get("invocation") != INVOCATION or
            first.get("limits") != epoch.get("limits") or first["limits"].get("seconds") != 900 or
            first.get("baselineLegacyUnits") != epoch.get("legacyUnits") or
            first.get("baselineActiveSelector") != epoch.get("activeSelector") or
            first.get("baselineMetrics") != origin.get("metrics") or
            first["baselineMetrics"].get("runtime") != binding.get("previousRuntime") or
            first["baselineMetrics"].get("checkpoints") != binding.get("previousCheckpoints") or
            binding.get("legacyUnits") != epoch.get("legacyUnits") or binding.get("activeSelector") != epoch.get("activeSelector")):
        fail("F1 saved review/monitor/origin/source/limits differ.")
    own = samples[-1]["own"]
    if (last.get("reason") != "deadline" or type(last.get("elapsed")) not in {int, float} or last["elapsed"] < 900 or
            last.get("stopError") is not None or last.get("runtimeExpiryEvidence") is not None or
            type(samples[-1].get("elapsed")) not in {int, float} or samples[-1]["elapsed"] < 900 or
            last["elapsed"] < samples[-1]["elapsed"] or own.get("Id") != UNIT or own.get("InvocationID") != INVOCATION or
            own.get("ActiveState") != "deactivating" or own.get("SubState") != "stop-sigterm" or
            own.get("Result") != "timeout" or own.get("ExecMainStatus") != "0" or
            last.get("retainedWorkspace") != binding.get("epoch", {}).get("workspace") or
            last.get("retainedSchema") != "unified_shadow_20261020_7e7375b0"):
        fail("Only the actual timed-out deactivating F1 race is supported.")
    props = witness.get("properties", {})
    if (witness.get("format") != "yunipals-f1-terminal-systemd-witness-v1" or witness.get("unit") != UNIT or
            witness.get("invocation") != INVOCATION or witness.get("canonicalReviewSha256") != REVIEW_SHA or
            witness.get("canonicalMonitorSha256") != MONITOR_SHA or witness.get("oldD401LineageAccepted") is not False or
            witness.get("originalReportModified") is not False or props.get("Id") != UNIT or props.get("InvocationID") != INVOCATION or
            props.get("LoadState") != "loaded" or props.get("Result") != "timeout" or props.get("ExecMainStatus") != "0" or
            props.get("ActiveState") != "failed" or props.get("SubState") != "failed" or
            props.get("RuntimeMaxUSec") != "15min" or props.get("TimeoutStopUSec") != "30s" or
            not re.fullmatch(r"[0-9a-f]{64}", str(witness.get("rawPropertiesSha256")))):
        fail("Exact separately captured terminal F1 witness required.")
    for key in ["ExecMainStartTimestampMonotonic", "ExecMainExitTimestampMonotonic", "ActiveEnterTimestampMonotonic", "InactiveEnterTimestampMonotonic"]:
        if not re.fullmatch(r"[0-9]{1,20}", str(props.get(key))):
            fail("Actual F1 monotonic process timestamps required.")
    start, end = int(props["ExecMainStartTimestampMonotonic"]), int(props["ExecMainExitTimestampMonotonic"])
    lifetime = end - start
    if (start <= 0 or lifetime < 900_000_000 or type(witness.get("actualMainLifetimeMicroseconds")) is not int or
            witness["actualMainLifetimeMicroseconds"] != lifetime or lifetime > last["elapsed"] * 1_000_000 or
            int(props["InactiveEnterTimestampMonotonic"]) < end or int(props["ActiveEnterTimestampMonotonic"]) < start):
        fail("F1 must have an actual main-process lifetime of at least900 seconds.")
    previous = positions(first["baselineMetrics"])
    initial = dict(previous)
    elapsed = -1
    for index, row in enumerate([*samples, last["after"]]):
        if index < len(samples):
            if type(row.get("elapsed")) not in {int, float} or row["elapsed"] < elapsed:
                fail("F1 elapsed samples regress.")
            elapsed = row["elapsed"]
            if row["own"].get("InvocationID") != INVOCATION:
                fail("F1 source invocation changed.")
        if row.get("legacyUnits") != epoch["legacyUnits"] or row.get("activeSelector") != epoch["activeSelector"]:
            fail("F1 legacy services or source selector changed.")
        if row["metrics"]["runtime"].get("buildId") != NATIVE:
            fail("F1 native build changed.")
        for chain in ["1", "56", "137", "8453"]:
            for workload in ["unified_source", "unified_evidence"]:
                traffic = row["proxies"][chain]["unified"]["traffic"][workload]
                if any(type(traffic.get(k)) is not int or traffic[k] != 0 for k in ["paidCalls", "refused"]):
                    fail("F1 contains isolated paid or refused traffic.")
        current = positions(row["metrics"])
        if any(current[k] < previous[k] for k in previous):
            fail("F1 native checkpoints regress.")
        previous = current
    if previous[("56", "latest")] <= initial[("56", "latest")]:
        fail("F1 lacks actual BNB historical progress.")
    return {"format": FORMAT, "qualification": "actual_900s_timer_shutdown_race", "qualifiedByNewExplicitRule": True,
        "oldD401LineageAccepted": False, "originalReportModified": False, "unit": UNIT, "invocation": INVOCATION,
        "mainLifetimeMicroseconds": lifetime, "controllerElapsedSeconds": last["elapsed"],
        "lastSampleElapsedSeconds": samples[-1]["elapsed"], "lastSampleState": {k: own[k] for k in ["ActiveState", "SubState", "Result"]},
        "terminalState": {k: props[k] for k in ["ActiveState", "SubState", "Result", "ExecMainStatus"]},
        "originalReviewHash": origin["reviewHash"], "originalEpochSha256": digest(encoded(epoch)),
        "noPaidOrRefusedCalls": True, "monotonicNativeProgress": True, "countedAsPersistentRuntime": False,
        "automaticRetryAllowed": False, "runtimeExpiryEvidenceInvented": False}


def qualify(review_raw, monitor_raw, witness_raw):
    if tuple(map(digest, [review_raw, monitor_raw, witness_raw])) != (REVIEW_SHA, MONITOR_SHA, WITNESS_SHA):
        fail("Exact unchanged canonical F1 review/monitor and terminal witness required.")
    value = qualify_data(json.loads(review_raw), [json.loads(line) for line in monitor_raw.splitlines() if line.strip()], json.loads(witness_raw))
    return {**value, "canonicalReviewSha256": REVIEW_SHA, "canonicalMonitorSha256": MONITOR_SHA, "terminalWitnessSha256": WITNESS_SHA}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--monitor", type=Path, required=True)
    parser.add_argument("--terminal-witness", type=Path, required=True)
    args = parser.parse_args()
    caps = [(args.review, 100_000), (args.monitor, 2_000_000), (args.terminal_witness, 4096)]
    if any(not p.is_file() or p.stat().st_size > cap for p, cap in caps):
        fail("Bounded immutable F1 input files required.")
    print(json.dumps(qualify(*(p.read_bytes() for p, _ in caps)), sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
