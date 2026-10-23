#!/usr/bin/env python3
"""Review and resume one retained bounded shadow; no production work at import.

This operator helper does not renew permits, copy a release, edit Ponder
metadata, register a source, or change a selector. It uses only the exact
initial helper and the existing reviewed profile/permit identities.
"""
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

INITIAL_HELPER_SHA = "2df5367c59017d1b00e16644975a450e5aedb747c99d5d1eee9055a72fb7335f"
FORMAT = "yunipals-bounded-shadow-continuation-v1"
PLAN_KEYS = {"format", "runId", "initialHelper", "initialPlanFile", "initialReviewFile",
             "initialMonitorFile", "previousMonitorFile", "expectedBuildId", "freeOnly"}


def fail(message):
    raise RuntimeError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def trusted_file(path):
    path = Path(path)
    if not path.is_absolute():
        fail("Review inputs must use absolute paths.")
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        fail("Review inputs must be root-owned regular files without group/other writes.")
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            fail("Review input ancestry is writable or redirected.")
    return path.read_bytes()


def load_plan(path):
    plan = json.loads(trusted_file(path))
    if set(plan) != PLAN_KEYS or plan["format"] != FORMAT:
        fail("Unknown continuation plan fields.")
    if not re.fullmatch(r"20261020-7e7375b0-[a-z0-9]{1,16}", plan["runId"]):
        fail("Invalid fresh continuation run ID.")
    if not re.fullmatch(r"[0-9a-f]{10}", plan["expectedBuildId"]):
        fail("Use the exact first runtime's native Ponder build ID.")
    if type(plan["freeOnly"]) is not bool:
        fail("An explicit boolean freeOnly mode is required.")
    for key in PLAN_KEYS - {"format", "runId", "expectedBuildId", "freeOnly"}:
        if not isinstance(plan[key], str) or not Path(plan[key]).is_absolute():
            fail("Continuation inputs must use absolute paths.")
    return plan


def load_helper(path):
    contents = trusted_file(path)
    if digest(contents) != INITIAL_HELPER_SHA:
        fail("The original shadow helper differs from its frozen pin.")
    module = types.ModuleType("pinned_initial_shadow")
    module.__file__ = str(path)
    # Execute the checked bytes, without loading a stale Python bytecode cache.
    exec(compile(contents, str(path), "exec"), module.__dict__)
    return module


def completed_report(path, workspace, expected_build):
    contents = trusted_file(path)
    records = [json.loads(line) for line in contents.splitlines() if line.strip()]
    if (len(records) < 3 or records[0].get("event") != "started" or records[-1].get("event") != "stopped" or
            sum(row.get("event") == "started" for row in records) != 1 or
            sum(row.get("event") == "stopped" for row in records) != 1):
        fail("A complete, single-invocation predecessor monitor is required.")
    first, last = records[0], records[-1]
    metrics = last.get("after", {}).get("metrics", {})
    if (last.get("retainedWorkspace") != str(workspace) or last.get("stopError") is not None or
            metrics.get("runtime", {}).get("buildId") != expected_build or
            not isinstance(first.get("reviewHash"), str) or not re.fullmatch(r"[0-9a-f]{64}", first["reviewHash"]) or
            not first.get("invocation") or not isinstance(metrics.get("checkpoints"), list)):
        fail("Predecessor did not retain an identifiable stopped native runtime.")
    samples = [row for row in records if row.get("event") == "sample"]
    if not samples:
        fail("Predecessor monitoring evidence is incomplete.")
    return {"sha256": digest(contents), "first": first, "last": last, "samples": samples}


