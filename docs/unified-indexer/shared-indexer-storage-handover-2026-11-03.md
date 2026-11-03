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

The runtime checks actual devices for existing tables, indexes and TOAST storage; validates the database directory against its live postmaster port/start time; requires the selected temporary tablespace; and charges each device separately. Each affected filesystem keeps its free-space reserve. Each filesystem containing backup workspaces also retains the full backup allowance. WAL budgeting uses 150% of `max_wal_size` plus retained replication-slot bytes. Archived-WAL configurations require separate review and are refused by this layout mode.

This opt-in mode leaves the old single-filesystem check available for existing deployments. It does not accept a different capacity path alone as proof of storage placement. The generation check precedes cleanup so a refused build does not retire generations first.

Production's existing `yunipals` database writer owns the collection tables already on this volume and already has database TEMPORARY and schema CREATE privileges. It lacked CREATE on the PostgreSQL tablespace, so PostgreSQL could not use that tablespace for its temporary tables. The user explicitly approved this exact additional permission on November 3, and it has now been applied:

```sql
GRANT CREATE ON TABLESPACE yunipals_derived TO yunipals;
```

This also permits that existing account to create permanent tables on the volume within schemas where it already has creation rights. It does not grant superuser, role administration or access to another database. Automatic approval review required explicit user approval for this concrete grant; the user provided it before application. Both generation and leaderboard capacity checks then passed as the actual application role. An empty temporary table was confirmed in `yunipals_derived` and rolled back. The existing four reader-function EXECUTE permissions were also mirrored from the old read schema to the replacement schema for the same six restricted roles (20 grants), retaining their established access.

The prepared metadata/publisher routed environment files retain private credentials on the server. They select the volume for temporary tables and keep all source identities, financial limits and existing free-space/backup reserves. Never start their build after a permission-refused diagnostic; the application writer must pass its own preflight.

## Remaining handover

The final source candidate resumed and all thirteen sources passed a fresh native health check. Fresh full qualification completed on November 3 at 06:55 UTC, matching 2,218,259 retained events and 35 registry/v2 events, with current native readiness rechecked. Reports are under `/var/lib/yunipals-unified-shared/qualification-20261103`. The encrypted backup through the relocated workspace also passed. After the permission and storage checks passed, the temporary source, four free-only relays and observer resumed. All thirteen sources subsequently passed fresh readiness, and native metadata adoption passed its full legacy-event comparison. A new unpublished generation build is running with the old generation publisher drained; the old cache worker and readers are still serving. Repeat source qualification is also running. Complete cache preparation and coordinated publication, then follow the reviewed source/consumer handover and recovery gates. The existing main indexer and readers continue serving, and Arena epochs remain unchanged. PR #15 remains a draft until those gates are satisfied.
