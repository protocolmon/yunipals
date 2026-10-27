#!/usr/bin/env python3
"""Render exact existing source bindings or actual protected receipt references.

This builder prints JSON only. It never prepares receipts, starts an owner,
changes a file's mode or chooses a future result hash.
"""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).absolute().parent


def sha(raw): return hashlib.sha256(raw).hexdigest()


def module(path):
    spec = importlib.util.spec_from_file_location("source_only_manifest", path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def sources(directory):
    owner = module(directory / "ypal-alchemy-source-switch-v1.py")
    result = {"format": owner.FORMAT + "-sources", "lifecycle": {"file": "ypal-alchemy-source-switch-v1.py", "sha256": sha((directory / "ypal-alchemy-source-switch-v1.py").read_bytes())}}
    for name, (file, expected) in owner.PINS.items():
        raw = (directory / file).read_bytes()
        owner.need(sha(raw) == expected, "existing_frozen_component_hash_must_match_before_manifest_render")
        result[name] = {"file": file, "sha256": expected}
    raw = (directory / owner.STAGER).read_bytes()
    owner.need(sha(raw) == owner.STAGER_SHA, "existing_reviewed_stager_source_required")
    result["stager"] = {"file": owner.STAGER, "sha256": owner.STAGER_SHA}
    cache = directory / "ypal-alchemy-restart-cache-v1.py"; raw = cache.read_bytes()
    tree = ast.parse(raw)
    owner.need(sha(raw)==owner.CACHE_SHA and any(isinstance(node, ast.FunctionDef) and node.name == "validate_restart_capture" for node in tree.body),
               "existing_concrete_cache_gate_export_required")
    result["cacheGate"] = {"file": cache.name, "sha256": sha(raw)}
    filters=directory/"ypal-alchemy-restart-cache-v1.filters.json";owner.need(sha(filters.read_bytes())==owner.CACHE_FILTERS_SHA,"exact_existing_official_filter_matrix_required")
    result["cacheFilters"]={"file":filters.name,"sha256":owner.CACHE_FILTERS_SHA}
    owner.need(sha((directory/owner.QUALIFICATION["operatorFile"]).read_bytes())==owner.QUALIFICATION["operatorSha256"],"exact_actual_import_v2_producer_required")
    result["stageQualificationReceipt"]=owner.QUALIFICATION
    return result


def actual_input(directory):
    owner = module(directory / "ypal-alchemy-source-switch-v1.py")
    leaf_file, digest = owner.PINS["leaf"]
    owner.need(sha((directory / leaf_file).read_bytes()) == digest, "exact_existing_input_reader_required")
    leaf = module(directory / leaf_file)
    values = {}
    for key, path in {
        "stageResultSha256": owner.STAGE_BASE / "stage-result.json",
        "qualificationResultSha256": Path(owner.QUALIFICATION["file"]),
        "financialPreparedSha256": owner.FINANCIAL_BASE / "prepared.json",
        "planSha256": owner.FINANCIAL_BASE / "plan.json"
    }.items():
        raw = leaf.protected(path); json.loads(raw); values[key] = sha(raw)
    return {"format": owner.FORMAT + "-input", **values}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", type=Path, default=HERE)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--sources", action="store_true"); action.add_argument("--actual-input", action="store_true")
    args = parser.parse_args()
    value = sources(args.source_directory) if args.sources else actual_input(args.source_directory) if args.actual_input else {
        "sourceOnly": True, "manifestRendered": False, "receiptCreated": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}
    print(json.dumps(value, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__": main()
