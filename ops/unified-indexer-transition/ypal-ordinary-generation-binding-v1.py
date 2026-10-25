#!/usr/bin/env python3
"""Finite actual generation producer routing; no runtime success authority."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT = "yunipals-ypal-ordinary-generation-binding-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
MANIFEST = OPS / "ypal-ordinary-generation-binding-v1.manifest.json"
OWNER_FILE = "ypal-ordinary-generation-attempt-v2.py"
MONITOR_FILE = "ypal-ordinary-generation-attempt-watch-v2.py"
INSTALLER_FILE = "ypal-generation-runtime-install-v3.py"
OWNER_FORMAT = "yunipals-ypal-ordinary-generation-attempt-v2"
CANDIDATE_FORMAT = "yunipals-ypal-ordinary-generation-attempt-candidate-v2"
ATTEMPT_BASE = "/var/backups/yunipals-ypal-ordinary-generation-attempt-v2-20261025"
ATTEMPT_WORK = "/run/yunipals-ypal-ordinary-generation-attempt-v2-20261025"
ATTEMPT_UNIT = "yunipals-ypal-ordinary-generation-attempt-v2.service"
ATTEMPT_APP = "yunipals_ypal_ordinary_generation_attempt_v2_20261025"
DATA_IDENTITY = {
    "sourceRelease": "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
    "manifestHash": "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112",
    "schema": "unified_ypal_20261023_v1", "schemaOid": "75963410", "buildId": "71e2a7f3b7",
    "readSchema": "yunipals_ownership_4e77f52b_v5", "readSchemaOid": "77370532",
    "readIdentity": "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab", "nativeRelations": 44
}
RETAINED_BASE = "/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025"
RETAINED = {
    "ownerFile": "ypal-ordinary-generation-v5c.py",
    "ownerSha256": "ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da",
    "base": RETAINED_BASE,
    "operationFile": RETAINED_BASE + "/operation.json",
    "operationSha256": "08c4510a38e48a835ba7097234f08a8b07e7f555c0dea6f08b4931f5c8778045",
    "drainedSha256": "1947fe45c0c756647f76bbff6dbef6a5cc00c1bc97498c1d2a75187d9132e894",
    "capsuleFile": RETAINED_BASE + "/capsule-result.json",
    "capsuleSha256": "c5b485d7c28e650d70644effaa5b84c258d32cfc125bcd87876682c9010b9cdd",
    "originalBootArchive": RETAINED_BASE + "/original-boot-link",
    "failedUnit": "yunipals-ypal-ordinary-generation-prepare-v5c.service",
    "failedWork": "/run/yunipals-ypal-ordinary-generation-prepare-v5c-20261025",
    "failedApplicationName": "yunipals_ypal_ordinary_generation_v5c_prepare_20261025",
    "failedInvocation": "0ec51b22c502493aa9c81cbecde084a8",
    "failedResultSha256": "e4b134e73a1ae2348a3996e85050541d3f6161d72173051a088ab7c39b3f09c4",
    "failedIntentSha256": "f79cd28ffe36a02bdf4076b640f3e80f2f0862eda52939428a4392cfb9e2e612",
    "currentGeneration": "103", "previousGeneration": "102", "preservedGenerations": ["103", "102"]
}
ARTIFACT = {
    "digest": "a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a",
    "manifestSha256": "4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442",
    "installerFile": INSTALLER_FILE,
    "installerSha256": "3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b"
}

RECOVERY_COMPONENT = {
    "file": "ypal-ordinary-generation-recovery-semantic-v1.mjs",
    "sha256": "ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff",
    "semantics": {
        "format": "yunipals-generation-recovery-semantic-v1",
        "predecessorComponentSha256": "a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df",
        "aggregateIdentity": ["count", "sha256", "tuple_bytes"],
        "allocatedBytes": "observation-only", "predecessorStrictSuccessClaimed": False
    }
}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def pin(value):
    return type(value) is str and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def public(path, expected=None, maximum=200000):
    path = Path(path)
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_actual_generation_binding_source_required")
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
         "bounded_single_actual_generation_binding_source_required")
    raw = path.read_bytes()
    after = path.lstat()
    need(len(raw) == before.st_size and all(getattr(before, key) == getattr(after, key) for key in
         ["st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns"]) and
         (expected is None or pin(expected) and sha(raw) == expected), "exact_actual_generation_binding_source_required")
    return raw


def literal_source_pins(raw):
    rows = [node for node in ast.parse(raw).body if isinstance(node, ast.Assign) and
            len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "SOURCE_PINS"]
    need(len(rows) == 1, "one_literal_finite_generation_source_closure_required")
    try:
        value = ast.literal_eval(rows[0].value)
    except (ValueError, TypeError, SyntaxError):
        raise RuntimeError("literal_finite_generation_source_closure_required") from None
    need(type(value) is dict and 3 <= len(value) <= 256 and OWNER_FILE not in value and
         all(type(name) is str and re.fullmatch(r"[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)", name) and pin(digest)
             for name, digest in value.items()) and {MONITOR_FILE, INSTALLER_FILE, RETAINED["ownerFile"]} <= set(value),
         "bounded_basename_only_actual_generation_source_closure_required")
    return value


def contract(value):
    need(type(value) is dict and set(value) == {"format", "version", "dataIdentity", "owner", "artifact", "retained", "recoveryComponent", "files"} and
         value["format"] == FORMAT and type(value["version"]) is int and value["version"] == 1 and
         value["dataIdentity"] == DATA_IDENTITY and value["artifact"] == ARTIFACT and value["retained"] == RETAINED and
         value["recoveryComponent"] == RECOVERY_COMPONENT,
         "exact_actual_generation_binding_contract_and_retained_ancestry_required")
    owner = value["owner"]
    need(type(owner) is dict and set(owner) == {"file", "sha256", "format", "candidateFormat", "base", "unit", "work", "applicationName"} and
         owner == {"file": OWNER_FILE, "sha256": owner.get("sha256"), "format": OWNER_FORMAT,
                   "candidateFormat": CANDIDATE_FORMAT, "base": ATTEMPT_BASE, "unit": ATTEMPT_UNIT,
                   "work": ATTEMPT_WORK, "applicationName": ATTEMPT_APP} and pin(owner["sha256"]),
         "fixed_actual_generation_attempt_owner_and_candidate_domain_required")
    files = value["files"]
    need(type(files) is dict and 4 <= len(files) <= 257 and files.get(OWNER_FILE) == owner["sha256"] and
         files.get(INSTALLER_FILE) == ARTIFACT["installerSha256"] and
         files.get(RECOVERY_COMPONENT["file"]) == RECOVERY_COMPONENT["sha256"] and files.get(RETAINED["ownerFile"]) == RETAINED["ownerSha256"] and
         all(type(name) is str and re.fullmatch(r"[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)", name) and pin(digest)
             for name, digest in files.items()), "finite_actual_generation_binding_program_map_required")
    return value


def load_code(path, digest):
    raw = public(path, digest)
    module = types.ModuleType("actual_generation_" + Path(path).stem.replace("-", "_"))
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    return module


class Binding:
    def __init__(self, digest):
        need(pin(digest), "actual_protected_generation_binding_digest_required")
        self.digest = digest
        self.value = contract(json.loads(public(MANIFEST, digest, 40000)))
        # Authenticate the entire declared direct closure before evaluating its
        # owner. Retained loaders continue authenticating their frozen lineage.
        raw = {name: public(OPS / name, expected, 4000000) for name, expected in self.value["files"].items()}
        need(self.value["files"] == {OWNER_FILE: sha(raw[OWNER_FILE]), **literal_source_pins(raw[OWNER_FILE])},
             "same_literal_owner_and_binding_source_closure_required")
        self.owner = load_code(OPS / OWNER_FILE, self.value["owner"]["sha256"])
        need(self.owner.FORMAT == OWNER_FORMAT and self.owner.CANDIDATE_FORMAT == CANDIDATE_FORMAT and
             self.owner.BASE == Path(ATTEMPT_BASE) and self.owner.UNIT == ATTEMPT_UNIT and self.owner.WORK == Path(ATTEMPT_WORK) and
             self.owner.APP == ATTEMPT_APP and self.owner.ARTIFACT == ARTIFACT["digest"] and
             self.owner.ARTIFACT_MANIFEST == ARTIFACT["manifestSha256"] and
             self.owner.RETAINED_OPERATION_SHA == RETAINED["operationSha256"] and
             self.owner.RETAINED_CAPSULE_SHA == RETAINED["capsuleSha256"] and
             self.owner.RECOVERY_FILE == OPS / RECOVERY_COMPONENT["file"] and
             self.owner.RECOVERY_SHA == RECOVERY_COMPONENT["sha256"],
             "actual_generation_owner_exports_must_match_binding_required")
        need(all(callable(getattr(self.owner, name, None)) for name in
                 ["namespace", "validate_candidate_database_current", "validate_retained_current"]),
             "fixed_actual_generation_validation_entrypoints_required")

    def current(self):
        need(contract(json.loads(public(MANIFEST, self.digest, 40000))) == self.value,
             "same_actual_generation_binding_before_effect_required")
        for name, digest in self.value["files"].items():
            public(OPS / name, digest, 4000000)
        return self.value

    def candidate(self, candidate, config):
        self.current()
        need(config["generationBindingSha256"] == self.digest and type(candidate) is dict and
             candidate["format"] == CANDIDATE_FORMAT and candidate["operatorSha256"] == self.value["owner"]["sha256"] and
             candidate["capsuleResultFile"] == RETAINED["capsuleFile"] and candidate["capsuleResultSha256"] == RETAINED["capsuleSha256"] and
             candidate["retainedOperationSha256"] == RETAINED["operationSha256"] and
             candidate["recoveryComponent"] == RECOVERY_COMPONENT and candidate["originalStrictCapsuleVerifierPassed"] is False and
             candidate["sourceRelease"] == DATA_IDENTITY["sourceRelease"] and candidate["readIdentity"] == DATA_IDENTITY["readIdentity"],
             "actual_new_candidate_and_authentic_retained_capsule_binding_required")
        return candidate

    def terminal(self, candidate_sha, candidate):
        self.current()
        value = self.owner.validate_retained_current(candidate_sha)
        keys = {"validated", "readOnly", "candidateSha256", "operatorSha256", "operationSha256", "retainedOperationSha256",
                "capsuleSha256", "capsuleFile", "originalBootArchive", "legacyTerminal", "failedWorkerTerminal",
                "attemptWorkerTerminal", "actualFailedApplicationEmpty", "actualAttemptApplicationEmpty", "databaseWrites", "serviceActions", "providerCalls"}
        need(type(value) is dict and set(value) == keys and
             all(value[key] is True for key in ["validated", "readOnly", "legacyTerminal", "failedWorkerTerminal",
                 "attemptWorkerTerminal", "actualFailedApplicationEmpty", "actualAttemptApplicationEmpty"]) and
             value["candidateSha256"] == candidate_sha and value["operatorSha256"] == self.value["owner"]["sha256"] and
             value["operationSha256"] == candidate["operationSha256"] and value["retainedOperationSha256"] == RETAINED["operationSha256"] and
             value["capsuleSha256"] == RETAINED["capsuleSha256"] and value["capsuleFile"] == RETAINED["capsuleFile"] and
             value["originalBootArchive"] == RETAINED["originalBootArchive"] and
             value["databaseWrites"] == value["serviceActions"] == value["providerCalls"] == 0,
             "genuine_actual_failed_and_new_worker_terminal_and_retained_boot_proof_required")
        return value


def derive(raw, digest, filename, constants=None, overrides=None, transform=None):
    """New honest namespace from byte-authenticated frozen source, no mutation."""
    need(pin(digest) and sha(raw) == digest, "exact_frozen_publication_source_before_binding_required")
    constants, overrides = constants or {}, overrides or {}
    body, changed, omitted = [], set(), set()
    for original in ast.parse(raw).body:
        node = copy.deepcopy(original)
        if isinstance(node, ast.If):
            need(ast.unparse(node.test) == "__name__ == '__main__'", "only_frozen_default_CLI_guard_may_be_omitted")
            continue
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in overrides:
            omitted.add(node.name)
            continue
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in constants:
            name = node.targets[0].id
            value = constants[name]
            expression = "Path(" + repr(str(value)) + ")" if isinstance(value, Path) else repr(value)
            node.value = ast.parse(expression, mode="eval").body
            changed.add(name)
        if transform is not None:
            node = transform(node)
        body.append(node)
    need(changed == set(constants) and omitted == set(overrides), "finite_exact_bound_publication_source_seams_required")
    module = types.ModuleType("bound_publication_" + Path(filename).stem.replace("-", "_"))
    module.__file__ = str(filename)
    module.__dict__.update(overrides)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(filename), "exec"), module.__dict__)
    return module


def build(folder):
    folder = Path(folder)
    raw = (folder / OWNER_FILE).read_bytes()
    sources = literal_source_pins(raw)
    files = {OWNER_FILE: sha(raw), **sources}
    for name, digest in files.items():
        need(sha((folder / name).read_bytes()) == digest, "actual_source_bytes_before_binding_manifest_required")
    return contract({"format": FORMAT, "version": 1, "dataIdentity": DATA_IDENTITY,
                     "owner": {"file": OWNER_FILE, "sha256": files[OWNER_FILE], "format": OWNER_FORMAT,
                               "candidateFormat": CANDIDATE_FORMAT, "base": ATTEMPT_BASE, "unit": ATTEMPT_UNIT,
                               "work": ATTEMPT_WORK, "applicationName": ATTEMPT_APP},
                     "artifact": ARTIFACT, "retained": RETAINED, "recoveryComponent": RECOVERY_COMPONENT, "files": files})


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "candidateAccepted": False,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
