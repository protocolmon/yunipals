#!/usr/bin/env python3
"""Finite managed-owner source binding; default and import have no effects."""
import ast
import hashlib
import json
from pathlib import Path
import re

FORMAT = "yunipals-ordinary-managed-source-binding-continue-v5"
OWNER = "ypal-ordinary-managed-handover-continue-v5.py"
MANIFEST = "ypal-ordinary-managed-handover-continue-v5.manifest.json"
FOUNDATION = "ypal-ordinary-managed-runtime-v2.py"
FOUNDATION_SHA = "1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199"
PREDECESSOR = "ypal-ordinary-managed-handover-v3.py"
PREDECESSOR_SHA = "8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def pin(value): return type(value) is str and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64
def basename(value): return type(value) is str and re.fullmatch(r"[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)", value) is not None


def source_pins(raw):
    rows = [row for row in ast.parse(raw).body if isinstance(row, ast.Assign) and len(row.targets) == 1 and
            isinstance(row.targets[0], ast.Name) and row.targets[0].id == "SOURCE_PINS"]
    need(len(rows) == 1, "one_literal_managed_source_closure_required")
    try:
        value = ast.literal_eval(rows[0].value)
    except (ValueError, TypeError, SyntaxError):
        raise RuntimeError("literal_managed_source_closure_required") from None
    need(type(value) is dict and 4 <= len(value) <= 512 and OWNER not in value and
         value.get(FOUNDATION) == FOUNDATION_SHA and value.get(PREDECESSOR) == PREDECESSOR_SHA and
         all(basename(name) and pin(digest) and not name.startswith("ypal-ordinary-postmanaged-") for name, digest in value.items()),
         "finite_managed_owner_ancestry_without_consumer_backedge_required")
    return value


def authenticate(value, producer_sha, public):
    need(pin(producer_sha) and type(value) is dict and set(value) == {"format", "files"} and value["format"] == FORMAT,
         "exact_explicit_managed_source_binding_required")
    files = value["files"]
    need(type(files) is dict and 5 <= len(files) <= 513 and files.get(OWNER) == producer_sha and
         all(basename(name) and pin(digest) for name, digest in files.items()), "finite_actual_managed_source_map_required")
    # Every source is authenticated before the caller may evaluate the owner.
    raw = {name: public(name, digest, 4000000) for name, digest in files.items()}
    need(files == {OWNER: sha(raw[OWNER]), **source_pins(raw[OWNER])}, "same_literal_managed_owner_and_binding_closure_required")
    return value


def build(folder):
    folder = Path(folder)
    raw = (folder / OWNER).read_bytes()
    files = {OWNER: sha(raw), **source_pins(raw)}
    value = {"format": FORMAT, "files": files}
    def public(name, digest, maximum):
        path = folder / name
        if not path.exists() and name == "final-supervisor-inventory-v1.py" and digest == "ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912":
            path = folder.parent / "solana-acceptance" / name
        if not path.exists() and name == "ypal-old-runtime-inventory-v1.py" and digest == "7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b":
            path = folder.parent / "booster-launch" / name
        content = path.read_bytes()
        need(0 < len(content) <= maximum and sha(content) == digest, "actual_existing_managed_binding_source_bytes_required")
        return content
    return authenticate(value, files[OWNER], public)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    args = parser.parse_args()
    value = build(Path(__file__).resolve().parent) if args.build else {
        "format": FORMAT, "staticOnly": True, "inputWrites": 0, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}
    print(json.dumps(value, sort_keys=True, indent=2))
