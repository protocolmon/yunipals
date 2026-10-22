#!/usr/bin/env python3
"""Stage four exact public artifacts without overwrites or runtime actions.

The exact peer-qualified immutable feature successor must already be staged.
No private files are copied; this operator cannot start the supervisor.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import tempfile

ROOT = Path("/opt/yunipals-unified/operations")
FINAL_HELPER_SHA = "8ad5845ef641ad74bd4fbead7b01be74e5db4fbf54c8bbe140366267e5c06eab"
FEATURE_RELATIVE = "free-replay-20261020/booster-feature-handover-v5.py"
FEATURE_SHA = "3dc1889e9d0cf9233d71324c7b1a4af88da7bd5bd103f9b44d756aaab91e4e50"
FEATURE_REVIEW = Path("/var/backups/yunipals-booster-feature-handover-v5-20261022/grants-review.json")
FEATURE_REVIEW_SHA = "494782f54be0fd4d7c008dba339978fb38f992e3ee4aac9cee8ed2883a11448e"
FEATURE_REVIEW_HASH = "8c2d999724106aa9b5c3ca0148020f831c14f4d3c20ef1dc64ee0ae5ac514d15"
PAYLOADS = {
    "final-supervisor-handover-v2.py": ("free-replay-20261020/final-supervisor-handover-v2.py", None),
    "final-supervisor-resources-v1.conf.example": ("free-replay-20261020/final-supervisor-resources-v1.conf.example", "d72a2f712b6667aa9aed9766d7f77d10fda5f6a01fb8455cf03cd60c00a42651"),
    "supervisor-handover-state-v1.sql": ("free-replay-20261020/supervisor-handover-state-v1.sql", "2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0"),
    "normal-transport-final-v4.conf": ("solana-consolidation-final-20261022-v4/normal-transport-final-v4.conf", "bd39471bb3899cd001b74b2d1296785f46760f3d31277392d1a521e588e094c8")
}
RETAINED = {
    "free-replay-20261020/final-supervisor-handover-v1.py": "848150920dd624b65832b9a9a87e35f8d6f8831052b3598ac8b93275c886dd92",
    "free-replay-20261020/consumer-operational-marketplace-ack-v2.py": "9a5190ee5bbb74ea72bd128359e1c14ead3083148b430210515119d82851ef4d",
    "free-replay-20261020/consumer-accepted-marketplace-acl-v2.py": "4fa510efd86714404655403617d46cd597fb099b6ed3d9a003cf293269c34a36",
    "free-replay-20261020/normal-rpc-profile-v1.json": "0efe9214bb3cb2d833a8ee93cabefed30a834215a27ca346a85724e4d2b5f81e",
    "solana-consolidation-final-20261021-v1/ponder-normal-final-v1.public.env": "f8adcd0dd13a9f5ae26edec713c960bf459108b86718387742af1b365235d710"
}


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def ancestry(path):
    require(path.is_absolute() and ".." not in path.parts, "fixed_absolute_stage_path_required")
    for parent in path.parents:
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and
                (not info.st_mode & 0o022 or info.st_mode & stat.S_ISVTX), "protected_stage_ancestry_required")


def read(path):
    path = Path(path)
    ancestry(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and
            not before.st_mode & 0o022 and before.st_size < 2_000_000, "bounded_public_stage_file_required")
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as stream:
        raw = stream.read(2_000_000)
        after = os.fstat(stream.fileno())
    identity = lambda info:(info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid,info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
    require(identity(before) == identity(after) == identity(path.lstat()), "stage_input_changed_while_reading")
    return raw


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive(path, raw):
    descriptor, temporary_name = tempfile.mkstemp(prefix=".public-supervisor-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path, follow_symlinks=False)
        except FileExistsError:
            require(read(path) == raw, "foreign_public_stage_file_cannot_be_overwritten")
        sync(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def stage(source, *, apply=False, root=ROOT):
    require(FINAL_HELPER_SHA is not None and FEATURE_RELATIVE is not None and FEATURE_SHA is not None,
            "corrected_peer_qualified_feature_owner_and_final_helper_pins_required")
    source, root = Path(source), Path(root)
    retained = {**RETAINED, FEATURE_RELATIVE: FEATURE_SHA}
    for relative, pin in retained.items():
        require(sha(read(root / relative)) == pin, "retained_public_dependency_changed")
    review_raw = read(FEATURE_REVIEW)
    require(sha(review_raw) == FEATURE_REVIEW_SHA, "actual_qualified_feature_rehearsal_file_required")
    review = json.loads(review_raw)
    binding_sha = sha((json.dumps(review["binding"], sort_keys=True, separators=(",", ":")) + "\n").encode())
    require(review.get("actualRollbackRehearsed") is True and
            review.get("reviewHash") == FEATURE_REVIEW_HASH == binding_sha and
            review["binding"].get("operatorSha256") == FEATURE_SHA,
            "actual_v5_owned_rollback_qualification_required")
    qualified = {"file": str(FEATURE_REVIEW), "sha256": FEATURE_REVIEW_SHA,
                 "reviewHash": FEATURE_REVIEW_HASH, "actualRollbackRehearsed": True}
    pending, rows = [], []
    for name, (relative, frozen) in PAYLOADS.items():
        pin = FINAL_HELPER_SHA if name == "final-supervisor-handover-v2.py" else frozen
        raw = read(source / name)
        require(sha(raw) == pin, "exact_public_payload_required")
        destination = root / relative
        if destination.parent.exists():
            ancestry(destination)
        else:
            require(destination.parent == root / "solana-consolidation-final-20261022-v4", "only_new_v4_stage_directory_allowed")
            ancestry(destination.parent)
        exists = os.path.lexists(destination)
        if exists:
            require(read(destination) == raw, "foreign_public_stage_file_cannot_be_overwritten")
        else:
            pending.append((destination, raw))
        rows.append({"path": str(destination), "sha256": pin, "alreadyPresent": exists})
    if apply:
        for destination, raw in pending:
            if not destination.parent.exists():
                destination.parent.mkdir(mode=0o755)
                sync(root)
            ancestry(destination)
            exclusive(destination, raw)
        require(all(sha(read(Path(row["path"]))) == row["sha256"] for row in rows), "staged_public_bytes_must_match")
    return {"format": "yunipals-final-supervisor-public-stage-v1", "staged": apply, "files": rows,
            "retainedPublicDependencies": retained, "qualifiedFeatureRehearsal": qualified,
            "privateFilesCopied": 0, "serviceActions": 0,
            "databaseWrites": 0, "providerCalls": 0, "liveSelectionChanged": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    require(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "root_on_exact_host_required")
    print(json.dumps(stage(args.source, apply=args.apply), sort_keys=True))
