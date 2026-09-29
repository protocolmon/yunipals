# Projection rollout record — 29 September 2026

This record accompanies the design and acceptance gates in
`docs/indexer-durable-503-fix-plan.md`. It concerns refresh-related 503s caused
by table renames waiting behind marketplace snapshots. The separate
rarity-sorted token timeout and deep marketplace pagination 500 require their
own fixes.

## Recovery baseline

- Indexer PostgreSQL 16 database: `yunipals_backfill`, 56 GB before rollout.
  Current metadata and derived-trait release: `metadata-20260921-v1`.
- Encrypted pre-migration PostgreSQL backup on the Storage Box:
  `yunipals-marketplace/indexer-next-recovery/cutover-20260929T083427Z`.
  Local report:
  `/var/backups/yunipals-indexer-cutover-20260929T083427Z/offhost-report.json`.
  The database dump, globals, runtime archive, and manifest were each uploaded,
  downloaded, decrypted, and SHA-256 checked. Verification completed at
  09:02:45 UTC. The backup captures the live `f0bd9a0` runtime before schema
  changes.
- All 14 MongoDB archives are on the Storage Box under
  `yunipals-mongo-v2/mongo-20260929T075856Z-5e5a58/`. The manifest and one
  archive were downloaded and SHA-256 checked. That archive was restored into
  an isolated MongoDB instance: 9,177 documents, zero restore failures. The
  `mongodb-backupmon.timer` now runs the sequential streaming backup that was
  used for this successful run, avoiding the old 53 GB local dump peak.

## Installed release and schema

- Reader runtime source: `e8e7180`, staged at
  `/opt/yunipals/releases/e8e7180/apps/yunipals-indexer`.
- Writer runtime source: `0869e9d`, staged at
  `/opt/yunipals/releases/0869e9d/apps/yunipals-indexer`.
- Marketplace runtime: current production `9b69597` plus the projection reader
  bundle, staged at `/opt/yunipals-marketplace/releases/f7d4774-projection`.
- Additive `metadata_projection` schema installed on the production indexer.
  `market_prod_source_read` has `USAGE` and `SELECT` on its active pointer,
  generation registry, and search table, without write access. All five payload
  tables and their TOAST relations set `vacuum_truncate=false`.
- The old rename-based leaderboard worker was stopped and disabled. Its
  installed systemd command now points to the generation-capable release and
  remains disabled until the first refresh is verified. Scheduled refresh
  entrypoints were audited; no separate trait-refresh timer or cron job was
  found.

## Seed and reader verification

Generation 1 was copied in one repeatable-read transaction from the five legacy
published tables. Counts matched exactly: 1,072,868 search rows, 11,811,997
trait rows, 1,072,868 revision rows, 305 facets, and 15 facet statuses. A sample
of 100 rows in each large table matched all columns, as did every facet and
facet-status row. The active generation, source release, and trait release all
refer to `metadata-20260921-v1`.

`VACUUM (ANALYZE, TRUNCATE FALSE)` completed. Full-size `EXPLAIN ANALYZE`
checks used the generation-prefixed rarity and trait indexes, with sampled
execution times below 3 ms. At the first-build capacity check, projection
tables occupied about 5.2 GB and the host had 75.8 GB free. The build gate
requires approximately 45 GB at this data size, including the 25 GB reserve.

The main API, collector API, and marketplace API were each deployed first in
legacy mode, then switched individually to generation mode. Process environment
checks confirmed the active generation flag. Main API readiness, default BNB
tokens, and BNB traits returned 200; the BNB facet result remained 16 trait
types with 518,543 available and 5 missing. Collector readiness and a bounded
owner page returned 200. Marketplace readiness, first catalog page, and
capabilities returned 200. Services showed no restarts after the switch.

A BNB `rarity-desc` token request exceeded 20 seconds in generation mode. The
same request exceeded 25 seconds in an isolated legacy-mode instance using the
same release, so this timeout predates the projection switch. The comparison
instance was stopped. This issue needs a separate query-plan investigation.

