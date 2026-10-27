#!/usr/bin/env python3
"""New inactive-import audit; distinguish pg metadata from database operations.

The original public stager, failed qualification and five staged files stay
unchanged. The native getter still throws before loading a native addon.
"""
import argparse
import fcntl
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = "yunipals-alchemy-primary-import-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
PARENT = OPS / "ypal-alchemy-primary-stage-v1.py"
PARENT_SHA = "01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73"
PARENT_BASE = Path("/var/backups/yunipals-alchemy-primary-stage-v1-20261024")
BASE = Path("/var/backups/yunipals-alchemy-primary-import-v2-20261024")
LOCK = Path("/run/lock/yunipals-ypal-combined-transition.lock")
FAILED_INTENT_SHA = "ce031317622efba637f6db736996f791eaa40546a0be5a777f6fc1ca039dfb95"
FAILED_STDERR_SHA = "072e82f09620e76757be6763a2e036838dba9673ec2161574bf416624240eed4"
PARENT_GUARD_SHA = "1825e6c6cff0641c6e31d192aaecc6e11b9906378f0a94f4f53c4d8e2923c986"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def parent():
    for path in [*PARENT.parents, PARENT]:
        row = path.lstat()
        need(row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022 and not stat.S_ISLNK(row.st_mode),
             "protected_frozen_inactive_stager_required")
    raw = PARENT.read_bytes()
    need(len(raw) == 24469 and sha(raw) == PARENT_SHA, "exact_original01da_stager_required")
    value = types.ModuleType("original_inactive_queue_stage")
    value.__file__ = str(PARENT)
    exec(compile(raw, str(PARENT), "exec"), value.__dict__)
    need(sha(value.read(PARENT)) == PARENT_SHA, "same_original_stager_after_import_required")
    return value


def derived_guard(original):
    need(isinstance(original, str) and sha(original.encode()) == PARENT_GUARD_SHA,
         "exact_frozen_original_import_guard_required")
    replacements = [
        ("const deny=key=>()=>{", "let nativeMetadataReads=0;\nconst deny=key=>()=>{"),
        ("Object.defineProperty(pg,'native',{configurable:true,get:deny('database')});",
         "Object.defineProperty(pg,'native',{configurable:true,get(){nativeMetadataReads++;throw Error('pg_native_metadata_lookup_refused')}});"),
        ("assert.deepEqual(counts,{network:0,listen:0,database:0,pool:0,spawn:0});",
         "assert.deepEqual(counts,{network:0,listen:0,database:0,pool:0,spawn:0});assert(Number.isSafeInteger(nativeMetadataReads)&&nativeMetadataReads>=0&&nativeMetadataReads<=1);"),
        ("loadedDependencyFiles:loaded.size,loadedDependencies,", "nativeMetadataReads,loadedDependencyFiles:loaded.size,loadedDependencies,")
    ]
    value = original
    for old, new in replacements:
        need(value.count(old) == 1, "exact_four_import_guard_classification_seams_required")
        value = value.replace(old, new)
    reverse = value
    for old, new in reversed(replacements):
        need(reverse.count(new) == 1, "unique_reversible_classification_patch_required")
        reverse = reverse.replace(new, old)
    need(reverse == original, "all_network_and_database_operation_guards_must_remain_unchanged")
    return value


def producer_sha(m):
    return sha(m.read(Path(__file__).absolute()))


