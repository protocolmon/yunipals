#!/usr/bin/env python3
"""Build exact public reader successors for the actual semantic recovery code."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECOVERY = "ypal-ordinary-generation-recovery-semantic-v1.mjs"
RECOVERY_SHA = "ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff"
SQL = "ypal-ordinary-reader-sql-bound-v1.mjs"
PROBE = "ypal-ordinary-reader-probe-bound-v1.mjs"
WIRE = "ypal-ordinary-reader-wire-bound-v1.manifest.json"
WIRE_FORMAT = "yunipals-ypal-ordinary-reader-wire-bound-v1"
FROZEN = {
    "ypal-ordinary-reader-sql-v6.mjs": "fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019",
    "ypal-ordinary-reader-probe-v6.mjs": "5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69",
    "ypal-ordinary-reader-wire-v6.manifest.json": "f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4"
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def build(folder=HERE):
    folder = Path(folder)
    recovery = (folder / RECOVERY).read_bytes()
    need(sha(recovery) == RECOVERY_SHA, "actual_frozen_semantic_recovery_source_before_wire_required")
    frozen = {name: (folder / name).read_bytes() for name in FROZEN}
    need(all(sha(raw) == FROZEN[name] for name, raw in frozen.items()), "exact_frozen_V6_wire_sources_required")
    sql = frozen["ypal-ordinary-reader-sql-v6.mjs"].decode()
    replacements = {
        "ypal-ordinary-generation-recovery-v5.mjs": (RECOVERY, 1),
        "a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df": (RECOVERY_SHA, 2),
        "ypal-ordinary-reader-wire-v6.manifest.json": (WIRE, 1),
        "yunipals-ypal-ordinary-reader-wire-v6": (WIRE_FORMAT, 1),
        "ypal-ordinary-reader-sql-v6.mjs": (SQL, 1)
    }
    for before, (after, count) in replacements.items():
        need(sql.count(before) == count, "finite_exact_reader_SQL_recovery_and_identity_seams_required")
        sql = sql.replace(before, after)
    probe = frozen["ypal-ordinary-reader-probe-v6.mjs"].decode()
    for before, after in [("ypal-ordinary-reader-wire-v6.manifest.json", WIRE), ("ypal-ordinary-reader-probe-v6.mjs", PROBE)]:
        need(probe.count(before) == 1, "finite_exact_reader_probe_wire_and_self_seams_required")
        probe = probe.replace(before, after)
    value = json.loads(frozen["ypal-ordinary-reader-wire-v6.manifest.json"])
    value["format"] = WIRE_FORMAT
    value["files"].pop("ypal-ordinary-reader-sql-v6.mjs")
    value["files"].pop("ypal-ordinary-reader-probe-v6.mjs")
    value["files"].update({SQL: sha(sql.encode()), PROBE: sha(probe.encode())})
    value["dependencies"].pop("ypal-ordinary-generation-recovery-v5.mjs")
    value["dependencies"][RECOVERY] = RECOVERY_SHA
    for name, digest in value["dependencies"].items():
        need(sha((folder / name).read_bytes()) == digest, "actual_reader_wire_dependency_bytes_required")
    return {SQL: sql.encode(), PROBE: probe.encode(), WIRE: (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()}


if __name__ == "__main__":
    print(json.dumps({"staticOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
