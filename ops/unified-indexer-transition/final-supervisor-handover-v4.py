#!/usr/bin/env python3
"""Fixed source008 + Solana handover, one start, explicit owned inverse.

No source build, historical scan, provider request, budget renewal, database
restore or private-environment renderer belongs to this operator.  The final
acceptance seal must be produced from actual acceptance work before review.
"""
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import ipaddress
import json
import os
import errno
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import time
import types
import urllib.error
import urllib.request

FORMAT = "yunipals-final-supervisor-handover-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
STAGE = Path("/opt/yunipals-unified/operations/solana-consolidation-20261021")
EVIDENCE = Path("/var/backups/yunipals-final-supervisor-handover-v4")
WORKSPACE = Path("/var/lib/yunipals-unified-shadow/20261020-008028af-a")
CWD = WORKSPACE / "apps/yunipals-indexer"
UNIT = "yunipals-indexer.service"
SOURCE_UNIT = "yunipals-unified-source6-free-v2.service"
BOOSTER_UNIT = "yunipals-booster-launch.service"
WRITERS = ("yunipals-solana.service", SOURCE_UNIT, BOOSTER_UNIT, UNIT, "yunipals-bnb.service",
           "yunipals-islands-indexer.service", "yunipals-base-islands-v2.service")
LEGACY = tuple(v for v in WRITERS if v not in {SOURCE_UNIT, BOOSTER_UNIT})
LEGACY_BOOT_UNITS = tuple(v for v in LEGACY if v != UNIT)
BOOT_DIRECTORY = Path("/etc/systemd/system/multi-user.target.wants")
CHAINS = ("base", "bnb", "ethereum", "polygon")
RELEASE = "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c"
SCHEMA = "unified_shadow_20261020_7e7375b0"
BUILD = "bf4939b3ff"
SOURCE = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
STAGE_SHA = "35093ff3fee4532b29e017f91451bde8f7fb4deeafeff4f80524e81647dd4a60"
UNIT_SHA = "e40738b49d5480258bc52e79a1dbf83e2341494482e8b1f0d0d568120d5ca1ae"
LAUNCH_SHA = "899b72669add542f3a405494c6382b5a50870875cd5d725d4a3df4fbed577b2e"
HELIUS_SHA = "8a3011e5bcbcf84638738ecfd2781550d0b8343979cd9e5a284b2de8e0e40ab7"
TRANSPORT = Path("/opt/yunipals-unified/operations/solana-consolidation-final-20261022-v4/normal-transport-final-v4.conf")
TRANSPORT_SHA = "bd39471bb3899cd001b74b2d1296785f46760f3d31277392d1a521e588e094c8"
BASE_RPC = OPS / "source6-base-priority/rpc-preflight.ts"
BASE_RPC_SHA = "1b9ff9fc67138d008bab65626228cef3b3c6e664e74a32d23ec36c82077c9ba8"
NORMAL = Path("/opt/yunipals-unified/operations/solana-consolidation-final-20261021-v1/ponder-normal-final-v1.public.env")
NORMAL_SHA = "f8adcd0dd13a9f5ae26edec713c960bf459108b86718387742af1b365235d710"
PROFILE = OPS / "normal-rpc-profile-v1.json"
PROFILE_SHA = "0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e"
RESOURCES = OPS / "final-supervisor-resources-v1.conf.example"
RESOURCES_RAW = ("[Service]\n# Match the accepted source recovery policy; retain the other resource limits.\n"
                 "Environment=NODE_OPTIONS=--max-old-space-size=4096\nMemoryMax=6442450944\n").encode()
SQL_FILE = OPS / "supervisor-handover-state-v1.sql"
SQL_SHA = "2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0"
# Add a normal successor only after its helper and actual runtime are reviewed.
# An unacknowledged receipt cannot select an arbitrary validator or operation.
SOURCE_BINDINGS = {
    "c9ab7f0a48cb973be0a616e3837f37581b0cbd00639470892b76f4b96147cfb9": {
        "file": "/var/backups/yunipals-source6-base-priority-resume-20261022/runtime.json",
        "helper": str(OPS / "source6-base-priority-inspect-stop.py"),
        "helperSha256": "762cbca355eb4d236577279079c3da6a900c3bc49b34162510615872aaae97b1",
        "kind": "bounded-base1"
    },
    "e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f": {
        "file": "/var/backups/yunipals-source6-normal-replay-successor-20261022/runtime.json",
        "helper": str(OPS / "source6-normal-replay-successor-v2.py"),
        "helperSha256": "c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb",
        "kind": "normal-free-base1"
    },
    "add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d": {
        "file": "/var/backups/yunipals-source6-normal-proxy-requalification-v1-20261023/result.json",
        "helper": str(OPS / "source6-normal-proxy-requalification-v1.py"),
        "helperSha256": "8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658",
        "kind": "normal-free-proxy-qualified-base1"
    }
}
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
NO_PASSWORD = Path("/run/yunipals-final-supervisor-no-password")
CHECKS = ("allConfiguredSourcesCaughtUp", "fixedBoundaryDataAndCanonicalWitness",
          "marketplaceCompleteReceipts", "nativeArenaAdoptedAndCurrent",
          "nativeMetadataAdoptedAndCurrent", "stakingVerified", "retainedRoutesAccepted",
          "restartAndOwnedRollbackRehearsed", "financialDutyAcknowledged", "freeOnlyProxiesReady")
INSTALL_UNITS = {"main": "yunipals-api.service", "collector": "yunipals-collector-api.service",
                 "islands": "yunipals-islands-api.service", "cache": "yunipals-read-cache.service"}
CONSUMER_FORMAT = "yunipals-consumer-operational-install-v7"
CONSUMER_OPERATOR_SHA = "e283589fef912cdf38b3dbced2e621c1665ea7f8992a0938fa0f3fc83fc08d39"
FEATURE_HELPER = OPS / "booster-feature-handover-v7.py"
FEATURE_HELPER_SHA = "0f5024cdbb373ce8015f2abf59f459d16d143f3f909ac3382d5170a1d4967984"
FEATURE_ESBUILD_SHA = "bab29b2ca7a9e89b67cf720b77b2d743f9f31f5cf0d5bd74ee8c8de30ced7014"
FEATURE_ESBUILD_ARGV_SHA = "a38a748520fd6061e87e09bc1e78cf63f8ab08a73d9b8d24f468f24a083d6ac6"
KEYS = ("Id LoadState ActiveState SubState InvocationID MainPID ControlGroup FragmentPath DropInPaths "
        "UnitFileState WorkingDirectory User Group ExecStart EnvironmentFiles Job Result NRestarts TriggeredBy Triggers").split()
PORTS = {"ethereum": (1, 19201), "base": (8453, 19202), "polygon": (137, 19203), "bnb": (56, 19204)}
PROFILE_ID = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728"


def fail(code):
    raise RuntimeError(code)


def require(condition, code):
    if not condition:
        fail(code)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path, maximum=4_000_000):
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts, "absolute_protected_path_required")
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
                "protected_parent_required")
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and
            not before.st_mode & 0o022 and before.st_size <= maximum, "protected_regular_file_required")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                             info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    require(identity(before) == identity(after) == identity(path.lstat()) and len(raw) == before.st_size,
            "input_changed_during_read")
    return raw


def document(ref):
    require(isinstance(ref, dict) and set(ref) == {"file", "sha256"} and
            isinstance(ref["sha256"], str) and re.fullmatch("[0-9a-f]{64}", ref["sha256"]),
            "actual_file_and_whole_file_checksum_required")
    raw = read(ref["file"])
    require(sha(raw) == ref["sha256"], "evidence_file_checksum_changed")
    return json.loads(raw)


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def save(path, value):
    raw = encode(value) + b"\n"
    write_new(path, raw, 0o600)
    return sha(raw)


def write_new(path, raw, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(descriptor, mode)
        os.fchown(descriptor, 0, 0)
        with os.fdopen(descriptor, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(descriptor)
    finally:
        os.close(descriptor)
    sync_dir(Path(path).parent)


def replace(path, raw, mode):
    path = Path(path)
    temporary = path.with_name(path.name + ".final-supervisor-new")
    write_new(temporary, raw, mode)
    os.replace(temporary, path)
    sync_dir(path.parent)


def run(argv, *, data=None, timeout=5, manager=False):
    result = subprocess.run(argv, input=data, capture_output=True, env=ENV, timeout=timeout)
    require(result.returncode == 0 and (manager or not result.stderr) and len(result.stdout) <= 2_000_000,
            "bounded_command_failed")
    return result.stdout.decode()


def sql(text, *, write=False):
    require(not os.path.lexists(NO_PASSWORD), "absent_password_file_required")
    peer = pwd.getpwnam("postgres")
    require((peer.pw_uid, peer.pw_gid) == (111, 113), "existing_postgres_identity_required")
    options = "-c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000"
    if not write:
        options += " -c default_transaction_read_only=on"
    argv = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs",
            "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "PGHOST=/var/run/postgresql", "PGPORT=5432",
            "PGUSER=postgres", "PGDATABASE=yunipals_backfill", "PGPASSFILE=" + str(NO_PASSWORD),
            "PGOPTIONS=" + options, "/usr/bin/psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"]
    value = run(argv, data=text.encode(), timeout=12)
    require(not os.path.lexists(NO_PASSWORD), "absent_password_file_required")
    return json.loads(value)


@contextmanager
def locks():
    names = ["yunipals-unified-shadow.lock", *["yunipals-free-replay-proxy-" + n + ".lock" for n in CHAINS]]
    with ExitStack() as stack:
        for name in names:
            descriptor = os.open("/run/lock/" + name, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
            stream = stack.enter_context(os.fdopen(descriptor, "a"))
            info = os.fstat(descriptor)
            mode = 0o644 if name == "yunipals-unified-shadow.lock" else 0o600
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and
                    stat.S_IMODE(info.st_mode) == mode and info.st_nlink == 1,
                    "existing_protected_exclusive_lease_required")
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def process(pid):
    raw = Path("/proc", str(pid), "stat").read_text()
    tail = raw[raw.rindex(")") + 2:].split()
    status = Path("/proc", str(pid), "status").read_text()
    uid = re.search(r"(?m)^Uid:\s+([0-9]+)", status)
    return {"pid": pid, "startTicks": int(tail[19]), "uid": int(uid[1]),
            "argvSha256": sha(Path("/proc", str(pid), "cmdline").read_bytes())}


PEER_PROC_CODE = r'''import json,os,pathlib,sys
pid=int(sys.argv[1]);assert 0<pid<2**31 and os.geteuid()==970 and os.getegid()==964
p=pathlib.Path('/proc')/str(pid)
def identity():
 s=(p/'stat').read_text();return int(s[s.rindex(')')+2:].split()[19])
before=identity();status=dict(x.split(':',1)for x in(p/'status').read_text().splitlines()if':'in x)
assert all(int(x)==970 for x in status['Uid'].split())and all(int(x)==964 for x in status['Gid'].split())
exe=os.readlink(p/'exe');options=[x.removeprefix(b'NODE_OPTIONS=')for x in(p/'environ').read_bytes().split(b'\0')if x.startswith(b'NODE_OPTIONS=')]
argv=(p/'cmdline').read_bytes().split(b'\0');assert identity()==before
print(json.dumps({'startTicks':before,'bashExecutable':exe=='/usr/bin/bash','nodeExecutable':exe=='/opt/node-v24.18.1/bin/node',
 'heapEnvironment4096':options==[b'--max-old-space-size=4096'],'heapArgument4096':b'--max-old-space-size=4096'in argv}))
'''


def peer_process_properties(pid):
    require(type(pid) is int and 0 < pid < 2 ** 31, "fixed_source_peer_pid_required")
    value = json.loads(run(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--no-new-privs",
        "--inh-caps=-all", "--ambient-caps=-all", "/usr/bin/python3", "-I", "-B", "-c", PEER_PROC_CODE, str(pid)]))
    require(set(value) == {"startTicks", "bashExecutable", "nodeExecutable", "heapEnvironment4096", "heapArgument4096"} and
            type(value["startTicks"]) is int and all(type(value[key]) is bool for key in value if key != "startTicks"),
            "fixed_peer_process_properties_required")
    return value


def gone(saved):
    if saved is None:
        return True
    try:
        return process(saved["pid"])["startTicks"] != saved["startTicks"]
    except FileNotFoundError:
        return True


def unit(name):
    require(name in WRITERS or name in ["yunipals-market-production-rpc@" + n + ".service" for n in CHAINS] or
            name in INSTALL_UNITS.values(), "fixed_unit_required")
    raw = run(["/usr/bin/systemctl", "show", "--all", name, *["--property=" + key for key in KEYS]])
    pairs = [line.split("=", 1) for line in raw.splitlines() if "=" in line]
    value = dict(pairs)
    require(len(value) == len(pairs), "exact_unit_state_required")
    # systemctl can omit an empty a(sb), even with --all. Only complete that
    # exact omission after a typed read; no other missing property is inferred.
    if set(value) == set(KEYS) - {"EnvironmentFiles"}:
        object_path = "/org/freedesktop/systemd1/unit/" + re.sub(
            r"[^A-Za-z0-9]", lambda item: "_" + format(ord(item[0]), "02x"), name)
        typed = json.loads(run(["/usr/bin/busctl", "--json=short", "get-property",
            "org.freedesktop.systemd1", object_path, "org.freedesktop.systemd1.Service", "EnvironmentFiles"]))
        require(typed == {"type": "a(sb)", "data": []}, "typed_empty_environment_files_required")
        value["EnvironmentFiles"] = "[]"
    require(set(value) == set(KEYS) and value["Id"] == name,
            "exact_unit_state_required")
    try:
        value["process"] = process(int(value["MainPID"])) if int(value["MainPID"] or "0") else None
    except FileNotFoundError:
        value["process"] = None
    return value


