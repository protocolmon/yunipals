#!/usr/bin/env python3
"""One owned synthetic systemd namespace probe. Default is read-only review.

No database/provider/RPC request, real key/credential, boot link or scanner start.
"""
from __future__ import annotations
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import time

HERE = Path(__file__).parent
FORMAT = "yunipals-arena-public-scanner-probe-owner-v4"
UNIT = "yunipals-arena-public-rollback-reader-probe-v1.service"
BASE = Path("/var/backups/yunipals-arena-public-scanner-probe-v4-20261023")
PUBLIC = Path("/run/yunipals-arena-public-reader-probe-v1")
FRAGMENT = Path("/run/systemd/system") / UNIT
CHILD = HERE / "arena-modern-public-rollback-v1.mjs"
CHILD_SHA = "f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2"
PROBE = HERE / "arena-public-scanner-probe-v1.mjs"
PROBE_SHA = "34a2051062a2ba52d93a87c0598a4330ed29de8e1a5354954617ada80494d5ed"
SOURCE = "264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24"
ROOT = Path("/opt/yunipals-unified/releases") / SOURCE
MANIFEST_SHA = "fe6a122bd9dbac6614ff2126db2010a4f73bc54921f8dc40109a9c850ee3eb3e"
NODE = Path("/opt/node-v24.18.1/bin/node")
SYNTHETIC = b"ARENA_PUBLIC_ROLLBACK_DATABASE_URL=postgresql://arena_public_rollback_writer:synthetic-scanner-probe-only@127.0.0.1:5432/yunipals_arena_public_rollback\n"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/nonexistent", "LANG": "C.UTF-8", "TZ": "UTC"}
PROPS = ["Id", "LoadState", "ActiveState", "SubState", "MainPID", "InvocationID", "FragmentPath", "DropInPaths", "ExecStart", "WorkingDirectory", "User", "DynamicUser", "NoNewPrivileges", "ProtectSystem", "ProtectHome", "PrivateTmp", "PrivateDevices", "PrivateNetwork", "RestrictSUIDSGID", "RestrictAddressFamilies", "CapabilityBoundingSet", "AmbientCapabilities", "EnvironmentFiles", "Environment", "LoadCredential", "Restart", "KillMode", "MemoryMax", "TasksMax", "RuntimeMaxUSec", "Job", "Result", "ExecMainStatus"]

class Refusal(RuntimeError):
    pass

def need(value, code):
    if not value:
        raise Refusal(code)

def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(path):
    s = path.lstat()
    return {"dev": s.st_dev, "ino": s.st_ino, "mode": s.st_mode, "uid": s.st_uid, "gid": s.st_gid, "bytes": s.st_size, "mtimeNs": s.st_mtime_ns, "ctimeNs": s.st_ctime_ns}

