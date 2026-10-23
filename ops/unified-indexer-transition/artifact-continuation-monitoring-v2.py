#!/usr/bin/env python3
"""Resume a completed candidate2 workspace for one unchanged, free-only window."""
from __future__ import annotations

import argparse
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

TRANSITION_SHA = "db9663b71db63cdb50459e812cd2a41daab4d15c9b70bb709469bc7f0434e734"
SOURCE = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
INVENTORY_SHA = "ebeb5a3f1ab9a2152500ff7bf859b81e62101fe8b15b9c0e4d5bb51d5b40da40"
SOURCE_MANIFEST_SHA = "55017c503920ddf2d4083bee2425d4daed656cafd0d36e4f88a6352d5903d15d"
NATIVE_BUILD = "bf4939b3ff"
ORIGINAL_CACHE = 531472384
FORMAT = "yunipals-bounded-shadow-artifact-continuation-v2"
PLAN_KEYS = {"format", "runId", "freeOnly", "transitionHelper", "transitionPlanFile", "transitionReviewFile",
             "transitionMonitorFile", "previousMonitorFile"}
MONITORING_POLICY = {"localConfiguration": "every_sample", "liveChainId": "every_startup"}
MAX_LINEAGE = 128
LOCK = Path("/run/lock/yunipals-unified-shadow.lock")


def fail(message):
    raise RuntimeError(message)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return digest(encoded(value))


