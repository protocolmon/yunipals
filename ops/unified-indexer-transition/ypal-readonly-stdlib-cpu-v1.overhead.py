#!/usr/bin/env python3
"""Local stdlib overhead only; compile module definitions into fresh namespaces."""
import argparse
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics
import time

HERE = Path(__file__).resolve().parent


def load():
    path = HERE / "ypal-readonly-stdlib-cpu-v1.py"
    spec = importlib.util.spec_from_file_location("stdlib_overhead_observer", path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json-file", type=Path, default=HERE / "ypal-ordinary-reader-continue-v5.manifest.json")
    parser.add_argument("--iterations", type=int, default=4)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()
    if not 1 <= args.iterations <= 20 or not 1 <= args.rounds <= 5:
        raise ValueError("bounded_local_overhead_iterations_required")
    raw_json = args.json_file.read_bytes()
    if not 0 < len(raw_json) <= 40000000:
        raise ValueError("bounded_local_JSON_fixture_required")
    data = json.loads(raw_json)
    source_path = HERE / "ypal-restored-metadata-handover-v1.py"
    source = source_path.read_bytes()
    helper = load()

    def unit():
        tree = ast.parse(source, filename=str(source_path))
        copied = copy.deepcopy(tree)
        code = compile(copied, str(source_path), "exec", dont_inherit=True, optimize=0)
        namespace = {"__name__": "local_definition_only_fixture", "__file__": str(source_path)}
        # Only top-level definitions/imports/constants execute. No Host,
        # metadata, current, query, callback or service method is called.
        exec(code, namespace)
        encoded = json.dumps(data, sort_keys=True, separators=(",", ":"))
        decoded = json.loads(encoded)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        return digest, namespace, len(decoded)

    unit()  # Import warmup outside both measurements.
    measurements = []
    digests = set()
    namespace_samples = []
    for round_number in range(args.rounds):
        for observed in (False, True):
            observer = helper.StdlibCPUDurations()
            wall = time.perf_counter_ns()
            cpu = time.process_time_ns()
            if observed:
                with observer:
                    results = [unit() for _ in range(args.iterations)]
            else:
                results = [unit() for _ in range(args.iterations)]
            row = {"round": round_number + 1, "observed": observed,
                "wallNanoseconds": time.perf_counter_ns() - wall,
                "parentCPUNanoseconds": time.process_time_ns() - cpu}
            if observed:
                snapshot = observer.snapshot()
                if not snapshot["allOriginalStdlibObjectsRestored"] or not snapshot["originalCompileObjectUnchanged"]:
                    raise AssertionError("all_original_functions_must_be_restored")
                row["observer"] = snapshot
            measurements.append(row)
            digests.update(value[0] for value in results)
            namespace_samples.extend(value[1] for value in results)
    if len(digests) != 1:
        raise AssertionError("identical_plain_and_observed_serialization_required")
    for first, second in zip(namespace_samples, namespace_samples[1:]):
        if first is second or first["Host"] is second["Host"] or first["Host"].refresh.__globals__ is second["Host"].refresh.__globals__:
            raise AssertionError("fresh_definition_namespace_isolation_required")
    medians = {str(observed): statistics.median(row["parentCPUNanoseconds"] for row in measurements if row["observed"] is observed)
        for observed in (False, True)}
    print(json.dumps({"format": "local-readonly-stdlib-overhead-v1", "localDefinitionAndJSONWorkOnly": True,
        "sourceSha256": hashlib.sha256(source).hexdigest(), "JSONFixtureSha256": hashlib.sha256(raw_json).hexdigest(),
        "JSONFixtureBytes": len(raw_json), "JSONFixtureRootType": type(data).__name__,
        "JSONInventoryEntriesIfPresent": len(data.get("entries", [])) if type(data) is dict else None,
        "iterationsPerMeasurement": args.iterations, "rounds": args.rounds,
        "measurements": measurements, "medianParentCPUNanoseconds": medians,
        "observedToPlainMedianCPURatio": medians["True"] / medians["False"],
        "freshNamespacesAndIdenticalResults": True, "compileObjectOrCallerFlagsChanged": False,
        "ContextOrActorOrQueryOrCallbackConstructed": False, "productionPerformanceClaimed": False}, sort_keys=True))


if __name__ == "__main__":
    main()
