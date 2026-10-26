# Passive durations for the read-only callback-cost benchmark

`ypal-readonly-run-duration-v1.py` is a new observational helper for a separately reviewed, read-only benchmark. It changes no frozen CONT5, metadata, Source, SQL or callback source. Import and default invocation install no observer and dispatch no application action.

Use one fresh scope after authenticating the helper's actual bytes:

```python
with helper.RunDurations(maximum_calls=10000) as observation:
    # The caller supplies only its genuine, authorized read-only observations.
    refresh = host.refresh()
    prerequisites = host.prerequisites()
private_snapshot = observation.snapshot()
```

The original `subprocess.run` is restored on scope exit before snapshotting, serializing or writing. The caller must also exit the scope before retaining a failure snapshot. It must keep its original exception when diagnostic persistence refuses. A benchmark driver must separately own its actual input, source and reconciliation gates, exclusive audit, full current proofs and Source postflight. This helper grants none of them and must not invoke the prepared callback or qualifier. Its intended benchmark is not a held transaction, and its measurements cannot qualify a later held callback.

The observer forwards every positional and keyword value directly to the exact original run object. It does not inspect a returned object's attributes or replace an exception. Unknown return objects, nonzero results, timeout exceptions and cancellation retain their original behavior. It wraps no Popen, pipe, SQL parent, query, caller function or callback, and installs no trace, profile or callstack hook. No code, proof, source, actor, catalog, readiness, dependency or approval result is cached.

It records only a fixed command category, start/end performance-counter stamps, elapsed wall time, parent-process CPU time, whether the original returned or raised, the exception class and whether the returned object is exactly a `CompletedProcess`. A returned result is not labelled successful and confers no outcome authority. The category examines only the first executable from exact builtin argument containers. Unknown objects are neither stringified nor traversed. Full argv, input, environment, stdout, stderr, SQL and exception messages are never retained. The helper does not decide whether the caller's commands are authorized; the distinct benchmark's complete source review supplies that boundary.

Records are limited to at most 10,000 calls. Further calls still execute exactly once and are counted as dropped observations. Finite bookkeeping errors leave the original result or exception intact. External deadlines and cancellation still propagate. Only calls on the scope's thread are timed; foreign-thread calls pass through and are counted separately. Parent-process CPU excludes child-process CPU and can include other threads in the same parent process. Wall duration includes time waiting for the child; it cannot identify a child's CPU cost by itself. Phase attribution must use the benchmark's coarse stamps from the same performance-counter domain.

An existing run hook, a reused observer or an invalid record limit refuses before installation. A changed hook during the scope is reported and the saved original is restored. A successful benchmark must require restoration and examine dropped/error/foreign-thread flags before reporting complete timing coverage. Snapshot data is detached from the live record list. Every qualification, SQL authority and automatic-retry flag is false.

Run the 13 portable controls:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-run-duration-v1.test.py
```

They execute safe local Python children and explicit pass-through fixtures, not a CONT5 Session, database, service, callback or qualifier. They check real stdin/environment/stdout/stderr/nonzero behavior, real timeout cleanup, exact argument and return-object identity, original exception identity including cancellation, bounded records, finite bookkeeping refusals, unknown argument/return objects, foreign-thread forwarding, hook restoration and inert defaults. These are source controls, not production performance evidence. No benchmark or new qualification driver is included in this packet.