def trusted_file(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute():
        fail("Absolute protected operator input required.")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > maximum:
        fail("Bounded root-owned regular input required.")
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            fail("Operator input ancestry is writable or redirected.")
    return path.read_bytes()


def load_transition(path):
    contents = trusted_file(path)
    if not re.fullmatch(r"[0-9a-f]{64}", TRANSITION_SHA) or digest(contents) != TRANSITION_SHA:
        fail("Exact independently reviewed artifact transition helper required.")
    module = types.ModuleType("pinned_artifact_transition")
    module.__file__ = str(path)
    exec(compile(contents, str(path), "exec"), module.__dict__)
    return module


def validate_plan(plan):
    if (set(plan) != PLAN_KEYS or plan["format"] != FORMAT or plan["freeOnly"] is not True or
            not re.fullmatch(r"20261020-008028af-[a-z0-9]{1,16}", plan["runId"])):
        fail("Exact bounded candidate2 free-only continuation plan required.")
    for key in PLAN_KEYS - {"format", "runId", "freeOnly"}:
        if not isinstance(plan[key], str) or not Path(plan[key]).is_absolute():
            fail("Continuation evidence must use absolute paths.")


def load_plan(path):
    plan = json.loads(trusted_file(path))
    validate_plan(plan)
    transition = load_transition(plan["transitionHelper"])
    original_plan, cont = transition.load_plan(plan["transitionPlanFile"])
    return plan, transition, original_plan, cont


def report_directory(helper, run_id):
    # Reports are outside the retained workspace. Its code/launch/profile and
    # original transition-review/monitor remain immutable across every run.
    return helper.BASE / "artifact-continuations" / run_id


def lineage(plan, transition, transition_plan, cont, helper):
    raw = cont.trusted_file(plan["transitionReviewFile"])
    initial = json.loads(raw)
    binding = initial.get("binding", {})
    pins = transition_plan["candidate"]
    workspace = helper.BASE / transition_plan["runId"]
    if (canonical(binding) != initial.get("reviewHash") or binding.get("plan") != transition_plan or
            pins.get("sourceDigest") != SOURCE or pins.get("inventorySha256") != INVENTORY_SHA or
            pins.get("sourceManifestSha256") != SOURCE_MANIFEST_SHA or binding.get("candidateSourceDigest") != SOURCE or
            binding.get("candidateInventorySha256") != INVENTORY_SHA or binding.get("freeOnly") is not True or
            binding.get("launchGrantIds") != [] or binding.get("originalCacheBytes") != ORIGINAL_CACHE or
            binding.get("limits") != helper.resource_limits() or Path(plan["transitionReviewFile"]) != workspace / "transition-review.json" or
            Path(plan["transitionMonitorFile"]) != workspace / "monitor.jsonl"):
        fail("Successful first candidate transition provenance/resources differ.")
    first = cont.completed_report(plan["transitionMonitorFile"], workspace, NATIVE_BUILD)
    start = first["first"]
    if (start.get("artifactTransitionBinding") != binding or start.get("reviewHash") != initial["reviewHash"] or
            start.get("unit") != helper.unit_name(transition_plan) or start.get("limits") != helper.resource_limits() or
            start.get("baselineLegacyUnits") != binding.get("legacyUnits") or start.get("baselineActiveSelector") != binding.get("activeSelector") or
            first["last"].get("retainedSchema") != helper.SCHEMA):
        fail("First candidate monitor does not match its exact transition review.")
    reports, seen = [], set()
    path = Path(plan["previousMonitorFile"])
    self_sha = digest(trusted_file(Path(__file__).absolute()))
    while path != Path(plan["transitionMonitorFile"]):
        if str(path) in seen or len(reports) >= MAX_LINEAGE:
            fail("Candidate continuation lineage is cyclic or excessive.")
        seen.add(str(path))
        report = cont.completed_report(path, workspace, NATIVE_BUILD)
        current = report["first"].get("artifactContinuationBinding", {})
        prior = current.get("plan", {})
        validate_plan(prior)
        if (canonical(current) != report["first"].get("reviewHash") or
                any(prior.get(key) != plan[key] for key in ["transitionHelper", "transitionPlanFile", "transitionReviewFile", "transitionMonitorFile"]) or
                path != report_directory(helper, prior["runId"]) / "monitor.jsonl" or
                report["first"].get("unit") != helper.unit_name(prior) or report["first"].get("limits") != helper.resource_limits() or
                current.get("transitionReviewSha256") != digest(raw) or current.get("transitionReviewHash") != initial["reviewHash"] or
                current.get("transitionMonitorSha256") != first["sha256"] or
                current.get("transitionPlanSha256") != digest(cont.trusted_file(plan["transitionPlanFile"])) or
                current.get("transitionHelperSha256") != TRANSITION_SHA or current.get("artifactContinuationHelperSha256") != self_sha or
                current.get("workspace") != str(workspace) or current.get("candidateSourceDigest") != SOURCE or
                current.get("candidateInventorySha256") != INVENTORY_SHA or current.get("originalCacheBytes") != ORIGINAL_CACHE or
                current.get("freeOnly") is not True or current.get("launchGrantIds") != [] or current.get("limits") != helper.resource_limits() or
                report["last"].get("retainedSchema") != helper.SCHEMA or
                digest(cont.trusted_file(prior["previousMonitorFile"])) != current.get("predecessorMonitorSha256")):
            fail("A continuation changes original candidate provenance or its predecessor.")
        reports.append(report)
        path = Path(prior["previousMonitorFile"])
    reports.append(first)
    if plan["runId"] == transition_plan["runId"] or any(plan["runId"] == report["first"].get("artifactContinuationBinding", {}).get("plan", {}).get("runId") for report in reports):
        fail("Every continuation requires a new run/unit identity.")
    for newer, older in zip(reports, reports[1:]):
        current = newer["first"]["artifactContinuationBinding"]
        previous_metrics = older["last"]["after"].get("metrics", {})
        baseline_metrics = newer["first"].get("baselineMetrics", {})
        if (current.get("previousRuntime") != previous_metrics.get("runtime") or current.get("previousCheckpoints") != previous_metrics.get("checkpoints") or
                baseline_metrics.get("runtime") != current.get("previousRuntime") or baseline_metrics.get("checkpoints") != current.get("previousCheckpoints") or
                newer["first"].get("baselineLegacyUnits") != binding.get("legacyUnits") or
                newer["first"].get("baselineActiveSelector") != binding.get("activeSelector")):
            fail("Continuation metadata/checkpoint or legacy baseline does not follow its predecessor.")
    return initial, first, reports[0], reports, workspace


def candidate_workspace_proof(candidate, cont, workspace, manifest, inventory, env, transition_review_sha, transition_monitor_sha):
    account = pwd.getpwnam(candidate.USER)
    files = {row["path"]: row for row in manifest["files"]}
    files.update({name: {"path": name} for name in ["RELEASE-MANIFEST.json", "SHA256SUMS"]})
    files.update({row["path"]: row for row in inventory["entries"] if row["type"] == "file"})
    links = {row["path"]: row for row in inventory["entries"] if row["type"] == "symlink"}
    directories = {"."}
    for relative in [*files, *links, *(row["path"] for row in inventory["entries"] if row["type"] == "directory")]:
        current = Path(relative)
        if relative not in files and relative not in links:
            directories.add(relative)
        directories.update(str(parent) for parent in current.parents)
    state = Path("apps/yunipals-indexer/.ponder")
    declaration = "apps/yunipals-indexer/ponder-env.d.ts"
    extra = {"rpc-profile.json": Path(env["UNIFIED_RPC_PROFILE_FILE"]).read_bytes(),
             "launch.env": cont.launch_text(candidate, workspace, env, free_only=True).encode()}
    fixed_reports = {"transition-review.json": transition_review_sha, "monitor.jsonl": transition_monitor_sha}
    recorded = []
    info = workspace.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
        fail("Candidate retained workspace ownership changed.")
    for directory, children, names in os.walk(workspace, followlinks=False):
        for name in [*children, *names]:
            path = Path(directory) / name
            relative = str(path.relative_to(workspace))
            info = path.lstat()
            mutable = Path(relative) == state or Path(relative).is_relative_to(state)
            if mutable:
                if (not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)) or info.st_uid not in {0, account.pw_uid} or
                        info.st_mode & 0o022 or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1)):
                    fail("Mutable candidate state is redirected/shared/writable.")
            elif relative in links:
                row = links[relative]
                if (not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(path) != row["target"] or
                        not path.resolve(strict=True).is_relative_to(workspace)):
                    fail("Candidate retained runtime link changed or escapes the workspace.")
                recorded.append([relative, "link", row["target"]])
                continue
            elif relative in directories:
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
                    fail("Candidate retained runtime directory permissions changed.")
            else:
                if relative not in files and relative not in {*extra, *fixed_reports}:
                    fail("Unexpected candidate file outside mutable Ponder state.")
                expected_uid = account.pw_uid if relative == declaration else 0
                if not stat.S_ISREG(info.st_mode) or info.st_uid != expected_uid or info.st_mode & 0o022 or info.st_nlink != 1:
                    fail("Candidate retained runtime file ownership/type changed.")
                if relative in files:
                    source = candidate.SOURCE / relative
                    original = source.stat()
                    mode = 0o750 if original.st_mode & 0o111 else 0o640
                    if (info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != mode or
                            (info.st_ino == original.st_ino and info.st_dev == original.st_dev)):
                        fail("Candidate code must retain independent pinned read-only inodes.")
                    expected = cont.generated_declaration(candidate) if relative == declaration else source.read_bytes()
                    if digest(path.read_bytes()) != digest(expected):
                        fail("Candidate retained source/runtime/codegen bytes changed.")
                elif relative in extra and path.read_bytes() != extra[relative]:
                    fail("Candidate retained grant-free launch/profile changed.")
                elif relative in fixed_reports and candidate.sha(path) != fixed_reports[relative]:
                    fail("First candidate transition review/monitor changed.")
            if not stat.S_ISLNK(info.st_mode):
                recorded.append([relative, "directory" if path.is_dir() else "file", stat.S_IMODE(info.st_mode),
                                 info.st_uid, info.st_gid, None if path.is_dir() else candidate.sha(path)])
    paths = {row[0] for row in recorded}
    if (not set(files).issubset(paths) or not set(links).issubset(paths) or not (directories - {"."}).issubset(paths) or
            not {*extra, *fixed_reports, str(state)}.issubset(paths)):
        fail("Candidate retained workspace is incomplete.")
    return {"inventorySha256": canonical(sorted(recorded)), "regularFiles": sum(row[1] == "file" for row in recorded),
            "independentSourceInodes": True, "exactGeneratedDeclaration": True, "mutableStateRetained": True,
            "grantFreeLaunchRetained": True, "firstTransitionEvidenceRetained": True}


