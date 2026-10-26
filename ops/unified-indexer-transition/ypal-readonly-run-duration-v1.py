#!/usr/bin/env python3
"""Passive process-call durations for a distinct read-only benchmark only."""
import _thread
import copy
import json
import subprocess
import time
import types

FORMAT = "yunipals-readonly-run-duration-v1"
MAXIMUM_CALLS = 10000
_STDLIB_RUN = subprocess.run
_BOOKKEEPING_ERRORS = (OSError, TypeError, ValueError, AttributeError, OverflowError)
_KINDS = {
    "/usr/bin/busctl": "busctl",
    "/usr/bin/systemctl": "systemctl",
    "/usr/bin/setpriv": "setpriv",
    "/usr/bin/ss": "ss",
    "/usr/bin/psql": "psql",
    "/usr/bin/env": "env",
    "/opt/node-v24.18.1/bin/node": "node"
}


def command_kind(args, kwargs):
    """Inspect only exact builtin argument containers; never retain argv."""
    value = args[0] if args else kwargs.get("args")
    if type(value) not in (list, tuple) or not value:
        return "other"
    first = value[0]
    if type(first) is bytes:
        return next((kind for path, kind in _KINDS.items() if first == path.encode()), "other")
    if type(first) is str:
        return _KINDS.get(first, "other")
    return "other"


class RunDurations:
    """Observe the original run object; preserve every argument and outcome.

    This owns no source, actor, SQL, callback or timing authority. Only the
    current thread is timed. Diagnostics contain no argv, input, environment,
    stdout, stderr, SQL or exception messages. A bounded record population and
    finite bookkeeping refusals never change a subprocess result or exception.
    External deadlines and cancellation still propagate normally.
    """

    def __init__(self, maximum_calls=MAXIMUM_CALLS):
        if type(maximum_calls) is not int or not 1 <= maximum_calls <= MAXIMUM_CALLS:
            raise ValueError("bounded_readonly_duration_record_limit_required")
        self.maximum_calls = maximum_calls
        self.records = []
        self.dropped_calls = 0
        self.bookkeeping_errors = 0
        self.foreign_thread_calls = 0
        self.entered = False
        self.active = False
        self.restored = False
        self.hook_changed = False
        self.original = None
        self.installed = None
        self.thread = None

    def __enter__(self):
        if self.entered or subprocess.run is not _STDLIB_RUN or type(_STDLIB_RUN) is not types.FunctionType or _STDLIB_RUN.__module__ != "subprocess" or _STDLIB_RUN.__name__ != "run":
            raise RuntimeError("fresh_observer_and_unwrapped_original_subprocess_run_required")
        self.entered = True
        self.original = subprocess.run
        self.thread = _thread.get_ident()
        original = self.original

        def observed(*args, **kwargs):
            return self._observe(original, args, kwargs)

        self.installed = observed
        subprocess.run = observed
        self.active = True
        return self

    def __exit__(self, _kind, _error, _traceback):
        if not self.active:
            raise RuntimeError("active_owned_run_duration_scope_required")
        # Restore before any snapshot, serialization or caller file write.
        self.hook_changed = subprocess.run is not self.installed
        subprocess.run = self.original
        self.active = False
        self.restored = subprocess.run is self.original
        return False

    def _start(self, args, kwargs):
        if _thread.get_ident() != self.thread:
            self.foreign_thread_calls += 1
            return None
        if len(self.records) >= self.maximum_calls:
            self.dropped_calls += 1
            return None
        try:
            wall = time.perf_counter_ns()
            cpu = time.process_time_ns()
            if type(wall) is not int or type(cpu) is not int or min(wall, cpu) < 0:
                raise ValueError("invalid_observational_clock_value")
            # Append before dispatch so even an error remains one actual call.
            row = {
                "call": len(self.records) + 1,
                "commandKind": command_kind(args, kwargs),
                "startedPerfCounterNanoseconds": wall,
                "startedParentCPUNanoseconds": cpu,
                "outcome": "not-observed",
                "outcomeQualified": False
            }
            self.records.append(row)
            return row
        except _BOOKKEEPING_ERRORS:
            self.bookkeeping_errors += 1
            return None

    def _finish(self, row, error=None, returned=None):
        if row is None:
            return
        try:
            wall = time.perf_counter_ns()
            cpu = time.process_time_ns()
            if type(wall) is not int or type(cpu) is not int or wall < row["startedPerfCounterNanoseconds"] or cpu < row["startedParentCPUNanoseconds"]:
                raise ValueError("invalid_observational_clock_progression")
            row.update({
                "endedPerfCounterNanoseconds": wall,
                "wallNanoseconds": wall - row["startedPerfCounterNanoseconds"],
                "parentCPUNanoseconds": cpu - row["startedParentCPUNanoseconds"],
                "outcome": "raised" if error is not None else "returned",
                "errorClass": type(error).__name__ if error is not None else None,
                "exactCompletedProcessReturned": type(returned) is subprocess.CompletedProcess if error is None else False
            })
        except _BOOKKEEPING_ERRORS:
            self.bookkeeping_errors += 1

    def _observe(self, original, args, kwargs):
        row = self._start(args, kwargs)
        try:
            result = original(*args, **kwargs)
        except BaseException as error:
            self._finish(row, error=error)
            raise
        else:
            self._finish(row, returned=result)
            return result

    def snapshot(self):
        return {
            "format": FORMAT,
            "maximumCalls": self.maximum_calls,
            "calls": copy.deepcopy(self.records),
            "droppedCalls": self.dropped_calls,
            "bookkeepingErrors": self.bookkeeping_errors,
            "foreignThreadCalls": self.foreign_thread_calls,
            "subprocessRunRestored": self.restored and not self.active and subprocess.run is self.original,
            "runHookChangedDuringScope": self.hook_changed,
            "scopeThreadOnly": True,
            "wallClock": "perf_counter_ns",
            "CPUClock": "process_time_ns-parent-only",
            "argumentsEnvironmentTimeoutAndOriginalResultsChanged": False,
            "argvOrInputOrEnvironmentRetained": False,
            "stdoutOrStderrOrSQLRetained": False,
            "liveTraceInstalled": False,
            "liveProfileInstalled": False,
            "PopenOrPipeOrSQLParentWrapped": False,
            "automaticRetryAllowed": False,
            "currentOrSourceOrMetadataQualified": False,
            "timingQualificationClaimed": False,
            "SQLAuthorityQualified": False,
            "effectsDispatchedByObserver": False
        }


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "subprocessObserverInstalled": False,
        "timingQualificationClaimed": False, "effectsDispatchedByObserver": False}))
