#!/usr/bin/env python3
"""Build actual finite manifests from existing sources; no runtime success."""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def digest(folder, name):
    return hashlib.sha256((Path(folder) / name).read_bytes()).hexdigest()


def build(folder=HERE):
    folder = Path(folder)
    h = module("ypal-ordinary-generation-binding-v1.py")
    r = module("ypal-ordinary-reader-bound-v1.py")
    binding = h.build(folder)
    raw_binding = (json.dumps(binding, sort_keys=True, indent=2) + "\n").encode()
    binding_sha = h.sha(raw_binding)
    h.need(digest(folder, r.FROZEN_MANIFEST.name) == r.FROZEN_MANIFEST_SHA,
           "exact_frozen_V6_manifest_before_actual_binding_required")
    value = json.loads((folder / r.FROZEN_MANIFEST.name).read_bytes())
    for name in ["ypal-ordinary-reader-cutover-v6.py", "ypal-ordinary-reader-proof-v6.py",
                 "ypal-ordinary-reader-sql-v6.mjs", "ypal-ordinary-reader-probe-v6.mjs"]:
        value["dependencies"][name] = value["files"].pop(name)
    value["files"][r.FILE.name] = digest(folder, r.FILE.name)
    value["files"].update({r.SQL: digest(folder, r.SQL), r.PROBE: digest(folder, r.PROBE)})
    value["dependencies"].update(binding["files"])
    for name in ["ypal-ordinary-generation-binding-v1.py", "ypal-ordinary-read-cache-bound-v1.py",
                 "ypal-ordinary-publication-bound-v1.py", "ypal-ordinary-publication-caller-v6.py", r.FROZEN_MANIFEST.name, r.WIRE, r.TRANSPORT]:
        value["dependencies"][name] = digest(folder, name)
    value["dependencies"][h.MANIFEST.name] = binding_sha
    value["contexts"]["phase"] = {"file": r.PROVIDER, "sha256": digest(folder, r.PROVIDER)}
    value["contexts"]["generation"] = {"file": h.OWNER_FILE, "sha256": binding["owner"]["sha256"]}
    value["format"] = r.FORMAT + "-source"
    value["wireManifestSha256"] = r.WIRE_SHA
    value["transportQualification"].update(newProducerSha256=r.TRANSPORT_SHA, newQualificationFile=str(r.QUALIFICATION))
    value["externalFeatureContract"] = r.external_feature_contract()
    value["generationBinding"] = {"file": h.MANIFEST.name, "sha256": binding_sha}
    value["acknowledgementRoute"] = {"file": r.FILE.name, "sha256": value["files"][r.FILE.name], "method": "acknowledgement"}
    for name in value["files"]:
        value["dependencies"].pop(name, None)
    h.need(set(value["files"]) == r.CODE and not set(value["files"]) & set(value["dependencies"]),
           "finite_actual_bound_manifest_file_roles_required")
    for name, expected in {**value["files"], **value["dependencies"]}.items():
        if name != h.MANIFEST.name:
            h.need(digest(folder, name) == expected, "actual_frozen_and_new_source_bytes_before_bound_manifest_required")
    return {h.MANIFEST.name: binding, r.MANIFEST.name: value}


if __name__ == "__main__":
    print(json.dumps({"staticOnly": True, "builderRequiresExplicitSourceInvocation": True,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
