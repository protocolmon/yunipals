#!/usr/bin/env python3
"""Thin coordinator and proof with explicit actual generation ancestry."""
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

FORMAT = "yunipals-ypal-ordinary-reader-bound-v1"
FILE = OPS / "ypal-ordinary-reader-bound-v1.py"
BASE = Path("/var/backups/yunipals-ypal-ordinary-reader-bound-v1-20261025")
MANIFEST = OPS / "ypal-ordinary-reader-bound-v1.manifest.json"
PROVIDER = "ypal-ordinary-read-cache-bound-v1.py"
FROZEN_READER = OPS / "ypal-ordinary-reader-cutover-v6.py"
FROZEN_READER_SHA = "7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0"
FROZEN_PROOF = OPS / "ypal-ordinary-reader-proof-v6.py"
FROZEN_PROOF_SHA = "0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5"
FROZEN_MANIFEST = OPS / "ypal-ordinary-reader-cutover-v6.manifest.json"
FROZEN_MANIFEST_SHA = "870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200"
TEMPLATE = OPS / "ypal-native-cutover-v1.py"
TEMPLATE_SHA = "344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b"
FEATURE = "ypal-ordinary-feature-handover-bound-v1.py"
FEATURE_CONTEXT = "ypal-ordinary-feature-context-bound-v1.py"
FEATURE_FORMAT = "yunipals-ypal-ordinary-feature-handover-bound-v1"
FEATURE_MANIFEST = OPS / "ypal-ordinary-feature-handover-bound-v1.manifest.json"
CACHE_FORMAT = "yunipals-ypal-ordinary-cache-finish-bound-v1"
CACHE_BASE = Path("/var/backups/yunipals-ypal-ordinary-cache-finish-bound-v1-20261025")
SQL = "ypal-ordinary-reader-sql-bound-v1.mjs"
PROBE = "ypal-ordinary-reader-probe-bound-v1.mjs"
WIRE = "ypal-ordinary-reader-wire-bound-v1.manifest.json"
WIRE_SHA = "af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf"
TRANSPORT = "ypal-ordinary-reader-peer-bound-v1.py"
TRANSPORT_SHA = "865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4"
QUALIFICATION = Path("/var/backups/yunipals-ypal-ordinary-reader-peer-bound-v1-20261025/qualification-result.json")
CODE = {FILE.name, "ypal-ordinary-cache-finish-v6.py", SQL, PROBE, "ypal-native-cutover-v1.action.sql"}


def protected(path, expected=None, maximum=200000):
    return helper().public(path, expected, maximum)


def external_feature_contract():
    return {"ownerFile": FEATURE, "contextFile": FEATURE_CONTEXT,
            "inputRefs": ["resultSha256", "manifestSha256", "inputSha256", "producerSha256", "contextSha256"],
            "actualRecordedReaderAncestryRequired": True, "acknowledgementFile": FILE.name,
            "acknowledgementMethod": "acknowledgement"}


