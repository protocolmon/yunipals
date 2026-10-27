#!/usr/bin/env python3
"""Bounded read-only diagnosis of the actual uncommitted ordinary prepare.

This never calls prepare(), a manager method, SQL transaction, save or rename.
Only aggregate phase results and public producer stack locations are emitted.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import sys
import traceback
import types

FORMAT = "yunipals-alchemy-ordinary-prepare-diagnostic-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
RUNTIME = OPS / "ypal-alchemy-ordinary-runtime-v1.py"
RUNTIME_SHA = "3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5"


def mutation_guard():
    """Observe only: reject recursive write/action functions and OS effects."""
    forbidden = {"manager", "put", "save", "exclusive", "transaction", "commit", "prepare", "retire",
                 "reload", "move", "publish", "switch_proxy", "start_source", "return_free"}
    def profile(frame, event, arg):
        if event == "call" and frame.f_code.co_name in forbidden:
            raise RuntimeError("diagnostic_mutation_function_forbidden")
    def audit(event, args):
        if event == "open":
            path, mode, flags = args
            # subprocess wraps already-created anonymous stdio pipe FDs. An
            # integer alone is insufficient: inherited regular-file FDs stay
            # forbidden, and path-based file writes are never allowed.
            ipc = type(path) is int and (stat.S_ISFIFO(os.fstat(path).st_mode) or stat.S_ISSOCK(os.fstat(path).st_mode))
            need(ipc or not (isinstance(mode, str) and any(key in mode for key in "wax+")) and
                 not (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)),
                 "diagnostic_filesystem_write_forbidden")
        need(event not in {"os.rename", "os.remove", "os.mkdir", "os.rmdir", "os.link", "os.symlink", "os.chmod", "os.chown", "os.truncate"},
             "diagnostic_filesystem_mutation_forbidden")
        if event == "subprocess.Popen":
            command = args[1]
            need(isinstance(command, (list, tuple)) and not any(word in command for word in
                 ["daemon-reload", "start", "stop", "restart", "enable", "disable", "kill", "reset-failed"]),
                 "diagnostic_manager_mutation_forbidden")
    sys.addaudithook(audit); sys.setprofile(profile)


def source_terminal(owner):
    """No lifecycle terminal method: direct kernel/manager reads plus SELECT map."""
    unit = "yunipals-ypal-combined-source.service"
    state = owner.h.source.state(unit)
    group = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
    need(state["MainPID"] == state["ControlPID"] == "0" and state["ActiveState"] in {"inactive", "failed"} and
         (not group.exists() or not group.read_text().split()), "actual_source_terminal_kernel_read_required")
    for process in owner.old.owner.known_source_processes():
        try: raw = (Path("/proc") / str(process["pid"]) / "stat").read_text()
        except FileNotFoundError: continue
        need(int(raw[raw.rfind(")") + 2:].split()[19]) != process["startTicks"], "known_source_epoch_still_present")
    return owner.h.source_sessions(None)


def need(value, code):
    if not value: raise RuntimeError(code)


def runtime():
    import stat
    for path in [*RUNTIME.parents, RUNTIME]:
        row = path.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_exact_diagnostic_runtime_required")
    raw = RUNTIME.read_bytes()
    need(hashlib.sha256(raw).hexdigest() == RUNTIME_SHA, "actual_frozen_3bf_runtime_required")
    module = types.ModuleType("readonly_ordinary_prepare_runtime"); module.__file__ = str(RUNTIME)
    exec(compile(raw, str(RUNTIME), "exec"), module.__dict__)
    return module


def diagnose(owner):
    rows = []
    def phase(name, fn):
        try:
            value = fn()
            rows.append({"phase": name, "passed": True})
            return value
        except Exception as error:
            code = str(error)
            rows.append({"phase": name, "passed": False, "errorClass": type(error).__name__,
                         "fixedCode": code if re.fullmatch("[A-Za-z0-9_]+", code) else None,
                         "publicCodeFrames": [{"file": Path(frame.filename).name, "line": frame.lineno,
                                               "function": frame.name} for frame in traceback.extract_tb(error.__traceback__)
                                              if Path(frame.filename).name.endswith(".py")]})
            raise
    try:
        phase("financial_current_before", owner.financial_current)
        phase("source_terminal_and_remaining_kernel_sessions", lambda: source_terminal(owner))
        first = phase("current_peer_frame_first", owner.peers)
        routes = phase("four_free_routes_first", lambda: {c: owner.old.h.free_route(c) for c in owner.p.CHAINS})
        second = phase("current_peer_frame_second", owner.peers)
        after = phase("four_free_routes_second", lambda: {c: owner.old.h.free_route(c) for c in owner.p.CHAINS})
        phase("peer_frame_stable", lambda: need(first == second, "current_peer_frame_changed_between_readonly_observations"))
        phase("four_free_routes_stable", lambda: need(routes == after, "free_route_frame_changed_between_readonly_observations"))
        phase("financial_current_after", owner.financial_current)
    except Exception:
        pass
    return {"format": FORMAT, "runtimeProducerSha256": RUNTIME_SHA, "allReadOnlyPhasesPassed": bool(rows) and all(row["passed"] for row in rows),
            "phases": rows, "historicalPrepareFailureReclassified": False,
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "filesystemWrites": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input-sha"); args = parser.parse_args()
    if not args.input_sha:
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "filesystemWrites": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_diagnostic_host_required")
    need(re.fullmatch("[a-f0-9]{64}", args.input_sha) is not None, "actual_ordinary_input_hash_required")
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_readonly_diagnostic_expired")); signal.alarm(300)
    mutation_guard(); module = runtime(); owner = module.Owner(args.input_sha)
    need(not os.path.lexists(module.BASE / "operation.json") and not list(module.BASE.iterdir()),
         "actual_empty_uncommitted_prepare_audit_required")
    print(json.dumps(diagnose(owner), sort_keys=True))


if __name__ == "__main__": main()
