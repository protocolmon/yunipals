# Read-only standard-library CPU observer with a larger cap

`ypal-readonly-stdlib-cpu-v2.py` is a distinct source over frozen v1 `0429f09a0180d2a7395a419b4efa3a6603be3db9da538607a76ddfc3358589ba`. Its only source changes are the v2 format and an increase of `MAXIMUM_OUTER_CALLS` from 10,000 to 50,000. Reversing those two literal changes reproduces the complete v1 bytes. Every observer method retains the same bytecode, constants and names; the constructor's default limit follows the new constant. V1 and its historical records remain unchanged.

The existing read-only benchmark2 result `a134d69dca724120b37f62a5c9b2edb20fc3559b66bdc40a22cfc33ccc236558` passed its genuine Source postflight and file bookends. Its CPU observer saw 21,699 outer calls, timed the first 10,000, and dropped 11,699. The 6.927199944 seconds of observed CPU describe that measured prefix only, not complete coverage of the roughly 47.48 seconds of phase parent CPU. Its complete 347-call subprocess observation separately identified calls 87 and 88 as the authenticated public generation bridge family; it did not classify their stdin phases. Raising this distinct helper's cap does not change, complete or relabel the old observation.

The API remains `StdlibCPUDurations(maximum_outer_calls=50000)`. The helper stores five fixed aggregate rows, not a growing per-call history. Increasing the cap permits more calls to receive timing; it does not increase the aggregate-row population. Calls after the cap still execute normally and increment the dropped count. A future separately reviewed benchmark must report its actual counts and coverage flags; this source alone cannot guarantee that its population fits the cap.

The five observed public functions remain `ast.parse`, `copy.deepcopy`, `json.loads`, `json.dumps`, and `hashlib.sha256` construction. Arguments, result objects, errors, current-thread scope, outermost timing, nested-skip accounting, finite bookkeeping handling, cancellation, and restoration remain identical to v1. No source, result, exception message or argument is retained. Internal aliases that bypass these public attributes remain unobserved. Hash updates and hexdigest calls are unobserved. Parent-process CPU excludes child CPU and may include other threads. Measurements include observer overhead.

`builtins.compile` remains the original function, including the original caller's inherited future flags. There is no compile, profile, trace, frame, stack, Popen, pipe, SQL-parent, application-source or application-function hook. No code, proof or fact cache is added. All original queries, current/source/metadata/catalog/readiness checks, approval predicates and deadlines still execute. This helper grants no callback, SQL, current, timing, prepared ACK or effect authority.

Instantiate both helpers before a separately authorized read-only pair. Enter the run-duration observer first and this CPU observer second. Restore both before snapshots, private writes and genuine full Source postflight. The five aggregate rows, dropped/error/foreign-thread counters, hook/restoration flags and untouched-compile flag must be read honestly; incomplete observations do not imply a faster proof.

Run the same thirteen portable controls with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-readonly-stdlib-cpu-v2.test.py
```

The retained controls verify real AST/JSON/copy/hash results, caller future flags, fresh independent namespaces, deepcopy cycles/aliases/memo and public reentry, original error identities and cancellation, cap/clock failures, foreign threads and hook refusal, detached snapshots and restoration. The existing cap control additionally checks the 50,000 default and maximum, rejects invalid limits, and executes 21,699 genuine local `json.loads` calls with all calls timed, zero drops/errors and exactly five aggregate rows. That local population is a source regression, not a replay of production facts or a production measurement. All thirteen controls pass. No production driver, private input, current proof, callback, qualifier, database or service action is included in this three-file packet.
