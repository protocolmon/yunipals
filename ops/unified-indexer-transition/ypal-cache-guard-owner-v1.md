# Cache guard preparation for the native generation candidate

This owner prepares the cache catalog while the existing unlabelled generation
103 continues serving. It consumes an actual, built and validated **unpublished**
native generation candidate. It stops only the acknowledged cache writer, uses
the unchanged `ypal-cache-guard-transition-v1.mjs` component and official cache
installer, and proves legacy HTTP readiness and nonempty collection/rarity reads
through the direct fallback before writing `prepared.json`.

The source package is independently reviewed and locally tested. Its exact two
runtime files are staged without execution. Actual READ admission, native
metadata adoption/provenance and generation candidate receipts remain required
inputs. No successful future receipt is included in this package.

## Boundaries

The original 143-read admission remains a separate protected acknowledgement.
The installer adds exactly four non-grantable collector `SELECT` edges on
`metadata_projection.read_epoch`, `read_guard`, `read_set` and `read_member`.
Rehearsal identifies their exact OIDs and delta hash. Drain and commit require
that separate hash as an explicit authorization argument. They retain every
other role attribute, LOGIN state, effective permission, direct grant, grantor,
object identity and column ACL. Current complete ACLs for all four cache relations
are also compared with the acknowledged SQL postcatalog, including grants to roles
outside the managed admission set. The original whole-graph validator is deliberately
reported false after the four extra reads; an explicit acknowledged composition
checks the new graph and reuses the other frozen source preservation checks.

The candidate/database leaf is pinned to the accepted generation producer. Its
false source, metadata, admission and cache qualification flags are preserved.
This owner separately rechecks the actual source/read scope, accepted worker
sources, metadata actor/private configuration and current publication provenance.
It never treats a candidate receipt alone as current runtime readiness.

The SQL child runs through Unix peer authentication as the existing PostgreSQL
OS identity with no capabilities, no supplementary groups and no new privileges.
It receives no password or private environment. The existing official component
owns the transaction and guard changes. Root records the actual child, positively
attributes its PostgreSQL backend through kernel socket peers, and fsyncs its XID
and full prepared postcondition before authorizing the sole COMMIT. Literal
JavaScript JSON is preserved alongside sorted journals because the frozen
component's catalog digest depends on property order.

Old cache sessions are attributed to the exact cgroup processes and kernel
socket peers. Drain requires only that owned backend PID/start-time subset to
disappear; it never requires all sessions of the shared PostgreSQL role to be
zero. The original activation symlink is retained by inode for inverse. Every
manager action has a durable intent and a fresh actor/definition check.

## Explicit preparation sequence

Use a protected JSON input file with exactly these keys. Every SHA must name an
actual protected receipt. The provenance filename is an existing numbered
`provenance-N-observed.json` under the fixed metadata operation directory.

```json
{
  "readAdmissionSha256": "<actual-143-read-ack-sha256>",
  "metadataSelectionSha256": "<actual-selected-sha256>",
  "metadataProvenanceFile": "provenance-<actual-N>-observed.json",
  "metadataProvenanceSha256": "<actual-complete-provenance-sha256>",
  "generationSha256": "<actual-unpublished-candidate-sha256>"
}
```

The following commands describe separate reviewed phases, not an automatic
script. `OWNER` is the staged `ypal-cache-guard-owner-v1.py`; `INPUTS` is the
protected input file and `INPUTS_SHA` its actual hash.

```sh
python3 -I -B "$OWNER" --inputs "$INPUTS" --inputs-sha "$INPUTS_SHA"
python3 -I -B "$OWNER" --inputs "$INPUTS" --inputs-sha "$INPUTS_SHA" --rehearse "$REVIEW_SHA"
python3 -I -B "$OWNER" --inputs "$INPUTS" --inputs-sha "$INPUTS_SHA" --drain "$REVIEW_SHA" --additional-reads "$FOUR_READ_DELTA_SHA"
python3 -I -B "$OWNER" --inputs "$INPUTS" --inputs-sha "$INPUTS_SHA" --commit "$REVIEW_SHA" --additional-reads "$FOUR_READ_DELTA_SHA"
```

`--rehearse` rolls back the official installation. It does not stop a writer.
`--drain` disables only the old cache boot link and stops its exact actor after a
fresh socket attribution. `--commit` installs the reviewed catalog and four reads
once, then requires unchanged generation 103, stale cache sets and nine actual
legacy API GET acceptances. Success produces `prepared.json` with the cache
inactive and boot disabled. It starts no native worker and publishes no generation.