def initial_evidence(helper, plan):
    initial_plan = helper.load_plan(plan["initialPlanFile"])
    trusted_file(plan["initialPlanFile"])
    if initial_plan["runId"] == plan["runId"]:
        fail("A continuation needs a fresh unit/run ID.")
    workspace = helper.BASE / initial_plan["runId"]
    if Path(plan["initialMonitorFile"]) != workspace / "monitor.jsonl":
        fail("Initial monitor must belong to the exact retained workspace.")
    original = json.loads(trusted_file(plan["initialReviewFile"]))
    binding = original.get("binding", {})
    if (canonical(binding) != original.get("reviewHash") or binding.get("plan") != initial_plan or
            binding.get("source") != helper.SOURCE_DIGEST or binding.get("runtimeInventory") != helper.INVENTORY_SHA or
            binding.get("limits") != helper.resource_limits()):
        fail("Original review does not prove the frozen initial inputs.")
    first = completed_report(plan["initialMonitorFile"], workspace, plan["expectedBuildId"])
    if (first["first"]["reviewHash"] != original["reviewHash"] or
            first["first"].get("unit") != helper.unit_name(initial_plan) or
            first["last"].get("retainedSchema") != helper.SCHEMA or
            first["first"].get("baselineLegacyUnits") != binding.get("legacyUnits") or
            first["first"].get("baselineActiveSelector") != binding.get("activeSelector")):
        fail("Initial monitor does not match its reviewed invocation.")
    previous_path = Path(plan["previousMonitorFile"])
    seen, reports = set(), []
    while previous_path != Path(plan["initialMonitorFile"]):
        if str(previous_path) in seen or len(reports) >= 16:
            fail("Invalid or excessive continuation report lineage.")
        seen.add(str(previous_path))
        previous = completed_report(previous_path, workspace, plan["expectedBuildId"])
        start = previous["first"]
        previous_binding = start.get("continuationBinding", {})
        previous_plan = previous_binding.get("plan", {})
        if (canonical(previous_binding) != start["reviewHash"] or previous_plan.get("format") != FORMAT or
                previous_binding.get("initialMonitorSha256") != first["sha256"] or
                previous_binding.get("initialReviewSha256") != digest(trusted_file(plan["initialReviewFile"])) or
                previous_plan.get("expectedBuildId") != plan["expectedBuildId"] or
                previous_path != helper.BASE / "continuations" / previous_plan.get("runId", "") / "monitor.jsonl" or
                previous["last"].get("retainedSchema") != helper.SCHEMA):
            fail("Continuation lineage changes the original source or report.")
        predecessor_path = previous_plan.get("previousMonitorFile", "")
        if not predecessor_path or digest(trusted_file(predecessor_path)) != previous_binding.get("previousMonitorSha256"):
            fail("Continuation predecessor proof changed.")
        reports.append(previous)
        previous_path = Path(predecessor_path)
    reports.append(first)
    previous = reports[0]
    return initial_plan, original, first, previous, reports, workspace


def generated_declaration(helper):
    source = (helper.SOURCE / "apps/yunipals-indexer/node_modules/ponder/src/bin/utils/codegen.ts").read_text()
    matches = re.findall(r"export const ponderEnv = `([^`]*)`;", source)
    if len(matches) != 1 or "${" in matches[0] or "\\" in matches[0]:
        fail("Unsupported pinned Ponder declaration generator.")
    return matches[0].encode()


def launch_text(helper, workspace, env, *, free_only):
    values = {**env, **helper.RESOURCE_ENV, "UNIFIED_RPC_PROFILE_FILE": str(workspace / "rpc-profile.json"),
              "HOME": str(workspace / "apps/yunipals-indexer/.ponder"), "TMPDIR": "/tmp", "PATH": "/opt/node-v24.18.1/bin:/usr/bin:/bin"}
    if free_only:
        values = {key: value for key, value in values.items() if not key.startswith("UNIFIED_RPC_REPLAY_PERMIT_ID")}
    text = "".join(f"{key}={value}\n" for key, value in sorted(values.items()))
    validate_launch_text(helper, text, free_only=free_only)
    return text