## First refresh attempt and query correction

The first generation-backed refresh was launched as
`yunipals-projection-first-refresh-20260929.service`. The scheduled worker
remains disabled. A supervised
`yunipals-projection-first-probe-v2-20260929.service` checked live API,
collector, and marketplace routes every 15 seconds. It saw no read errors
during the private build.

During the private build, a lock sample found five marketplace source sessions
holding `AccessShareLock` on `metadata_projection.search`, one for 72 seconds.
The worker continued writing, no projection payload relation had an
`AccessExclusiveLock`, and the active pointer remained on generation 1.

The first candidate did not publish. Its facet phase spent over 35 minutes on
one of 15 scope queries, with high PostgreSQL CPU and temporary file spill at
the default 4 MB `work_mem`. The one-off worker and then its remaining database
query were cancelled. The active pointer stayed on generation 1 and the only
ready registry row was generation 1. The aborted candidate's dead rows were
reclaimed for reuse with `VACUUM (ANALYZE, TRUNCATE FALSE)` on all five payload
tables; this completed at 13:36 UTC without changing the pointer. The facet
query was changed to scan traits once, join them to active token identities,
group the four collections, and derive all 15 scopes from those aggregates. A
full-size read-only comparison on generation 1 completed in 3 minutes 40
seconds at 64 MB `work_mem`: all 305 facet rows matched the published values,
including category counts and numeric ranges. The query spilled about 700 MB
at that setting. At a transaction-local 256 MB limit, the same comparison
finished in 2 minutes 49 seconds with zero differences. The optimized facet
status query matched all 15 published rows in 4.4 seconds. Indexer typecheck
and 92 tests passed (one skipped). The writer release was staged and its changed
source file SHA-256 verified.

## First publication observation

The retained marketplace snapshot probe started at 13:54:13 UTC on generation
1. The optimized one-off refresh started at 13:54:44 UTC in a supervised
systemd unit with all three production environment files. The scheduled worker
remains disabled until the optimized full refresh completes and the publication
probe passes. The 24-hour route observer still needs to run.

Record the first refresh's generation ID, validation, publication duration,
probe summary, storage after cleanup, and post-release backup result here before
marking this rollout complete. The full 24-hour and three-cycle acceptance
window in the plan is still required.

## Reversal commands

If the first refresh fails before publication, generation 1 remains active. Stop
the one-off unit if necessary, inspect its journal and `metadata_projection`
registry, and keep the current readers. Do not re-enable the old worker.

If a later generation is bad, stop the active generation worker and run
`scripts/rollback-projection.ts` from the installed release with the indexer
database environment file. The rollback operation verifies and selects
the protected previous ready generation and updates the trait release record in
one transaction. Recheck all three readers before resuming the worker.

```sh
systemctl stop yunipals-leaderboard.service
systemd-run --unit=yunipals-projection-rollback --wait --collect \
  -p WorkingDirectory=/opt/yunipals/releases/0869e9d/apps/yunipals-indexer \
  -p EnvironmentFile=/etc/yunipals-indexer/indexer.env \
  /opt/node-v24.18.1/bin/node --import tsx \
  /opt/yunipals/releases/0869e9d/apps/yunipals-indexer/scripts/rollback-projection.ts
```

If the optimized one-off refresh is still running, stop
`yunipals-projection-optimized-refresh-20260929.service` before invoking rollback.
Check its journal and the pointer after any ambiguous stop or database response.

During the initial seeded switch only, the staged `*-compat.conf` files under
`/opt/yunipals-ops/projection-dropins/` can return readers to legacy storage.
After the first generation refresh, the old tables are stale; do not switch
back to them without rebuilding and validating them. The pre-migration encrypted
backup is for a separate corruption recovery procedure, with later writes
reconciled.
