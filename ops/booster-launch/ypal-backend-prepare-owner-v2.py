#!/usr/bin/env python3
"""Inactive-only v1 owner with an explicit observational pool-churn successor.

Only current combined backend tuples/count leave the static review hash. Every
capture still performs complete kernel attribution. No actor, role, schema,
private input, old-source backend tuple or producer is normalized.
"""
import hashlib
from pathlib import Path
import stat
import types

CORE_SHA = "a1033872bb5c8a5c434ec5bfae4f3d99629c3e2b417de2e1d76e0fa48623aba1"


def core():
    path = Path(__file__).absolute().with_name("ypal-backend-owner-v1.py")
    for item in [*path.parents, path]:
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise RuntimeError("protected_frozen_inactive_owner_required")
    before = path.stat(); raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != CORE_SHA or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (path.stat().st_dev, path.stat().st_ino, path.stat().st_mtime_ns, path.stat().st_ctime_ns):
        raise RuntimeError("exact_frozen_inactive_owner_required")
    module = types.ModuleType("ypal_inactive_owner_core"); module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    original = module.stable_snapshot

    def stable_snapshot(value):
        result = original(value)
        attribution = result["source"]["sessionAttribution"]
        module.need(attribution.get("complete") is True and attribution.get("applicationNameOrAgeInference") is False and attribution.get("sharedRoleZeroSessionsRequired") is False, "positive_complete_kernel_attribution_still_required")
        attribution.pop("sourceRoleBackendCount")
        attribution.pop("combinedBackends")
        return result

    module.stable_snapshot = stable_snapshot
    module.__file__ = str(Path(__file__).absolute())
    return module


if __name__ == "__main__":
    try: core().main()
    except BaseException as error:
        import json
        print(json.dumps({"format": "yunipals-ypal-backend-owner-v1", "completed": False, "errorClass": type(error).__name__, "automaticRetryAllowed": False, "manualReconciliationRequired": True})); raise SystemExit(1)
