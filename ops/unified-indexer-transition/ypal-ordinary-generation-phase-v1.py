#!/usr/bin/env python3
"""Invoke the exact generation main with a bounded eight-minute phase budget.

The V5c CLI's four-minute outer alarm predates the full-publication read window.
This explicit entry changes only that outer alarm. Individual query, subprocess,
backup and disk bounds remain in the authenticated owner and monitor. Its main
executes unchanged; this does not claim execution of the original CLI wrapper.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import sys
import types

FORMAT = "yunipals-ypal-ordinary-generation-phase-v1"
OWNER = Path("/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-generation-v5c.py")
OWNER_SHA = "ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da"
MAX_SECONDS = 480


def load():
    for path in [*OWNER.parents, OWNER]:
        info = path.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            raise RuntimeError("protected_generation_phase_owner_required")
    before = OWNER.lstat()
    raw = OWNER.read_bytes()
    after = OWNER.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or len(raw) > 100000 or \
       hashlib.sha256(raw).hexdigest() != OWNER_SHA or any(
           getattr(before, key) != getattr(after, key) for key in
           ["st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns"]):
        raise RuntimeError("exact_unchanged_generation_phase_owner_required")
    owner = types.ModuleType("unchanged_generation_phase_owner")
    owner.__file__ = str(OWNER)
    exec(compile(raw, str(OWNER), "exec"), owner.__dict__)
    return owner


def invoke(owner):
    previous_argv = sys.argv
    previous_handler = signal.getsignal(signal.SIGALRM)
    remaining = signal.alarm(0)
    if remaining:
        signal.alarm(remaining)
        raise RuntimeError("generation_entry_requires_no_inherited_alarm")
    def expired(*_):
        raise RuntimeError("bounded_generation_phase_entry_deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(MAX_SECONDS)
    try:
        sys.argv = [str(OWNER), *previous_argv[1:]]
        return owner.main()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)
        sys.argv = previous_argv


def main():
    if len(sys.argv) == 1:
        print(json.dumps({"format": FORMAT, "staticOnly": True, "ownerSha256": OWNER_SHA,
                          "phaseDeadlineSeconds": MAX_SECONDS, "databaseWrites": 0,
                          "serviceActions": 0, "originalCliWrapperClaimed": False}))
        return
    os.umask(0o077)
    invoke(load())


if __name__ == "__main__":
    main()