def validate_launch_text(helper, text, *, free_only):
    values = {}
    allowed = helper.PUBLIC_KEYS | {"HOME", "TMPDIR", "PATH"}
    for line in text.splitlines():
        key, separator, value = line.partition("=")
        if separator != "=" or key not in allowed or key in values:
            fail("Continuation launch environment contains an unknown/duplicate key.")
        values[key] = value
    if free_only and any(key.startswith("UNIFIED_RPC_REPLAY_PERMIT_ID") for key in values):
        fail("Free-only continuation cannot contain any replay permit ID.")
    if values.get("UNIFIED_RPC_POLICY_REQUIRED") != "true":
        fail("Continuation cannot disable its reviewed RPC profile.")
    for key, value in helper.RESOURCE_ENV.items():
        if values.get(key) != value:
            fail("Continuation resources cannot change.")
    return values


def free_policy_snapshot(helper, env, profile):
    # Deliberately do not read or depend on replay permit rows in free-only
    # mode. Original permits may be exhausted/expired; no IDs are dispatched.
    value = helper.pg(f"""SELECT jsonb_build_object(
      'profile',(SELECT jsonb_build_object('id',profile_id,'enabled',enabled,'unexpired',expires_at>clock_timestamp(),
         'expiry',expires_at::text,'policyMatches',policy={helper.literal(json.dumps(profile))}::jsonb)
         FROM yunipals_market.unified_rpc_profile WHERE profile_id={helper.literal(env['UNIFIED_RPC_PROFILE_ID'])}),
      'budget',(SELECT jsonb_build_object('daily',daily_cu,'reserve',foreground_reserve_cu,'enabled',enabled)
         FROM yunipals_market.rpc_compute_budget WHERE scope={helper.literal(profile['scope'])}),
      'allocations',(SELECT jsonb_agg(jsonb_build_object('workload',workload,'daily',daily_cu,'priority',priority) ORDER BY workload)
         FROM yunipals_market.rpc_compute_allocation WHERE scope={helper.literal(profile['scope'])} AND workload IN('unified_source','unified_evidence')),
      'permits','[]'::jsonb)""", market=True)
    validate_free_policy(value, env)
    return value


def validate_free_policy(value, env):
    row, budget = value.get("profile") or {}, value.get("budget") or {}
    allocations = {row["workload"]: row for row in value.get("allocations") or []}
    if (row.get("id") != env["UNIFIED_RPC_PROFILE_ID"] or
            not all(row.get(key) for key in ["enabled", "unexpired", "policyMatches"]) or
            budget != {"daily": 1000000, "reserve": 200000, "enabled": True} or value.get("permits") != []):
        fail("Free-only profile/global budget prerequisite failed.")
    for key, maximum in [("unified_source", 25000), ("unified_evidence", 5000)]:
        allocation = allocations.get(key) or {}
        if allocation.get("priority") != "background" or not 0 < allocation.get("daily", 0) <= maximum:
            fail("Free-only bounded background allocation prerequisite failed.")


def policy_snapshot(plan, helper, env, profile):
    return free_policy_snapshot(helper, env, profile) if plan["freeOnly"] else helper.policy_snapshot(env, profile)


def retained_policy_binding(helper, policy, *, free_only):
    binding = helper.policy_binding(policy)
    if free_only:
        binding.pop("permits")
    return binding


def validate_preflight(text, plan, helper, env):
    result = json.loads(text)
    if (result.get("event") != "unified_rpc_preflight_passed" or result.get("profileId") != env["UNIFIED_RPC_PROFILE_ID"] or
            result.get("historicalReads") != 0):
        fail("Native continuation preflight identity differs from review.")
    diagnostics = result.get("diagnostics") or []
    expected = {(chain, workload) for chain in helper.PROXIES for workload in ["unified_source", "unified_evidence"]}
    if len(diagnostics) != len(expected) or {(row.get("chainId"), row.get("workload")) for row in diagnostics} != expected:
        fail("Native continuation preflight is incomplete.")
    for row in diagnostics:
        replay = row.get("replay") or {}
        if plan["freeOnly"]:
            if replay != {"mode": "free_only"}:
                fail("Free-only native preflight returned a replay grant.")
        elif replay.get("mode") != "bounded_replay" or replay.get("permitId") != env[f"UNIFIED_RPC_REPLAY_PERMIT_ID_{row['chainId']}"]:
            fail("Native continuation preflight changed its exact replay grant.")