def active(value):
    return (value["LoadState"] == "loaded" and value["ActiveState"] == "active" and
            value["SubState"] == "running" and value["process"] is not None and
            re.fullmatch("[0-9a-f]{32}", value["InvocationID"]) is not None)


def idle(value):
    require(value["Job"] in {"", "0"}, "no_pending_unit_job_required")
    return value


def definitions(value):
    if value["LoadState"] == "not-found":
        return {}
    paths = [value["FragmentPath"], *value["DropInPaths"].split()]
    fragment = "/etc/systemd/system/" + value["Id"]
    allowed_fragment = {fragment}
    if value["Id"].startswith("yunipals-market-production-rpc@"):
        allowed_fragment.add("/etc/systemd/system/yunipals-market-production-rpc@.service")
    require(paths[0] in allowed_fragment and all(
            p.startswith("/etc/systemd/system/" + value["Id"] + ".d/") or
            value["Id"] == SOURCE_UNIT and p in {"/run/systemd/system/" + SOURCE_UNIT + ".d/90-heap-resume.conf",
                                                  "/run/systemd/system/" + SOURCE_UNIT + ".d/95-base-priority-window.conf"} or
            value["Id"].startswith("yunipals-market-production-rpc@") and
            p.startswith("/etc/systemd/system/yunipals-market-production-rpc@.service.d/") for p in paths[1:]),
            "fixed_system_definitions_required")
    return {p: sha(read(p)) for p in paths}


def stop_owned(name, saved):
    current = idle(unit(name))
    require(current == saved, "saved_writer_changed_before_stop")
    if not active(current):
        require(current["ActiveState"] in {"inactive", "failed"} and current["process"] is None,
                "writer_must_be_active_or_terminal")
        return current
    run(["/usr/bin/systemctl", "stop", "--no-block", name], manager=True)
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        now = unit(name)
        require(now["InvocationID"] in {saved["InvocationID"], ""}, "foreign_writer_invocation_after_stop")
        if now["Job"] in {"", "0"} and now["ActiveState"] in {"inactive", "failed"} and now["MainPID"] == "0" and now["process"] is None and gone(saved["process"]):
            require(now["Result"] == "success", "graceful_writer_stop_required")
            if saved["ControlGroup"]:
                group = Path("/sys/fs/cgroup") / saved["ControlGroup"].lstrip("/") / "cgroup.procs"
                require(not group.exists() or not group.read_text().strip(), "old_writer_cgroup_must_be_empty")
            return now
        time.sleep(0.5)
    fail("owned_writer_stop_deadline")


def native():
    return sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT jsonb_build_object("
               "'release',(SELECT to_jsonb(r) FROM yunipals_indexer_control.release r WHERE id='" + RELEASE + "'),"
               "'active',(SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM yunipals_indexer_control.active_release a),"
               "'app',(SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app'),"
               "'checkpoints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY chain_id) FROM " + SCHEMA + "._ponder_checkpoint c),"
               "'sessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='yunipals_unified_shadow')); ROLLBACK;")


def native_identity(value, *, selected, running, restored_booster=None):
    release = value.get("release") or {}
    require((release.get("id"), release.get("physical_schema"), release.get("build_id")) ==
            (RELEASE, SCHEMA, BUILD), "retained_physical_release_required")
    app = value.get("app")
    if isinstance(app, str):
        app = json.loads(app)
    require(isinstance(app, dict) and app.get("build_id") == BUILD and app.get("is_dev") == 0,
            "retained_native_build_required")
    points = value.get("checkpoints")
    require(isinstance(points, list) and len(points) == 4 and
            {p.get("chain_id") for p in points} == {1, 56, 137, 8453}, "all_four_physical_checkpoints_required")
    if running:
        require(app.get("is_locked") == 1 and app.get("is_ready") == 1 and value.get("sessions", 0) > 0,
                "actual_native_ready_runtime_required")
        require(0 <= int(time.time() * 1000) - int(app.get("heartbeat_at", 0)) < 120_000,
                "fresh_native_heartbeat_required")
    else:
        require(app.get("is_locked") == 0, "quiet_native_role_required")
        if restored_booster is None:
            require(value.get("sessions") == 0, "quiet_native_role_required")
        else:
            # This proof comes only from the pinned feature owner's fresh,
            # read-only inverse validator, never a caller-supplied allowance.
            source = restored_booster.get("source", {})
            children = source.get("allowedChildProofs", [])
            require(isinstance(children, list) and len(children) <= 1 and all(
                    type(child.get("pid")) is int and child["pid"] > 0 and child["pid"] != source.get("pid") and
                    child.get("parentPid") == source.get("pid") and child.get("executableSha256") == FEATURE_ESBUILD_SHA and
                    child.get("argvSha256") == FEATURE_ESBUILD_ARGV_SHA for child in children),
                    "only_exact_owned_restored_booster_child_allowed")
            require(restored_booster.get("validated") is True and
                    restored_booster.get("format") == "yunipals-booster-feature-inverse-validation-v1" and
                    source.get("unit") == BOOSTER_UNIT and source.get("schema") == "yunipals_boosters_launch_v1" and
                    source.get("buildId") == "6d581272ce" and source.get("uid") == 970 and source.get("gid") == 964 and
                    source.get("cgroup") == "/system.slice/" + BOOSTER_UNIT and
                    type(source.get("pid")) is int and source["pid"] > 0 and
                    source.get("actorPids") == sorted([source["pid"], *[child["pid"] for child in children]]) and
                    source.get("completeUidInventory") is True and source.get("nativeLocked") is True and
                    source.get("nativeReady") is True and type(source.get("sourceRoleSessions")) is int and
                    0 <= source["sourceRoleSessions"] <= 5 and type(value.get("sessions")) is int and
                    0 <= value["sessions"] <= 5, "only_exact_owned_restored_booster_sessions_allowed")
    rows = value.get("active")
    require(rows == selected, "exact_current_source_selection_required")


def solana(through="0"):
    require(re.fullmatch("0|[1-9][0-9]{0,18}", str(through)), "bounded_ledger_prefix_id_required")
    text = read(SQL_FILE).decode()
    require(sha(text.encode()) == SQL_SHA and text.count(":'ledger_max_id'") == 2, "fixed_solana_handover_query_required")
    result = sql(text.replace(":'ledger_max_id'", "'" + str(through) + "'"))
    require(result.get("format") == "yunipals-solana-supervisor-handover-state-v1" and
            result.get("readOnly") is True and result.get("isolation") == "repeatable read",
            "actual_readonly_solana_snapshot_required")
    require(result.get("manifest") == {"checksum": "f9499fc3399ae235c0d3dd1c1664e4e9933dc57c5ec653e5c6368b100c295d07", "count": 10000},
            "unchanged_solana_manifest_required")
    return result


def prefix_preserved(before, after):
    require(before["manifest"] == after["manifest"] and before["ledgerPrefix"] == after["ledgerPrefix"] and
            int(after["ledgerCurrent"]["credits"]) >= int(before["ledgerCurrent"]["credits"]),
            "entire_existing_solana_usage_prefix_must_be_preserved")
    require(int(after["state"]["publishedRunId"] or 0) >= int(before["state"]["publishedRunId"] or 0),
            "solana_publication_must_not_rewind")


def stopped_solana_unchanged(before, after):
    # This boundary is checked while both writer processes are absent. Once a
    # worker starts, ordinary scheduling can legitimately advance these rows.
    keys = ("manifest", "state", "publishedRun", "runningScans", "runningRunStates",
            "stage", "ledgerPrefix", "ledgerCurrent", "workerLock")
    require(before["workerLock"] == after["workerLock"] == {"granted": 0, "waiting": 0} and
            all(before[key] == after[key] for key in keys),
            "stopped_solana_publication_stage_schedule_and_ledger_must_be_unchanged")


def scheduled_solana_publication(before, after, fresh):
    prefix_preserved(before, after)
    published = after["publishedRun"]
    require(int(after["state"]["publishedRunId"] or 0) > int(before["state"]["publishedRunId"] or 0) and
            published["state"] == "published" and published["assetCount"] == 10000 and
            published["missingCount"] <= 2 and not after["state"]["lastErrorPresent"],
            "next_ordinary_scheduled_publication_still_pending")
    started = datetime.fromisoformat(fresh["startedAt"])
    completed = datetime.fromisoformat(published["completedAt"])
    require(fresh["id"] == published["id"] and fresh["id"] not in [row["id"] for row in before["runningRunStates"]] and
            fresh["manifestChecksum"] == before["manifest"]["checksum"] and fresh["requestCount"] >= 10 and
            started >= datetime.fromisoformat(before["observedAt"]) and
            started >= datetime.fromisoformat(before["state"]["nextScanAt"]) and
            started <= completed <= datetime.fromisoformat(after["observedAt"]) and
            datetime.fromisoformat(after["state"]["nextScanAt"]) > completed,
            "fresh_normally_scheduled_scan_required_not_a_cached_staged_publication")


def checkpoints_preserved(before, after):
    baseline = {row["chain_id"]: row for row in before}
    require(len(baseline) == len(after) == 4 and all(row["chain_id"] in baseline and
            row[key] >= baseline[row["chain_id"]][key] for row in after
            for key in ("latest_checkpoint", "safe_checkpoint", "finalized_checkpoint")),
            "native_checkpoints_must_not_rewind")


def desired_pointer(before, published_at):
    require(isinstance(before, list) and len(before) <= 1 and isinstance(published_at, str) and
            datetime.fromisoformat(published_at).utcoffset() == timezone.utc.utcoffset(None), "fixed_utc_selector_intent_required")
    return {"name": "main", "release_id": RELEASE, "previous_release_id": before[0]["release_id"] if before else None,
            "epoch": int(before[0]["epoch"]) + 1 if before else 1, "published_at": published_at}


def matches_pointer(rows, desired):
    if not isinstance(rows, list) or len(rows) != 1 or set(rows[0]) != set(desired):
        return False
    return all(rows[0][key] == desired[key] for key in desired if key != "published_at") and (
        datetime.fromisoformat(rows[0]["published_at"]) == datetime.fromisoformat(desired["published_at"]))


def committed_selector_intent(binding, intent, current):
    require(intent.get("format") == FORMAT and intent.get("before") == binding["priorPointer"] and
            intent.get("originalReviewHash") == sha(encode(binding)) and
            intent.get("bootId") == binding["plan"]["sourceRuntime"]["bootId"] and
            intent.get("desired") == desired_pointer(binding["priorPointer"], intent["desired"]["published_at"]) and
            matches_pointer(current, intent["desired"]), "only_exact_committed_selector_intent_may_be_reconciled")
    return current


def pointer_sql(before, *, restore=False, published_at=None):
    require(isinstance(before, list) and len(before) <= 1, "single_source_selector_required")
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    expected = literal(encode(before).decode()) + "::jsonb"
    guard = ("IF (SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM "
             "yunipals_indexer_control.active_release a) IS DISTINCT FROM " + expected +
             " THEN RAISE EXCEPTION 'source_selector_CAS_changed'; END IF;")
    if restore:
        require(len(before) == 1 and before[0].get("release_id") == RELEASE, "owned_selected_pointer_required")
        body = "DELETE FROM yunipals_indexer_control.active_release WHERE name='main';"
    else:
        require(not before or before[0].get("name") == "main", "main_selector_only")
        epoch = int(before[0]["epoch"]) + 1 if before else 1
        previous = literal(before[0]["release_id"]) if before else "NULL"
        stamp = "clock_timestamp()" if published_at is None else literal(desired_pointer(before, published_at)["published_at"]) + "::timestamptz"
        body = ("INSERT INTO yunipals_indexer_control.active_release(name,release_id,previous_release_id,epoch,published_at)"
                " VALUES('main','" + RELEASE + "'," + previous + "," + str(epoch) + "," + stamp + ")"
                " ON CONFLICT(name) DO UPDATE SET release_id=EXCLUDED.release_id,previous_release_id=EXCLUDED.previous_release_id,"
                "epoch=EXCLUDED.epoch,published_at=EXCLUDED.published_at;")
    return ("BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='1s'; "
            "SELECT pg_advisory_xact_lock(178858,9063); LOCK TABLE yunipals_indexer_control.active_release IN EXCLUSIVE MODE; "
            "DO $selection$ BEGIN " + guard + body + " END $selection$; "
            "SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM yunipals_indexer_control.active_release a; COMMIT;")


