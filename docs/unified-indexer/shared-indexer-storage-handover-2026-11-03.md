# Shared indexer storage handover 2026 11 03

The existing project volume can hold the transition workload. Backup staging now uses that volume, and completed recovery/test files have been moved there. A new per-filesystem capacity check retains the configured 25 GB free-space reserve and 35 GB backup allowance, and additionally accounts for PostgreSQL WAL headroom and replacement read-cache space. The user approved the exact temporary-tablespace permission, it has been applied, and both application-role capacity checks and actual temporary-table placement have passed.

## Completed storage placement

`ops/unified-indexer/shared-backup-storage.py` copied and checksum-verified these workspaces before switching their existing paths to persistent bind mounts:

- `/var/lib/yunipals-arena/backups`
- `/var/lib/yunipals-marketplace/production/backup`
- `/var/backups/yunipal-islands`
- `/var/backups/yunipals-islands-indexer`
- `/var/backups/yunipals-shared-transition-20261102`

The mounted copies live beneath `/mnt/HC_Volume_107222036/yunipals-shared-transition-storage`. Original ownership, permissions, hard links, extended attributes and files were retained; old copies were removed only after the mounted copies passed a second checksum comparison. Active backup/monitor timers were paused for copying and restored. Backup units now require their mount and place generic temporary files inside their own workspace.

The completed disposable restore/test cluster was retained on that volume and restarted on its isolated port 55446. No production table, private Arena job or signing record was relocated or rewritten by the workspace operation. Afterwards the main disk had approximately 55.5 GB free and the extra disk 91.2 GB free.

The operator journal is `/var/lib/yunipals-unified-shared/storage-20261103` on `yunipals-main`. Inspect an incomplete intent instead of blindly retrying a mount operation. `--resume` supports verified completed workspaces and a copy that stopped before its mount intent.

## Capacity and temporary tables

Set `PROJECTION_STORAGE_LAYOUT_FILE` to a protected JSON file with exactly:

```json
{
  "format": "yunipals-projection-storage-v1",
  "tablespace": "yunipals_derived",
  "directory": "/mnt/HC_Volume_107222036/yunipals-derived-postgresql",
  "databaseDirectory": "/var/lib/postgresql/16/main",
  "backupDirectories": [
    "/var/lib/yunipals-arena/backups",
    "/var/lib/yunipals-marketplace/production/backup",
    "/var/backups/yunipal-islands",
    "/var/backups/yunipals-islands-indexer",
    "/var/backups/yunipals-shared-transition-20261102"
  ]
}
```

The runtime checks actual devices for existing tables, indexes and TOAST storage; validates the database directory against its live postmaster port/start time; requires the selected temporary tablespace; and charges each device separately. Each affected filesystem keeps its free-space reserve. Each filesystem containing backup workspaces also retains the full backup allowance. WAL budgeting retains a peak of 150% of `max_wal_size` plus retained replication-slot bytes. It charges only growth beyond the segment blocks already allocated on that filesystem, avoiding a second reservation for the same recyclable WAL files. The per-filesystem free-space reserve is unchanged. Archived-WAL configurations require separate review and are refused by this layout mode.

This opt-in mode leaves the old single-filesystem check available for existing deployments. It does not accept a different capacity path alone as proof of storage placement. The generation check precedes cleanup so a refused build does not retire generations first.

Production's existing `yunipals` database writer owns the collection tables already on this volume and already has database TEMPORARY and schema CREATE privileges. It lacked CREATE on the PostgreSQL tablespace, so PostgreSQL could not use that tablespace for its temporary tables. The user explicitly approved this exact additional permission on November 3, and it has now been applied:

```sql
GRANT CREATE ON TABLESPACE yunipals_derived TO yunipals;
```

This also permits that existing account to create permanent tables on the volume within schemas where it already has creation rights. It does not grant superuser, role administration or access to another database. Automatic approval review required explicit user approval for this concrete grant; the user provided it before application. Both generation and leaderboard capacity checks then passed as the actual application role. An empty temporary table was confirmed in `yunipals_derived` and rolled back. The existing four reader-function EXECUTE permissions were also mirrored from the old read schema to the replacement schema for the same six restricted roles (20 grants), retaining their established access.