def protected(path, maximum=2000000, empty=False):
    path = Path(path)
    need(path.is_absolute(), "absolute_protected_source_required")
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, "protected_source_parent_required")
    before = identity(path)
    need(stat.S_ISREG(before["mode"]) and before["uid"] == before["gid"] == 0 and not before["mode"] & 0o022 and (empty or before["bytes"] > 0) and before["bytes"] <= maximum and path.lstat().st_nlink == 1, "bounded_root_regular_source_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, maximum + 1)
        need(len(raw) <= maximum and before == identity(path), "source_changed_during_read")
        return raw
    finally:
        os.close(fd)

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    os.fchmod(fd, mode)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(path.parent)

def once(path, value):
    if os.path.lexists(path):
        need(protected(path) == encoded(value), "owned_cleanup_intent_changed")
    else:
        save(path, value)

def run(args, timeout=10, accepted=(0,)):
    result = subprocess.run(args, env=ENV, capture_output=True, timeout=timeout)
    need(result.returncode in accepted and len(result.stdout) < 200000 and not result.stderr, "bounded_systemd_command_refused")
    return result.stdout

def typed_empty(key, signature):
    need((key, signature) in {("EnvironmentFiles", "a(sb)"), ("Environment", "as"), ("LoadCredential", "a(ss)"), ("ExecStart", "a(sasbttttuii)")}, "fixed_empty_manager_property_required")
    # The absent fixed unit has no Manager.GetUnit object, but the Service
    # interface is available at its exact escaped path on this host.
    object_path = "/org/freedesktop/systemd1/unit/" + re.sub(r"[^A-Za-z0-9]", lambda item: "_" + format(ord(item[0]), "02x"), UNIT)
    value = json.loads(run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", object_path, "org.freedesktop.systemd1.Service", key]))
    need(value == {"type": signature, "data": []}, "omitted_property_must_be_typed_empty")
    return ""


def props():
    raw = run(["/usr/bin/systemctl", "show", "--all", UNIT, *["--property=" + key for key in PROPS]], accepted=(0, 1, 4)).decode()
    pairs = [line.split("=", 1) for line in raw.splitlines()]
    need(all(len(pair) == 2 for pair in pairs) and len(dict(pairs)) == len(pairs) and set(dict(pairs)) <= set(PROPS), "unique_fixed_probe_properties_required")
    value = dict(pairs)
    for key, signature in [("EnvironmentFiles", "a(sb)"), ("Environment", "as"), ("LoadCredential", "a(ss)")]:
        if key not in value:
            value[key] = typed_empty(key, signature)
    if "ExecStart" not in value:
        need(value.get("LoadState") == "not-found" and value.get("ActiveState") == "inactive" and value.get("SubState") == "dead" and value.get("MainPID") == "0" and value.get("Job") == "" and value.get("FragmentPath") == "" and value.get("DropInPaths") == "", "omitted_exec_start_requires_fresh_absent_unit")
        value["ExecStart"] = typed_empty("ExecStart", "a(sasbttttuii)")
    if value.get("LoadCredential") == "[unprintable]":
        # systemctl's opaque display is not an empty credential definition.
        # Bind the exact typed ID/source pair before using its equivalent CLI
        # representation in the unchanged static checks.
        object_path = "/org/freedesktop/systemd1/unit/" + re.sub(r"[^A-Za-z0-9]", lambda item: "_" + format(ord(item[0]), "02x"), UNIT)
        typed = json.loads(run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", object_path, "org.freedesktop.systemd1.Service", "LoadCredential"]))
        absent = (
            value.get("LoadState") == "not-found" and
            value.get("ActiveState") == "inactive" and
            value.get("SubState") == "dead" and
            value.get("MainPID") == "0" and value.get("Job") == "" and
            value.get("FragmentPath") == "" and value.get("DropInPaths") == ""
        )
        if absent:
            need(typed == {"type": "a(ss)", "data": []}, "opaque_credential_requires_exact_typed_empty_absent_source")
            value["LoadCredential"] = ""
        else:
            expected_source = str(BASE / "fake-public-db.env")
            need(value.get("LoadState") == "loaded" and typed == {"type": "a(ss)", "data": [["public-db.env", expected_source]]}, "opaque_credential_requires_exact_typed_fake_source")
            value["LoadCredential"] = "public-db.env:" + expected_source
    need(value["Id"] == UNIT and set(value) == set(PROPS), "fixed_probe_unit_only")
    return value

def activation_paths():
    return sorted(str(parent / UNIT) for root in [Path("/etc/systemd/system"), Path("/run/systemd/system"), Path("/usr/lib/systemd/system")] for suffix in ["*.wants", "*.requires", "*.upholds"] for parent in root.glob(suffix) if os.path.lexists(parent / UNIT))

def definition():
    # Scanner-equivalent settings are retained. The synthetic-only delta adds
    # a private network and hides private roots: reachability is never claimed.
    return f"""[Unit]
Description=Synthetic public Arena scanner namespace qualification
StartLimitIntervalSec=300
StartLimitBurst=1
[Service]
Type=simple
DynamicUser=yes
User=yunipals-arena-public-recovery
WorkingDirectory={ROOT}/apps/yunipals-market-api
ExecStart={NODE} {PUBLIC}/probe.mjs
LoadCredential=public-db.env:{BASE}/fake-public-db.env
Environment=NODE_OPTIONS=--max-old-space-size=256
Environment=TSX_DISABLE_CACHE=1
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
PrivateNetwork=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET
IPAddressDeny=any
IPAddressAllow=localhost
InaccessiblePaths=-/etc/yunipals-arena -/etc/yunipals-unified -/var/backups
UMask=0077
MemoryMax=512M
TasksMax=32
RuntimeMaxSec=45s
Restart=no
TimeoutStopSec=5s
KillMode=control-group
StandardInput=null
StandardOutput=append:{BASE}/stdout.jsonl
StandardError=append:{BASE}/stderr.txt
""".encode()

def source_binding():
    child, probe = protected(CHILD, 100000), protected(PROBE, 100000)
    need(sha(child) == CHILD_SHA and sha(probe) == PROBE_SHA, "exact_frozen_probe_and_reader_required")
    manifest_raw = protected(ROOT / "RELEASE-MANIFEST.json", 2000000)
    need(sha(manifest_raw) == MANIFEST_SHA, "actual_installed_modern_source_manifest_required")
    manifest = json.loads(manifest_raw)
    need(manifest["sourceDigest"] == SOURCE and len(manifest["files"]) == 1796, "actual_modern_installed_source_required")
    names = ["apps/yunipals-market-api/src/arena/live/projector.ts", "apps/yunipals-market-api/src/arena/live/projection.ts", "apps/yunipals-market-api/src/confirmations.ts", "apps/yunipals-market-api/src/rpcBudgetProxyRegistry.ts", "packages/yunipals-market-core/src/arena.ts"]
    hashes = {}
    for name in names:
        rows = [row for row in manifest["files"] if row["path"] == name]
        raw = protected(ROOT / name, 200000)
        need(len(rows) == 1 and rows[0]["sha256"] == sha(raw) and rows[0]["bytes"] == len(raw), "exact_installed_public_import_source_required")
        hashes[name] = sha(raw)
    need(NODE.is_file(), "existing_fixed_node_runtime_required")
    return {"sourceDigest": SOURCE, "manifestSha256": MANIFEST_SHA, "childSha256": CHILD_SHA, "probeSha256": PROBE_SHA, "publicImportSourceSha256": hashes}

def review():
    need(not os.path.lexists(BASE) and not os.path.lexists(PUBLIC), "fresh_probe_evidence_and_public_namespace_required")
    need(not activation_paths() and all(not os.path.lexists(path) for path in [FRAGMENT, Path(str(FRAGMENT) + ".d"), Path("/etc/systemd/system") / UNIT, Path("/etc/systemd/system") / (UNIT + ".d"), Path("/usr/lib/systemd/system") / UNIT]), "fresh_probe_unit_and_activation_namespace_required")
    current = props()
    need(current["LoadState"] == "not-found" and current["MainPID"] == "0" and current["ActiveState"] == "inactive" and current["Job"] == "", "no_existing_probe_job_or_process_required")
    source = source_binding()
    return {"format": FORMAT, "operatorSha256": sha(Path(__file__).read_bytes()), "source": source, "unit": UNIT, "unitSha256": sha(definition()), "syntheticInputSha256": sha(SYNTHETIC), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "databaseRequests": 0, "providerRequests": 0, "realCredentialsProvided": 0, "networkReachabilityClaimed": False}

def static_state(current):
    need(sha(protected(FRAGMENT, 10000)) == sha(definition()) and current["FragmentPath"] == str(FRAGMENT) and current["DropInPaths"] == "" and not activation_paths(), "owned_probe_definition_or_activation_changed")
    expected = {"WorkingDirectory": str(ROOT / "apps/yunipals-market-api"), "User": "yunipals-arena-public-recovery", "DynamicUser": "yes", "NoNewPrivileges": "yes", "ProtectSystem": "strict", "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes", "PrivateNetwork": "yes", "RestrictSUIDSGID": "yes", "CapabilityBoundingSet": "", "AmbientCapabilities": "", "EnvironmentFiles": "", "Restart": "no", "KillMode": "control-group", "MemoryMax": "536870912", "TasksMax": "32", "RuntimeMaxUSec": "45s"}
    need(all(current[k] == v for k, v in expected.items()), "loaded_probe_hardening_changed")
    need(set(shlex.split(current["Environment"])) == {"NODE_OPTIONS=--max-old-space-size=256", "TSX_DISABLE_CACHE=1"} and current["LoadCredential"] == "public-db.env:" + str(BASE / "fake-public-db.env") and set(current["RestrictAddressFamilies"].split()) == {"AF_UNIX", "AF_INET"}, "loaded_synthetic_only_environment_or_credential_changed")
    args = re.findall(r"argv\[\]=(.*?)\s+;", current["ExecStart"])
    need(len(args) == 1 and shlex.split(args[0]) == [str(NODE), str(PUBLIC / "probe.mjs")], "exact_probe_exec_required")

def actor(current):
    static_state(current)
    need(current["MainPID"].isdigit() and int(current["MainPID"]) > 1 and re.fullmatch("[0-9a-f]{32}", current["InvocationID"]) and current["Job"] == "", "actual_owned_probe_invocation_required")
    pid = int(current["MainPID"])
    root = Path("/proc") / str(pid)
    before = (root / "stat").read_text()
    start = int(before[before.rfind(")") + 2:].split()[19])
    intent = json.loads(protected(BASE / "start-intent.json"))
    need(start >= intent["monotonicNs"] * os.sysconf("SC_CLK_TCK") // 1000000000, "probe_actor_predates_owned_start")
    status = dict(line.split(":", 1) for line in (root / "status").read_text().splitlines() if ":" in line)
    uids, gids = [int(x) for x in status["Uid"].split()], [int(x) for x in status["Gid"].split()]
    need(len(set(uids)) == len(set(gids)) == 1 and uids[0] >= 61184 and gids[0] >= 61184 and status["NoNewPrivs"].strip() == "1" and all(int(status[k], 16) == 0 for k in ["CapPrm", "CapEff", "CapAmb"]), "nonprivileged_dynamic_probe_identity_required")
    need((root / "cmdline").read_bytes().split(b"\0") == [str(NODE).encode(), str(PUBLIC / "probe.mjs").encode(), b""] and (root / "cgroup").read_text().splitlines() == ["0::/system.slice/" + UNIT], "exact_probe_process_and_cgroup_required")
    after = (root / "stat").read_text()
    need(start == int(after[after.rfind(")") + 2:].split()[19]) and props() == current, "probe_actor_changed_during_proof")
    return {"pid": pid, "invocation": current["InvocationID"], "startTicks": start, "uid": uids[0], "gid": gids[0]}

def quiet():
    current = props()
    need(current["MainPID"] == "0" and current["ActiveState"] in {"inactive", "failed"} and current["Job"] == "", "owned_probe_must_be_terminal")
    group = Path("/sys/fs/cgroup/system.slice") / UNIT
    if group.exists():
        need(not (group / "cgroup.procs").read_text().strip() and dict(line.split() for line in (group / "cgroup.events").read_text().splitlines()).get("populated") == "0", "owned_probe_cgroup_must_be_recursively_empty")
    return current

def cleanup():
    operation = json.loads(protected(BASE / "operation.json"))
    need(operation["operatorSha256"] == sha(Path(__file__).read_bytes()) and operation["bootId"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "same_boot_owned_probe_cleanup_required")
    files = json.loads(protected(BASE / "files.json"))
    current = props()
    if os.path.lexists(FRAGMENT):
        static_state(current)
    else:
        need(json.loads(protected(BASE / (FRAGMENT.name + ".unlink-intent.json"))) == files[str(FRAGMENT)] and current["DropInPaths"] == "" and current["FragmentPath"] in {"", str(FRAGMENT)}, "owned_unit_unlink_acknowledgement_required")
    if current["MainPID"] != "0":
        previous = json.loads(protected(BASE / "actor.json"))
        need(actor(current) == previous, "foreign_probe_replacement_must_not_be_stopped")
        once(BASE / "stop-intent.json", previous)
        # Fresh identity CAS is immediately adjacent to the only stop command.
        need(actor(props()) == previous, "probe_actor_changed_before_stop")
        run(["/usr/bin/systemctl", "stop", UNIT], timeout=10)
    quiet()
    need(not activation_paths(), "probe_must_never_have_boot_or_trigger_links")
    for path in [FRAGMENT, PUBLIC / "probe.mjs", PUBLIC / "child.mjs", BASE / "fake-public-db.env"]:
        if os.path.lexists(path):
            row = files[str(path)]
            need(identity(path) == row["identity"] and sha(protected(path, 100000)) == row["sha256"], "only_exact_owned_probe_inode_may_be_removed")
            once(BASE / (path.name + ".unlink-intent.json"), row)
            path.unlink(); sync(path.parent)
        else:
            need(json.loads(protected(BASE / (path.name + ".unlink-intent.json"))) == files[str(path)], "missing_owned_file_requires_unlink_intent")
    if PUBLIC.exists():
        need(not any(PUBLIC.iterdir()), "foreign_public_probe_file_blocks_directory_cleanup")
        PUBLIC.rmdir(); sync(PUBLIC.parent)
    run(["/usr/bin/systemctl", "daemon-reload"])
    need(not os.path.lexists(FRAGMENT) and not os.path.lexists(PUBLIC) and not activation_paths(), "owned_synthetic_probe_cleanup_incomplete")
    value = {"format": FORMAT, "cleanupComplete": True, "unitFileRemoved": True, "syntheticInputRemoved": True, "publicProbeFilesRemoved": True, "bootLinksCreated": 0, "existingScannerChanged": False}
    if not (BASE / "cleanup-result.json").exists():
        save(BASE / "cleanup-result.json", value)
    return value

def public_directory():
    PUBLIC.mkdir(mode=0o755)
    fd = os.open(PUBLIC, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISDIR(before.st_mode) and before.st_uid == before.st_gid == 0 and before.st_ino == PUBLIC.lstat().st_ino, "fresh_owned_public_directory_required")
        os.fchmod(fd, 0o755)
        after = os.fstat(fd)
        need(after.st_ino == before.st_ino and stat.S_IMODE(after.st_mode) == 0o755 and after.st_ino == PUBLIC.lstat().st_ino, "traversable_owned_public_directory_required")
        os.fsync(fd)
    finally:
        os.close(fd)
    sync(PUBLIC.parent)

def apply(expected):
    binding = review()
    need(re.fullmatch("[0-9a-f]{64}", expected) and sha(encoded(binding)) == expected, "exact_fresh_synthetic_probe_review_required")
    BASE.mkdir(mode=0o700); sync(BASE.parent)
    save(BASE / "operation.json", binding)
    public_directory()
    bodies = {PUBLIC / "probe.mjs": (protected(PROBE, 100000), 0o644), PUBLIC / "child.mjs": (protected(CHILD, 100000), 0o644), BASE / "fake-public-db.env": (SYNTHETIC, 0o600), FRAGMENT: (definition(), 0o644)}
    files = {}
    for path, (raw, mode) in bodies.items():
        save(path, raw, mode)
        files[str(path)] = {"identity": identity(path), "sha256": sha(raw)}
    save(BASE / "files.json", files)
    save(BASE / "stdout.jsonl", b""); save(BASE / "stderr.txt", b"")
    run(["/usr/bin/systemctl", "daemon-reload"])
    static_state(props())
    save(BASE / "start-intent.json", {"monotonicNs": time.monotonic_ns(), "unit": UNIT, "automaticRetryAllowed": False})
    try:
        run(["/usr/bin/systemctl", "start", "--no-block", UNIT])
        deadline = time.monotonic() + 35
        observed = None
        while True:
            current = props()
            if current["MainPID"] != "0" and current["ActiveState"] == "active" and current["Job"] == "" and observed is None:
                observed = actor(current); save(BASE / "actor.json", observed)
            raw = protected(BASE / "stdout.jsonl", 20000, empty=True)
            if raw.endswith(b"\n"):
                rows = raw.splitlines()
                need(len(rows) == 1, "single_bounded_synthetic_probe_proof_required")
                proof = json.loads(rows[0])
                break
            need(time.monotonic() < deadline and current["ActiveState"] not in {"inactive", "failed"}, "bounded_probe_did_not_report")
            time.sleep(0.1)
        need(observed is not None and actor(props()) == observed, "actual_unchanged_probe_namespace_required")
        need(not protected(BASE / "stderr.txt", 10000, empty=True), "probe_stderr_requires_review")
        need(proof.get("format") == "yunipals-arena-public-scanner-synthetic-probe-v1" and proof.get("childSha256") == CHILD_SHA and proof.get("syntheticOnly") is True, "actual_frozen_synthetic_probe_proof_required")
        save(BASE / "probe-proof.json", proof)
    finally:
        cleaned = cleanup()
    result = {"format": FORMAT, "qualified": proof.get("qualified") is True, "actualNamespace": observed, "proof": proof, "cleanup": cleaned, "productionDatabaseRequests": 0, "providerRequests": 0, "realCredentialsProvided": 0, "networkReachabilityClaimed": False}
    save(BASE / "result.json", result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--run", help="Exact fresh synthetic-only review hash")
    modes.add_argument("--cleanup", action="store_true")
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(120)
    lock = os.open("/run/lock/yunipals-arena-public-scanner-probe-v4.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(lock)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600, "owned_synthetic_probe_lock_required")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.cleanup:
            result = cleanup()
        elif args.run:
            result = apply(args.run)
        else:
            value = review(); result = {"format": FORMAT, "reviewHash": sha(encoded(value)), "review": value, "serviceJobs": 0, "databaseRequests": 0}
        print(json.dumps(result, sort_keys=True))
    finally:
        os.close(lock)

if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "qualified": False, "fixedCode": str(error) if isinstance(error, Refusal) else "synthetic_probe_owner_refused", "errorClass": type(error).__name__, "rawMessagesExported": False, "automaticRetryAllowed": False}, sort_keys=True))
        raise SystemExit(1)
