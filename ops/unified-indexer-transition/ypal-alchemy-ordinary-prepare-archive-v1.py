#!/usr/bin/env python3
"""Archive only the actual pre-operation ordinary prepare; no runtime action.

Empty audit, five unpublished definitions and five public environment files
move intact into fixed private siblings. A fresh 3bf prepare is a separate act.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import types

FORMAT = "yunipals-alchemy-ordinary-prepare-archive-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
RUNTIME = OPS / "ypal-alchemy-ordinary-runtime-v1.py"
RUNTIME_SHA = "3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5"
INPUT_SHA = "16877730af574fb10e69759cbbfdfa093ab8d5a7bc90e0e91c98f25a35ca34cc"
FINANCIAL_SHA = "181cc20ac191a91a5cb32fe203fc287747d8cc8ec1695056b08cbb9301e7829a"
BASE = Path("/var/backups/yunipals-alchemy-ordinary-prepare-archive-v1-20261024")


def need(value, code):
    if not value: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def own_sha(): return sha(Path(__file__).read_bytes())


def frozen():
    for path in [*RUNTIME.parents, RUNTIME]:
        row = path.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_exact_ordinary_archive_runtime_required")
    raw = RUNTIME.read_bytes(); need(sha(raw) == RUNTIME_SHA, "frozen_3bf_ordinary_runtime_required")
    value = types.ModuleType("archive_readonly_runtime"); value.__file__ = str(RUNTIME)
    exec(compile(raw, str(RUNTIME), "exec"), value.__dict__)
    return value


def file_record(owner, path, expected):
    actual = owner.p.read(path)
    identity = owner.p.identity(path)
    need(actual == expected and identity["st_uid"] == identity["st_gid"] == 0 and
         stat.S_IMODE(identity["st_mode"]) == 0o644 and identity["st_nlink"] == 1,
         "exact_owned_partial_prepare_public_bytes_mode_inode_required")
    return {"sha256": sha(actual), "identity": identity}


def directory_record(owner, path):
    owner.p.directory(path); row = owner.p.identity(path)
    need(row["st_uid"] == row["st_gid"] == 0 and stat.S_IMODE(row["st_mode"]) == 0o700,
         "exact_root_private_partial_prepare_directory_required")
    return row


def current(owner):
    # Read-only fixed leaves. No prepare, manager, put, reload or financial SQL.
    owner.financial_current()
    need(owner.config["financialReceiptSha256"] == FINANCIAL_SHA, "same_actual_admitted_ordinary_finance_required")
    unit = "yunipals-ypal-combined-source.service"; state = owner.h.source.state(unit)
    group = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
    need(state["MainPID"] == state["ControlPID"] == "0" and state["ActiveState"] in {"inactive", "failed"} and
         (not group.exists() or not group.read_text().split()), "actual_stopped_source_required_before_local_archive")
    for process in owner.old.owner.known_source_processes():
        try: raw = (Path("/proc") / str(process["pid"]) / "stat").read_text()
        except FileNotFoundError: continue
        need(int(raw[raw.rfind(")") + 2:].split()[19]) != process["startTicks"], "known_source_epoch_must_remain_gone")
    owner.h.source_sessions(None)
    native = owner.static()
    peers = owner.peers(); routes = {chain: owner.old.h.free_route(chain) for chain in owner.p.CHAINS}
    return {"peers": peers, "routes": routes, "native": {key: native[key] for key in ["schemaOid", "tables", "cache", "checkpoints"]},
            "buildId": native["app"]["build_id"]}


def capture(module, owner):
    need(not os.path.lexists(BASE), "fresh_archive_audit_required_no_unknown_retry")
    before = current(owner); oldbase, hold = module.BASE, module.HOLD
    need(not list(oldbase.iterdir()) and {p.name for p in hold.iterdir()} == {name + ".conf" for name in ["source", *module.CHAINS]},
         "only_actual_empty_audit_and_five_unpublished_definitions_may_archive")
    dirs = {str(oldbase): directory_record(owner, oldbase), str(hold): directory_record(owner, hold)}
    targets = {str(oldbase): str(oldbase.with_name(oldbase.name + ".aborted-prepare-1")),
               str(hold): str(hold.with_name(hold.name + ".aborted-prepare-1"))}
    envdir = owner.p.STAGE / ".ordinary-aborted-prepare-v1"
    need(not os.path.lexists(envdir) and all(not os.path.lexists(path) for path in targets.values()),
         "bounded_fixed_archive_destinations_must_be_absent")
    files = {}; envs = {}
    for name in ["source", *module.CHAINS]:
        definition = module.source_bytes(owner.original, owner.p) if name == "source" else owner.proxy_drop(name)
        files[str(hold / (name + ".conf"))] = file_record(owner, hold / (name + ".conf"), definition)
        target = module.DROP if name == "source" else owner.h.proxy_drop(name)
        need(not os.path.lexists(target), "no_partial_ordinary_drop_may_be_published")
        raw = owner.source_environment() if name == "source" else owner.p.proxy_environment(name)
        path = owner.p.STAGE / (name + ".ordinary.public.env")
        envs[str(path)] = file_record(owner, path, raw)
    need(current(owner) == before, "same_source_terminal_serving_peers_and_four_free_epochs_required")
    binding = {"format": FORMAT, "operatorSha256": own_sha(), "runtimeProducerSha256": RUNTIME_SHA,
               "inputSha256": INPUT_SHA, "financialReceiptSha256": FINANCIAL_SHA, "bootId": owner.m.boot(),
               "directories": dirs, "directoryTargets": targets, "definitions": files, "publicEnvironment": envs,
               "environmentArchive": str(envdir), "runtimeFrame": before}
    return binding


def rename_directory(owner, source, target, expected):
    source, target = Path(source), Path(target)
    need(owner.p.identity(source) == expected and not os.path.lexists(target) and
         source.parent.stat().st_dev == target.parent.stat().st_dev, "same_exact_private_directory_and_absent_same_filesystem_target_required")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        raise OSError(ctypes.get_errno(), "archive_directory_no_replace_refused")
    owner.p.sync(source.parent)
    actual = owner.p.identity(target)
    need(all(actual[k] == v for k, v in expected.items() if k != "st_ctime_ns"), "same_archived_private_directory_inode_required")


def archive(module, owner, review_sha):
    binding = capture(module, owner)
    need(sha(encoded(binding)) == review_sha, "exact_current_archive_review_required")
    BASE.mkdir(mode=0o700); owner.p.sync(BASE.parent)
    owner.p.exclusive(BASE / "intent.json", encoded(binding))
    # Exact live preservation CAS immediately before the first owned rename.
    need(current(owner) == binding["runtimeFrame"], "runtime_changed_before_partial_archive_no_service_action")
    envdir = Path(binding["environmentArchive"]); envdir.mkdir(mode=0o700); owner.p.sync(envdir.parent)
    for path, item in binding["publicEnvironment"].items():
        owner.p.move_owned(path, envdir / Path(path).name, item)
    # Validate all five definitions again before moving their enclosing directory.
    for path, item in binding["definitions"].items():
        need({"sha256": sha(owner.p.read(path)), "identity": owner.p.identity(path)} == item,
             "partial_definition_changed_before_archive")
    for source in [module.HOLD, module.BASE]:
        rename_directory(owner, source, binding["directoryTargets"][str(source)], binding["directories"][str(source)])
    need(current(owner) == binding["runtimeFrame"], "runtime_changed_after_local_archive_no_service_action")
    result = {"format": FORMAT, "operatorSha256": own_sha(), "inputSha256": INPUT_SHA,
              "intentSha256": sha(encoded(binding)), "archived": True, "freshPrepareExecuted": False,
              "filesPreserved": 10, "directoriesPreserved": 2, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}
    owner.p.exclusive(BASE / "result.json", encoded(result))
    return {**result, "receiptSha256": sha(encoded(result))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(); group.add_argument("--review", action="store_true"); group.add_argument("--archive")
    args = parser.parse_args()
    if not (args.review or args.archive):
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_partial_archive_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_partial_archive_unknown_no_retry")); signal.alarm(300)
    module = frozen(); owner = module.Owner(INPUT_SHA)
    with owner.old.v.transition_lock(owner.m):
        if args.review:
            value = capture(module, owner); result = {"format": FORMAT, "reviewSha256": sha(encoded(value)), "files": 10,
                "directories": 2, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}
        else: result = archive(module, owner, args.archive)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__": main()