def review(plan, transition, transition_plan, cont, *, existing_report_dir=None):
    old = cont.load_helper(transition_plan["initialHelper"])
    original_plan, original, old_first, _, old_reports, old_workspace = cont.initial_evidence(old, transition.prior_plan(transition_plan))
    first_result, first, previous, reports, workspace = lineage(plan, transition, transition_plan, cont, old)
    root = first_result["binding"]
    _, old_manifest, old_inventory = old.frozen_runtime(original_plan)
    env = old.public_env(cont.trusted_file(original_plan["publicEnvFile"]).decode())
    profile = json.loads(cont.trusted_file(original_plan["profileFile"]))
    if (digest(cont.trusted_file(original_plan["publicEnvFile"])) != original["binding"]["publicEnvSha256"] or
            digest(cont.trusted_file(original_plan["profileFile"])) != original["binding"]["profileSha256"] or
            old_first["first"]["baselineMetrics"]["cacheBytes"] != ORIGINAL_CACHE or root["initialMonitorSha256"] != old_first["sha256"]):
        fail("Original configuration or cumulative cache anchor changed.")
    if cont.workspace_proof(old, old_workspace, old_manifest, old_inventory, env, old_first["sha256"]) != root["oldWorkspaceProof"]:
        fail("Original artifact workspace changed after the reviewed transition.")
    candidate = transition.candidate_adapter(cont, transition_plan)
    pins = transition_plan["candidate"]
    runtime_helper, manifest, inventory = candidate.frozen_runtime({**original_plan, "inventoryFile": pins["inventoryFile"]})
    evidence = json.loads(cont.trusted_file(pins["cleanEvidenceFile"]))
    if (digest(cont.trusted_file(pins["inventoryFile"])) != INVENTORY_SHA or digest(cont.trusted_file(pins["cleanEvidenceFile"])) != root["cleanEvidenceSha256"] or
            candidate.sha(candidate.SOURCE / "RELEASE-MANIFEST.json") != SOURCE_MANIFEST_SHA):
        fail("Candidate source/runtime/clean-build pins changed.")
    transition.validate_clean_evidence(evidence, pins, inventory, old.RUNTIME_HELPER_SHA)
    if (transition.source_diff(old_manifest, manifest) != root["sourceDiff"] or
            transition.runtime_diff(old.SOURCE, candidate.SOURCE, old_inventory, inventory, evidence["runtime"]["buildRoot"]) != root["runtimeDiff"]):
        fail("Candidate source or dependency/runtime diff changed.")
    if runtime_helper.bundle_proof(candidate.SOURCE, manifest) != inventory["bundleProof"]:
        fail("Candidate compiled source/bundle proof changed.")
    free_env = {key: value for key, value in env.items() if not key.startswith("UNIFIED_RPC_REPLAY_PERMIT_ID")}
    if candidate.native_profile(free_env) != root["identity"] or transition.offline_native_build(candidate, free_env) != root["nativeBuild"]:
        fail("Candidate native manifest/build differs from the retained physical source.")
    states, selector = old.service_states(old.LEGACY_UNITS), old.active_selector()
    if states != root["legacyUnits"] or selector != root["activeSelector"]:
        fail("Legacy services/proxies or active source changed since the first candidate run.")
    for report in [*old_reports, *reports]:
        own = old.own_state(report["first"]["unit"])
        if own["LoadState"] != "not-found" and own["ActiveState"] not in {"inactive", "failed"}:
            fail("A predecessor shadow process remains active.")
    for report in reports:
        if report["last"]["after"].get("legacyUnits") != states or report["last"]["after"].get("activeSelector") != selector:
            fail("A predecessor did not retain the exact legacy/source baseline.")
    unit = old.unit_name(plan)
    if old.service_states((unit,))[unit]["LoadState"] != "not-found":
        fail("Continuation needs a fresh unused transient unit name.")
    report_dir = report_directory(old, plan["runId"])
    if existing_report_dir is None:
        if report_dir.exists() or report_dir.is_symlink():
            fail("Continuation reports are retained and never overwritten.")
    elif (existing_report_dir != report_dir or report_dir.is_symlink() or report_dir.stat().st_uid != 0 or
          report_dir.stat().st_mode & 0o022 or list(report_dir.iterdir())):
        fail("Prepared continuation report directory differs or is not empty.")
    current_metrics = old.source_metrics()
    latest = previous["last"]["after"]["metrics"]
    if current_metrics.get("runtime") != latest.get("runtime") or current_metrics.get("checkpoints") != latest.get("checkpoints"):
        fail("Physical metadata/checkpoints changed after the completed predecessor.")
    policy = cont.free_policy_snapshot(old, env, profile)
    if old.peer_acl() != root["peer"] or cont.retained_policy_binding(old, policy, free_only=True) != root["policy"]:
        fail("Peer grants/profile/budget changed; renewal is unavailable.")
    physical = cont.runtime_proof(old, profile, transition.MANIFEST_HASH)
    cont.validate_runtime(physical, NATIVE_BUILD, len(profile["manifest"]["sources"]), latest)
    free = shutil.disk_usage(candidate.SOURCE).free
    if free < old.START_FREE or old.stop_reason({"freeBytes": free, "metrics": current_metrics, "legacyUnits": states, "activeSelector": selector},
                                               {"binding": root}, ORIGINAL_CACHE, 0):
        fail("Original cumulative resource guards prevent another window.")
    workspace_proof = candidate_workspace_proof(candidate, cont, workspace, manifest, inventory, free_env,
                                                digest(cont.trusted_file(plan["transitionReviewFile"])), first["sha256"])
    access = cont.workspace_access(candidate, workspace)
    launch = cont.launch_text(candidate, workspace, free_env, free_only=True)
    if digest(launch.encode()) != root["launchEnvSha256"]:
        fail("The first candidate's grant-free launch environment changed.")
    proxies = old.proxy_observation()
    old.validate_proxies(proxies, root["identity"])
    result_binding = {**root, "plan": plan, "transitionHelperSha256": TRANSITION_SHA,
                      "artifactContinuationHelperSha256": digest(trusted_file(Path(__file__).absolute())),
                      "transitionPlanSha256": digest(cont.trusted_file(plan["transitionPlanFile"])),
                      "transitionReviewSha256": digest(cont.trusted_file(plan["transitionReviewFile"])), "transitionReviewHash": first_result["reviewHash"],
                      "transitionMonitorSha256": first["sha256"], "predecessorMonitorSha256": previous["sha256"],
                      "workspace": str(workspace), "workspaceProof": workspace_proof, "monitoringPolicy": MONITORING_POLICY, "previousRuntime": latest["runtime"],
                      "previousCheckpoints": latest["checkpoints"], "originalCacheBytes": ORIGINAL_CACHE}
    result = {"reviewHash": canonical(result_binding), "binding": result_binding, "freeBytes": free, "metrics": current_metrics,
              "workspaceAccess": access, "proxies": proxies, "started": False}
    # This reuses the transition's complete proxy/rebase/source/ACL/policy and
    # lease checks, with current stopped checkpoints. Original transition paths
    # and their old predecessor SHA remain in the inherited binding unchanged.
    transition.startup_fence(transition_plan, cont, old, candidate, result, inventory, env, profile)
    return result, (old, candidate, inventory, env, free_env, profile, workspace, report_dir)


