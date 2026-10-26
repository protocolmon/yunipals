# Read-only standard-library CPU observations

`ypal-readonly-stdlib-cpu-v1.py` measures five public standard-library entrypoints during a separately authorized read-only benchmark: `ast.parse`, `copy.deepcopy`, `json.loads`, `json.dumps`, and `hashlib.sha256` construction. It records aggregate wall and parent-process CPU durations, counts, and coverage flags. It neither constructs application contexts nor invokes their methods. The caller still performs every genuine source read, hash, parse, copy, namespace execution, actor check, catalog check, and readiness check.

The API is:

```python
observer = helper.StdlibCPUDurations(maximum_outer_calls=10000)
with observer:
    # Only the separately reviewed genuine read-only work.
    refresh = host.refresh()
    prerequisites = host.prerequisites()
private_snapshot = observer.snapshot()
```

The helper forwards the exact arguments, result objects, and original exceptions. It observes the current thread only and times only the outermost call across all five labels. Calls that reenter an observed public entrypoint execute normally and increment a nested-skip count rather than receiving a second inclusive duration. Internal aliases and default arguments that already reference an original function can bypass the public wrapper; in particular, ordinary CPython deepcopy recursion commonly uses such references. A zero nested count does not mean an operation performed no internal recursion. Parent-process CPU excludes child CPU and can include work on other threads. Hash timing covers construction only, including bytes supplied to the constructor; later `.update()` and `.hexdigest()` calls are unobserved.

`builtins.compile` remains the exact original object. A preliminary unpublished six-label experiment was withdrawn because wrapping compile changes the caller frame from which Python inherits future flags. The final five-label implementation includes a real `from __future__ import annotations` regression and leaves direct compilation and its caller context untouched. Compilation cost outside the observed entrypoints remains unmeasured. No frame or stack workaround is installed.

All five attributes are restored before snapshots, copies, serialization, or file writes, including on an original error. The observer refuses reused scopes and already changed functions. It retains no arguments, source, results, exception messages, SQL, or callstacks. Its finite call cap never skips the original call. Diagnostic bookkeeping refusals are counted; external deadlines and cancellation propagate. Hook changes, foreign-thread calls, dropped observations, clock/bookkeeping errors, and incomplete restoration are explicit. A consumer must check those fields before describing coverage as complete. There is no trace, profile, Popen, pipe, SQL-parent, application-function, or application-source hook; no code, proof, or fact cache is introduced. The measurements provide no current, Source, metadata, callback, SQL, or timing authority, and all original deadlines remain in force.

For a combined benchmark, initialize both helpers before measurement. Enter the separately reviewed run-duration observer first and this CPU observer second; normal context-manager unwinding restores the CPU functions and then `subprocess.run`. Take both snapshots and write private diagnostics only after both restorations, followed by the genuine full Source postflight. No callback or qualifier is part of this helper or its local overhead measurement.

The thirteen portable controls run with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-stdlib-cpu-v1.test.py
```

They cover actual AST/JSON/copy/hash results, future-flag preservation, fresh independent namespaces and class/function globals, deepcopy cycles/aliases/memo and explicit public reentry, exact error identities and cancellation, cap and finite-clock failures, hook refusal, foreign-thread forwarding, and restoration before a detached snapshot. These are local source controls, not production qualification.

`ypal-readonly-stdlib-cpu-v1.overhead.py` performs bounded local definition and JSON work. It parses and copies the genuine frozen metadata source, compiles and executes only its top-level definitions/imports/constants into independent namespaces, and serializes, parses, and hashes a local JSON fixture. It never constructs a Host or Context instance or calls any actor, query, current, callback, service, or database method. The default fixture is the repository's Reader5 manifest; `--json-file` can select another bounded local fixture.

The co-located `ypal-readonly-stdlib-cpu-v1.local-overhead.json` records one completed local measurement using a historical inventory of 18,119,564 bytes and 60,918 entries (SHA `06e9b013fc93785c48da7a2e755d051cdca557d67e4b32796b936ecf5737502e`). This historical fixture is not presented as the production inventory. Each of three rounds ran four units plain and then four observed, after import warmup. Plain parent CPU was 0.772257378, 0.752911943, and 0.781213322 seconds; observed CPU was 0.836843890, 0.747772488, and 0.752616590 seconds. The median ratio was 0.974567; the first observed pair was slower. These small noisy samples establish neither a speedup nor a universal overhead bound. Every observed round recorded twenty outer calls with zero dropped calls or bookkeeping errors, preserved the serialization result and fresh namespace isolation, and restored all original functions including compile. No production performance improvement, callback completion, or held qualification is claimed.
