#!/usr/bin/env python3
"""Cold installation primitives for the installed unified indexer.

Importing this file or running it without arguments changes nothing. The root
startup command owns database admission/publication and calls these functions
only after its current database checks. Private environment files are retained.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import time

OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
INSTALL_ROOT = Path("/opt/yunipals-unified/indexer")
SERVICE_ENV = Path("/etc/yunipals-unified/indexer.service.env")
CANDIDATES = Path("/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025")
SYSTEM = Path("/etc/systemd/system")
PARENT = "yunipals-indexer.service"
METADATA = "yunipals-metadata.service"
WRITERS = (
    "yunipals-ypal-combined-source.service", "yunipals-solana.service",
    "yunipals-unified-source6-free-v2.service", "yunipals-booster-ypal-source.service",
    "yunipals-booster-launch.service", "yunipals-bnb.service",
    "yunipals-islands-indexer.service", "yunipals-base-islands-v2.service"
)
OLD_ARENA = tuple("yunipals-arena-" + name + ".service" for name in (
    "api", "capacity", "control", "lobby", "media", "projector", "referee", "settlement"
))
ARENA = (
    "yunipals-arena-native-api.service", "yunipals-arena-native-disclosure.service",
    "yunipals-arena-native-client.service", "yunipals-arena-native-referee.service",
    "yunipals-arena-native-media.service", "yunipals-arena-native-execution@lobby.service",
    "yunipals-arena-native-execution@referee.service", "yunipals-arena-native-capacity.service"
)
READERS = ("yunipals-api.service", "yunipals-collector-api.service", "yunipals-islands-api.service")
FEATURE = ("yunipals-booster-api.service", "yunipals-booster-artwork-queue.service")
TIMERS = ("yunipals-booster-artwork-queue.timer", "yunipals-native-staking-support.timer")
CACHE = "yunipals-read-cache.service"
LEADER = "yunipals-leaderboard.service"
STAKING = "yunipals-native-staking-support.service"
STOP_GROUPS = (TIMERS, FEATURE + READERS + OLD_ARENA + ARENA,
               (CACHE, LEADER, STAKING, "yunipals-islands-staking.service"), (PARENT,), WRITERS)
ALLOWED = set(sum(STOP_GROUPS, ())) | set(ARENA)
RELEASE = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
PHYSICAL = "unified_ypal_20261023_v1"
READ = "yunipals_ownership_4e77f52b_v5"
IDENTITY = "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab"
RUNTIME_FILES = {
    "scripts/start-indexer.mjs": "3e13933ef1b9db54df77babb99e65e6c0e11fd92ff16ac932e57f0fd5079c1fe",
    "ops/unified-indexer/run-indexer.sh": "50b05ec54652205ea8b727b0077e8aade46594bc6bae90e0d38b234f87109c1f",
    "ops/unified-indexer/service.env": "ea24aab003f1970e29f7a54d291665096c982efe3d4bc69e876b67edb91aacc2",
    "ops/unified-indexer/yunipals-indexer.production.service": "bcca1327f0b16a37430c2e7ea47bd8552c3874aa2fa380273ab728973e0ae363"
}
CLEAN = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_public(path, expected=None):
    path = Path(path)
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected public file required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 2_000_000,
             "bounded single-link public file required")
        raw = os.read(fd, 2_000_001)
        key = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid,
                         s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        need(len(raw) == before.st_size and key(before) == key(os.fstat(fd)) == key(path.lstat()),
             "public file changed during read")
        need(expected is None or digest(raw) == expected, "public file digest mismatch")
        return raw
    finally:
        os.close(fd)


def run(args, timeout=120):
    result = subprocess.run(args, capture_output=True, timeout=timeout, env=CLEAN, cwd="/")
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, output=result.stdout, stderr=result.stderr)
    if result.stderr or len(result.stdout) >= 200_000:
        error = RuntimeError("fixed operation returned unexpected output; inspect before continuing")
        error.stdout, error.stderr, error.returncode = result.stdout, result.stderr, result.returncode
        raise error
    return result.stdout


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def state(unit):
    need(unit in ALLOWED or unit == METADATA, "unknown unit")
    keys = ("Id", "LoadState", "ActiveState", "SubState", "MainPID", "ControlPID", "Job", "InvocationID")
    raw = run(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in keys]], 10)
    value = dict(line.split("=", 1) for line in raw.decode().splitlines())
    # Timer units (and units absent from this host) have no service PID fields.
    if unit.endswith(".timer") or value.get("LoadState") == "not-found":
        value.setdefault("MainPID", "0")
        value.setdefault("ControlPID", "0")
    need(set(value) == set(keys) and value["Id"] == unit, "complete fixed unit state required")
    return value


def terminal(unit):
    value = state(unit)
    need(value["MainPID"] == value["ControlPID"] == "0" and not value["Job"]
         and value["ActiveState"] in {"inactive", "failed"}, "unit is not stopped: " + unit)
    cgroup = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
    need(not cgroup.exists() or not cgroup.read_text().split(), "unit cgroup is not empty: " + unit)
    return value


def process_epoch(pid):
    try:
        raw = (Path("/proc") / str(pid) / "stat").read_text()
    except FileNotFoundError:
        return None
    fields = raw.rsplit(")", 1)[1].split()
    return {"pid": int(pid), "startTicks": int(fields[19])}


def unit_processes(unit, value):
    pids = {int(value[key]) for key in ("MainPID", "ControlPID") if value[key] != "0"}
    cgroup = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
    if cgroup.exists():
        pids.update(int(pid) for pid in cgroup.read_text().split())
    return [row for pid in sorted(pids) if (row := process_epoch(pid)) is not None]


def stop_all(record):
    """Stop consumers, then both ingestion trees; never stop native metadata."""
    for number, units in enumerate(STOP_GROUPS):
        before = {unit: state(unit) for unit in units}
        processes = {unit: unit_processes(unit, before[unit]) for unit in units}
        loaded = [unit for unit in units if before[unit]["LoadState"] != "not-found"]
        record("stop-" + str(number) + "-intent", {"units": before, "processes": processes})
        if loaded:
            run(["/usr/bin/systemctl", "stop", "--no-block", *loaded], 15)
        deadline = time.monotonic() + 120
        while True:
            try:
                after = {unit: terminal(unit) for unit in units}
                need(all(process_epoch(row["pid"]) != row for rows in processes.values() for row in rows),
                     "a stopped unit process epoch remains alive")
                break
            except RuntimeError:
                need(time.monotonic() < deadline, "stop did not drain; no start was attempted")
                time.sleep(0.25)
        record("stop-" + str(number) + "-complete", after)
    return {unit: terminal(unit) for unit in (PARENT, *WRITERS)}


def public_environment(raw):
    values = {}
    for line in raw.decode().splitlines():
        if not line or line.startswith("#"):
            continue
        fields = shlex.split(line)
        need(len(fields) == 1 and "=" in fields[0], "literal public selector required")
        key, value = fields[0].split("=", 1)
        need(key not in values, "duplicate selector key")
        values[key] = value
    return values


def configuration(candidate_sha, staking_build, read=read_public):
    """Read already staged public bytes; no constructor, DB call or credential copy."""
    need(re.fullmatch("[a-f0-9]{64}", candidate_sha or "") and
         re.fullmatch("[a-f0-9]{10,64}", staking_build or ""), "actual candidate and native build required")
    runtime = {name: read(INSTALL_ROOT / name, sha) for name, sha in RUNTIME_FILES.items()}
    managed = runtime["ops/unified-indexer/yunipals-indexer.production.service"]
    settings = runtime["ops/unified-indexer/service.env"]
    values = public_environment(settings)
    required = {"UNIFIED_SOLANA_ENABLED", "UNIFIED_PONDER_SCHEMA", "UNIFIED_PONDER_HOSTNAME", "UNIFIED_PONDER_PORT",
                "YUNIPALS_INDEXER_PONDER_DIRECTORY", "YUNIPALS_INDEXER_PONDER_ENV_FILE",
                "YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE", "YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE",
                "YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE", "YUNIPALS_INDEXER_SOLANA_DIRECTORY",
                "YUNIPALS_INDEXER_SOLANA_ENV_FILE", "YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS"}
    need(required <= set(values) <= required | {"YUNIPALS_INDEXER_NODE"} and
         values["UNIFIED_SOLANA_ENABLED"] == "true" and values["UNIFIED_PONDER_SCHEMA"] == PHYSICAL and
         values["UNIFIED_PONDER_HOSTNAME"] == "127.0.0.1" and values["UNIFIED_PONDER_PORT"] == "9028",
         "single managed EVM/Solana public configuration required")
    files = {str(SYSTEM / PARENT): managed, str(SERVICE_ENV): settings}
    receipt = json.loads(read(CANDIDATES / "result.json", candidate_sha))
    need(receipt.get("staged") is True and receipt.get("readSchema") == READ and
         receipt.get("readIdentity") == IDENTITY, "actual staged V5 selectors required")
    for unit, selector in ((CACHE, "yunipals-read-cache.ownership.env"),
                           (LEADER, "yunipals-leaderboard.selectors.env")):
        raw = read(CANDIDATES / selector, receipt["files"][selector])
        values = public_environment(raw)
        need(values.get("DATABASE_SCHEMA") == PHYSICAL and values.get("OWNERSHIP_READ_SCHEMA") == READ
             and values.get("OWNERSHIP_RELEASE_ID") == RELEASE and
             not any(re.search("PASSWORD|SECRET|TOKEN|DATABASE_URL|API_KEY", key) for key in values),
             "exact public V5 selectors required")
        name = unit + ".drop-in.candidate"
        drop = read(CANDIDATES / name, receipt["files"][name])
        need(drop.count(("EnvironmentFile=" + str(CANDIDATES / selector) + "\n").encode()) == 1,
             "candidate drop must select the actual authenticated file")
        files[str(SYSTEM / (unit + ".d") / "zzzzzzzzzzzzzzzzzzzzzzzzz-cold-unified.conf")] = drop
    raw = read(OPS / "staking-support-native-v1.service.example",
               "15ab2bda3468ad8758d112f05111d72815c0e7cefa1b23ee7395fe12dddcae55")
    replacements = {
        "DATABASE_SCHEMA=unified_shadow_20261020_7e7375b0": "DATABASE_SCHEMA=" + PHYSICAL,
        "OWNERSHIP_READ_SCHEMA=yunipals_ownership_35cdcb32_v3": "OWNERSHIP_READ_SCHEMA=" + READ,
        "OWNERSHIP_RELEASE_ID=0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c": "OWNERSHIP_RELEASE_ID=" + RELEASE,
        "ISLANDS_STAKING_READ_IDENTITY=0xe7119a18273d9a98cc1dcb0bbcad4928e9de72dbd42735b4fbad61a706de3fcc": "ISLANDS_STAKING_READ_IDENTITY=" + IDENTITY,
        "ISLANDS_STAKING_BUILD_ID=bf4939b3ff": "ISLANDS_STAKING_BUILD_ID=" + staking_build
    }
    for old, new in replacements.items():
        need(raw.count(old.encode()) == 1, "one exact staking selector required")
        raw = raw.replace(old.encode(), new.encode(), 1)
    files[str(SYSTEM / STAKING)] = raw
    timer = ("[Unit]\nDescription=Refresh native staking point proof\n[Timer]\n"
             "OnActiveSec=5min\nOnUnitInactiveSec=5min\nUnit=" + STAKING + "\nPersistent=false\n"
             "[Install]\nWantedBy=timers.target\n").encode()
    files[str(SYSTEM / "yunipals-native-staking-support.timer")] = timer
    return files


def install_public(files, record, backup_dir):
    """Atomic public-file installation after stop_all; no private file is a target."""
    allowed = {str(SYSTEM / unit) for unit in (PARENT, STAKING, "yunipals-native-staking-support.timer")} | {str(SERVICE_ENV)}
    allowed |= {str(SYSTEM / (unit + ".d") / "zzzzzzzzzzzzzzzzzzzzzzzzz-cold-unified.conf")
                for unit in (CACHE, LEADER)}
    need(set(files) == allowed, "exact six cold configuration targets required")
    for unit in (PARENT, *WRITERS, CACHE, LEADER, STAKING):
        terminal(unit)
    backup_dir = Path(backup_dir)
    need(backup_dir.is_absolute(), "absolute private backup directory required")
    backup_dir.mkdir(mode=0o700)
    for parent in [backup_dir, *backup_dir.parents]:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "protected backup directory required")
    for name, raw in files.items():
        path = Path(name)
        path.parent.mkdir(mode=0o755, exist_ok=True)
        for parent in [*path.parents, path.parent]:
            row = parent.lstat()
            need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
                 "protected configuration parent required")
        before = read_public(path) if os.path.lexists(path) else None
        label = digest(name.encode())[:16]
        if before is not None:
            fd = os.open(backup_dir / label, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(before)
                stream.flush()
                os.fsync(stream.fileno())
            sync_directory(backup_dir)
        record("install-" + label + "-intent", {"path": name, "beforeSha256": None if before is None else digest(before),
                                                   "afterSha256": digest(raw)})
        temporary = path.with_name(path.name + ".cold-new")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            need((read_public(path) if os.path.lexists(path) else None) == before, "configuration changed before publication")
            os.replace(temporary, path)
            sync_directory(path.parent)
        except BaseException:
            # A leftover file is an unknown publication to inspect, never retry.
            raise
        need(read_public(path) == raw, "installed bytes differ")
        record("install-" + label + "-complete", {"path": name, "sha256": digest(raw)})
    run(["/usr/bin/systemctl", "daemon-reload"], 15)


def retire_old_units(record, backup_dir):
    """Prevent the retired writer/Arena units from returning after a reboot."""
    backup_dir = Path(backup_dir)
    need(backup_dir.is_absolute(), "absolute retirement backup directory required")
    backup_dir.mkdir(mode=0o700)
    for parent in [backup_dir, *backup_dir.parents]:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "protected retirement backup directory required")
    terminal(PARENT)
    for unit in (*WRITERS, *OLD_ARENA, "yunipals-islands-staking.service"):
        terminal(unit)
        path = SYSTEM / unit
        if os.path.islink(path):
            need(os.readlink(path) == "/dev/null", "foreign retired unit link")
            continue
        before = read_public(path) if os.path.lexists(path) else None
        if before is not None:
            with open(backup_dir / unit, "xb") as stream:
                os.fchmod(stream.fileno(), 0o600)
                stream.write(before)
                stream.flush()
                os.fsync(stream.fileno())
            sync_directory(backup_dir)
        record("retire-" + unit + "-intent", {"unit": unit, "beforeSha256": None if before is None else digest(before)})
        temporary = path.with_name(unit + ".cold-mask")
        os.symlink("/dev/null", temporary)
        need((read_public(path) if os.path.lexists(path) else None) == before, "retired unit changed")
        os.replace(temporary, path)
        sync_directory(path.parent)
        record("retire-" + unit + "-complete", {"unit": unit, "masked": True})
    # Old parent overrides must not override the new managed command or mounts.
    raw = run(["/usr/bin/systemctl", "show", PARENT, "--property=DropInPaths", "--value"], 10)
    for name in raw.decode().split():
        path = Path(name)
        need(path.parent == SYSTEM / (PARENT + ".d") and path.suffix == ".conf", "unexpected parent override location")
        before = read_public(path)
        label = "parent-" + digest(name.encode())[:16]
        with open(backup_dir / label, "xb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(before)
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(backup_dir)
        record(label + "-remove-intent", {"path": name, "sha256": digest(before)})
        need(read_public(path) == before, "parent override changed")
        path.unlink()
        sync_directory(path.parent)
        record(label + "-removed", {"path": name})
    run(["/usr/bin/systemctl", "daemon-reload"], 15)


def start(unit, record):
    """One start dispatch; the caller performs component-specific data/HTTP health."""
    need(unit in {PARENT, CACHE, LEADER, STAKING, *READERS, *FEATURE, *TIMERS, *ARENA}, "unknown start unit")
    if unit == PARENT:
        for writer in WRITERS:
            terminal(writer)
    before = terminal(unit)
    record("start-" + unit + "-intent", {"unit": unit, "previousInvocation": before["InvocationID"],
                                         "monotonicNs": time.monotonic_ns()})
    run(["/usr/bin/systemctl", "start", "--no-block", unit], 15)
    return {"unit": unit, "startDispatched": True, "healthAccepted": False}


def running(unit, previous_invocation, timeout=90):
    """Require one fresh stable service epoch; application checks remain separate."""
    need(unit in ALLOWED and unit not in TIMERS and unit != STAKING, "long-running service required")
    deadline = time.monotonic() + timeout
    first = None
    stable_since = None
    while time.monotonic() < deadline:
        value = state(unit)
        if value["ActiveState"] == "active" and value["MainPID"] != "0" and not value["Job"]:
            actor = {"invocation": value["InvocationID"], "process": process_epoch(value["MainPID"])}
            need(re.fullmatch("[a-f0-9]{32}", actor["invocation"]) and
                 actor["invocation"] != previous_invocation and actor["process"] is not None,
                 "fresh running service epoch required")
            if first is None:
                first = actor
                stable_since = time.monotonic()
            need(actor == first, "service restarted during startup acceptance")
            if time.monotonic() - stable_since >= 5:
                return {"unit": unit, "actor": actor, "processHealthy": True, "applicationHealthAccepted": False}
        elif first is not None:
            raise RuntimeError("service exited during startup acceptance")
        time.sleep(0.25)
    raise RuntimeError("service did not become healthy; inspect before another start")


if __name__ == "__main__":
    print(json.dumps({"stopGroups": STOP_GROUPS, "managedParent": PARENT,
                      "nativeMetadataPreserved": METADATA, "staticOnly": True}))
