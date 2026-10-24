# Fresh YPAL booster source parity

This new external producer compares the fresh temporary YPAL scanner with the
combined native source. The old PROTO parity programs remain unchanged. It does
not select a reader, retire a scanner, change roles, publish projections, or call
a provider. Actual reports, source process handles and reviewed plans stay in
root-private directories on the host. Public output contains counts, digests and
qualification flags, without ownership rows or journal arguments.

## Fixed data and source scope

The pair is `yunipals_boosters_ypal_v1` / build `8e88ea2e00` and
`unified_ypal_20261023_v1` / build `71e2a7f3b7`. The producer checks their actual
schema OIDs, combined registered release `4e77f52b...`, manifest `23d5ca68...`,
read schema OID and `cac869bf...` read marker. The complete three YPAL source
definitions, including ABI hashes and individual deployment starts, must match
the accepted combined manifest. The temporary source is tied to its actual
schema/build and the immutable fresh profile/deployment inputs.

Only these three contracts belong to this comparison:

| Contract | Address                                      |
| -------- | -------------------------------------------- |
| Registry | `0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3` |
| Engine   | `0xdf4aaa47fe0e8208b5a33c74898f834b2952189e` |
| Monsters | `0x7d62628806e7eef76a354c7c48787879e3440b16` |

All eight relations are mandatory: `booster_type`, `booster_original`,
`booster_request`, `booster_monster`, `booster_refund`, `booster_engine_state`,
`booster_checkpoint` and `booster_event`. Exact native column names, order, types,
numeric modifiers and nullability are checked. Every row and every field enters
both directions of `EXCEPT ALL`, row counts and the sorted SHA256 digest. The
original event argument normalization is retained: serialized JSON object key
order is ignored, while every other payload field stays in the comparison.
Transfers, burns, pending requests, refunds and journal hashes are included.
Deployment fields on every relation are checked against the fresh YPAL scope.

There is no historical state reconstruction. Both sources must have complete
framework Base checkpoints at or beyond the common boundary, and neither may
contain a booster event after it. Partial event checkpoints subtract one block.
A later event in either source refuses the old boundary even when both datasets
contain the same later event. The minimum boundary is the known initial purchase
point, 53,000,661; a capture also requires nonempty minted YPAL state.

A complete historical Base prefix can be compared while the combined multichain
framework reports `is_ready=0`. The producer still requires both exact live
builds, fresh runtime heartbeats, actual complete Base coverage, and a stable
pair of source process handles. A historical checkpoint timestamp is not treated
as a fresh head. Every proof returns `currentReadinessQualified:false`; it does
not relax the final handover's current Base, framework, canonical or serving gates.

## Named, immutable capture operations

The fixed root is:

`/var/backups/yunipals-ypal-booster-source-parity-v1-20261024`

An operator prepares this directory and its `captures` child as root-owned `0700`
directories. Each explicit plan chooses a new `captureId` matching
`[a-z][a-z0-9-]{0,47}`. Its only permitted output is:

`BASE/captures/<captureId>/result.json`

The operation directory must be absent during review. Capture creates it
exclusively as `0700`, then creates a `0600` report with `O_EXCL|O_NOFOLLOW`.
A second use of the same name is refused. There is no overwrite, automatic
numbering, retry, report deletion or mutation of an earlier capture. A failed or
unknown attempt leaves its reserved operation for inspection. A later genuine
feature event requires a separately reviewed plan with a new explicit name,
a new covered common boundary and a new full eight-relation capture.

Copy the plan example to a protected on-host file. Its three public inputs must
match their exact known hashes: the confirmed deployment, fresh three-source
profile and combined profile. The plan binds the operation name, output path,
boundary, actual canonical header file/checksum and all source inputs.

```sh
python3 -I -B ypal-booster-source-parity-v1.py --plan ACTUAL_PROTECTED_PLAN
python3 -I -B ypal-booster-source-parity-v1.py --plan ACTUAL_PROTECTED_PLAN --preflight ACTUAL_REVIEW_SHA
python3 -I -B ypal-booster-source-parity-v1.py --plan ACTUAL_PROTECTED_PLAN --capture ACTUAL_REVIEW_SHA
```

Default review opens no database connection, contacts no provider and reads no
process environment. With `header:null`, review and bounded preflight work;
capture refuses. Preflight reports complete Base points, last feature event,
post-boundary event counts and observed framework flags without scanning payload
comparisons. It is eligibility evidence, not a parity receipt. A protected actual
header reference is required before a reviewed capture.

