#!/usr/bin/env python3
"""Thin actual-generation provider over frozen V6; new honest effect identity."""
import ast
import copy
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

FORMAT = "yunipals-ypal-ordinary-read-cache-bound-v1"
FILE = OPS / "ypal-ordinary-read-cache-bound-v1.py"
BASE = Path("/var/backups/yunipals-ypal-ordinary-read-cache-bound-v1-20261025")
INPUT = Path("/var/backups/yunipals-ypal-ordinary-read-cache-bound-input-v1-20261025/input.json")
FROZEN = OPS / "ypal-ordinary-read-cache-v6.py"
FROZEN_SHA = "46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c"
READER = OPS / "ypal-ordinary-reader-bound-v1.py"
COMMON = OPS / "ypal-ordinary-consumer-handover-v5.py"
COMMON_SHA = "dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c"
METADATA_SHA = "9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f"
KEYS = {"readAdmissionSha256", "readPlanSha256", "readContextInputSha256", "metadataSelectionSha256",
        "metadataProvenanceFile", "metadataProvenanceSha256", "generationSha256", "metadataInputSha256",
        "selectorCandidateSha256", "generationBindingSha256"}


def common():
    return helper().load_code(COMMON, COMMON_SHA)


def config_checked(config):
    h = helper()
    frozen = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE, {"KEYS": KEYS})
    return frozen.config_checked(config)


def composed(binding):
    h = helper()
    changes = {"generation-base": 0, "generation-format": 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == "namespace":
            for row in ast.walk(node):
                if isinstance(row, ast.Constant) and row.value == h.RETAINED_BASE:
                    row.value = h.ATTEMPT_BASE; changes["generation-base"] += 1
                elif isinstance(row, ast.Constant) and row.value == "yunipals-ypal-ordinary-generation-candidate-v5c":
                    row.value = h.CANDIDATE_FORMAT; changes["generation-format"] += 1
        return node
    module = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
        {"FORMAT": FORMAT, "FILE": FILE, "BASE": BASE, "INPUT": INPUT, "KEYS": KEYS,
         "GENERATION": OPS / binding.value["owner"]["file"], "GENERATION_SHA": binding.value["owner"]["sha256"],
         "READER": READER}, transform=transform)
    h.need(changes == {"generation-base": 1, "generation-format": 1}, "exact_two_frozen_generation_identity_predicate_seams_required")
    return module


def namespace(config, manifest=None, source_guard=None):
    h = helper(); config = config_checked(config); binding = h.Binding(config["generationBindingSha256"])
    if manifest is not None:
        h.need(manifest["generationBinding"] == {"file": h.MANIFEST.name, "sha256": binding.digest},
               "same_cache_and_reader_generation_binding_required")
    value = composed(binding).namespace(config, manifest, source_guard)
    # Retain the complete original Phase.generation body. Only its capsule
    # location changes, and the new explicit lineage is validated first.
    raw = h.public(OPS / "ypal-restored-read-cache-provider-v1.py", "2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9")
    cls = next(node for node in ast.parse(raw).body if isinstance(node, ast.ClassDef) and node.name == "Phase")
    method = copy.deepcopy(next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "generation"))
    count = 0
    for node in ast.walk(method):
        if isinstance(node, ast.Call) and ast.unparse(node) == "r.document(owner.BASE / 'capsule-result.json', candidate['capsuleResultSha256'])":
            node.args[0] = ast.parse("Path(candidate['capsuleResultFile'])", mode="eval").body; count += 1
    h.need(count == 1, "one_actual_retained_capsule_location_seam_required")
    method.body.insert(0, ast.parse("validate_bound_generation(self)").body[0])
    def validate(phase):
        candidate = phase.host.new_read.document(phase.cache.GENERATION, phase.host.config["generationSha256"])
        binding.candidate(candidate, phase.host.config)
    scope = {**value.Phase.generation.__globals__, "validate_bound_generation": validate}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(FILE), "exec"), scope)
    inherited = value.Phase
    class Phase(inherited):
        generation = scope["generation"]
    value.Phase = Phase
    value.generation_binding = binding
    return value


def cache_runtime(config=None, manifest=None, source_guard=None):
    h = helper()
    if config is None:
        c = common(); raw = h.public(INPUT); config = c.intake().document(INPUT, h.sha(raw))
    return namespace(config, manifest, source_guard).cache_runtime()


def create_phase(inputs, coordinator_manifest, source_guard=None):
    c = common(); config = config_checked(c.intake().document(INPUT, inputs["cacheInputsSha256"]))
    return namespace(config, coordinator_manifest, source_guard).Phase(inputs, coordinator_manifest)


def static_read_host(refs):
    h = helper()
    frozen = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE)
    return frozen.static_read_host(refs)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("bound_publication_operations_require_actual_caller_context_and_timing_gate")
    print(json.dumps({"format": FORMAT, "staticOnly": True, "callerRequired": True,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
