#!/usr/bin/env python3
"""Bounded generated-file comparison; no Source, Host, database or application."""
import argparse
import contextlib
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics
import tempfile
import time

HERE = Path(__file__).resolve().parent
ORIGINAL_SHA256 = hashlib.sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size-mib", type=int, default=16)
    parser.add_argument("--rounds", type=int, default=3)
    args = parser.parse_args()
    if not 16 <= args.size_mib <= 32 or not 3 <= args.rounds <= 5:
        raise ValueError("bounded_generated_file_performance_fixture_required")
    source = HERE / "ypal-readonly-sha256-memo-v1.py"
    spec = importlib.util.spec_from_file_location("local_SHA256_memo_performance", source)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    size = args.size_mib * 1024 * 1024
    order = [0, 0, 1, 1, 0, 0]
    suffix = b"independent-local-copy"
    tail = b"independent-local-original"
    with tempfile.TemporaryDirectory(prefix="ypal-local-generated-SHA-") as temporary:
        paths = [Path(temporary) / (str(index) + ".public-bytes") for index in range(2)]
        expected = []
        for index, path in enumerate(paths):
            pattern = bytes(range(256)) if index == 0 else bytes(reversed(range(256)))
            raw = pattern * (size // len(pattern))
            path.write_bytes(raw)
            expected.append((ORIGINAL_SHA256(raw).digest(), ORIGINAL_SHA256(raw + suffix).digest(),
                ORIGINAL_SHA256(raw + tail).digest()))
        del raw

        def units():
            previous = None
            for index in order:
                fresh = paths[index].read_bytes()
                if len(fresh) != size or fresh is previous:
                    raise AssertionError("every_iteration_must_read_new_actual_file_bytes")
                previous = fresh
                value = hashlib.sha256(fresh)
                if value.digest() != expected[index][0]:
                    raise AssertionError("same_genuine_original_digest_required")
                independent = value.copy()
                independent.update(suffix)
                value.update(tail)
                if independent.digest() != expected[index][1] or value.digest() != expected[index][2]:
                    raise AssertionError("same_independent_original_update_and_copy_states_required")

        units()  # Warm local file reads/imports outside both measurements.
        measurements = []
        for round_number in range(args.rounds):
            modes = (False, True) if round_number % 2 == 0 else (True, False)
            for observed in modes:
                memo = helper.SHA256Memo() if observed else None
                wall = time.perf_counter_ns()
                cpu = time.process_time_ns()
                with memo if observed else contextlib.nullcontext():
                    units()
                cpu_elapsed = time.process_time_ns() - cpu
                wall_elapsed = time.perf_counter_ns() - wall
                if hashlib.sha256 is not ORIGINAL_SHA256:
                    raise AssertionError("original_constructor_must_be_restored_before_snapshot")
                row = {"round": round_number + 1, "memoized": observed,
                    "parentCPUNanoseconds": cpu_elapsed, "wallNanoseconds": wall_elapsed,
                    "freshReadCalls": len(order), "digestsAndIndependentUpdatesEqual": True}
                if observed:
                    snapshot = memo.snapshot()
                    if not snapshot["originalSHA256Restored"] or not snapshot["privatePayloadsReleased"] or snapshot["bookkeepingErrors"]:
                        raise AssertionError("complete_local_memo_bookkeeping_and_restoration_required")
                    if snapshot["cacheHits"] != 4 or snapshot["originalConstructorCalls"] != 2 or snapshot["largeInputBytesAvoidedByHits"] != 4 * size:
                        raise AssertionError("actual_fresh_byte_hit_and_saved_computation_counts_required")
                    row["memo"] = snapshot
                measurements.append(row)
        # Separate untimed population proves actual payload-budget eviction.
        eviction = helper.SHA256Memo(maximum_payload_bytes=size)
        with eviction:
            units()
        eviction_snapshot = eviction.snapshot()
        if eviction_snapshot["cacheHits"] != 3 or eviction_snapshot["entriesEvicted"] != 2 or eviction_snapshot["peakRetainedPayloadBytes"] != size:
            raise AssertionError("actual_bounded_eviction_counts_required")
        if not eviction_snapshot["originalSHA256Restored"] or not eviction_snapshot["privatePayloadsReleased"]:
            raise AssertionError("eviction_scope_must_restore_and_release")
    medians = {str(observed): statistics.median(row["parentCPUNanoseconds"] for row in measurements if row["memoized"] is observed)
        for observed in (False, True)}
    print(json.dumps({"format": "local-generated-fresh-read-SHA256-performance-v1",
        "helperSourceSha256": ORIGINAL_SHA256(source.read_bytes()).hexdigest(),
        "localGeneratedPublicBytesOnly": True, "generatedFileCount": 2, "bytesPerFile": size,
        "freshReadCallsPerMeasurement": len(order), "rounds": args.rounds,
        "alternatingMeasurementOrder": True, "measurements": measurements,
        "medianParentCPUNanoseconds": medians,
        "memoToPlainMedianCPURatio": medians["True"] / medians["False"],
        "untimedPayloadEvictionControl": eviction_snapshot,
        "SourceHostDatabaseOrApplicationInvoked": False,
        "productionPerformanceOrCallbackAcceptanceClaimed": False}, sort_keys=True))


if __name__ == "__main__":
    main()