If post-install HTTP acceptance fails, stop at that failed preparation. Review
and apply the owned inverse; do not publish the native candidate.

## Recovery and inverse

`--inspect` is read-only and never infers success from the catalog alone.
`--reconcile-stop` can acknowledge a proven terminal owned actor without issuing
another stop. Unknown SQL outcomes require `--reconcile-commit` or
`--reconcile-inverse` with the exact durable intent-file SHA. Reconciliation
requires the owned child and PostgreSQL session to be gone, its actual XID to be
committed, and the complete current postcatalog to match the prepared record.
It never repeats SQL. After a reconciled forward commit,
`--acknowledge-prepared` separately performs the real legacy serving checks.

`--inverse-review` and `--inverse <review-hash>` reverse only owned effects. The
component restores old definitions, table and column ACLs and removes only its
four reads. Epochs increment from their actual current values; saved revisions
are not written back. `inverse-catalog-result.json` leaves the cache inactive and
boot disabled so the generation owner can restore the exact predecessor capsule.
`validate_inverse_catalog_current(pin)` exposes that terminal-only boundary.

For preparation that never published, `--finish-inverse` proves the original
global pointer/wallet/stamp observations remain unchanged before restarting the
old cache. After publication it instead requires the actual pinned
`restore-derived-result.json` and capsule chain. Restored workers receive a new
owned invocation; the original PID is never claimed to have returned. An unknown
start or stop is reconciled by actual owned state, never blindly repeated.

An unacknowledged rehearsal can be archived only through `--archive-review`, then
`--archive-aborted-rehearsal <review-hash>`. This requires the exact rehearse-only
child, its kernel-attributed PostgreSQL peer gone, its XID aborted, and unchanged
semantic catalog, roles, old actors, boot and private inputs. Only the same four
collection epoch revisions may advance monotonically. Both epoch observations are
recorded; full database byte equality is not claimed. Any mutation/start/stop
intent or worker overlay refuses archival. The sole operation is an exclusive
same-filesystem rename to one of three fixed sibling names, preserving original
file bytes and inodes and fsyncing the parent. It does not automatically rerun.

## Publication and worker start are still closed

`COORDINATED_OWNER` and its producer SHA remain unset. Consequently `--finish`
refuses before publication or worker effects. A separate reviewed owner must
coordinate global generation publication, derived leaderboard stamps and reader
installation. It must supply actual phase-aware source/reader preservation,
including exact owned reader replacements: the old c9 preservation function
intentionally rejects changes to its original consumer actors.

The eventual finish binding must authenticate the exact prepared receipt,
candidate, metadata and READ scope plus the coordinator's actual ACK. It must
then recheck current publication/reader state before the official worker starts
and require all four real `readCacheFreshSql` results before restoring boot.
The existing closed finish branch is preparation for that explicitly reviewed
successor, not an accepted production cutover path. No short interruption window
is promised; leaderboard refresh duration has not been qualified.

## Validation

```sh
python3 -I -B ops/unified-indexer-transition/ypal-cache-guard-owner-v1.test.py
```

From `apps/yunipals-indexer`, with the existing disposable local PG16 fixture:

```sh
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx /root/yunipals/ops/unified-indexer-transition/ypal-cache-guard-owner-v1-postgres.test.mjs
```

The Python controls cover exact read scope, private-file and source drift,
metadata actor/provenance CAS, real pipe ACK ordering, unknown outcomes,
publication inode recovery, fallback HTTP semantics and real exclusive rehearsal
archival. The PostgreSQL groups exercise the unchanged official installer and
component, rollback, full four-edge delta, outside-transaction visibility,
missing durable ACK, live-worker advisory lock, lost COMMIT/inverse ACKs, epoch
monotonicity and lock-timeout recovery with actual `psql` JSON XID parsing.
The fixture removes its synthetic database and role on completion.

The exact public child has also imported the accepted installer and cache query
modules in the existing cache mount namespace under its actual OS identity with
all network, fetch and PostgreSQL operations blocked. This proves import
compatibility only: no Pool, DB connection/query or provider request occurred;
two optional TSX Unix IPC attempts were denied. Detailed actual observations
remain private and confer no permission or execution acknowledgement.