def manifest_contract(value, binding):
    h = helper(); previous = json.loads(h.public(FROZEN_MANIFEST, FROZEN_MANIFEST_SHA))
    keys = set(previous) | {"generationBinding", "acknowledgementRoute"}
    h.need(type(value) is dict and set(value) == keys and value["format"] == FORMAT + "-source" and
           value["dataIdentity"] == h.DATA_IDENTITY and value["wireManifestSha256"] == WIRE_SHA and
           value["transportQualification"] == {**previous["transportQualification"], "newProducerSha256": TRANSPORT_SHA,
               "newQualificationFile": str(QUALIFICATION)} and
           value["canonicalWitness"] == previous["canonicalWitness"] and
           value["externalFeatureContract"] == external_feature_contract() and
           set(value["files"]) == CODE and not set(value["files"]) & set(value["dependencies"]) and
           value["generationBinding"] == {"file": h.MANIFEST.name, "sha256": binding.digest} and
           value["acknowledgementRoute"] == {"file": FILE.name, "sha256": value["files"].get(FILE.name), "method": "acknowledgement"},
           "finite_actual_bound_reader_manifest_and_acknowledgement_route_required")
    contexts = {**previous["contexts"], "phase": {"file": PROVIDER, "sha256": value["dependencies"].get(PROVIDER)},
                "generation": {"file": h.OWNER_FILE, "sha256": binding.value["owner"]["sha256"]}}
    h.need(value["contexts"] == contexts and h.pin(contexts["phase"]["sha256"]) and
           all(value["dependencies"].get(ref["file"]) == ref["sha256"] for ref in contexts.values()) and
           all(h.pin(digest) and isinstance(name, str) and "/" not in name and "\\" not in name
               for name, digest in {**value["files"], **value["dependencies"]}.items()) and
           all({**value["dependencies"], **value["files"]}.get(name) == digest for name, digest in binding.value["files"].items()) and
           all({**value["dependencies"], **value["files"]}.get(name) == digest
               for name, digest in {**previous["dependencies"], **previous["files"]}.items()) and
           value["dependencies"].get(h.MANIFEST.name) == binding.digest and
           value["dependencies"].get(HELPER.name) == HELPER_SHA and
           value["dependencies"].get(WIRE) == WIRE_SHA and value["dependencies"].get(TRANSPORT) == TRANSPORT_SHA and
           value["files"].get(FILE.name) == h.sha(h.public(FILE)),
           "actual_bound_reader_source_closure_contexts_and_self_identity_required")
    for name, digest in {**value["files"], **value["dependencies"]}.items():
        h.public(OPS / name, digest, 4000000)
    return value


