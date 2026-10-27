#!/usr/bin/env python3
"""Install the completed modern Arena artifact into a fresh, unselected release."""
from __future__ import annotations

import argparse
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
import types

FORMAT = "yunipals-arena-modern-install-v1"
OPS = Path("/opt/yunipals-unified/operations/arena-modern-package-20261022")
WORK = Path("/mnt/HC_Volume_107222036/arena-modern-package-20261022")
SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24"
MANIFEST_SHA = "fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e"
TARGET = Path("/opt/yunipals-unified/releases") / SOURCE
ARTIFACT = Path("/var/tmp/yunipals-runtime-264a3322-20261022")
PROOF = WORK / "arena-consumer-package-proof.json"
ENV = {"PATH": "/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1"}


def fail(code):
    raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def pin(value):
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value) or value == "0" * 64:
        fail("actual_public_sha256_required")
    return value


def save(path, value):
    with path.open("xb") as handle:
        handle.write(encoded(value))
        handle.flush()
        os.fsync(handle.fileno())


def modules(package_sha):
    path = OPS / "arena-modern-package-v1.py"
    for parent in [*path.parents, path]:
        entry = parent.lstat()
        if stat.S_ISLNK(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            fail("protected_package_helper_required")
    raw = path.read_bytes()
    if len(raw) > 100_000 or sha(raw) != pin(package_sha):
        fail("reviewed_modern_package_helper_required")
    module = types.ModuleType("completed_modern_arena_package")
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    if module.OPS != OPS or module.WORK != WORK or module.FORMAT != "yunipals-arena-modern-package-v1":
        fail("fixed_modern_package_namespace_required")
    return module, module.load(OPS / "source6-package-v3.py", module.PRIMITIVES_SHA), module.load(OPS / "runtime-supplement.py", module.RUNTIME_HELPER_SHA)


def validate_proof(proof, result, output, proof_sha, review_hash):
    if (proof.get("format") != "yunipals-arena-modern-package-v1" or proof.get("status") != "passed"
            or proof.get("reviewHash") != pin(review_hash) or proof.get("sourceDigest") != SOURCE
            or proof.get("source", {}).get("manifestSha256") != MANIFEST_SHA or proof["source"].get("files") != 1796
            or proof.get("runtime", {}).get("entries") != 60922
            or proof["runtime"].get("separateRelocatedTreeRebuildByteIdentical") is not True
            or proof.get("verification", {}).get("twoFullTypechecks") is not True
            or proof["verification"].get("ordinaryMarketBuilds") != 2
            or proof["verification"].get("bundleCount") != 36
            or proof["verification"].get("dependencyPackages") != 330
            or proof["verification"].get("targetedCredentialReaderSuites") != 2
            or proof["verification"].get("credentialControlsPerSuite") != 79
            or proof["verification"].get("modernAcceptanceSuites") != 2
            or proof["verification"].get("modernChecksPerSuite") != 21
            or proof["verification"].get("catalog", {}).get("rulesHash") != "0x46a4dc89a248047d27c6b02d208c5d2866e843280ef2803294384850edb06c80"
            or proof["verification"].get("catalog", {}).get("poolHash") != "0x9d80402505ef5b278e8417b2d9b6e2b80d63326bb02d7f465f42d19f7dc8019c"
            or proof["verification"].get("catalog", {}).get("islands") != 898):
        fail("completed_modern_source_runtime_qualification_required")
    for receipt in [result, output]:
        if receipt.get("status") != "passed" or receipt.get("proofSha256") != proof_sha or receipt.get("reviewHash") != review_hash:
            fail("actual_successful_build_receipts_required")
    expected_steps = {"credential-reader-controls", "relocated-credential-reader-controls", "modern-acceptance", "relocated-modern-acceptance"}
    steps = result.get("steps", [])
    qualified = [row for row in steps if row.get("name") in expected_steps]
    if len(qualified) != 4 or {row.get("name") for row in qualified} != expected_steps or any(row.get("exitCode") != 0 for row in qualified):
        fail("both_actual_credential_and_modern_acceptance_runs_required")
    return proof


def review(proof_sha, review_hash, package_sha):
    pin(proof_sha)
    module, primitives, helper = modules(package_sha)
    proof = json.loads(primitives.pinned(PROOF, proof_sha, 150_000))
    result = json.loads(primitives.trusted(WORK / "attempt-result.json", 150_000))
    output = json.loads(primitives.trusted(OPS / "actual-build.stdout.json", 150_000))
    validate_proof(proof, result, output, proof_sha, review_hash)
    state = subprocess.run(["/usr/bin/systemctl", "show", "yunipals-arena-modern-package-v1-build-20261022.service", "--property=ActiveState,MainPID,Result,ExecMainStatus"], env=ENV, capture_output=True, text=True, check=True, timeout=5)
    if dict(line.split("=", 1) for line in state.stdout.splitlines()) != {"ActiveState": "inactive", "MainPID": "0", "Result": "success", "ExecMainStatus": "0"}:
        fail("successful_stopped_offline_build_required")
    if os.path.lexists(TARGET) or os.path.lexists(ARTIFACT):
        fail("fresh_consumer_artifact_destinations_required")
    for path in [*TARGET.parent.parents, TARGET.parent, ARTIFACT.parent]:
        entry = path.lstat()
        if not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or entry.st_mode & 0o022:
            # /var/tmp is an ordinary sticky temporary directory. The new child
            # itself remains O_EXCL-owned and never replaces an existing entry.
            if path != Path("/var/tmp") or not stat.S_ISDIR(entry.st_mode) or entry.st_uid != 0 or not entry.st_mode & stat.S_ISVTX:
                fail("protected_consumer_release_ancestry_required")
    primitives.checked_file_hash(Path(module.NODE), module.NODE_SHA, 150_000_000)
    if shutil.disk_usage(TARGET.parent).free < 27_000_000_000:
        fail("consumer_install_reserve_required")
    manifest = helper.source_check(WORK / "source", SOURCE)
    if len(manifest["files"]) != 1796 or sha(encoded(manifest)) != MANIFEST_SHA:
        fail("exact_modern_source_inventory_required")
    runtime = WORK / "runtime-a"
    inventory = json.loads(primitives.pinned(runtime / "runtime-supplement.inventory.json", proof["runtime"]["inventorySha256"], 40_000_000))
    primitives.checked_file_hash(runtime / "runtime-supplement.tar.gz", proof["runtime"]["archiveSha256"], 250_000_000)
    if (inventory.get("sourceDigest") != SOURCE or inventory.get("sourceManifestSha256") != MANIFEST_SHA
            or inventory.get("archiveSha256") != proof["runtime"]["archiveSha256"] or len(inventory.get("entries", [])) != 60922):
        fail("exact_modern_runtime_binding_required")
    value = {"format": FORMAT, "proofSha256": proof_sha, "buildReviewHash": review_hash, "packageOperatorSha256": package_sha, "sourceDigest": SOURCE, "manifestSha256": MANIFEST_SHA, "runtimeArchiveSha256": proof["runtime"]["archiveSha256"], "runtimeInventorySha256": proof["runtime"]["inventorySha256"], "target": str(TARGET), "artifact": str(ARTIFACT), "serviceChanges": 0, "databaseChanges": 0, "sourceSelectionsChanged": 0}
    return value, module, primitives, helper, manifest, inventory


def install(data, expected):
    value, module, primitives, helper, manifest, inventory = data
    if sha(encoded(value)) != expected:
        fail("exact_fresh_install_review_required")
    ARTIFACT.mkdir(mode=0o700)
    save(ARTIFACT / "install-intent.json", value)
    phase = "copy_public_source"
    try:
        primitives.copy_source(WORK / "source", TARGET, manifest)
        for name, source, checksum, maximum in [("arena-consumer-package-proof.json", PROOF, value["proofSha256"], 150_000), ("runtime-supplement.tar.gz", WORK / "runtime-a/runtime-supplement.tar.gz", value["runtimeArchiveSha256"], 250_000_000), ("runtime-supplement.inventory.json", WORK / "runtime-a/runtime-supplement.inventory.json", value["runtimeInventorySha256"], 40_000_000)]:
            phase = "copy_public_runtime_inputs"
            primitives.checked_file_hash(source, checksum, maximum)
            with source.open("rb") as incoming, (ARTIFACT / name).open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1_048_576)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            primitives.checked_file_hash(ARTIFACT / name, checksum, maximum)
        phase = "exclusive_runtime_install"
        command = ["/usr/bin/python3", "-B", str(OPS / "runtime-supplement.py"), "install", "--archive", str(ARTIFACT / "runtime-supplement.tar.gz"), "--inventory", str(ARTIFACT / "runtime-supplement.inventory.json"), "--archive-sha256", value["runtimeArchiveSha256"], "--inventory-sha256", value["runtimeInventorySha256"], "--target", str(TARGET), "--node", module.NODE]
        completed = subprocess.run(command, env=ENV, capture_output=True, timeout=240)
        if completed.returncode or max(len(completed.stdout), len(completed.stderr)) > 100_000:
            fail("exclusive_modern_runtime_install_failed")
        installed = json.loads(completed.stdout)
        if installed.get("entriesVerified") != 60922 or installed.get("sourceDigest") != SOURCE or installed.get("sourceUnchanged") is not True or installed.get("networkCalls") != 0:
            fail("actual_modern_runtime_install_proof_required")
        phase = "public_source_permissions"
        parents = {TARGET}
        for name in ["RELEASE-MANIFEST.json", "SHA256SUMS", *[row["path"] for row in manifest["files"]]]:
            path = TARGET / name
            if path.is_symlink() or not path.is_file():
                fail("new_regular_public_source_required")
            path.chmod(0o644)
            parents.update(parent for parent in path.parents if parent == TARGET or parent.is_relative_to(TARGET))
        for path in parents:
            if path.is_symlink() or not path.is_dir():
                fail("new_public_source_directory_required")
            path.chmod(0o755)
        phase = "installed_payload_verification"
        helper.source_check(TARGET, SOURCE)
        roots, entries = helper.inventory_entries(TARGET)
        if roots != inventory["roots"] or entries != inventory["entries"]:
            fail("actual_installed_runtime_bytes_changed")
        if shutil.disk_usage(TARGET.parent).free < 25_000_000_000:
            fail("consumer_install_reserve_breached")
        result = {**value, "installed": True, "installedEntriesVerified": len(entries), "sourceFilesVerified": len(manifest["files"]), "runtimeStarted": False, "olderArtifactsModified": False}
        save(ARTIFACT / "install-result.json", result)
        return result
    except BaseException as error:
        save(ARTIFACT / "install-failed.json", {"format": FORMAT, "phase": phase, "errorClass": type(error).__name__, "partialNewArtifactRetained": True, "automaticRetry": False})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof-sha256", required=True)
    parser.add_argument("--build-review", required=True)
    parser.add_argument("--package-sha256", required=True)
    parser.add_argument("--install")
    arguments = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main":
        fail("fixed_root_host_required")
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(ENV)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(600)
    data = review(arguments.proof_sha256, arguments.build_review, arguments.package_sha256)
    value = install(data, arguments.install) if arguments.install else {"format": FORMAT, "reviewHash": sha(encoded(data[0])), "applied": False, **data[0]}
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "errorClass": type(error).__name__, "rawMessagesExported": False}))
        raise SystemExit(1)