def validate_running(transition, transition_plan, cont, old, inventory, env, profile, result, sample):
    binding = result["binding"]
    if binding.get("monitoringPolicy") != MONITORING_POLICY:
        fail("Exact reviewed periodic/startup monitoring policy required.")
    old.validate_proxies(sample["proxies"], binding["identity"])
    if cont.retained_policy_binding(old, sample["policy"], free_only=True) != binding["policy"]:
        fail("Free-only profile/budget changed during continuation.")
    rebase, rebased = transition.legacy_rebase(transition_plan, cont, old, binding["oldLegacyUnits"], sample["legacyUnits"],
                                                binding["activeSelector"], binding["initialMonitorSha256"])
    if rebase != binding["legacyRebase"]:
        fail("Reviewed legacy baseline changed during continuation.")
    dependency, rebased = transition.dependency_rebase(transition_plan, cont, old, rebased, sample["legacyUnits"],
                                                       binding["activeSelector"], binding["initialMonitorSha256"])
    if dependency != binding["dependencyRebase"] or rebased != binding["rebasedLegacyUnits"]:
        fail("Reviewed dependency baseline changed during continuation.")
    if old.peer_acl() != binding["peer"]:
        fail("Source-role peer grants changed during continuation.")
    if transition.proxy_evidence(transition_plan, cont, old, inventory, binding["identity"], binding["rebasedLegacyUnits"], sample["legacyUnits"], verify_live_chain_id=False) != binding["proxyTransitions"]:
        fail("Proxy proof/runtime changed during continuation.")
    if transition.registered_source(old, profile) != binding["registeredSource"]:
        fail("Registered source identity changed during continuation.")
    cont.validate_runtime(cont.runtime_proof(old, profile, transition.MANIFEST_HASH), NATIVE_BUILD, len(profile["manifest"]["sources"]), {}, starting=False)


