#!/usr/bin/env python3
"""V5 canonical capture over explicit new official readiness and real V5 ACK.

The original 721 capture flow, HTTP counters and unknown-intent refusal execute
in a new namespace. Old V4/fc461/cb2 captures remain unchanged and unqualified.
"""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import types

FORMAT = "yunipals-ypal-alchemy-ordinary-witness-v5"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-ordinary-v5-fixed-boundary-witness-v1-20261025")
TEMPLATE = OPS / "ypal-alchemy-ordinary-witness-v1.py"
TEMPLATE_SHA = "721cb61ff3ad87efc2a3caa331c98fc43ddf65d47a122d65bf1b24b6fddce239"
FACTORY = OPS / "ypal-fresh-forward-epoch-v1.py"
FACTORY_SHA = "0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c"
CREATOR = OPS / "ypal-ordinary-readview-v5.py"
CREATOR_SHA = "1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2"
CREATED = Path("/var/backups/yunipals-ypal-ordinary-readview-v5-20261025/created.json")
CREATED_SHA = "5acb7de8be040d76458d2a8e2c0792f33df89a9f790e94377c177cd4f75d7337"
READ_SCHEMA = "yunipals_ownership_4e77f52b_v5"
READ_IDENTITY = "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab"
SCHEMA_OID = "77370532"
OLD_CAPTURE = Path("/var/backups/yunipals-ypal-ordinary-fixed-boundary-witness-v1-20261024/captures/ordinary-initial/witness.json")
OLD_CAPTURE_SHA = "cb2fac1dfeaa6ed8e8eca4c23378a026e33628138779eba2f804759b13ec3931"
PROGRAMS = {
    "fixed-boundary-witness-v5.mjs": "359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484",
    "fixed-boundary-witness-v3.mjs": "bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c",
    "ownership-parity-peer-v4.mjs": "b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e",
    "ownership-parity-peer-v2.mjs": "d1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920",
    "ypal-v5-witness-official-v1.mjs": "347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc",
    "ypal-v5-witness-official-v1.sources.json": "ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3",
    "ypal-ordinary-readview-v5.py": CREATOR_SHA
}


def need(value, code):
    if not value: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()


def source(path, digest):
    import stat
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_V5_witness_source_required")
    before = path.lstat(); raw = path.read_bytes()
    need(before.st_size <= 200000 and before.st_nlink == 1 and sha(raw) == digest and
         before.st_ino == path.lstat().st_ino and before.st_mtime_ns == path.lstat().st_mtime_ns,
         "exact_V5_witness_source_required")
    return raw


def namespace():
    raw = source(FACTORY, FACTORY_SHA); factory = types.ModuleType("V5_witness_namespace_factory"); factory.__file__ = str(FACTORY)
    exec(compile(raw, str(FACTORY), "exec"), factory.__dict__)
    changes = {"run": 0, "format": 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            for item in ast.walk(node):
                if isinstance(item, ast.Assign) and ast.unparse(item) == "argv = [str(NODE), '--import', str(LOADER), str(WITNESS), '--plan', str(base / 'plan.json')]":
                    item.value.elts = [item.value.elts[0], *item.value.elts[3:]]; changes["run"] += 1
        if isinstance(node, ast.FunctionDef) and node.name == "capture":
            for item in ast.walk(node):
                if isinstance(item, ast.Constant) and item.value == "yunipals-ypal-fixed-boundary-witness-v3":
                    item.value = "yunipals-ypal-fixed-boundary-witness-v5"; changes["format"] += 1
        return node
    n = factory.namespace(source(TEMPLATE, TEMPLATE_SHA), TEMPLATE_SHA, Path(__file__).absolute(),
        {"FORMAT": FORMAT, "BASE": BASE, "WITNESS": OPS / "fixed-boundary-witness-v5.mjs", "PROGRAMS": PROGRAMS}, transform=transform)
    need(changes == {"run": 1, "format": 1}, "only_direct_JS_run_and_new_capture_format_seams_required")
    old_plan, old_frame, old_run = n.plan, n.frame, n.run

    def program_inputs():
        for name, digest in PROGRAMS.items(): n.protected(OPS / name, digest, 200000)
        n.protected(n.NODE, n.NODE_SHA, 200000000); n.protected(n.PARITY, n.PARITY_SHA)
        n.protected(n.OLD_FAILED, n.OLD_FAILED_SHA); n.protected(OLD_CAPTURE, OLD_CAPTURE_SHA)
        n.protected(CREATED, CREATED_SHA)
        return {"programs": PROGRAMS, "nodeSha256": n.NODE_SHA, "tsxLoaderUsed": False,
            "candidateParitySha256": n.PARITY_SHA, "preservedFailedWitnessSha256": n.OLD_FAILED_SHA,
            "preservedOrdinaryV4WitnessSha256": OLD_CAPTURE_SHA, "v5CreatedReceiptSha256": CREATED_SHA}

    def plan(base):
        return {"format": "yunipals-ypal-fixed-boundary-witness-v5-plan",
                "retainedRuntimePlanFile": str(base / "retained-runtime-plan.json"),
                "retainedRuntimePlanSha256": n.sha(n.encoded(old_plan(base))),
                "createdReceiptSha256": CREATED_SHA, "output": str(base / "witness.json")}

    def run(base, phase, expected=None):
        target = base / "retained-runtime-plan.json"
        if phase == "review":
            need(not os.path.lexists(target), "new_retained_runtime_plan_file_required")
            n.save(base, target.name, old_plan(base))
        need(n.document(target, plan(base)["retainedRuntimePlanSha256"]) == old_plan(base), "same_separate_retained_runtime_plan_required")
        return old_run(base, phase, expected)

    def frame(result_sha, input_sha):
        value = old_frame(result_sha, input_sha)
        creator = n.module(CREATOR, CREATOR_SHA); data = creator.data_current(CREATED_SHA)
        need(data["validated"] is data["createdAcknowledged"] is data["readviewDataOnly"] is True and
             data["readSchema"] == READ_SCHEMA and data["readIdentity"] == READ_IDENTITY and data["schemaOid"] == SCHEMA_OID and
             data["receiptSha256"] == CREATED_SHA and data["sourceActorQualified"] is data["currentWriterQualified"] is
             data["permissionAuthorityQualified"] is data["currentRoleGraphQualified"] is False,
             "actual_current_V5_created_OIDs_body_marker_without_permission_or_writer_claim_required")
        value["stable"]["v5ReadContext"] = {"producerSha256": CREATOR_SHA, "receiptSha256": CREATED_SHA,
            "readSchema": READ_SCHEMA, "readIdentity": READ_IDENTITY, "schemaOid": SCHEMA_OID,
            "dataIdentitySha256": data["dataIdentitySha256"]}
        return value

    # Only this explicitly NEW namespace changes; 721 and its recorded globals
    # remain untouched. Prepare/capture/unknown-intent/HTTP accounting are reused.
    n.program_inputs, n.plan, n.run, n.frame = program_inputs, plan, run, frame
    return n


def main():
    import sys
    if len(sys.argv) == 1:
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    namespace().main()


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_V5_witness_wrapper_deadline")); signal.alarm(900)
    try: main()
    except Exception as error:
        code = str(error); print(json.dumps({"format": FORMAT, "completed": False,
            "fixedCode": code if type(error) is RuntimeError and re.fullmatch("[a-zA-Z0-9_]+", code) else type(error).__name__,
            "automaticRetryAllowed": False, "databaseWrites": 0, "serviceActions": 0})); raise SystemExit(1)
    finally: signal.alarm(0)
