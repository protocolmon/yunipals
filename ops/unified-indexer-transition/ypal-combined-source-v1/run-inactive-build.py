#!/usr/bin/env python3
"""Run the frozen, network-isolated production build once; never start an ingestor."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shlex
import stat
import subprocess

STAGE = Path("/opt/yunipals-unified/operations/free-replay-20261020/ypal-combined-source-v1-stage")
PLAN_SHA = "ad60dfc787f29facb485cea4ac2d4a4f65058867415241e796816d620a393bd0"
LOCAL_BUILD_SHA = "c73ab57191e50bc50296a9a177942f90c012e88d3bec764b37f36f4124132bde"
BASE = Path("/var/backups/yunipals-combined-source-inactive-build-v1-20261023")
PROBE = Path("/var/lib/yunipals-unified-ypal/combined-v1-inactive-probe")
RUNTIME = PROBE.parent / "combined-v1-source008"
PROJECT = Path("/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer")
RELEASE = Path("/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6")
TSX_LINK = RELEASE / "apps/yunipals-market-api/node_modules/tsx"
TSX_TARGET = "../../../node_modules/.pnpm/tsx@4.23.15/node_modules/tsx"
UNITS = {
    "yunipals-unified-source6-free-v2.service": ("716994", "c3463c9a2e1240e8890e318ba1360cf4"),
    "yunipals-booster-ypal-source.service": ("2309283", "3744d80464924b5ca1de340ac94c1034"),
    "yunipals-booster-api.service": ("2334701", "3a3b4014f75b4db9968f4c5ee26fa904"),
    "yunipals-ypal-base-rpc.service": ("2238064", "76e58064c4544d69a2a7b090b1102a01"),
    **{"yunipals-market-production-rpc@" + c + ".service": None for c in ("ethereum", "base", "polygon", "bnb")}
}
FIELDS = ["Id", "LoadState", "ActiveState", "SubState", "MainPID", "InvocationID", "Job", "FragmentPath", "DropInPaths", "NRestarts", "ExecMainStartTimestampMonotonic"]
PEER = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs"]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def protected(path):
    path = Path(path)
    for p in [*path.parents, path]:
        s = p.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, "protected_public_path_required")
    before = path.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_size <= 2_000_000, "bounded_public_file_required")
    raw = path.read_bytes()
    after = path.stat()
    need((before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "public_file_changed_during_read")
    return raw


def save(name, value):
    raw = (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()
    fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    fd = os.open(BASE, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(fd)
    os.close(fd)
    return sha(raw)


def dependency(path):
    if Path(path) != TSX_LINK / "dist/loader.mjs":
        return protected(path)
    for p in TSX_LINK.parents:
        s = p.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, "protected_dependency_parent_required")
    s = TSX_LINK.lstat()
    need(s.st_uid == 0 and stat.S_ISLNK(s.st_mode) and os.readlink(TSX_LINK) == TSX_TARGET, "exact_retained_tsx_package_link_required")
    resolved = RELEASE / "node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs"
    need(Path(path).resolve(strict=True) == resolved, "exact_retained_tsx_resolution_required")
    return protected(resolved)


def command(argv, timeout=20):
    r = subprocess.run(argv, capture_output=True, timeout=timeout, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}, cwd="/")
    need(r.returncode == 0 and not r.stderr and len(r.stdout) < 2_000_000, "bounded_read_command_failed")
    return r.stdout


def namespace_absent():
    sentinel = "/run/yunipals-combined-inactive-no-password-file"
    need(not os.path.lexists(sentinel), "absent_peer_password_file_required")
    # Supply the one fixed read through stdin; no SQL from a caller is accepted.
    argv = [*PEER, "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "PGPASSFILE=" + sentinel,
            "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
            "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql", "-p", "5432", "-U", "postgres", "-d", "yunipals_backfill", "-v", "ON_ERROR_STOP=1"]
    sql = b"BEGIN READ ONLY; SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname='unified_ypal_20261023_v1'; ROLLBACK;"
    r = subprocess.run(argv, input=sql, capture_output=True, timeout=10, env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}, cwd="/")
    need(r.returncode == 0 and not r.stderr and r.stdout == b"0\n", "new_native_namespace_must_remain_absent")


def snapshot():
    namespace_absent()
    actors = {}
    for unit, expected in UNITS.items():
        raw = command(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in FIELDS]])
        s = dict(line.split("=", 1) for line in raw.decode().splitlines())
        need(set(s) == set(FIELDS) and s["Id"] == unit and s["ActiveState"] == "active" and s["SubState"] == "running" and s["Job"] in {"", "0"}, "original_service_must_be_running")
        if expected:
            need((s["MainPID"], s["InvocationID"]) == expected, "same_acknowledged_original_actor_required")
        process = (Path("/proc") / s["MainPID"] / "stat").read_text()
        s["startTicks"] = int(process[process.rfind(")") + 2:].split()[19])
        s["definitions"] = {p: sha(protected(p)) for p in [s["FragmentPath"], *shlex.split(s["DropInPaths"])]}
        actors[unit] = s
    files = {str(p): sha(protected(p)) for p in [PROJECT / "ponder.config.ts", PROJECT / "lib/boosters/config.ts", PROJECT / "lib/unified/rpc-preflight.ts"]}
    need(not os.path.lexists(RUNTIME), "future_runtime_area_must_remain_absent")
    return {"actors": actors, "files": files, "newNativeNamespaceAbsent": True, "runtimeAreaAbsent": True}


def main():
    a = argparse.ArgumentParser(description=__doc__)
    a.add_argument("--plan", required=True, type=Path)
    args = a.parse_args()
    need(os.geteuid() == os.getegid() == 0 and os.uname().nodename == "yunipals-main", "fixed_root_production_host_required")
    os.umask(0o077)
    raw = protected(args.plan)
    need(sha(raw) == PLAN_SHA, "exact_reviewed_inactive_plan_required")
    plan = json.loads(raw)
    need(plan["area"] == str(PROBE) and plan["publicStage"] == str(STAGE), "fixed_probe_paths_required")
    for path, pin in plan["requiredProtectedDependencies"].items():
        need(sha(dependency(path)) == pin, "exact_retained_dependency_required")
    for name, pin in plan["sourceFiles"].items():
        if name == "prepare.py":
            continue  # The renderer is not executed by this production probe.
        flat = name.removeprefix("payload/")
        need(sha(protected(STAGE / flat)) == pin, "exact_staged_build_input_required")
    local_raw = protected(STAGE / "local-build.json")
    need(sha(local_raw) == LOCAL_BUILD_SHA, "actual_frozen_local_build_receipt_required")
    local = json.loads(local_raw)
    need(not BASE.exists() and not os.path.lexists(PROBE), "existing_probe_requires_inspection_never_retry")
    transient = dict(x.split("=", 1) for x in command(["/usr/bin/systemctl", "show", "--all", plan["unit"], "--property=LoadState", "--property=ActiveState", "--property=MainPID", "--property=Job"]).decode().splitlines())
    need(transient == {"LoadState": "not-found", "ActiveState": "inactive", "MainPID": "0", "Job": ""}, "fresh_absent_transient_probe_required")
    filesystem = os.statvfs("/")
    need(filesystem.f_bavail * filesystem.f_frsize >= 25 * 1024**3, "existing_root_disk_reserve_required")
    account = pwd.getpwnam("yunipals_unified_shadow")
    need((account.pw_uid, account.pw_gid) == (970, 964), "same_existing_source_account_required")
    before = snapshot()
    BASE.mkdir(mode=0o700)
    fd = os.open(BASE.parent, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(fd)
    os.close(fd)
    save("intent.json", {"format": "yunipals-combined-inactive-build-intent-v1", "operatorSha256": sha(protected(Path(__file__).absolute())), "planSha256": PLAN_SHA, "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(), "before": before})
    if not PROBE.parent.exists():
        PROBE.parent.mkdir(mode=0o755)
        PROBE.parent.chmod(0o755)
    parent = PROBE.parent.lstat()
    need(parent.st_uid == 0 and stat.S_ISDIR(parent.st_mode) and stat.S_IMODE(parent.st_mode) == 0o755, "protected_existing_probe_parent_required")
    PROBE.mkdir(mode=0o755)
    PROBE.chmod(0o755)
    for name in ["cache", "cache/.ponder", "cache/.vite-temp"]:
        p = PROBE / name
        p.mkdir(mode=0o750)
        p.chmod(0o750)
        os.chown(p, 970, 964)
    p = PROBE / "cache/ponder-env.d.ts"
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    os.fchown(fd, 970, 964)
    os.fsync(fd)
    os.close(fd)
    r = subprocess.run(plan["argv"], capture_output=True, timeout=150, cwd="/", env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"})
    need(len(r.stdout) + len(r.stderr) <= 2_000_000, "bounded_build_output_required")
    save("command-result.json", {"returncode": r.returncode, "stdout": r.stdout.decode(errors="replace"), "stderr": r.stderr.decode(errors="replace")})
    after = snapshot()
    need(before == after, "original_services_or_files_changed_during_inactive_probe")
    need(r.returncode == 0 and not r.stderr, "inactive_build_failed_inspect_owned_command_result")
    lines = r.stdout.decode().splitlines()
    need(len(lines) == 1, "one_actual_build_ack_required")
    actual = json.loads(lines[0])
    need(all(actual[k] == v for k, v in plan["expected"].items()) and actual["contracts"] == local["contracts"], "actual_host_build_must_match_reviewed_build")
    value = {"format": "yunipals-combined-inactive-production-build-v1", "completed": True, "planSha256": PLAN_SHA, "actual": actual, "originalActorsAndFilesUnchanged": True, "newNativeNamespaceAbsent": True, "runtimeAreaAbsent": True, "sourceStarts": 0, "providerCalls": 0, "databaseWrites": 0}
    pin = save("result.json", value)
    print(json.dumps({**value, "protectedResultSha256": pin}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"completed": False, "errorClass": type(e).__name__, "fixedCode": str(e) if isinstance(e, RuntimeError) else "private_diagnostics_withheld"}))
        raise SystemExit(1)
