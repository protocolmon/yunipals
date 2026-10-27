# Fixed Base metadata parity for the combined source

This read-only successor compares the same legacy Base metadata events with
new combined native events at block 52,870,977. It retains all sixteen exhaustive
transaction-hash partitions, normalized payloads, exact-key checks and aggregate
comparison rules from frozen v3. The one normalization still converts native
`rarityScore` to the legacy string representation. It changes no indexed data.

Only the native namespace changes in the partition SQL. Before its first
partition, an added no-output context guard runs inside the same initial
repeatable-read/read-only transaction. It requires the fixed new registered
release/build/manifest, physical and read schema identities, read marker and a
complete Base checkpoint covering the boundary. The checkpoint adapter subtracts
a partially processed block. Framework readiness is not substituted for
historical coverage, and neither result implies current canonical acceptance.

The original limits remain: 90 seconds per statement, 500ms lock timeout, 16MB
work memory, 512MB temporary-file limit, one parallel worker setting of zero,
merge joins disabled and a 360-second subprocess deadline. All sixteen
partitions plus invalid-key checks share one snapshot and end in ROLLBACK.
The existing 27GiB disk reserve remains mandatory. There are no grants,
credential reads, service changes, provider requests or SQL writes.

The owner checks the exact acknowledged current source process handle before and
after comparison. A replacement invocation, reused PID, old failed actor or
process start mismatch refuses. It keeps the original source files untouched.
The database child uses the existing Unix peer identity in a clean environment,
no password prompt, and an explicitly absent password-file sentinel. Its cwd is
`/`, avoiding the retained-user cwd warning without relaxing clean stderr.

The client runs in its own process group. A deadline terminates that group,
including descendants retaining the captured pipes, then reports an unknown
comparison outcome without retry. The fixed PostgreSQL application name
`yunipals_metadata_fixed_parity_v4` identifies any remaining backend for read-only
inspection; process termination alone is not a claim that its backend has exited.

Create a root-owned `0700` output directory and protected plan from the example.
Stage the exact reviewed producer. Default review opens no database connection:

```sh
python3 -I -B metadata-fixed-parity-v4.py --plan ACTUAL_PROTECTED_PLAN
python3 -I -B metadata-fixed-parity-v4.py --plan ACTUAL_PROTECTED_PLAN --apply ACTUAL_REVIEW_HASH
```

The explicit capture rechecks the review's actor and disk reserve, reserves the
fixed output exclusively as root `0600`, and executes the read-only comparison.
The full report stays at
`/var/backups/yunipals-metadata-fixed-parity-v4-20261024/result.json`.
Stdout contains only its hash, aggregate counts/differences and qualification
flags. A failure leaves no successful receipt and any reserved output is kept
for inspection; the program does not retry or overwrite it.

The result format is `yunipals-metadata-fixed-parity-v4`. A successful data
comparison requires no missing keys or changed payloads, unique complete keys,
matching sixteen-partition digests, nonempty matching event counts, expected
native identities and a covered legacy scan. `canonicalAcceptance:false` and
`sourceSelected:false` remain explicit. The source/read context and actual actor
are recorded only in the private report. This report alone authorizes no
metadata adoption, generation publication or reader selection.

The production comparison is complete: all 440,194 legacy events matched all
440,194 combined-source events at the fixed boundary, with no missing keys or
changed payloads. Independent inspection recomputed every partition digest,
verified the protected report and exact source context, and confirmed that the
comparison backend had exited. No provider, SQL-write or service action occurred.
The report remains private on the host. Native adoption and current canonical
acceptance remain separate pending gates.

Validation:

```sh
python3 -I -B ops/unified-indexer-transition/metadata-fixed-parity-v4.test.py
```

The ten self-contained controls use synthetic command/actor/data adapters and a
real descendant timeout fixture. They
prove exact reverse equality of the normalized SQL to frozen v3 after namespace
restoration, unchanged sixteen partitions and resource limits, guarded fixed
context, mismatch propagation, actor replacement refusal and sanitized errors.
These fixture tests do not substitute for production acceptance. The actual
capture and independent report inspection above are recorded separately; no
private report or future successful receipt is included in the source package.
The unchanged v3 file is a test-only reference for exact SQL comparison.