def workspace_proof(helper, workspace, manifest, inventory, env, initial_monitor_sha):
    account = pwd.getpwnam(helper.USER)
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
    profile_path = workspace / "rpc-profile.json"
    extra = {"rpc-profile.json": Path(env["UNIFIED_RPC_PROFILE_FILE"]).read_bytes(),
             "launch.env": launch_text(helper, workspace, env, free_only=False).encode()}
    recorded = []
    info = workspace.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
        fail("Retained workspace ownership changed.")
    for directory, children, names in os.walk(workspace, followlinks=False):
        for name in [*children, *names]:
            path = Path(directory) / name
            relative = str(path.relative_to(workspace))
            info = path.lstat()
            mutable = Path(relative) == state or Path(relative).is_relative_to(state)
            if mutable:
                if (not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)) or info.st_uid not in {0, account.pw_uid} or
                        info.st_mode & 0o022 or (stat.S_ISREG(info.st_mode) and info.st_nlink != 1)):
                    fail("Mutable Ponder state contains redirected/shared/writable ancestry.")
            elif relative in links:
                row = links[relative]
                if (not stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or os.readlink(path) != row["target"] or
                        not path.resolve(strict=True).is_relative_to(workspace)):
                    fail("Retained runtime link changed or escapes the workspace.")
                recorded.append([relative, "link", row["target"]])
                continue
            elif relative in directories:
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != 0o750:
                    fail("Retained runtime directory permissions changed.")
            else:
                if relative not in files and relative not in {*extra, "monitor.jsonl"}:
                    fail("Unexpected file outside retained mutable Ponder state.")
                expected_uid = account.pw_uid if relative == declaration else 0
                if not stat.S_ISREG(info.st_mode) or info.st_uid != expected_uid or info.st_mode & 0o022 or info.st_nlink != 1:
                    fail("Retained runtime file ownership/type changed.")
                if relative in files:
                    source = helper.SOURCE / relative
                    source_info = source.stat()
                    expected_mode = 0o750 if source_info.st_mode & 0o111 else 0o640
                    if (info.st_gid != account.pw_gid or stat.S_IMODE(info.st_mode) != expected_mode or
                            (info.st_ino == source_info.st_ino and info.st_dev == source_info.st_dev)):
                        fail("Retained code must use independent, pinned read-only inodes.")
                    expected = generated_declaration(helper) if relative == declaration else source.read_bytes()
                    if digest(path.read_bytes()) != digest(expected):
                        fail("Retained source/runtime/codegen bytes differ from the frozen release.")
                elif relative in extra and path.read_bytes() != extra[relative]:
                    fail("Retained public launch inputs changed.")
                elif relative == "monitor.jsonl" and helper.sha(path) != initial_monitor_sha:
                    fail("Initial monitor changed during workspace verification.")
            if not stat.S_ISLNK(info.st_mode):
                recorded.append([relative, "directory" if path.is_dir() else "file", stat.S_IMODE(info.st_mode),
                                 info.st_uid, info.st_gid, None if path.is_dir() else helper.sha(path)])
    actual_paths = {row[0] for row in recorded}
    if (not set(files).issubset(actual_paths) or not set(links).issubset(actual_paths) or
            not (directories - {"."}).issubset(actual_paths) or not {*extra, "monitor.jsonl", str(state)}.issubset(actual_paths)):
        fail("Retained workspace is incomplete.")
    return {"inventorySha256": canonical(sorted(recorded)), "regularFiles": sum(row[1] == "file" for row in recorded),
            "independentSourceInodes": True, "exactGeneratedDeclaration": True, "mutableStateRetained": True}