def restore_pointer_sql(installed, before):
    # The current exact row, including epoch and publication timestamp, is the CAS token.
    text = pointer_sql(installed, restore=True)
    if before:
        require(len(before) == 1 and before[0].get("name") == "main", "one_saved_main_pointer_required")
        row = json.dumps(before[0], sort_keys=True, separators=(",", ":")).replace("'", "''")
        text = text.replace("DELETE FROM yunipals_indexer_control.active_release WHERE name='main';",
                            "DELETE FROM yunipals_indexer_control.active_release WHERE name='main'; "
                            "INSERT INTO yunipals_indexer_control.active_release SELECT * FROM "
                            "jsonb_populate_record(NULL::yunipals_indexer_control.active_release,'" + row + "'::jsonb);")
    return text


def candidates():
    require(FEATURE_HELPER_SHA is not None, "reviewed_feature_inverse_owner_binding_required")
    stage = document({"file": str(STAGE / "staged.json"), "sha256": STAGE_SHA})
    require(stage.get("staged") is True and stage.get("sourceUidReadabilityVerified") is True,
            "actual_original_stage_acknowledgment_required")
    review = json.loads(read(STAGE / "review.json"))
    require(sha(encode(review["binding"])) == review["reviewHash"] == stage["reviewHash"],
            "original_staged_file_manifest_required")
    inputs = {str(STAGE / name): row["sha256"] for name, row in review["binding"]["files"].items()}
    inputs.update({str(TRANSPORT): TRANSPORT_SHA, str(BASE_RPC): BASE_RPC_SHA, str(NORMAL): NORMAL_SHA, str(PROFILE): PROFILE_SHA,
                   str(RESOURCES): sha(RESOURCES_RAW), str(FEATURE_HELPER): FEATURE_HELPER_SHA})
    for path, pin in inputs.items():
        require(sha(read(path)) == pin, "staged_candidate_or_private_input_changed")
    require(inputs[str(STAGE / "yunipals-indexer.service.candidate")] == UNIT_SHA and
            inputs[str(STAGE / "run-indexer.sh")] == LAUNCH_SHA and
            inputs[str(STAGE / "helius-egress.conf.candidate")] == HELIUS_SHA, "exact_existing_supervisor_candidates_required")
    # This is a preexisting finite normal profile, never a new allowance.
    profile = json.loads(read(PROFILE))
    require(datetime.now(timezone.utc) < datetime(2026, 11, 19, 18, tzinfo=timezone.utc),
            "existing_normal_profile_expired_requires_separate_policy_action")
    return inputs, profile


def acceptance(ref):
    value = document(ref)
    require(value.get("format") == "yunipals-final-source-acceptance-v1" and
            (value.get("sourceDigest"), value.get("physicalSchema"), value.get("buildId"), value.get("releaseId")) ==
            (SOURCE, SCHEMA, BUILD, RELEASE) and value.get("accepted") is True and
            value.get("checks") == {key: True for key in CHECKS}, "complete_actual_final_acceptance_required")
    require(set(value.get("proofs", {})) == set(CHECKS), "every_required_acceptance_proof_required")
    # Read each direct evidence artifact once. Never import recursively chained operators or archives.
    proofs = {name: document(proof) for name, proof in value["proofs"].items()}
    require(all(isinstance(proof, dict) and proof and proof.get("status") != "failed" and
                proof.get("error") is None for proof in proofs.values()), "failed_acceptance_proof_cannot_qualify")
    witness = proofs["fixedBoundaryDataAndCanonicalWitness"]
    require(witness.get("format") == "yunipals-fixed-boundary-witness-v1" and witness.get("completed") is True and
            witness.get("legacyBaselineUnchanged") is True and all(witness.get("acceptance", {}).get(k) is True for k in
            ("qualified", "exactDataParityRecomputed", "allSavedLegacyHashesMatched")), "actual_qualified_fixed_boundary_witness_required")
    require(set(value.get("consumerInstalls", {})) == set(INSTALL_UNITS), "all_four_actual_consumer_admissions_required")
    for name, proof_ref in value["consumerInstalls"].items():
        proof = document(proof_ref)
        require(proof.get("format") == CONSUMER_FORMAT and proof.get("operatorSha256") == CONSUMER_OPERATOR_SHA and
                proof.get("applied") is True and proof.get("unit") == INSTALL_UNITS[name] and
                proof.get("error") is None and proof.get("rollbackRequired") is False,
                "actual_successful_v7_consumer_install_required")
        actual = unit(INSTALL_UNITS[name])
        require(active(actual) and actual["InvocationID"] == proof.get("invocation"),
                "accepted_consumer_invocation_must_still_be_current")
    require(value.get("paidAuthority") is False and value.get("permitIds") == [] and
            value.get("recoveredHeapMiB") == 4096 and value.get("recoveredMemoryMaxBytes") == 6442450944,
            "accepted_existing_free_only_resource_policy_required")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


def request(port, path, headers=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    target = urllib.request.Request("http://127.0.0.1:" + str(port) + path, headers=headers or {})
    with opener.open(target, timeout=3) as response:
        raw = response.read(500001)
        require(response.status == 200 and len(raw) <= 500000, "actual_loopback_service_health_required")
    return json.loads(raw) if raw else None


def health():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open("http://127.0.0.1:9024/health", timeout=3) as response:
        require(response.status == 200 and len(response.read(16385)) <= 16384, "actual_ponder_health_required")


def proxy_health(name):
    chain, port = PORTS[name]
    metrics = request(port, "/metrics")
    policy = metrics.get("unified", {})
    require(metrics.get("freeRouting") is True and metrics.get("paidFallbackOnFreeFailure") is False and
            metrics.get("sourcePaidFallbackOnFreeFailure") is False and policy.get("profileId") == PROFILE_ID and
            policy.get("chainId") == chain and policy.get("sourceRouting") == "free_first", "actual_free_only_proxy_routes_required")
    for workload in ("unified_source", "unified_evidence"):
        gate = request(port, "/unified/preflight", {"x-yunipals-unified-rpc-profile": PROFILE_ID,
                       "x-yunipals-rpc-workload": workload})
        require(gate.get("profileId") == PROFILE_ID and gate.get("chainId") == chain and
                gate.get("paid") == "explicit_bounded_permit_only" and gate.get("replay", {}).get("mode") == "free_only",
                "actual_free_only_profile_preflight_required")


def current_source(plan):
    ref = plan["sourceRecovery"]
    require(isinstance(ref, dict) and set(ref) == {"file", "sha256"}, "actual_direct_source_successor_binding_required")
    binding = SOURCE_BINDINGS.get(ref["sha256"])
    require(binding is not None and ref["file"] == binding["file"] and
            plan["sourceHelperSha256"] == binding["helperSha256"], "unacknowledged_source_successor_cannot_qualify")
    receipt = document(ref)
    helper = Path(binding["helper"])
    raw = read(helper)
    require(sha(raw) == binding["helperSha256"], "actual_direct_source_successor_binding_required")
    module = types.ModuleType("accepted_current_source")
    module.__file__ = str(helper)
    exec(compile(raw, str(helper), "exec"), module.__dict__)
    if binding["kind"] == "bounded-base1":
        b, s = module.modules()
        require(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == s.BOOT, "same_acknowledged_source_boot_required")
        validated = module.inspect(b, s)
        require(receipt.get("format") == "yunipals-source6-base-priority-resume" and
                receipt.get("started") is True and receipt.get("baseSourceConcurrency") == 1 and
                receipt.get("schema") == SCHEMA and receipt.get("buildId") == BUILD and
                receipt.get("rpcSha256") == BASE_RPC_SHA and
                validated.get("runtimeReceiptSha256") == ref["sha256"] and
                validated.get("runtime") == receipt.get("runtime") and validated.get("runtime") is not None,
                "actual_bounded_base1_runtime_required")
        expires = receipt["expiresMonotonicMicroseconds"]
        require(type(expires) is int and expires <= receipt["originalDeadlineMonotonicMicroseconds"] and
                expires - time.monotonic_ns() // 1000 > 900_000_000,
                "current_successor_and_handover_deadline_headroom_required")
        s.inputs()
        s.financial()
        validated = {**validated, "expiresMonotonicMicroseconds": expires}
    elif binding["kind"] == "normal-free-base1":
        # Only an actual acknowledged normal receipt may be added to the fixed
        # binding table. No arbitrary helper or future/nonexistent SHA qualifies.
        r, b, s = module.modules()
        require(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == s.BOOT, "same_acknowledged_source_boot_required")
        validated = module.validate(r, b, s, ref["sha256"])
        require(receipt.get("format") == "yunipals-source6-normal-free-successor" and
                receipt.get("baseSourceConcurrency") == 1 and receipt.get("heapMiB") == 4096 and
                receipt.get("memoryMaxBytes") == 6442450944 and
                validated.get("validated") is True and validated.get("normalOperationalRuntime") == "infinity" and
                validated.get("financialWindowRenewed") is False and
                (datetime.fromisoformat(validated["financialExpiresAt"]) - datetime.now(timezone.utc)).total_seconds() > 900,
                "actual_normal_free_base1_runtime_required")
    elif binding["kind"] == "normal-free-proxy-qualified-base1":
        # The historical whole-runtime validator remains unpassed. This exact
        # separate acknowledgement qualifies only the four proxy process tuples
        # while retaining the original process, static inputs and financial duty.
        normal, r, b, status = module.modules()
        require(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == status.BOOT,
                "same_acknowledged_source_boot_required")
        validated = module.validate_current(ref["sha256"])
        require(receipt.get("format") == "yunipals-source6-normal-proxy-requalification-v1" and
                receipt.get("acknowledged") is True and
                receipt.get("operatorSha256") == binding["helperSha256"] and
                receipt.get("originalRuntimeReceiptSha256") ==
                "e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f" and
                receipt.get("nativeIdentity") == {"schema": SCHEMA, "schemaOid": "73004622",
                    "buildId": BUILD, "catalogSha256":
                    "d9f3d0988229ad954cc8d4e1f34878c5882c4026b024a25885bd45dd30564b76"} and
                validated.get("validated") is True and
                validated.get("operatorSha256") == binding["helperSha256"] and
                validated.get("qualificationReceiptSha256") == ref["sha256"] and
                validated.get("originalRuntimeReceiptSha256") == receipt["originalRuntimeReceiptSha256"] and
                validated.get("bootLink") == receipt.get("bootLink") and receipt.get("bootLink") is not None and
                validated.get("normalOperationalRuntime") == "infinity" and
                validated.get("financialWindowRenewed") is False and
                validated.get("sourceRestarted") is False and
                validated.get("nativeCaughtUpClaimed") is False and
                validated.get("originalWholeValidationPassed") is False and
                (datetime.fromisoformat(validated["financialExpiresAt"]) - datetime.now(timezone.utc)).total_seconds() > 900,
                "actual_proxy_qualified_normal_source_required")
    else:
        fail("unacknowledged_source_successor_kind")
    require(validated.get("freeOnly") is True and validated.get("paidAuthority") is False and
            validated.get("runtime") == receipt.get("runtime"), "actual_free_only_source_successor_required")
    return {**validated, "kind": binding["kind"], "bootLink": (
        receipt["bootLink"] if binding["kind"] in {"normal-free-base1", "normal-free-proxy-qualified-base1"} else None)}


def complete_base_block(checkpoint):
    require(isinstance(checkpoint, str) and re.fullmatch("[0-9]{75}", checkpoint) and
            int(checkpoint[10:26]) == 8453, "actual_base_native_checkpoint_required")
    end = checkpoint[42:58] == "9" * 16 and checkpoint[58] == "9" and checkpoint[59:] == "9" * 16
    return int(checkpoint[26:42]) - (0 if end else 1)


def activation_paths(name):
    require(name in {BOOSTER_UNIT, SOURCE_UNIT, *LEGACY_BOOT_UNITS}, "fixed_source_activation_unit_required")
    properties = ("WantedBy", "RequiredBy", "UpheldBy")
    raw = run(["/usr/bin/systemctl", "show", "--all", name, *["--property=" + key for key in properties]])
    pairs = [row.split("=", 1) for row in raw.splitlines() if "=" in row]
    paths = dict(pairs)
    require(len(paths) == len(pairs) and set(paths) == set(properties), "actual_source_activation_properties_required")
    return paths


def source_boot_link(link, *, present):
    require(set(link) == {"file", "target", "uid", "gid", "device", "inode"} and
            link["file"] == "/etc/systemd/system/multi-user.target.wants/" + SOURCE_UNIT and
            link["target"] == "/etc/systemd/system/" + SOURCE_UNIT and link["uid"] == link["gid"] == 0 and
            type(link["device"]) is int and type(link["inode"]) is int,
            "exact_owned_normal_source_boot_link_required")
    path = Path(link["file"])
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022,
                "protected_normal_source_boot_directory_required")
    if present:
        info = path.lstat()
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == info.st_gid == 0 and
                os.readlink(path) == link["target"] and (info.st_dev, info.st_ino) == (link["device"], link["inode"]),
                "only_exact_owned_normal_boot_link_may_change")
    else:
        require(not os.path.lexists(path), "foreign_normal_source_boot_link_blocks_restore")
    return path


