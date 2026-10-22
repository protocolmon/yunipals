#!/usr/bin/env python3
"""Review an explicit free-only transition between two frozen shadow artifacts.

The original physical schema, source manifest, native build and first workspace
are retained. Only a separately verified independent candidate workspace is
started. This helper never upgrades proxies, changes a selector, renews a grant,
edits Ponder metadata or resets data.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import grp
import pwd
import re
import shutil
import signal
import socket
import stat
import time
import types
import urllib.request

CONTINUATION_SHA = "3b97a328befe9bb702cd8d40bf2c5f97993895ecff588a62f98cda1f5dd3ae2f"
PROXY_HELPER_SHA = "ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965"
NATIVE_BUILD = "bf4939b3ff"
NATIVE_COMPONENTS = {"configHash": "5a654d5f904c5159dbf137c5cc27dd3202d2579cf71dc3aac88ab76daaad7852",
                     "schemaHash": "f4522b6a4b90a56ed63468a70b9a03941d184d3f22f592afdb672952d22957f6",
                     "indexingHash": "8fdfce8c688a96a995023887e62ae028128c0db59d78f93025d2de63938e5af3"}
MANIFEST_HASH = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029"
OLD_BUILD_ROOT = "/tmp/yunipals-unified-release-RLacGK/unpacked"
MODULES_SHAS = ("3f1379517265cb68dd9bba0a4a1b8b0644944abbf1194cde52b9341b91d9b7df", "7e9a8649e938f941d8606d6f5412561e327caa652a0a7515965b7f0056fbad65")
RELEASE_BASE = Path("/opt/yunipals-unified/releases")
PROXY_PROOF_BASE = Path("/var/backups/yunipals-unified-free-replay-proxies-20261020")
RUNTIME_FILES = {
    "apps/yunipals-indexer/lib/unified/rpc-preflight.ts",
    "apps/yunipals-indexer/lib/unified/rpc.ts",
    "apps/yunipals-market-api/src/rpcBudgetProxy.ts"
}
DIST_FILES = {"apps/yunipals-market-api/dist/rpc-budget-proxy.mjs", "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs.map"}
CHAINS = {"1": "ethereum", "8453": "base", "137": "polygon", "56": "bnb"}
LEGACY_WORKERS = {"yunipals-market-production-read@base.service": "opensea-read-worker.mjs",
                  "yunipals-market-production-read@ethereum.service": "opensea-read-worker.mjs",
                  "yunipals-market-production-signature.service": "opensea-signature-fleet.mjs"}
LEGACY_DEPENDENCIES = {"yunipals-indexer.service", "yunipals-bnb.service", "yunipals-metadata.service",
                       "yunipals-api.service", "yunipals-leaderboard.service"}
FORMAT = "yunipals-bounded-shadow-artifact-transition-v1"
PLAN_KEYS = {"format", "runId", "freeOnly", "initialHelper", "continuationHelper", "initialPlanFile", "initialReviewFile",
             "initialMonitorFile", "previousMonitorFile", "expectedBuildId", "candidate", "proxyProofDirectories", "proxyHelper",
             "legacyRebaseFile", "legacyRebaseSha256", "dependencyRebaseFile", "dependencyRebaseSha256"}
CANDIDATE_KEYS = {"sourceRoot", "sourceDigest", "sourceManifestSha256", "inventoryFile", "inventorySha256", "cleanEvidenceFile", "cleanEvidenceSha256"}


def fail(message):
    raise RuntimeError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def root_group_is_exclusive():
    accounts = {account.pw_name: account for account in pwd.getpwall()}
    if any(account.pw_uid != 0 and account.pw_gid == 0 for account in accounts.values()):
        return False
    return all(name in accounts and accounts[name].pw_uid == 0 for name in grp.getgrgid(0).gr_mem)


def legacy_runtime_file(path, maximum=40_000_000):
    """Hash-only legacy code reader; never used for operator/candidate inputs."""
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        fail("An absolute plain legacy runtime file is required.")
    needs_root_group = False
    for item in [*path.parents, path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o002:
            fail("Legacy runtime source is redirected, not root-owned, or other-writable.")
        if info.st_mode & 0o020:
            if info.st_gid != 0:
                fail("Only the exclusive root group may have legacy code write permission.")
            needs_root_group = True
    if needs_root_group and not root_group_is_exclusive():
        fail("A nonroot account can write the legacy root group; refuse its code.")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        fail("Bounded regular legacy code is required.")
    return path.read_bytes()


def load_continuation(path):
    path = Path(path)
    info = path.lstat()
    if not path.is_absolute() or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        fail("Use a root-owned regular pinned continuation helper.")
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX):
            fail("Continuation helper ancestry is redirected/writable.")
    contents = path.read_bytes()
    if digest(contents) != CONTINUATION_SHA:
        fail("Continuation helper differs from its reviewed pin.")
    module = types.ModuleType("pinned_continuation")
    module.__file__ = str(path)
    exec(compile(contents, str(path), "exec"), module.__dict__)
    return module


def load_plan(path):
    # Only this bootstrap field is read before loading the pinned file checker.
    initial = json.loads(Path(path).read_text())
    cont = load_continuation(initial.get("continuationHelper", ""))
    plan = json.loads(cont.trusted_file(path))
    if set(plan) != PLAN_KEYS or plan["format"] != FORMAT or plan["freeOnly"] is not True or plan["expectedBuildId"] != NATIVE_BUILD:
        fail("An exact free-only artifact transition plan is required.")
    candidate = plan["candidate"]
    if set(candidate) != CANDIDATE_KEYS or not re.fullmatch(r"[0-9a-f]{64}", candidate["sourceDigest"]):
        fail("Invalid candidate source pins.")
    if (Path(candidate["sourceRoot"]) != RELEASE_BASE / candidate["sourceDigest"] or
            not re.fullmatch(r"20261020-" + candidate["sourceDigest"][:8] + r"-[a-z0-9]{1,16}", plan["runId"])):
        fail("Candidate source/workspace must use its independently reviewed digest.")
    for key in ["sourceManifestSha256", "inventorySha256", "cleanEvidenceSha256"]:
        if not re.fullmatch(r"[0-9a-f]{64}", candidate[key]):
            fail("Missing independently supplied candidate checksum.")
    if any(not re.fullmatch(r"[0-9a-f]{64}", plan[key]) for key in ["legacyRebaseSha256", "dependencyRebaseSha256"]):
        fail("Separately reviewed worker and dependency rebase pins are required.")
    for key in ["initialHelper", "continuationHelper", "initialPlanFile", "initialReviewFile", "initialMonitorFile", "previousMonitorFile", "proxyHelper", "legacyRebaseFile", "dependencyRebaseFile"]:
        if not isinstance(plan[key], str) or not Path(plan[key]).is_absolute():
            fail("Transition evidence must use absolute paths.")
    for key in ["inventoryFile", "cleanEvidenceFile"]:
        if not isinstance(candidate[key], str) or not Path(candidate[key]).is_absolute():
            fail("Candidate evidence must use absolute paths.")
    if set(plan["proxyProofDirectories"]) != set(CHAINS):
        fail("Four reviewed proxy transitions are required.")
    for chain, directory in plan["proxyProofDirectories"].items():
        path = Path(directory)
        if path.parent != PROXY_PROOF_BASE / CHAINS[chain] or not re.fullmatch(r"[0-9a-f]{64}", path.name):
            fail("Use the exact retained per-chain proxy review directory.")
    return plan, cont


def prior_plan(plan):
    # This describes the OLD retained artifact only. No old helper review is
    # called with candidate pins or an empty-schema exception.
    return {"format": "yunipals-bounded-shadow-continuation-v1", "runId": "20261020-7e7375b0-transition",
            "freeOnly": True, **{key: plan[key] for key in ["initialHelper", "initialPlanFile", "initialReviewFile", "initialMonitorFile", "previousMonitorFile", "expectedBuildId"]}}


def nonruntime_source(path):
    name = Path(path).name
    if name in {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc"}:
        return False
    return (path.startswith("ops/unified-indexer/") or path.startswith("docs/unified-indexer/") or
            (path.startswith("apps/yunipals-indexer/scripts/fixtures/") and path.endswith(".mjs")) or
            (path.startswith("apps/yunipals-indexer/scripts/test-") and path.endswith(".mjs")) or
            (path.startswith("apps/yunipals-indexer/test/") and path.endswith(".test.ts")) or
            (path.startswith("apps/yunipals-market-api/src/") and path.endswith(".test.ts")))


def source_diff(old, new):
    left, right = ({row["path"]: row for row in manifest["files"]} for manifest in [old, new])
    differences = []
    runtime = set()
    for path in sorted(set(left) | set(right)):
        if left.get(path) == right.get(path):
            continue
        if path in RUNTIME_FILES:
            if path not in left or path not in right:
                fail("A reviewed runtime file cannot be added/removed.")
            runtime.add(path)
            kind = "reviewed_runtime"
        elif nonruntime_source(path):
            kind = "nonruntime_test_ops_or_evidence"
        else:
            fail("Candidate changes protected callback/schema/config/ABI/migration/dependency source: " + path)
        differences.append({"path": path, "kind": kind, "old": left.get(path), "new": right.get(path)})
    if runtime != RUNTIME_FILES:
        fail("Candidate must contain exactly the three reviewed runtime changes.")
    return {"sha256": canonical(differences), "differences": differences}


def validate_clean_evidence(evidence, candidate, inventory, helper_sha):
    check = evidence.get("verification") or {}
    source = evidence.get("source") or {}
    runtime = evidence.get("runtime") or {}
    install = check.get("offlineInstall") or {}
    native = check.get("nativeBuild") or {}
    verified = check.get("runtimeArchiveVerified") or {}
    relocated = check.get("cleanRelocationInstall") or {}
    catalog = check.get("catalogSmoke") or {}
    if (evidence.get("format") != "yunipals-unified-release-candidate2-evidence-v1" or
            evidence.get("status") != "passed_local_clean_offline_build_and_reproducibility" or
            evidence.get("sourceDigest") != candidate["sourceDigest"] or evidence.get("nativeBuildId") != NATIVE_BUILD or
            evidence.get("manifestHash") != MANIFEST_HASH or source.get("sourceManifestSha256") != candidate["sourceManifestSha256"] or
            source.get("lockfileSha256") != inventory.get("lockfileSha256") or
            runtime.get("inventorySha256") != candidate["inventorySha256"] or runtime.get("archiveSha256") != inventory.get("archiveSha256") or
            runtime.get("helperSha256") != helper_sha or not re.fullmatch(r"/tmp/yunipals-unified-release-[A-Za-z0-9]+/unpacked", runtime.get("buildRoot", ""))):
        fail("Candidate clean offline evidence/pins differ from review.")
    if (install.get("frozenLockfile") is not True or install.get("offline") is not True or install.get("ignoreScripts") is not True or
            install.get("downloads") != 0 or install.get("packages") != 330 or
            any(check.get(key) is not True for key in ["indexerTypecheck", "marketTypecheck", "marketBuild", "sourceReverified", "sourceArchiveByteIdentical", "runtimeArchiveByteIdentical"]) or
            catalog.get("islands") != 898 or catalog.get("identityProfiles") != 4 or check.get("marketEntrypoints") != 34 or
            native.get("buildId") != NATIVE_BUILD or native.get("expectedInitialProductionBuild") != NATIVE_BUILD or
            any(native.get(key) != value for key, value in NATIVE_COMPONENTS.items()) or
            native.get("unchanged") is not True or native.get("manifestHash") != MANIFEST_HASH or
            native.get("realProviderCalls") != 0 or native.get("databaseConnections") != 0 or
            verified.get("command") != "verify" or relocated.get("command") != "install" or
            any(item.get("sourceDigest") != candidate["sourceDigest"] or item.get("entriesVerified") != len(inventory["entries"]) or
                item.get("networkCalls") != 0 or item.get("sourceUnchanged") is not True for item in [verified, relocated]) or
            relocated.get("installedRoots") != inventory.get("roots")):
        fail("Candidate lacks complete clean offline build/catalog/reproducibility proof.")


def runtime_diff(old_root, new_root, old, new, build_root):
    if old.get("lockfileSha256") != new.get("lockfileSha256") or old.get("runtime") != new.get("runtime"):
        fail("Candidate changes dependency lockfile or runtime platform.")
    left, right = ({row["path"]: row for row in inventory["entries"]} for inventory in [old, new])
    if set(left) != set(right):
        fail("Candidate changes installed dependency/bundle file closure.")
    changes = []
    for path in sorted(left):
        before, after = left[path], right[path]
        if before == after:
            continue
        if before["type"] != after["type"] or before["mode"] != after["mode"]:
            fail("Candidate changes runtime entry type/mode.")
        if path in DIST_FILES and after["type"] == "file":
            changes.append({"path": path, "kind": "reviewed_proxy_bundle", "old": before["sha256"], "new": after["sha256"]})
            continue
        if path == "node_modules/.modules.yaml" and after["type"] == "file":
            before_lines = (old_root / path).read_text().splitlines(keepends=True)
            after_lines = (new_root / path).read_text().splitlines(keepends=True)
            if (len(before_lines) != len(after_lines) or (before["sha256"], after["sha256"]) != MODULES_SHAS):
                fail("Candidate changes unreviewed pnpm metadata bytes.")
            delta = [(a, b) for a, b in zip(before_lines, after_lines) if a != b]
            if len(delta) != 1 or any(not re.fullmatch(r"prunedAt: [A-Za-z]{3}, \d\d [A-Za-z]{3} \d{4} \d\d:\d\d:\d\d GMT\n?", line) for line in delta[0]):
                fail("Candidate changes pnpm metadata beyond its exact reviewed prune timestamp.")
            changes.append({"path": path, "kind": "exact_reviewed_generated_pruned_timestamp", "old": before["sha256"], "new": after["sha256"]})
            continue
        if "/.bin/" in path and after["type"] == "file":
            original = (old_root / path).read_bytes()
            candidate = (new_root / path).read_bytes()
            if (len(original) > 262144 or len(candidate) > 262144 or not original.startswith(b"#!/bin/sh") or
                    OLD_BUILD_ROOT.encode() not in original or build_root.encode() not in candidate or
                    original.replace(OLD_BUILD_ROOT.encode(), b"<CLEAN_BUILD_ROOT>") != candidate.replace(build_root.encode(), b"<CLEAN_BUILD_ROOT>")):
                fail("Candidate changes generated shim semantics or dependency bytes.")
            changes.append({"path": path, "kind": "generated_shim_exact_build_root_substitution", "old": before["sha256"], "new": after["sha256"]})
            continue
        fail("Candidate changes protected dependency/runtime bytes: " + path)
    if {row["path"] for row in changes if row["kind"] == "reviewed_proxy_bundle"} != DIST_FILES:
        fail("Candidate must change exactly the reviewed proxy bundle and sourcemap.")
    return {"sha256": canonical(changes), "changes": changes, "dependencyPackagesUnchanged": True}


def load_proxy_verifier(plan, cont):
    contents = cont.trusted_file(plan["proxyHelper"])
    if digest(contents) != PROXY_HELPER_SHA:
        fail("Proxy verifier differs from its independently reviewed pin.")
    verifier = types.ModuleType("pinned_proxy_verifier")
    verifier.__file__ = plan["proxyHelper"]
    exec(compile(contents, plan["proxyHelper"], "exec"), verifier.__dict__)
    original_run = verifier.run
    def bounded_run(args, *, timeout=30, data=None):
        return original_run(args, timeout=min(timeout, 2), data=data)
    def bounded_request(port, path, payload=None, headers=None):
        if port not in {item[1] for item in verifier.CHAINS.values()} or path not in {"/", "/health", "/metrics"}:
            fail("Unexpected proxy monitoring route.")
        if payload is not None and (path != "/" or payload != {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}):
            fail("Only the existing free chain identity probe is allowed.")
        body = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body,
                                         headers={"Content-Type": "application/json", **(headers or {})})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), verifier.NoRedirect())
        with opener.open(request, timeout=3) as response:
            contents = response.read(2000001)
        if len(contents) > 2000000:
            fail("Oversized proxy monitor response.")
        result = json.loads(contents)
        if not isinstance(result, dict):
            fail("Unexpected proxy monitor response shape.")
        return result
    # Narrower monitoring deadlines only; verifier routing/configuration and
    # private-setting comparisons remain its independently reviewed code.
    verifier.run = bounded_run
    verifier.request = bounded_request
    return verifier


def proxy_evidence(plan, cont, helper, inventory, identity, old_states, current_states):
    verifier = load_proxy_verifier(plan, cont)
    runtime_sha = next(row["sha256"] for row in inventory["entries"] if row["path"] == "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs")
    allowed_units = {f"yunipals-market-production-rpc@{name}.service" for name in CHAINS.values()}
    for unit in old_states:
        if unit not in allowed_units and current_states.get(unit) != old_states[unit]:
            fail("An unrelated legacy unit changed across artifact transition.")
    source_root = Path(plan["candidate"]["sourceRoot"])
    entry = source_root / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs"
    def one(item):
        chain, name = item
        unit = f"yunipals-market-production-rpc@{name}.service"
        directory = Path(plan["proxyProofDirectories"][chain])
        review_bytes, result_bytes = cont.trusted_file(directory / "review.json"), cont.trusted_file(directory / "result.json")
        review, result = json.loads(review_bytes), json.loads(result_bytes)
        expected_override = Path(f"/etc/systemd/system/{unit}.d/zzzzzzz-unified-free-replay-20261020.conf")
        override = cont.trusted_file(expected_override)
        if (canonical(review) != directory.name or result.get("reviewHash") != directory.name or result.get("review") != review or
                result.get("applied") is not True or result.get("legacyHealthPassed") is not True or result.get("legacyConfigurationPreserved") is not True or
                any(result.get(key) is not False for key in ["privateSettingsChanged", "ingestorStarted", "sourceSelectionChanged"]) or
                result.get("verifyExecStart") is not True or result.get("unit") != unit or result.get("chainId") != int(chain) or
                result.get("sourceRoot") != str(source_root) or result.get("sourceDigest") != plan["candidate"]["sourceDigest"] or
                result.get("profileId") != identity["profileId"] or result.get("runtimeSha256") != runtime_sha or
                result.get("runtimeInventorySha256") != plan["candidate"]["inventorySha256"] or
                result.get("runtimeArchiveSha256") != inventory["archiveSha256"] or result.get("overridePath") != str(expected_override) or
                result.get("overrideSha256") != digest(override) or review.get("override") != override.decode() or
                result.get("beforeInvocationId") != old_states[unit]["InvocationID"] or
                result.get("afterInvocationId") != current_states[unit]["InvocationID"] or
                current_states[unit].get("ActiveState") != "active" or current_states[unit].get("SubState") != "running"):
            fail("Proxy transition lacks exact applied source/runtime/config/invocation proof.")
        properties = verifier.state(unit)
        verifier.verify_exec_start(properties, source_root)
        definitions = verifier.definitions(properties)
        if definitions.pop(str(expected_override), None) != digest(override):
            fail("Current proxy does not retain the exact applied override.")
        if (definitions != review.get("originalDefinitionHashes") or verifier.private_settings(properties) != review.get("privateSettings") or
                properties.get("InvocationID") != result["afterInvocationId"] or
                verifier.legacy_health(verifier.CHAINS[name][1], int(chain)) != review.get("legacyConfiguration")):
            fail("Current proxy unit no longer selects the reviewed candidate runtime.")
        return {"chainId": int(chain), "unit": unit, "reviewSha256": digest(review_bytes), "resultSha256": digest(result_bytes),
                "overrideSha256": digest(override), "afterInvocationId": result["afterInvocationId"], "runtimeSha256": runtime_sha}
    with ThreadPoolExecutor(max_workers=4) as pool:
        proofs = list(pool.map(one, CHAINS.items()))
    return {"sha256": canonical(proofs), "proofs": proofs}


def registered_source(helper, profile):
    exists = helper.pg("SELECT to_json(to_regclass('yunipals_indexer_control.release') IS NOT NULL)")
    if not exists:
        fail("The retained source must already have its expected registered release.")
    expected = helper.literal(json.dumps(profile["manifest"]))
    rows = helper.pg(f"""SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'schema',physical_schema,'buildId',build_id,
      'manifestHash',manifest_hash,'manifestExact',(manifest-'sources')=({expected}::jsonb-'sources') AND
        (SELECT jsonb_agg(value ORDER BY value->>'id') FROM jsonb_array_elements(manifest->'sources'))=
        (SELECT jsonb_agg(value ORDER BY value->>'id') FROM jsonb_array_elements({expected}::jsonb->'sources'))) ORDER BY id),'[]'::jsonb)
      FROM yunipals_indexer_control.release WHERE physical_schema={helper.literal(helper.SCHEMA)}""")
    expected_id = "0x" + canonical({"schema": helper.SCHEMA, "buildId": NATIVE_BUILD, "manifestHash": MANIFEST_HASH})
    if len(rows) != 1 or any(row != {"id": expected_id, "schema": helper.SCHEMA, "buildId": NATIVE_BUILD,
                                  "manifestHash": MANIFEST_HASH, "manifestExact": True} for row in rows):
        fail("Registered source identity differs from the retained physical schema/build/manifest.")
    return rows


def legacy_rebase(plan, cont, helper, old_states, current_states, selector, initial_monitor_sha):
    contents = cont.trusted_file(plan["legacyRebaseFile"])
    if digest(contents) != plan["legacyRebaseSha256"]:
        fail("Legacy worker rebase differs from its explicitly reviewed pin.")
    proof = json.loads(contents)
    if (proof.get("format") != "yunipals-market-legacy-worker-rebase-v1" or proof.get("sourceDigest") != helper.SOURCE_DIGEST or
            proof.get("initialMonitorSha256") != initial_monitor_sha or proof.get("sourceSelectionBefore") != selector or
            proof.get("sourceSelectionAfter") != selector or proof.get("dependencyRebaseFile") != plan["dependencyRebaseFile"] or
            proof.get("dependencyRebaseSha256") != plan["dependencyRebaseSha256"]):
        fail("Legacy rebase changes the original source or selector.")
    restoration_bytes = cont.trusted_file(proof["restorationReviewFile"])
    if digest(restoration_bytes) != proof.get("restorationReviewSha256"):
        fail("Original compatible-worker restoration evidence changed.")
    restoration = json.loads(restoration_bytes)
    restoration = restoration.get("restoration", restoration)
    rows = restoration.get("review") or []
    if (canonical(rows) != restoration.get("reviewHash") or restoration.get("applied") is not True or
            restoration.get("sourceSelectionChanged") is not False or restoration.get("environmentFilesChanged") is not False or
            {row.get("unit") for row in rows} != set(LEGACY_WORKERS) or len(rows) != len(LEGACY_WORKERS)):
        fail("Original compatible-worker restoration proof is incomplete.")
    workers = proof.get("workers") or []
    if {row.get("unit") for row in workers} != set(LEGACY_WORKERS) or len(workers) != len(LEGACY_WORKERS):
        fail("Only the three explicitly reviewed active legacy workers may rebase.")
    verifier = load_proxy_verifier(plan, cont)
    restored = {row["unit"]: row for row in rows}
    baseline = json.loads(json.dumps(old_states))
    def one(row):
        unit = row["unit"]
        before, after = old_states[unit], current_states[unit]
        entry = str(helper.SOURCE / "apps/yunipals-market-api/dist" / LEGACY_WORKERS[unit])
        cwd = str(helper.SOURCE / "apps/yunipals-market-api")
        if (row.get("beforeState") != before or row.get("afterState") != after or before.get("ActiveState") != "active" or before.get("SubState") != "running" or
                after.get("ActiveState") != "active" or after.get("SubState") != "running" or row.get("healthy") is not True or row.get("result") != "success" or
                row.get("execPath") != helper.NODE or row.get("execArgv") != [helper.NODE, entry] or row.get("workingDirectory") != cwd):
            fail("Legacy worker rebase changes an unapproved identity/runtime or inactive worker.")
        properties = verifier.state(unit)
        if (re.findall(r"argv\[\]=(.*?)\s+;", properties["ExecStart"]) != [helper.NODE + " " + entry] or
                re.findall(r"(?:^|[ {;])path=([^ ;]+)", properties["ExecStart"]) != [helper.NODE] or
                properties.get("WorkingDirectory") != cwd or properties.get("InvocationID") != after["InvocationID"] or
                verifier.private_settings(properties) != row.get("privateSettings") or
                verifier.run(["/usr/bin/systemctl", "show", unit, "--property=Result"]).strip() != "Result=success"):
            fail("Current legacy worker runtime/private settings or result changed.")
        definitions = verifier.definitions(properties)
        original_definitions = restored[unit]["originalDefinitionHashes"]
        extras = set(definitions) - set(original_definitions)
        if (definitions != row.get("definitions") or len(extras) != 1 or
                {path: value for path, value in definitions.items() if path not in extras} != original_definitions or
                any(Path(path).parent != Path("/etc/systemd/system") / (unit + ".d") or
                    definitions[path] != digest(restored[unit]["override"].encode()) for path in extras)):
            fail("Legacy worker definitions differ from the exact compatible restoration.")
        return unit, {"beforeState": before, "afterState": after, "definitionsSha256": canonical(definitions),
                      "privateSettingsSha256": canonical(row["privateSettings"]), "runtime": entry}
    with ThreadPoolExecutor(max_workers=3) as pool:
        checked = dict(pool.map(one, workers))
    for unit in checked:
        baseline[unit] = current_states[unit]
    return {"sha256": digest(contents), "restorationSha256": digest(restoration_bytes), "workers": checked}, baseline


def dependency_rebase(plan, cont, helper, old_states, current_states, selector, initial_monitor_sha):
    contents = cont.trusted_file(plan["dependencyRebaseFile"])
    if digest(contents) != plan["dependencyRebaseSha256"]:
        fail("Dependency rebase differs from its separately reviewed pin.")
    proof = json.loads(contents)
    if (proof.get("format") != "yunipals-legacy-evm-dependency-rebase-v1" or
            proof.get("initialMonitorSha256") != initial_monitor_sha or proof.get("sourceSelectionBefore") != selector or
            proof.get("sourceSelectionAfter") != selector):
        fail("Dependency rebase changes the original source or monitor origin.")
    before_bytes = cont.trusted_file(proof["beforeEvidenceFile"])
    if digest(before_bytes) != proof.get("beforeEvidenceSha256"):
        fail("Archived before evidence differs from its reviewed checksum.")
    before = json.loads(before_bytes)
    before_rows = before.get("services") or []
    rows = proof.get("services") or []
    if (before.get("format") != "yunipals-legacy-evm-dependency-before-v1" or
            len(rows) != len(LEGACY_DEPENDENCIES) or {row.get("unit") for row in rows} != LEGACY_DEPENDENCIES or
            len(before_rows) != len(LEGACY_DEPENDENCIES) or {row.get("unit") for row in before_rows} != LEGACY_DEPENDENCIES):
        fail("Exactly the five separately proven legacy dependencies are required.")
    archived = {row["unit"]: row for row in before_rows}
    verifier = load_proxy_verifier(plan, cont)
    baseline = json.loads(json.dumps(old_states))
    def one(row):
        unit = row["unit"]
        prior, after = old_states[unit], current_states[unit]
        if (row.get("beforeState") != prior or row.get("afterState") != after or prior.get("ActiveState") != "active" or
                prior.get("SubState") != "running" or after.get("ActiveState") != "active" or after.get("SubState") != "running" or
                row.get("healthy") is not True or row.get("result") != "success"):
            fail("A dependency rebase has an unreviewed origin or unhealthy current invocation.")
        properties = verifier.state(unit)
        argv, path = row.get("execArgv"), row.get("execPath")
        if (not isinstance(argv, list) or not argv or not all(isinstance(value, str) and value and not re.search(r"[\s;{}]", value) for value in argv) or
                argv[0] != path or not Path(path).is_absolute() or
                re.findall(r"argv\[\]=(.*?)\s+;", properties["ExecStart"]) != [" ".join(argv)] or
                re.findall(r"(?:^|[ {;])path=([^ ;]+)", properties["ExecStart"]) != [path] or
                properties.get("WorkingDirectory") != row.get("workingDirectory") or properties.get("InvocationID") != after["InvocationID"] or
                verifier.private_settings(properties) != row.get("privateSettings") or
                verifier.run(["/usr/bin/systemctl", "show", unit, "--property=Result"]).strip() != "Result=success"):
            fail("A dependency rebase changes its exact runtime/private configuration.")
        definitions, files = row.get("definitions"), row.get("runtimeFiles")
        if (not definitions or definitions != archived[unit].get("definitions") or verifier.definitions(properties) != definitions or
                not isinstance(files, dict) or not files or len(files) > 2000 or files != archived[unit].get("runtimeFiles")):
            fail("Dependency definitions/runtime files differ from the archived before evidence.")
        for filename, expected in files.items():
            name = Path(filename)
            if (not name.is_absolute() or name.name.startswith(".env") or name.suffix == ".env" or
                    not re.fullmatch(r"[0-9a-f]{64}", expected) or digest(legacy_runtime_file(filename)) != expected):
                fail("Dependency runtime source file differs from its before evidence.")
        additional = row.get("additionalCurrentEntrypointPins") or {}
        if (not isinstance(additional, dict) or set(additional) != ({argv[-1]} if unit == "yunipals-metadata.service" else set())):
            fail("Only the metadata current entrypoint requires one explicitly qualified additional pin.")
        for filename, expected in additional.items():
            if (not Path(filename).is_absolute() or not re.fullmatch(r"[0-9a-f]{64}", expected) or
                    digest(legacy_runtime_file(filename)) != expected):
                fail("The separately qualified current metadata entrypoint changed.")
        return unit, {"beforeState": prior, "afterState": after, "definitionsSha256": canonical(definitions),
                      "runtimeFilesSha256": canonical(files), "additionalCurrentEntrypointPinsSha256": canonical(additional),
                      "privateSettingsSha256": canonical(row["privateSettings"])}
    with ThreadPoolExecutor(max_workers=5) as pool:
        checked = dict(pool.map(one, rows))
    for unit in checked:
        baseline[unit] = current_states[unit]
    return {"sha256": digest(contents), "beforeEvidenceSha256": digest(before_bytes), "services": checked}, baseline


def candidate_adapter(cont, plan):
    # Explicitly separate the candidate's generic file-copy/launch functions
    # from the immutable old-source verifier. Never call either initial review
    # with an empty-schema exception or silently replace its old source pins.
    candidate = cont.load_helper(plan["initialHelper"])
    candidate.SOURCE = Path(plan["candidate"]["sourceRoot"])
    candidate.SOURCE_DIGEST = plan["candidate"]["sourceDigest"]
    candidate.INVENTORY_SHA = plan["candidate"]["inventorySha256"]
    return candidate


def offline_native_build(candidate, env):
    code = r'''import {readFileSync,realpathSync} from 'node:fs';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import path from 'node:path';
const require=createRequire(realpathSync('./node_modules/ponder/package.json'));const {globSync}=require('glob');const superjson=require('superjson').default;
const policy=await import('../../packages/yunipals-indexer-server/src/rpc-policy.ts');const profile=JSON.parse(readFileSync(process.env.UNIFIED_RPC_PROFILE_FILE,'utf8'));let calls=0;
globalThis.fetch=async(input,options={})=>{const u=new URL(input);const chain=({19201:1,19202:8453,19203:137,19204:56})[u.port];if(u.hostname!=='127.0.0.1'||!chain)throw Error('offline only');calls++;
if(u.pathname==='/unified/preflight')return new Response(JSON.stringify({profileId:policy.unifiedRpcProfileId(profile),manifestHash:policy.unifiedRpcManifestId(profile),chainId:chain,coordinatorId:profile.coordinatorId,scope:profile.scope,workload:options.headers['x-yunipals-rpc-workload'],paid:'explicit_bounded_permit_only',budget:{},replay:{mode:'free_only'}}));
if(u.pathname==='/unified'&&JSON.parse(options.body).method==='eth_chainId')return new Response(JSON.stringify({result:'0x'+chain.toString(16)}));throw Error('offline only');};
const {default:config}=await import('./ponder.config.ts');const hash=v=>createHash('sha256').update(v).digest('hex');const configHash=hash(superjson.stringify({ordering:config.ordering,contracts:config.contracts,accounts:config.accounts,blocks:config.blocks}));const schemaHash=hash(readFileSync('ponder.schema.ts','utf8'));const root=process.cwd();
const files=globSync(path.join(root,'src/**/*.{js,mjs,ts,mts}'),{ignore:[path.join(root,'src/api/**/*.{js,mjs,ts,mts}'),path.join(root,'src/**/*.{test,spec}.{js,mjs,ts,mts}')]});const h=createHash('sha256');for(const file of files)h.update(readFileSync(file,'utf8'));const indexingHash=h.digest('hex');
console.log(JSON.stringify({buildId:hash('2'+configHash+schemaHash+indexingHash).slice(0,10),configHash,schemaHash,indexingHash,indexingFiles:files.map(f=>path.relative(root,f)),offlineInterceptedFetches:calls,realRpcRequests:0}));'''
    value = json.loads(candidate.command([candidate.NODE, "--import", "tsx", "--input-type=module", "-e", code],
                                        env={**candidate.ROLE_ENV, **env}, cwd=candidate.SOURCE / "apps/yunipals-indexer", timeout=30))
    if (value.get("buildId") != NATIVE_BUILD or any(value.get(key) != expected for key, expected in NATIVE_COMPONENTS.items()) or
            value.get("realRpcRequests") != 0 or value.get("offlineInterceptedFetches") != 12):
        fail("Candidate native build differs from the retained physical schema.")
    return value


def review(plan, cont):
    old = cont.load_helper(plan["initialHelper"])
    original_plan, original, first, previous, reports, old_workspace = cont.initial_evidence(old, prior_plan(plan))
    runtime_helper, old_manifest, old_inventory = old.frozen_runtime(original_plan)
    env = old.public_env(cont.trusted_file(original_plan["publicEnvFile"]).decode())
    profile = json.loads(cont.trusted_file(original_plan["profileFile"]))
    binding = original["binding"]
    if (old.sha(original_plan["publicEnvFile"]) != binding["publicEnvSha256"] or old.sha(original_plan["profileFile"]) != binding["profileSha256"]):
        fail("Original source/profile inputs changed; no renewal is supported.")
    old_identity = old.native_profile(env)
    if old_identity != binding["identity"] or old_identity["manifestHash"] != MANIFEST_HASH:
        fail("Retained source manifest/profile changed.")
    old_workspace_proof = cont.workspace_proof(old, old_workspace, old_manifest, old_inventory, env, first["sha256"])
    old_access = cont.workspace_access(old, old_workspace)
    candidate = candidate_adapter(cont, plan)
    if candidate.SOURCE_DIGEST == old.SOURCE_DIGEST:
        fail("This is an explicit new-artifact transition, not an old-artifact continuation.")
    pins = plan["candidate"]
    if old.sha(pins["inventoryFile"]) != pins["inventorySha256"] or old.sha(pins["cleanEvidenceFile"]) != pins["cleanEvidenceSha256"]:
        fail("Candidate external proof checksums differ.")
    cont.trusted_file(pins["inventoryFile"])
    evidence = json.loads(cont.trusted_file(pins["cleanEvidenceFile"]))
    candidate_plan = {**original_plan, "inventoryFile": pins["inventoryFile"]}
    _, candidate_manifest, inventory = candidate.frozen_runtime(candidate_plan)
    if old.sha(candidate.SOURCE / "RELEASE-MANIFEST.json") != pins["sourceManifestSha256"]:
        fail("Candidate source manifest file pin differs.")
    validate_clean_evidence(evidence, pins, inventory, old.RUNTIME_HELPER_SHA)
    source_changes = source_diff(old_manifest, candidate_manifest)
    dependencies = runtime_diff(old.SOURCE, candidate.SOURCE, old_inventory, inventory, evidence["runtime"]["buildRoot"])
    actual_bundle = runtime_helper.bundle_proof(candidate.SOURCE, candidate_manifest)
    if actual_bundle != inventory["bundleProof"]:
        fail("Candidate compiled bundle/source catalog proof changed.")
    identity = candidate.native_profile(env)
    if identity != old_identity:
        fail("Candidate source manifest/profile differs from the retained physical source.")
    free_env = {key: value for key, value in env.items() if not key.startswith("UNIFIED_RPC_REPLAY_PERMIT_ID")}
    native = offline_native_build(candidate, free_env)
    peer = old.peer_acl()
    policy = cont.free_policy_snapshot(old, env, profile)
    expected_policy = json.loads(json.dumps(binding["policy"]))
    expected_policy.pop("permits")
    if peer != binding["peer"] or cont.retained_policy_binding(old, policy, free_only=True) != expected_policy:
        fail("Peer grants or approved free-only profile/budget changed.")
    metrics = old.source_metrics()
    previous_metrics = previous["last"]["after"]["metrics"]
    if metrics.get("runtime") != previous_metrics.get("runtime") or metrics.get("checkpoints") != previous_metrics.get("checkpoints"):
        fail("Retained physical runtime/checkpoints changed since the completed old sample.")
    physical = cont.runtime_proof(old, profile, MANIFEST_HASH)
    cont.validate_runtime(physical, NATIVE_BUILD, len(profile["manifest"]["sources"]), previous_metrics)
    for report in reports:
        state = old.own_state(report["first"]["unit"])
        if state["LoadState"] != "not-found" and state["ActiveState"] not in {"inactive", "failed"}:
            fail("An old shadow process is still active.")
    states = old.service_states(old.LEGACY_UNITS)
    selector = old.active_selector()
    if selector != binding["activeSelector"]:
        fail("Active source selector changed across artifact transition.")
    old_states = previous["last"]["after"]["legacyUnits"]
    rebase, rebased_states = legacy_rebase(plan, cont, old, old_states, states, selector, first["sha256"])
    dependencies_rebase, rebased_states = dependency_rebase(plan, cont, old, rebased_states, states, selector, first["sha256"])
    proxy = proxy_evidence(plan, cont, old, inventory, identity, rebased_states, states)
    proxies = old.proxy_observation()
    old.validate_proxies(proxies, identity)
    old.free_port()
    unit = old.unit_name(plan)
    if old.service_states((unit,))[unit]["LoadState"] != "not-found":
        fail("Transition requires a fresh unused transient unit.")
    workspace = old.BASE / plan["runId"]
    if workspace.exists() or workspace.is_symlink():
        fail("Transition requires a new independent workspace.")
    free = shutil.disk_usage(candidate.SOURCE).free
    if free < old.START_FREE:
        fail("At least45GB free space is required before a transition copy.")
    initial_cache = first["first"]["baselineMetrics"]["cacheBytes"]
    if old.stop_reason({"freeBytes": free, "metrics": metrics, "legacyUnits": states, "activeSelector": selector},
                       {"binding": {"legacyUnits": states, "activeSelector": selector}}, initial_cache, 0):
        fail("An original cumulative resource guard has already been exceeded.")
    launch = cont.launch_text(candidate, workspace, free_env, free_only=True)
    result_binding = {"plan": plan, "initialHelperSha256": cont.INITIAL_HELPER_SHA, "continuationHelperSha256": CONTINUATION_SHA,
                      "initialPlanSha256": digest(cont.trusted_file(plan["initialPlanFile"])),
                      "initialReviewSha256": digest(cont.trusted_file(plan["initialReviewFile"])), "initialMonitorSha256": first["sha256"],
                      "previousMonitorSha256": previous["sha256"], "oldSourceDigest": old.SOURCE_DIGEST, "oldWorkspace": str(old_workspace),
                      "oldWorkspaceProof": old_workspace_proof, "candidateSourceDigest": candidate.SOURCE_DIGEST,
                      "candidateInventorySha256": pins["inventorySha256"], "cleanEvidenceSha256": pins["cleanEvidenceSha256"],
                      "sourceDiff": source_changes, "runtimeDiff": dependencies, "nativeBuild": native,
                      "identity": identity, "peer": peer, "policy": cont.retained_policy_binding(old, policy, free_only=True),
                      "oldLegacyUnits": previous["last"]["after"]["legacyUnits"],
                      "legacyRebase": rebase, "dependencyRebase": dependencies_rebase, "rebasedLegacyUnits": rebased_states,
                      "registeredSource": registered_source(old, profile), "proxyHelperSha256": PROXY_HELPER_SHA,
                      "legacyUnits": states, "activeSelector": selector, "proxyTransitions": proxy,
                      "previousRuntime": previous_metrics["runtime"], "previousCheckpoints": previous_metrics["checkpoints"],
                      "originalCacheBytes": initial_cache, "freeOnly": True, "launchGrantIds": [],
                      "launchEnvSha256": digest(launch.encode()), "limits": old.resource_limits()}
    result = {"reviewHash": canonical(result_binding), "binding": result_binding, "freeBytes": free,
              "metrics": metrics, "oldWorkspaceAccess": old_access, "proxies": proxies, "started": False}
    return result, (old, candidate, original_plan, candidate_manifest, inventory, env, free_env, profile, workspace)


def startup_fence(plan, cont, old, candidate, result, inventory, env, profile):
    binding = result["binding"]
    for path, expected in [(plan["initialPlanFile"], binding["initialPlanSha256"]),
                           (plan["initialReviewFile"], binding["initialReviewSha256"]),
                           (plan["initialMonitorFile"], binding["initialMonitorSha256"]),
                           (plan["previousMonitorFile"], binding["previousMonitorSha256"]),
                           (plan["candidate"]["cleanEvidenceFile"], binding["cleanEvidenceSha256"]),
                           (plan["candidate"]["inventoryFile"], binding["candidateInventorySha256"])]:
        if digest(cont.trusted_file(path)) != expected:
            fail("Reviewed artifact/source evidence changed during preparation.")
    states = old.service_states(old.LEGACY_UNITS)
    metrics = old.source_metrics()
    if (states != result["binding"]["legacyUnits"] or old.active_selector() != result["binding"]["activeSelector"] or
            old.peer_acl() != result["binding"]["peer"] or metrics.get("runtime") != result["binding"]["previousRuntime"] or
            metrics.get("checkpoints") != result["binding"]["previousCheckpoints"]):
        fail("Source/role/legacy selection changed during transition preparation.")
    if registered_source(old, profile) != result["binding"]["registeredSource"]:
        fail("Registered source identity changed during transition preparation.")
    rebase, rebased = legacy_rebase(plan, cont, old, binding["oldLegacyUnits"], states, binding["activeSelector"], binding["initialMonitorSha256"])
    dependencies_rebase, rebased = dependency_rebase(plan, cont, old, rebased, states, binding["activeSelector"], binding["initialMonitorSha256"])
    if rebase != binding["legacyRebase"] or dependencies_rebase != binding["dependencyRebase"] or rebased != binding["rebasedLegacyUnits"]:
        fail("Reviewed compatible legacy worker baseline changed during preparation.")
    if cont.retained_policy_binding(old, cont.free_policy_snapshot(old, env, profile), free_only=True) != result["binding"]["policy"]:
        fail("Free-only policy changed during transition preparation.")
    proxy = proxy_evidence(plan, cont, old, inventory, result["binding"]["identity"], result["binding"]["rebasedLegacyUnits"], states)
    if proxy != result["binding"]["proxyTransitions"]:
        fail("Proxy proof changed during transition preparation.")
    physical = cont.runtime_proof(old, profile, MANIFEST_HASH)
    cont.validate_runtime(physical, NATIVE_BUILD, len(profile["manifest"]["sources"]), result["metrics"])
    if shutil.disk_usage(candidate.SOURCE).free < old.START_FREE:
        fail("Transition free-space start guard changed after preparation.")
    old.free_port()


def apply(plan, cont, expected):
    with open("/run/lock/yunipals-unified-shadow.lock", "a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, prepared = review(plan, cont)
        if result["reviewHash"] != expected:
            fail("Artifact transition review changed; inspect current evidence.")
        old, candidate, original_plan, manifest, inventory, env, free_env, profile, workspace = prepared
        copy_plan = {"runId": plan["runId"], "profileFile": original_plan["profileFile"]}
        base, project, launch_file = candidate.copy_workspace(copy_plan, manifest, inventory, free_env)
        if base != workspace or digest(launch_file.read_bytes()) != result["binding"]["launchEnvSha256"]:
            fail("Candidate copy/launch environment differs from review.")
        cont.validate_launch_text(candidate, launch_file.read_text(), free_only=True)
        access = candidate.workspace_access(base)
        # Do not rerun an empty/fresh workspace review after copying. Recheck
        # the concrete fixed inputs, stopped physical source and proxy epochs.
        _, old_manifest, old_inventory = old.frozen_runtime(original_plan)
        candidate.frozen_runtime({**original_plan, "inventoryFile": plan["candidate"]["inventoryFile"]})
        startup_fence(plan, cont, old, candidate, result, inventory, env, profile)
        preflight = old.command(["/usr/sbin/runuser", "-u", old.USER, "--", "/usr/bin/env", "-i", old.NODE,
                                 "--env-file=" + str(launch_file), "--import", "tsx", "scripts/unified-rpc-preflight.ts"],
                                cwd=project, env=old.ROLE_ENV, timeout=60)
        cont.validate_preflight(preflight, {"freeOnly": True}, old, env)
        if digest(launch_file.read_bytes()) != result["binding"]["launchEnvSha256"]:
            fail("Grant-free launch environment changed during native preflight.")
        cont.validate_launch_text(candidate, launch_file.read_text(), free_only=True)
        old_workspace = Path(result["binding"]["oldWorkspace"])
        if cont.workspace_proof(old, old_workspace, old_manifest, old_inventory, env, result["binding"]["initialMonitorSha256"]) != result["binding"]["oldWorkspaceProof"]:
            fail("Original retained workspace changed during candidate preparation.")
        startup_fence(plan, cont, old, candidate, result, inventory, env, profile)
        (base / "transition-review.json").write_text(json.dumps(result, indent=2) + "\n")
        log = base / "monitor.jsonl"
        invocation, reason = None, "monitor_error"
        started = time.monotonic()
        try:
            invocation = candidate.systemd_start(plan, project, launch_file, expected)
            old.emit(log, {"event": "started", "reviewHash": expected, "artifactTransitionBinding": result["binding"], "unit": old.unit_name(plan),
                           "invocation": invocation, "limits": old.resource_limits(), "baselineMetrics": result["metrics"],
                           "baselineLegacyUnits": result["binding"]["legacyUnits"], "baselineActiveSelector": result["binding"]["activeSelector"],
                           "workspaceAccess": access})
            while True:
                tick = time.monotonic()
                signal.setitimer(signal.ITIMER_REAL, 15)
                try:
                    own = old.own_state(old.unit_name(plan))
                    sample = {"freeBytes": shutil.disk_usage(candidate.SOURCE).free, "metrics": old.source_metrics(),
                              "legacyUnits": old.service_states(old.LEGACY_UNITS), "activeSelector": old.active_selector(),
                              "proxies": old.proxy_observation(), "policy": cont.free_policy_snapshot(old, env, profile)}
                    old.validate_proxies(sample["proxies"], result["binding"]["identity"])
                    if cont.retained_policy_binding(old, sample["policy"], free_only=True) != result["binding"]["policy"]:
                        fail("Free-only profile/budget changed during transition sample.")
                    rebase, rebased = legacy_rebase(plan, cont, old, result["binding"]["oldLegacyUnits"], sample["legacyUnits"], result["binding"]["activeSelector"], result["binding"]["initialMonitorSha256"])
                    dependencies_rebase, rebased = dependency_rebase(plan, cont, old, rebased, sample["legacyUnits"], result["binding"]["activeSelector"], result["binding"]["initialMonitorSha256"])
                    if rebase != result["binding"]["legacyRebase"] or dependencies_rebase != result["binding"]["dependencyRebase"] or rebased != result["binding"]["rebasedLegacyUnits"]:
                        fail("Compatible legacy worker baseline changed during transition sample.")
                    current_proxy = proxy_evidence(plan, cont, old, inventory, result["binding"]["identity"], result["binding"]["rebasedLegacyUnits"], sample["legacyUnits"])
                    if current_proxy != result["binding"]["proxyTransitions"]:
                        fail("Proxy runtime/override proof changed during transition sample.")
                    if registered_source(old, profile) != result["binding"]["registeredSource"]:
                        fail("Registered source identity changed during transition sample.")
                    physical = cont.runtime_proof(old, profile, MANIFEST_HASH)
                    cont.validate_runtime(physical, NATIVE_BUILD, len(profile["manifest"]["sources"]), {}, starting=False)
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                old.emit(log, {"event": "sample", "elapsed": round(tick - started, 2), "own": own, **sample})
                reason = old.stop_reason(sample, result, result["binding"]["originalCacheBytes"], time.monotonic() - started)
                if reason:
                    break
                if own["ActiveState"] in {"inactive", "failed"}:
                    reason = "shadow_exited"
                    break
                if own["InvocationID"] != invocation:
                    reason = "shadow_invocation_changed"
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
                           "retainedWorkspace": str(base), "retainedSchema": old.SCHEMA, "stopError": stop_error, "after": after})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--apply")
    args = parser.parse_args()
    if os.getuid() != 0 or socket.gethostname() != "yunipals-main":
        fail("This operator helper targets root on yunipals-main only.")
    plan, cont = load_plan(args.plan)
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply):
            fail("An exact prior transition review hash is required.")
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit()))
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        apply(plan, cont, args.apply)
    else:
        result, _ = review(plan, cont)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
