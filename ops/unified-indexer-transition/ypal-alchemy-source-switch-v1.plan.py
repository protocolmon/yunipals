#!/usr/bin/env python3
"""Pure bounded-switch plan and exclusive filesystem journals; no host actions."""
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat

FORMAT = "yunipals-alchemy-source-switch-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v1-20261024")
STAGE = OPS / "ypal-alchemy-primary-queue-v1"
LIFECYCLE = OPS / "ypal-alchemy-source-switch-v1.py"
SYSTEM = Path("/etc/systemd/system")
SOURCE = "yunipals-ypal-combined-source.service"
PROJECT = "/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer"
NODE = "/opt/node-v24.18.1/bin/node"
CHAINS = {"ethereum": 1, "base": 8453, "polygon": 137, "bnb": 56}
PROFILE = "0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff"
PROXY_ARTIFACT_SHA = "10c34c878d5a617fe31d4fffd6a8b020610b39b988de1cf2aac0cb11e7ac59d8"
TIMEOUT_SHA = "690b6dda7357390ae4d6bb063b30776cdd6da3a8beefa54d4d60b0092f392192"
FINANCIAL_BASE = Path("/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024")
EFFECT_NAMES = (
    "paid-definition-intent", "paid-definition-installed", "paid-start-intent",
    "paid-started", "paid-stop-intent", "paid-stopped", "free-definition-restored",
    "free-start-intent", "free-started"
)


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def pin(value):
    return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64


def calendar(milliseconds):
    need(type(milliseconds) is int and milliseconds > 0, "literal_plan_deadline_required")
    date = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=milliseconds)
    return date.strftime("%Y-%m-%d %H:%M:%S.%f UTC")


