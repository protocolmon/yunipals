#!/usr/bin/env python3
"""One finite, free-only resume of the observed V8 OOM; no database writes.

Review prints a current-state hash. Apply adds only a volatile systemd drop-in
and starts the existing source once. Restore stops that exact new invocation,
removes the owned drop-in, and leaves the crashed original definition stopped.
No historical operators are imported and no paid authority is created.
"""
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
import urllib.request

FORMAT = "yunipals-source6-heap-resume"
UNIT = "yunipals-unified-source6-free-v2.service"
OLD_INVOCATION = "2bfcf40e5b054e9c943dd54dca8fc824"
BOOT = "d1330112-af72-4b2e-a542-25504553ff5e"
UNIT_SHA = "d678a740b3c182f8ac71e3c81baba545477d97a75a09c74ea552eaab50f9d7a3"
SOURCE = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
RELEASE = "0x35cdcb326c319a7732240185ca8d450734b41046d65017742f69385a0741f39c"
SCHEMA = "unified_shadow_20261020_7e7375b0"
BUILD = "bf4939b3ff"
MANIFEST = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029"
PROFILE_ID = "0xd059909e4c1f24cdfff8de08d7c0c63e4d27507343f6de357232ddba657fc728"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
WORK = Path("/var/lib/yunipals-unified-shadow/20261020-008028af-a")
BASE = Path("/var/backups/yunipals-source6-heap-resume-20261022")
ORIGINAL = Path("/etc/systemd/system") / UNIT
DROP = Path("/run/systemd/system") / (UNIT + ".d") / "90-heap-resume.conf"
NODE = "/opt/node-v24.18.1/bin/node"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
CHAINS = {"ethereum": (1, 19201), "base": (8453, 19202), "polygon": (137, 19203), "bnb": (56, 19204)}
INPUTS = {
    WORK / "launch.env": "feb8b0e9dd8cd55042d7c3722c83c37471dc702166fa27554f791f262dde6038",
    OPS / "source6-free-runtime-v2.env": "6abd96e429a3dd1b601727fb2f13bc57eb003e44549d54c82350126eabdd8dfe",
    OPS / "normal-rpc-profile-v1.json": "0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e",
    OPS / "source6-rpc-file-v3/rpc-preflight.ts": "68a0d4fd0442ecb464574434e1e349f1e4caf1c4ab2f0a70352f8b5f26afe833",
    OPS / "source6-selective-historical-v3/index.js": "ef63a19ec122a1eaeed6097882e8fe124bc196964d7979cb86f8b2ab658745f8",
    OPS / "source6-selective-historical-v3/yunipals-log-transactions.mjs": "c2892a2e8b6237cef969a7e70f7d029a08746b8afdb128120a0ca430efbb14aa",
    Path(NODE): "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a"
}
KEYS = ["Id", "LoadState", "ActiveState", "SubState", "Result", "MainPID", "InvocationID", "ExecMainCode", "ExecMainStatus", "ExecMainStartTimestampMonotonic", "User", "Group", "Restart", "NRestarts", "MemoryMax", "MemorySwapMax", "RuntimeMaxUSec", "LimitCORE", "FragmentPath", "DropInPaths", "ExecStart"]
BUS = ["/usr/bin/busctl", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager"]
SOURCE_LEASE = "/run/lock/yunipals-unified-shadow.lock"


def fail(code): raise RuntimeError(code)
def encode(v): return json.dumps(v, sort_keys=True, separators=(",", ":")).encode()
def sha(v): return hashlib.sha256(v).hexdigest()
def now(): return datetime.now(timezone.utc).isoformat()


def protected(path, maximum=40_000_000, *, source_generated=False):
    path = Path(path)
    for p in [*path.parents, path]:
        s = p.lstat()
        generated = source_generated and p == path and path == WORK / "apps/yunipals-indexer/ponder-env.d.ts" and s.st_uid == 970 and s.st_gid == 964 and stat.S_IMODE(s.st_mode) == 0o640
        if stat.S_ISLNK(s.st_mode) or (s.st_uid != 0 and not generated) or s.st_mode & 0o022:
            fail("protected_regular_input_required")
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or s.st_size > maximum: fail("bounded_input_required")
    if source_generated and s.st_uid == 970:
        # E0 has SETUID/GID but no DAC override. Read the one declared writable
        # public leaf as its existing owner, without chmod or broader authority.
        code = "import os,sys;f=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW);b=os.read(f,40000001);os.close(f);sys.stdout.buffer.write(b)"
        raw = run(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "/usr/bin/python3", "-I", "-B", "-c", code, str(path)], cap=maximum)
    else:
        raw = path.read_bytes()
    fingerprint = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_mode, x.st_uid, x.st_gid, x.st_mtime_ns, x.st_ctime_ns)
    if fingerprint(s) != fingerprint(path.stat()): fail("input_changed_during_read")
    return raw


