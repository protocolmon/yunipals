#!/usr/bin/env python3
"""Bounded same-source continuation across an explicitly proven proxy epoch.

The immutable008 Ponder workspace/schema/build are retained. This external
controller neither installs artifacts/proxies nor changes selectors or grants.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import time
import types
import urllib.request

PARENT_HELPER_SHA = "839dda2c9f6320e01fa561a88c31ae65aeb97ea1573cd8b102d3feb9de620310"
CONTINUATION_SHA = "183be3a3b99aaead6f2c20a5a195ba5460724e237092318a4c7ccff9727934e9"
APPROVED_PROXY_SOURCE = "1612f7bf2efa6dae57debccf670a5072aa6369b4bd1faf96796da8fb28fb242b"
SOURCE = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
NATIVE = "bf4939b3ff"
MANIFEST = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029"
ORIGINAL_CACHE = 531472384
FORMAT = "yunipals-bounded-shadow-proxy-epoch-v2"
PROOF_BASE = Path("/var/backups/yunipals-unified-source-fallback-proxies-20261021")
OVERRIDE = "zzzzzzzzz-unified-source-fallback-20261021.conf"
PREVIOUS_OVERRIDE = "zzzzzzzz-unified-log-route-20261021.conf"
RUNTIME_FILE = "apps/yunipals-market-api/src/rpcBudgetProxy.ts"
DIST_FILES = {"apps/yunipals-market-api/dist/rpc-budget-proxy.mjs", "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs.map"}
PLAN_KEYS = {"format", "runId", "freeOnly", "mode", "continuationHelper", "continuationPlanFile", "c1MonitorFile",
             "previousMonitorFile", "originReviewFile", "originMonitorFile", "proxyArtifact", "proxyHelper", "proxyHelperSha256",
             "proxyProofDirectories", "legacyRebaseFile", "legacyRebaseSha256", "dependencyRebaseFile", "dependencyRebaseSha256", "priorEpoch"}
PRIOR_KEYS = {"helper", "helperSha256", "originReviewFile", "originReviewSha256", "originMonitorFile", "originMonitorSha256", "latestMonitorFile", "latestMonitorSha256", "manualException"}
ARTIFACT_KEYS = {"sourceRoot", "sourceDigest", "sourceManifestSha256", "inventoryFile", "inventorySha256", "cleanEvidenceFile", "cleanEvidenceSha256"}
CHAIN_NAMES = {"1": "ethereum", "8453": "base", "137": "polygon", "56": "bnb"}
LOCK = Path("/run/lock/yunipals-unified-shadow.lock")
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}


def fail(message):
    raise RuntimeError(message)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return digest(encoded(value))


def trusted(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute(): fail("Absolute protected operator input required.")
    for item in [*path.parents, path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not (stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX)):
            fail("Operator input ancestry is redirected or writable.")
    if not path.is_file() or path.stat().st_size > maximum: fail("Bounded regular operator input required.")
    return path.read_bytes()


def load_module(path, checksum, name):
    raw = trusted(path)
    if not re.fullmatch(r"[0-9a-f]{64}", checksum) or digest(raw) != checksum: fail("Operator helper pin differs.")
    result = types.ModuleType(name); result.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), result.__dict__)
    return result


def validate_plan(plan):
    if (set(plan) != PLAN_KEYS or plan["format"] != FORMAT or plan["freeOnly"] is not True or plan["mode"] not in {"epoch", "continue"} or
            not re.fullmatch(r"20261020-008028af-[a-z0-9]{1,16}", plan["runId"]) or set(plan["proxyArtifact"]) != ARTIFACT_KEYS or
            set(plan["proxyProofDirectories"]) != set(CHAIN_NAMES)):
        fail("Exact free-only proxy-epoch plan required.")
    validate_prior_plan(plan["priorEpoch"])
    for key in ["proxyHelperSha256", "legacyRebaseSha256", "dependencyRebaseSha256"]:
        if not isinstance(plan[key], str) or not re.fullmatch(r"[0-9a-f]{64}", plan[key]): fail("Exact public evidence hashes required.")
    artifact = plan["proxyArtifact"]
    for key in ["sourceDigest", "sourceManifestSha256", "inventorySha256", "cleanEvidenceSha256"]:
        if not re.fullmatch(r"[0-9a-f]{64}", artifact[key]): fail("Exact proxy artifact hashes required.")
    if artifact["sourceDigest"] != APPROVED_PROXY_SOURCE or artifact["sourceRoot"] != "/opt/yunipals-unified/releases/" + artifact["sourceDigest"]:
        fail("New proxy artifact must have a separate exact immutable release root.")
    paths = [plan[key] for key in ["continuationHelper", "continuationPlanFile", "c1MonitorFile", "previousMonitorFile", "proxyHelper", "legacyRebaseFile", "dependencyRebaseFile"]]
    paths += [artifact[key] for key in ["sourceRoot", "inventoryFile", "cleanEvidenceFile"]]
    for key in ["originReviewFile", "originMonitorFile"]:
        value = plan[key]
        if plan["mode"] == "epoch" and value is not None: fail("First epoch must establish its own origin.")
        if plan["mode"] == "continue": paths.append(value)
    if any(not isinstance(path, str) or not Path(path).is_absolute() or ".." in Path(path).parts for path in paths):
        fail("Protected absolute evidence paths required.")
    for chain, value in plan["proxyProofDirectories"].items():
        path = Path(value)
        if path.parent != PROOF_BASE / CHAIN_NAMES[chain] or not re.fullmatch(r"[0-9a-f]{64}", path.name): fail("Exact applied proxy proof directory required.")
    if plan["mode"] == "epoch" and plan["previousMonitorFile"] != plan["priorEpoch"]["latestMonitorFile"]:
        fail("A new proxy epoch must follow the exact saved parent E1 monitor.")


def validate_prior_plan(prior):
    if not isinstance(prior, dict) or set(prior) != PRIOR_KEYS or prior["helperSha256"] != PARENT_HELPER_SHA:
        fail("Exact pinned saved-parent epoch inputs required.")
    for name in ["helper", "originReviewFile", "originMonitorFile", "latestMonitorFile"]:
        if not isinstance(prior[name], str) or not Path(prior[name]).is_absolute() or ".." in Path(prior[name]).parts:
            fail("Absolute saved-parent evidence paths required.")
    for name in ["originReviewSha256", "originMonitorSha256", "latestMonitorSha256"]:
        if not isinstance(prior[name], str) or not re.fullmatch(r"[0-9a-f]{64}", prior[name]): fail("Saved-parent evidence hashes required.")
    if (prior["originMonitorFile"] != prior["latestMonitorFile"] or prior["originMonitorSha256"] != prior["latestMonitorSha256"]):
        fail("This manual transition supports only the exact first E1 parent, without hidden ancestry.")
    exception = prior["manualException"]
    if exception is not None:
        if (not isinstance(exception, dict) or set(exception) != {"kind", "diagnosisFile", "diagnosisSha256"} or
                exception["kind"] != "diagnosed_native_tempfail75" or not isinstance(exception["diagnosisFile"], str) or
                not Path(exception["diagnosisFile"]).is_absolute() or ".." in Path(exception["diagnosisFile"]).parts or
                not re.fullmatch(r"[0-9a-f]{64}", exception["diagnosisSha256"])):
            fail("Failed E1 requires an exact separately pinned manual diagnosis.")


def prior_file_pins(prior):
    result = {}
    for path_key, sha_key in [("helper", "helperSha256"), ("originReviewFile", "originReviewSha256"),
                              ("originMonitorFile", "originMonitorSha256"), ("latestMonitorFile", "latestMonitorSha256")]:
        actual = digest(trusted(prior[path_key]))
        if actual != prior[sha_key]: fail("Saved parent E1 helper/review/monitor pin changed.")
        result[prior[path_key]] = actual
    if prior["manualException"] is not None:
        exception = prior["manualException"]; actual = digest(trusted(exception["diagnosisFile"], 32768))
        if actual != exception["diagnosisSha256"]: fail("Saved parent diagnosis changed.")
        result[exception["diagnosisFile"]] = actual
    return result


def saved_proxy_proofs(parent_plan, ctx, parent_epoch, artifact, report):
    """Re-derive retained applied proofs without querying historical live IDs."""
    before_runtime = {"sourceRoot": str(ctx.candidate.SOURCE), "sourceDigest": SOURCE,
        "sourceArchiveSha256": ctx.clean["source"]["archiveSha256"],
        "runtimeInventoryPath": ctx.transition_plan["candidate"]["inventoryFile"],
        "runtimeInventorySha256": ctx.transition_plan["candidate"]["inventorySha256"],
        "runtimeArchiveSha256": ctx.inventory["archiveSha256"],
        "runtimeSha256": next(row["sha256"] for row in ctx.inventory["entries"] if row["path"] == "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs"),
        "manifestHash": MANIFEST, "expectedNativeBuildId": NATIVE}
    rows = []
    for chain, name in CHAIN_NAMES.items():
        directory = Path(parent_plan["proxyProofDirectories"][chain])
        review_raw, result_raw = trusted(directory / "review.json"), trusted(directory / "result.json")
        review, result = json.loads(review_raw), json.loads(result_raw)
        unit = "yunipals-market-production-rpc@" + name + ".service"
        override = Path("/etc/systemd/system") / (unit + ".d") / PREVIOUS_OVERRIDE
        prior_override = str(override.with_name("zzzzzzz-unified-free-replay-20261020.conf"))
        prior = next(row for row in ctx.root["proxyTransitions"]["proofs"] if row["chainId"] == int(chain))
        expected = {"unit": unit, "chainId": int(chain), "sourceRoot": parent_plan["proxyArtifact"]["sourceRoot"],
            "sourceDigest": parent_plan["proxyArtifact"]["sourceDigest"], "profileId": ctx.root["identity"]["profileId"],
            "runtimeSha256": artifact["installed"]["runtimeSha256"], "runtimeInventorySha256": parent_plan["proxyArtifact"]["inventorySha256"],
            "runtimeArchiveSha256": artifact["inventory"]["archiveSha256"], "overridePath": str(override),
            "overrideSha256": digest(trusted(override)),
            "beforeInvocationId": ctx.c1["last"]["after"]["legacyUnits"][unit]["InvocationID"],
            "afterInvocationId": parent_epoch["legacyUnits"][unit]["InvocationID"]}
        if (canonical(review) != directory.name or digest(review_raw) != directory.name or
                review.get("format") != "yunipals-proxy-log-route-upgrade-v3" or review.get("beforeRuntime") != before_runtime or
                any(review.get(key) != value for key, value in expected.items() if key != "afterInvocationId") or
                review.get("originalDefinitionHashes", {}).get(prior_override) != prior["overrideSha256"] or
                result.get("reviewHash") != directory.name or result.get("review") != review or
                any(result.get(key) != value for key, value in expected.items()) or
                any(result.get(key) is not True for key in ["applied", "legacyHealthPassed", "legacyConfigurationPreserved", "verifyExecStart"]) or
                any(result.get(key) is not False for key in ["privateSettingsChanged", "ingestorStarted", "sourceSelectionChanged", "newPermits"]) or
                type(result.get("paidCalls")) is not int or result["paidCalls"] != 0 or
                expected["beforeInvocationId"] == expected["afterInvocationId"] or review.get("override") != trusted(override).decode() or
                report["last"]["after"]["legacyUnits"][unit] != parent_epoch["legacyUnits"][unit]):
            fail("Saved E1 applied proxy proofs do not match the actual parent runtime/invocations/retained8z.")
        rows.append({"chainId": int(chain), "unit": unit, "reviewSha256": digest(review_raw), "resultSha256": digest(result_raw), **expected})
    return {"sha256": canonical(rows), "proofs": rows}


def saved_rebases(parent_plan, ctx, epoch):
    for kind, list_key, origin_key, origin_hash_key, summary_origin in [
            ("legacy", "workers", "restorationReviewFile", "restorationReviewSha256", "restorationSha256"),
            ("dependencies", "services", "beforeEvidenceFile", "beforeEvidenceSha256", "beforeEvidenceSha256")]:
        path_key = "legacyRebaseFile" if kind == "legacy" else "dependencyRebaseFile"
        hash_key = "legacyRebaseSha256" if kind == "legacy" else "dependencyRebaseSha256"
        raw = trusted(parent_plan[path_key]); data = json.loads(raw); saved = epoch["rebases"][kind]
        original = ctx.root["legacyRebase" if kind == "legacy" else "dependencyRebase"]
        if (digest(raw) != parent_plan[hash_key] or saved["sha256"] != digest(raw) or
                digest(trusted(data[origin_key])) != data[origin_hash_key] or saved[summary_origin] != data[origin_hash_key] or
                saved[summary_origin] != original[summary_origin]): fail("Saved E1 rebase origin evidence changed.")
        rows = data[list_key]
        if len(rows) != len(saved[list_key]) or {row["unit"] for row in rows} != set(saved[list_key]): fail("Saved E1 rebase scope differs.")
        for row in rows:
            unit = row["unit"]
            actual = {"beforeState": row["beforeState"], "afterState": row["afterState"],
                      "definitionsSha256": canonical(row["definitions"]), "privateSettingsSha256": canonical(row["privateSettings"])}
            if kind == "legacy": actual["runtime"] = row["execArgv"][-1]
            else:
                actual["runtimeFilesSha256"] = canonical(row["runtimeFiles"])
                actual["additionalCurrentEntrypointPinsSha256"] = canonical(row.get("additionalCurrentEntrypointPins") or {})
            if (actual != saved[list_key][unit] or actual["afterState"] != epoch["legacyUnits"][unit] or
                    {k: v for k, v in actual.items() if k not in {"beforeState", "afterState"}} !=
                    {k: v for k, v in original[list_key][unit].items() if k not in {"beforeState", "afterState"}}):
                fail("Saved E1 rebase code/private settings/states differ from sealed original.")


def retained_parent_input_pins(plan, epoch):
    pins = {plan["proxyHelper"]: plan["proxyHelperSha256"], plan["legacyRebaseFile"]: plan["legacyRebaseSha256"],
            plan["dependencyRebaseFile"]: plan["dependencyRebaseSha256"]}
    for path_key, sha_key in [("inventoryFile", "inventorySha256"), ("cleanEvidenceFile", "cleanEvidenceSha256")]:
        pins[plan["proxyArtifact"][path_key]] = plan["proxyArtifact"][sha_key]
    pins[str(Path(plan["proxyArtifact"]["sourceRoot"]) / "RELEASE-MANIFEST.json")] = plan["proxyArtifact"]["sourceManifestSha256"]
    by_chain = {str(row["chainId"]): row for row in epoch["proxyTransitions"]["proofs"]}
    for chain, directory in plan["proxyProofDirectories"].items():
        for filename, key in [("review.json", "reviewSha256"), ("result.json", "resultSha256")]:
            pins[str(Path(directory) / filename)] = by_chain[chain][key]
    if any(digest(trusted(path)) != expected for path, expected in pins.items()):
        fail("Saved E1 source/runtime/applied proof file changed.")
    return pins


def parent_epoch(plan, parent, ctx, origin, origin_raw):
    prior = plan["priorEpoch"]; input_pins = prior_file_pins(prior)
    binding = origin.get("binding", {}); p = binding.get("plan", {}); epoch = binding.get("epoch", {})
    report = ctx.cont.completed_report(Path(prior["latestMonitorFile"]), ctx.workspace, NATIVE)
    first, last = report["first"], report["last"]
    directory = ctx.old.BASE / "proxy-epochs" / p["runId"]
    if (canonical(binding) != origin.get("reviewHash") or first.get("proxyEpochBinding") != binding or first.get("reviewHash") != origin["reviewHash"] or
            binding.get("helperSha256") != PARENT_HELPER_SHA or prior["originReviewFile"] != str(directory / "review.json") or
            prior["originMonitorFile"] != str(directory / "monitor.jsonl") or report["sha256"] != prior["latestMonitorSha256"] or
            binding.get("predecessorMonitorSha256") != ctx.c1["sha256"] or binding.get("previousRuntime") != ctx.c1["last"]["after"]["metrics"]["runtime"] or
            binding.get("previousCheckpoints") != ctx.c1["last"]["after"]["metrics"]["checkpoints"] or
            first.get("baselineMetrics") != origin.get("metrics") or first["baselineMetrics"]["runtime"] != binding["previousRuntime"] or
            first["baselineMetrics"]["checkpoints"] != binding["previousCheckpoints"] or
            first.get("unit") != ctx.old.unit_name(p) or first.get("limits") != ctx.old.resource_limits() or
            first.get("baselineLegacyUnits") != epoch.get("legacyUnits") or first.get("baselineActiveSelector") != ctx.root["activeSelector"] or
            binding.get("legacyUnits") != epoch.get("legacyUnits") or binding.get("activeSelector") != ctx.root["activeSelector"] or
            binding.get("workspaceProof") != ctx.workspace_proof):
        fail("Saved E1 review/monitor does not bind its original C1 predecessor/source/checkpoints.")
    _, artifact = parent.proxy_artifact(p, ctx)
    expected = {"format": parent.FORMAT, "continuationHelperSha256": CONTINUATION_SHA,
        "continuationPlanSha256": digest(trusted(p["continuationPlanFile"])), "c1MonitorSha256": ctx.c1["sha256"],
        "c1ReviewHash": ctx.c1["first"]["reviewHash"], "acceptedC1Stop": ctx.c1_stop, "workspace": str(ctx.workspace),
        "sourceDigest": SOURCE, "nativeBuild": NATIVE, "manifestHash": MANIFEST, "originalCacheBytes": ORIGINAL_CACHE,
        "profileSha256": digest(trusted(Path(ctx.env["UNIFIED_RPC_PROFILE_FILE"]))), "identity": ctx.root["identity"],
        "proxyHelperSha256": p["proxyHelperSha256"], "proxyArtifact": p["proxyArtifact"], "proxyRuntime": artifact["installed"],
        "sourceDiff": artifact["sourceDiff"], "runtimeDiff": artifact["runtimeDiff"],
        "proxyTransitions": saved_proxy_proofs(p, ctx, epoch, artifact, report), "rebases": epoch["rebases"],
        "legacyUnits": epoch["legacyUnits"], "activeSelector": ctx.root["activeSelector"], "peer": ctx.root["peer"],
        "policy": ctx.root["policy"], "registeredSource": ctx.root["registeredSource"], "limits": ctx.old.resource_limits(),
        "freeOnly": True, "launchGrantIds": [], "sourceWorkspaceCopiedOrChanged": False, "schemaOrCacheReset": False}
    if epoch != expected: fail("Saved E1 epoch changes immutable source/runtime/ACL/policy proof.")
    saved_rebases(p, ctx, epoch)
    input_pins.update(retained_parent_input_pins(p, epoch))
    parent.accepted_c1_stop(report, ctx.old.SCHEMA)
    own = report["samples"][-1].get("own", {})
    if (own.get("InvocationID") != first["invocation"] or last["after"].get("legacyUnits") != epoch["legacyUnits"] or
            last["after"].get("activeSelector") != epoch["activeSelector"]): fail("Saved E1 owned invocation or final legacy state differs.")
    for sample in report["samples"]:
        if (sample.get("own", {}).get("InvocationID") != first["invocation"] or
                sample.get("legacyUnits") != epoch["legacyUnits"] or sample.get("activeSelector") != epoch["activeSelector"] or
                sample.get("metrics", {}).get("runtime", {}).get("buildId") != NATIVE):
            fail("Saved E1 sample changes its actual owned/source/legacy epoch.")
    if (type(last.get("elapsed")) not in {int, float} or not 0 < last["elapsed"] <= 1200 or
            last.get("runtimeExpiryEvidence") is not None and last["reason"] != "deadline"):
        fail("Saved parent elapsed/expiry evidence differs from bounded actual outcome.")
    exception = prior["manualException"]; diagnosis_hash = None
    if last["reason"] == "shadow_exited":
        if own.get("Result") != "exit-code": fail("Manual E1 exception requires actual native exit-code75.")
        if exception is None: fail("Failed E1 cannot seed a new manual epoch without an explicit diagnosis.")
        diagnosis_raw = trusted(exception["diagnosisFile"], 32768); diagnosis = json.loads(diagnosis_raw)
        expected_diagnosis = {"format": "yunipals-manual-proxy-epoch-tempfail-diagnosis-v1", "parentHelperSha256": PARENT_HELPER_SHA,
            "parentReviewSha256": digest(origin_raw), "parentMonitorSha256": report["sha256"], "reason": "shadow_exited",
            "nativeExitStatus": 75, "stopError": None, "newProxySourceDigest": plan["proxyArtifact"]["sourceDigest"],
            "manualNewEpochOnly": True, "automaticRetryAllowed": False, "observedTerminalClasses": diagnosis.get("observedTerminalClasses")}
        classes = diagnosis.get("observedTerminalClasses")
        if (diagnosis != expected_diagnosis or not isinstance(classes, list) or not 1 <= len(classes) <= 16 or
                any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", value) for value in classes)):
            fail("Manual E1 diagnosis must bind actual75/new proxy and bounded sanitized terminal classes.")
        diagnosis_hash = digest(diagnosis_raw)
    else:
        if exception is not None: fail("Clean deadline parent must not carry a failure exception.")
        # Use the frozen PURE lineage only for the actual deadline report.
        probe = {**p, "mode": "continue", "runId": plan["runId"], "previousMonitorFile": prior["latestMonitorFile"],
                 "originReviewFile": prior["originReviewFile"], "originMonitorFile": prior["originMonitorFile"]}
        parent.validate_plan(probe); checked, _ = parent.lineage(probe, ctx, epoch)
        if checked["sha256"] != report["sha256"]: fail("Clean parent lineage returned another report.")
    return report, {"helperSha256": PARENT_HELPER_SHA, "originReviewSha256": digest(origin_raw), "originReviewHash": origin["reviewHash"],
        "monitorSha256": report["sha256"], "reason": last["reason"], "elapsed": last["elapsed"], "nativeExitStatus": 75 if exception else None,
        "diagnosisSha256": diagnosis_hash, "manuallyApprovedNewEpochOnly": True, "automaticContinuationAllowedFromParent": False,
        "parentEpochSha256": canonical(epoch), "inputPins": input_pins}


def source_diff(transition, old, new):
    left, right = ({row["path"]: row for row in manifest["files"]} for manifest in [old, new])
    changes = []
    for path in sorted(set(left) | set(right)):
        if left.get(path) == right.get(path): continue
        if path == RUNTIME_FILE and path in left and path in right: kind = "only_reviewed_proxy_runtime"
        elif path.startswith("apps/yunipals-market-api/src/") and path.endswith(".test.ts"): kind = "nonruntime_test"
        else: fail("Proxy-only artifact changes protected source: " + path)
        changes.append({"path": path, "kind": kind, "old": left.get(path), "new": right.get(path)})
    if [row["path"] for row in changes if row["kind"] == "only_reviewed_proxy_runtime"] != [RUNTIME_FILE]:
        fail("Exactly one proxy runtime source change is required.")
    return {"sha256": canonical(changes), "changes": changes}


def runtime_diff(old_root, new_root, old, new, old_build_root, new_build_root):
    if old.get("lockfileSha256") != new.get("lockfileSha256") or old.get("runtime") != new.get("runtime"):
        fail("Proxy-only epoch changes dependencies or runtime platform.")
    left, right = ({row["path"]: row for row in inventory["entries"]} for inventory in [old, new])
    if set(left) != set(right): fail("Proxy epoch changes installed runtime closure.")
    changes = []
    for path in sorted(left):
        before, after = left[path], right[path]
        if before == after: continue
        if before["type"] != after["type"] or before["mode"] != after["mode"]: fail("Runtime type/mode changed.")
        if path in DIST_FILES and after["type"] == "file": kind = "only_reviewed_proxy_bundle"
        else: kind = None
        if path not in DIST_FILES:
            a, b = (old_root / path).read_bytes(), (new_root / path).read_bytes()
            if "/.bin/" in path and after["type"] == "file":
                if (max(len(a), len(b)) > 262144 or not a.startswith(b"#!/bin/sh") or old_build_root.encode() not in a or new_build_root.encode() not in b or
                        a.replace(old_build_root.encode(), b"<CLEAN_BUILD_ROOT>") != b.replace(new_build_root.encode(), b"<CLEAN_BUILD_ROOT>")):
                    fail("Generated shim changes dependency semantics.")
                kind = "exact_generated_build_root_substitution"
            elif path == "node_modules/.modules.yaml" and after["type"] == "file":
                x, y = a.splitlines(keepends=True), b.splitlines(keepends=True)
                delta = [(u, v) for u, v in zip(x, y) if u != v]
                if len(x) != len(y) or len(delta) != 1 or any(not re.fullmatch(rb"prunedAt: [A-Za-z]{3}, \d\d [A-Za-z]{3} \d{4} \d\d:\d\d:\d\d GMT\n?", line) for line in delta[0]):
                    fail("Generated package metadata changes beyond prune timestamp.")
                kind = "exact_generated_prune_timestamp"
            else: fail("Protected dependency/runtime bytes changed: " + path)
        changes.append({"path": path, "kind": kind, "old": before["sha256"], "new": after["sha256"]})
    if {row["path"] for row in changes if row["kind"] == "only_reviewed_proxy_bundle"} != DIST_FILES:
        fail("Exactly proxy bundle and sourcemap must change.")
    return {"sha256": canonical(changes), "changes": changes, "dependencyPackagesUnchanged": True}


def context(plan):
    prior = plan["priorEpoch"]
    parent = load_module(prior["helper"], PARENT_HELPER_SHA, "pinned_saved_parent_epoch")
    origin_raw = trusted(prior["originReviewFile"])
    origin = json.loads(origin_raw)
    parent_plan = origin.get("binding", {}).get("plan", {})
    parent.validate_plan(parent_plan)
    if parent_plan["mode"] != "epoch": fail("Only the explicitly saved first E1 epoch is supported as parent.")
    for key in ["continuationHelper", "continuationPlanFile", "c1MonitorFile"]:
        if plan[key] != parent_plan[key]: fail("New proxy epoch changes original source/C1 context.")
    # This pinned call validates original008/C1 history and workspace, not old
    # live proxy IDs. Never call parent's current-state review or rewrite it.
    ctx = parent.context(parent_plan)
    previous, provenance = parent_epoch(plan, parent, ctx, origin, origin_raw)
    return types.SimpleNamespace(**vars(ctx), parent=parent, parent_report=previous,
        parent_epoch=origin["binding"]["epoch"], parent_provenance=provenance)


def proxy_artifact(plan, ctx):
    pins = plan["proxyArtifact"]
    verifier = load_module(plan["proxyHelper"], plan["proxyHelperSha256"], "pinned_proxy_epoch_verifier")
    if verifier.ROOT != Path(pins["sourceRoot"]) or verifier.SOURCE != pins["sourceDigest"] or verifier.PROFILE_ID != ctx.root["identity"]["profileId"]:
        fail("New proxy verifier selects another release/profile.")
    installed = verifier.verify_runtime(Path(pins["inventoryFile"]))
    inventory_raw, clean_raw = trusted(pins["inventoryFile"]), trusted(pins["cleanEvidenceFile"])
    if digest(inventory_raw) != pins["inventorySha256"] or digest(clean_raw) != pins["cleanEvidenceSha256"]:
        fail("New proxy inventory/clean evidence pin changed.")
    inventory, clean = json.loads(inventory_raw), json.loads(clean_raw)
    if (clean.get("format") != "yunipals-unified-proxy-epoch-evidence-v1" or
            installed.get("sourceRoot") != pins["sourceRoot"] or installed.get("sourceDigest") != pins["sourceDigest"] or
            installed.get("runtimeInventorySha256") != pins["inventorySha256"] or installed.get("runtimeArchiveSha256") != inventory["archiveSha256"] or
            installed.get("sourceArchiveSha256") != clean.get("source", {}).get("archiveSha256") or
            installed.get("expectedNativeBuildId") != NATIVE or installed.get("manifestHash") != MANIFEST or
            digest(trusted(Path(pins["sourceRoot"]) / "RELEASE-MANIFEST.json")) != pins["sourceManifestSha256"]):
        fail("New proxy-only clean/source/archive identity differs.")
    # Explicit schema-version conversion reuses the complete existing validator;
    # every nested proof/report remains required, with no Boolean substitutions.
    ctx.transition.validate_clean_evidence({**clean, "format": "yunipals-unified-release-candidate2-evidence-v1"},
                                          pins, inventory, ctx.old.RUNTIME_HELPER_SHA)
    manifest = json.loads(trusted(Path(pins["sourceRoot"]) / "RELEASE-MANIFEST.json"))
    changes = source_diff(ctx.transition, ctx.manifest, manifest)
    runtime = runtime_diff(ctx.candidate.SOURCE, Path(pins["sourceRoot"]), ctx.inventory, inventory,
                           ctx.clean["runtime"]["buildRoot"], clean["runtime"]["buildRoot"])
    return local_verifier(verifier, ctx.old), {"installed": installed, "sourceDiff": changes, "runtimeDiff": runtime, "inventory": inventory}



def local_verifier(module, helper):
    """Explicit bounded local adapter; the imported verifier is never mutated."""
    def state(unit):
        text = helper.command(["/usr/bin/systemctl", "show", unit, *["--property=" + key for key in module.STATE_KEYS]],
                              env=helper.ROLE_ENV, timeout=2)
        props, repeated = {}, {"EnvironmentFiles": [], "Environment": []}
        for line in text.splitlines():
            if "=" not in line: continue
            key, value = line.split("=", 1)
            if key in repeated: repeated[key].append(value)
            else: props[key] = value
        for key, values in repeated.items():
            if values: props[key] = " ".join(values)
        props["EnvironmentFilesEntries"] = repeated["EnvironmentFiles"]
        if (any(key not in props for key in module.STATE_KEYS) or props["ActiveState"] != "active" or props["SubState"] != "running" or
                not re.fullmatch(r"[0-9a-f]{32}", props["InvocationID"]) or not props["MainPID"].isdigit() or int(props["MainPID"]) <= 0):
            fail("Exact healthy local proxy identity required.")
        return props
    def request(port, path, payload=None):
        if port not in {row[1] for row in module.CHAINS.values()} or path not in {"/", "/health", "/metrics"}:
            fail("Unapproved local monitoring route.")
        if payload is not None and (path != "/" or payload != {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}):
            fail("Only the existing startup chain identity request is permitted.")
        req = urllib.request.Request("http://127.0.0.1:" + str(port) + path,
            data=None if payload is None else json.dumps(payload).encode(), headers={"content-type": "application/json"})
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), module.NoRedirect()).open(req, timeout=3) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000: fail("Local proxy observation exceeds its cap.")
        value = json.loads(raw)
        if not isinstance(value, dict): fail("Invalid local proxy metadata.")
        return value
    def live(port, chain):
        if request(port, "/health").get("status") != "ready": fail("Local legacy health unavailable.")
        metrics = request(port, "/metrics")
        if (metrics.get("freeRouting") is not True or metrics.get("paidFallbackOnFreeFailure") is not False or
                metrics.get("sourcePaidFallbackOnFreeFailure") is not False or any(key not in metrics for key in module.CONFIG_KEYS)):
            fail("Exact legacy free-only configuration unavailable.")
        response = request(port, "/", {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []})
        if response.get("result") != hex(chain) or "error" in response: fail("Actual startup proxy chain identity changed.")
        return {key: metrics[key] for key in module.CONFIG_KEYS}
    return types.SimpleNamespace(state=state, request=request, legacy_health=live, definitions=module.definitions,
        verify_exec_start=module.verify_exec_start, private_settings=module.private_settings, CHAINS=module.CHAINS, CONFIG_KEYS=module.CONFIG_KEYS)


def rebases(plan, ctx, current):
    root, old, transition, cont = ctx.root, ctx.old, ctx.transition, ctx.cont
    fresh = {**ctx.transition_plan, **{key: plan[key] for key in ["legacyRebaseFile", "legacyRebaseSha256", "dependencyRebaseFile", "dependencyRebaseSha256"]}}
    legacy, states = transition.legacy_rebase(fresh, cont, old, root["oldLegacyUnits"], current, root["activeSelector"], root["initialMonitorSha256"])
    dependencies, states = transition.dependency_rebase(fresh, cont, old, states, current, root["activeSelector"], root["initialMonitorSha256"])
    if (legacy["restorationSha256"] != root["legacyRebase"]["restorationSha256"] or
            dependencies["beforeEvidenceSha256"] != root["dependencyRebase"]["beforeEvidenceSha256"]):
        fail("Fresh rebases change the authenticated original before/restoration evidence.")
    for key, original, actual in [("workers", root["legacyRebase"], legacy), ("services", root["dependencyRebase"], dependencies)]:
        if set(original[key]) != set(actual[key]): fail("Rebase service scope changed.")
        for unit in original[key]:
            omit = {"beforeState", "afterState"}
            if ({k: v for k, v in original[key][unit].items() if k not in omit} !=
                    {k: v for k, v in actual[key][unit].items() if k not in omit}):
                fail("Rebased legacy code/definitions/private settings/metadata entry changed.")
    allowed = {*transition.LEGACY_WORKERS, *transition.LEGACY_DEPENDENCIES,
               *("yunipals-market-production-rpc@" + name + ".service" for name in CHAIN_NAMES.values())}
    c1_states = ctx.parent_report["last"]["after"]["legacyUnits"]
    if set(current) != set(c1_states) or any(current[unit] != before for unit, before in c1_states.items() if unit not in allowed):
        fail("An unrelated service changed since saved parent E1.")
    return {"legacy": legacy, "dependencies": dependencies}


def proxy_epoch(plan, ctx, verifier, artifact, current, *, live_chain):
    pins = plan["proxyArtifact"]
    proxy_sha = artifact["installed"]["runtimeSha256"]
    before_runtime = ctx.parent_epoch["proxyRuntime"]
    def one(item):
        chain, name = item; unit = "yunipals-market-production-rpc@" + name + ".service"
        directory = Path(plan["proxyProofDirectories"][chain])
        review_raw, result_raw = trusted(directory / "review.json"), trusted(directory / "result.json")
        review, result = json.loads(review_raw), json.loads(result_raw)
        override = Path("/etc/systemd/system") / (unit + ".d") / OVERRIDE
        override_raw = trusted(override)
        previous_override = str(override.with_name(PREVIOUS_OVERRIDE))
        prior = next(row for row in ctx.parent_epoch["proxyTransitions"]["proofs"] if row["chainId"] == int(chain))
        expected = {"unit": unit, "chainId": int(chain), "sourceRoot": pins["sourceRoot"], "sourceDigest": pins["sourceDigest"],
                    "profileId": ctx.root["identity"]["profileId"], "runtimeSha256": proxy_sha, "runtimeInventorySha256": pins["inventorySha256"],
                    "runtimeArchiveSha256": artifact["inventory"]["archiveSha256"], "overridePath": str(override), "overrideSha256": digest(override_raw),
                    "beforeInvocationId": ctx.parent_report["last"]["after"]["legacyUnits"][unit]["InvocationID"], "afterInvocationId": current[unit]["InvocationID"]}
        if (canonical(review) != directory.name or digest(review_raw) != directory.name or
                review.get("format") != "yunipals-proxy-source-fallback-upgrade-v4" or review.get("beforeRuntime") != before_runtime or
                any(review.get(key) != value for key, value in expected.items() if key != "afterInvocationId") or
                review.get("originalDefinitionHashes", {}).get(previous_override) != prior["overrideSha256"] or
                result.get("reviewHash") != directory.name or result.get("review") != review or
                any(result.get(key) != value for key, value in expected.items()) or
                any(result.get(key) is not True for key in ["applied", "legacyHealthPassed", "legacyConfigurationPreserved", "verifyExecStart"]) or
                any(result.get(key) is not False for key in ["privateSettingsChanged", "ingestorStarted", "sourceSelectionChanged", "newPermits"]) or
                type(result.get("paidCalls")) is not int or result["paidCalls"] != 0 or
                expected["beforeInvocationId"] == expected["afterInvocationId"] or
                review.get("override") != override_raw.decode() or current[unit].get("ActiveState") != "active" or current[unit].get("SubState") != "running"):
            fail("Applied proxy epoch proof changes runtime/invocation/origin/settings.")
        properties = verifier.state(unit); verifier.verify_exec_start(properties, Path(pins["sourceRoot"]))
        definitions = verifier.definitions(properties)
        if definitions.pop(str(override), None) != digest(override_raw): fail("New proxy override is not retained exactly.")
        configuration = ctx.transition.legacy_configuration(verifier, verifier.CHAINS[name][1], int(chain), verify_live_chain_id=live_chain)
        if (definitions != review.get("originalDefinitionHashes") or verifier.private_settings(properties) != review.get("privateSettings") or
                properties.get("InvocationID") != current[unit]["InvocationID"] or configuration != review.get("legacyConfiguration") or
                digest(trusted(Path(pins["sourceRoot"]) / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs")) != proxy_sha):
            fail("Current proxy epoch code/definition/private/configuration proof changed.")
        return {"chainId": int(chain), "unit": unit, "reviewSha256": digest(review_raw), "resultSha256": digest(result_raw), **expected}
    with ThreadPoolExecutor(max_workers=4) as pool: rows = list(pool.map(one, CHAIN_NAMES.items()))
    return {"sha256": canonical(rows), "proofs": rows}


def lineage(plan, ctx, epoch):
    if plan["mode"] == "epoch": return ctx.parent_report, []
    raw = trusted(plan["originReviewFile"]); origin = json.loads(raw)
    binding = origin.get("binding", {})
    first_plan = binding.get("plan", {})
    validate_plan(first_plan)
    stable = PLAN_KEYS - {"mode", "runId", "previousMonitorFile", "originReviewFile", "originMonitorFile"}
    if (first_plan["mode"] != "epoch" or any(first_plan[key] != plan[key] for key in stable) or
            canonical(binding) != origin.get("reviewHash") or binding.get("epoch") != epoch or
            plan["originReviewFile"] != str(ctx.old.BASE / "proxy-epochs-v2" / first_plan["runId"] / "review.json") or
            plan["originMonitorFile"] != str(ctx.old.BASE / "proxy-epochs-v2" / first_plan["runId"] / "monitor.jsonl")):
        fail("Same-epoch continuation lacks exact canonical origin review.")
    path, reports, seen = Path(plan["previousMonitorFile"]), [], set()
    while True:
        if str(path) in seen or len(reports) >= 128: fail("Proxy epoch lineage is cyclic/excessive.")
        seen.add(str(path)); report = ctx.cont.completed_report(path, ctx.workspace, NATIVE)
        current = report["first"].get("proxyEpochBinding", {}); prior = current.get("plan", {})
        validate_plan(prior)
        expected = ctx.old.BASE / "proxy-epochs-v2" / prior["runId"] / "monitor.jsonl"
        if (path != expected or canonical(current) != report["first"].get("reviewHash") or current.get("epoch") != epoch or
                report["first"].get("unit") != ctx.old.unit_name(prior) or report["first"].get("limits") != ctx.old.resource_limits() or
                report["last"].get("retainedSchema") != ctx.old.SCHEMA or report["last"].get("reason") != "deadline" or
                current.get("helperSha256") != digest(trusted(Path(__file__).absolute())) or prior["runId"] == plan["runId"]):
            fail("Same-epoch lineage changes helper/source/resources/origin or stopped unsuccessfully.")
        elapsed = report["last"].get("elapsed")
        if type(elapsed) not in {int, float} or elapsed < ctx.old.resource_limits()["seconds"]:
            fail("Automatic epoch continuation requires an actual full deadline window.")
        own = report["samples"][-1].get("own", {})
        expiry = report["last"].get("runtimeExpiryEvidence")
        if expiry is not None:
            validate_expiry(expiry, report["first"]["unit"], report["first"]["invocation"])
            if (own.get("InvocationID") != expiry["invocation"] or own.get("Result") != "timeout" or
                    own.get("ActiveState") not in {"inactive", "failed"} or expiry["controllerElapsedSeconds"] > elapsed + 0.01):
                fail("Runtime expiry proof does not match the actual last owned sample.")
        elif own.get("ActiveState") != "active" or own.get("InvocationID") != report["first"]["invocation"]:
            fail("Deadline completion lacks an active owned sample or proven runtime expiry.")
        accepted_c1_stop(report, ctx.old.SCHEMA)
        if path == Path(plan["originMonitorFile"]):
            if current != binding or prior != first_plan: fail("First proxy epoch report/review differs.")
            reports.append(report); break
        if (prior["mode"] != "continue" or any(prior[key] != plan[key] for key in PLAN_KEYS - {"runId", "previousMonitorFile"}) or
                current.get("predecessorMonitorSha256") != digest(trusted(prior["previousMonitorFile"]))):
            fail("Proxy epoch continuation changes approved configuration or predecessor.")
        reports.append(report); path = Path(prior["previousMonitorFile"])
    chronological = [ctx.parent_report, *reversed(reports)]
    for previous, current in zip(chronological, chronological[1:]):
        old_metrics = previous["last"]["after"]["metrics"]; start = current["first"]; cb = start["proxyEpochBinding"]
        if (cb.get("predecessorMonitorSha256") != previous["sha256"] or cb.get("previousRuntime") != old_metrics["runtime"] or
                cb.get("previousCheckpoints") != old_metrics["checkpoints"] or start.get("baselineMetrics", {}).get("runtime") != old_metrics["runtime"] or
                start.get("baselineMetrics", {}).get("checkpoints") != old_metrics["checkpoints"] or
                start.get("baselineLegacyUnits") != epoch["legacyUnits"] or start.get("baselineActiveSelector") != epoch["activeSelector"]):
            fail("Proxy epoch checkpoints/runtime/legacy baseline do not follow their exact predecessor.")
    return reports[0], reports


def counters(proxies):
    result = {}
    for chain in CHAIN_NAMES:
        for workload in ["unified_source", "unified_evidence"]:
            row = proxies[chain]["unified"]["traffic"][workload]
            for name in ["paidCalls", "refused"]:
                value = row[name]
                if type(value) is not int or value < 0: fail("Invalid isolated proxy counter.")
                result[chain + "/" + workload + "/" + name] = value
    return result



def validate_expiry(proof, unit, invocation):
    keys = {"unit", "invocation", "result", "controllerElapsedSeconds", "startMonotonicMicroseconds", "exitMonotonicMicroseconds", "durationMicroseconds"}
    if (set(proof) != keys or proof["unit"] != unit or proof["invocation"] != invocation or proof["result"] != "timeout" or
            type(proof["controllerElapsedSeconds"]) not in {int, float} or proof["controllerElapsedSeconds"] < 900 or
            any(type(proof[key]) is not int for key in ["startMonotonicMicroseconds", "exitMonotonicMicroseconds", "durationMicroseconds"]) or
            proof["startMonotonicMicroseconds"] <= 0 or proof["durationMicroseconds"] < 900_000_000 or
            proof["exitMonotonicMicroseconds"] - proof["startMonotonicMicroseconds"] != proof["durationMicroseconds"]):
        fail("Runtime expiry lacks exact owned main-process lifetime proof.")


def runtime_expiry(old, unit, own, invocation, elapsed):
    if (elapsed < 900 or own.get("InvocationID") != invocation or own.get("Result") != "timeout" or
            own.get("ActiveState") not in {"inactive", "failed"}): return None
    keys = ["InvocationID", "Result", "ActiveState", "ExecMainStartTimestampMonotonic", "ExecMainExitTimestampMonotonic"]
    raw = old.command(["/usr/bin/systemctl", "show", unit, *["--property=" + key for key in keys]], env=old.ROLE_ENV, timeout=2)
    props = {}
    for line in raw.splitlines():
        key, separator, value = line.partition("=")
        if not separator or key not in keys or key in props: return None
        props[key] = value
    if (set(props) != set(keys) or props["InvocationID"] != invocation or props["Result"] != "timeout" or
            props["ActiveState"] not in {"inactive", "failed"} or
            any(not re.fullmatch(r"[0-9]{1,20}", props[key]) for key in keys[-2:])): return None
    start, end = (int(props[key]) for key in keys[-2:])
    if start <= 0 or end - start < 900_000_000: return None
    proof = {"unit": unit, "invocation": invocation, "result": "timeout", "controllerElapsedSeconds": elapsed,
             "startMonotonicMicroseconds": start, "exitMonotonicMicroseconds": end, "durationMicroseconds": end - start}
    validate_expiry(proof, unit, invocation)
    return proof


def accepted_c1_stop(report, schema):
    last = report["last"]
    if (last.get("stopError") is not None or last.get("retainedSchema") != schema or
            last.get("after", {}).get("metrics", {}).get("runtime", {}).get("buildId") != NATIVE):
        fail("C1 lacks clean owned stop and retained native source identity.")
    reason = last.get("reason")
    own = report["samples"][-1].get("own", {})
    if reason != "deadline" and (reason != "shadow_exited" or own.get("ExecMainStatus") != "75" or own.get("ActiveState") not in {"inactive", "failed"}):
        fail("Only the diagnosed C1 upstream TEMPFAIL75 may seed a manual new epoch.")
    observations = [*report["samples"], last.get("after", {})]
    if any(any(counters(row["proxies"]).values()) for row in observations):
        fail("C1 paid/refused history cannot seed this free-only proxy epoch.")
    def positions(metrics):
        result = {}
        for row in metrics["checkpoints"]:
            for key in ["latest", "safe", "finalized"]:
                value = row.get(key)
                if value is not None and not re.fullmatch(r"[0-9]{1,100}", str(value)): fail("Invalid C1 native checkpoint.")
                result[(str(row["chain"]), key)] = int(value) if value is not None else 0
        return result
    before = positions(report["first"]["baselineMetrics"]); after = positions(last["after"]["metrics"])
    if not set(before).issubset(after) or any(after[key] < value for key, value in before.items()) or not any(after[key] > value for key, value in before.items()):
        fail("Diagnosed C1 must retain actual monotonic native checkpoint progress.")
    return {"reason": reason, "nativeExitStatus": 75 if reason == "shadow_exited" else None, "manuallyApprovedNewEpoch": True,
            "checkpointProgress": True, "noPaidOrRefusedCalls": True, "automaticContinuationAllowedFromThisReport": False}


def review(plan, *, existing_directory=None, live_chain=True):
    validate_plan(plan); ctx = context(plan)
    verifier, artifact = proxy_artifact(plan, ctx)
    states, selector = ctx.old.service_states(ctx.old.LEGACY_UNITS), ctx.old.active_selector()
    if selector != ctx.root["activeSelector"]: fail("Active source selector changed; epoch is not a cutover.")
    rebased = rebases(plan, ctx, states)
    proxy = proxy_epoch(plan, ctx, verifier, artifact, states, live_chain=live_chain)
    epoch = {"format": FORMAT, "continuationHelperSha256": CONTINUATION_SHA, "continuationPlanSha256": digest(trusted(plan["continuationPlanFile"])),
        "c1MonitorSha256": ctx.c1["sha256"], "c1ReviewHash": ctx.c1["first"]["reviewHash"], "acceptedC1Stop": ctx.c1_stop, "workspace": str(ctx.workspace),
        "sourceDigest": SOURCE, "nativeBuild": NATIVE, "manifestHash": MANIFEST, "originalCacheBytes": ORIGINAL_CACHE,
        "profileSha256": digest(trusted(Path(ctx.env["UNIFIED_RPC_PROFILE_FILE"]))), "identity": ctx.root["identity"],
        "proxyHelperSha256": plan["proxyHelperSha256"], "proxyArtifact": plan["proxyArtifact"], "proxyRuntime": artifact["installed"],
        "sourceDiff": artifact["sourceDiff"], "runtimeDiff": artifact["runtimeDiff"], "proxyTransitions": proxy, "rebases": rebased,
        "legacyUnits": states, "activeSelector": selector, "peer": ctx.root["peer"], "policy": ctx.root["policy"],
        "registeredSource": ctx.root["registeredSource"], "limits": ctx.old.resource_limits(), "freeOnly": True, "launchGrantIds": [],
        "sourceWorkspaceCopiedOrChanged": False, "schemaOrCacheReset": False, "priorEpoch": ctx.parent_provenance}
    previous, reports = lineage(plan, ctx, epoch)
    for report in [*ctx.reports, ctx.parent_report, *reports]:
        own = ctx.old.own_state(report["first"]["unit"])
        if own["LoadState"] != "not-found" and own["ActiveState"] not in {"inactive", "failed"}: fail("An earlier source invocation remains active.")
    latest = previous["last"]["after"]["metrics"]; metrics = ctx.old.source_metrics()
    if metrics.get("runtime") != latest.get("runtime") or metrics.get("checkpoints") != latest.get("checkpoints"):
        fail("Retained Ponder metadata/checkpoints changed after completed predecessor.")
    policy = ctx.cont.free_policy_snapshot(ctx.old, ctx.env, ctx.profile)
    if ctx.old.peer_acl() != epoch["peer"] or ctx.cont.retained_policy_binding(ctx.old, policy, free_only=True) != epoch["policy"]:
        fail("Source-role peer grants or free-only profile/budget changed.")
    if ctx.transition.registered_source(ctx.old, ctx.profile) != epoch["registeredSource"]: fail("Registered physical source changed.")
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old, ctx.profile, MANIFEST), NATIVE, len(ctx.profile["manifest"]["sources"]), latest)
    free = shutil.disk_usage(ctx.candidate.SOURCE).free
    if free < ctx.old.START_FREE or ctx.old.stop_reason({"freeBytes": free, "metrics": metrics, "legacyUnits": states, "activeSelector": selector}, {"binding": epoch}, ORIGINAL_CACHE, 0):
        fail("Original cumulative resource guards prevent another window.")
    ctx.old.free_port()
    if ctx.old.service_states((ctx.old.unit_name(plan),))[ctx.old.unit_name(plan)]["LoadState"] != "not-found": fail("A fresh transient unit is required.")
    directory = ctx.old.BASE / "proxy-epochs-v2" / plan["runId"]
    if existing_directory is None:
        if directory.exists() or directory.is_symlink(): fail("Retained epoch report directory must never be overwritten.")
    elif existing_directory != directory or directory.is_symlink() or directory.stat().st_uid != 0 or directory.stat().st_mode & 0o022 or list(directory.iterdir()):
        fail("Prepared epoch report directory differs or is not empty.")
    proxies = ctx.old.proxy_observation(); ctx.old.validate_proxies(proxies, epoch["identity"])
    count = counters(proxies)
    if any(value != 0 for value in count.values()): fail("New proxy epoch already has paid/refused isolated calls.")
    binding = {"plan": plan, "helperSha256": digest(trusted(Path(__file__).absolute())), "epoch": epoch,
        "predecessorMonitorSha256": previous["sha256"], "previousRuntime": latest["runtime"], "previousCheckpoints": latest["checkpoints"],
        "legacyUnits": states, "activeSelector": selector, "workspaceProof": ctx.workspace_proof}
    return {"reviewHash": canonical(binding), "binding": binding, "metrics": metrics, "freeBytes": free,
            "workspaceAccess": ctx.access, "proxies": proxies, "started": False}, (ctx, verifier, artifact, directory)


def validate_running(plan, ctx, verifier, artifact, result, sample):
    epoch = result["binding"]["epoch"]
    files = {plan["proxyHelper"]: plan["proxyHelperSha256"],
             plan["proxyArtifact"]["inventoryFile"]: plan["proxyArtifact"]["inventorySha256"],
             plan["proxyArtifact"]["cleanEvidenceFile"]: plan["proxyArtifact"]["cleanEvidenceSha256"],
             plan["continuationHelper"]: CONTINUATION_SHA, plan["continuationPlanFile"]: epoch["continuationPlanSha256"],
             plan["c1MonitorFile"]: epoch["c1MonitorSha256"], str(Path(__file__).absolute()): result["binding"]["helperSha256"]}
    if any(digest(trusted(path)) != expected for path, expected in files.items()):
        fail("Reviewed epoch helper/evidence changed.")
    if any(digest(trusted(path)) != expected for path, expected in epoch["priorEpoch"]["inputPins"].items()):
        fail("Saved parent E1 provenance changed while running.")
    ctx.old.validate_proxies(sample["proxies"], epoch["identity"])
    if counters(sample["proxies"]) != counters(result["proxies"]): fail("Isolated paid/refused counters changed or reset.")
    if sample["legacyUnits"] != epoch["legacyUnits"] or sample["activeSelector"] != epoch["activeSelector"]:
        fail("Source/proxy/legacy invocation epoch changed.")
    if ctx.cont.retained_policy_binding(ctx.old, sample["policy"], free_only=True) != epoch["policy"] or ctx.old.peer_acl() != epoch["peer"]:
        fail("Free-only policy/budget or source peer grants changed.")
    if (rebases(plan, ctx, sample["legacyUnits"]) != epoch["rebases"] or
            proxy_epoch(plan, ctx, verifier, artifact, sample["legacyUnits"], live_chain=False) != epoch["proxyTransitions"] or
            ctx.transition.registered_source(ctx.old, ctx.profile) != epoch["registeredSource"]):
        fail("Current proxy/legacy/runtime/source evidence changed.")
    ctx.cont.validate_runtime(ctx.cont.runtime_proof(ctx.old, ctx.profile, MANIFEST), NATIVE, len(ctx.profile["manifest"]["sources"]), {}, starting=False)


def save(path, value):
    with path.open("xb") as handle:
        os.fchmod(handle.fileno(), 0o640); handle.write(encoded(value) + b"\n"); handle.flush(); os.fsync(handle.fileno())


def apply(plan, expected):
    descriptor = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a") as lease:
        info = os.fstat(lease.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: fail("Protected source-controller lease required.")
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, (ctx, verifier, artifact, directory) = review(plan)
        if result["reviewHash"] != expected: fail("Proxy epoch review changed; no source launch.")
        parent = directory.parent; parent.mkdir(mode=0o750, exist_ok=True)
        if parent.is_symlink() or parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022: fail("Protected epoch report parent required.")
        gid = pwd.getpwnam(ctx.old.USER).pw_gid
        os.chown(parent, 0, gid); parent.chmod(0o750); directory.mkdir(mode=0o750); os.chown(directory, 0, gid)
        project, launch = ctx.workspace / "apps/yunipals-indexer", ctx.workspace / "launch.env"
        ctx.cont.validate_launch_text(ctx.candidate, launch.read_text(), free_only=True)
        preflight = ctx.old.command(["/usr/sbin/runuser", "-u", ctx.old.USER, "--", "/usr/bin/env", "-i", ctx.old.NODE,
            "--env-file=" + str(launch), "--import", "tsx", "scripts/unified-rpc-preflight.ts"], cwd=project, env=ctx.old.ROLE_ENV, timeout=60)
        ctx.cont.validate_preflight(preflight, {"freeOnly": True}, ctx.old, ctx.env)
        again, _ = review(plan, existing_directory=directory, live_chain=False)
        if again["reviewHash"] != expected: fail("Proxy epoch prerequisites changed during free-only preflight.")
        save(directory / "review.json", result)
        invocation, reason, started, log, expiry = None, "monitor_error", time.monotonic(), directory / "monitor.jsonl", None
        try:
            invocation = ctx.candidate.systemd_start(plan, project, launch, expected)
            ctx.old.emit(log, {"event": "started", "reviewHash": expected, "proxyEpochBinding": result["binding"], "unit": ctx.old.unit_name(plan),
                "invocation": invocation, "limits": ctx.old.resource_limits(), "baselineMetrics": result["metrics"],
                "baselineLegacyUnits": result["binding"]["legacyUnits"], "baselineActiveSelector": result["binding"]["activeSelector"]})
            while True:
                tick = time.monotonic(); signal.setitimer(signal.ITIMER_REAL, 15)
                try:
                    own = ctx.old.own_state(ctx.old.unit_name(plan))
                    sample = {"freeBytes": shutil.disk_usage(ctx.candidate.SOURCE).free, "metrics": ctx.old.source_metrics(),
                        "legacyUnits": ctx.old.service_states(ctx.old.LEGACY_UNITS), "activeSelector": ctx.old.active_selector(),
                        "proxies": ctx.old.proxy_observation(), "policy": ctx.cont.free_policy_snapshot(ctx.old, ctx.env, ctx.profile)}
                    validate_running(plan, ctx, verifier, artifact, result, sample)
                finally: signal.setitimer(signal.ITIMER_REAL, 0)
                ctx.old.emit(log, {"event": "sample", "elapsed": round(tick - started, 2), "own": own, **sample})
                if own["ActiveState"] in {"inactive", "failed"} or own["InvocationID"] != invocation:
                    expiry = runtime_expiry(ctx.old, ctx.old.unit_name(plan), own, invocation, time.monotonic() - started)
                    reason = "deadline" if expiry else "shadow_exited" if own["ActiveState"] in {"inactive", "failed"} else "shadow_invocation_changed"
                    break
                reason = ctx.old.stop_reason(sample, result, ORIGINAL_CACHE, time.monotonic() - started)
                if reason: break
                time.sleep(max(0, ctx.old.INTERVAL - (time.monotonic() - tick)))
        except (KeyboardInterrupt, SystemExit): reason = "operator_interrupt"
        except Exception as error:
            reason = "monitor_prerequisite_unavailable"; ctx.old.emit(log, {"event": "monitor_guard_failed", "errorClass": type(error).__name__})
        finally:
            stop_error = None
            try: ctx.old.stop_owned(ctx.old.unit_name(plan), invocation, expected)
            except Exception as error: stop_error = type(error).__name__
            after = {}
            for key, collect in [("legacyUnits", lambda: ctx.old.service_states(ctx.old.LEGACY_UNITS)), ("activeSelector", ctx.old.active_selector),
                                 ("proxies", ctx.old.proxy_observation), ("metrics", ctx.old.source_metrics)]:
                try: after[key] = collect()
                except Exception as error: after[key] = {"unavailable": type(error).__name__}
            ctx.old.emit(log, {"event": "stopped", "reason": reason, "elapsed": round(time.monotonic() - started, 2),
                "retainedWorkspace": str(ctx.workspace), "retainedSchema": ctx.old.SCHEMA, "stopError": stop_error,
                "runtimeExpiryEvidence": expiry, "after": after})


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--plan", required=True); parser.add_argument("--apply")
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main": fail("Exact root operator/host required.")
    plan = json.loads(trusted(args.plan)); validate_plan(plan)
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply): fail("Exact reviewed epoch hash required.")
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        apply(plan, args.apply)
    else: print(json.dumps(review(plan)[0], indent=2))


if __name__ == "__main__": main()
