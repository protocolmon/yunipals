# Passive cost observations for two AST entrypoints

`ASTCosts` temporarily wraps only the captured original `ast.dump` and `ast.fix_missing_locations`. It calls the captured original with the exact arguments once and returns the same result object, including the mutation and tree identity of `fix_missing_locations`. It does not cache ASTs, dumps, source bytes, compiled code or any proof. There is no production dispatcher, input, manifest graph or file-writing API. The default CLI installs no observer.

Use one fresh instance on the current thread with a context manager, then call `snapshot()` after the scope exits. Both original AST objects are restored before snapshots, serialization or caller writes, on success and failure. A foreign hook at entry, a nested/new observer, instance reuse, closure from another thread, or snapshot during the active scope refuses. A hook replaced during the scope is reported and both originals are restored. An imported wrapper alias called after closure delegates without observation. Other threads delegate to the original and are counted separately without timing.

The snapshot has two fixed scalar rows: total current-thread calls; nested calls not separately timed; foreign-thread delegated calls; timed outer calls returned/raised; accumulated outermost wall and current-thread CPU nanoseconds. Outermost means across both declared labels, so a nested cross-label call still executes but is not timed a second time. No event list grows with call count. Wall uses `perf_counter_ns`; CPU uses `thread_time_ns`, excluding foreign-thread and child-process CPU. These are measurements at the public entrypoints, not complete Python/compiler attribution. Observer overhead remains inside the measurement; missing timing after a clock error is counted as a bookkeeping error.

The observer retains no arguments, ASTs, source, results, exception objects/messages or call frames. Ordinary clock-observation errors do not skip/replay the original or replace its result/refusal. An already raised original error, including cancellation, takes precedence over any secondary timing/counter failure. A deadline after an original successful return still propagates. Failed error-counter updates set `bookkeepingErrorCountComplete:false` and expose `bookkeepingErrors:null`, never a fabricated zero. Cancellation closes the scope and no cancelled call is retried. It installs no SHA256, compile, JSON, application-function, trace, profile or transport hook. The independent SHA2 helper can be active at the same time; its own restoration and payload policy remain intact. No source freshness, metadata current, query equivalence, timing qualification or effect authority comes from these counters.

Root may include this helper in a separately reviewed read-only whole-Source measurement to determine actual call frequency and cost before proposing factory changes. This packet contains no such driver and claims no production cost or performance improvement.

Local controls:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-ast-cost-v1.test.py
```

Ten controls pass. They exercise real AST construction, mutation, dump text/attributes and compilation equivalence; exact pass-through arguments/result identity; both real AST error paths; original-error precedence over secondary deadline/memory/counter failures; successful-call deadline propagation; cancellation and body-error cleanup; shared outermost timing; ordinary clock errors; scope/thread ownership and closed aliases; foreign-hook refusal; detached scalar snapshots and actual SHA2 coexistence. No database, SSH, Git, application constructor or production action is executed.