def run(argv, *, data=None, timeout=15, cap=500_000):
    p = subprocess.run(argv, input=data, capture_output=True, env=ENV, timeout=timeout)
    if p.returncode or len(p.stdout) > cap: fail("bounded_command_failed_diagnostics_withheld")
    return p.stdout


def unit(name=UNIT):
    p = dict(l.split("=", 1) for l in run(["/usr/bin/systemctl", "show", "--all", name, *["--property=" + k for k in KEYS]]).decode().splitlines())
    command = re.findall(r"argv\[\]=(.*?)\s+;", p.pop("ExecStart"))
    if len(command) != 1: fail("one_source_command_required")
    p["command"] = command[0]
    return p


def argv():
    return ["/usr/bin/env", "-i", NODE, "--env-file=" + str(WORK / "launch.env"), "--env-file=" + str(OPS / "source6-free-runtime-v2.env"), str(WORK / "apps/yunipals-indexer/node_modules/ponder/dist/esm/bin/ponder.js"), "start", "--schema", SCHEMA, "--hostname", "127.0.0.1", "--port", "9024"]


def drop_bytes():
    command = argv(); command.insert(3, "--max-old-space-size=4096")
    return ("[Service]\nExecStart=\nExecStart=" + " ".join(command) + "\nMemoryMax=6442450944\nRuntimeMaxSec=14400\nLimitCORE=0\n").encode()


def query(sql, market=False):
    options = "-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000"
    args = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "/usr/bin/env", "-i", *[k + "=" + v for k, v in ENV.items()], "PGPASSFILE=/dev/null", "PGOPTIONS=" + options, "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql", "-p", "15438" if market else "5432", "-U", "postgres", "-d", "yunipals_market_production" if market else "yunipals_backfill", "-v", "ON_ERROR_STOP=1"]
    return json.loads(run(args, data=("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;\n" + sql + ";\nROLLBACK;\n").encode(), timeout=20))


