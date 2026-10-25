# Bounded metadata coverage observations

This successor executes the exact frozen `920982e3…` executor in a new
`yunipals-ypal-ordinary-metadata-drain-v2` namespace. Its own journal is
`/var/backups/yunipals-ypal-ordinary-metadata-drain-v2-20261025`.
The genuine `9b9184e6…` metadata owner, actual input `bc618a85…`, candidate
references, original operation and every `cf7799db…` drain statement and
coverage guard remain unchanged. Prior v1 failures and receipts remain intact.

Use the existing CLI with the v2 filename: first `--input-sha ACTUAL_INPUT_SHA`
for a fresh review, then `--input-sha ACTUAL_INPUT_SHA --apply ACTUAL_NEW_REVIEW_SHA`.
An old v1 review cannot authorize this new producer. No default input or
successful operation is invented. Root owns all host execution.

Only an actual false result from the original `covered()` predicate enables
read-only re-observation for at most 90 seconds, including final checks.
Readiness, frame and cursor values are always genuine database results.
Exceptions are not retried. Missing or stale/halted-source frames stay false.
Before effects the same metadata actor/private snapshot and fixed scan
identity/mode must remain; the live cursor can advance but cannot rewind.
The original full source/READ fence still runs immediately before the original
operation directory or service effect.

After the original stop, the wrapper authenticates the actual original operation
against this executor's reviewed binding and runs the genuine `n.drained()`
before and after each additional database observation. The entire stopped scan
must stay identical, including its cursor. Those terminal checks retain private,
owned-process, session and source/READ checks. Reactivation or any scan drift
refuses. Actual false observations and failures remain in private exclusive
coverage audit records, alongside the original session observations.

The original stop, reload, session capture and operation creation are never
retried. An unknown stop acknowledgement uses the original read-only
reconciliation limits. A coverage deadline or error after the original stop
leaves a failed prefix for explicit owned recovery; it does not start a service,
adopt metadata or synthesize a drained acknowledgement. Root must use the
genuine metadata inverse when that incomplete prefix cannot reconcile.

Run `python3 -I -B ops/unified-indexer-transition/ypal-ordinary-metadata-drain-v2.test.py`.
Thirty local controls include the nineteen unchanged executor controls, actual
false-to-covered snapshots, missing frames, moving/stopped cursor rules,
actor/private/source drift, errors/deadlines, original-body equality and lost
acknowledgement/no-second-dispatch paths. These are source and local fixture
results, not production coverage or drain acceptance.
