#!/usr/bin/env python3
"""Review/apply one additive Base public-log configuration epoch, same1612.

Only two selected process environment keys are interpreted, and only literal
documented keyless public URLs may leave the process. Private env files are
opaque checksum inputs, never parsed. No source, budget, permit or actor change.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import types

FORMAT = "yunipals-base-tenderly-config-epoch-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
VERIFIER = OPS / "proxy-upgrade-free-fallback-v4.py"
VERIFIER_SHA = "919e952a9d4241bec6252b9cb28aed0a9249b7bb3a59bf71f1943e0ad46f2eca"
F1 = Path("/var/lib/yunipals-unified-shadow/proxy-epochs-v2/20261020-008028af-f1")
F1_REVIEW_SHA = "aeecf2ae04ab5b2d59dec64755eea19b9ee09aad5dde39bb5897a68df2794533"
F1_MONITOR_SHA = "cffd7444a54679248ad00419a6b05e0b98f92623262d3073fae3108f30c8845e"
WITNESS = OPS / "base-tenderly-public-witness-20261021.json"
WITNESS_SHA = "10a37e561b04e981ff20377b19de56a67b314497f2919c8a3d1a43c9c01dcc93"
BASE_PROOF = Path("/var/backups/yunipals-unified-source-fallback-proxies-20261021/base/1b12b2bf63de9c83d5689f7d0adf5c4d66fb49756fd1770fc29f026b9295d523/result.json")
BASE_PROOF_SHA = "949310409a5477dadf9dc5c3adbaf08fa0e5bb5b5e82d7137c4b123fcf0c1e46"
INVENTORY = Path("/var/tmp/yunipals-runtime-1612f7bf-20261021/runtime-supplement.inventory.json")
UNIT = "yunipals-market-production-rpc@base.service"
F1_UNIT = "yunipals-unified-shadow-20261020-008028af-f1.service"
ENVIRONMENT = Path("/etc/yunipals-unified/base-tenderly-20261021.env")
OVERRIDE = Path("/etc/systemd/system") / (UNIT + ".d/zzzzzzzzzz-base-tenderly-20261021.conf")
PROOFS = Path("/var/backups/yunipals-unified-base-tenderly-20261021")
TENDERLY = "https://base.gateway.tenderly.co"
LOG_KEYS = ("MARKET_RPC_PROXY_FREE_LOG_UPSTREAM", "MARKET_RPC_PROXY_FREE_LOG_FAILOVER_UPSTREAMS")
# Literal public endpoints only, not suffix/domain heuristics. Slash spelling
# is retained exactly. Current official sources are named in the runbook.
PUBLIC_URLS = {url + suffix for url in (
    "https://base-rpc.publicnode.com", "https://base.llamarpc.com",
    "https://mainnet.base.org", "https://base.drpc.org",
    "https://public.1rpc.io/base", TENDERLY
) for suffix in ("", "/")}


def fail(message): raise RuntimeError(message)
def encoded(value): return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()


def verifier():
    # Import only frozen public operator code; it has no import-time actions.
    raw = VERIFIER.read_bytes()
    if sha(raw) != VERIFIER_SHA: fail("Frozen proxy verifier changed.")
    module = types.ModuleType("base_tenderly_frozen_verifier"); module.__file__ = str(VERIFIER)
    exec(compile(raw, str(VERIFIER), "exec"), module.__dict__)
    module.safe_file(VERIFIER)
    return module


def pinned_json(v, path, expected, maximum=2_000_000):
    raw = v.safe_file(path, maximum).read_bytes()
    if sha(raw) != expected: fail("Pinned public prerequisite changed.")
    return json.loads(raw)


def prerequisites(v):
    origin = pinned_json(v, F1 / "review.json", F1_REVIEW_SHA)
    raw = v.safe_file(F1 / "monitor.jsonl", 2_000_000).read_bytes()
    if sha(raw) != F1_MONITOR_SHA: fail("Actual F1 monitor changed.")
    rows = [json.loads(row) for row in raw.splitlines()]
    if (len(rows) < 3 or len(rows) > 200 or sha(encoded(origin["binding"])) != origin["reviewHash"] or
            rows[0].get("proxyEpochBinding") != origin["binding"] or rows[-1].get("reason") != "deadline" or
            rows[-1].get("elapsed", 0) < 900 or rows[-1].get("stopError") is not None):
        fail("Exact completed F1 public prerequisite required.")
    witness = pinned_json(v, WITNESS, WITNESS_SHA)
    expected = witness.get("endpoints", [])
    if (witness.get("reviewHash") != "70c3acf64b81475068cd0858511d255ef72f21f087334e53a1d99234d5127961" or
            witness.get("logicalRpc") != 2 or witness.get("configurationOrSourceChanged") is not False or
            len(expected) != 1 or expected[0].get("endpoint") != TENDERLY or
            [row.get("rpcSucceeded") for row in expected[0].get("requests", [])] != [True, True]):
        fail("Exact separately completed Tenderly availability witness required.")
    proof = pinned_json(v, BASE_PROOF, BASE_PROOF_SHA)
    before = proof["review"]
    hashes = {**before["originalDefinitionHashes"], proof["overridePath"]: proof["overrideSha256"]}
    states = origin["binding"]["epoch"]["legacyUnits"]
    if (proof.get("applied") is not True or proof["afterInvocationId"] != states[UNIT]["InvocationID"] or
            rows[-1]["after"]["legacyUnits"] != states): fail("F1 Base original proof/state changed.")
    return {"origin": origin, "states": states, "baseProof": proof, "definitionHashes": hashes,
            "privateSettings": before["privateSettings"], "f1Invocation": rows[0]["invocation"]}


def log_settings(raw):
    """Ignore every other environment entry without decoding or exporting it."""
    if len(raw) > 2_000_000: fail("Selected process environment exceeds inspection cap.")
    selected = {}
    keys = {key.encode(): key for key in LOG_KEYS}
    for entry in raw.split(b"\0"):
        key, sep, value = entry.partition(b"=")
        if key not in keys: continue
        if not sep or keys[key] in selected: fail("Selected public log setting missing or duplicated.")
        try: selected[keys[key]] = value.decode("ascii")
        except UnicodeError: fail("Selected log configuration is not a known public URL.")
    # Missing fallback is the reader's exact empty-list default. Missing primary
    # would inherit primary URLs; those are outside the two-key authorization.
    if LOG_KEYS[0] not in selected: fail("Explicit existing public log primary required.")
    selected.setdefault(LOG_KEYS[1], "")
    urls = [selected[LOG_KEYS[0]], *([] if not selected[LOG_KEYS[1]] else selected[LOG_KEYS[1]].split(","))]
    if any(url not in PUBLIC_URLS for url in urls) or len(urls) > 8:
        fail("Existing log configuration is not wholly literal approved public URLs; values withheld.")
    if len({url.rstrip("/") for url in urls}) != len(urls): fail("Existing public log pool has duplicates.")
    return selected


def read_process_logs(v, props):
    # PID and invocation are checked on both sides; never inspect another unit.
    if props != v.state(UNIT): fail("Base process changed before selected-key inspection.")
    path = Path("/proc") / props["MainPID"] / "environ"
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(descriptor, "rb") as handle: raw = handle.read(2_000_001)
    except Exception: fail("Selected Base process settings unavailable; diagnostics withheld.")
    value = log_settings(raw)
    if props != v.state(UNIT): fail("Base process changed during selected-key inspection.")
    return value


def new_settings(old):
    urls = [old[LOG_KEYS[0]], *([] if not old[LOG_KEYS[1]] else old[LOG_KEYS[1]].split(","))]
    if any(url.rstrip("/") == TENDERLY for url in urls): fail("Tenderly already selected; no repeat epoch permitted.")
    return {LOG_KEYS[0]: TENDERLY, LOG_KEYS[1]: ",".join(urls)}


def env_content(value): return "".join(key + "=" + value[key] + "\n" for key in LOG_KEYS)
def override_content(): return "[Service]\nEnvironmentFile=" + str(ENVIRONMENT) + "\n"


def file_selectors(props):
    entries = props.get("EnvironmentFilesEntries", [props["EnvironmentFiles"]]); rows = []
    for entry in entries:
        pieces = re.findall(r"([^ ;]+) \(ignore_errors=(yes|no)\)", entry)
        if " ".join(path + " (ignore_errors=" + optional + ")" for path, optional in pieces) != entry:
            fail("Unsupported original EnvironmentFile selector.")
        rows.extend(pieces)
    return rows


def environment_hashes(v, props, *, exclude_public=False):
    rows = []
    for path, optional in file_selectors(props):
        if exclude_public and path == str(ENVIRONMENT): continue
        item = Path(path)
        if not item.exists() and optional == "yes": rows.append({"path": path, "optional": True, "exists": False}); continue
        # Opaque checksum only: no private EnvironmentFile key/value parsing.
        rows.append({"path": path, "optional": optional == "yes", "exists": True, "sha256": v.digest(v.safe_file(item, 2_000_000))})
    return rows


def stopped_f1(v, expected):
    raw = v.run(["systemctl", "show", F1_UNIT, "--property=ActiveState", "--property=InvocationID"], timeout=5)
    value = dict(row.split("=", 1) for row in raw.splitlines())
    if value.get("InvocationID") != expected or value.get("ActiveState") not in {"inactive", "failed"}:
        fail("F1 source must remain stopped with its original invocation.")


def others(v, states):
    result = {}
    for name in ("ethereum", "polygon", "bnb"):
        unit = "yunipals-market-production-rpc@" + name + ".service"; props = v.state(unit); v.verify_exec_start(props)
        if props["InvocationID"] != states[unit]["InvocationID"]: fail("Another proxy invocation changed.")
        result[unit] = {"invocationId": props["InvocationID"], "definitionHashes": v.definitions(props), "privateSettings": v.private_settings(props)}
    return result


def configuration(v, *, live_chain=False):
    if live_chain: return v.legacy_health(19202, 8453)
    if v.request(19202, "/health").get("status") != "ready": fail("Base local proxy health failed.")
    metrics = v.request(19202, "/metrics")
    return {key: metrics[key] for key in v.CONFIG_KEYS}


def free_metrics(v):
    value = v.request(19202, "/metrics")
    if value.get("unified", {}).get("profileId") != v.PROFILE_ID or value["unified"].get("chainId") != 8453:
        fail("Base unified profile changed.")
    for name in ("unified_source", "unified_evidence"):
        traffic = value["unified"]["traffic"][name]
        if traffic["paidCalls"] != 0 or traffic["refused"] != 0: fail("Isolated paid/refused counters must remain zero.")
    return {name: len(value["freeEndpoints"][name]) for name in ("primary", "logs", "orderProjection", "saleReplay")}


def review():
    v = verifier(); required = prerequisites(v)
    if ENVIRONMENT.exists() or ENVIRONMENT.is_symlink() or OVERRIDE.exists() or OVERRIDE.is_symlink():
        fail("Fresh public configuration paths required; prior attempts never overwritten.")
    v.safe_file(OVERRIDE.parent / v.OVERRIDE_NAME)
    runtime = v.verify_runtime(INVENTORY); policy = v.approved_policy(); props = v.state(UNIT); v.verify_exec_start(props)
    if runtime != required["origin"]["binding"]["epoch"]["proxyRuntime"]: fail("Same exact F1 proxy runtime required.")
    definitions = v.definitions(props)
    if (props["InvocationID"] != required["states"][UNIT]["InvocationID"] or definitions != required["definitionHashes"] or
            v.private_settings(props) != required["privateSettings"] or any(Path(path).name >= OVERRIDE.name for path in list(definitions)[1:])):
        fail("Original F1 Base invocation/definitions/settings changed.")
    stopped_f1(v, required["f1Invocation"])
    old = read_process_logs(v, props); selected = new_settings(old); config = configuration(v, live_chain=True); pools = free_metrics(v)
    if config != required["baseProof"]["review"]["legacyConfiguration"]: fail("F1 legacy proxy configuration changed.")
    if config["freeSourceMinimumIntervalMs"] < 400 or config["maximumConcurrentUpstreamRequests"] > 8:
        fail("Existing pacing/concurrency exceeds reviewed bounds.")
    if pools["logs"] != len(selected[LOG_KEYS[1]].split(",")): fail("Effective old public pool count differs from runtime.")
    value = {"format": FORMAT, "helperSha256": sha(Path(__file__).read_bytes()), "verifierSha256": VERIFIER_SHA,
        "unit": UNIT, "chainId": 8453, "beforeRuntime": runtime, "afterRuntime": runtime,
        "profile": policy, "profileId": v.PROFILE_ID, "f1ReviewSha256": F1_REVIEW_SHA, "f1MonitorSha256": F1_MONITOR_SHA,
        "witnessSha256": WITNESS_SHA, "f1Invocation": required["f1Invocation"], "beforeInvocationId": props["InvocationID"],
        "beforeMainPid": props["MainPID"], "originalDefinitionHashes": definitions, "privateSettingsBefore": v.private_settings(props),
        "originalEnvironmentFileHashes": environment_hashes(v, props), "otherProxies": others(v, required["states"]),
        "legacyConfiguration": config, "poolCountsBefore": pools, "oldPublicLogSettings": old, "newPublicLogSettings": selected,
        "overridePath": str(OVERRIDE), "override": override_content(), "overrideSha256": sha(override_content().encode()),
        "publicEnvironmentPath": str(ENVIRONMENT), "publicEnvironment": env_content(selected), "publicEnvironmentSha256": sha(env_content(selected).encode()),
        "expectedRoutingDelta": "Tenderly prepended to shared Base legacy-log/sale/unified-source-log pools; all existing log and primary URLs retained in order.",
        "providerLimits": {"logResultsPerQuery": 3000, "dailyResponseDataPerIp": "1 GB", "localDailyByteAccounting": False},
        "sourceSelectionChanged": False, "newPermits": False, "profileOrCapsChanged": False, "ingestorStarted": False}
    return {"reviewHash": sha(encoded(value)), "review": value, "applied": False}


def check_current(v, value, *, applied, expected_invocation=None, live_chain=False):
    props = v.state(UNIT); v.verify_exec_start(props)
    if expected_invocation is not None and props["InvocationID"] != expected_invocation: fail("Base invocation changed.")
    hashes = v.definitions(props)
    expected = {**value["originalDefinitionHashes"], **({value["overridePath"]: value["overrideSha256"]} if applied else {})}
    private = v.private_settings(props); original = value["privateSettingsBefore"]
    expected_selectors = original["orderedEnvironmentFiles"] + ([str(ENVIRONMENT) + " (ignore_errors=no)"] if applied else [])
    if hashes != expected or private != {**original, "orderedEnvironmentFiles": expected_selectors}:
        fail("Original definitions/private settings/selectors were not preserved.")
    if applied and v.safe_file(ENVIRONMENT, 20000).read_bytes() != value["publicEnvironment"].encode():
        fail("Owned public EnvironmentFile changed.")
    if environment_hashes(v, props, exclude_public=applied) != value["originalEnvironmentFileHashes"]:
        fail("Original private EnvironmentFile content hashes changed.")
    if read_process_logs(v, props) != value["newPublicLogSettings" if applied else "oldPublicLogSettings"]:
        fail("Effective approved public log settings differ.")
    if configuration(v, live_chain=live_chain) != value["legacyConfiguration"]: fail("Unrelated proxy configuration changed.")
    pools = free_metrics(v); expected_pools = dict(value["poolCountsBefore"])
    if applied:
        expected_pools["logs"] += 1; expected_pools["saleReplay"] += 1
    if pools != expected_pools: fail("Unexpected provider pool change.")
    required = prerequisites(v)
    if others(v, required["states"]) != value["otherProxies"]: fail("Another proxy configuration changed.")
    stopped_f1(v, value["f1Invocation"])
    if v.digest(v.PROFILE) != v.PROFILE_SHA or v.digest(v.ROOT / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs") != v.PROXY_SHA:
        fail("Current fixed profile/proxy bytes changed.")
    return props, private, hashes


def validate_applied(directory, expected_before_invocation, *, live_chain=False):
    v = verifier(); directory = Path(directory)
    if directory.parent != PROOFS or not re.fullmatch(r"[0-9a-f]{64}", directory.name): fail("Exact retained Base proof directory required.")
    raw = v.safe_file(directory / "review.json", 2_000_000).read_bytes(); value = json.loads(raw)
    result = json.loads(v.safe_file(directory / "result.json", 3_000_000).read_bytes())
    if (sha(raw) != directory.name or sha(encoded(value)) != directory.name or value.get("format") != FORMAT or
            value.get("helperSha256") != sha(Path(__file__).read_bytes()) or result.get("reviewHash") != directory.name or
            result.get("review") != value or result.get("applied") is not True or value["beforeInvocationId"] != expected_before_invocation or
            result.get("afterInvocationId") == expected_before_invocation):
        fail("Saved Base applied proof identity changed.")
    if (value["unit"] != UNIT or value["chainId"] != 8453 or value["overridePath"] != str(OVERRIDE) or
            value["publicEnvironmentPath"] != str(ENVIRONMENT) or value["override"] != override_content() or
            value["newPublicLogSettings"] != new_settings(value["oldPublicLogSettings"]) or
            value["publicEnvironment"] != env_content(value["newPublicLogSettings"]) or
            value["beforeRuntime"] != value["afterRuntime"] or result["beforeRuntime"] != value["beforeRuntime"] or
            result["afterRuntime"] != value["afterRuntime"]): fail("Saved public epoch semantics changed.")
    for path, field in ((OVERRIDE, "override"), (ENVIRONMENT, "publicEnvironment")):
        if v.safe_file(path, 20000).read_bytes() != value[field].encode(): fail("Owned public configuration changed.")
    props, private, hashes = check_current(v, value, applied=True, expected_invocation=result["afterInvocationId"], live_chain=live_chain)
    if props["MainPID"] != result["afterMainPid"]: fail("Base process identity changed.")
    return {"format": FORMAT, "proofDirectory": str(directory), "reviewHash": directory.name, "reviewSha256": sha(raw),
        "resultSha256": v.digest(directory / "result.json"), "beforeRuntime": value["beforeRuntime"], "afterRuntime": value["afterRuntime"],
        "beforeInvocationId": value["beforeInvocationId"], "afterInvocationId": props["InvocationID"],
        "overridePath": str(OVERRIDE), "overrideSha256": value["overrideSha256"],
        "publicEnvironmentPath": str(ENVIRONMENT), "publicEnvironmentSha256": value["publicEnvironmentSha256"],
        "definitionsAfter": hashes, "originalDefinitionHashes": value["originalDefinitionHashes"],
        "privateSettingsBefore": value["privateSettingsBefore"], "privateSettingsAfter": private,
        "originalEnvironmentFileHashes": value["originalEnvironmentFileHashes"], "legacyConfiguration": value["legacyConfiguration"],
        "oldPublicLogSettings": value["oldPublicLogSettings"], "newPublicLogSettings": value["newPublicLogSettings"],
        "expectedRoutingDelta": value["expectedRoutingDelta"], "providerLimits": value["providerLimits"]}


def apply(reviewed, expected):
    v = verifier(); value = reviewed["review"]
    if expected != reviewed["reviewHash"] or sha(encoded(value)) != expected: fail("Exact current review hash required.")
    v.verify_runtime(INVENTORY); v.approved_policy()
    if PROOFS.exists():
        info = PROOFS.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077: fail("Protected proof parent required.")
    else: PROOFS.mkdir(mode=0o700)
    proof = PROOFS / expected; proof.mkdir(mode=0o700, exist_ok=False); v.save_new(proof / "review.json", encoded(value))
    installed = []; phase = "race_check"
    try:
        check_current(v, value, applied=False, expected_invocation=value["beforeInvocationId"])
        phase = "public_environment_install"; v.save_new(ENVIRONMENT, value["publicEnvironment"].encode(), 0o644); installed.append(ENVIRONMENT)
        phase = "public_dropin_install"; v.save_new(OVERRIDE, value["override"].encode(), 0o644); installed.append(OVERRIDE)
        phase = "restart"; v.run(["systemctl", "daemon-reload"]); v.run(["systemctl", "restart", UNIT], timeout=150)
        phase = "postcheck"; props, private, hashes = v.retry(lambda: check_current(v, value, applied=True, live_chain=True))
        if props["InvocationID"] == value["beforeInvocationId"]: fail("Base restart did not select a fresh invocation.")
        v.unified_preflight(19202, 8453)
        phase = "final_local_recheck"
        props, private, hashes = check_current(v, value, applied=True, expected_invocation=props["InvocationID"])
        result = {"generatedAt": datetime.now(timezone.utc).isoformat(), "applied": True, "format": FORMAT, "reviewHash": expected, "review": value,
            "proofDirectory": str(proof), "beforeRuntime": value["beforeRuntime"], "afterRuntime": value["afterRuntime"],
            "beforeInvocationId": value["beforeInvocationId"], "afterInvocationId": props["InvocationID"], "afterMainPid": props["MainPID"],
            "definitionsAfter": hashes, "privateSettingsAfter": private, "originalPrivateEnvironmentFilesPreserved": True,
            "newPublicEnvironmentFileAppended": True, "legacyLogRoutingChangedAsReviewed": True,
            "unrelatedConfigurationPreserved": True, "sourceSelectionChanged": False, "newPermits": False, "ingestorStarted": False}
        output = json.dumps(result, indent=2) + "\n"; v.save_new(proof / "result.json", output.encode()); return output
    except Exception as error:
        failed = {"phase": phase, "errorType": type(error).__name__, "rollbackAttempted": False, "rollbackSucceeded": False}
        expected_bytes = {ENVIRONMENT: value["publicEnvironment"].encode(), OVERRIDE: value["override"].encode()}
        # Never remove another operator's file, nor leave a selected drop-in
        # pointing at a deleted environment file after a concurrent change.
        if installed and all(path.is_file() and not path.is_symlink() and path.read_bytes() == expected_bytes[path] for path in installed):
            failed["rollbackAttempted"] = True
            try:
                for path in reversed(installed): path.unlink()
                v.run(["systemctl", "daemon-reload"]); v.run(["systemctl", "restart", UNIT], timeout=150)
                v.retry(lambda: check_current(v, value, applied=False, live_chain=True)); failed["rollbackSucceeded"] = True
            except Exception as rollback: failed["rollbackErrorType"] = type(rollback).__name__
        v.save_new(proof / "failed-check.json", encoded(failed)); fail("Base config epoch failed; protected partials/rollback evidence retained.")


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--apply"); args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main": fail("Exact root/host required.")
    v = verifier()
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply): fail("Exact review hash required.")
        with v.chain_lock("base"):
            reviewed = review(); print(apply(reviewed, args.apply), end="")
    else: print(json.dumps(review(), indent=2))


if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"applied": False, "errorType": type(error).__name__, "privateDiagnosticsWithheld": True})); raise SystemExit(1)