def apply(plan, transition, transition_plan, cont, expected):
    with open(LOCK, "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, prepared = review(plan, transition, transition_plan, cont)
        if result["reviewHash"] != expected:
            fail("Candidate continuation review changed; inspect it again.")
        old, candidate, inventory, env, free_env, profile, workspace, report_dir = prepared
        account = pwd.getpwnam(old.USER)
        parent = report_dir.parent
        parent.mkdir(mode=0o750, exist_ok=True)
        if parent.is_symlink() or parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022:
            fail("Continuation report parent is unprotected.")
        os.chown(parent, 0, account.pw_gid)
        parent.chmod(0o750)
        report_dir.mkdir(mode=0o750)
        os.chown(report_dir, 0, account.pw_gid)
        project, launch_file = workspace / "apps/yunipals-indexer", workspace / "launch.env"
        cont.validate_launch_text(candidate, launch_file.read_text(), free_only=True)
        preflight = old.command(["/usr/sbin/runuser", "-u", old.USER, "--", "/usr/bin/env", "-i", old.NODE,
                                 "--env-file=" + str(launch_file), "--import", "tsx", "scripts/unified-rpc-preflight.ts"],
                                cwd=project, env=old.ROLE_ENV, timeout=60)
        cont.validate_preflight(preflight, {"freeOnly": True}, old, env)
        again, _ = review(plan, transition, transition_plan, cont, existing_report_dir=report_dir)
        if again["reviewHash"] != expected:
            fail("Candidate continuation prerequisites changed during grant-free preflight.")
        (report_dir / "review.json").write_text(json.dumps(result, indent=2) + "\n")
        log, invocation, reason = report_dir / "monitor.jsonl", None, "monitor_error"
        started = time.monotonic()
        try:
            invocation = candidate.systemd_start(plan, project, launch_file, expected)
            old.emit(log, {"event": "started", "reviewHash": expected, "artifactContinuationBinding": result["binding"],
                           "unit": old.unit_name(plan), "invocation": invocation, "limits": old.resource_limits(),
                           "baselineMetrics": result["metrics"], "baselineLegacyUnits": result["binding"]["legacyUnits"],
                           "baselineActiveSelector": result["binding"]["activeSelector"]})
            while True:
                tick = time.monotonic()
                signal.setitimer(signal.ITIMER_REAL, 15)
                try:
                    own = old.own_state(old.unit_name(plan))
                    sample = {"freeBytes": shutil.disk_usage(candidate.SOURCE).free, "metrics": old.source_metrics(),
                              "legacyUnits": old.service_states(old.LEGACY_UNITS), "activeSelector": old.active_selector(),
                              "proxies": old.proxy_observation(), "policy": cont.free_policy_snapshot(old, env, profile)}
                    validate_running(transition, transition_plan, cont, old, inventory, env, profile, result, sample)
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                old.emit(log, {"event": "sample", "elapsed": round(tick - started, 2), "own": own, **sample})
                reason = old.stop_reason(sample, result, ORIGINAL_CACHE, time.monotonic() - started)
                if reason:
                    break
                if own["ActiveState"] in {"inactive", "failed"} or own["InvocationID"] != invocation:
                    reason = "shadow_exited" if own["ActiveState"] in {"inactive", "failed"} else "shadow_invocation_changed"
                    break
                time.sleep(max(0, old.INTERVAL - (time.monotonic() - tick)))
        except (KeyboardInterrupt, SystemExit):
            reason = "operator_interrupt"
        except Exception as error:
            reason = "monitor_prerequisite_unavailable"
            old.emit(log, {"event": "monitor_guard_failed", "errorClass": type(error).__name__})
        finally:
            stop_error = None
            try:
                old.stop_owned(old.unit_name(plan), invocation, expected)
            except Exception as error:
                stop_error = type(error).__name__
            after = {}
            for key, collect in [("legacyUnits", lambda: old.service_states(old.LEGACY_UNITS)), ("activeSelector", old.active_selector),
                                 ("proxies", old.proxy_observation), ("metrics", old.source_metrics)]:
                try:
                    after[key] = collect()
                except Exception as error:
                    after[key] = {"unavailable": type(error).__name__}
            old.emit(log, {"event": "stopped", "reason": reason, "elapsed": round(time.monotonic() - started, 2),
                           "retainedWorkspace": str(workspace), "retainedSchema": old.SCHEMA, "stopError": stop_error, "after": after})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--apply")
    args = parser.parse_args()
    if os.getuid() != 0 or socket.gethostname() != "yunipals-main":
        fail("Exact production root/host required.")
    plan, transition, transition_plan, cont = load_plan(args.plan)
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply):
            fail("Exact candidate continuation review hash required.")
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        apply(plan, transition, transition_plan, cont, args.apply)
    else:
        result, _ = review(plan, transition, transition_plan, cont)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
