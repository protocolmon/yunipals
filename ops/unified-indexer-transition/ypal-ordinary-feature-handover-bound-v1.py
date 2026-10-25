#!/usr/bin/env python3
"""Thin explicit feature namespace over reviewed transaction/lifecycle bodies."""
import ast
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

FORMAT = "yunipals-ypal-ordinary-feature-handover-bound-v1"
FILE = OPS / "ypal-ordinary-feature-handover-bound-v1.py"
CONTEXT = OPS / "ypal-ordinary-feature-context-bound-v1.py"
MANIFEST = OPS / "ypal-ordinary-feature-handover-bound-v1.manifest.json"
BASE = Path("/var/backups/yunipals-ypal-ordinary-feature-handover-bound-v1-20261025")
INPUT = Path("/var/backups/yunipals-ypal-ordinary-feature-input-bound-v1-20261025/config.json")
FROZEN = OPS / "ypal-ordinary-feature-handover-v6.py"
FROZEN_SHA = "4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312"


def composition():
    h = helper(); changes = {"selector": 0, "drop": 0, "context-label": 0}
    replacements = {
        "Path('/etc/yunipals-unified/booster-ypal-ordinary-v6.public.env')":
            ("Path('/etc/yunipals-unified/booster-ypal-feature-bound-v1.public.env')", "selector"),
        "{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-ordinary-v6.conf') for u in (API, QUEUE)}":
            ("{u: Path('/etc/systemd/system') / (u + '.d/98-ypal-feature-bound-v1.conf') for u in (API, QUEUE)}", "drop"),
        "ordinary_feature_V6_context": ("actual_bound_feature_context", "context-label")
    }
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name in {"assemble", "runtime"}:
            for row in ast.walk(node):
                if isinstance(row, ast.Constant) and isinstance(row.value, str) and row.value in replacements:
                    row.value, key = replacements[row.value]; changes[key] += 1
        return node
    value = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
        {"FORMAT": FORMAT, "BASE": BASE, "INPUT": INPUT, "MANIFEST": MANIFEST, "CONTEXT": CONTEXT}, transform=transform)
    h.need(changes == {"selector": 1, "drop": 1, "context-label": 1},
           "exact_three_actual_bound_feature_owner_identity_seams_required")
    return value


def assemble(raw, context, assembler_raw):
    return composition().assemble(raw, context, assembler_raw)


def runtime(manifest_sha):
    return composition().runtime(manifest_sha)


def validate_feature_leaf(result_sha, manifest_sha, input_sha):
    return runtime(manifest_sha).validate_feature_leaf(result_sha, manifest_sha, input_sha)


def validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    return runtime(manifest_sha).validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs)


def main():
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "eventRequiredBeforeRetirement": True,
                          "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    composition().main()


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        import re
        print(json.dumps({"format": FORMAT, "completed": False, "errorClass": type(error).__name__,
                          "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else "private_diagnostics_withheld",
                          "automaticRetryAllowed": False})); raise SystemExit(1)