The prepared metadata/publisher routed environment files retain private credentials on the server. They select the volume for temporary tables and keep all source identities, financial limits and existing free-space/backup reserves. Never start their build after a permission-refused diagnostic; the application writer must pass its own preflight.

## Remaining handover

The final source candidate resumed and all thirteen sources passed fresh native health. Full qualification at 11:00 UTC on November 3 matched 2,218,277 retained events and 35 registry/v2 events, rechecking current readiness. The encrypted backup through the relocated workspace passed. Native metadata adoption passed its full legacy-event comparison.

Generation 127 completed validation at 11:21 UTC with 1,072,868 search/revision records, 11,811,997 traits, all fifteen scopes and no missing revision links. All four complete caches were prepared: Ethereum 36,686 members, Polygon 15,970, BNB 580,093 and Base 440,194. The first publication attempt refused a changed Base revision before its commit intent; global pointers remained 114/113. After draining metadata writes, the second attempt committed at 12:18:23 UTC with 512,350 wallet rows. The active/previous pointers are now 127/114, and both derived stamps identify the final source. The fsynced journal is `/var/lib/yunipals-unified-shared/handover-20261103/publication-127-v2`.

Eight core services now select the shared source: main API, Collector, Islands API, both metadata workers, cache, leaderboard and booster API. Their live selectors were checked. Representative collections, tokens, Base tokens, leaderboards and booster types/openings returned 200. Installed application artifacts were retained except the corrected leaderboard worker. Ethereum Islands ownership was independently verified against all 898 onchain owners and metadata records; its release-specific activation marker and restricted staking support now use the final source. Islands readiness, tokens and staking status returned 200.

Marketplace's complete operational database was backed up and restored into a private isolated PostgreSQL instance: 43 tables, no network listener. All five consumer selections then passed their exact official reviews and were applied on November 3: BNB discovery, BNB sales, and collection sales on Ethereum, Base and Polygon. Private orders matched before and after. The existing source reader received SELECT access to the replacement public dataset; no source writes, schema creation or administrator privileges were granted. The new foreign read schema uses existing service mappings. The API responds 200 at `/health/ready`. Worker recovery and qualification are still being checked. Sale workers retain the database's exact owner-configured policies and the existing budget coordinator; old read-worker builds require the updated migration history.

Both Arena v2 operational epochs, the canonical supervisor transfer, required receipt support, canonical encrypted backup roots and restart/reboot checks remain pending. The booster artwork timer was temporarily paused for publication and must be restored after its existing queue is checked. Keep PR #15 in draft until these steps and the 90-minute/24-hour observation gates pass.

The successor publisher preserves the already-deployed cache safeguards from
commit `3c3d0655`: twenty-minute renewable preparation leases, retained candidate
cache rows, complete member/burned counts, publication row locks and a final cache
proof inside the official pointer update. Relevant source hashes were compared
with the installed artifact manifest before porting. The PR keeps the existing
main API and metadata-worker artifacts. The expanded real PostgreSQL rehearsal
passed 24 groups, including coordinator journal-failure rollback and invisible
global staging until one commit; the indexer suite passed 503 tests with two skips.

Concurrent cache-index maintenance recovered 6,966,894,592 bytes (the table's
physical size fell from 8,918,958,080 to 1,952,063,488 bytes), preserving generation
row counts, table identity, all four index definitions and valid indexes. Both
capacity phases and all thirteen source readiness checks passed afterward. Final
source cache guards are installed transactionally.

The first cache-preparation attempt waited on the deployment's one-connection
worker pool before any candidate cache rows were written. It was stopped and the
existing cache service resumed; a representative collection endpoint returned 200.
The corrected operator reuses its dedicated connection for native approval between
transactions, and publication/leaderboard completion also reuse held connections
for pointer inspection and counts. The full 503-test suite and all 24 actual
PostgreSQL groups pass with the production one-connection limit. Generation 127
has now been published through the corrected one-connection operator.


The CI rarity regression script had retained an outdated expectation that burning a
token leaves its cached membership valid. The trigger correctly invalidates burns.
The script now separately verifies that an ordinary owner transfer keeps the proof
valid and a burn uses the canonical fallback. Actual PostgreSQL verification passed
336 pagination cases and 144 trait-count cases. This correction does not weaken
the source or cache checks.