def retire_source_boot(binding, directory):
    link = binding["sourceSuccessor"]["bootLink"]
    if link is None:
        return False
    path = source_boot_link(link, present=True)
    require(definitions(unit(SOURCE_UNIT)) == binding["definitions"][SOURCE_UNIT], "owned_source_definitions_must_remain_unchanged")
    save(directory / "normal-source-boot-retire-intent.json", link)
    path.unlink()
    sync_dir(path.parent)
    run(["/usr/bin/systemctl", "daemon-reload"])
    actual = idle(unit(SOURCE_UNIT))
    require(actual["process"] is None and actual["MainPID"] == "0" and
            actual["UnitFileState"] in {"disabled", "static"} and not any(activation_paths(SOURCE_UNIT).values()),
            "normal_source_boot_activation_must_be_retired_before_shared_start")
    save(directory / "normal-source-boot-retired.json", link)
    return True


def source_activation_retired(binding):
    actual = idle(unit(SOURCE_UNIT))
    require(actual["process"] is None and actual["MainPID"] == "0" and
            actual["ActiveState"] in {"inactive", "failed"} and actual["UnitFileState"] in {"disabled", "static"} and
            not actual["TriggeredBy"] and not actual["Triggers"] and not any(activation_paths(SOURCE_UNIT).values()) and
            not os.path.lexists("/etc/systemd/system/multi-user.target.wants/" + SOURCE_UNIT),
            "prior_source_and_all_owned_activation_paths_must_remain_retired")


def restore_owned_boot(binding, directory, name):
    require(name in {SOURCE_UNIT, *LEGACY_BOOT_UNITS}, "fixed_owned_source_boot_inverse_required")
    prefix = "normal-source-boot" if name == SOURCE_UNIT else "legacy-boot-" + name
    verify = source_boot_link if name == SOURCE_UNIT else lambda link, *, present: legacy_boot_link(name, link, present=present)
    staging_prefix = ".yunipals-normal-restore-" if name == SOURCE_UNIT else ".yunipals-legacy-restore-" + sha(name.encode())[:12] + "-"
    intent = directory / (prefix + "-retire-intent.json")
    if not os.path.lexists(intent):
        return False
    expected = binding["sourceSuccessor"]["bootLink"] if name == SOURCE_UNIT else binding["legacyBootLinks"][name]
    link = json.loads(read(intent))
    actual = idle(unit(name))
    require(link == expected and actual["process"] is None and
            definitions(actual) == binding["definitions"][name], "owned_normal_source_boot_inverse_required")
    created_file = directory / (prefix + "-created.json")
    if os.path.lexists(link["file"]) and not os.path.lexists(created_file):
        # Failure after the intent but before unlink leaves the original link.
        verify(link, present=True)
        return False
    path = Path(link["file"])
    restore_intent = directory / (prefix + "-restore-intent.json")
    if not os.path.lexists(restore_intent):
        verify(link, present=False)
        staging = path.parent / (staging_prefix + os.urandom(16).hex() + ".link")
        require(not os.path.lexists(staging), "foreign_boot_staging_link_must_not_be_adopted")
        save(restore_intent, {"original": link, "stageFile": str(staging)})
    restore = json.loads(read(restore_intent))
    staging = Path(restore["stageFile"])
    require(restore["original"] == link and staging.parent == path.parent and
            re.fullmatch(re.escape(staging_prefix) + r"[0-9a-f]{32}\.link", staging.name), "owned_boot_restore_intent_required")

    def staged_identity():
        info = staging.lstat()
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == info.st_gid == 0 and os.readlink(staging) == link["target"],
                "owned_normal_source_boot_staging_identity_required")
        return {**link, "device": info.st_dev, "inode": info.st_ino}

    if not os.path.lexists(created_file):
        if not os.path.lexists(staging):
            os.symlink(link["target"], staging)
            sync_dir(path.parent)
        # Persist the created inode BEFORE publishing the boot target. Its
        # prepared link is in that same directory/filesystem; link() cannot
        # overwrite a foreign destination, including after a lost ACK.
        save(created_file, {"replacement": staged_identity(), "stageFile": str(staging)})
    created = json.loads(read(created_file))
    replacement = created["replacement"]
    require(created["stageFile"] == str(staging) and {k:v for k,v in replacement.items() if k not in {"device", "inode"}} ==
            {k:v for k,v in link.items() if k not in {"device", "inode"}}, "owned_created_boot_link_receipt_required")
    if not os.path.lexists(path):
        require(staged_identity() == replacement, "prepared_boot_link_inode_changed")
        os.link(staging, path, follow_symlinks=False)
        sync_dir(path.parent)
    verify(replacement, present=True)
    if os.path.lexists(staging):
        require(staged_identity() == replacement, "prepared_boot_link_inode_changed")
        staging.unlink()
        sync_dir(path.parent)
    if unit(name)["UnitFileState"] != "enabled":
        run(["/usr/bin/systemctl", "daemon-reload"])
    require(unit(name)["UnitFileState"] == "enabled", "original_normal_source_boot_restore_not_acknowledged")
    result = {**replacement, "sourceRemainsStopped": True, "priorRuntimeRestarted": False}
    restored = directory / (prefix + "-restored.json")
    if os.path.lexists(restored):
        require(json.loads(read(restored)) == result, "owned_boot_restore_acknowledgment_changed")
    else:
        save(restored, result)
    return True


def restore_source_boot(binding, directory):
    return restore_owned_boot(binding, directory, SOURCE_UNIT)


def legacy_boot_link(name, link, *, present):
    require(name in LEGACY_BOOT_UNITS and set(link) == {"file", "target", "uid", "gid", "device", "inode"} and
            link["file"] == str(BOOT_DIRECTORY / name) and link["target"] == "/etc/systemd/system/" + name and
            link["uid"] == link["gid"] == 0 and type(link["device"]) is int and type(link["inode"]) is int,
            "fixed_owned_legacy_boot_link_required")
    path = Path(link["file"])
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o022,
                "protected_legacy_boot_directory_required")
    if present:
        info = path.lstat()
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == info.st_gid == 0 and
                os.readlink(path) == link["target"] and (info.st_dev, info.st_ino) == (link["device"], link["inode"]),
                "only_exact_owned_legacy_boot_link_may_change")
    else:
        require(not os.path.lexists(path), "foreign_legacy_boot_link_blocks_restore")
    return path


def capture_legacy_boot_links(states):
    links = {}
    for name in LEGACY_BOOT_UNITS:
        current = states[name]
        path = BOOT_DIRECTORY / name
        activation = activation_paths(name)
        if current["UnitFileState"] == "enabled":
            info = path.lstat()
            link = {"file": str(path), "target": "/etc/systemd/system/" + name, "uid": 0, "gid": 0,
                    "device": info.st_dev, "inode": info.st_ino}
            legacy_boot_link(name, link, present=True)
            require(activation == {"WantedBy": "multi-user.target", "RequiredBy": "", "UpheldBy": ""},
                    "only_captured_legacy_boot_activation_allowed")
            links[name] = link
        else:
            require(current["UnitFileState"] in {"disabled", "static", ""} and not any(activation.values()) and
                    not os.path.lexists(path), "unowned_legacy_boot_activation_not_allowed")
            links[name] = None
    return links


def legacy_boot_binding(binding):
    links = binding["legacyBootLinks"]
    require(set(links) == set(LEGACY_BOOT_UNITS), "exact_four_prior_legacy_boot_states_required")
    for name, link in links.items():
        require((link is not None) is (binding["writers"][name]["UnitFileState"] == "enabled"),
                "legacy_boot_link_must_match_original_enablement")
    return links


def legacy_boot_authority(binding):
    return {"originalReviewHash": sha(encode(binding)), "links": legacy_boot_binding(binding),
            "removedUnits": [name for name in LEGACY_BOOT_UNITS if binding["legacyBootLinks"][name] is not None]}


def legacy_boots_disabled(binding):
    legacy_boot_binding(binding)
    for name in LEGACY_BOOT_UNITS:
        current = idle(unit(name))
        require(current["process"] is None and current["MainPID"] == "0" and
                current["ActiveState"] in {"inactive", "failed"} and
                current["UnitFileState"] in {"disabled", "static", ""} and
                not current["TriggeredBy"] and not current["Triggers"] and
                not any(activation_paths(name).values()) and not os.path.lexists(BOOT_DIRECTORY / name) and
                definitions(current) == binding["definitions"][name],
                "four_legacy_boot_activations_must_remain_retired")


def retire_legacy_boot_links(binding, directory):
    require(not os.path.lexists(directory / "legacy-boots-retire-intent.json") and
            not os.path.lexists(directory / "legacy-boots-retired.json"), "one_owned_four_boot_retirement_required")
    authority = legacy_boot_authority(binding)
    # Capture all four exact terminal definitions before changing any link.
    for name, link in authority["links"].items():
        current = idle(unit(name))
        require(current["process"] is None and current["MainPID"] == "0" and
                current["ActiveState"] in {"inactive", "failed"} and
                definitions(current) == binding["definitions"][name], "owned_terminal_legacy_writer_required")
        if link is not None:
            legacy_boot_link(name, link, present=True)
        else:
            require(current["UnitFileState"] in {"disabled", "static", ""} and
                    not any(activation_paths(name).values()) and not os.path.lexists(BOOT_DIRECTORY / name),
                    "originally_absent_legacy_boot_must_still_be_absent")
    save(directory / "legacy-boots-retire-intent.json", authority)
    for name, link in authority["links"].items():
        if link is None:
            continue
        save(directory / ("legacy-boot-" + name + "-retire-intent.json"), link)
        path = legacy_boot_link(name, link, present=True)
        path.unlink()
        sync_dir(path.parent)
    run(["/usr/bin/systemctl", "daemon-reload"])
    legacy_boots_disabled(binding)
    save(directory / "legacy-boots-retired.json", {**authority, "activationAbsent": True})


def legacy_activation_retired(binding, directory):
    expected = {**legacy_boot_authority(binding), "activationAbsent": True}
    require(json.loads(read(directory / "legacy-boots-retired.json")) == expected,
            "actual_owned_four_boot_retirement_ack_required")
    legacy_boots_disabled(binding)


def legacy_boot_links_restored(binding, directory):
    links = legacy_boot_binding(binding)
    restored = {}
    untouched = []
    for name, original in links.items():
        current = idle(unit(name))
        untouched_original = (not os.path.lexists(directory / ("legacy-boot-" + name + "-retire-intent.json")) and
                              active(current) and current == binding["writers"][name])
        require((untouched_original or current["process"] is None and current["MainPID"] == "0" and
                current["ActiveState"] in {"inactive", "failed"}) and
                definitions(current) == binding["definitions"][name], "legacy_boot_inverse_refuses_unowned_writer")
        if untouched_original:
            untouched.append(name)
        if original is None:
            require(current["UnitFileState"] in {"disabled", "static", ""} and
                    not any(activation_paths(name).values()) and not os.path.lexists(BOOT_DIRECTORY / name),
                    "originally_disabled_legacy_boot_must_remain_absent")
            restored[name] = None
            continue
        created = directory / ("legacy-boot-" + name + "-created.json")
        replacement = json.loads(read(created))["replacement"] if os.path.lexists(created) else original
        require({k: v for k, v in replacement.items() if k not in {"device", "inode"}} ==
                {k: v for k, v in original.items() if k not in {"device", "inode"}}, "only_original_legacy_boot_target_may_return")
        legacy_boot_link(name, replacement, present=True)
        require(current["UnitFileState"] == "enabled" and activation_paths(name) ==
                {"WantedBy": "multi-user.target", "RequiredBy": "", "UpheldBy": ""},
                "original_legacy_boot_enablement_must_be_restored")
        restored[name] = replacement
    return {"originalReviewHash": sha(encode(binding)), "links": restored,
            "previouslyRetiredWritersRemainStopped": True, "untouchedOriginalWritersPreserved": untouched}


def restore_legacy_boot_links(binding, directory):
    links = legacy_boot_binding(binding)
    for name, original in links.items():
        if original is not None:
            restore_owned_boot(binding, directory, name)
    result = legacy_boot_links_restored(binding, directory)
    path = directory / "legacy-boots-restored.json"
    if os.path.lexists(path):
        require(json.loads(read(path)) == result, "owned_four_boot_restore_ack_changed")
    else:
        save(path, result)
    return result


