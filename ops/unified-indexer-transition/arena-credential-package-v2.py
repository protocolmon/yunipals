#!/usr/bin/env python3
"""Offline accepted3c8776 plus fixed credential reader compatibility; no deployment."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import time
import traceback
import types

FORMAT = "yunipals-arena-credential-dependency-clone-package-v2"
OPS = Path("/opt/yunipals-unified/operations/arena-credential-package-20261022-b")
VOLUME = Path("/mnt/HC_Volume_107222036")
WORK = VOLUME / "arena-credential-package-20261022-b"
BASE_DIGEST = "3c8776b9ff9002a8827421bdae838ca669148172ff2d0c6616ee4e40b0f1826d"
BASE = Path("/opt/yunipals-unified/releases") / BASE_DIGEST
BASE_RUNTIME = Path("/var/tmp/yunipals-runtime-3c8776b9-20261021")
BASE_MANIFEST_SHA = "1cdf261d411007868ad1f026a58cae381b02c5f92c6a9a45da30e9867e9f7df8"
BASE_ARCHIVE_SHA = "795fdbb047dbe7009543839389c687cacaa3834001f0dc18650f3be077959774"
BASE_INVENTORY_SHA = "e98d1204597345ca2746fd159260b36d7f4f43bac45b8ca9c6ce01a8871f5e6b"
BASE_EVIDENCE_SHA = "50491f6ddd840a65cbd07d45eeb2923edd88eb62647a8cce5587050d6077b000"
PRIMITIVES_SHA = "76cca2956355de69f6e6e2d60af3ea8f7de2a4bb34807b6dbc06aebc84ef3551"
RUNTIME_HELPER_SHA = "49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4"
PROPOSAL_SHA = "6cb914372d5863616dcde8f753bc97380916e86073556999eaf082cf8fc6e39e"
NODE = "/opt/node-v24.18.1/bin/node"
NODE_SHA = "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a"
PREFIX = "apps/yunipals-market-api/src/arena/live/"
# Fixed public compatibility delta; no selector, transport or worker change.
PATCHES = {
    PREFIX + "config.ts": "fdb0f1f29cacbc6a58b78a40c0d96cd38ff82b2b0caec8d49c12a99ca8c1e14e",
    PREFIX + "privateFile.ts": "0e89988993ceda801201803f454ea6d1dd12b90d669368d509e476b568465750",
    PREFIX + "privateFile.test.ts": "2b2aa80c0732db2814d8484b968b96159d22379aa67c0ceba90902191ae59b54"
}
CONFIG_BEFORE_SHA = "8fe82d6e6c4cc310dcaf5a6ac48ecccc6a303fe6aaac5a0b95b02b3d25c1da4f"
BASE_SOURCE_ARCHIVE_SHA = "af09ea5b6f557f582e5203dbca38eed6641280bc5b5f49ee180a76b528a7aa2f"
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
    m = types.ModuleType("arena_package_" + path.stem); m.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), m.__dict__)
    return m


def candidate_manifest(before, patches, proposal):
    if before.get("format") != "yunipals-unified-source-release-v1" or before.get("sourceDigest") != BASE_DIGEST or sha(encoded(before.get("files"))) != BASE_DIGEST or len(before["files"]) != 1746 or set(patches) != set(PATCHES):
        fail("exact_3c8776_credential_composition_required")
    if any(sha(raw) != PATCHES[name] for name, raw in patches.items()):
        fail("reviewed_credential_patch_changed")
    added = [PREFIX + "privateFile.test.ts", PREFIX + "privateFile.ts"]
    rows, seen, inserted = [], set(), False
    for row in before["files"]:
        name = row["path"]
        if name in seen or name in added:
            fail("unique_original_source_inventory_required")
        seen.add(name)
        if name == PREFIX + "projection.ts":
            rows.extend({"path": n, "bytes": len(patches[n]), "sha256": sha(patches[n])} for n in added)
            inserted = True
        if name == PREFIX + "config.ts":
            if row["sha256"] != CONFIG_BEFORE_SHA or row["bytes"] != 3713:
                fail("accepted_original_config_changed")
            rows.append({"path": name, "bytes": len(patches[name]), "sha256": sha(patches[name])})
        else:
            rows.append(row)
    if not inserted or PREFIX + "config.ts" not in seen or len(rows) != 1748:
        fail("exact_two_new_credential_sources_required")
    return {**before, "files": rows, "sourceDigest": sha(encoded(rows))}


def template_path(worker):
    name = "yunipals-arena-native-execution@.service" if worker["id"].startswith("execution_") else worker["unit"]
    return "ops/unified-indexer/" + name + ".example"


def render_units(proposal, digest, templates):
    if not re.fullmatch("[0-9a-f]{64}", digest) or len(proposal["workers"]) != 8:
        fail("exact_artifact_and_eight_roles_required")
    root = Path("/opt/yunipals-unified/releases") / digest
    units, roles = {}, set()
    for w in proposal["workers"]:
        name = w["unit"]
        if not re.fullmatch(r"yunipals-arena-native-[a-z@-]+\.service", name) or name in units or w["id"] in roles:
            fail("unique_exact_native_role_units_required")
        roles.add(w["id"])
        directory = root / w["workingDirectoryRelative"]
        credentials = w["requiredLoadCredentials"]
        assignments = {**proposal["sharedRequiredPublicSelectors"], **w["execAssignments"]}
        if assignments["ARENA_ENTRIES_ENABLED"] != "false" or assignments["ARENA_NEW_LOBBIES_ENABLED"] != "false":
            fail("preparatory_entries_must_remain_disabled")
        if w["id"] == "execution_lobby" and {r["id"]: r["source"] for r in credentials}.get("execution.key") != "/etc/yunipals-arena/operator.key":
            fail("retain_existing_lobby_operator_key_mapping")
        arguments = ["/usr/bin/env", *[key + "=" + value for key, value in assignments.items()], NODE, w["bundleRelative"]]
        # Values are fixed in the checksum-pinned public proposal. No private URL
        # or key is substituted, and systemd expands only reviewed %d credentials.
        if any(not re.fullmatch(r"[A-Za-z0-9_./%:=@-]*", arg) for arg in arguments):
            fail("fixed_public_exec_arguments_required")
        original = templates[template_path(w)].decode()
        text = []; seen = {k: 0 for k in ["WorkingDirectory", "ExecStart", "EnvironmentFile", "LoadCredential", "Conflicts"]}
        for line in original.splitlines():
            key, sep, value = line.partition("=")
            if key in seen and sep:
                seen[key] += 1
                if key in {"WorkingDirectory", "ExecStart", "Conflicts"} and seen[key] != 1:
                    fail("single_official_unit_directive_required")
                if key == "WorkingDirectory":
                    text.append("WorkingDirectory=" + str(directory))
                elif key == "ExecStart":
                    text.append("ExecStart=" + " ".join(arguments))
                elif key == "EnvironmentFile" and seen[key] == 1:
                    text.extend("EnvironmentFile=" + v for v in w["orderedEnvironmentFiles"])
                elif key == "LoadCredential" and seen[key] == 1:
                    text.extend("LoadCredential=" + r["id"] + ":" + r["source"] for r in credentials)
                elif key == "Conflicts":
                    text.append("Conflicts=" + " ".join(sorted(set(value.split()) | set(w["currentReferenceUnits"]))))
            else:
                text.append(line)
        if not all(seen.values()):
            fail("official_native_template_directives_missing")
        rendered = "\n".join(text) + "\n"
        if w["id"].startswith("execution_"):
            rendered = rendered.replace("%i", w["execAssignments"]["ARENA_EXECUTION_ROLE"])
        units[name] = rendered
    return units


def runtime_changes(before, after):
    a = {r["path"]: r for r in before["entries"]}; b = {r["path"]: r for r in after["entries"]}
    if len(a) != len(before["entries"]) or len(b) != len(after["entries"]) or a.keys() != b.keys() or before["roots"] != after["roots"]:
        fail("exact_original_runtime_pathset_required")
    qualified = {b["path"] for b in before.get("bundleProof", {}).get("bundles", []) if set(b["sourcePaths"]) & set(PATCHES)}
    allowed = qualified | {name + ".map" for name in qualified}
    changes = []
    for name, old in a.items():
        new = b[name]
        if old == new:
            continue
        if name not in allowed or not re.fullmatch(r"apps/yunipals-market-api/dist/arena-[a-z0-9-]+\.mjs(?:\.map)?", name) or old["type"] != "file" or any(old.get(k) != new.get(k) for k in ["type", "mode", "target"]):
            fail("dependency_shim_link_mode_or_nonbundle_change")
        changes.append(name)
    if "apps/yunipals-market-api/dist/arena-native-disclosure.mjs" not in changes:
        fail("credential_fix_must_change_built_entrypoint")
    return sorted(changes)


def runtime_delta(before, after):
    changes = runtime_changes(before, after)
    a = {r["path"]: r for r in before["entries"]}
    packages = [p for p in a if a[p]["type"] == "directory" and p.startswith("node_modules/.pnpm/") and len(Path(p).parts) == 3 and Path(p).name != "node_modules"]
    if len(packages) != 330 or len(a) != 60918:
        fail("exact_330_package_60918_runtime_closure_required")
    proof = after.get("bundleProof", {})
    bundles = proof.get("bundles", [])
    if len(bundles) != 34 or proof.get("allSourceContentsMatch") is not True:
        fail("all_34_source_qualified_bundles_required")
    credential_bundle_sources(before, bundles)

    return {"paths": len(a), "packages": len(packages), "dependencyBytesLinksShimsAndMetadataUnchanged": True, "pathTypesModesAndLinkTargetsUnchanged": True, "normalizationApplied": False, "changedBundlesAndMaps": sorted(changes)}



def credential_bundle_sources(before, bundles):
    # Every bundle whose baseline sourcemap used config must now carry the
    # actual new reader source. Test sources must never become runtime inputs.
    config = PREFIX + "config.ts"
    qualified = {r["path"] for r in before["bundleProof"]["bundles"] if config in r["sourcePaths"]}
    current = {r["path"]: r for r in bundles}
    if not qualified or any(name not in current or not {config, PREFIX + "privateFile.ts"}.issubset(current[name]["sourcePaths"]) for name in qualified) or any(PREFIX + "privateFile.test.ts" in r["sourcePaths"] for r in bundles):
        fail("qualified_bundles_must_include_exact_credential_reader")


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
    name = "yunipals-arena-credential-package-v2-" + mode + "-20261022.service"
    action = "" if mode == "review" else " --build REVIEW_HASH"
    return "\n".join(["[Unit]", "Description=Offline Arena consumer package " + mode, "", "[Service]", "Type=oneshot", "User=root", "Group=root", "WorkingDirectory=" + str(OPS), "ExecStart=/usr/bin/python3 -B " + str(OPS / "arena-credential-package-v2.py") + " --plan " + str(OPS / "plan.json") + action, "Environment=PYTHONDONTWRITEBYTECODE=1", "PrivateNetwork=yes", "PrivateTmp=no", "ProtectSystem=strict", "ProtectHome=yes", "NoNewPrivileges=yes", "CapabilityBoundingSet=", "AmbientCapabilities=", "RestrictAddressFamilies=AF_UNIX", "ReadWritePaths=" + str(WORK), "InaccessiblePaths=" + " ".join(sorted(PRIVATE | set(plan["hiddenVolumeChildren"]))), "MemoryMax=2G", "MemorySwapMax=0", "CPUQuota=100%", "RuntimeMaxSec=35min", "TimeoutStartSec=35min", "TimeoutStopSec=30s", "KillMode=control-group", "Restart=no", "UMask=0077", "IOReadBandwidthMax=/dev/sdb 52428800", "IOWriteBandwidthMax=/dev/sdb 52428800", ""])


def check_unit(primitives, mode, plan):
    unit = "yunipals-arena-credential-package-v2-" + mode + "-20261022.service"
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
    expected = {"format": FORMAT, "operatorSha256": primitives.file_sha(Path(__file__)), "work": str(WORK), "baseSourceDigest": BASE_DIGEST, "hiddenVolumeChildren": hidden_children()}
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main" or plan != expected:
        fail("exact_fixed_host_package_plan_required")
    unit = check_unit(primitives, mode, plan)
    primitives.trusted(OPS / "plan.json", 100_000)
    s = WORK.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o700 or any(WORK.iterdir()) or s.st_dev != VOLUME.stat().st_dev:
        fail("fresh_empty_volume_work_required")
    if shutil.disk_usage(WORK).free < RESERVE + WORK_CAP:
        fail("build_requires_25gb_reserve_plus_3gb_allowance")
    before = json.loads(primitives.pinned(BASE / "RELEASE-MANIFEST.json", BASE_MANIFEST_SHA))
    helper.source_check(BASE, BASE_DIGEST)
    inventory = json.loads(primitives.pinned(BASE_RUNTIME / "runtime-supplement.inventory.json", BASE_INVENTORY_SHA, 40_000_000))
    primitives.checked_file_hash(BASE_RUNTIME / "runtime-supplement.tar.gz", BASE_ARCHIVE_SHA, 250_000_000)
    if inventory.get("sourceDigest") != BASE_DIGEST or inventory.get("sourceManifestSha256") != BASE_MANIFEST_SHA or inventory.get("archiveSha256") != BASE_ARCHIVE_SHA or len(inventory["entries"]) != 60918:
        fail("exact_base_runtime_binding_required")
    primitives.checked_file_hash(OPS / "base-source.tar.gz", BASE_SOURCE_ARCHIVE_SHA, 50_000_000)
    evidence = json.loads(primitives.pinned(OPS / "base-consumer-evidence.json", BASE_EVIDENCE_SHA))
    if evidence.get("format") != "yunipals-arena-consumer-dependency-clone-package-v4" or evidence.get("status") != "passed" or evidence.get("sourceDigest") != BASE_DIGEST or evidence["source"]["manifestSha256"] != BASE_MANIFEST_SHA or evidence["source"]["archiveSha256"] != BASE_SOURCE_ARCHIVE_SHA or evidence["runtime"]["archiveSha256"] != BASE_ARCHIVE_SHA or evidence["runtime"]["inventorySha256"] != BASE_INVENTORY_SHA or evidence["runtime"]["helperSha256"] != RUNTIME_HELPER_SHA:
        fail("accepted_3c8776_build_evidence_binding_changed")
    primitives.checked_file_hash(Path(NODE), NODE_SHA, 150_000_000)
    helper.platform_check(NODE, inventory["runtime"])
    proposal = json.loads(primitives.pinned(OPS / "proposal.v1.json", PROPOSAL_SHA))
    patches = {name: primitives.pinned(OPS / "patches" / name, pin) for name, pin in PATCHES.items()}
    manifest = candidate_manifest(before, patches, proposal)
    rows = {r["path"]: r for r in before["files"]}
    templates = {template_path(w): primitives.pinned(BASE / template_path(w), rows[template_path(w)]["sha256"]) for w in proposal["workers"]}
    units = render_units(proposal, manifest["sourceDigest"], templates)
    binding = {"format": FORMAT, "plan": plan, "unit": unit, "workIdentity": [s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode], "baseManifestSha256": BASE_MANIFEST_SHA, "baseSourceArchiveSha256": BASE_SOURCE_ARCHIVE_SHA, "baseRuntimeArchiveSha256": BASE_ARCHIVE_SHA, "baseRuntimeInventorySha256": BASE_INVENTORY_SHA, "baseEvidenceSha256": BASE_EVIDENCE_SHA, "primitivesSha256": PRIMITIVES_SHA, "runtimeHelperSha256": RUNTIME_HELPER_SHA, "proposalSha256": PROPOSAL_SHA, "nodeSha256": NODE_SHA, "patches": PATCHES, "candidateSourceDigest": manifest["sourceDigest"], "candidateManifestSha256": sha(encoded(manifest)), "renderedUnitSha256": {k: sha(v.encode()) for k, v in units.items()}, "reserveBytes": RESERVE, "workCapBytes": WORK_CAP, "deadlineSeconds": DEADLINE, "dependencyMethod": "verified_3c8776_archive_clone_no_package_manager_install", "databaseConnections": 0, "providerCalls": 0, "productionChanges": False}
    return {"format": FORMAT, "reviewHash": sha(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode()), "binding": binding}, primitives, helper, before, manifest, patches, proposal, inventory


class Build:
    def __init__(self, checked, primitives, helper, before, manifest, patches, proposal, baseline):
        self.checked, self.p, self.h = checked, primitives, helper
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
            frames = [{"source": "arena-credential-package-v2.py", "line": f.lineno, "function": f.name} for f in traceback.extract_tb(error.__traceback__) if f.filename == __file__]
            result = {"format": FORMAT, "status": "failed", "reviewHash": self.checked["reviewHash"], "phase": self.phase, "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, PackageFailure) else "external_operation_failed", "knownPublicSourceFrames": frames[-8:], "automaticRetryAllowed": False, "partialWorkRetained": True}
            raise
        finally:
            self.stop_child()
            save(WORK / "attempt-result.json", {**(result or {"status": "failed"}), "steps": self.steps, "elapsedSeconds": round(time.monotonic() - self.started, 3), "minimumVolumeFreeBytes": self.minimum_free, "maximumWorkAllocatedBytes": self.maximum_allocated, "providerCalls": 0, "databaseConnections": 0, "existingArtifactsModified": False})

    def build(self):
        source, root, relocated = [WORK / x for x in ["source", "unpacked", "relocated"]]
        self.phase = "copy_exact_reviewed_source"
        self.p.copy_source(BASE, source, self.before); self.p.patch_source(source, self.manifest, self.patches)
        self.p.copy_source(BASE, root, self.before)
        self.run("clone-accepted-runtime", self.runtime_args("install", root, BASE_RUNTIME), WORK)
        self.p.patch_source(root, self.manifest, self.patches)
        for name in ["source.tar.gz", "source-repeat.tar.gz"]:
            self.p.source_archive(source, self.manifest, WORK / name); self.guard(force=True)
        if self.p.file_sha(WORK / "source.tar.gz") != self.p.file_sha(WORK / "source-repeat.tar.gz"):
            fail("source_archive_repeat_mismatch")
        self.run("source-verify", [NODE, "ops/unified-indexer/prepare-release.mjs", "--verify", str(root)], root)
        for app in ["yunipals-indexer", "yunipals-market-api"]:
            self.run(app + "-typecheck", [NODE, "--max-old-space-size=1024", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "--incremental", "false"], root / "apps" / app)
        self.run("credential-reader-controls", [NODE, "--import", "tsx", "src/arena/live/privateFile.test.ts"], root / "apps/yunipals-market-api")
        self.run("market-build", [NODE, "scripts/build.mjs"], root / "apps/yunipals-market-api", build=True)
        self.run("catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], root / "apps/yunipals-market-api")
        self.run("runtime-capture-a", self.runtime_args("build", root, WORK / "runtime-a"), WORK)
        inventory = json.loads((WORK / "runtime-a/runtime-supplement.inventory.json").read_bytes())
        delta = runtime_delta(self.baseline, inventory)
        self.p.copy_source(source, relocated, self.manifest)
        self.run("runtime-verify", self.runtime_args("verify", relocated, WORK / "runtime-a"), WORK)
        self.run("exclusive-relocation", self.runtime_args("install", relocated, WORK / "runtime-a"), WORK)
        self.run("relocated-credential-reader-controls", [NODE, "--import", "tsx", "src/arena/live/privateFile.test.ts"], relocated / "apps/yunipals-market-api")
        self.run("relocated-market-rebuild", [NODE, "scripts/build.mjs"], relocated / "apps/yunipals-market-api", build=True)
        self.run("runtime-capture-b", self.runtime_args("build", relocated, WORK / "runtime-b"), WORK)
        for name in ["runtime-supplement.tar.gz", "runtime-supplement.inventory.json"]:
            if self.p.file_sha(WORK / "runtime-a" / name) != self.p.file_sha(WORK / "runtime-b" / name):
                fail("independent_tree_rebuild_runtime_mismatch")
        self.run("relocated-source-verify", [NODE, "ops/unified-indexer/prepare-release.mjs", "--verify", str(relocated)], relocated)
        self.run("relocated-catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], relocated / "apps/yunipals-market-api")
        catalog = json.loads((WORK / "proof/relocated-catalog-smoke.stdout").read_bytes())
        installed = json.loads((WORK / "proof/exclusive-relocation.stdout").read_bytes())
        if catalog.get("islands") != 898 or catalog.get("identityProfiles") != 4 or installed.get("entriesVerified") != 60918 or installed.get("sourceUnchanged") is not True or installed.get("sourceDigest") != self.manifest["sourceDigest"] or installed.get("networkCalls") != 0:
            fail("relocation_and_catalog_acceptance_required")
        self.h.source_check(root, self.manifest["sourceDigest"]); self.h.source_check(relocated, self.manifest["sourceDigest"])
        rows = {r["path"]: r for r in self.before["files"]}
        templates = {template_path(w): self.p.pinned(BASE / template_path(w), rows[template_path(w)]["sha256"]) for w in self.proposal["workers"]}
        units = render_units(self.proposal, self.manifest["sourceDigest"], templates)
        rendered = WORK / "native-units"; rendered.mkdir(mode=0o700)
        for name, text in units.items():
            with (rendered / name).open("xb") as file:
                file.write(text.encode()); file.flush(); os.fsync(file.fileno())
        unit_pins = {name: sha(text.encode()) for name, text in units.items()}
        if unit_pins != self.checked["binding"]["renderedUnitSha256"]:
            fail("reviewed_native_unit_rendering_changed")
        proof = {"format": FORMAT, "status": "passed", "reviewHash": self.checked["reviewHash"], "sourceDigest": self.manifest["sourceDigest"], "source": {"archive": str(WORK / "source.tar.gz"), "archiveSha256": self.p.file_sha(WORK / "source.tar.gz"), "manifestSha256": sha(encoded(self.manifest)), "files": len(self.manifest["files"]), "baseSourceDigest": BASE_DIGEST, "baseManifestSha256": BASE_MANIFEST_SHA, "baseArchiveSha256": BASE_SOURCE_ARCHIVE_SHA, "baseBuildProofSha256": BASE_EVIDENCE_SHA, "baseRuntimeArchiveSha256": BASE_ARCHIVE_SHA, "baseRuntimeInventorySha256": BASE_INVENTORY_SHA, "exactPatchedSources": PATCHES, "byteIdenticalSecondCapture": True}, "runtime": {"archive": str(WORK / "runtime-a/runtime-supplement.tar.gz"), "archiveSha256": self.p.file_sha(WORK / "runtime-a/runtime-supplement.tar.gz"), "inventory": str(WORK / "runtime-a/runtime-supplement.inventory.json"), "inventorySha256": self.p.file_sha(WORK / "runtime-a/runtime-supplement.inventory.json"), "helperSha256": RUNTIME_HELPER_SHA, "entries": len(inventory["entries"]), "regularBytes": inventory["unpackedRegularBytes"], "exactDelta": delta, "separateRelocatedTreeRebuildByteIdentical": True}, "verification": {"twoFullTypechecks": True, "targetedCredentialReaderSuites": 2, "ordinaryMarketBuilds": 2, "bundleCount": 34, "catalog": catalog, "exclusiveRelocation": installed, "dependencyPackages": 330, "packageManagerInstalls": 0, "downloads": 0, "nativePonderBuildPerformed": False, "nativePonderSourcesUnchanged": True}, "nativeUnits": {"root": str(Path("/opt/yunipals-unified/releases") / self.manifest["sourceDigest"]), "files": unit_pins, "unitsInstalledOrStarted": False, "lobbyExecutionKey": "/etc/yunipals-arena/operator.key", "entriesEnabled": False, "newLobbiesEnabled": False}, "qualifications": ["Consumer-only credential compatibility artifact; its retained historical proxy bundle must not replace the active source6 proxy or actor008 replay.", "Accepted3c8776 runtime330 dependencies/shims/metadata are cloned unchanged, not newly package-manager installed. Two normal builds in separate trees share that accepted dependency closure.", "SourcePonder/nativebf inputs are unchanged; no new Ponder build, source readiness, DB/operational-role/ACL, provider-policy, cutover or production-runtime acceptance is claimed.", "Eight rendered native service definitions are reviewed public outputs only; private role URLs/grants and canonical readiness remain separate gates.", "No environment/key/provider/config values are loaded. Existing artifacts, private state, source selector and runtime services are untouched."]}
        self.guard(force=True); save(WORK / "arena-consumer-package-proof.json", proof)
        return {"format": FORMAT, "status": "passed", "reviewHash": self.checked["reviewHash"], "sourceDigest": self.manifest["sourceDigest"], "sourceArchiveSha256": proof["source"]["archiveSha256"], "runtimeArchiveSha256": proof["runtime"]["archiveSha256"], "runtimeInventorySha256": proof["runtime"]["inventorySha256"], "proofSha256": self.p.file_sha(WORK / "arena-consumer-package-proof.json"), "renderedUnits": 8, "deploymentPerformed": False, "automaticRetryAllowed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--plan", type=Path, required=True); parser.add_argument("--build"); args = parser.parse_args()
    os.umask(0o077); os.environ.clear(); os.environ.update(ENV)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    for signum in [signal.SIGTERM, signal.SIGINT]:
        signal.signal(signum, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.alarm(DEADLINE)
    build = None
    try:
        p = load(OPS / "source6-package-v3.py", PRIMITIVES_SHA)
        if args.plan != OPS / "plan.json":
            fail("fixed_package_plan_path_required")
        plan = json.loads(p.trusted(args.plan, 100_000))
        # The existing protected volume lease coordinates restore/extraction jobs.
        fd = os.open(VOLUME / ".yunipals-full-restore-v1.lock", os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "r") as lease:
            s = os.fstat(lease.fileno())
            if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or stat.S_IMODE(s.st_mode) != 0o600:
                fail("protected_existing_volume_lease_required")
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            data = review(plan, "build" if args.build else "review")
            checked = data[0]
            if args.build:
                if args.build != checked["reviewHash"]:
                    fail("fresh_exact_build_review_required")
                build = Build(*data); result = build.execute()
            else:
                result = {"format": FORMAT, "status": "reviewed_not_built", "reviewHash": checked["reviewHash"], "sourceDigest": checked["binding"]["candidateSourceDigest"], "manifestSha256": checked["binding"]["candidateManifestSha256"], "renderedUnitSha256": checked["binding"]["renderedUnitSha256"], "buildPerformed": False, "deploymentPerformed": False}
        print(json.dumps(result, sort_keys=True))
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "status": "failed", "phase": build.phase if build is not None else "readonly_review", "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, PackageFailure) else "external_operation_failed", "knownPublicSourceFrames": [{"source": "arena-credential-package-v2.py", "line": f.lineno, "function": f.name} for f in traceback.extract_tb(error.__traceback__) if f.filename == __file__][-8:], "rawMessagesExported": False}, sort_keys=True))
        raise SystemExit(1)
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    main()
