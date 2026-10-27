# Fixed public bridge-family labels for the read-only benchmark

`ypal-readonly-run-duration-v2.py` is a separate diagnostic successor over frozen timer `00b35f20`. It preserves the complete original run forwarding, clocks, caps, error handling, thread scope and restoration. The only additions are a fixed public command-family label in a recorded row and source provenance in the snapshot. No production observation or performance improvement is claimed by this source packet.

The API remains:

```python
with helper.RunDurations(maximum_calls=10000) as observation:
    # Only the caller's separately authorized genuine read-only work.
    refresh = host.refresh()
    prerequisites = host.prerequisites()
private_snapshot = observation.snapshot()
```

The constructor authenticates four existing public sources before evaluating the frozen timer: timer1, restored generation `48cc2e29`, ordinary generation `ada329e5` and retained primitives `4cf40a8e`. It reads the public `BRIDGE`, `NODE` and `CLEAN` literals without constructing a Host or running a query. The exact counted V5 import replacement changes `./ypal-cache-guard-transition-v1.mjs` to `./ypal-ordinary-cache-transition-v5.mjs`; the resulting public JavaScript SHA is `0a2276924a29fa829125ad1ba61d557feb527c77c98dd6897db14313e5bab755`. The raw restored bridge differs and is not silently accepted as the active V5 bridge.

A row is labelled `generation-recovery-read-bridge` only when its argument container is exactly a builtin list or tuple of exact builtin strings and the entire argv equals the fixed public setpriv/UID111/GID113/Node/environment/flags/JavaScript sequence. Any changed byte, shape, user, environment entry, flag or executable remains `unclassified`. Other commands still run once through the original observer. Unknown objects are not stringified, compared or traversed. Stdin is never read or parsed: the actual `verify-capsule` versus `observe` phase lives there, so no phase identity is claimed. There are no frame, stack, trace, profile, Popen, SQL-parent or application hooks.

Rows retain no argv, input, environment, JavaScript, SQL, stdout, stderr or exception messages. Fixed public source and JavaScript digests are provenance only. Finite label bookkeeping refusal increments the existing diagnostic error count and preserves the original subprocess result or exception. External deadlines still propagate. The original run object is restored before snapshotting or writing on both outcomes; existing hooks, reused scopes and invalid limits retain the frozen guards. Dropped, error and foreign-thread observations remain explicit, and a later benchmark must check complete coverage rather than interpreting missing records as a faster proof. Parent-process CPU excludes child CPU.

The eight portable controls run from a complete checkout:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-run-duration-v2.test.py
```

They authenticate real source bytes, execute the actual V5 transform and complete original `read_bridge` with explicit protected-source/child-I/O fixtures, prove both bridge phases receive the same family label and unchanged 90-second transport arguments, verify all inherited observer bodies, refuse every argv mutation and unknown object, preserve original results/errors under diagnostic refusal, and exercise safe local child/nonzero/timeout cleanup. They execute no production application, database, benchmark, callback, qualifier or service operation. The original timer and all existing sources remain unchanged.

The existing actual read-only measurement `27af1b44` reported two roughly nine-second `setpriv` calls, indices 87 and 88. Source tracing identifies a candidate: the active ordinary generation acceptance path calls retained capsule verification and live-state observation consecutively. Both execute complete saved/live wallet and derived-state row-hash aggregates through this public bridge. Timer1 recorded categories without argv or callsites, so this source trace does not prove those exact indices. Timer2 can distinguish this public bridge family during the one separately reviewed combined read-only pair; it cannot turn a command result into source, metadata, callback, SQL or timing authority.

The same actual measurement reported a 21.875942569-second wall gap with only 0.314161442 seconds of parent CPU between env call 255 and setpriv call 256. The genuine metadata publication body compiles official SQL through env/tsx, then its exact full-publication query is dispatched by `ypal-ordinary-publication-query-v2.py` through direct `Popen`/`communicate(timeout=80)` in a read-only transaction, outside timer1's `run` observations. That is a source/order explanation consistent with the gap, not measured callsite attribution. No explicit sleep occurs in that publication path, and no Popen hook is added here.

Equivalent performance work requires attribution first. A separately authorized read-only plan inspection of the exact freshly compiled publication/aggregate SQL could test index or sort opportunities while preserving every query predicate and row. Repeated immutable source parsing, namespace construction and inventory processing may offer code-only preparation work if measured by the separate CPU observer; fresh actors, catalogs, readiness, metadata, Source and approval observations must still execute and be checked each time. No optimization, code cache, fact cache, index change, predicate waiver or deadline change is implemented by this packet. The next benchmark must remain one genuine explicit refresh/prerequisite pair, with both observers restored before private writes and full Source postflight.
