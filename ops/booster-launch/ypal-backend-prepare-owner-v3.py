#!/usr/bin/env python3
"""Inactive preparation: fresh kernel proofs, no pool tuples in static hash.

All old and combined session attribution still runs on every capture. Tuples
are live drain authority only when freshly captured by a later live owner.
"""
import hashlib
import json
from pathlib import Path
import re
import stat
import types

CORE_SHA = "118ed515b420a77862f14463e1dde047c6b8929286652fca61ffa09e65f75a62"


def core():
    path = Path(__file__).absolute().with_name("ypal-backend-prepare-owner-v2.py")
    for item in [*path.parents, path]:
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise RuntimeError("protected_frozen_inactive_successor_required")
    before = path.stat(); raw = path.read_bytes(); after = path.stat()
    fields = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mode, st.st_uid, st.st_gid, st.st_mtime_ns, st.st_ctime_ns)
    if not stat.S_ISREG(before.st_mode) or before.st_size > 20000 or fields(before) != fields(after) or hashlib.sha256(raw).hexdigest() != CORE_SHA:
        raise RuntimeError("exact_frozen_inactive_successor_required")
    wrapper = types.ModuleType("ypal_prepare_v2_frozen"); wrapper.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), wrapper.__dict__)
    module = wrapper.core()
    original = module.stable_snapshot

    def stable_snapshot(value):
        result = original(value)  # Retains the v2 complete positive703 fence.
        result["source"]["sessionAttribution"].pop("oldBackends")
        return result

    module.stable_snapshot = stable_snapshot
    module.__file__ = str(Path(__file__).absolute())
    return module


if __name__ == "__main__":
    try: core().main()
    except BaseException as error:
        print(json.dumps({"format": "yunipals-ypal-backend-owner-v1", "completed": False, "errorClass": type(error).__name__, "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[a-zA-Z0-9_]+", str(error)) else "private_diagnostics_withheld", "automaticRetryAllowed": False, "manualReconciliationRequired": True})); raise SystemExit(1)