def workspace_access(helper, workspace):
    code = r'''import json,os,pathlib,sys
r=pathlib.Path(sys.argv[1]); state=r/'apps/yunipals-indexer/.ponder'; declaration=r/'apps/yunipals-indexer/ponder-env.d.ts'
count=0
for directory,dirs,names in os.walk(r,followlinks=False):
 p=pathlib.Path(directory)
 if os.access(p,os.W_OK) and not p.is_relative_to(state):raise RuntimeError('unexpected writable directory')
 for name in names:
  q=p/name
  if not os.access(q,os.R_OK):raise RuntimeError('unreadable runtime file')
  if os.access(q,os.W_OK) and q!=declaration and not q.is_relative_to(state):raise RuntimeError('unexpected writable file')
  count+=1
if not os.access(state,os.W_OK) or not os.access(declaration,os.W_OK):raise RuntimeError('required codegen path unwritable')
print(json.dumps({'readableFiles':count,'onlyRequiredCodegenPathsWritable':True}))'''
    return json.loads(helper.command(["/usr/sbin/runuser", "-u", helper.USER, "--", "/usr/bin/python3", "-c", code, str(workspace)],
                                     env=helper.ROLE_ENV, timeout=30))


def runtime_proof(helper, profile, manifest_hash):
    expected = helper.literal(json.dumps(profile["manifest"]["sources"]))
    return helper.pg(f"""WITH expected AS(SELECT value AS definition FROM jsonb_array_elements({expected}::jsonb)),
      mismatches AS(SELECT e.definition FROM expected e FULL JOIN {helper.SCHEMA}.indexer_source s
        ON s.id=e.definition->>'id' WHERE s.id IS NULL OR e.definition IS NULL OR s.chain_id<>(e.definition->>'chainId')::bigint
        OR s.manifest_hash<>{helper.literal(manifest_hash)} OR s.definition::jsonb<>e.definition)
      SELECT jsonb_build_object('meta',(SELECT value FROM {helper.SCHEMA}._ponder_meta WHERE key='app'),
        'sourceCount',(SELECT count(*) FROM {helper.SCHEMA}.indexer_source),'sourceMismatches',(SELECT count(*) FROM mismatches),
        'activeRoleConnections',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename={helper.literal(helper.USER)}),
        'nowMs',floor(extract(epoch FROM clock_timestamp())*1000)::bigint)""")


def validate_runtime(value, expected_build, source_count, previous_metrics, *, starting=True):
    meta = value.get("meta") or {}
    if (meta.get("version") != "6" or meta.get("build_id") != expected_build or
            any(type(meta.get(key)) is not int for key in ["is_dev", "is_locked", "is_ready"]) or meta.get("is_dev") != 0 or
            meta.get("is_locked") not in {0, 1} or meta.get("is_ready") not in {0, 1} or
            not isinstance(meta.get("heartbeat_at"), int) or isinstance(meta.get("heartbeat_at"), bool) or
            not 0 <= meta["heartbeat_at"] <= value.get("nowMs", 0) + 5000 or
            value.get("sourceCount") != source_count or value.get("sourceMismatches") != 0):
        fail("Retained physical runtime/build/source proof changed or is unsupported.")
    if starting:
        if value.get("activeRoleConnections") != 0:
            fail("A source-role backend is still connected; do not run competing writers.")
        if meta["is_locked"] and meta["heartbeat_at"] + 25000 > value["nowMs"]:
            fail("Ponder's previous heartbeat lease has not expired.")
        previous = previous_metrics["runtime"]
        if (meta["heartbeat_at"] != previous["heartbeat"] or meta["build_id"] != previous["buildId"] or
                meta["is_ready"] != previous["ready"]):
            fail("Physical runtime changed since its completed predecessor report.")


def validate_spending(policy, reports):
    current = {row["id"]: row for row in policy["permits"]}
    for report in reports:
        for sample in report["samples"]:
            for old in sample.get("policy", {}).get("permits", []):
                if old["id"] not in current or current[old["id"]]["spent"] < old["spent"]:
                    fail("Retained permit spending decreased or changed identity.")