All database work uses fixed local Unix postgres peer authentication against the
fixed database, with an empty environment, absent password-file sentinel,
`psql -w -X`, a fixed application name and working directory `/`. Capture uses
one repeatable-read, read-only transaction. Its source/coverage guard executes
before the eight payload comparisons in that same snapshot. Limits are 45 seconds
per statement, 1 second lock wait, 15 seconds idle transaction, 8MB work memory,
512MB temporary space, no parallel workers, and a 150-second outer process bound.
Timeout terminates the entire process group, including inherited-pipe descendants;
it never retries a query. At least 27GiB free remains required. A relation with
more than 50,000 rows is refused in full; no rows are sampled or truncated.

## Canonical observations and current-prefix interface

The canonical template deliberately contains null fields and cannot qualify.
Populate it only with actual bounded free-only observations of the same Base
boundary, a repeat of that boundary, latest head and finalized head. The caller
owns provider policy, transport provenance and actual RPC acknowledgements; this
producer has no network client and does not make those calls.

The exact normalized shape is the template's
`yunipals-base-canonical-header-v1`. All block numbers/timestamps are integers;
hashes are nonzero lowercase 32-byte hex. The observed time and latest block must
be within 180 seconds. The finalized anchor must cover the boundary. Its timestamp
may legitimately lag the latest Base head. Boundary/repeat tuples must match, and
the full boundary tuple must equal the actual combined `chain_block` witness.
A fresh observation of a historical block does not relabel its timestamp or
certify current framework readiness.

The pure `validate_receipt(value)` recomputes all source, column, complete-prefix,
count/digest/EXCEPT and canonical capture gates, plus producer/SQL/input hashes
and the same stable actor pair. It reports canonical qualification **at capture**.

The host-side read-only export is:

```python
validate_current_prefix(result_sha, canonical_header, capture_id)
```

It loads only the acknowledged immutable report at `capture_path(capture_id)`,
checks its exact SHA and producer, then repeats the same full eight-table SQL
and source/context guards. Current tables must still equal the captured payload
counts and digests, with zero future tails. Both acknowledged actors must remain
the same. A separately supplied fresh canonical observation must match the saved
boundary tuple and the current native witness. It returns `boundary`, `headerHash`,
`captureId`, `reportFile`, `receiptSha256`, `currentPrefixUnchanged:true`,
`canonicalObservedAtUnix` from the separately supplied observation and
`originalCanonicalObservedAtUnix` from the immutable capture. It never rewrites
or renews the capture's original observation. `currentCanonicalInputQualified`
means that the supplied input passed its gates; `currentCanonicalProviderQualified`
remains false because this producer performed no provider call.

This active-pair export is used **before** temporary-source retirement. After the
owned scanner stop, the handover must use the immutable receipt plus its own
terminal/session/boot and combined-only readiness proofs. It must not call the
active-pair export and claim that the retired scanner is still live. Current
reader/API readiness, actual canonical provider provenance, owned scanner drain
and retirement remain the separate feature handover's responsibility.

## Validation

```sh
python3 -I -B ops/unified-indexer-transition/ypal-booster-source-parity-v1.test.py
python3 -I -B ops/unified-indexer-transition/ypal-booster-source-parity-v1.postgres-test.py
```

The first suite uses explicit synthetic fixtures and real temporary filesystem /
process-group controls. No private production baseline is needed. The separate
PG16 fixture creates and removes a fresh database in the existing disposable
local test container, cloning its genuine `dependency_check` Ponder DDL. It
requires the documented local test database setup, not production access. It
exercises exact column shapes, semantic JSON normalization, both-direction row
comparison, same-count payload changes, future tails, partial checkpoints and
old PROTO rejection. A private SQL test copy retargets only peer/database/schema
OID expectations to the disposable fixture; the production program exposes no
such override, and its unmodified identity guard rejects that database. No
production-format receipt is produced by the PG fixture.

## Actual production preparation

The exact producer, public deployment and a protected initial plan have been
staged. Actual static review passed without database connections. Its default
early-return path was also checked independently after automatic review initially
questioned whether the CLI default could execute a capture; no executable change
or bypass was used.

The subsequent production read-only preflight passed all source/column/prefix
checks at boundary53,004,016. The fresh source was complete through53,014,464 and
the combined source through53,004,016; both last feature events were53,000,665
with zero later feature events. The combined framework flag remained false.
A separate single-point read found no native `chain_block` witness at the chosen
boundary. Full canonical capture therefore remains pending. No provider call,
permission, reader selection, service action or retirement occurred. Detailed
plans and actual evidence stay private on-host; no parity receipt is invented.
