#!/usr/bin/env python3
"""Scalar cost observations at two AST entrypoints; no proof or cache reuse."""
import _thread
import ast
import json
import time
import types

FORMAT = "yunipals-readonly-ast-cost-v1"
_TARGETS = (("ast.dump", "dump", ast.dump),
            ("ast.fix_missing_locations", "fix_missing_locations", ast.fix_missing_locations))
_OBSERVATION_ERRORS = (MemoryError, OSError, TypeError, ValueError, AttributeError, OverflowError)


class ASTCosts:
    """Call captured originals once; retain only fixed counters and durations.

    Time only outermost calls across these two labels on the entering thread.
    Foreign threads and aliases used after closure delegate without timing.
    Arguments, trees, sources, results, exceptions and frames are not retained.
    Measurement overhead is included; no timing or current authority results.
    """

    def __init__(self):
        self.entered = self.active = self.restored = self.hook_changed = False
        self.thread = None
        self.depth = 0
        self.bookkeeping_errors = 0
        self.bookkeeping_error_count_complete = True
        self.secondary_failure_on_original_error = False
        self.installed = {}
        self.rows = {label: {"label": label, "calls": 0, "nestedCallsNotSeparatelyTimed": 0,
            "foreignThreadCallsDelegated": 0, "timedOuterCalls": 0, "returnedOuterCalls": 0,
            "raisedOuterCalls": 0, "wallNanoseconds": 0, "threadCPUNanoseconds": 0}
            for label, _name, _original in _TARGETS}

    def __enter__(self):
        if self.entered or any(getattr(ast, name) is not original or
                type(original) is not types.FunctionType or original.__module__ != "ast" or
                original.__name__ != name or original.__code__.co_filename != ast.__file__
                for _label, name, original in _TARGETS):
            raise RuntimeError("fresh_owned_scope_and_both_original_AST_functions_required")
        self.entered = True
        self.thread = _thread.get_ident()
        try:
            for label, name, original in _TARGETS:
                def make(observed_label, original_function):
                    def observed(*args, **kwargs):
                        return self._observe(observed_label, original_function, args, kwargs)
                    return observed
                self.installed[label] = make(label, original)
                setattr(ast, name, self.installed[label])
            self.active = True
        except BaseException:
            for _label, name, original in _TARGETS:
                setattr(ast, name, original)
            self.restored = True
            raise
        return self

    def __exit__(self, _kind, _error, _traceback):
        if not self.active or _thread.get_ident() != self.thread:
            raise RuntimeError("active_entering_thread_owns_AST_scope_closure")
        self.hook_changed = any(getattr(ast, name) is not self.installed[label]
            for label, name, _original in _TARGETS)
        # Restore both objects before snapshots, serialization or caller writes.
        for _label, name, original in _TARGETS:
            setattr(ast, name, original)
        self.active = False
        self.restored = True
        return False

    @staticmethod
    def _clock():
        wall, cpu = time.perf_counter_ns(), time.thread_time_ns()
        if type(wall) is not int or type(cpu) is not int or min(wall, cpu) < 0:
            raise ValueError("valid_observational_AST_clocks_required")
        return wall, cpu

    def _error(self):
        try:
            self.bookkeeping_errors += 1
        except TimeoutError:
            raise
        except _OBSERVATION_ERRORS:
            self.bookkeeping_error_count_complete = False

    def _add(self, row, key):
        try:
            row[key] += 1
        except TimeoutError:
            raise
        except _OBSERVATION_ERRORS:
            self._error()

    def _finish(self, row, started, raised):
        if started is None:
            return
        try:
            wall, cpu = self._clock()
            wall, cpu = wall - started[0], cpu - started[1]
            if min(wall, cpu) < 0:
                raise ValueError("monotonic_observational_AST_clocks_required")
            row["timedOuterCalls"] += 1
            row["raisedOuterCalls" if raised else "returnedOuterCalls"] += 1
            row["wallNanoseconds"] += wall
            row["threadCPUNanoseconds"] += cpu
        except TimeoutError:
            raise
        except _OBSERVATION_ERRORS:
            self._error()

    def _observe(self, label, original, args, kwargs):
        if not self.active:
            return original(*args, **kwargs)
        row = self.rows[label]
        if _thread.get_ident() != self.thread:
            self._add(row, "foreignThreadCallsDelegated")
            return original(*args, **kwargs)
        self._add(row, "calls")
        if self.depth:
            self._add(row, "nestedCallsNotSeparatelyTimed")
            return original(*args, **kwargs)
        self.depth = 1
        try:
            started = None
            try:
                started = self._clock()
            except TimeoutError:
                raise
            except _OBSERVATION_ERRORS:
                self._error()
            try:
                result = original(*args, **kwargs)
            except BaseException:
                # Diagnostics cannot replace an already raised original error,
                # including cancellation, even if the second clock also fails.
                try:
                    self._finish(row, started, True)
                except BaseException:
                    self.secondary_failure_on_original_error = True
                    try:
                        self._error()
                    except BaseException:
                        self.bookkeeping_error_count_complete = False
                raise
            else:
                self._finish(row, started, False)
                return result
        finally:
            self.depth = 0

    def snapshot(self):
        if self.active:
            raise RuntimeError("AST_snapshot_only_after_both_originals_restored")
        return {"format": FORMAT, "functions": [dict(row) for row in self.rows.values()],
            "bookkeepingErrors": self.bookkeeping_errors if self.bookkeeping_error_count_complete else None,
            "bookkeepingErrorCountComplete": self.bookkeeping_error_count_complete,
            "secondaryObservationFailureOnOriginalError": self.secondary_failure_on_original_error,
            "bothOriginalASTObjectsRestored": self.restored and all(getattr(ast, name) is original
                for _label, name, original in _TARGETS), "ASTHookChangedDuringScope": self.hook_changed,
            "currentThreadOnly": True, "outermostAcrossBothLabels": True,
            "wallClock": "perf_counter_ns", "CPUClock": "thread_time_ns-current-thread-only",
            "observerOverheadIncluded": True, "argumentsTreesResultsExceptionsOrFramesRetained": False,
            "originalArgumentsResultsOrExceptionsChanged": False, "originalCallsSkippedOrReplayed": False,
            "SHACompileJSONApplicationOrProfileHooksInstalled": False,
            "codeOrProofOrFreshFactsCached": False, "automaticRetryAllowed": False,
            "currentOrTimingAuthorityQualified": False, "effectsDispatchedByObserver": False}


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "ASTObserverInstalled": False,
        "effectsDispatchedByObserver": False}))
