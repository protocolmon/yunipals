#!/usr/bin/env python3
"""One genuine V2 Host for its unchanged review and build; no automatic retry."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT = "yunipals-ypal-ordinary-generation-build-session-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
FILE = OPS / "ypal-ordinary-generation-build-session-v1.py"
OWNER = OPS / "ypal-ordinary-generation-attempt-v2.py"
OWNER_SHA = "4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753"
BASE = Path("/var/backups/yunipals-ypal-ordinary-generation-build-session-v1-20261025")
PARENT_SECONDS = 900


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(value):
    return type(value) is str and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64


def protected(path, digest=None):
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_fixed_build_session_source_required")
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= 200000 and
         all(getattr(before, key) == getattr(after, key) for key in
             ["st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns"]) and
         (digest is None or sha(raw) == digest), "exact_fixed_build_session_source_required")
    return raw


def load_owner():
    raw = protected(OWNER, OWNER_SHA)
    entry = types.ModuleType("actual_generation_attempt_v2_for_build_session")
    entry.__file__ = str(OWNER)
    exec(compile(raw, str(OWNER), "exec"), entry.__dict__)
    # Authenticate its finite actual closure before composing the genuine Host.
    for name, digest in entry.SOURCE_PINS.items():
        entry.public(OPS / name, digest, 4000000)
    return entry.composition()


def existing_prefix(owner):
    names = ["build-intent.json", "generation.public.env", owner.UNIT + "-file-intent.json",
             owner.UNIT + "-file-created.json", owner.UNIT + "-start-intent.json", owner.UNIT + "-started.json"]
    return any(os.path.lexists(owner.BASE / name) for name in names) or \
        os.path.lexists(owner.WORK) or os.path.lexists(Path("/etc/systemd/system") / owner.UNIT)


def directory():
    for path in BASE.parents:
        row = path.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022,
             "protected_build_session_journal_parent_required")
    BASE.mkdir(mode=0o700)
    row = BASE.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o700,
         "exclusive_private_build_session_directory_required")
    descriptor = os.open(BASE.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def run(input_sha, operation_sha, start=False):
    need(pin(input_sha) and pin(operation_sha) and type(start) is bool,
         "actual_existing_V2_input_operation_and_explicit_direction_required")
    owner = load_owner()
    caller_sha = sha(protected(FILE))
    envelope = {"format": FORMAT, "operatorSha256": caller_sha, "originalOwnerSha256": OWNER_SHA,
                "inputSha256": input_sha, "operationSha256": operation_sha,
                "originalMainInvoked": False, "oneGenuineHostPerInvocation": True,
                "originalBuildReviewAndRepeatedChecksUnchanged": True, "parentMaximumSeconds": PARENT_SECONDS,
                "automaticRetryAllowed": False}
    # An existing caller/start prefix can only enter the original read-only
    # reconciliation. Never erase, overwrite or recreate any original guard.
    readonly = not start or os.path.lexists(BASE) or existing_prefix(owner)
    if not readonly:
        try:
            directory()
        except FileExistsError:
            readonly = True
        if not readonly:
            owner.save(BASE / "intent.json", {**envelope, "requestedAction": "review-then-build"})
    durations = {}
    active_stage, stage_started = "host-constructor", time.monotonic_ns()
    try:
        host = owner.Host(input_sha)
        durations["hostConstructor"] = time.monotonic_ns() - stage_started
        active_stage = None
        if not readonly:
            owner.save(BASE / "host-result.json", {**envelope, "stageDurationsNanoseconds": durations})
        with host.retained.lock():
            operation = owner.operation(host, operation_sha)
            if readonly or existing_prefix(owner):
                value = owner.reconcile(host, operation)
                result = {**envelope, "completed": True, "readonlyReconciliation": True,
                          "generationStartedByCaller": False, "originalReconciliation": value}
            else:
                active_stage, stage_started = "build-review", time.monotonic_ns()
                review = owner.build_review(host, operation)
                durations["buildReview"] = time.monotonic_ns() - stage_started
                active_stage = None
                review_hash = owner.sha(owner.encoded(review))
                review_sha = owner.save(BASE / "review.json", {**envelope, "review": review, "reviewHash": review_hash,
                                        "stageDurationsNanoseconds": durations})
                owner.save(BASE / "build-call-intent.json", {**envelope, "reviewSha256": review_sha,
                           "reviewHash": review_hash, "originalBuildCalledOnce": True})
                # This exact original body repeats build_review, source, lease,
                # capsule, capacity and complete backup-window checks itself.
                active_stage, stage_started = "build-call", time.monotonic_ns()
                actual = owner.build(host, operation, review_hash)
                durations["buildCall"] = time.monotonic_ns() - stage_started
                active_stage = None
                need(pin(actual), "actual_original_worker_start_receipt_digest_required")
                owner.protected(owner.BASE / (owner.UNIT + "-started.json"), actual)
                result = {**envelope, "completed": True, "readonlyReconciliation": False,
                          "generationStartedByCaller": True, "reviewSha256": review_sha,
                          "reviewHash": review_hash, "originalWorkerStartReceiptSha256": actual,
                          "generationPreparedClaimed": False, "generationAcceptedClaimed": False,
                          "publicationAllowed": False}
        result["stageDurationsNanoseconds"] = durations
        if not readonly:
            owner.save(BASE / "result.json", result)
        return result
    except BaseException as error:
        if not readonly:
            code = str(error)
            owner.save(BASE / "failure.json", {**envelope, "completed": False,
                       "fixedCode": code if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", code)
                       else "private_build_session_diagnostics_withheld", "originalOutcomeMustBeReconciled": True,
                       "generationStartedClaimed": False, "stageDurationsNanoseconds": durations,
                       "incompleteStage": active_stage,
                       "incompleteStageElapsedNanoseconds": time.monotonic_ns() - stage_started if active_stage else None})
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-sha"); parser.add_argument("--operation-sha")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--start", action="store_true"); actions.add_argument("--reconcile", action="store_true")
    args = parser.parse_args(argv)
    if not any(vars(args).values()):
        print(json.dumps({"format": FORMAT, "staticOnly": True, "generationStarted": False,
                          "originalMainInvoked": False, "automaticRetryAllowed": False}))
        return
    need(args.start or args.reconcile, "explicit_start_or_readonly_reconcile_required")
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main" and
         Path(__file__).absolute() == FILE, "fixed_root_build_session_source_and_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_build_session_expired_reconcile_only"))
    signal.alarm(PARENT_SECONDS)
    try:
        print(json.dumps(run(args.input_sha, args.operation_sha, args.start), sort_keys=True))
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"format": FORMAT, "completed": False, "automaticRetryAllowed": False,
                          "originalOutcomeMustBeReconciled": True,
                          "fixedCode": str(error) if type(error) is RuntimeError and
                          re.fullmatch("[A-Za-z0-9_]+", str(error)) else "private_build_session_diagnostics_withheld"}))
        raise SystemExit(1)