def proof_module(manifest_sha):
    h = helper(); value = json.loads(h.public(MANIFEST, manifest_sha, 100000))
    h.need(value.get("generationBinding", {}).get("file") == h.MANIFEST.name,
           "fixed_generation_binding_manifest_before_proof_required")
    binding = h.Binding(value["generationBinding"]["sha256"])
    manifest_contract(value, binding)
    names = {role: ref["file"] for role, ref in value["contexts"].items()}
    pins = {role: ref["sha256"] for role, ref in value["contexts"].items()}
    def checked_manifest(record):
        return manifest_contract(record, binding)
    def closure_source(path, expected=None, maximum=4000000):
        return h.public(path, expected, maximum)
    changes = {"login-domain": 0, "login-owner": 0, "pure-manifest": 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == "inherited_methods":
            replacements = {
                "yunipals-ypal-ordinary-reader-cutover-v6": (FORMAT, "login-domain"),
                "ypal-ordinary-reader-cutover-v6.py": (FILE.name, "login-owner"),
                "OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'": ("OPS / '" + MANIFEST.name + "'", "pure-manifest")
            }
            for row in ast.walk(node):
                if isinstance(row, ast.Constant) and isinstance(row.value, str) and row.value in replacements:
                    row.value, key = replacements[row.value]; changes[key] += 1
        return node
    module = h.derive(h.public(FROZEN_PROOF, FROZEN_PROOF_SHA), FROZEN_PROOF_SHA, FILE,
        {"FORMAT": FORMAT + "-proof", "BASE": BASE, "MANIFEST": MANIFEST,
         "CONTEXT_NAMES": names, "CONTEXT_PINS": pins, "CODE": CODE, "WIRE_SHA": WIRE_SHA,
         "TRANSPORT": TRANSPORT, "TRANSPORT_SHA": TRANSPORT_SHA, "NEW_QUALIFICATION": QUALIFICATION},
        {"manifest_contract": checked_manifest, "protected": closure_source}, transform)
    h.need(changes == {"login-domain": 1, "login-owner": 1, "pure-manifest": 1},
           "exact_actual_bound_LOGIN_and_pure_manifest_identity_seams_required")
    return module, binding


class Proof:
    """Delegate retained methods through a NEW per-construction namespace.

    Explicit initialize/module_context methods preserve the caller subclass's
    reviewed public constructor seams. Frozen globals are never modified.
    """
    def __init__(self, manifest_sha):
        self._implementation, self.generation_binding = proof_module(manifest_sha)
        self._implementation.Proof.__init__(self, manifest_sha)

    def __getattr__(self, name):
        implementation = object.__getattribute__(self, "_implementation")
        member = implementation.Proof.__dict__.get(name)
        if member is not None and name != "__getattr__":
            return member.__get__(self, type(self))
        return getattr(self.pure, name)

    def initialize(self, context, inputs):
        self.generation_binding.current()
        return self._implementation.Proof.initialize(self, context, inputs)

    def module_context(self, role):
        return self._implementation.Proof.module_context(self, role)

    def source_manifest(self, digest):
        self.generation_binding.current()
        return self._implementation.Proof.source_manifest(self, digest)

    def generation_terminal(self, context):
        _, candidate, _, _ = context.generation()
        self.generation_binding.candidate(candidate, context.host.config)
        return self.generation_binding.terminal(context.host.config["generationSha256"], candidate)

    def cache_finish_module(self, controller, context):
        h = helper()
        h.need(context.proof is self and context.inputs["sourceManifestSha256"] == self.manifest_sha,
               "same_actual_bound_context_for_cache_finish_required")
        name = "ypal-ordinary-cache-finish-v6.py"
        digest = "ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0"
        changes = {"manifest": 0}
        def transform(node):
            if isinstance(node, ast.FunctionDef) and node.name == "assemble":
                for row in ast.walk(node):
                    if isinstance(row, ast.Constant) and row.value == "OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'":
                        row.value = "OPS / '" + MANIFEST.name + "'"; changes["manifest"] += 1
            return node
        wrapper = h.derive(h.public(OPS / name, digest), digest, FILE,
                           {"FORMAT": CACHE_FORMAT, "BASE": CACHE_BASE}, transform=transform)
        h.need(changes == {"manifest": 1}, "one_actual_bound_cache_finish_manifest_seam_required")
        return wrapper.runtime(controller, self)

    def external_feature_leaf(self, context, refs):
        """Authenticate the explicit real feature and this exact bound ACK.

        The feature uses immutable acknowledgement only. Neither side invokes
        the other's feature-aware reader leaf, so no validator recursion or
        circular source hash is introduced.
        """
        h = helper(); self.generation_binding.current()
        keys = {"resultSha256", "manifestSha256", "inputSha256", "producerSha256", "contextSha256"}
        h.need(type(refs) is dict and set(refs) == keys and all(h.pin(value) for value in refs.values()),
               "actual_bound_feature_receipt_owner_context_five_refs_required")
        value = json.loads(h.public(FEATURE_MANIFEST, refs["manifestSha256"], 100000))
        h.need(type(value) is dict and set(value) == {"format", "files", "dependencies"} and
               value["format"] == FEATURE_FORMAT + "-code" and
               value["files"] == {FEATURE: refs["producerSha256"], FEATURE_CONTEXT: refs["contextSha256"]} and
               type(value["dependencies"]) is dict and 2 <= len(value["dependencies"]) <= 256 and
               not set(value["files"]) & set(value["dependencies"]) and
               value["dependencies"].get(FILE.name) == self.pins[FILE.name] and
               value["dependencies"].get(PROVIDER) == self.manifest["contexts"]["phase"]["sha256"],
               "actual_bound_feature_manifest_and_real_reader_provider_sources_required")
        for name, digest in {**value["files"], **value["dependencies"]}.items():
            h.need(type(name) is str and name and "/" not in name and "\\" not in name and
                   name not in {".", ".."} and h.pin(digest), "finite_bound_feature_source_basenames_and_digests_required")
            h.public(OPS / name, digest, 4000000)
        owner = h.load_code(OPS / FEATURE, refs["producerSha256"])
        h.need(owner.CONTEXT == OPS / FEATURE_CONTEXT and owner.FORMAT == FEATURE_FORMAT,
               "fixed_actual_bound_feature_context_and_format_required")
        feature = owner.validate_feature_leaf(refs["resultSha256"], refs["manifestSha256"], refs["inputSha256"])
        result_sha = h.sha(h.public(BASE / "result.json", maximum=3000000))
        recorded = acknowledgement(result_sha, self.manifest_sha)
        expected = {"readerResultSha256": result_sha, "readerManifestSha256": self.manifest_sha,
                    "readerOperatorSha256": self.pins[FILE.name], "readerOperationSha256": recorded["operationSha256"],
                    "readerPublicationSha256": recorded["publicationSha256"], "readConfig": recorded["readConfig"],
                    "cachePreparedSha256": context.inputs["cachePreparedSha256"], "cacheInputsSha256": context.inputs["cacheInputsSha256"]}
        h.need(recorded["operatorSha256"] == self.pins[FILE.name] and recorded["manifestSha256"] == self.manifest_sha and
               recorded["immutableReaderAcknowledgementOnly"] is recorded["validated"] is True and
               recorded["cachePreparedSha256"] == expected["cachePreparedSha256"] and
               recorded["cacheInputsSha256"] == expected["cacheInputsSha256"] and
               feature["format"] == FEATURE_FORMAT and feature["operatorSha256"] == refs["producerSha256"] and
               feature["contextSha256"] == refs["contextSha256"] and feature["receiptSha256"] == refs["resultSha256"] and
               feature["manifestSha256"] == refs["manifestSha256"] and feature["inputSha256"] == refs["inputSha256"] and
               feature["readerAncestry"] == expected and
               feature["validated"] is feature["temporarySourceRetired"] is feature["collectorOnlyCurrentGraphQualified"] is True and
               all(feature[key] is False for key in ["sourceActorQualified", "financialAuthorityQualified", "independentPeerLifecyclesQualified",
                   "allConfiguredSourcesQualified", "originalWholeValidatorsPassed", "current143WholeGraphQualified"]),
               "genuine_bound_feature_leaf_and_exact_actual_bound_reader_publication_ancestry_required")
        return feature


def coordinator_module():
    h = helper(); changes = {"manifest": 0, "inverse-cache-format": 0, "sql-entry": 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name == "assemble":
            for row in ast.walk(node):
                if isinstance(row, ast.Constant) and row.value == "OPS / 'ypal-ordinary-reader-cutover-v6.manifest.json'":
                    row.value = "OPS / '" + MANIFEST.name + "'"; changes["manifest"] += 1
                elif isinstance(row, ast.Constant) and row.value == "OPS / 'ypal-ordinary-reader-sql-v6.mjs'":
                    row.value = "OPS / '" + SQL + "'"; changes["sql-entry"] += 1
        if isinstance(node, ast.FunctionDef) and node.name == "validate_inverse_leaf":
            for row in ast.walk(node):
                if isinstance(row, ast.Constant) and row.value == "yunipals-ypal-ordinary-cache-finish-v6":
                    row.value = CACHE_FORMAT; changes["inverse-cache-format"] += 1
        return node
    module = h.derive(h.public(FROZEN_READER, FROZEN_READER_SHA), FROZEN_READER_SHA, FILE,
        {"FORMAT": FORMAT, "BASE": BASE, "MANIFEST": MANIFEST, "PROOF": FILE.name,
         "WIRE_MANIFEST_SHA": WIRE_SHA}, {"core": core}, transform)
    h.need(changes == {"manifest": 1, "inverse-cache-format": 1, "sql-entry": 1}, "exact_bound_coordinator_manifest_and_inverse_cache_identity_seams_required")
    return module


def assemble(template, proof):
    return coordinator_module().assemble(template, proof)


def core(manifest_sha):
    proof = Proof(manifest_sha)
    return assemble(protected(TEMPLATE, TEMPLATE_SHA), proof), proof


def acknowledgement(result_sha, manifest_sha):
    return coordinator_module().acknowledgement(result_sha, manifest_sha)


def validate_current(result_sha, manifest_sha):
    return coordinator_module().validate_current(result_sha, manifest_sha)


def validate_cache_ready(result_sha, cache_prepared_sha, generation_sha):
    return coordinator_module().validate_cache_ready(result_sha, cache_prepared_sha, generation_sha)


def validate_reader_leaf(result_sha, manifest_sha, feature_refs=None):
    return coordinator_module().validate_reader_leaf(result_sha, manifest_sha, feature_refs)


def validate_cache_leaf(result_sha, manifest_sha, feature_refs=None):
    return coordinator_module().validate_cache_leaf(result_sha, manifest_sha, feature_refs)


def validate_inverse_leaf(result_sha, manifest_sha):
    return coordinator_module().validate_inverse_leaf(result_sha, manifest_sha)


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 1:
        raise SystemExit("bound_publication_operations_require_actual_caller_context_and_timing_gate")
    print(json.dumps({"format": FORMAT, "staticOnly": True, "callerRequired": True,
                      "productionTimingQualified": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