def validate_plan(plan):
    need(plan["format"] == "yunipals-ypal-alchemy-catchup-financial-v1-plan" and
         plan["profileId"] == PROFILE and plan["automaticRenewal"] is False and
         plan["normalDaily10MApproved"] is False and plan["maximumSeconds"] == 28800 and
         plan["originalAllowanceCu"] == "20000000" and plan["maximumAdditionalBookedCu"] == "15000000",
         "one_original_cap_without_new_normal_spend_authority_required")
    start, end, utc = (plan[key] for key in ["startMs", "expiresMs", "nextUtcMs"])
    need(all(type(v) is int for v in [start, end, utc]) and
         3600000 <= end - start <= 28800000 and end <= utc - 900000 and
         utc == ((start // 86400000) + 1) * 86400000,
         "one_bounded_same_day_window_required")
    rows = plan["permits"]
    need(isinstance(rows, list) and len(rows) == 4 and {row["chainId"] for row in rows} == set(CHAINS.values()) and
         len({row["permitId"] for row in rows}) == 4,
         "four_unique_chain_scoped_permits_required")
    allocations = {1: 1000000, 8453: 3000000, 137: 2000000, 56: 9000000}
    for row in rows:
        need(isinstance(row["permitId"], str) and re.fullmatch("0x[a-f0-9]{64}", row["permitId"]) and
             row["permitId"] != "0x" + "0" * 64 and row["profileId"] == PROFILE and
             row["enabled"] is True and row["spentCu"] == "0" and row["expiresMs"] == end and
             row["reviewedMs"] == start and type(row["chainId"]) is int and
             row["maximumCu"] == str(allocations[row["chainId"]]),
             "exact_unused_chain_allocation_and_finite_expiry_required")
    return {chain: next(row for row in rows if row["chainId"] == chain_id) for chain, chain_id in CHAINS.items()}


def source_environment(plan):
    rows = validate_plan(plan)
    # Node --env-file does not override the process environment. The owner must
    # verify these exact public variables in the actual newly started process.
    return "".join("UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(CHAINS[chain]) + "=" + row["permitId"] + "\n"
                   for chain, row in rows.items()).encode()


def proxy_environment(chain):
    need(chain in CHAINS, "one_fixed_chain_required")
    return ("MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true\n"
            "MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false\n").encode()


def proxy_drop(chain):
    need(chain in CHAINS, "one_fixed_chain_required")
    return ("[Service]\nEnvironmentFile=" + str(STAGE / (chain + ".public.env")) +
            "\nExecStart=\nExecStart=" + NODE + " " + str(STAGE / "rpc-budget-proxy.mjs") + "\n").encode()


def source_drop():
    pairs = [
        (OPS / "ypal-combined-source-v1-stage/ponder.config.ts", PROJECT + "/ponder.config.ts"),
        (OPS / "ypal-combined-source-v1-stage/booster-config.ts", PROJECT + "/lib/boosters/config.ts"),
        (OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts", PROJECT + "/lib/unified/rpc-preflight.ts")
    ]
    return ("[Service]\nEnvironmentFile=" + str(STAGE / "source.public.env") +
            "\nBindReadOnlyPaths=\nBindReadOnlyPaths=" + " ".join(str(a) + ":" + b for a, b in pairs) + "\n").encode()


def deadline_definitions(plan, plan_sha):
    validate_plan(plan)
    need(pin(plan_sha) and sha(encoded(plan)) == plan_sha, "actual_financial_plan_bytes_required")
    result = {}
    for label, flag, due in [("close", "--deadline-close", plan["expiresMs"]),
                             ("utc", "--deadline-utc", plan["nextUtcMs"])]:
        stem = "yunipals-alchemy-catchup-" + label + "-v1"
        # TimeoutStartSec bounds a oneshot; RuntimeMaxSec does not. The root
        # executor drops all capabilities in its database/process peers.
        service = ("[Unit]\nDescription=Close owned Yunipals Alchemy " + label + " window\n"
                   "After=network.target postgresql.service\n[Service]\nType=oneshot\nUser=root\nGroup=root\n"
                   "ExecStart=/usr/bin/python3 -I -B " + str(LIFECYCLE) + " " + flag + " " + plan_sha + "\n"
                   "Restart=no\nTimeoutStartSec=900\nTimeoutStopSec=90\nKillMode=control-group\n"
                   "NoNewPrivileges=yes\nUMask=0077\nProtectSystem=strict\nProtectHome=read-only\nPrivateTmp=yes\n"
                   "CapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_SETPCAP CAP_KILL\nAmbientCapabilities=\n"
                   "ReadWritePaths=" + str(BASE) + " " + str(FINANCIAL_BASE) + " /etc/systemd/system " +
                   str(STAGE) + " /run/lock\n").encode()
        timer = ("[Unit]\nDescription=Owned Yunipals Alchemy " + label + " deadline\n[Timer]\n"
                 "OnCalendar=" + calendar(due) + "\nAccuracySec=1us\nRandomizedDelaySec=0\n"
                 "Persistent=true\nUnit=" + stem + ".service\n[Install]\nWantedBy=timers.target\n").encode()
        result[stem + ".service"] = service
        result[stem + ".timer"] = timer
    return result


def identity(path):
    row = Path(path).lstat()
    return {key: getattr(row, key) for key in
            ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]}


def directory(path):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "fixed_absolute_journal_directory_required")
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "root_owned_nonwritable_real_journal_directory_required")


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive(path, raw, mode=0o600):
    path = Path(path)
    directory(path.parent)
    need(isinstance(raw, bytes) and len(raw) <= 8000000 and mode in {0o600, 0o644}, "bounded_new_public_or_private_journal_required")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)
    return {"sha256": sha(raw), "identity": identity(path)}


def read(path, expected=None):
    path = Path(path)
    directory(path.parent)
    before = identity(path)
    need(stat.S_ISREG(before["st_mode"]) and before["st_uid"] == 0 and not before["st_mode"] & 0o022 and
         before["st_nlink"] == 1 and before["st_size"] <= 8000000, "bounded_owned_single_link_receipt_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 8000001)
        need(before == identity(path) and all(getattr(os.fstat(fd), key) == value for key, value in before.items()) and
             len(raw) == before["st_size"] and (expected is None or pin(expected) and sha(raw) == expected),
             "same_open_receipt_inode_and_exact_wire_bytes_required")
        return raw
    finally:
        os.close(fd)


def move_owned(source, target, record):
    source, target = Path(source), Path(target)
    need(source != target and record == {"sha256": sha(read(source)), "identity": identity(source)},
         "only_exact_owned_definition_inode_may_move")
    directory(source.parent)
    directory(target.parent)
    libc = ctypes.CDLL(None, use_errno=True)
    result = libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1)
    if result:
        raise OSError(ctypes.get_errno(), "owned_no_replace_move_refused")
    sync(source.parent)
    if source.parent != target.parent:
        sync(target.parent)
    need(record["sha256"] == sha(read(target)) and
         all(identity(target)[key] == record["identity"][key] for key in record["identity"] if key != "st_ctime_ns"),
         "owned_moved_inode_and_bytes_must_match")
    return {"sha256": record["sha256"], "identity": identity(target)}


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT + "-plan", "sourceOnly": True,
                      "sourceLifecycleQualified": False, "financialAuthorityQualified": False,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