def review(plan, helper, *, existing_report_dir=None):
    initial_plan, original, first, previous, reports, workspace = initial_evidence(helper, plan)
    _, manifest, inventory = helper.frozen_runtime(initial_plan)
    env = helper.public_env(trusted_file(initial_plan["publicEnvFile"]).decode())
    profile = json.loads(trusted_file(initial_plan["profileFile"]))
    binding = original["binding"]
    if (helper.sha(initial_plan["publicEnvFile"]) != binding["publicEnvSha256"] or
            helper.sha(initial_plan["profileFile"]) != binding["profileSha256"] or
            env["UNIFIED_RPC_PROFILE_FILE"] != initial_plan["profileFile"]):
        fail("Continuation cannot renew/change the first profile, permits or public source configuration.")
    identity = helper.native_profile(env)
    if identity != binding["identity"]:
        fail("Continuation changes the source manifest/profile identity.")
    peer = helper.peer_acl()
    policy = policy_snapshot(plan, helper, env, profile)
    expected_policy = json.loads(json.dumps(binding["policy"]))
    if plan["freeOnly"]:
        expected_policy.pop("permits")
    if peer != binding["peer"] or retained_policy_binding(helper, policy, free_only=plan["freeOnly"]) != expected_policy:
        fail("Continuation changes the reviewed peer privileges or permit/policy limits.")
    if not plan["freeOnly"]:
        validate_spending(policy, reports)
    baseline = helper.service_states(helper.LEGACY_UNITS)
    selector = helper.active_selector()
    if baseline != binding["legacyUnits"] or selector != binding["activeSelector"]:
        fail("Legacy services or active source changed since the initial review.")
    for report in reports:
        own = helper.own_state(report["first"]["unit"])
        if own["LoadState"] != "not-found" and own["ActiveState"] not in {"inactive", "failed"}:
            fail("A predecessor shadow invocation remains active.")
        if (report["last"]["after"].get("legacyUnits") != baseline or
                report["last"]["after"].get("activeSelector") != selector):
            fail("Predecessor did not confirm unchanged legacy services/source.")
    unit = helper.unit_name(plan)
    if helper.service_states((unit,))[unit]["LoadState"] != "not-found":
        fail("Continuation requires a fresh unused transient unit name.")
    report_dir = helper.BASE / "continuations" / plan["runId"]
    if existing_report_dir is None:
        if report_dir.exists() or report_dir.is_symlink():
            fail("Continuation reports are retained and must never be overwritten.")
    else:
        if existing_report_dir != report_dir or report_dir.is_symlink() or report_dir.stat().st_uid != 0 or report_dir.stat().st_mode & 0o022:
            fail("Prepared continuation evidence directory differs from this review.")
        expected_names = {"launch.env"} if plan["freeOnly"] else set()
        if {path.name for path in report_dir.iterdir()} != expected_names:
            fail("Prepared continuation evidence must not overwrite retained reports.")
        if plan["freeOnly"]:
            text = trusted_file(report_dir / "launch.env").decode()
            validate_launch_text(helper, text, free_only=True)
            if text != launch_text(helper, workspace, env, free_only=True):
                fail("Prepared free-only launch environment changed.")
    helper.free_port()
    free = shutil.disk_usage(helper.SOURCE).free
    metrics = helper.source_metrics()
    old_metrics = previous["last"]["after"]["metrics"]
    if metrics.get("runtime") != old_metrics.get("runtime") or metrics.get("checkpoints") != old_metrics.get("checkpoints"):
        fail("Retained physical metadata/checkpoints changed after predecessor stop.")
    if free < helper.START_FREE:
        fail("Continuation still requires at least45GB free disk.")
    probe_sample = {"freeBytes": free, "metrics": metrics, "legacyUnits": baseline, "activeSelector": selector}
    original_cache = first["first"]["baselineMetrics"]["cacheBytes"]
    if helper.stop_reason(probe_sample, {"binding": binding}, original_cache, 0):
        fail("An original cumulative disk/schema/cache stop guard is already reached.")
    physical = runtime_proof(helper, profile, identity["manifestHash"])
    validate_runtime(physical, plan["expectedBuildId"], len(profile["manifest"]["sources"]), old_metrics)
    workspace_state = workspace_proof(helper, workspace, manifest, inventory, env, first["sha256"])
    access = workspace_access(helper, workspace)
    proxies = helper.proxy_observation()
    helper.validate_proxies(proxies, identity)
    selected_launch = launch_text(helper, workspace, env, free_only=plan["freeOnly"])
    result_binding = {"plan": plan, "initialHelperSha256": INITIAL_HELPER_SHA, "freeOnly": plan["freeOnly"],
                      "initialReviewSha256": digest(trusted_file(plan["initialReviewFile"])),
                      "initialMonitorSha256": first["sha256"], "previousMonitorSha256": previous["sha256"],
                      "workspace": str(workspace), "workspaceProof": workspace_state,
                      "source": helper.SOURCE_DIGEST, "runtimeInventory": helper.INVENTORY_SHA,
                      "identity": identity, "peer": peer, "policy": retained_policy_binding(helper, policy, free_only=plan["freeOnly"]),
                      "launchEnvSha256": digest(selected_launch.encode()), "launchGrantIds": [] if plan["freeOnly"] else sorted(env[f"UNIFIED_RPC_REPLAY_PERMIT_ID_{chain}"] for chain in helper.PROXIES),
                      "legacyUnits": baseline, "activeSelector": selector, "limits": helper.resource_limits(),
                      "nativeBuildId": plan["expectedBuildId"], "previousRuntime": old_metrics["runtime"],
                      "previousCheckpoints": old_metrics["checkpoints"], "originalCacheBytes": original_cache}
    return {"reviewHash": canonical(result_binding), "binding": result_binding, "freeBytes": free,
            "metrics": metrics, "workspaceAccess": access, "proxies": proxies,
            "remainingPermitCu": [{"chain": row["chain"], "remaining": row["maximum"] - row["spent"]} for row in policy["permits"]]}, (env, profile, workspace, report_dir, reports)