def booster_retirement(ref):
    require(ref is not None, "temporary_booster_source_requires_owned_retirement_receipt")
    value = document(ref)
    require(value.get("format") == "yunipals-booster-source-retirement-v1" and
            value.get("activationPathsAbsent") is True and value.get("oldSchemaPreserved") is True,
            "actual_owned_booster_source_retirement_required")
    parity, post, reader, event, source = [value.get(key, {}) for key in
        ("parity", "postSwitchParity", "readerHandover", "freshEvent", "source")]
    digest = lambda item: isinstance(item, str) and re.fullmatch("[0-9a-f]{64}", item) is not None and item != "0" * 64
    block_hash = lambda item: isinstance(item, str) and re.fullmatch("0x[0-9a-f]{64}", item) is not None and item != "0x" + "0" * 64
    require(digest(parity.get("reportSha256")) and type(parity.get("boundary")) is int and parity["boundary"] >= 52848542 and
            block_hash(parity.get("headerHash")) and digest(reader.get("receiptSha256")) and
            reader.get("schema") == SCHEMA and re.fullmatch("[0-9a-f]{32}", str(reader.get("apiInvocation"))) and
            reader.get("queueEnabled") is True and reader.get("publicReady") is True and
            type(reader.get("switchBoundary")) is int and parity["boundary"] <= reader["switchBoundary"] and
            type(event.get("blockNumber")) is int and event["blockNumber"] > reader["switchBoundary"] and
            type(event.get("logIndex")) is int and 0 <= event["logIndex"] < 2 ** 32 and
            block_hash(event.get("blockHash")) and block_hash(event.get("transactionHash")),
            "actual_booster_parity_readers_and_post_switch_event_required")
    require(digest(post.get("reportSha256")) and type(post.get("boundary")) is int and
            post["boundary"] >= event["blockNumber"] and block_hash(post.get("headerHash")),
            "actual_post_event_full_booster_parity_required")
    require(source.get("unit") == BOOSTER_UNIT and re.fullmatch("[0-9a-f]{32}", str(source.get("priorInvocation"))) and
            source.get("terminal") is True and type(source.get("pid")) is int and source["pid"] == 0 and source.get("enabled") is False,
            "actual_owned_booster_stop_disable_acknowledgment_required")
    actual = idle(unit(BOOSTER_UNIT))
    require(actual["LoadState"] == "loaded" and actual["ActiveState"] in {"inactive", "failed"} and
            actual["SubState"] in {"dead", "failed"} and actual["MainPID"] == "0" and actual["process"] is None and
            actual["InvocationID"] in {"", source["priorInvocation"]} and
            actual["UnitFileState"] == "disabled" and not actual["TriggeredBy"] and not actual["Triggers"],
            "temporary_booster_source_must_be_terminal_disabled_and_untriggered")
    require(not any(activation_paths(BOOSTER_UNIT).values()),
            "temporary_booster_automatic_activation_paths_must_be_absent")
    block, index = event["blockNumber"], event["logIndex"]
    proof = sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT jsonb_build_object("
                "'checkpoint',(SELECT latest_checkpoint FROM " + SCHEMA + "._ponder_checkpoint WHERE chain_id=8453),"
                "'headerHash',(SELECT block_hash FROM " + SCHEMA + ".chain_block WHERE chain_id=8453 AND block_number=" + str(block) + "),"
                "'eventMatches',(SELECT count(*) FROM " + SCHEMA + ".booster_event WHERE block_number=" + str(block) +
                " AND block_hash='" + event["blockHash"] + "' AND transaction_hash='" + event["transactionHash"] +
                "' AND log_index=" + str(index) + ")); ROLLBACK;")
    require(complete_base_block(proof["checkpoint"]) >= block and proof["eventMatches"] == 1 and
            proof["headerHash"] == event["blockHash"], "current_combined_source_must_cover_actual_post_handover_booster_event")
    return {"reference": ref, "priorInvocation": source["priorInvocation"], "state": actual}


def review(plan):
    require(plan.get("boosterRetirement") is not None, "temporary_booster_source_requires_owned_retirement_receipt")
    require(set(plan) == {"format", "runId", "acceptance", "sourceRuntime", "sourceRecovery", "sourceHelperSha256", "proxyInputs", "boosterRetirement"} and
            plan["format"] == FORMAT and re.fullmatch("[a-z][a-z0-9-]{0,47}", plan["runId"]), "fixed_handover_plan_required")
    retired = booster_retirement(plan["boosterRetirement"])
    accepted = acceptance(plan["acceptance"])
    # One direct current validator, no historical operator ancestry or archive scan.
    validated = current_source(plan)
    source = idle(unit(SOURCE_UNIT))
    require(active(source) and source["process"] == plan["sourceRuntime"]["process"] and
            source["InvocationID"] == plan["sourceRuntime"]["invocation"] and source["process"]["uid"] == 970 and
            source["InvocationID"] == validated["runtime"]["invocation"] and
            source["process"]["pid"] == validated["runtime"]["pid"] and
            source["process"]["startTicks"] == validated["runtime"]["startTicks"] and
            source["WorkingDirectory"] == str(CWD), "exact_accepted_current_source_runtime_required")
    require(plan["sourceRuntime"]["bootId"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
            "same_source_boot_required")
    inputs, _ = candidates()
    inputs[plan["boosterRetirement"]["file"]] = plan["boosterRetirement"]["sha256"]
    inputs[plan["sourceRecovery"]["file"]] = plan["sourceRecovery"]["sha256"]
    inputs[SOURCE_BINDINGS[plan["sourceRecovery"]["sha256"]]["helper"]] = plan["sourceHelperSha256"]
    require(set(plan["proxyInputs"]) == set(CHAINS), "all_four_unchanged_normal_proxy_inputs_required")
    proxies = {}
    for name in CHAINS:
        row = plan["proxyInputs"][name]
        require(isinstance(row, dict) and set(row) == {"unit", "invocation", "files"} and
                row["unit"] == "yunipals-market-production-rpc@" + name + ".service", "fixed_proxy_selection_required")
        current = idle(unit(row["unit"]))
        require(active(current) and current["InvocationID"] == row["invocation"], "accepted_free_proxy_invocation_changed")
        require(isinstance(row["files"], dict) and row["files"], "complete_ordered_proxy_input_hashes_required")
        for path, pin in row["files"].items():
            require(sha(read(path)) == pin, "accepted_proxy_input_changed")
        proxy_health(name)
        proxies[name] = {"state": current, "definitions": definitions(current)}
    states = {name: idle(unit(name)) for name in WRITERS}
    require(active(states["yunipals-solana.service"]) and active(states[UNIT]), "retained_old_solana_and_indexer_required")
    original_defs = {name: definitions(value) for name, value in states.items()}
    # Explicitly inventory all drop-ins; no inferred removals or consumer/API stop.
    require(all(value["UnitFileState"] in {"enabled", "disabled", "static", ""} for value in states.values()),
            "review_exact_enable_states_before_handover")
    require(all(not value["TriggeredBy"] and not value["Triggers"] for value in states.values()),
            "additional_writer_activation_paths_require_explicit_review")
    source_activation = activation_paths(SOURCE_UNIT)
    if validated["bootLink"]:
        source_boot_link(validated["bootLink"], present=True)
        require(source["UnitFileState"] == "enabled" and source_activation ==
                {"WantedBy": "multi-user.target", "RequiredBy": "", "UpheldBy": ""},
                "only_owned_normal_source_boot_activation_allowed")
    else:
        require(source["UnitFileState"] in {"disabled", "static"} and not any(source_activation.values()),
                "bounded_source_must_not_have_automatic_boot_activation")
    legacy_boots = capture_legacy_boot_links(states)
    before = native()
    native_identity(before, selected=[], running=True)
    health()
    return {"format": FORMAT, "plan": plan, "acceptanceSha256": plan["acceptance"]["sha256"],
            "acceptedProofs": accepted["proofs"], "inputs": inputs, "source": source, "writers": states,
            "consumerInstalls": accepted["consumerInstalls"],
            "sourceSuccessor": {"file": plan["sourceRecovery"]["file"], "sha256": plan["sourceRecovery"]["sha256"],
                                "runtime": validated["runtime"], "expiresMonotonicMicroseconds": validated.get("expiresMonotonicMicroseconds"),
                                "normalOperationalRuntime": validated.get("normalOperationalRuntime"),
                                "financialExpiresAt": validated.get("financialExpiresAt"),
                                "kind": validated["kind"], "bootLink": validated["bootLink"]},
            "boosterRetirement": retired,
            "definitions": original_defs, "legacyBootLinks": legacy_boots, "proxies": proxies, "priorPointer": before["active"],
            "automaticRetryAllowed": False, "paidAuthority": False}


def install_files():
    dropdir = Path("/etc/systemd/system/" + UNIT + ".d")
    return {Path("/etc/systemd/system/" + UNIT): read(STAGE / "yunipals-indexer.service.candidate"),
            dropdir / "zzzz-solana-helius-20261021.conf": read(STAGE / "helius-egress.conf.candidate"),
            dropdir / "zzzz-solana-normal-rpc-20261022-v4.conf": read(TRANSPORT),
            dropdir / "zzzz-solana-resources-v1.conf": read(RESOURCES)}


def same_proxies(binding):
    for name, row in binding["proxies"].items():
        current = idle(unit(row["state"]["Id"]))
        require(current == row["state"] and definitions(current) == row["definitions"], "proxy_changed_during_source_handover")
        for path, pin in binding["plan"]["proxyInputs"][name]["files"].items():
            require(sha(read(path)) == pin, "proxy_private_or_public_input_changed")
        proxy_health(name)


def same_inputs(binding):
    for path, pin in binding["inputs"].items():
        require(sha(read(path)) == pin, "accepted_supervisor_or_child_input_changed")


def effective_unit():
    keys = ["MemoryMax", "MemorySwapMax", "Environment", "ReadWritePaths", "BindReadOnlyPaths", "KillMode", "NoNewPrivileges"]
    raw = run(["/usr/bin/systemctl", "show", UNIT, *["--property=" + name for name in keys]])
    values = dict(line.split("=", 1) for line in raw.splitlines())
    require(set(values) == set(keys) and values["MemoryMax"] == "6442450944" and values["MemorySwapMax"] == "0" and
            values["KillMode"] == "control-group" and values["NoNewPrivileges"] == "yes" and
            values["Environment"] == "NODE_OPTIONS=--max-old-space-size=4096", "actual_effective_resources_and_sandbox_required")
    require(set(values["ReadWritePaths"].split()) == {str(CWD / ".ponder"), str(CWD / "ponder-env.d.ts")},
            "only_two_retained_codegen_writable_paths_allowed")
    transport = read(TRANSPORT).decode()
    binds = [line.removeprefix("BindReadOnlyPaths=") for line in transport.splitlines() if line.startswith("BindReadOnlyPaths=")]
    object_path = "/org/freedesktop/systemd1/unit/" + "".join(
        char if char.isascii() and char.isalnum() else "_" + format(ord(char), "02x") for char in UNIT)
    def bus_property(name):
        value = json.loads(run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1",
                               object_path, "org.freedesktop.systemd1.Service", name]))
        require(value.get("type") == "a(ssbt)" and isinstance(value.get("data"), list), "typed_mount_property_required")
        return value["data"]
    rows = bus_property("BindReadOnlyPaths")
    require(len(rows) == len(binds) and all(len(row) == 4 and row[:3] == [*wanted.split(":"), False] and
            type(row[3]) is int and row[3] in {0, 16384} for row, wanted in zip(rows, binds)) and
            bus_property("BindPaths") == [], "both_actual_readonly_rpc_and_historical_mounts_required")
    values["BindReadOnlyPaths"] = rows
    network_keys = ["IPAddressAllow", "IPAddressDeny", "Restart", "RestartPreventExitStatus", "TimeoutStopUSec", "Conflicts"]
    text = run(["/usr/bin/systemctl", "show", UNIT, *["--property=" + name for name in network_keys]])
    network = {}
    for line in text.splitlines():
        name, separator, value = line.partition("=")
        require(separator and name in network_keys and (name not in network or name in {"IPAddressAllow", "IPAddressDeny"}),
                "exact_effective_supervisor_network_and_restart_properties_required")
        network[name] = (network.get(name, "") + " " + value).strip()
    require(set(network) == set(network_keys), "exact_effective_supervisor_network_and_restart_properties_required")
    helius = read(STAGE / "helius-egress.conf.candidate")
    require(sha(helius) == HELIUS_SHA, "reviewed_numeric_helius_egress_required")
    expected = {"127.0.0.0/8", "::1/128"} | {
        str(ipaddress.ip_network(line.split("=", 1)[1], strict=True)) for line in helius.decode().splitlines()
        if line.startswith("IPAddressAllow=")}
    networks = lambda value: {str(ipaddress.ip_network(item, strict=False)) for item in value.split()}
    require(networks(network["IPAddressAllow"]) == expected and
            networks(network["IPAddressDeny"]) == {"0.0.0.0/0", "::/0"} and
            network["Restart"] == "on-failure" and network["RestartPreventExitStatus"] == "75" and
            network["TimeoutStopUSec"] == "2min" and {SOURCE_UNIT, BOOSTER_UNIT} <= set(network["Conflicts"].split()),
            "retained_helius_only_egress_and_restart_policy_required")
    values.update(network)
    return values