def database(running=False):
    value = query("""SELECT jsonb_build_object(
      'role',(SELECT jsonb_build_object('oid',oid::text,'login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_shadow'),
      'memberships',(SELECT count(*)FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')OR roleid=(SELECT oid FROM pg_roles WHERE rolname='yunipals_unified_shadow')),
      'sourceSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_shadow'),
      'supportSessions',(SELECT count(*)FROM pg_stat_activity WHERE usename='yunipals_unified_support'),
      'supportRole',(SELECT jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'super',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit)FROM pg_roles WHERE rolname='yunipals_unified_support'),
      'activeSelectors',(SELECT count(*)FROM yunipals_indexer_control.active_release),
      'release',(SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifest',manifest_hash)FROM yunipals_indexer_control.release WHERE id='""" + RELEASE + """'),
      'runtime',(SELECT jsonb_build_object('version',value->>'version','build',value->>'build_id','dev',value->>'is_dev')FROM """ + SCHEMA + """._ponder_meta WHERE key='app'),
      'checkpoints',(SELECT jsonb_agg(jsonb_build_object('chain',chain_id,'latest',latest_checkpoint,'safe',safe_checkpoint,'finalized',finalized_checkpoint)ORDER BY chain_id)FROM """ + SCHEMA + "._ponder_checkpoint))")
    expected_role = {"oid": "73004621", "login": True, "inherit": False, "super": False, "createDb": False, "createRole": False, "replication": False, "bypassRls": False, "limit": 32}
    support_role = {k: v for k, v in expected_role.items() if k != "oid"}; support_role["limit"] = 16
    if value["role"] != expected_role or value["supportRole"] != support_role or value["memberships"] != 0 or value["activeSelectors"] != 0 or not (0 <= value["supportSessions"] <= 16 if running else value["supportSessions"] == 0) or not (0 <= value["sourceSessions"] <= 32 if running else value["sourceSessions"] == 0): fail("unchanged_source_writer_and_selection_required")
    if value["release"] != {"id": RELEASE, "schema": SCHEMA, "build": BUILD, "manifest": MANIFEST} or value["runtime"] != {"version": "6", "build": BUILD, "dev": "0"}: fail("exact_existing_native_identity_required")
    points = value["checkpoints"]
    if len(points) != 4 or {p["chain"] for p in points} != {1, 56, 137, 8453} or any(not isinstance(p[k], str) or not re.fullmatch("[0-9]{75}", p[k]) for p in points for k in ["latest", "safe", "finalized"]): fail("four_retained_checkpoints_required")
    return value


def inputs():
    for p, expected in INPUTS.items():
        if sha(protected(p, 200_000_000 if p == Path(NODE) else 40_000_000)) != expected: fail("exact_source_runtime_input_required")
    manifest = json.loads(protected(WORK / "RELEASE-MANIFEST.json"))
    rows = manifest.get("files")
    if manifest.get("sourceDigest") != SOURCE or sha((json.dumps(rows, indent=2, ensure_ascii=False) + "\n").encode()) != SOURCE or not isinstance(rows, list): fail("source008_manifest_required")
    seen = set()
    for row in rows:
        name = row["path"]
        if not re.fullmatch(r"[A-Za-z0-9@_./+-]+", name) or any(p in {"", ".", ".."} for p in name.split("/")) or name in seen: fail("safe_unique_source_path_required")
        seen.add(name); raw = protected(WORK / name, source_generated=name == "apps/yunipals-indexer/ponder-env.d.ts")
        if len(raw) != row["bytes"] or sha(raw) != row["sha256"]: fail("source008_bytes_changed")
    return {"sourceDigest": SOURCE, "sourceFiles": len(rows), "inputHashes": {str(p): v for p, v in INPUTS.items()}}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_): return None