def review(m, stage_sha):
    need(re.fullmatch("[a-f0-9]{64}", stage_sha) and not os.path.lexists(BASE),
         "actual_stage_hash_and_fresh_successor_audit_required")
    result, _ = m.qualified_stage(stage_sha)
    need(m.BASE == PARENT_BASE and not os.path.lexists(PARENT_BASE / "qualification-result.json"),
         "original_unsuccessful_import_must_not_be_relabelled")
    m.read(PARENT_BASE / "qualification-intent.json", FAILED_INTENT_SHA)
    raw = m.read(PARENT_BASE / "qualification.stderr", FAILED_STDERR_SHA)
    need(len(raw) == 642 and m.read(PARENT_BASE / "qualification.stdout") == b"",
         "exact_preserved_first_failed_import_required")
    binding = {"format": FORMAT, "operatorSha256": producer_sha(m), "parentSha256": PARENT_SHA,
               "stageResultSha256": stage_sha, "stageOperatorSha256": result["operatorSha256"],
               "failedIntentSha256": FAILED_INTENT_SHA, "failedStderrSha256": FAILED_STDERR_SHA,
               "guardSha256": sha(derived_guard(m.IMPORT).encode()), "nativeGetterStillThrows": True,
               "databaseOperationGuardsUnchanged": True, "actorFrameSha256": sha(encoded(result["actors"]))}
    return {"binding": binding, "reviewHash": sha(encoded(binding)), "runtimeSelected": False,
            "databaseConnections": 0, "providerCalls": 0, "serviceActions": 0}


def qualifier(m):
    # Retain the audited original qualification body and actual original-stage
    # ownership verifier. Only the audit/format, guarded import and actual new
    # producer identity change. The old qualified_stage keeps its original BASE.
    body = inspect.getsource(m.qualify)
    old = "'operatorSha256': result['operatorSha256']"
    need(body.count(old) == 2, "exact_two_new_qualification_producer_bindings_required")
    body = body.replace(old, "'operatorSha256': producer_sha()")
    namespace = dict(m.__dict__)
    namespace.update(BASE=BASE, FORMAT=FORMAT, IMPORT=derived_guard(m.IMPORT),
                     producer_sha=lambda: producer_sha(m))
    exec(compile(body, str(Path(__file__).absolute()), "exec"), namespace)
    return namespace["qualify"]


def qualify(m, stage_sha, expected):
    value = review(m, stage_sha)
    need(value["reviewHash"] == expected, "exact_fresh_successor_import_review_required")
    BASE.mkdir(mode=0o700)
    m.sync(BASE.parent)
    m.write_new(BASE / "before.json", encoded(value))
    result = qualifier(m)(stage_sha)
    proof = json.loads(m.read(BASE / "qualification-result.json", result["qualificationResultSha256"]))
    need(proof["operatorSha256"] == value["binding"]["operatorSha256"] == producer_sha(m) and
         0 <= proof["observation"]["nativeMetadataReads"] <= 1 and
         proof["observation"]["counts"] == {"network": 0, "listen": 0, "database": 0, "pool": 0, "spawn": 0},
         "new_producer_and_all_actual_operation_counts_must_match")
    # Reauthenticate both real original failed records; no old receipt is edited.
    m.read(PARENT_BASE / "qualification-intent.json", FAILED_INTENT_SHA)
    m.read(PARENT_BASE / "qualification.stderr", FAILED_STDERR_SHA)
    return {**result, "nativeMetadataReads": proof["observation"]["nativeMetadataReads"],
            "originalFailedImportPreserved": True, "databaseOperations": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage-sha")
    parser.add_argument("--qualify")
    args = parser.parse_args()
    if not args.stage_sha:
        need(args.qualify is None, "actual_stage_required_for_explicit_import")
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "hostQualified": False, "runtimeSelected": False,
                          "databaseConnections": 0, "providerCalls": 0, "serviceActions": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_successor_qualification_expired"))
    signal.alarm(120)
    fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    try:
        row = os.fstat(fd)
        need(stat.S_ISREG(row.st_mode) and row.st_uid == row.st_gid == 0 and row.st_nlink == 1 and
             stat.S_IMODE(row.st_mode) == 0o600, "existing_exact_root_transition_lock_required")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        m = parent()
        value = qualify(m, args.stage_sha, args.qualify) if args.qualify else review(m, args.stage_sha)
        # The binding contains only public digests/flags, no private actor packet.
        print(json.dumps(value, sort_keys=True))
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