def managed_children(state):
    require(active(state) and state["User"] == state["Group"] == "yunipals_unified_shadow" and
            state["WorkingDirectory"] == str(CWD), "actual_shared_supervisor_identity_required")
    group = Path("/sys/fs/cgroup") / state["ControlGroup"].lstrip("/") / "cgroup.procs"
    ids = [int(value) for value in group.read_text().split()]
    found = {"ponder": [], "solana": []}
    for pid in ids:
        args = Path("/proc", str(pid), "cmdline").read_bytes().split(b"\0")
        current = process(pid)
        require(current["uid"] == 970, "both_managed_children_must_use_source_uid")
        if b"node_modules/ponder/dist/esm/bin/ponder.js" in args:
            require(b"--schema" in args and SCHEMA.encode() in args and b"--port" in args and b"9024" in args and
                    ("--env-file=" + str(STAGE / "private/ponder.env")).encode() in args,
                    "retained_ponder_child_argv_required")
            found["ponder"].append(current)
        if b"lib/solana/worker.ts" in args:
            require(("--env-file=" + str(STAGE / "private/solana.env")).encode() in args,
                    "retained_solana_child_argv_required")
            found["solana"].append(current)
    require(all(len(v) == 1 for v in found.values()), "exactly_one_ponder_and_one_solana_child_required")
    for current in [found["ponder"][0], found["solana"][0]]:
        pid = current["pid"]
        # Retain only a fixed non-secret resource setting, never the environment bytes.
        args = Path("/proc", str(pid), "cmdline").read_bytes().split(b"\0")
        peer = peer_process_properties(pid)
        require(args[0] == b"/opt/node-v24.18.1/bin/node" and peer["nodeExecutable"] and peer["heapEnvironment4096"] and
                peer["startTicks"] == current["startTicks"] and
                not any(arg.startswith(b"--max-old-space-size") or arg.startswith(b"--max_old_space_size") for arg in args[1:]) and
                process(pid) == current, "actual_both_child_heap_configuration_required")
    return {name: rows[0] for name, rows in found.items()}


def shared_start_identity(current, intent):
    expected_argv = sha(b"/usr/bin/bash\0" + str(STAGE / "run-indexer.sh").encode() + b"\0")
    require(intent.get("format") == FORMAT and intent.get("unit") == UNIT and
            intent.get("bootId") == Path("/proc/sys/kernel/random/boot_id").read_text().strip() and
            active(current) and current["InvocationID"] != intent.get("priorInvocation") and current["NRestarts"] == "0" and
            current["ControlGroup"] == "/system.slice/" + UNIT and
            current["User"] == current["Group"] == "yunipals_unified_shadow" and current["WorkingDirectory"] == str(CWD) and
            definitions(current) == intent.get("definitions") and current["process"]["uid"] == 970 and
            current["process"]["argvSha256"] == expected_argv, "only_exact_owned_shared_start_can_be_reconciled")
    start_us = current["process"]["startTicks"] * 1_000_000 // os.sysconf("SC_CLK_TCK")
    peer = peer_process_properties(current["process"]["pid"])
    require(type(intent.get("monotonicMicroseconds")) is int and
            intent["monotonicMicroseconds"] - 1_000_000 // os.sysconf("SC_CLK_TCK") <= start_us <=
            intent["monotonicMicroseconds"] + 180_000_000 and
            peer["bashExecutable"] and peer["startTicks"] == current["process"]["startTicks"] and
            process(current["process"]["pid"]) == current["process"], "same_owned_shared_process_and_start_window_required")
    return {"invocation": current["InvocationID"], "process": current["process"], "reconciledForStopOnly": True,
            "readinessAccepted": False, "automaticRestartAccepted": False}


def start_shared(directory, process_file, selected):
    previous = idle(unit(UNIT))
    require(previous["process"] is None and previous["MainPID"] == "0" and previous["ActiveState"] in {"inactive", "failed"},
            "shared_writer_must_be_stopped_before_its_one_start")
    require(process_file in {"started-process.json", "restart-process.json"}, "fixed_shared_process_receipt_required")
    intent = {"format": FORMAT, "unit": UNIT, "priorInvocation": previous["InvocationID"],
              "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
              "monotonicMicroseconds": time.monotonic_ns() // 1000, "definitions": definitions(previous),
              "selectedPointer": selected, "processFile": process_file, "attempts": 1}
    save(directory / process_file.replace(".json", "-intent.json"), intent)
    run(["/usr/bin/systemctl", "start", "--no-block", UNIT], manager=True)
    deadline = time.monotonic() + 180
    invocation = None
    while time.monotonic() < deadline:
        current = unit(UNIT)
        if current["InvocationID"] and current["InvocationID"] != previous["InvocationID"] and current["process"] is not None:
            if invocation is None:
                shared_start_identity(current, intent)
                invocation = current["InvocationID"]
                save(directory / process_file, current)
            require(current["InvocationID"] == invocation, "automatic_restart_is_not_an_accepted_start")
        if invocation is not None and active(current) and current["Job"] in {"", "0"}:
            try:
                children = managed_children(current)
                health()
                snapshot = native()
                native_identity(snapshot, selected=selected, running=True)
                return current, children, snapshot
            except (ConnectionError, TimeoutError, urllib.error.URLError):
                pass
            except RuntimeError as error:
                require(str(error) in {"exactly_one_ponder_and_one_solana_child_required",
                        "actual_native_ready_runtime_required", "fresh_native_heartbeat_required"}, str(error))
        require(current["ActiveState"] != "failed" or current["InvocationID"] == previous["InvocationID"], "shared_supervisor_start_failed")
        time.sleep(1)
    fail("shared_supervisor_start_observation_deadline")


def apply(plan, expected):
    binding = review(plan)
    require(sha(encode(binding)) == expected, "exact_fresh_review_hash_required")
    EVIDENCE.mkdir(mode=0o700, exist_ok=True)
    info = EVIDENCE.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            "private_handover_root_required")
    directory = EVIDENCE / plan["runId"]
    directory.mkdir(mode=0o700)
    save(directory / "review.json", binding)
    save(directory / "intent.json", {"reviewHash": expected, "singleStart": True, "automaticRetryAllowed": False})
    backup = directory / "definitions"
    backup.mkdir(mode=0o700)
    originals = {}
    for path, pin in binding["definitions"][UNIT].items():
        raw = read(path)
        require(sha(raw) == pin, "original_definition_changed_before_backup")
        name = sha(path.encode()) + ".unit"
        write_new(backup / name, raw, 0o600)
        originals[path] = {"file": str(backup / name), "sha256": pin, "mode": stat.S_IMODE(Path(path).lstat().st_mode)}
    save(directory / "originals.json", originals)
    phase = "writer_stop"
    try:
        # Solana is quiet before the baseline; temporary Ponder is quiet before selection.
        for name in WRITERS:
            save(directory / ("stop-" + name + ".json"), stop_owned(name, binding["writers"][name]))
        source_boot_retired = retire_source_boot(binding, directory)
        retire_legacy_boot_links(binding, directory)
        quiet = native()
        native_identity(quiet, selected=binding["priorPointer"], running=False)
        baseline = solana()
        require(baseline["workerLock"] == {"granted": 0, "waiting": 0}, "old_solana_worker_lock_must_be_absent")
        save(directory / "stopped-native.json", quiet)
        save(directory / "stopped-solana.json", baseline)
        phase = "source_selection"
        desired = desired_pointer(binding["priorPointer"], datetime.now(timezone.utc).isoformat())
        save(directory / "selector-intent.json", {"format": FORMAT, "before": binding["priorPointer"], "desired": desired,
             "originalReviewHash": expected, "bootId": plan["sourceRuntime"]["bootId"]})
        selected = sql(pointer_sql(binding["priorPointer"], published_at=desired["published_at"]), write=True)
        require(matches_pointer(selected, desired), "owned_committed_selector_result_required")
        save(directory / "selected-pointer.json", selected)
        phase = "install"
        files = install_files()
        dropdir = Path("/etc/systemd/system/" + UNIT + ".d")
        dropdir.mkdir(mode=0o755, exist_ok=True)
        require(set(str(p) for p in dropdir.glob("*.conf")) == set(binding["definitions"][UNIT]) -
                {"/etc/systemd/system/" + UNIT}, "unknown_unit_dropin_blocks_install")
        save(directory / "install-intent.json", {"files": {str(p): sha(raw) for p, raw in files.items()}})
        for path in binding["definitions"][UNIT]:
            if path.endswith(".conf"):
                Path(path).unlink()
        for path, raw in files.items():
            replace(path, raw, 0o644)
        run(["/usr/bin/systemctl", "daemon-reload"])
        require(definitions(unit(UNIT)) == {str(p): sha(raw) for p, raw in files.items()}, "installed_effective_definition_mismatch")
        effective = effective_unit()
        same_inputs(binding)
        same_proxies(binding)
        phase = "single_start"
        booster_retirement(binding["plan"]["boosterRetirement"])
        source_activation_retired(binding)
        legacy_activation_retired(binding, directory)
        stopped_solana_unchanged(baseline, solana(baseline["ledgerPrefix"]["throughId"]))
        save(directory / "start-intent.json", {"unit": UNIT, "attempts": 1})
        current, children, snapshot = start_shared(directory, "started-process.json", selected)
        checkpoints_preserved(quiet["checkpoints"], snapshot["checkpoints"])
        phase = "immediate_acceptance"
        same_proxies(binding)
        same_inputs(binding)
        for name in WRITERS:
            if name != UNIT:
                old = unit(name)
                require(old["process"] is None and old["ActiveState"] in {"inactive", "failed"}, "old_duplicate_writer_restarted")
        after = solana(baseline["ledgerPrefix"]["throughId"])
        prefix_preserved(baseline, after)
        result = {"format": FORMAT, "reviewHash": expected, "shared": current, "children": children,
                  "installed": {str(p): sha(raw) for p, raw in files.items()}, "effectiveUnit": effective,
                  "selectedPointer": selected,
                  "stoppedCheckpoints": quiet["checkpoints"], "native": snapshot, "solana": after,
                  "normalSourceBootRetired": source_boot_retired,
                  "immediateAccepted": True, "scheduledPublicationAccepted": False, "retired": False,
                  "sourceDigest": SOURCE, "physicalSchema": SCHEMA, "buildId": BUILD, "releaseId": RELEASE,
                  "paidAuthority": False, "automaticRetryAllowed": False}
        pin = save(directory / "result.json", result)
        return {"format": FORMAT, "directory": str(directory), "resultSha256": pin,
                "immediateAccepted": True, "scheduledPublicationAccepted": False}
    except BaseException as error:
        save(directory / "failed.json", {"format": FORMAT, "phase": phase, "errorClass": type(error).__name__,
             "fixedCode": str(error) if isinstance(error, RuntimeError) else "handover_failed",
             "automaticRetryAllowed": False, "explicitOwnedRollbackRequired": True})
        raise


def current_handover(directory):
    directory = Path(directory)
    require(directory.parent == EVIDENCE and re.fullmatch("[a-z][a-z0-9-]{0,47}", directory.name), "owned_evidence_directory_required")
    binding = json.loads(read(directory / "review.json"))
    result = json.loads(read(directory / "result.json"))
    require(result.get("format") == FORMAT and result.get("immediateAccepted") is True and
            result["reviewHash"] == sha(encode(binding)), "actual_handover_acknowledgment_required")
    require(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == binding["plan"]["sourceRuntime"]["bootId"],
            "same_recorded_handover_boot_required")
    if os.path.lexists(directory / "restart-result.json"):
        restarted = json.loads(read(directory / "restart-result.json"))
        require(restarted.get("format") == FORMAT and restarted.get("restartAccepted") is True and
                restarted.get("originalReviewHash") == result["reviewHash"], "owned_restart_acknowledgment_required")
        result = {**result, **{name: restarted[name] for name in ("shared", "children", "native")}}
    current = unit(UNIT)
    require(active(current) and current["InvocationID"] == result["shared"]["InvocationID"] and
            current["process"] == result["shared"]["process"] and definitions(current) == result["installed"],
            "owned_shared_invocation_and_definitions_required")
    children = managed_children(current)
    require(children == result["children"], "both_original_managed_children_required")
    same_proxies(binding)
    same_inputs(binding)
    booster_retirement(binding["plan"]["boosterRetirement"])
    source_activation_retired(binding)
    legacy_activation_retired(binding, directory)
    require(effective_unit() == result["effectiveUnit"], "effective_shared_settings_changed")
    value = native()
    native_identity(value, selected=result["selectedPointer"], running=True)
    health()
    return binding, result, current


def restart_test(directory, expected=None):
    directory = Path(directory)
    binding, result, current = current_handover(directory)
    require(not os.path.lexists(directory / "restart-intent.json"), "one_explicit_restart_test_required")
    publication = json.loads(read(directory / "scheduled-publication.json"))
    require(publication.get("scheduledPublicationAccepted") is True, "ordinary_publication_required_before_restart_test")
    checked = {"format": FORMAT, "originalReviewHash": result["reviewHash"], "shared": current,
               "selectedPointer": result["selectedPointer"], "oneExplicitStart": True, "automaticRetryAllowed": False}
    digest = sha(encode(checked))
    if expected is None:
        return {"format": FORMAT, "reviewHash": digest, "binding": checked}
    require(expected == digest, "exact_fresh_restart_review_required")
    save(directory / "restart-intent.json", checked)
    try:
        stop_owned(UNIT, current)
        quiet = native()
        native_identity(quiet, selected=result["selectedPointer"], running=False)
        before = solana()
        require(before["workerLock"] == {"granted": 0, "waiting": 0}, "both_children_and_worker_lock_must_be_stopped")
        save(directory / "restart-stopped-native.json", quiet)
        save(directory / "restart-stopped-solana.json", before)
        require(effective_unit() == result["effectiveUnit"], "effective_shared_settings_changed")
        same_proxies(binding)
        same_inputs(binding)
        source_activation_retired(binding)
        legacy_activation_retired(binding, directory)
        stopped_solana_unchanged(before, solana(before["ledgerPrefix"]["throughId"]))
        shared, children, actual = start_shared(directory, "restart-process.json", result["selectedPointer"])
        after = solana(before["ledgerPrefix"]["throughId"])
        prefix_preserved(before, after)
        checkpoints_preserved(quiet["checkpoints"], actual["checkpoints"])
        same_proxies(binding)
        same_inputs(binding)
        value = {"format": FORMAT, "restartAccepted": True, "originalReviewHash": result["reviewHash"],
                 "shared": shared, "children": children, "native": actual, "solana": after,
                 "ledgerPrefixPreserved": True, "nativeCheckpointsPreserved": True, "automaticRetryAllowed": False}
        return {"format": FORMAT, "restartAccepted": True, "receiptSha256": save(directory / "restart-result.json", value)}
    except BaseException as error:
        save(directory / "restart-failed.json", {"format": FORMAT, "errorClass": type(error).__name__,
             "manualReconcileRequired": True, "automaticRetryAllowed": False})
        raise