def http(port, path, headers=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(urllib.request.Request("http://127.0.0.1:" + str(port) + path, headers=headers or {}), timeout=5) as r:
        raw = r.read(2_000_001)
        if r.status != 200 or len(raw) > 2_000_000: fail("bounded_loopback_response_required")
        return raw


def proxies():
    result = {}
    for name, (chain, port) in CHAINS.items():
        p = unit("yunipals-market-production-rpc@" + name + ".service")
        if p["ActiveState"] != "active" or p["SubState"] != "running" or int(p["MainPID"]) <= 1: fail("all_four_proxies_running_required")
        metrics = json.loads(http(port, "/metrics")); u = metrics.get("unified", {})
        if any(metrics.get(k) is not v for k, v in {"freeRouting": True, "paidFallbackOnFreeFailure": False, "sourcePaidFallbackOnFreeFailure": False}.items()) or u.get("profileId") != PROFILE_ID or u.get("chainId") != chain or u.get("sourceRouting") != "free_first": fail("existing_free_only_proxy_route_required")
        for workload in ["unified_source", "unified_evidence"]:
            if u.get("traffic", {}).get(workload, {}).get("paidCalls") != 0: fail("zero_source_and_evidence_paid_calls_required")
            gate = json.loads(http(port, "/unified/preflight", {"x-yunipals-unified-rpc-profile": PROFILE_ID, "x-yunipals-rpc-workload": workload}))
            if gate.get("profileId") != PROFILE_ID or gate.get("chainId") != chain or gate.get("manifestHash") != MANIFEST or gate.get("replay", {}).get("mode") != "free_only": fail("actual_free_only_gate_required")
        result[name] = {"invocation": p["InvocationID"], "pid": p["MainPID"], "commandSha256": sha(p["command"].encode()), "definitionHashes": {f: sha(protected(Path(f))) for f in [p["FragmentPath"], *p["DropInPaths"].split()]}}
    return result


def financial():
    state = query("SELECT jsonb_build_object('profile',EXISTS(SELECT 1 FROM yunipals_market.unified_rpc_profile WHERE profile_id='" + PROFILE_ID + "'AND enabled AND expires_at>clock_timestamp()AND manifest_hash='" + MANIFEST + "'),'activePermits',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE enabled AND expires_at>clock_timestamp()),'profilePermitRows',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id='" + PROFILE_ID + "'))", True)
    # Retain the two expired historical permit records from the completed paid
    # window. Their existence creates no active authority and is not a renewal.
    if state != {"profile": True, "activePermits": 0, "profilePermitRows": 2}: fail("existing_normal_profile_without_paid_authority_required")
    return state


def effective_environment():
    # Node loads --env-file internally after exec. Linux /proc/PID/environ does
    # not reliably expose those additions; audit the identical files/flags as970.
    code = "const e=process.env;if(e.UNIFIED_RPC_FREE_ONLY!=='true'||e.UNIFIED_RPC_POLICY_REQUIRED!=='true'||e.UNIFIED_RPC_PROFILE_ID!==" + json.dumps(PROFILE_ID) + "||Object.keys(e).some(k=>k.startsWith('UNIFIED_RPC_REPLAY_PERMIT_ID')&&e[k]))throw Error('free_only');console.log(JSON.stringify({freeOnly:true,uid:process.getuid(),gid:process.getgid(),heapLimit:require('node:v8').getHeapStatistics().heap_size_limit}));"
    command = ["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/env", "-i", NODE, "--max-old-space-size=4096", *argv()[3:5], "-e", code]
    value = json.loads(run(command, timeout=10))
    if value.get("freeOnly") is not True or value.get("uid") != 970 or value.get("gid") != 964 or not 4_000_000_000 <= value.get("heapLimit", 0) <= 4_600_000_000: fail("effective_free_only_environment_or_heap_required")
    return value


def job():
    path = "/org/freedesktop/systemd1/unit/" + re.sub(r"[^A-Za-z0-9]", lambda m: "_" + format(ord(m[0]), "02x"), UNIT)
    raw = run(["/usr/bin/busctl", "get-property", "org.freedesktop.systemd1", path, "org.freedesktop.systemd1.Unit", "Job"]).decode()
    match = re.fullmatch(r'\(uo\) ([0-9]+) "([^"]+)"\s*', raw)
    if not match or match[2] != ("/org/freedesktop/systemd1/job/" + match[1] if match[1] != "0" else "/"): fail("exact_source_job_required")
    return int(match[1])


def support():
    p = unit("yunipals-unified-support-source6-v2.service")
    if p["ActiveState"] not in {"failed", "inactive"} or p["MainPID"] != "0": fail("support_must_remain_stopped")
    return {k: p[k] for k in ["InvocationID", "ActiveState", "SubState", "MainPID"]}


def resources():
    info = dict(l.split(":", 1) for l in Path("/proc/meminfo").read_text().splitlines())
    available = int(info["MemAvailable"].split()[0]) * 1024
    fs = os.statvfs("/"); free = fs.f_bavail * fs.f_frsize
    if available < 12_000_000_000 or free < 30_000_000_000: fail("memory_or_disk_reserve_insufficient")
    return {"memoryAvailableBytes": available, "rootAvailableBytes": free}


def review():
    if os.geteuid() != 0 or os.uname().nodename != "yunipals-main" or Path("/proc/sys/kernel/random/boot_id").read_text().strip() != BOOT: fail("exact_root_host_and_boot_required")
    p = unit()
    if sha(protected(ORIGINAL)) != UNIT_SHA or p["DropInPaths"] or DROP.parent.exists() or job() != 0: fail("unchanged_original_unit_without_dropins_required")
    if p["InvocationID"] != OLD_INVOCATION or p["ActiveState"] != "failed" or p["Result"] != "core-dump" or p["MainPID"] != "0" or p["ExecMainStatus"] != "6" or p["command"] != " ".join(argv()): fail("exact_terminal_oom_invocation_required")
    value = {"format": FORMAT, "operatorSha256": sha(protected(Path(__file__).absolute())), "bootId": BOOT, "beforeUnit": p, "support": support(), "database": database(), "inputs": inputs(), "proxies": proxies(), "financial": financial(), "effectiveEnvironment": effective_environment(), "dropSha256": sha(drop_bytes()), "maximumRuntimeSeconds": 14400, "heapMiB": 4096, "cgroupMemoryBytes": 6442450944, "freeOnly": True, "paidAuthority": False, "databaseWrites": 0, "sourceSelectionsChanged": 0}
    capacity = resources()
    return {**value, "reviewHash": sha(encode(value)), "capacity": capacity, "observedAt": now()}


@contextmanager
def lease(path):
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(fd)
        # The retained source lock is root:root0644; proxy locks are0600.
        # Read access confers no write or exclusive-controller authority.
        expected_mode = 0o644 if path == SOURCE_LEASE else 0o600
        fingerprint = lambda x: (x.st_dev, x.st_ino, x.st_uid, x.st_gid, x.st_mode, x.st_nlink)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_gid != 0 or stat.S_IMODE(s.st_mode) != expected_mode or s.st_nlink != 1 or fingerprint(s) != fingerprint(os.stat(path, follow_symlinks=False)): fail("protected_existing_handover_lease_required")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if fingerprint(s) != fingerprint(os.fstat(fd)) or fingerprint(s) != fingerprint(os.stat(path, follow_symlinks=False)): fail("handover_lease_inode_changed")
        yield
    finally: os.close(fd)


def save(path, value):
    raw = encode(value) + b"\n"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as f: f.write(raw); f.flush(); os.fsync(f.fileno())
    except BaseException: raise
    return sha(raw)


def service_job(verb):
    if job(): fail("foreign_or_pending_service_job")
    raw = run([*BUS, verb + "Unit", "ss", UNIT, "fail"], timeout=8).decode()
    match = re.fullmatch(r'o "/org/freedesktop/systemd1/job/([1-9][0-9]*)"\s*', raw)
    if not match: fail("owned_service_job_response_required")
    owned = int(match[1]); save(BASE / (verb.lower() + "-job.json"), {"job": owned, "at": now()})
    until = time.monotonic() + 50
    while time.monotonic() < until:
        current = job()
        if current == 0: return
        if current != owned: fail("foreign_service_job_blocks_ack")
        time.sleep(0.25)
    fail("owned_service_job_not_yet_terminal_manual_reconcile")


def process_identity(p):
    pid = int(p["MainPID"])
    if pid <= 1: fail("running_source_pid_required")
    command = Path("/proc/" + str(pid) + "/cmdline").read_bytes().split(b"\0")[:-1]
    expected = argv()[2:]; expected.insert(1, "--max-old-space-size=4096")
    if command != [x.encode() for x in expected]: fail("exact_heap_source_process_command_required")
    status = dict(r.split(":", 1) for r in Path("/proc/" + str(pid) + "/status").read_text().splitlines() if ":" in r)
    if set(status["Uid"].split()) != {"970"} or set(status["Gid"].split()) != {"964"} or status["NoNewPrivs"].strip() != "1": fail("exact_unprivileged_source_process_required")
    return {"pid": pid, "startTicks": int(Path("/proc/" + str(pid) + "/stat").read_text().rpartition(")")[2].split()[19]), "invocation": p["InvocationID"], "startMonotonicMicroseconds": int(p["ExecMainStartTimestampMonotonic"])}


def running():
    p = unit(); command = argv(); command.insert(3, "--max-old-space-size=4096")
    if p["ActiveState"] != "active" or p["SubState"] != "running" or p["InvocationID"] == OLD_INVOCATION or p["command"] != " ".join(command) or p["MemoryMax"] != "6442450944" or p["RuntimeMaxUSec"] != "4h" or p["MemorySwapMax"] != "0" or p["LimitCORE"] != "0" or p["Restart"] != "no" or p["NRestarts"] != "0" or p["DropInPaths"] != str(DROP): fail("exact_finite_heap_runtime_required")
    if sha(protected(ORIGINAL)) != UNIT_SHA or protected(DROP) != drop_bytes() or job() != 0: fail("exact_owned_runtime_definitions_required")
    return process_identity(p)


def prepared():
    p = unit(); command = argv(); command.insert(3, "--max-old-space-size=4096")
    if p["MainPID"] != "0" or p["InvocationID"] != OLD_INVOCATION or p["ActiveState"] != "failed" or p["command"] != " ".join(command) or p["MemoryMax"] != "6442450944" or p["RuntimeMaxUSec"] != "4h" or p["LimitCORE"] != "0" or p["DropInPaths"] != str(DROP) or job() != 0: fail("exact_prepared_stopped_runtime_required")
    if sha(protected(ORIGINAL)) != UNIT_SHA or protected(DROP) != drop_bytes(): fail("unchanged_prepared_unit_inputs_required")


def apply(pin):
    with ExitStack() as stack:
        stack.enter_context(lease(SOURCE_LEASE))
        for name in sorted(CHAINS): stack.enter_context(lease("/run/lock/yunipals-free-replay-proxy-" + name + ".lock"))
        checked = review()
        if checked["reviewHash"] != pin or BASE.exists(): fail("fresh_exact_review_and_unused_operation_required")
        BASE.mkdir(mode=0o700)
        save(BASE / "review.json", checked)
        save(BASE / "intent.json", {"reviewHash": pin, "at": now(), "automaticRetryAllowed": False})
        try:
            DROP.parent.mkdir(mode=0o755)
            fd = os.open(DROP, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, "wb") as f: f.write(drop_bytes()); f.flush(); os.fsync(f.fileno())
            run(["/usr/bin/systemctl", "daemon-reload"])
            if database() != checked["database"] or support() != checked["support"] or proxies() != checked["proxies"] or financial() != checked["financial"]: fail("current_inputs_changed_before_start")
            prepared()
            service_job("Start")
            until = time.monotonic() + 90
            while True:
                identity = running()
                try:
                    if http(9024, "/health") != b"": fail("ponder_health_body_differs")
                    after = database(True)
                    if after["sourceSessions"] < 1:
                        if time.monotonic() >= until: fail("source_database_startup_not_acknowledged")
                        time.sleep(1); continue
                    break
                except (TimeoutError, OSError, urllib.error.URLError):
                    if time.monotonic() >= until: raise
                    time.sleep(1)
            if support() != checked["support"] or proxies() != checked["proxies"] or financial() != checked["financial"] or running() != identity: fail("runtime_or_proxy_changed_during_ack")
            before = {p["chain"]: p for p in checked["database"]["checkpoints"]}
            if any(p[k] < before[p["chain"]][k] for p in after["checkpoints"] for k in ["latest", "safe", "finalized"]): fail("saved_checkpoint_regressed")
            result = {"format": FORMAT, "reviewHash": pin, "runtime": identity, "expiresMonotonicMicroseconds": identity["startMonotonicMicroseconds"] + 14400_000_000, "beforeCheckpoints": checked["database"]["checkpoints"], "afterCheckpoints": after["checkpoints"], "proxies": checked["proxies"], "dropSha256": sha(drop_bytes()), "freeOnly": True, "paidAuthority": False, "databaseWrites": 0, "cacheRowsDeleted": 0, "sourceSelectionsChanged": 0, "at": now()}
            receipt = save(BASE / "runtime.json", result)
            return {"format": FORMAT, "started": True, "runtimeReceiptSha256": receipt, **result}
        except BaseException as error:
            save(BASE / "failed.json", {"errorClass": type(error).__name__, "manualReconcileRequired": True, "automaticRetryAllowed": False, "at": now()}); raise


def restore(pin):
    with lease(SOURCE_LEASE):
        raw = protected(BASE / "runtime.json")
        if sha(raw) != pin: fail("exact_runtime_receipt_required")
        receipt = json.loads(raw)
        if running() != receipt["runtime"]: fail("only_owned_source_invocation_may_be_stopped")
        save(BASE / "restore-intent.json", {"runtimeReceiptSha256": pin, "at": now()})
        service_job("Stop")
        p = unit()
        if p["MainPID"] != "0" or p["InvocationID"] != receipt["runtime"]["invocation"] or p["ActiveState"] not in {"inactive", "failed"}: fail("owned_source_not_terminal")
        database(); support()
        if protected(DROP) != drop_bytes() or sha(protected(ORIGINAL)) != UNIT_SHA: fail("owned_dropin_only_restore_required")
        DROP.unlink(); DROP.parent.rmdir(); run(["/usr/bin/systemctl", "daemon-reload"])
        p = unit()
        if p["MainPID"] != "0" or p["DropInPaths"] or p["command"] != " ".join(argv()) or p["MemoryMax"] != "2147483648": fail("original_stopped_definition_not_restored")
        result = {"format": FORMAT, "restored": True, "originalDefinitionSha256": UNIT_SHA, "sourceRemainsStopped": True, "databaseWrites": 0, "checkpointOrCacheRollback": False, "at": now()}
        save(BASE / "restored.json", result); return result


def validate(pin):
    raw = protected(BASE / "runtime.json")
    if sha(raw) != pin: fail("exact_runtime_receipt_required")
    receipt = json.loads(raw); actual = running(); db = database(True)
    if actual != receipt["runtime"] or db["sourceSessions"] < 1 or proxies() != receipt["proxies"] or http(9024, "/health") != b"": fail("current_acknowledged_source_runtime_required")
    original = {p["chain"]: p for p in receipt["beforeCheckpoints"]}
    if any(p[k] < original[p["chain"]][k] for p in db["checkpoints"] for k in ["latest", "safe", "finalized"]): fail("saved_checkpoint_regressed")
    return {"format": FORMAT, "validated": True, "runtimeReceiptSha256": pin, "runtime": actual, "expiresMonotonicMicroseconds": receipt["expiresMonotonicMicroseconds"], "database": db, "inputs": inputs(), "financial": financial(), "freeOnly": True, "paidAuthority": False, "sourceSelectionsChanged": 0, "at": now()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(); choice.add_argument("--apply"); choice.add_argument("--restore"); choice.add_argument("--validate")
    args = parser.parse_args()
    signal.signal(signal.SIGALRM, lambda *_: fail("bounded_operator_expired")); signal.alarm(240)
    try:
        if os.geteuid() != 0 or os.uname().nodename != "yunipals-main" or Path("/proc/sys/kernel/random/boot_id").read_text().strip() != BOOT: fail("exact_root_host_and_boot_required")
        value = apply(args.apply) if args.apply else restore(args.restore) if args.restore else validate(args.validate) if args.validate else review()
        print(json.dumps(value, sort_keys=True))
    except Exception as error:
        print(json.dumps({"format": FORMAT, "completed": False, "errorClass": type(error).__name__, "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[a-z_]+", str(error)) else "private_diagnostics_withheld"})); raise SystemExit(1)


if __name__ == "__main__": main()
