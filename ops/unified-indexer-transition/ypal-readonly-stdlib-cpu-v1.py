#!/usr/bin/env python3
"""Outermost standard-library cost observations for a read-only benchmark."""
import _thread
import ast
import builtins
import copy
import hashlib
import json
import time

FORMAT = "yunipals-readonly-stdlib-cpu-v1"
MAXIMUM_OUTER_CALLS = 10000
_BOOKKEEPING_ERRORS = (OSError, TypeError, ValueError, AttributeError, OverflowError)
_ORIGINAL_COMPILE = builtins.compile
_TARGETS = (
    ("ast.parse", ast, "parse", ast.parse),
    ("copy.deepcopy", copy, "deepcopy", copy.deepcopy),
    ("json.loads", json, "loads", json.loads),
    ("json.dumps", json, "dumps", json.dumps),
    ("hashlib.sha256-construction", hashlib, "sha256", hashlib.sha256)
)


class StdlibCPUDurations:
    """Forward exact calls; aggregate only outermost calls on this thread.

    Nested calls still execute their original function. They are counted but
    not timed separately, so the declared groups do not double count nested
    CPU. The wrappers add overhead to calls that reach their public entrypoint.
    No argument, source, result, exception message or callstack is retained.
    Fresh reads, hashes, parsing, copying, compilation and execution still run.
    This is observational support, never source or timing authority.
    """

    def __init__(self, maximum_outer_calls=MAXIMUM_OUTER_CALLS):
        if type(maximum_outer_calls) is not int or not 1 <= maximum_outer_calls <= MAXIMUM_OUTER_CALLS:
            raise ValueError("bounded_readonly_stdlib_outer_call_limit_required")
        self.maximum_outer_calls = maximum_outer_calls
        self.entered = False
        self.active = False
        self.restored = False
        self.hook_changed = False
        self.thread = None
        self.depth = 0
        self.outer_calls = 0
        self.dropped_outer_calls = 0
        self.bookkeeping_errors = 0
        self.installed = {}
        self.rows = {label: {
            "label": label,
            "timedOuterCalls": 0,
            "returnedCalls": 0,
            "raisedCalls": 0,
            "wallNanoseconds": 0,
            "parentCPUNanoseconds": 0,
            "maximumWallNanoseconds": 0,
            "maximumParentCPUNanoseconds": 0,
            "nestedCallsNotSeparatelyTimed": 0,
            "foreignThreadCallsNotTimed": 0
        } for label, _owner, _attribute, _original in _TARGETS}

    def __enter__(self):
        if self.entered or builtins.compile is not _ORIGINAL_COMPILE or any(getattr(owner, attribute) is not original for _label, owner, attribute, original in _TARGETS):
            raise RuntimeError("fresh_scope_original_compile_and_all_five_original_stdlib_objects_required")
        self.entered = True
        self.thread = _thread.get_ident()
        try:
            for label, owner, attribute, original in _TARGETS:
                def make(observed_label, original_function):
                    def observed(*args, **kwargs):
                        return self._observe(observed_label, original_function, args, kwargs)
                    return observed
                observed = make(label, original)
                self.installed[label] = observed
                setattr(owner, attribute, observed)
        except BaseException:
            for _label, owner, attribute, original in _TARGETS:
                setattr(owner, attribute, original)
            raise
        self.active = True
        return self

    def __exit__(self, _kind, _error, _traceback):
        if not self.active:
            raise RuntimeError("active_owned_readonly_stdlib_scope_required")
        self.hook_changed = any(getattr(owner, attribute) is not self.installed[label]
            for label, owner, attribute, _original in _TARGETS)
        # No clocks, snapshots, copies, serialization or file writes precede restoration.
        for _label, owner, attribute, original in _TARGETS:
            setattr(owner, attribute, original)
        self.active = False
        self.restored = all(getattr(owner, attribute) is original for _label, owner, attribute, original in _TARGETS)
        return False

    def _clock(self):
        wall = time.perf_counter_ns()
        cpu = time.process_time_ns()
        if type(wall) is not int or type(cpu) is not int or min(wall, cpu) < 0:
            raise ValueError("invalid_observational_stdlib_clock_value")
        return wall, cpu

    def _finish(self, row, started, raised):
        if started is None:
            return
        try:
            wall, cpu = self._clock()
            wall -= started[0]
            cpu -= started[1]
            if min(wall, cpu) < 0:
                raise ValueError("invalid_observational_stdlib_clock_progression")
            row["timedOuterCalls"] += 1
            row["raisedCalls" if raised else "returnedCalls"] += 1
            row["wallNanoseconds"] += wall
            row["parentCPUNanoseconds"] += cpu
            row["maximumWallNanoseconds"] = max(row["maximumWallNanoseconds"], wall)
            row["maximumParentCPUNanoseconds"] = max(row["maximumParentCPUNanoseconds"], cpu)
        except _BOOKKEEPING_ERRORS:
            self.bookkeeping_errors += 1

    def _observe(self, label, original, args, kwargs):
        row = self.rows[label]
        if _thread.get_ident() != self.thread:
            row["foreignThreadCallsNotTimed"] += 1
            return original(*args, **kwargs)
        if self.depth:
            row["nestedCallsNotSeparatelyTimed"] += 1
            return original(*args, **kwargs)
        self.outer_calls += 1
        self.depth = 1
        try:
            started = None
            if self.outer_calls > self.maximum_outer_calls:
                self.dropped_outer_calls += 1
            else:
                try:
                    started = self._clock()
                except _BOOKKEEPING_ERRORS:
                    self.bookkeeping_errors += 1
            try:
                result = original(*args, **kwargs)
            except BaseException:
                self._finish(row, started, True)
                raise
            else:
                self._finish(row, started, False)
                return result
        finally:
            self.depth = 0

    def snapshot(self):
        if self.active:
            raise RuntimeError("readonly_stdlib_snapshot_only_after_originals_restored")
        restored = self.restored and not self.active and all(getattr(owner, attribute) is original
            for _label, owner, attribute, original in _TARGETS)
        rows = copy.deepcopy(list(self.rows.values()))
        return {
            "format": FORMAT,
            "functions": rows,
            "maximumOuterCalls": self.maximum_outer_calls,
            "outerCallsObserved": self.outer_calls,
            "timedOuterCalls": sum(row["timedOuterCalls"] for row in rows),
            "droppedOuterCalls": self.dropped_outer_calls,
            "bookkeepingErrors": self.bookkeeping_errors,
            "allOriginalStdlibObjectsRestored": restored,
            "stdlibHookChangedDuringScope": self.hook_changed,
            "currentThreadOnly": True,
            "outermostAcrossAllDeclaredLabels": True,
            "builtinsCompileObserved": False,
            "originalCompileObjectUnchanged": builtins.compile is _ORIGINAL_COMPILE,
            "nestedCallsExecutedButNotSeparatelyTimed": True,
            "SHA256ConstructionOnly": True,
            "SHA256UpdateOrHexdigestTimed": False,
            "wallClock": "perf_counter_ns",
            "CPUClock": "process_time_ns-parent-only",
            "observerOverheadIncluded": True,
            "argumentsResultsOrExceptionMessagesRetained": False,
            "originalArgumentsResultsOrExceptionsChanged": False,
            "codeOrProofOrFactsCached": False,
            "businessFunctionOrSourceOrSQLHookInstalled": False,
            "liveTraceOrProfileOrCallstackHookInstalled": False,
            "PopenOrPipeOrSQLParentWrapped": False,
            "automaticRetryAllowed": False,
            "currentOrSourceOrMetadataQualified": False,
            "timingQualificationClaimed": False,
            "effectsDispatchedByObserver": False
        }


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "stdlibObserverInstalled": False,
        "timingQualificationClaimed": False, "effectsDispatchedByObserver": False}))