def observe(directory):
    binding, result, current = current_handover(directory)
    baseline = json.loads(read(Path(directory) / "stopped-solana.json"))
    after = solana(baseline["ledgerPrefix"]["throughId"])
    published = after["publishedRun"]
    require(int(after["state"]["publishedRunId"] or 0) > int(baseline["state"]["publishedRunId"] or 0) and
            published["state"] == "published" and published["assetCount"] == 10000 and
            published["missingCount"] <= 2 and
            not after["state"]["lastErrorPresent"], "next_ordinary_scheduled_publication_still_pending")
    fresh = sql("BEGIN READ ONLY; SELECT jsonb_build_object('id',r.id,'startedAt',r.started_at,"
                "'requestCount',r.request_count,'manifestChecksum',r.manifest_checksum) FROM solana_indexer.scan_run r "
                "JOIN solana_indexer.sync_state s ON r.id=s.published_run_id WHERE s.singleton; ROLLBACK;")
    scheduled_solana_publication(baseline, after, fresh)
    # No force-scan entrypoint exists. The retained worker owns its unchanged schedule.
    value = {"format": FORMAT, "invocation": current["InvocationID"], "solana": after, "freshPublishedRun": fresh,
             "scheduledPublicationAccepted": True, "forcedScans": 0, "paidAuthority": False}
    pin = save(Path(directory) / "scheduled-publication.json", value)
    return {"format": FORMAT, "scheduledPublicationAccepted": True, "receiptSha256": pin}


def feature_inverse(ref, retirement_sha):
    require(FEATURE_HELPER_SHA is not None, "reviewed_feature_inverse_owner_binding_required")
    receipt = document(ref)
    require(receipt.get("format") == "yunipals-booster-feature-inverse-v1" and
            receipt.get("operatorSha256") == FEATURE_HELPER_SHA and
            receipt.get("retirementReceiptSha256") == retirement_sha and
            receipt.get("restoredSchema") == "yunipals_boosters_launch_v1" and receipt.get("publicReady") is True,
            "actual_matching_owned_feature_inverse_required")
    raw = read(FEATURE_HELPER)
    require(sha(raw) == FEATURE_HELPER_SHA, "reviewed_feature_inverse_owner_changed")
    module = types.ModuleType("accepted_feature_inverse")
    module.__file__ = str(FEATURE_HELPER)
    exec(compile(raw, str(FEATURE_HELPER), "exec"), module.__dict__)
    proof = module.validate_inverse(ref["file"], ref["sha256"])
    require(proof.get("validated") is True and proof.get("operatorSha256") == FEATURE_HELPER_SHA and
            proof.get("inverseReceiptSha256") == ref["sha256"] and
            re.fullmatch("[0-9a-f]{32}", str(proof.get("apiInvocation"))) is not None and
            proof.get("oldTenReadsPreserved") is True and proof.get("priorTwoTargetReadsPreserved") is True,
            "fresh_owned_feature_inverse_validation_required")
    return proof


def consumer_rollbacks(path, installs, feature):
    refs = json.loads(read(path))
    return consumer_rollback_refs(refs, installs, feature)


def consumer_rollback_refs(refs, installs, feature):
    require(set(refs) == set(INSTALL_UNITS) | {"booster"} and set(installs) == set(INSTALL_UNITS),
            "feature_and_all_four_consumer_owner_rollback_receipts_required")
    for name in INSTALL_UNITS:
        receipt = document(refs[name])
        require(receipt.get("format") == CONSUMER_FORMAT and receipt.get("rollbackApplied") is True and
                receipt.get("roleStateRestored") is True and receipt.get("roleLoginAfter") is (name == "collector") and
                receipt.get("installResultSha256") == installs[name]["sha256"] and
                receipt.get("ownedBoosterReader", {}).get("apiInvocation") == feature["apiInvocation"] and
                receipt.get("unit") == INSTALL_UNITS[name], "actual_consumer_owner_rollback_required_before_legacy_restart")
        current = idle(unit(INSTALL_UNITS[name]))
        require(active(current) and current["InvocationID"] == receipt.get("restoredInvocation"),
                "restored_consumer_must_still_be_current")
    return refs


def rollback_state(directory):
    directory = Path(directory)
    require(directory.parent == EVIDENCE and re.fullmatch("[a-z][a-z0-9-]{0,47}", directory.name), "owned_evidence_directory_required")
    binding = json.loads(read(directory / "review.json"))
    require(not os.path.lexists(directory / "rollback-intent.json"), "one_explicit_owned_rollback_required")
    require(Path("/proc/sys/kernel/random/boot_id").read_text().strip() == binding["plan"]["sourceRuntime"]["bootId"],
            "same_recorded_handover_boot_required")
    installed = json.loads(read(directory / "install-intent.json"))["files"] if (directory / "install-intent.json").exists() else {}
    current = unit(UNIT)
    process_file = "restart-process.json" if any((directory / name).exists() for name in
        ("restart-process.json", "restart-process-intent.json")) else "started-process.json"
    started = json.loads(read(directory / process_file)) if (directory / process_file).exists() else None
    reconciled = None
    if active(current):
        allowed = started if started is not None else binding["writers"][UNIT] if not installed else None
        if allowed is None:
            intent_file = next((directory / name for name in ("restart-process-intent.json", "started-process-intent.json")
                                if (directory / name).exists()), None)
            require(intent_file is not None, "foreign_shared_process_blocks_rollback")
            intent = json.loads(read(intent_file))
            require(intent["definitions"] == installed, "owned_installed_shared_start_intent_required")
            reconciled = shared_start_identity(current, intent)
            allowed = current
        require(allowed is not None and current["InvocationID"] == allowed["InvocationID"] and
                current["process"] == allowed["process"], "foreign_shared_process_blocks_rollback")
    if installed:
        # A failure midway through the atomic per-file installs is recoverable.
        # Every present file must still be either the exact original or owned replacement.
        originals = binding["definitions"][UNIT]
        actual = definitions(current)
        require(set(actual) <= set(originals) | set(installed), "foreign_definition_blocks_rollback")
        for path in set(originals) | set(installed):
            if os.path.lexists(path):
                require(sha(read(path)) in {originals.get(path), installed.get(path)}, "foreign_definition_blocks_rollback")
        dropdir = Path("/etc/systemd/system/" + UNIT + ".d")
        require(set(str(p) for p in dropdir.glob("*.conf")) <= set(originals) | set(installed),
                "unknown_dropin_blocks_rollback")
    before = native()["active"]
    selected = json.loads(read(directory / "selected-pointer.json")) if (directory / "selected-pointer.json").exists() else None
    selection_reconciled = False
    if selected is None and (directory / "selector-intent.json").exists() and before != binding["priorPointer"]:
        intent = json.loads(read(directory / "selector-intent.json"))
        selected = committed_selector_intent(binding, intent, before)
        selection_reconciled = True
    require(before == (selected if selected is not None else binding["priorPointer"]), "source_selection_changed_blocks_rollback")
    source = idle(unit(SOURCE_UNIT))
    require(definitions(source) == binding["definitions"][SOURCE_UNIT], "recorded_source_definitions_required_for_inverse")
    if active(source):
        require(source == binding["source"] and definitions(source) == binding["definitions"][SOURCE_UNIT],
                "only_exact_recorded_source_runtime_may_be_quiesced")
    solana_writer = idle(unit("yunipals-solana.service"))
    require(definitions(solana_writer) == binding["definitions"]["yunipals-solana.service"],
            "recorded_solana_definitions_required_for_inverse")
    if active(solana_writer):
        require(solana_writer == binding["writers"]["yunipals-solana.service"],
                "only_exact_recorded_solana_writer_may_be_quiesced")
    return {"format": FORMAT, "directory": str(directory), "shared": current, "source": source,
            "solanaWriter": solana_writer, "installed": installed,
            "sharedStartReconciledForStopOnly": reconciled,
            "selectorCommitReconciledForInverseOnly": selection_reconciled,
            "selectedPointer": selected, "originalReviewHash": sha(encode(binding)),
            "restartOriginalWriters": [name for name in LEGACY if active(binding["writers"][name])],
            "expiredTemporarySourceWillNotRestart": True, "databaseRestoreAllowed": False}


def combined_quiet():
    states = {}
    for name in (UNIT, SOURCE_UNIT):
        current = idle(unit(name))
        require(current["ActiveState"] in {"inactive", "failed"} and current["MainPID"] == "0" and
                current["process"] is None, "combined_and_shared_must_be_terminal_before_feature_inverse")
        group = Path("/sys/fs/cgroup/system.slice") / name / "cgroup.procs"
        require(not group.exists() or not group.read_text().strip(), "combined_and_shared_cgroups_must_be_empty")
        states[name] = {key: current[key] for key in ("InvocationID", "ActiveState", "MainPID")}
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(1)
        require(connection.connect_ex(("127.0.0.1", 9024)) == errno.ECONNREFUSED, "combined_and_shared_listener_must_be_closed")
    return {"units": states, "port9024Closed": True}


def rollback_quiesce(directory, expected=None):
    directory = Path(directory)
    checked = rollback_state(directory)
    require(not os.path.lexists(directory / "rollback-quiesce-result.json"), "one_owned_rollback_quiesce_required")
    pending = os.path.lexists(directory / "rollback-quiesce-intent.json")
    if pending:
        # A process may have stopped successfully before its ACK was written.
        # Confirm only the terminal result of that exact intent; never repeat a
        # manager command or adopt a different invocation as its completion.
        intent = json.loads(read(directory / "rollback-quiesce-intent.json"))
        require(intent["originalReviewHash"] == checked["originalReviewHash"], "owned_quiesce_intent_required")
        for key in ("solanaWriter", "source", "shared"):
            actual, saved = checked[key], intent[key]
            require(actual["MainPID"] == "0" and actual["process"] is None and
                    actual["ActiveState"] in {"inactive", "failed"} and
                    actual["InvocationID"] in {saved["InvocationID"], ""} and gone(saved["process"]),
                    "only_terminal_owned_quiesce_can_be_confirmed_without_repeating_actions")
        checked = {**checked, "confirmStoppedIntentSha256": sha(read(directory / "rollback-quiesce-intent.json"))}
    digest = sha(encode(checked))
    if expected is None:
        return {"format": FORMAT, "reviewHash": digest, "binding": checked}
    require(expected == digest, "exact_fresh_rollback_quiesce_review_required")
    if not pending:
        save(directory / "rollback-quiesce-intent.json", checked)
        for name, saved in (("yunipals-solana.service", checked["solanaWriter"]),
                            (SOURCE_UNIT, checked["source"]), (UNIT, checked["shared"])):
            stop_owned(name, saved)
    quiet = combined_quiet()
    snapshot = native()
    binding = json.loads(read(directory / "review.json"))
    selected = checked["selectedPointer"] if checked["selectedPointer"] is not None else binding["priorPointer"]
    native_identity(snapshot, selected=selected, running=False)
    latest = solana()
    require(latest["workerLock"] == {"granted": 0, "waiting": 0}, "shared_solana_worker_must_be_completely_stopped")
    result = {"format": FORMAT, "quiesced": True, "originalReviewHash": checked["originalReviewHash"],
              "sourceSelectionChanged": False, "originalWritersStarted": False, "quiet": quiet,
              "native": snapshot, "latestSolana": latest, "automaticRetryAllowed": False}
    return {**result, "receiptSha256": save(directory / "rollback-quiesce-result.json", result)}


