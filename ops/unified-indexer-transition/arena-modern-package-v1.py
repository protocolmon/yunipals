#!/usr/bin/env python3
"""Build a frozen modern Arena consumer offline from the accepted dependency closure."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import socket
import stat
import subprocess
import tarfile
import time
import traceback
import types

FORMAT = "yunipals-arena-modern-package-v1"
OPS = Path("/opt/yunipals-unified/operations/arena-modern-package-20261022")
VOLUME = Path("/mnt/HC_Volume_107222036")
WORK = VOLUME / "arena-modern-package-20261022"
BASE_DIGEST = "3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d"
BASE = Path("/opt/yunipals-unified/releases") / BASE_DIGEST
BASE_RUNTIME = Path("/var/tmp/yunipals-runtime-3c8776b9-20261021")
BASE_MANIFEST_SHA = "1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8"
BASE_ARCHIVE_SHA = "795fdbb047dbe7009543839389c687cacaa3834001f0dc18650f3be077959774"
BASE_INVENTORY_SHA = "e98d1204597345ca2746fd159260b36d7f4f43bac45b8ca9c6ce01a8871f5e6b"
BASE_EVIDENCE_SHA = "50491f6ddd840a65cbd07d45eeb2923edd88eb62647a8cce5587050d6077b000"
BASE_SOURCE_ARCHIVE_SHA = "af09ea5b6f557f582e5203dbca38eed6641280bc5b5f49ee180a76b528a7aa2f"
CREDENTIAL_HELPER_SHA = "b5022fdd7a3b1b29d57681f872f7c014f70a21e165440d6ea37d221b6e8e0ff3"
PRIMITIVES_SHA = "76cca2956355de69f6e6e2d60af3ea8f7de2a4bb34807b6dbc06aebc84ef3551"
RUNTIME_HELPER_SHA = "49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4"
PROPOSAL_SHA = "6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e"
NODE = "/opt/node-v24.18.1/bin/node"
NODE_SHA = "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a"
RULES_HASH = "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80"
POOL_HASH = "0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c"
DIST = "apps/yunipals-market-api/dist/"
NEW_BUNDLES = {DIST + "arena-monitor.mjs", DIST + "arena-recovery.mjs"}
ACCEPTANCE = "ops/arena-live-compat-acceptance/"
ACCEPTANCE_FILES = {ACCEPTANCE + name for name in ["run.ts", "fixtures.ts", "public-api.test.ts", "native-history.test.ts", "native-guards.test.ts", "artwork-funding.test.ts", "catalog-config.test.ts", "README.md"]}
REFERENCE_HASHES = {"44ad25444d04e1e12649b7ac8dd2d0271da0c0a559125fe5497e1e28225078f4", "51dbacaf45e811b8dad37c70e8ed95cc5ad4871cbfef086631ee7f5e87bfe737", "79503d9875153a1a38bc94fdf3b74fd0713d2f776d5e2e44ba59a1b3bb8c0752", "b54e93886c98b5c1eaf6a0e7f66bd077e621acbdd6a5028dcd78ea25221d92ac"}
PUBLIC_MEDIA = {"docs/arena/identity-registry-v1/references/" + digest + ".img" for digest in REFERENCE_HASHES} | {"docs/islands/race-film-v4/audio/split-in-synapse-original.mp3"}
PUBLICATION = "docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public"
RESERVE, WORK_CAP, DEADLINE = 25_000_000_000, 3_000_000_000, 1800
ENV = {"PATH": str(Path(NODE).parent) + ":/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1", "COREPACK_ENABLE_NETWORK": "0", "TMPDIR": str(WORK / "tmp")}
PRIVATE = {"/run/postgresql", "/var/run/postgresql", "/var/lib/postgresql", "/var/backups", "/etc/yunipals-arena", "/etc/yunipals-marketplace", "/etc/yunipals-indexer", "/etc/yunipals-unified"}

class PackageFailure(RuntimeError):
    pass

def fail(code):
    if not re.fullmatch("[a-z0-9_]{1,100}", code):
        raise ValueError("Fixed public error label required")
    raise PackageFailure(code)

def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def save(path, value):
    with Path(path).open("xb") as handle:
        handle.write(encoded(value)); handle.flush(); os.fsync(handle.fileno())

def load(path, pin, maximum=100_000):
    path = Path(path)
    for parent in [*path.parents, path]:
        s = parent.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o022:
            fail("protected_public_helper_required")
    raw = path.read_bytes()
    if len(raw) > maximum or sha(raw) != pin:
        fail("pinned_public_helper_changed")
    module = types.ModuleType("modern_package_" + path.stem); module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module

def source_path(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9@_./+-]+", name) or any(p in {"", ".", "..", "node_modules", "dist", "__pycache__"} or p.startswith(".") for p in name.split("/")):
        fail("plain_public_source_path_required")
    if name not in PUBLIC_MEDIA and re.search(r"\.(?:env|pem|key|p12|pfx|log|dump|zip|gz|png|jpe?g|webp|mp[34]|img)$", name, re.I):
        fail("private_or_binary_overlay_path_forbidden")
    return name

def overlay_payload(manifest, archive):
    if (manifest.get("format") != "arena-live-compat-public-overlay-v1" or manifest.get("expectedRulesHash") != RULES_HASH
            or manifest.get("expectedBundleCount") != 36 or not isinstance(manifest.get("files"), list)
            or not 1000 <= len(manifest["files"]) <= 2000 or len(archive) > 10_000_000):
        fail("frozen_modern_overlay_identity_required")
    expected = {}
    for row in manifest["files"]:
        if set(row) != {"path", "bytes", "sha256", "mode"}:
            fail("exact_overlay_inventory_fields_required")
        name = source_path(row["path"])
        if name in expected or type(row["bytes"]) is not int or not 0 <= row["bytes"] <= 5_000_000 or not re.fullmatch("[a-f0-9]{64}", row["sha256"]) or row["mode"] != 0o644:
            fail("unique_bounded_public_overlay_required")
        if name.endswith(".img") and row["sha256"] != Path(name).stem:
            fail("reference_image_filename_digest_must_match")
        expected[name] = row
    if not ACCEPTANCE_FILES.issubset(expected) or sum(r["bytes"] for r in expected.values()) > 30_000_000:
        fail("full_pinned_modern_acceptance_source_required")
    result, seen = {}, set()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for item in tar:
            name = item.name
            if name.startswith("./"):
                name = name[2:]
            if not name or name in seen or not item.isfile() or item.issym() or item.islnk():
                fail("regular_unique_overlay_archive_required")
            seen.add(name)
            if name == "arena-live-compat-overlay-manifest.json":
                if item.size > 1_000_000 or tar.extractfile(item).read() != encoded(manifest):
                    fail("embedded_overlay_manifest_must_match")
                continue
            source_path(name)
            row = expected.get(name)
            if not row or item.size != row["bytes"] or item.mode != row["mode"]:
                fail("overlay_archive_inventory_mismatch")
            raw = tar.extractfile(item).read()
            if sha(raw) != row["sha256"]:
                fail("overlay_archive_source_hash_changed")
            result[name] = raw
    if seen != set(expected) | {"arena-live-compat-overlay-manifest.json"}:
        fail("overlay_archive_has_missing_or_extra_sources")
    return result

def candidate_manifest(before, patches):
    if (before.get("format") != "yunipals-unified-source-release-v1" or before.get("sourceDigest") != BASE_DIGEST
            or sha(encoded(before.get("files"))) != BASE_DIGEST or len(before["files"]) != 1746):
        fail("exact_accepted_baseline_source_required")
    seen, rows = set(), []
    for row in before["files"]:
        name = source_path(row["path"])
        if name in seen:
            fail("unique_baseline_source_inventory_required")
        seen.add(name)
        raw = patches.get(name)
        rows.append({"path": name, "bytes": len(raw), "sha256": sha(raw)} if raw is not None else row)
    for name in sorted(set(patches) - seen):
        source_path(name); raw = patches[name]
        rows.append({"path": name, "bytes": len(raw), "sha256": sha(raw)})
    return {**before, "files": rows, "sourceDigest": sha(encoded(rows))}

def prepare_patch_parents(root, patches):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        fail("owned_plain_source_root_required")
    for name in patches:
        source_path(name)
        current = root
        for part in PurePosixPath(name).parts[:-1]:
            current = current / part
            if not os.path.lexists(current):
                current.mkdir(mode=0o700)
            state = current.lstat()
            if not stat.S_ISDIR(state.st_mode) or stat.S_ISLNK(state.st_mode) or state.st_uid != os.geteuid() or state.st_mode & 0o022:
                fail("new_source_parents_must_be_owned_plain_directories")


def dependency_inputs(base, before, patches, primitives):
    rows = {r["path"]: r for r in before["files"]}
    fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "resolutions", "overrides", "packageManager", "engines"]
    for name, raw in patches.items():
        previous = rows.get(name)
        if name.startswith("apps/yunipals-indexer/") or name in {"pnpm-lock.yaml", "pnpm-workspace.yaml"}:
            if not previous or sha(raw) != previous["sha256"]:
                fail("ponder_writer_and_dependency_lock_inputs_unchanged")
        if PurePosixPath(name).name == "package.json":
            if not previous:
                fail("new_package_manifest_forbidden")
            old = json.loads(primitives.pinned(base / name, previous["sha256"]))
            new = json.loads(raw)
            if any(old.get(k) != new.get(k) for k in fields):
                fail("dependency_declarations_must_remain_unchanged")

def runtime_delta(before, after, before_source, candidate):
    old = {r["path"]: r for r in before["entries"]}; new = {r["path"]: r for r in after["entries"]}
    additions = NEW_BUNDLES | {name + ".map" for name in NEW_BUNDLES}
    if len(old) != len(before["entries"]) or len(new) != len(after["entries"]) or len(old) != 60918 or len(new) != 60922 or before["roots"] != after["roots"] or old.keys() - new.keys() or new.keys() - old.keys() != additions:
        fail("exact_60918_to_60922_runtime_pathset_required")
    packages = [r for r in old.values() if r["type"] == "directory" and r["path"].startswith("node_modules/.pnpm/") and len(Path(r["path"]).parts) == 3 and Path(r["path"]).name != "node_modules"]
    if len(packages) != 330:
        fail("exact_330_dependency_package_closure_required")
    old_bundles = {r["path"]: r for r in before.get("bundleProof", {}).get("bundles", [])}
    bundles = after.get("bundleProof", {}).get("bundles", [])
    expected = set(old_bundles) | NEW_BUNDLES
    if len(old_bundles) != 34 or len(bundles) != 36 or len({r["path"] for r in bundles}) != 36 or {r["path"] for r in bundles} != expected or after.get("bundleProof", {}).get("allSourceContentsMatch") is not True:
        fail("exact_36_source_qualified_bundles_required")
    if any(not re.fullmatch(re.escape(DIST) + r"[a-z0-9-]+\.mjs", name) for name in expected):
        fail("known_regular_dist_bundle_names_required")
    source_before = {r["path"]: r for r in before_source["files"]}; frozen = {r["path"]: r for r in candidate["files"]}
    changed_sources = {name for name in frozen if source_before.get(name) != frozen[name]}
    allowed = expected | {name + ".map" for name in expected}; changes = []
    for name, row in new.items():
        previous = old.get(name)
        if previous == row:
            continue
        if name not in allowed or row["type"] != "file" or row["mode"] != 0o644 or (previous and any(previous.get(k) != row.get(k) for k in ["type", "mode", "target"])):
            fail("dependency_shim_link_mode_or_unqualified_bundle_change")
        bundle_name = name.removesuffix(".map")
        current_proof = next(r for r in bundles if r["path"] == bundle_name)
        if not (set(current_proof["sourcePaths"]) & changed_sources):
            fail("changed_bundle_requires_reviewed_source_change")
        changes.append(name)
    if not additions.issubset(changes):
        fail("two_new_modern_entries_and_maps_required")
    for bundle in bundles:
        if any(name not in frozen or name.endswith(".test.ts") for name in bundle["sourcePaths"]):
            fail("runtime_bundle_sources_must_be_frozen_non_tests")
        if new[bundle["path"]]["sha256"] != bundle["sha256"] or new[bundle["path"] + ".map"]["sha256"] != bundle["sourceMapSha256"]:
            fail("runtime_bundle_inventory_hash_mismatch")
    qualified = [{"path": name, "changedSourcePaths": sorted(set(next(row for row in bundles if row["path"] == name)["sourcePaths"]) & changed_sources)} for name in sorted({name.removesuffix(".map") for name in changes})]
    arena = [row["path"] for row in qualified if Path(row["path"]).name.startswith("arena-")]
    other = [row["path"] for row in qualified if row["path"] not in arena]
    return {"paths": 60922, "basePaths": 60918, "packages": 330, "addedEntries": sorted(additions), "changedBundlesAndMaps": sorted(changes),
        "artifactScope": "full_consumer_artifact", "arenaQualifiedChangedBundles": arena, "otherQualifiedChangedConsumerBundles": other,
        "changedBundleSourceQualifications": qualified, "candidateProxyUnselected": True, "sourceReplayOrProxyActivationApproved": False,
        "dependencyBytesLinksShimsAndMetadataUnchanged": True, "pathTypesModesAndLinkTargetsUnchanged": True, "normalizationApplied": False}

def assert_test_output(raw, count):
    text = raw.decode("utf-8")
    for key, expected in [("tests", count), ("pass", count), ("fail", 0)]:
        if re.findall(r"(?m)^(?:ℹ |# )" + key + r" ([0-9]+)$", text) != [str(expected)]:
            fail("actual_nonempty_expected_test_summary_required")

def assert_catalog(value):
    if value.get("islands") != 898 or value.get("identityProfiles") != 4 or value.get("rulesHash") != RULES_HASH or value.get("poolHash") not in {POOL_HASH, POOL_HASH[2:]}:
        fail("actual_complete_46a4_catalog_required")
    return {**value, "poolHash": POOL_HASH}

def hidden_children():
    children = []
    for p in VOLUME.iterdir():
        if p in {WORK, VOLUME / ".yunipals-full-restore-v1.lock"}:
            continue
        if p.name != "lost+found" and not re.fullmatch(r"[A-Za-z0-9_.-]+", p.name):
            fail("fixed_volume_child_name_required")
        children.append(str(p))
    return sorted(children)


def unit_text(mode, plan):
    name = "yunipals-arena-modern-package-v1-" + mode + "-20261022.service"
    action = "" if mode == "review" else " --build REVIEW_HASH"
    return "\n".join(["[Unit]", "Description=Offline Arena consumer package " + mode, "", "[Service]", "Type=oneshot", "User=root", "Group=root", "WorkingDirectory=" + str(OPS), "ExecStart=/usr/bin/python3 -B " + str(OPS / "arena-modern-package-v1.py") + " --plan " + str(OPS / "plan.json") + action, "Environment=PYTHONDONTWRITEBYTECODE=1", "PrivateNetwork=yes", "PrivateTmp=no", "ProtectSystem=strict", "ProtectHome=yes", "NoNewPrivileges=yes", "CapabilityBoundingSet=", "AmbientCapabilities=", "RestrictAddressFamilies=AF_UNIX", "ReadWritePaths=" + str(WORK), "InaccessiblePaths=" + " ".join(sorted(PRIVATE | set(plan["hiddenVolumeChildren"]))), "MemoryMax=2G", "MemorySwapMax=0", "CPUQuota=100%", "RuntimeMaxSec=35min", "TimeoutStartSec=35min", "TimeoutStopSec=30s", "KillMode=control-group", "Restart=no", "UMask=0077", "IOReadBandwidthMax=/dev/sdb 52428800", "IOWriteBandwidthMax=/dev/sdb 52428800", ""])


def check_unit(primitives, mode, plan):
    unit = "yunipals-arena-modern-package-v1-" + mode + "-20261022.service"
    fields = "Id MainPID Type User Group Environment EnvironmentFiles PrivateNetwork PrivateTmp ProtectSystem ProtectHome NoNewPrivileges CapabilityBoundingSet AmbientCapabilities RestrictAddressFamilies ReadWritePaths InaccessiblePaths MemoryMax MemorySwapMax CPUQuotaPerSecUSec RuntimeMaxUSec TimeoutStartUSec TimeoutStopUSec KillMode Restart IOReadBandwidthMax IOWriteBandwidthMax".split()
    result = subprocess.run(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in fields]], env=ENV, capture_output=True, text=True, timeout=5, check=True)
    rows = [s.split("=", 1) for s in result.stdout.splitlines() if "=" in s]
    if len(rows) != len({k for k, v in rows}):
        fail("unique_effective_unit_properties_required")
    p = dict(rows)
    if "EnvironmentFiles" not in p:
        p["EnvironmentFiles"] = primitives.empty_environment_files_via_dbus(unit)
    expected = {"Id": unit, "MainPID": str(os.getpid()), "Type": "oneshot", "User": "root", "Group": "root", "Environment": "PYTHONDONTWRITEBYTECODE=1", "EnvironmentFiles": "", "PrivateNetwork": "yes", "PrivateTmp": "no", "ProtectSystem": "strict", "ProtectHome": "yes", "NoNewPrivileges": "yes", "CapabilityBoundingSet": "", "AmbientCapabilities": "", "RestrictAddressFamilies": "AF_UNIX", "ReadWritePaths": str(WORK), "MemoryMax": "2147483648", "MemorySwapMax": "0", "CPUQuotaPerSecUSec": "1s", "RuntimeMaxUSec": "35min", "TimeoutStartUSec": "35min", "TimeoutStopUSec": "30s", "KillMode": "control-group", "Restart": "no"}
    if any(p.get(k) != v for k, v in expected.items()) or set(p.get("InaccessiblePaths", "").split()) != PRIVATE | set(plan["hiddenVolumeChildren"]) or any(p.get(k, "").split() != ["/dev/sdb", "52428800"] for k in ["IOReadBandwidthMax", "IOWriteBandwidthMax"]):
        fail("exact_offline_bounded_build_unit_required")
    state = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if any(int(state[k], 16) for k in ["CapPrm", "CapEff", "CapInh", "CapAmb", "CapBnd"]) or state["NoNewPrivs"].strip() != "1":
        fail("zero_capability_offline_build_required")
    return {k: v for k, v in expected.items() if k not in {"Id", "MainPID"}}


def review(plan, mode):
    primitives = load(OPS / "source6-package-v3.py", PRIMITIVES_SHA)
    helper = load(OPS / "runtime-supplement.py", RUNTIME_HELPER_SHA)
    credential = load(OPS / "arena-credential-package-v2.py", CREDENTIAL_HELPER_SHA)
    expected_keys = {"format", "operatorSha256", "work", "baseSourceDigest", "overlayManifestSha256", "overlayArchiveSha256", "hiddenVolumeChildren"}
    if (set(plan) != expected_keys or plan.get("format") != FORMAT or plan.get("operatorSha256") != primitives.file_sha(Path(__file__))
            or plan.get("work") != str(WORK) or plan.get("baseSourceDigest") != BASE_DIGEST
            or plan.get("hiddenVolumeChildren") != hidden_children()
            or any(not re.fullmatch("[a-f0-9]{64}", plan.get(k, "")) for k in ["overlayManifestSha256", "overlayArchiveSha256"])
            or os.geteuid() != 0 or socket.gethostname() != "yunipals-main"):
        fail("exact_fixed_host_modern_plan_required")
    unit = check_unit(primitives, mode, plan)
    if json.loads(primitives.trusted(OPS / "plan.json", 100_000)) != plan:
        fail("protected_exact_plan_bytes_required")
    state = WORK.lstat()
    if not stat.S_ISDIR(state.st_mode) or state.st_uid != 0 or stat.S_IMODE(state.st_mode) != 0o700 or any(WORK.iterdir()) or state.st_dev != VOLUME.stat().st_dev:
        fail("fresh_empty_volume_work_required")
    if shutil.disk_usage(WORK).free < RESERVE + WORK_CAP:
        fail("build_requires_25gb_reserve_plus_3gb_allowance")
    before = json.loads(primitives.pinned(BASE / "RELEASE-MANIFEST.json", BASE_MANIFEST_SHA))
    helper.source_check(BASE, BASE_DIGEST)
    baseline = json.loads(primitives.pinned(BASE_RUNTIME / "runtime-supplement.inventory.json", BASE_INVENTORY_SHA, 40_000_000))
    primitives.checked_file_hash(BASE_RUNTIME / "runtime-supplement.tar.gz", BASE_ARCHIVE_SHA, 250_000_000)
    if (baseline.get("sourceDigest") != BASE_DIGEST or baseline.get("sourceManifestSha256") != BASE_MANIFEST_SHA
            or baseline.get("archiveSha256") != BASE_ARCHIVE_SHA or len(baseline["entries"]) != 60918):
        fail("exact_base_runtime_binding_required")
    primitives.checked_file_hash(OPS / "base-source.tar.gz", BASE_SOURCE_ARCHIVE_SHA, 50_000_000)
    evidence = json.loads(primitives.pinned(OPS / "base-consumer-evidence.json", BASE_EVIDENCE_SHA))
    if (evidence.get("format") != "yunipals-arena-consumer-dependency-clone-package-v4" or evidence.get("status") != "passed"
            or evidence.get("sourceDigest") != BASE_DIGEST or evidence["source"]["manifestSha256"] != BASE_MANIFEST_SHA
            or evidence["source"]["archiveSha256"] != BASE_SOURCE_ARCHIVE_SHA or evidence["runtime"]["archiveSha256"] != BASE_ARCHIVE_SHA
            or evidence["runtime"]["inventorySha256"] != BASE_INVENTORY_SHA or evidence["runtime"]["helperSha256"] != RUNTIME_HELPER_SHA):
        fail("accepted_baseline_build_evidence_required")
    primitives.checked_file_hash(Path(NODE), NODE_SHA, 150_000_000)
    helper.platform_check(NODE, baseline["runtime"])
    raw = primitives.pinned(OPS / "overlay-manifest.json", plan["overlayManifestSha256"], 1_000_000)
    overlay = json.loads(raw)
    if raw != encoded(overlay):
        fail("canonical_frozen_overlay_manifest_required")
    archive = primitives.pinned(OPS / "overlay.tar.gz", plan["overlayArchiveSha256"], 10_000_000)
    patches = overlay_payload(overlay, archive)
    dependency_inputs(BASE, before, patches, primitives)
    manifest = candidate_manifest(before, patches)
    rows = {r["path"]: r for r in manifest["files"]}
    if any(rows.get(name, {}).get("sha256") != pin for name, pin in credential.PATCHES.items() if not name.endswith("/config.ts")):
        fail("qualified_credential_reader_sources_must_remain_exact")
    proposal = json.loads(primitives.pinned(OPS / "proposal.v1.json", PROPOSAL_SHA))
    old_rows = {r["path"]: r for r in before["files"]}
    templates = {credential.template_path(w): primitives.pinned(BASE / credential.template_path(w), old_rows[credential.template_path(w)]["sha256"]) for w in proposal["workers"]}
    units = credential.render_units(proposal, manifest["sourceDigest"], templates)
    binding = {"format": FORMAT, "plan": plan, "unit": unit,
        "workIdentity": [state.st_dev, state.st_ino, state.st_uid, state.st_gid, state.st_mode],
        "baseManifestSha256": BASE_MANIFEST_SHA, "baseSourceArchiveSha256": BASE_SOURCE_ARCHIVE_SHA,
        "baseRuntimeArchiveSha256": BASE_ARCHIVE_SHA, "baseRuntimeInventorySha256": BASE_INVENTORY_SHA, "baseEvidenceSha256": BASE_EVIDENCE_SHA,
        "credentialHelperSha256": CREDENTIAL_HELPER_SHA, "primitivesSha256": PRIMITIVES_SHA, "runtimeHelperSha256": RUNTIME_HELPER_SHA,
        "proposalSha256": PROPOSAL_SHA, "nodeSha256": NODE_SHA,
        "overlayManifestSha256": plan["overlayManifestSha256"], "overlayArchiveSha256": plan["overlayArchiveSha256"],
        "overlayFileCount": len(patches), "candidateSourceDigest": manifest["sourceDigest"], "candidateManifestSha256": sha(encoded(manifest)),
        "renderedUnitSha256": {name: sha(text.encode()) for name, text in units.items()},
        "rulesHash": RULES_HASH, "bundleCount": 36, "runtimeEntries": 60922, "dependencyPackages": 330,
        "reserveBytes": RESERVE, "workCapBytes": WORK_CAP, "deadlineSeconds": DEADLINE,
        "mediaAssetsIncludedOrQualified": False, "databaseConnections": 0, "providerCalls": 0, "productionChanges": False}
    checked = {"format": FORMAT, "reviewHash": sha(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode()), "binding": binding}
    return checked, primitives, helper, credential, before, manifest, patches, proposal, baseline


class Build:
    def __init__(self, checked, primitives, helper, credential, before, manifest, patches, proposal, baseline):
        self.checked, self.p, self.h, self.c = checked, primitives, helper, credential
        self.before, self.manifest, self.patches, self.proposal, self.baseline = before, manifest, patches, proposal, baseline
        self.started = time.monotonic(); self.phase = "created"; self.child = None; self.steps = []
        self.minimum_free = shutil.disk_usage(WORK).free; self.maximum_allocated = 0; self.last_guard = -1e30

    def guard(self, force=False):
        if time.monotonic() - self.started > DEADLINE:
            fail("offline_build_wall_deadline")
        if not force and time.monotonic() - self.last_guard < 1:
            return
        self.last_guard = time.monotonic()
        own = WORK.lstat(); expected = self.checked["binding"]["workIdentity"]
        if [own.st_dev, own.st_ino, own.st_uid, own.st_gid, own.st_mode] != expected:
            fail("owned_build_root_changed")
        allocated = 0
        for directory, dirs, files in os.walk(WORK, followlinks=False):
            for name in [None, *files, *[n for n in dirs if (Path(directory) / n).is_symlink()]]:
                try:
                    entry = Path(directory) if name is None else Path(directory) / name
                    s = entry.lstat()
                    if s.st_dev != own.st_dev:
                        fail("unexpected_build_mount")
                    allocated += s.st_blocks * 512
                except FileNotFoundError:
                    pass  # Compiler temporary child; exact owned root checked below.
        after = WORK.lstat()
        if [after.st_dev, after.st_ino, after.st_uid, after.st_gid, after.st_mode] != expected:
            fail("owned_build_root_changed")
        free = shutil.disk_usage(WORK).free
        self.minimum_free = min(free, self.minimum_free); self.maximum_allocated = max(allocated, self.maximum_allocated)
        if free < RESERVE or allocated > WORK_CAP:
            fail("offline_build_disk_reserve_or_cap")

    def stop_child(self):
        if self.child is None or self.child.poll() is not None:
            return
        os.killpg(self.child.pid, signal.SIGTERM)
        try:
            self.child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(self.child.pid, signal.SIGKILL); self.child.wait(timeout=5)

    def run(self, name, args, cwd, *, build=False, timeout=300):
        self.phase = name; self.guard(force=True); started = time.monotonic()
        output = WORK / "proof" / (name + ".stdout"); error = WORK / "proof" / (name + ".stderr")
        with output.open("xb") as out, error.open("xb") as err:
            self.child = subprocess.Popen(args, cwd=cwd, env=ENV, stdout=out, stderr=err, start_new_session=True, umask=0o022 if build else 0o077)
            try:
                while self.child.poll() is None:
                    self.guard()
                    if time.monotonic() - started > timeout or max(output.stat().st_size, error.stat().st_size) > 4_000_000:
                        fail("owned_build_command_time_or_output_cap")
                    time.sleep(0.5)
                if self.child.returncode != 0 or max(output.stat().st_size, error.stat().st_size) > 4_000_000:
                    fail("owned_build_command_failed")
            finally:
                self.stop_child()
        self.steps.append({"name": name, "exitCode": self.child.returncode, "elapsedSeconds": round(time.monotonic() - started, 3), "stdoutSha256": self.p.file_sha(output), "stderrSha256": self.p.file_sha(error)})
        self.guard(force=True)

    def runtime_args(self, command, root, runtime):
        self.p.pinned(OPS / "runtime-supplement.py", RUNTIME_HELPER_SHA)
        args = ["/usr/bin/python3", "-B", str(OPS / "runtime-supplement.py"), command]
        if command == "build":
            return [*args, "--source", str(root), "--source-digest", self.manifest["sourceDigest"], "--output", str(runtime), "--node", NODE]
        inventory = runtime / "runtime-supplement.inventory.json"
        pin = BASE_INVENTORY_SHA if runtime == BASE_RUNTIME else self.p.file_sha(inventory)
        value = json.loads(self.p.pinned(inventory, pin, 40_000_000))
        archive_pin = BASE_ARCHIVE_SHA if runtime == BASE_RUNTIME else value["archiveSha256"]
        return [*args, "--archive", str(runtime / "runtime-supplement.tar.gz"), "--inventory", str(inventory), "--archive-sha256", archive_pin, "--inventory-sha256", pin, "--target", str(root), "--node", NODE]

    def execute(self):
        save(WORK / "BUILD-ATTEMPT.json", self.checked)
        (WORK / "proof").mkdir(mode=0o700); (WORK / "tmp").mkdir(mode=0o700)
        result = None
        try:
            result = self.build()
            return result
        except BaseException as error:
            frames = [{"source": "arena-modern-package-v1.py", "line": frame.lineno, "function": frame.name} for frame in traceback.extract_tb(error.__traceback__) if frame.filename == __file__]
            result = {"format": FORMAT, "status": "failed", "reviewHash": self.checked["reviewHash"], "phase": self.phase,
                "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, PackageFailure) else "external_operation_failed",
                "knownPublicSourceFrames": frames[-8:], "automaticRetryAllowed": False, "partialWorkRetained": True}
            raise
        finally:
            self.stop_child()
            save(WORK / "attempt-result.json", {**(result or {"status": "failed"}), "steps": self.steps,
                "elapsedSeconds": round(time.monotonic() - self.started, 3), "minimumVolumeFreeBytes": self.minimum_free,
                "maximumWorkAllocatedBytes": self.maximum_allocated, "providerCalls": 0, "databaseConnections": 0, "existingArtifactsModified": False})

    def check_suites(self, suffix=""):
        for name, count in [(suffix + "credential-reader-controls", 79), (suffix + "modern-acceptance", 21)]:
            assert_test_output((WORK / "proof" / (name + ".stdout")).read_bytes(), count)

    def build(self):
        source, root, relocated = [WORK / name for name in ["source", "unpacked", "relocated"]]
        self.phase = "copy_exact_reviewed_source"
        self.p.copy_source(BASE, source, self.before); prepare_patch_parents(source, self.patches); self.p.patch_source(source, self.manifest, self.patches)
        self.p.copy_source(BASE, root, self.before)
        self.run("clone-accepted-runtime", self.runtime_args("install", root, BASE_RUNTIME), WORK)
        prepare_patch_parents(root, self.patches); self.p.patch_source(root, self.manifest, self.patches)
        for name in ["source.tar.gz", "source-repeat.tar.gz"]:
            self.p.source_archive(source, self.manifest, WORK / name); self.guard(force=True)
        if self.p.file_sha(WORK / "source.tar.gz") != self.p.file_sha(WORK / "source-repeat.tar.gz"):
            fail("source_archive_repeat_mismatch")
        self.phase = "source-verify"; self.guard(force=True)
        self.h.source_check(root, self.manifest["sourceDigest"]); self.guard(force=True)
        for app in ["yunipals-indexer", "yunipals-market-api"]:
            self.run(app + "-typecheck", [NODE, "--max-old-space-size=1024", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "--incremental", "false"], root / "apps" / app)
        app = root / "apps/yunipals-market-api"
        self.run("credential-reader-controls", [NODE, "--import", "tsx", "src/arena/live/privateFile.test.ts"], app)
        self.run("modern-acceptance", [NODE, "--import", "tsx", "../../ops/arena-live-compat-acceptance/run.ts"], app)
        self.check_suites()
        self.run("market-build", [NODE, "scripts/build.mjs"], app, build=True)
        self.run("catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], app)
        first_catalog = assert_catalog(json.loads((WORK / "proof/catalog-smoke.stdout").read_bytes()))
        self.run("runtime-capture-a", self.runtime_args("build", root, WORK / "runtime-a"), WORK)
        inventory = json.loads((WORK / "runtime-a/runtime-supplement.inventory.json").read_bytes())
        delta = runtime_delta(self.baseline, inventory, self.before, self.manifest)
        self.c.credential_bundle_sources(self.baseline, inventory["bundleProof"]["bundles"])
        self.p.copy_source(source, relocated, self.manifest)
        self.run("runtime-verify", self.runtime_args("verify", relocated, WORK / "runtime-a"), WORK)
        self.run("exclusive-relocation", self.runtime_args("install", relocated, WORK / "runtime-a"), WORK)
        app = relocated / "apps/yunipals-market-api"
        self.run("relocated-credential-reader-controls", [NODE, "--import", "tsx", "src/arena/live/privateFile.test.ts"], app)
        self.run("relocated-modern-acceptance", [NODE, "--import", "tsx", "../../ops/arena-live-compat-acceptance/run.ts"], app)
        self.check_suites("relocated-")
        self.run("relocated-market-rebuild", [NODE, "scripts/build.mjs"], app, build=True)
        self.run("runtime-capture-b", self.runtime_args("build", relocated, WORK / "runtime-b"), WORK)
        for name in ["runtime-supplement.tar.gz", "runtime-supplement.inventory.json"]:
            if self.p.file_sha(WORK / "runtime-a" / name) != self.p.file_sha(WORK / "runtime-b" / name):
                fail("independent_tree_rebuild_runtime_mismatch")
        self.phase = "relocated-source-verify"; self.guard(force=True)
        self.h.source_check(relocated, self.manifest["sourceDigest"]); self.guard(force=True)
        self.run("relocated-catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], app)
        catalog = assert_catalog(json.loads((WORK / "proof/relocated-catalog-smoke.stdout").read_bytes()))
        installed = json.loads((WORK / "proof/exclusive-relocation.stdout").read_bytes())
        if first_catalog != catalog or installed.get("entriesVerified") != 60922 or installed.get("sourceUnchanged") is not True or installed.get("sourceDigest") != self.manifest["sourceDigest"] or installed.get("networkCalls") != 0:
            fail("exact_relocated_runtime_and_catalog_acceptance_required")
        self.h.source_check(root, self.manifest["sourceDigest"]); self.h.source_check(relocated, self.manifest["sourceDigest"])
        rows = {row["path"]: row for row in self.before["files"]}
        templates = {self.c.template_path(worker): self.p.pinned(BASE / self.c.template_path(worker), rows[self.c.template_path(worker)]["sha256"]) for worker in self.proposal["workers"]}
        units = self.c.render_units(self.proposal, self.manifest["sourceDigest"], templates)
        rendered = WORK / "native-units"; rendered.mkdir(mode=0o700)
        for name, text in units.items():
            with (rendered / name).open("xb") as handle:
                handle.write(text.encode()); handle.flush(); os.fsync(handle.fileno())
        unit_pins = {name: sha(text.encode()) for name, text in units.items()}
        if unit_pins != self.checked["binding"]["renderedUnitSha256"]:
            fail("reviewed_native_unit_rendering_changed")
        proof = {"format": FORMAT, "status": "passed", "reviewHash": self.checked["reviewHash"], "sourceDigest": self.manifest["sourceDigest"],
            "source": {"archive": str(WORK / "source.tar.gz"), "archiveSha256": self.p.file_sha(WORK / "source.tar.gz"),
                "manifestSha256": sha(encoded(self.manifest)), "files": len(self.manifest["files"]), "baseSourceDigest": BASE_DIGEST,
                "baseManifestSha256": BASE_MANIFEST_SHA, "baseArchiveSha256": BASE_SOURCE_ARCHIVE_SHA, "baseBuildProofSha256": BASE_EVIDENCE_SHA,
                "baseRuntimeArchiveSha256": BASE_ARCHIVE_SHA, "baseRuntimeInventorySha256": BASE_INVENTORY_SHA,
                "overlayManifestSha256": self.checked["binding"]["overlayManifestSha256"], "overlayArchiveSha256": self.checked["binding"]["overlayArchiveSha256"],
                "overlayFiles": len(self.patches), "overlayInventorySha256": sha(encoded([{"path": name, "bytes": len(raw), "sha256": sha(raw)} for name, raw in sorted(self.patches.items())])), "byteIdenticalSecondCapture": True},
            "runtime": {"archive": str(WORK / "runtime-a/runtime-supplement.tar.gz"), "archiveSha256": self.p.file_sha(WORK / "runtime-a/runtime-supplement.tar.gz"),
                "inventory": str(WORK / "runtime-a/runtime-supplement.inventory.json"), "inventorySha256": self.p.file_sha(WORK / "runtime-a/runtime-supplement.inventory.json"),
                "helperSha256": RUNTIME_HELPER_SHA, "entries": len(inventory["entries"]), "regularBytes": inventory["unpackedRegularBytes"], "exactDelta": delta, "separateRelocatedTreeRebuildByteIdentical": True},
            "verification": {"twoFullTypechecks": True, "sourceVerification": "pinned_runtime_supplement_all_manifest_bytes_and_checksum_list", "legacyNodeSourceVerifierUsed": False, "catalogPoolHashNormalizedAfterExactComparison": True, "targetedCredentialReaderSuites": 2, "credentialControlsPerSuite": 79,
                "modernAcceptanceSuites": 2, "modernChecksPerSuite": 21, "ordinaryMarketBuilds": 2, "bundleCount": 36, "catalog": catalog,
                "exclusiveRelocation": installed, "dependencyPackages": 330, "packageManagerInstalls": 0, "downloads": 0,
                "indexerApplicationInputsUnchanged": True, "nativePonderBuildPerformed": False, "activePonderRuntimeChanged": False},
            "media": {"assetsQualified": False, "mediaComplete": False, "requiredIslandPngCount": 898, "requiredExternalAssetCount": 903,
                "sourceArchiveContainsIslandPngs": False, "smallPublicReferenceMediaIncluded": True, "qualificationDeferred": True, "attachmentRequiredBeforeMediaEnablement": True},
            "nativeUnits": {"root": str(Path("/opt/yunipals-unified/releases") / self.manifest["sourceDigest"]), "files": unit_pins,
                "unitsInstalledOrStarted": False, "lobbyExecutionKey": "/etc/yunipals-arena/operator.key", "entriesEnabled": False, "newLobbiesEnabled": False},
            "qualifications": ["Full consumer artifact only; the candidate proxy remains unselected and is not approved for source/replay/proxy activation. No live source/proxy/selector/worker replacement, schema migration, grants or readiness acceptance.",
                "330 accepted dependencies preserve all bytes, shims, metadata, link targets and modes; no package manager or download is used.",
                "Only monitor/recovery bundles and maps add runtime paths; each changed known consumer bundle binds an actual changed frozen source in its fully verified source map, without a build-config waiver. Arena and other changed bundles are listed separately.",
                "Public catalog metadata, four exact reference images and soundtrack are source-qualified; 898 retained island PNGs remain external. Media-ready is not claimed.",
                "Indexer application inputs are unchanged. Shared source may change transitively; no native Ponder build is performed and no active Ponder runtime is changed."]}
        self.guard(force=True); save(WORK / "arena-consumer-package-proof.json", proof)
        return {"format": FORMAT, "status": "passed", "reviewHash": self.checked["reviewHash"], "sourceDigest": self.manifest["sourceDigest"],
            "sourceArchiveSha256": proof["source"]["archiveSha256"], "runtimeArchiveSha256": proof["runtime"]["archiveSha256"],
            "runtimeInventorySha256": proof["runtime"]["inventorySha256"], "proofSha256": self.p.file_sha(WORK / "arena-consumer-package-proof.json"),
            "renderedUnits": 8, "assetsQualified": False, "mediaComplete": False, "deploymentPerformed": False, "automaticRetryAllowed": False}


def qualify_retained_assets(source, retained, helper, primitives):
    """Separate read-only byte qualification; never copy/attach/render assets."""
    source, retained = Path(source), Path(retained)
    manifest = json.loads(primitives.trusted(source / "RELEASE-MANIFEST.json", 2_000_000))
    helper.source_check(source, manifest["sourceDigest"])
    rows = {row["path"]: row for row in manifest["files"]}
    asset_map = json.loads(primitives.pinned(source / "EXTERNAL-RUNTIME-ASSETS.json", rows["EXTERNAL-RUNTIME-ASSETS.json"]["sha256"]))
    if asset_map.get("format") != "yunipals-external-runtime-assets-v1" or len(asset_map.get("assets", [])) != 903:
        fail("exact_903_external_assets_required")
    seen, pins, identities, islands = set(), [], {}, 0
    for asset in asset_map["assets"]:
        name, digest = asset["path"], asset["sha256"]
        if name in seen or not re.fullmatch("[a-f0-9]{64}", digest):
            fail("unique_checksum_bound_assets_required")
        seen.add(name)
        match = re.fullmatch(re.escape(PUBLICATION) + r"/images/([1-9][0-9]*)\.png", name)
        if match:
            metadata = PUBLICATION + "/metadata/" + match[1] + ".json"
            if asset.get("authority") != metadata or metadata not in rows:
                fail("frozen_island_metadata_authority_required")
            value = json.loads(primitives.pinned(source / metadata, rows[metadata]["sha256"]))
            if value.get("properties", {}).get("token_id") != match[1] or value["properties"].get("image_sha256") != digest:
                fail("metadata_image_digest_binding_required")
            islands += 1
        elif not (re.fullmatch(r"docs/arena/identity-registry-v1/references/[a-f0-9]{64}\.img", name) or name == "docs/islands/race-film-v4/audio/split-in-synapse-original.mp3"):
            fail("only_fixed_public_external_assets_allowed")
        path = retained / name
        before = path.lstat()
        identity = lambda state: (state.st_dev, state.st_ino, state.st_size, state.st_mtime_ns, state.st_ctime_ns)
        primitives.checked_file_hash(path, digest, 20_000_000)
        if identity(before) != identity(path.lstat()):
            fail("retained_asset_changed_during_qualification")
        identities[path] = identity(before)
        pins.append({"path": name, "sha256": digest, "bytes": before.st_size})
    non_island = {name for name in seen if not name.startswith(PUBLICATION + "/images/")}
    if islands != 898 or non_island != PUBLIC_MEDIA:
        fail("exact_898_island_images_and_five_public_media_required")
    if any(identity(path.lstat()) != expected for path, expected in identities.items()):
        fail("retained_asset_set_changed_during_qualification")
    helper.source_check(source, manifest["sourceDigest"])
    return {"format": "yunipals-arena-modern-retained-assets-qualification-v1", "sourceDigest": manifest["sourceDigest"],
        "retainedRoot": str(retained), "assetsQualified": True, "qualifiedAssets": len(pins), "islandPngs": islands,
        "bytes": sum(row["bytes"] for row in pins), "inventorySha256": sha(encoded(pins)), "mediaComplete": False,
        "sourceArchiveContainsIslandPngs": False, "smallPublicReferenceMediaIncluded": True, "assetsCopiedOrAttached": False, "renderingPerformed": False,
        "attachmentAdmissionStillRequired": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True); parser.add_argument("--build")
    parser.add_argument("--qualify-assets", metavar="COMPLETED_PROOF_SHA256")
    args = parser.parse_args()
    os.umask(0o077); os.environ.clear(); os.environ.update(ENV)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    for signum in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(signum, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.alarm(DEADLINE); build = None
    try:
        primitives = load(OPS / "source6-package-v3.py", PRIMITIVES_SHA)
        if args.plan != OPS / "plan.json" or (args.build and args.qualify_assets):
            fail("fixed_plan_and_single_action_required")
        plan = json.loads(primitives.trusted(args.plan, 100_000))
        if args.qualify_assets:
            if os.geteuid() != 0 or socket.gethostname() != "yunipals-main" or not re.fullmatch("[a-f0-9]{64}", args.qualify_assets):
                fail("fixed_host_and_completed_proof_pin_required")
            proof = json.loads(primitives.pinned(WORK / "arena-consumer-package-proof.json", args.qualify_assets, 1_000_000))
            if proof.get("format") != FORMAT or proof.get("status") != "passed" or proof["source"]["overlayManifestSha256"] != plan.get("overlayManifestSha256") or plan.get("operatorSha256") != primitives.file_sha(Path(__file__)):
                fail("completed_owned_modern_build_required")
            helper = load(OPS / "runtime-supplement.py", RUNTIME_HELPER_SHA)
            if sha(primitives.trusted(WORK / "source/RELEASE-MANIFEST.json", 2_000_000)) != proof["source"]["manifestSha256"]:
                fail("completed_source_manifest_required")
            result = qualify_retained_assets(WORK / "source", Path("/root/yunipals"), helper, primitives)
            if result["sourceDigest"] != proof["sourceDigest"]:
                fail("qualified_assets_source_binding_changed")
        else:
            fd = os.open(VOLUME / ".yunipals-full-restore-v1.lock", os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "r") as lease:
                state = os.fstat(lease.fileno())
                if not stat.S_ISREG(state.st_mode) or state.st_uid != 0 or stat.S_IMODE(state.st_mode) != 0o600:
                    fail("protected_existing_volume_lease_required")
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                data = review(plan, "build" if args.build else "review"); checked = data[0]
                if args.build:
                    if args.build != checked["reviewHash"]:
                        fail("fresh_exact_build_review_required")
                    build = Build(*data); result = build.execute()
                else:
                    result = {"format": FORMAT, "status": "reviewed_not_built", "reviewHash": checked["reviewHash"],
                        "sourceDigest": checked["binding"]["candidateSourceDigest"], "manifestSha256": checked["binding"]["candidateManifestSha256"],
                        "renderedUnitSha256": checked["binding"]["renderedUnitSha256"], "mediaComplete": False, "buildPerformed": False, "deploymentPerformed": False}
        print(json.dumps(result, sort_keys=True))
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "status": "failed", "phase": build.phase if build else "readonly_review", "errorClass": type(error).__name__,
            "fixedCode": str(error) if isinstance(error, PackageFailure) else "external_operation_failed", "rawMessagesExported": False}, sort_keys=True))
        raise SystemExit(1)
    finally:
        signal.alarm(0)

if __name__ == "__main__":
    main()
