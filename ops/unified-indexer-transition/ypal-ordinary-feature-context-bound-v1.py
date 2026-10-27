#!/usr/bin/env python3
"""Explicit bound reader ancestry for the unchanged genuine feature bodies."""
import ast
import hashlib
import json
from pathlib import Path
import re
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
FILE = OPS / "ypal-ordinary-feature-context-bound-v1.py"
OWNER = "ypal-ordinary-feature-handover-bound-v1.py"
PROVIDER = "ypal-ordinary-read-cache-bound-v1.py"
READER = "ypal-ordinary-reader-bound-v1.py"
READER_MANIFEST = "ypal-ordinary-reader-bound-v1.manifest.json"
FROZEN = OPS / "ypal-ordinary-feature-context-v6.py"
FROZEN_SHA = "743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635"
PINNED = {'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962'}
EXTERNAL = {PROVIDER, READER, READER_MANIFEST}
CONFIG = {"readAdmissionSha256", "readPlanSha256", "readContextInputSha256", "cachePreparedSha256",
          "cacheInputsSha256", "readerResultSha256", "readerManifestSha256", "ordinaryResultSha256", "ordinaryInputSha256"}


def exact_dependencies(value):
    valid = lambda digest: isinstance(digest, str) and re.fullmatch("[a-f0-9]{64}", digest) and digest != "0"*64
    if not (type(value) is dict and set(value) == set(PINNED) | EXTERNAL and
            all(valid(digest) for digest in value.values()) and all(value[name] == digest for name, digest in PINNED.items())):
        raise RuntimeError("finite_actual_bound_feature_templates_and_external_publication_sources_required")
    return dict(value)


def composition():
    h = helper(); changes = {"initialize-owner": 0, "initialize-context": 0, "leaf-owner": 0, "leaf-context": 0}
    def transform(node):
        if isinstance(node, ast.FunctionDef) and node.name in {"initialize", "feature_leaf_binding"}:
            for row in ast.walk(node):
                if not isinstance(row, ast.Constant): continue
                if row.value == "ypal-ordinary-feature-handover-v6.py":
                    row.value = OWNER; changes[("initialize" if node.name == "initialize" else "leaf")+"-owner"] += 1
                elif row.value == "ypal-ordinary-feature-context-v6.py":
                    row.value = FILE.name; changes[("initialize" if node.name == "initialize" else "leaf")+"-context"] += 1
        return node
    value = h.derive(h.public(FROZEN, FROZEN_SHA), FROZEN_SHA, FILE,
        {"FORMAT": FORMAT, "PROVIDER": PROVIDER, "READER": READER, "PINNED": PINNED},
        {"exact_dependencies": exact_dependencies}, transform)
    h.need(changes == {"initialize-owner": 2, "initialize-context": 2, "leaf-owner": 1, "leaf-context": 1},
           "exact_six_bound_feature_manifest_and_leaf_identity_seams_required")
    return value


def acknowledgement_route(h):
    b = h.b; dependencies = exact_dependencies(h.manifest["dependencies"])
    helper().need(h.coordinator.MANIFEST == OPS/READER_MANIFEST and
                  h.config["readerManifestSha256"] == dependencies[READER_MANIFEST],
                  "actual_same_bound_reader_manifest_before_feature_ancestry_required")
    value = b.document(OPS/READER_MANIFEST, dependencies[READER_MANIFEST])
    helper().need(value["acknowledgementRoute"] == {"file": READER, "sha256": dependencies[READER], "method": "acknowledgement"} and
                  value["files"][READER] == dependencies[READER] and
                  value["contexts"]["phase"] == {"file": PROVIDER, "sha256": dependencies[PROVIDER]},
                  "actual_bound_reader_ACK_route_and_same_provider_manifest_required")
    return value["acknowledgementRoute"]


def initialize(host, b, manifest_pin, input_pin, canonical_ref, capture_id):
    composition().initialize(host, b, manifest_pin, input_pin, canonical_ref, capture_id)
    acknowledgement_route(host)


def helpers(b, dependencies): return composition().helpers(b, dependencies)
def reader_ancestry(host):
    acknowledgement_route(host)
    return composition().reader_ancestry(host)
def feature_leaf_binding(host, proof):
    acknowledgement_route(host)
    return composition().feature_leaf_binding(host, proof)
def inverse_leaf(b, result_sha, manifest_sha, input_sha, reader_inverse_refs=None):
    return composition().inverse_leaf(b, result_sha, manifest_sha, input_sha, reader_inverse_refs)
def wrap_leaf_return_seam(value, raw): return composition().wrap_leaf_return_seam(value, raw)


class HostMixin:
    def baseline(self): return composition().HostMixin.baseline(self)
    def fresh_event(self, event, minimum): return composition().HostMixin.fresh_event(self, event, minimum)
    def peers(self): return composition().HostMixin.peers(self)
    def retained_current(self): return composition().HostMixin.retained_current(self)
    def combined(self): return composition().HostMixin.combined(self)
    def source_actor(self, expected=None): return composition().HostMixin.source_actor(self, expected)
    def restart_temporary_source(self, intent, original): return composition().HostMixin.restart_temporary_source(self, intent, original)
    def inverse_source(self): return composition().HostMixin.inverse_source(self)
    def sessions(self, temporary=None): return composition().HostMixin.sessions(self, temporary)
    def queue_proof(self, since, minimum): return composition().HostMixin.queue_proof(self, since, minimum)


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT+"-context", "staticOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
