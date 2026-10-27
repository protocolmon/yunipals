#!/usr/bin/env python3
"""Evaluate the reviewed deadline transport in one isolated, inactive host build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import time
import types

FORMAT = "yunipals-rpc-deadline-host-build-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
STAGE = OPS / "ypal-rpc-deadline-host-build-v1"
BASE = Path("/var/backups/yunipals-rpc-deadline-host-build-v1-20261024")
AREA = Path("/var/lib/yunipals-unified-ypal/rpc-deadline-inactive-build-v1")
UNIT = "yunipals-rpc-deadline-inactive-build-v1.service"
PROJECT = Path("/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer")
CONTEXT = OPS / "ypal-source-restored-current-context-v1.py"
CONTEXT_SHA = "994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae"
FACTORY_SHA = "690b6dda7357390ae4d6bb063b30776cdd6da3a8beefa54d4d60b0092f392192"
PROGRAM_SHA = "e644eefeaecd4b970e89320bb8cef5c401180605d742f2018b0fbc6aa2c8820f"
LOCAL_SHA = "4ad7055868dc2f736a944564f7021a3d9d922da0ec70ac6c3d3507bdff18fd07"
HASHES = (
    "0f394941a10f8ad3407029be841ea82a20633b3323f03d95dcfff613c063377d",
    "f4522b6a4b90a56ed63468a70b9a03941d184d3f22f592afdb672952d22957f6",
    "8fdfce8c688a96a995023887e62ae028128c0db59d78f93025d2de63938e5af3"
)
LOADER_ROOT = Path("/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6")
LOADER = LOADER_ROOT / "node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs"
LOADER_SHA = "17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def context():
    for path in [*CONTEXT.parents, CONTEXT]:
        row = path.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and
             not row.st_mode & 0o022, "protected_current_context_required")
    raw = CONTEXT.read_bytes()
    need(len(raw) < 200000 and sha(raw) == CONTEXT_SHA, "exact994_current_context_required")
    value = types.ModuleType("current_restored_source_context")
    value.__file__ = str(CONTEXT)
    exec(compile(raw, str(CONTEXT), "exec"), value.__dict__)
    value.protected(CONTEXT, CONTEXT_SHA)
    return value


def command():
    source = OPS / "ypal-combined-source-v1-stage"
    writable = [(AREA / "cache/.ponder", PROJECT / ".ponder"),
                (AREA / "cache/.vite-temp", PROJECT / "node_modules/.vite-temp"),
                (AREA / "cache/ponder-env.d.ts", PROJECT / "ponder-env.d.ts")]
    readonly = [(source / "ponder.config.ts", PROJECT / "ponder.config.ts"),
                (source / "booster-config.ts", PROJECT / "lib/boosters/config.ts"),
                (STAGE / "rpc-preflight.ts", PROJECT / "lib/unified/rpc-preflight.ts")]
    return ["/usr/bin/systemd-run", "--quiet", "--collect", "--wait", "--pipe", "--unit=" + UNIT,
            "--property=User=yunipals_unified_shadow", "--property=Group=yunipals_unified_shadow",
            "--property=WorkingDirectory=" + str(PROJECT), "--property=NoNewPrivileges=yes",
            "--property=CapabilityBoundingSet=", "--property=AmbientCapabilities=",
            "--property=ProtectSystem=strict", "--property=ProtectHome=yes", "--property=PrivateTmp=yes",
            "--property=PrivateNetwork=yes", "--property=IPAddressDeny=any", "--property=RestrictSUIDSGID=yes",
            "--property=RestrictAddressFamilies=AF_UNIX", "--property=RuntimeMaxSec=120",
            "--property=TimeoutStopSec=15", "--property=MemoryMax=2147483648", "--property=MemorySwapMax=0",
            "--property=TasksMax=64", "--property=LimitCORE=0", "--property=CPUQuota=100%",
            "--property=ReadWritePaths=" + str(AREA / "cache"),
            "--property=BindPaths=" + " ".join(str(a) + ":" + str(b) for a, b in writable),
            "--property=BindReadOnlyPaths=" + " ".join(str(a) + ":" + str(b) for a, b in readonly),
            "--property=InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /var/backups",
            "/usr/bin/env", "-i", "TSX_DISABLE_CACHE=1", "NODE_NO_WARNINGS=1",
            "DATABASE_URL=postgresql://offline:offline@127.0.0.1:1/offline",
            "/opt/node-v24.18.1/bin/node", "--max-old-space-size=1024",
            "--env-file=" + str(source / "combined.public.env"), "--import", str(LOADER),
            str(STAGE / "offline-build.mjs")]


def validate_build(value):
    need(value["format"] == "yunipals-rpc-deadline-pool5-offline-v1" and value["buildId"] == "71e2a7f3b7" and
         tuple(value[key] for key in ["configHash", "schemaHash", "indexingHash"]) == HASHES and
         value["poolMax"] == value["effectivePoolMax"] == 5 and value["namespace"] == "unified_ypal_20261023_v1" and
         value["candidateTransportSha256"] == FACTORY_SHA and value["interceptedFixtureRequests"] == 12 and
         value["socketAttempts"] == value["databaseCalls"] == value["realProviderRequests"] == 0,
         "exact_same_build_pool5_deadline_evaluation_required")
    return value


def snapshot(c):
    observed = c.observe_runtime()
    restore = c.restore()
    r, m, h, op = restore.load()
    owner = restore.Owner(r, m, h, op)
    peers = owner.preserved()
    native = h.native()
    need(native["tables"] == observed["binding"]["nativeTableIdentities"] and
         native["cache"] == observed["binding"]["syncCacheIdentity"], "same_actual_native_and_cache_identity_required")
    return {"binding": {"source": observed["binding"], "peers": peers,
                        "privateAndPublicInputs": h.inputs(), "sourceRole": h.raw.role()},
            "native": native}, (r, m, h)


def unit_state(m):
    keys = ["LoadState", "ActiveState", "MainPID", "ControlPID", "Job"]
    raw = m.command(["/usr/bin/systemctl", "show", "--all", UNIT, *["--property=" + key for key in keys]])
    result = dict(line.split("=", 1) for line in raw.decode().splitlines())
    need(set(result) == set(keys), "complete_own_transient_state_required")
    return result


def absent(state):
    return state == {"LoadState": "not-found", "ActiveState": "inactive", "MainPID": "0", "ControlPID": "0", "Job": ""}


def review():
    c = context()
    local = validate_build(json.loads(c.protected(STAGE / "local-build.json", LOCAL_SHA)))
    c.protected(STAGE / "rpc-preflight.ts", FACTORY_SHA)
    c.protected(STAGE / "offline-build.mjs", PROGRAM_SHA)
    c.protected(LOADER, LOADER_SHA)
    before, parts = snapshot(c)
    r, m, h = parts
    need(absent(unit_state(m)) and not os.path.lexists(BASE) and not os.path.lexists(AREA),
         "fresh_absent_transient_cache_and_audit_required")
    resources = h.s.resources()
    binding = {"format": FORMAT, "operatorSha256": sha(m.protected(Path(__file__).absolute())),
               "current": before["binding"], "programSha256": PROGRAM_SHA, "factorySha256": FACTORY_SHA,
               "localBuildSha256": LOCAL_SHA, "argvSha256": sha(encoded(command()))}
    return {"binding": binding, "reviewHash": sha(encoded(binding)), "native": before["native"],
            "resources": resources, "localBuild": local}, (c, r, m, h)


def run(expected):
    value, parts = review()
    c, r, m, h = parts
    need(value["reviewHash"] == expected, "exact_current_readonly_review_required")
    with m.lock():
        current, _ = snapshot(c)
        need(current["binding"] == value["binding"]["current"] and absent(unit_state(m)) and
             not os.path.lexists(BASE) and not os.path.lexists(AREA), "unchanged_current_runtime_before_owned_intent_required")
        h.s.resources()
        parent = AREA.parent.lstat()
        need(stat.S_ISDIR(parent.st_mode) and parent.st_uid == parent.st_gid == 0 and
             stat.S_IMODE(parent.st_mode) == 0o755, "protected_existing_cache_parent_required")
        BASE.mkdir(mode=0o700)
        m.sync(BASE.parent)
        m.save(BASE / "intent.json", value)
        AREA.mkdir(mode=0o755)
        m.sync(AREA.parent)
        for name in ["cache", "cache/.ponder", "cache/.vite-temp"]:
            path = AREA / name
            path.mkdir(mode=0o750)
            path.chmod(0o750)
            os.chown(path, 970, 964)
        path = AREA / "cache/ponder-env.d.ts"
        m.save(path, b"")
        os.chown(path, 970, 964)
        raw = m.command(command(), timeout=150)
        m.save(BASE / "command-result.json", {"stdout": raw.decode()})
        actual = validate_build(json.loads(raw))
        need(actual["uid"] == 970 and actual["gid"] == 964 and actual["contracts"] == value["localBuild"]["contracts"],
             "same_actual_unprivileged_host_build_and_contracts_required")
        after, _ = snapshot(c)
        need(after["binding"] == current["binding"], "live_source_peers_inputs_and_RPC_must_remain_unchanged")
        r.recovery_floor(current["native"], after["native"])
        terminal = False
        for _ in range(15):
            state = unit_state(m)
            if absent(state):
                terminal = True
                break
            time.sleep(0.2)
        need(terminal, "own_transient_must_be_collected_before_acceptance")
        result = {"format": FORMAT, "completed": True, "operatorSha256": value["binding"]["operatorSha256"],
                  "reviewHash": expected, "localBuildSha256": LOCAL_SHA, "actual": actual,
                  "currentSourceAndPeersUnchanged": True, "nativeAndCacheIdentityPreserved": True,
                  "safeRecoveryFloorsPreserved": True, "ownTransientCollected": True,
                  "transientBuildStarts": 1, "sourceActions": 0, "databaseWrites": 0, "providerCalls": 0,
                  "sourceReadinessQualified": False, "runningTransportChanged": False}
        m.save(BASE / "result.json", result)
        return {"format": FORMAT, "completed": True, "actualResultSha256": sha(m.protected(BASE / "result.json")),
                "buildId": actual["buildId"], "effectivePoolMax": 5, "uid": actual["uid"], "gid": actual["gid"],
                "currentSourceAndPeersUnchanged": True, "ownTransientCollected": True,
                "transientBuildStarts": 1, "sourceActions": 0, "databaseWrites": 0, "providerCalls": 0,
                "sourceReadinessQualified": False, "runningTransportChanged": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply")
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_production_host_required")
    os.umask(0o077)
    if args.apply:
        result = run(args.apply)
    else:
        value, _ = review()
        result = {"format": FORMAT, "reviewHash": value["reviewHash"], "programSha256": PROGRAM_SHA,
                  "factorySha256": FACTORY_SHA, "sourceActions": 0, "providerCalls": 0, "databaseWrites": 0}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        import re
        reason = str(error) if isinstance(error, RuntimeError) and re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": reason, "automaticRetryAllowed": False}))
        raise SystemExit(1)
