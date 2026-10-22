#!/usr/bin/env python3
"""Verify five existing EVM dependencies after their normal proxy restarts.

Only public fingerprints are written. No environment file is opened, no service
is changed, and no database or provider is contacted. The archive operation
selects only explicit EVM unit/source members from the verified local backup.
"""
from __future__ import annotations

import argparse
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import stat
import subprocess
import tarfile
import tempfile
import threading
import time
import types

OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BEFORE = OPS / "dependency-before.json"
OUTPUT = OPS / "dependency-rebase-range-hints-v5.json"
WIRING = OPS / "production-release-wiring-2026-10-20.json"
WIRING_SHA = "a8565aa24dbfbdd1c27cf2edc120f622e51e8a436cfa769393ae2d3129ea226b"
VERIFIER = OPS / "proxy-upgrade.py"
VERIFIER_SHA = "ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965"
MONITOR = Path("/var/lib/yunipals-unified-shadow/20261020-7e7375b0-a/monitor.jsonl")
BACKUP = Path("/var/backups/yunipals-unified-precutover-20261020T213755Z-56cc0cc49eeb")
ARCHIVE = BACKUP / "runtime-config-artwork.tar.zst.gpg"
CIPHER_SHA = "9f8761498f3763db3c7981416ab9d0655cca290f5486cb01714a4f75801aa151"
CIPHER_BYTES = 4678768256
PLAIN_SHA = "e0601cb8576895e140ae8b16aeb4742773a725a6142ccb3ad6b275a335de393a"
PLAIN_BYTES = 4676705514
UNITS = tuple("yunipals-" + name + ".service" for name in ["indexer", "bnb", "metadata", "api", "leaderboard"])
OLD = "/opt/yunipals/releases/f0bd9a0/apps/yunipals-indexer"
RUNTIME = {
    UNITS[0]: [OLD + "/ponder.config.ts", OLD + "/ponder.schema.ts", OLD + "/src/index.ts", OLD + "/package.json"],
    UNITS[1]: [OLD + "/lib/bnb/worker.ts"],
    # The separately installed short-confirmation entry is identified by the
    # prior wiring inventory. Its archived import root is fingerprinted here.
    UNITS[2]: [OLD + "/lib/metadata/worker.ts", OLD + "/package.json"],
    UNITS[3]: ["/opt/yunipals/releases/trait-filter-20261019-86b47d3c/lib/api/server.ts"],
    UNITS[4]: ["/opt/yunipals/releases/5dd51e7/apps/yunipals-indexer/lib/leaderboard/worker.ts"]
}
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}
ARCHIVE_DEADLINE = 600


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def trusted(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute():
        raise RuntimeError("Absolute public input required.")
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError("Protected root-owned public input required.")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise RuntimeError("Bounded regular public input required.")
    return path.read_bytes()


def root_group_exclusive():
    group = grp.getgrgid(0)
    return not any(name != "root" for name in group.gr_mem) and not any(account.pw_uid != 0 and account.pw_gid == 0 for account in pwd.getpwall())


def legacy_runtime(path, maximum=4_000_000):
    """Read existing public code; ROOT:ROOT group-write grants no new actor."""
    path = Path(path)
    if not path.is_absolute() or path.suffix not in {".ts", ".json"} or not root_group_exclusive():
        raise RuntimeError("Exact public code and an exclusive root group required.")
    for part in [*reversed(path.parents), path]:
        info = part.lstat()
        if (stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o002 or
                info.st_mode & 0o020 and info.st_gid != 0):
            raise RuntimeError("Legacy code allows an unreviewed writer or redirect.")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise RuntimeError("Bounded regular legacy public source required.")
    return path.read_bytes()


def module():
    raw = trusted(VERIFIER)
    if digest(raw) != VERIFIER_SHA:
        raise RuntimeError("Public verifier pin differs.")
    result = types.ModuleType("pinned_proxy_verifier")
    result.__file__ = str(VERIFIER)
    exec(compile(raw, str(VERIFIER), "exec"), result.__dict__)
    return result


def wiring():
    raw = trusted(WIRING)
    if digest(raw) != WIRING_SHA:
        raise RuntimeError("Prior public wiring pin differs.")
    rows = {row["unit"]: row for row in json.loads(raw)["services"] if row["unit"] in UNITS}
    if set(rows) != set(UNITS):
        raise RuntimeError("Exact five prior EVM dependencies required.")
    return rows


def selected_paths(rows):
    return {path for unit in UNITS for path in [rows[unit]["FragmentPath"], *rows[unit]["DropInPaths"].split(), *RUNTIME[unit]]}


def before_record(rows, found):
    if set(found) != selected_paths(rows):
        raise RuntimeError("Selected archived public files are missing.")
    services = [{"unit": unit,
                 "definitions": {p: found[p] for p in [rows[unit]["FragmentPath"], *rows[unit]["DropInPaths"].split()]},
                 "runtimeFiles": {p: found[p] for p in RUNTIME[unit]}} for unit in UNITS]
    return {"format": "yunipals-legacy-evm-dependency-before-v1", "wiringFile": str(WIRING), "wiringSha256": WIRING_SHA,
            "backupDirectory": str(BACKUP), "archiveCiphertextSha256": CIPHER_SHA,
            "archivePlaintextSha256": PLAIN_SHA, "archiveFullyAuthenticated": True, "services": services,
            "qualification": "Unit definitions and listed public source files are verified from the completed backup. Exact existing argv/CWD/user/environment-file selectors come from the earlier public wiring inventory. The metadata short-confirmation entry is outside that archive's captured source roots; its unchanged selector is verified, its current public entry bytes are separately pinned at capture, and no archived-byte equality for that extra entry is claimed.",
            "privateEnvironmentFilesRead": False, "databaseCalls": 0, "providerCalls": 0}


def archive_before():
    if BEFORE.exists():
        raise RuntimeError("Never overwrite existing before evidence.")
    rows = wiring()
    wanted, found = selected_paths(rows), {}
    info = ARCHIVE.stat(follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_size != CIPHER_BYTES:
        raise RuntimeError("Protected archive metadata differs.")
    h = hashlib.sha256()
    with ARCHIVE.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    if h.hexdigest() != CIPHER_SHA:
        raise RuntimeError("Completed archive ciphertext pin differs.")
    spec = importlib.util.spec_from_file_location("installed_backup", "/opt/yunipals-market-backup-recovery/20261012/offhost-backup-agent.py")
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)
    config = backup.configuration()
    secret = str(config["MARKET_BACKUP_ENCRYPTION_PASSPHRASE"]).encode()
    config.clear()
    if not 32 <= len(secret) <= 4096 or b"\n" in secret or b"\r" in secret:
        raise RuntimeError("Retained key shape differs.")
    home = Path(tempfile.mkdtemp(prefix="dependency-archive-", dir=OPS))
    reader, writer = os.pipe()
    gpg = zstd = None
    streamed = {"bytes": 0, "hash": hashlib.sha256(), "error": None}
    try:
        gpg = subprocess.Popen(["/usr/bin/gpg", "--batch", "--no-options", "--homedir", str(home), "--pinentry-mode", "loopback",
                                "--no-symkey-cache", "--no-auto-key-retrieve", "--no-auto-key-import", "--passphrase-fd", str(reader),
                                "--decrypt", str(ARCHIVE)], pass_fds=(reader,), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=ENV)
        os.close(reader); reader = None
        os.write(writer, secret + b"\n"); os.close(writer); writer = None; secret = None
        zstd = subprocess.Popen(["/usr/bin/zstd", "-d", "-c"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=ENV)
        def pump():
            try:
                for block in iter(lambda: gpg.stdout.read(65536), b""):
                    streamed["bytes"] += len(block); streamed["hash"].update(block)
                    if streamed["bytes"] > PLAIN_BYTES:
                        raise RuntimeError("Archive plaintext limit exceeded.")
                    zstd.stdin.write(block)
                zstd.stdin.close()
            except Exception as error:
                streamed["error"] = type(error).__name__
        thread = threading.Thread(target=pump, daemon=True); thread.start()
        started = time.monotonic()
        with tarfile.open(fileobj=zstd.stdout, mode="r|") as archive:
            for entry in archive:
                # Stream mode still caches TarInfo records by default. None is
                # needed for our explicit regular-file selections.
                archive.members.clear()
                if time.monotonic() - started > ARCHIVE_DEADLINE:
                    raise RuntimeError("Archive selection deadline exceeded.")
                path = "/" + entry.name.removeprefix("./").lstrip("/")
                if path not in wanted:
                    continue
                if not entry.isfile() or entry.size > 4_000_000:
                    raise RuntimeError("Selected public archive member is not a bounded regular file.")
                value = digest(archive.extractfile(entry).read())
                if path in found and found[path] != value:
                    raise RuntimeError("Contradictory duplicate archive member.")
                found[path] = value
        # Consume trailing tar padding so GPG authentication and both checksums
        # are complete even when the final selected member occurred early.
        while zstd.stdout.read(1024 * 1024):
            if time.monotonic() - started > ARCHIVE_DEADLINE:
                raise RuntimeError("Archive drain deadline exceeded.")
        thread.join(timeout=10)
        if thread.is_alive() or streamed["error"] or gpg.wait(timeout=10) or zstd.wait(timeout=10):
            raise RuntimeError("Archive authentication/decompression failed.")
        if streamed["bytes"] != PLAIN_BYTES or streamed["hash"].hexdigest() != PLAIN_SHA:
            raise RuntimeError("Completed plaintext archive pin differs.")
        after = ARCHIVE.stat(follow_symlinks=False)
        if (info.st_ino, info.st_size, info.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
            raise RuntimeError("Original archive changed during selection.")
        proof = before_record(rows, found)
        # The before witness authenticates the backup independently of current
        # deployment permissions/contents. Preserve it even if a later current
        # comparison fails, rather than requiring another full archive read.
        with BEFORE.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o644); handle.write(encoded(proof))
        runtime_paths = {p for paths in RUNTIME.values() for p in paths}
        for path, expected in found.items():
            value = legacy_runtime(path) if path in runtime_paths else trusted(path, 4_000_000)
            if digest(value) != expected:
                raise RuntimeError("Existing EVM definition/source differs from backup: " + path)
        return {"beforeEvidenceFile": str(BEFORE), "beforeEvidenceSha256": digest(encoded(proof)), "selectedPublicFiles": len(found)}
    finally:
        secret = None
        for fd in [reader, writer]:
            if fd is not None:
                os.close(fd)
        for process in [gpg, zstd]:
            if process and process.poll() is None:
                process.kill(); process.wait(timeout=5)
        subprocess.run(["/usr/bin/gpgconf", "--homedir", str(home), "--kill", "gpg-agent"], capture_output=True, env=ENV, timeout=10, check=True)
        shutil.rmtree(home)


def capture():
    rows, verifier = wiring(), module()
    before_raw = trusted(BEFORE)
    before = json.loads(before_raw)
    previous = {row["unit"]: row for row in before["services"]}
    if before["format"] != "yunipals-legacy-evm-dependency-before-v1" or set(previous) != set(UNITS) or before["wiringSha256"] != WIRING_SHA:
        raise RuntimeError("Exact archived before evidence required.")
    monitor_raw = trusted(MONITOR)
    records = [json.loads(line) for line in monitor_raw.splitlines() if line.strip()]
    if records[0].get("event") != "started" or records[-1].get("event") != "stopped" or records[-1].get("stopError") is not None:
        raise RuntimeError("Completed original monitor required.")
    original = records[-1]["after"]["legacyUnits"]
    selector = records[-1]["after"]["activeSelector"]
    if selector != [] or records[0]["baselineActiveSelector"] != selector:
        raise RuntimeError("Original inactive selector required.")
    services = []
    for unit in UNITS:
        prior, props = rows[unit], verifier.state(unit)
        before_state = original[unit]
        if before_state.get("ActiveState") != "active" or before_state.get("SubState") != "running":
            raise RuntimeError("An originally inactive service cannot rebase.")
        argv = prior["execStartPublicTokens"]
        if (any("REDACTED" in part for part in argv) or re.findall(r"argv\[\]=(.*?)\s+;", props["ExecStart"]) != [" ".join(argv)] or
                re.findall(r"(?:^|[ {;])path=([^ ;]+)", props["ExecStart"]) != [argv[0]] or props["WorkingDirectory"] != prior["WorkingDirectory"] or
                props["User"] != prior["User"] or props["Group"] != prior["Group"]):
            raise RuntimeError("Existing dependency runtime/identity differs from prior wiring.")
        settings = verifier.private_settings(props)
        paths = [re.fullmatch(r"(/[^ ]+) \(ignore_errors=(?:yes|no)\)", text).group(1) for text in settings["orderedEnvironmentFiles"]]
        if paths != prior["environmentFiles"]:
            raise RuntimeError("Ordered environment-file selectors changed.")
        definitions = verifier.definitions(props)
        if definitions != previous[unit]["definitions"]:
            raise RuntimeError("Complete current definitions differ from archived definitions.")
        files = previous[unit]["runtimeFiles"]
        if any(digest(legacy_runtime(path)) != expected for path, expected in files.items()):
            raise RuntimeError("Existing dependency public source differs from backup.")
        result = verifier.run(["/usr/bin/systemctl", "show", unit, "--property=Result"]).strip()
        if result != "Result=success":
            raise RuntimeError("Existing dependency has unsuccessful result.")
        state_raw = verifier.run(["systemctl", "show", unit, "--property=Id,LoadState,ActiveState,SubState,InvocationID"])
        state = dict(line.split("=", 1) for line in state_raw.splitlines() if "=" in line)
        if (set(state) != {"Id", "LoadState", "ActiveState", "SubState", "InvocationID"} or state["Id"] != unit or
                state["LoadState"] != "loaded" or state["ActiveState"] != "active" or state["SubState"] != "running" or
                state["InvocationID"] != props["InvocationID"] or not re.fullmatch(r"[0-9a-f]{32}", state["InvocationID"])):
            raise RuntimeError("Dependency invocation/health changed during capture.")
        extra = {}
        if unit == "yunipals-metadata.service":
            entry = argv[-1]
            extra[entry] = digest(legacy_runtime(entry))
        services.append({"unit": unit, "beforeState": before_state, "afterState": state, "definitions": definitions,
                         "runtimeFiles": files, "additionalCurrentEntrypointPins": extra, "privateSettings": settings,
                         "execPath": argv[0], "execArgv": argv, "workingDirectory": prior["WorkingDirectory"], "healthy": True, "result": "success"})
    return {"format": "yunipals-legacy-evm-dependency-rebase-v1", "initialMonitorSha256": digest(monitor_raw),
            "sourceSelectionBefore": selector, "sourceSelectionAfter": selector, "sourceSelectionEvidenceOnly": True,
            "beforeEvidenceFile": str(BEFORE), "beforeEvidenceSha256": digest(before_raw), "services": services,
            "databaseCalls": 0, "providerCalls": 0, "privateEnvironmentFilesRead": False, "serviceOrConfigMutations": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-before", action="store_true")
    parser.add_argument("--apply")
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "yunipals-main" or args.prepare_before and args.apply:
        raise RuntimeError("Reviewed production host/root and one explicit mode required.")
    if args.prepare_before:
        def timeout(*_args):
            raise TimeoutError("Complete archive proof wall deadline exceeded.")
        previous = signal.signal(signal.SIGALRM, timeout)
        signal.alarm(ARCHIVE_DEADLINE)
        try:
            print(json.dumps(archive_before()))
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
        return
    proof = capture()
    raw = encoded(proof); value = digest(raw)
    if args.apply:
        if args.apply != value:
            raise RuntimeError("Dependency rebase review changed.")
        with OUTPUT.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o644); handle.write(raw)
    print(json.dumps({"reviewHash": value, "review": proof, "applied": bool(args.apply), "proofFile": str(OUTPUT), "proofSha256": value}, indent=2))


if __name__ == "__main__":
    main()