def rollback_review(directory, consumer_file):
    directory = Path(directory)
    checked = rollback_state(directory)
    binding = json.loads(read(directory / "review.json"))
    quiesced = json.loads(read(directory / "rollback-quiesce-result.json"))
    require(quiesced.get("format") == FORMAT and quiesced.get("quiesced") is True and
            quiesced.get("originalReviewHash") == checked["originalReviewHash"], "actual_owned_rollback_quiesce_required")
    combined_quiet()
    stopped_solana_unchanged(quiesced["latestSolana"], solana(quiesced["latestSolana"]["ledgerPrefix"]["throughId"]))
    refs = json.loads(read(consumer_file))
    require(set(refs) == set(INSTALL_UNITS) | {"booster"}, "feature_and_all_four_consumer_owner_rollback_receipts_required")
    feature = feature_inverse(refs["booster"], binding["plan"]["boosterRetirement"]["sha256"])
    restored_consumers = consumer_rollbacks(consumer_file, binding["consumerInstalls"], feature)
    selected = checked["selectedPointer"] if checked["selectedPointer"] is not None else binding["priorPointer"]
    native_identity(native(), selected=selected, running=False, restored_booster=feature)
    return {**checked, "consumerRollbacks": restored_consumers, "featureInverse": feature,
            "stoppedSolana": quiesced["latestSolana"],
            "quiesceResultSha256": sha(read(directory / "rollback-quiesce-result.json"))}


def rollback_review_hash(checked):
    # The old booster keeps indexing during an inverse review. Bind its exact
    # actor/config/receipt authority while rechecking its advancing native
    # coverage and bounded pool on every review/apply. Routine progress cannot
    # turn an already reviewed process into a different owned process.
    feature = checked.get("featureInverse", {})
    source = feature.get("source")
    if not isinstance(source, dict):
        return sha(encode(checked))
    stable_source = {key: value for key, value in source.items() if key not in {"completeBlock", "sourceRoleSessions"}}
    return sha(encode({**checked, "featureInverse": {**feature, "source": stable_source}}))


def rollback(directory, expected, consumer_file):
    directory = Path(directory)
    checked = rollback_review(directory, consumer_file)
    require(rollback_review_hash(checked) == expected, "exact_fresh_rollback_review_required")
    binding = json.loads(read(directory / "review.json"))
    save(directory / "rollback-intent.json", checked)
    combined_quiet()
    if checked["selectedPointer"] is not None:
        quiet = native()
        native_identity(quiet, selected=checked["selectedPointer"], running=False, restored_booster=checked["featureInverse"])
    latest = solana()
    if checked["installed"]:
        require(latest["workerLock"] == {"granted": 0, "waiting": 0}, "shared_solana_worker_must_be_completely_stopped")
    stopped_solana_unchanged(checked["stoppedSolana"], latest)
    save(directory / "rollback-latest-solana.json", latest)
    originals = json.loads(read(directory / "originals.json"))
    if checked["installed"]:
        for path in checked["installed"]:
            if path not in originals and os.path.lexists(path):
                Path(path).unlink()
        for path, ref in originals.items():
            raw = read(ref["file"])
            require(sha(raw) == ref["sha256"], "original_definition_backup_changed")
            replace(path, raw, ref["mode"])
        run(["/usr/bin/systemctl", "daemon-reload"])
        require(definitions(unit(UNIT)) == binding["definitions"][UNIT], "original_unit_restore_not_acknowledged")
    if checked["selectedPointer"] is not None:
        require(sql(restore_pointer_sql(checked["selectedPointer"], binding["priorPointer"]), write=True) == binding["priorPointer"],
                "owned_source_selector_restore_failed")
    source_boot_restored = restore_source_boot(binding, directory)
    restore_legacy_boot_links(binding, directory)
    return finish_rollback_legacy(directory, binding, checked, latest, source_boot_restored)


def finish_rollback_legacy(directory, binding, checked, latest, source_boot_restored):
    # Exact four boot identities are restored before any one-time legacy start.
    legacy_boot_links_restored(binding, directory)
    for name in LEGACY:
        old = binding["writers"][name]["UnitFileState"]
        if name not in LEGACY_BOOT_UNITS and old in {"enabled", "disabled"}:
            run(["/usr/bin/systemctl", "enable" if old == "enabled" else "disable", name], manager=True)
    if checked["installed"]:
        stopped_solana_unchanged(latest, solana(latest["ledgerPrefix"]["throughId"]))
    restarted = {}
    for name in checked["restartOriginalWriters"]:
        current = unit(name)
        if active(current):
            require(current == binding["writers"][name], "foreign_original_writer_blocks_rollback")
            continue
        require(current["process"] is None and definitions(current) == binding["definitions"][name], "original_writer_definition_and_absence_required")
        save(directory / ("rollback-start-intent-" + name + ".json"), {"unit": name, "prior": current,
             "definitions": binding["definitions"][name], "originalReviewHash": sha(encode(binding))})
        run(["/usr/bin/systemctl", "start", "--no-block", name], manager=True)
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            current = unit(name)
            if active(current):
                restarted[name] = current
                save(directory / ("rollback-started-" + name + ".json"), current)
                break
            require(current["ActiveState"] != "failed", "original_writer_restore_start_failed")
            time.sleep(1)
        else:
            fail("original_writer_restore_observation_deadline")
    after = solana(latest["ledgerPrefix"]["throughId"])
    prefix_preserved(latest, after)
    value = {"format": FORMAT, "rolledBack": True, "originalWriters": restarted,
             "latestSolanaPreserved": after, "priorNormalSourceProcessRestarted": False, "databaseRestored": False,
             "ownedBoosterSourceRestored": True,
             "featureInverseReceiptSha256": checked["consumerRollbacks"]["booster"]["sha256"],
             "normalSourceBootRestored": source_boot_restored,
             "chargedUsageReset": False, "automaticRetryAllowed": False}
    return {"format": FORMAT, "rolledBack": True, "receiptSha256": save(directory / "rollback-result.json", value)}


def rollback_boot_finish_review(directory):
    # Narrow continuation only at the interrupted boot-restore boundary: old
    # definitions AND selector are already restored; no legacy start may have
    # been attempted. It cannot rerun the full inverse or repeat a writer start.
    directory = Path(directory)
    require(directory.parent == EVIDENCE and re.fullmatch("[a-z][a-z0-9-]{0,47}", directory.name), "owned_evidence_directory_required")
    binding = json.loads(read(directory / "review.json"))
    pending_raw = read(directory / "rollback-intent.json")
    pending = json.loads(pending_raw)
    require(pending.get("format") == FORMAT and pending.get("originalReviewHash") == sha(encode(binding)) and
            Path("/proc/sys/kernel/random/boot_id").read_text().strip() == binding["plan"]["sourceRuntime"]["bootId"] and
            not os.path.lexists(directory / "rollback-result.json") and
            any(os.path.lexists(directory / (prefix + "-restore-intent.json")) for prefix in
                ("normal-source-boot", *("legacy-boot-" + name for name in LEGACY_BOOT_UNITS))), "actual_interrupted_owned_boot_inverse_required")
    require(not any((directory / ("rollback-start-intent-" + name + ".json")).exists() for name in LEGACY),
            "boot_finish_cannot_repeat_any_legacy_start")
    require(native()["active"] == binding["priorPointer"], "original_selector_must_already_be_restored_for_boot_finish")
    combined_quiet()
    for name in (*LEGACY, SOURCE_UNIT):
        current = idle(unit(name))
        require(current["MainPID"] == "0" and current["process"] is None and
                current["ActiveState"] in {"inactive", "failed"} and definitions(current) == binding["definitions"][name],
                "only_original_terminal_writers_allowed_at_boot_finish")
    for path in pending["installed"]:
        require(path in binding["definitions"][UNIT] or not os.path.lexists(path), "owned_shared_overlays_must_already_be_removed")
    feature = feature_inverse(pending["consumerRollbacks"]["booster"], binding["plan"]["boosterRetirement"]["sha256"])
    consumer_rollback_refs(pending["consumerRollbacks"], binding["consumerInstalls"], feature)
    native_identity(native(), selected=binding["priorPointer"], running=False, restored_booster=feature)
    latest = solana(pending["stoppedSolana"]["ledgerPrefix"]["throughId"])
    stopped_solana_unchanged(pending["stoppedSolana"], latest)
    return {**pending, "featureInverse": feature, "bootFinishPendingSha256": sha(pending_raw)}


def rollback_boot_finish(directory, expected):
    directory = Path(directory)
    checked = rollback_boot_finish_review(directory)
    require(rollback_review_hash(checked) == expected, "exact_fresh_owned_boot_finish_review_required")
    intent = directory / "rollback-boot-finish-intent.json"
    authority = {"originalReviewHash": checked["originalReviewHash"], "pendingSha256": checked["bootFinishPendingSha256"]}
    if os.path.lexists(intent):
        require(json.loads(read(intent)) == authority, "only_same_owned_boot_finish_may_continue")
    else:
        save(intent, authority)
    binding = json.loads(read(directory / "review.json"))
    restored = restore_source_boot(binding, directory)
    restore_legacy_boot_links(binding, directory)
    return finish_rollback_legacy(directory, binding, checked, checked["stoppedSolana"], restored)


def retire(directory, expected=None):
    binding, result, current = current_handover(directory)
    original = json.loads(read(Path(directory) / "result.json"))
    publication = json.loads(read(Path(directory) / "scheduled-publication.json"))
    require(publication.get("scheduledPublicationAccepted") is True and publication.get("invocation") == original["shared"]["InvocationID"],
            "ordinary_scheduled_publication_ack_required_before_retirement")
    restart = json.loads(read(Path(directory) / "restart-result.json"))
    require(restart.get("restartAccepted") is True, "actual_basic_restart_acceptance_required_before_retirement")
    started = original["shared"]["process"]["startTicks"] / os.sysconf("SC_CLK_TCK")
    require(time.monotonic() - started >= 86400, "agreed_24_hour_observation_window_still_pending")
    states = {name: unit(name) for name in WRITERS if name != UNIT}
    require(all(v["process"] is None and v["ActiveState"] in {"inactive", "failed"} for v in states.values()),
            "old_writer_must_remain_stopped_before_retirement")
    checked = {"format": FORMAT, "invocation": current["InvocationID"],
               "originalEnableStates": {name: binding["writers"][name]["UnitFileState"] for name in LEGACY},
               "disableUnits": [name for name in LEGACY if name != UNIT and binding["writers"][name]["UnitFileState"] == "enabled"],
               "enableSharedUnit": UNIT}
    digest = sha(encode(checked))
    if expected is None:
        return {"format": FORMAT, "retirementReviewHash": digest, "binding": checked}
    require(expected == digest, "exact_fresh_retirement_review_required")
    save(Path(directory) / "retirement-intent.json", checked)
    for name in checked["disableUnits"]:
        if unit(name)["UnitFileState"] != "disabled":
            run(["/usr/bin/systemctl", "disable", name], manager=True)
    run(["/usr/bin/systemctl", "enable", UNIT], manager=True)
    require(unit(UNIT)["UnitFileState"] == "enabled" and all(unit(name)["UnitFileState"] == "disabled"
            for name in checked["disableUnits"]), "actual_boot_activation_retirement_required")
    return {"format": FORMAT, "retired": True, "receiptSha256": save(Path(directory) / "retirement-result.json", checked)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["review", "apply", "observe", "restart-review", "restart-test",
        "rollback-quiesce-review", "rollback-quiesce", "rollback-review", "rollback", "rollback-boot-review", "rollback-boot-finish", "retire-review", "retire"])
    parser.add_argument("--plan")
    parser.add_argument("--directory")
    parser.add_argument("--review-hash")
    parser.add_argument("--consumer-rollbacks")
    args = parser.parse_args()
    os.environ.clear()
    os.environ.update(ENV)
    require(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "root_on_fixed_production_host_required")
    account = pwd.getpwnam("yunipals_unified_shadow")
    require((account.pw_uid, account.pw_gid) == (970, 964), "existing_source_identity_required")
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(900)
    with locks():
        if args.action in {"review", "apply"}:
            require(args.plan is not None and args.directory is None, "plan_required")
            plan = json.loads(read(args.plan))
            if args.action == "review":
                binding = review(plan)
                value = {"format": FORMAT, "reviewHash": sha(encode(binding)), "binding": binding, "applied": False}
            else:
                value = apply(plan, args.review_hash)
        else:
            require(args.directory is not None and args.plan is None, "owned_directory_required")
            if args.action == "observe":
                value = observe(args.directory)
            elif args.action in {"restart-review", "restart-test"}:
                value = restart_test(args.directory, args.review_hash if args.action == "restart-test" else None)
            elif args.action in {"rollback-quiesce-review", "rollback-quiesce"}:
                value = rollback_quiesce(args.directory, args.review_hash if args.action == "rollback-quiesce" else None)
            elif args.action == "rollback-review":
                require(args.consumer_rollbacks is not None, "actual_consumer_rollback_file_required")
                binding = rollback_review(args.directory, args.consumer_rollbacks)
                value = {"format": FORMAT, "reviewHash": rollback_review_hash(binding), "binding": binding}
            elif args.action == "rollback":
                require(args.consumer_rollbacks is not None, "actual_consumer_rollback_file_required")
                value = rollback(args.directory, args.review_hash, args.consumer_rollbacks)
            elif args.action in {"rollback-boot-review", "rollback-boot-finish"}:
                if args.action == "rollback-boot-review":
                    binding = rollback_boot_finish_review(args.directory)
                    value = {"format": FORMAT, "reviewHash": rollback_review_hash(binding), "binding": binding}
                else:
                    value = rollback_boot_finish(args.directory, args.review_hash)
            else:
                value = retire(args.directory, args.review_hash if args.action == "retire" else None)
        print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    main()
