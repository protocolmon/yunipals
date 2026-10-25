#!/usr/bin/env python3
"""Thin caller; every audit/timing record names the actual bound producers."""
import hashlib
import json
from pathlib import Path
import stat
import types

OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
HELPER = OPS / "ypal-ordinary-generation-binding-v1.py"
HELPER_SHA = "acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962"


def helper():
    for path in [*HELPER.parents, HELPER]:
        row = path.lstat()
        if row.st_uid != 0 or row.st_gid != 0 or stat.S_ISLNK(row.st_mode) or row.st_mode & 0o022:
            raise RuntimeError("protected_generation_binding_helper_required")
    before = HELPER.lstat(); raw = HELPER.read_bytes(); after = HELPER.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 < before.st_size < 100000 or \
       len(raw) != before.st_size or hashlib.sha256(raw).hexdigest() != HELPER_SHA or any(
           getattr(before, key) != getattr(after, key) for key in ["st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"]):
        raise RuntimeError("exact_generation_binding_helper_required")
    value = types.ModuleType("trusted_generation_binding"); value.__file__ = str(HELPER)
    exec(compile(raw, str(HELPER), "exec"), value.__dict__)
    return value

FORMAT = "yunipals-ypal-ordinary-publication-bound-v1"
FILE = OPS / "ypal-ordinary-publication-bound-v1.py"
BASE = Path("/var/backups/yunipals-ypal-ordinary-publication-bound-v1-20261025")
FROZEN = OPS / "ypal-ordinary-publication-caller-v6.py"
FROZEN_SHA = "c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a"
PROVIDER = OPS / "ypal-ordinary-read-cache-bound-v1.py"
PROVIDER_SHA = "7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f"
READER = OPS / "ypal-ordinary-reader-bound-v1.py"
READER_SHA = "7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17"


def composed():
    h = helper()
    module = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
        {"FORMAT": FORMAT, "BASE": BASE, "PROVIDER": PROVIDER, "PROVIDER_SHA": PROVIDER_SHA,
         "READER": READER, "READER_SHA": READER_SHA, "PROOF": READER, "PROOF_SHA": READER_SHA})
    original = module.timing_key
    def timing_key(session, mode):
        value = original(session, mode)
        config = session.host.config if session.key["target"] == "cache" else session.context.host.config
        digest = config["generationBindingSha256"]
        h.need(h.pin(digest), "actual_generation_binding_before_callback_timing_required")
        return {**value, "generationBindingSha256": digest, "generationBindingHelperSha256": HELPER_SHA}
    # Only this new namespace is populated; no frozen module is imported or
    # mutated. Its complete business, audit and unknown-effect bodies remain.
    module.timing_key = timing_key
    return module


class Session:
    def __new__(cls, source_refs, inverse=False):
        return composed().Session(source_refs, inverse)


def qualify(session, capture_id):
    return composed().qualify(session, capture_id)


def execute_cache(session, action, args, attempt_id, timing_receipt=None):
    return composed().execute_cache(session, action, args, attempt_id, timing_receipt)


def execute_reader(session, action, args, attempt_id, timing_receipt=None):
    return composed().execute_reader(session, action, args, attempt_id, timing_receipt)


def require_timing(session, receipt, mode):
    return composed().require_timing(session, receipt, mode)


def timing_key(session, mode):
    return composed().timing_key(session, mode)


def reader_inverse_core(session):
    return composed().reader_inverse_core(session)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("bound_publication_requires_explicit_actual_session")
    print(json.dumps({"format": FORMAT, "staticOnly": True, "productionTimingQualified": False,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
