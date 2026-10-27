#!/usr/bin/env python3
"""Actual semantic-recovery public closure over the exact V6 sealed transport."""
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

FORMAT = "yunipals-ordinary-reader-peer-bound-v1"
FILE = OPS / "ypal-ordinary-reader-peer-bound-v1.py"
BASE = Path("/var/backups/yunipals-ypal-ordinary-reader-peer-bound-v1-20261025")
FROZEN = OPS / "ypal-ordinary-reader-peer-v6.py"
FROZEN_SHA = "91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6"
LOADER = OPS / "ypal-reader-peer-runtime-v1.mjs"
LOADER_SHA = "6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1"
NODE = "/opt/node-v24.18.1/bin/node"
WIRE = "ypal-ordinary-reader-wire-bound-v1.manifest.json"
PINS = {'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}
EXPORTS = {"sha", "encoded", "public_bytes", "inputs", "sealed", "Transport", "public_transport", "QUALIFY_SCRIPT",
           "peer", "dependency_current", "qualify", "capture", "main", "PROJECT", "MAIN", "MAIN_MANIFEST_SHA"}


def composition():
    h = helper(); changes = {"wire-file": 0, "wire-format": 0, "sql": 0, "probe": 0}
    replacements = {
        "ypal-ordinary-reader-wire-v6.manifest.json": (WIRE, "wire-file"),
        "yunipals-ypal-ordinary-reader-wire-v6": ("yunipals-ypal-ordinary-reader-wire-bound-v1", "wire-format"),
        "ypal-ordinary-reader-sql-v6.mjs": ("ypal-ordinary-reader-sql-bound-v1.mjs", "sql"),
        "ypal-ordinary-reader-probe-v6.mjs": ("ypal-ordinary-reader-probe-bound-v1.mjs", "probe")
    }
    def transform(node):
        for row in ast.walk(node):
            if isinstance(row, ast.Constant) and isinstance(row.value, str) and row.value in replacements:
                row.value, key = replacements[row.value]; changes[key] += 1
        return node
    value = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
                     {"FORMAT": FORMAT, "BASE": BASE, "OPS": OPS, "NODE": NODE,
                      "LOADER": LOADER, "LOADER_SHA": LOADER_SHA, "PINS": PINS}, transform=transform)
    h.need(changes == {"wire-file": 3, "wire-format": 1, "sql": 1, "probe": 1},
           "exact_finite_semantic_reader_transport_identity_seams_required")
    return value


def __getattr__(name):
    if name not in EXPORTS:
        raise AttributeError(name)
    return getattr(composition(), name)


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({"format": FORMAT, "staticOnly": True, "qualifiedPublicTransport": False,
                          "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
    else:
        composition().main()