def apply(plan, helper, expected):
    with open("/run/lock/yunipals-unified-shadow.lock", "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, prepared = review(plan, helper)
        if result["reviewHash"] != expected:
            fail("Continuation review changed; inspect the current proof again.")
        env, profile, workspace, report_dir, reports = prepared
        project = workspace / "apps/yunipals-indexer"
        # The original launch.env is immutable. Free-only authorization lives
        # in a new per-invocation file containing no global/per-chain permits.
        parent = report_dir.parent
        account = pwd.getpwnam(helper.USER)
        parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        if parent.is_symlink() or parent.stat().st_uid != 0 or parent.stat().st_mode & 0o022:
            fail("Continuation evidence parent must remain root-owned/read-only to others.")
        os.chown(parent, 0, account.pw_gid)
        parent.chmod(0o750)
        report_dir.mkdir(mode=0o750)
        os.chown(report_dir, 0, account.pw_gid)
        env_file = workspace / "launch.env"
        if plan["freeOnly"]:
            env_file = report_dir / "launch.env"
            text = launch_text(helper, workspace, env, free_only=True)
            if digest(text.encode()) != result["binding"]["launchEnvSha256"]:
                fail("Free-only launch inputs changed after review.")
            with env_file.open("x") as output:
                output.write(text)
            env_file.chmod(0o640)
            os.chown(env_file, 0, account.pw_gid)
            validate_launch_text(helper, env_file.read_text(), free_only=True)
        preflight = helper.command(["/usr/sbin/runuser", "-u", helper.USER, "--", "/usr/bin/env", "-i", helper.NODE,
                                   "--env-file=" + str(env_file), "--import", "tsx", "scripts/unified-rpc-preflight.ts"],
                                  cwd=project, env=helper.ROLE_ENV, timeout=60)
        validate_preflight(preflight, plan, helper, env)
        # The preflight cannot write source state. Repeat the full review to
        # close changed inputs, codegen/cache, role, policy, unit and port gaps.
        # This invocation's evidence directory now exists intentionally. Only
        # the current review's own empty/preflight inputs may occupy it.
        again, _ = review(plan, helper, existing_report_dir=report_dir)
        if again["reviewHash"] != expected:
            fail("Continuation prerequisites changed during native preflight.")
        # Keep a high-water mark for this invocation too, rather than checking
        # spending only against earlier completed invocations.
        if not plan["freeOnly"]:
            reports = [*reports, {"samples": [{"policy": policy_snapshot(plan, helper, env, profile)}]}]
        (report_dir / "review.json").write_text(json.dumps(result, indent=2) + "\n")
        log = report_dir / "monitor.jsonl"
        invocation = None
        reason = "monitor_error"
        started = time.monotonic()
        try:
            invocation = helper.systemd_start(plan, project, env_file, expected)
            helper.emit(log, {"event": "started", "reviewHash": expected, "continuationBinding": result["binding"],
                              "unit": helper.unit_name(plan), "invocation": invocation, "limits": helper.resource_limits(),
                              "baselineMetrics": result["metrics"], "baselineLegacyUnits": result["binding"]["legacyUnits"],
                              "baselineActiveSelector": result["binding"]["activeSelector"]})
            while True:
                tick = time.monotonic()
                signal.setitimer(signal.ITIMER_REAL, 15)
                try:
                    own = helper.own_state(helper.unit_name(plan))
                    sample = {"freeBytes": shutil.disk_usage(helper.SOURCE).free, "metrics": helper.source_metrics(),
                              "legacyUnits": helper.service_states(helper.LEGACY_UNITS), "activeSelector": helper.active_selector(),
                              "proxies": helper.proxy_observation(), "policy": policy_snapshot(plan, helper, env, profile)}
                    helper.validate_proxies(sample["proxies"], result["binding"]["identity"])
                    if retained_policy_binding(helper, sample["policy"], free_only=plan["freeOnly"]) != result["binding"]["policy"]:
                        fail("Retained permit/profile policy changed during continuation.")
                    if not plan["freeOnly"]:
                        validate_spending(sample["policy"], reports)
                    physical = runtime_proof(helper, profile, result["binding"]["identity"]["manifestHash"])
                    validate_runtime(physical, plan["expectedBuildId"], len(profile["manifest"]["sources"]), {}, starting=False)
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                helper.emit(log, {"event": "sample", "elapsed": round(tick - started, 2), "own": own, **sample})
                reports.append({"samples": [{"policy": sample["policy"]}]})
                reason = helper.stop_reason(sample, result, result["binding"]["originalCacheBytes"], time.monotonic() - started)
                if reason:
                    break
                if own["ActiveState"] in {"inactive", "failed"}:
                    reason = "shadow_exited"
                    break
                if own["InvocationID"] != invocation:
                    reason = "shadow_invocation_changed"
                    break
                time.sleep(max(0, helper.INTERVAL - (time.monotonic() - tick)))
        except (KeyboardInterrupt, SystemExit):
            reason = "operator_interrupt"
        except Exception as error:
            reason = "monitor_prerequisite_unavailable"
            helper.emit(log, {"event": "monitor_guard_failed", "errorClass": type(error).__name__})
        finally:
            stop_error = None
            try:
                helper.stop_owned(helper.unit_name(plan), invocation, expected)
            except Exception as error:
                stop_error = type(error).__name__
            after = {}
            for key, collect in [("legacyUnits", lambda: helper.service_states(helper.LEGACY_UNITS)),
                                 ("activeSelector", helper.active_selector), ("proxies", helper.proxy_observation),
                                 ("metrics", helper.source_metrics)]:
                try:
                    after[key] = collect()
                except Exception as error:
                    after[key] = {"unavailable": type(error).__name__}
            helper.emit(log, {"event": "stopped", "reason": reason, "elapsed": round(time.monotonic() - started, 2),
                              "retainedWorkspace": str(workspace), "retainedSchema": helper.SCHEMA, "stopError": stop_error, "after": after})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--apply")
    args = parser.parse_args()
    if os.getuid() != 0 or socket.gethostname() != "yunipals-main":
        fail("This operator helper targets root on yunipals-main only.")
    plan = load_plan(args.plan)
    helper = load_helper(plan["initialHelper"])
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply):
            fail("An exact reviewed continuation hash is required.")
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        apply(plan, helper, args.apply)
    else:
        result, _ = review(plan, helper)
        print(json.dumps({**result, "started": False}, indent=2))


if __name__ == "__main__":
    main()
