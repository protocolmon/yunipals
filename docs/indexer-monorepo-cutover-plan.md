# Indexer monorepo restore and cutover plan

Status: Phase 1 accepted and the six-service production switch completed on
28 September 2026. The first-hour and 24-hour observation gates remain open.
The detailed steps below are the original runbook; this execution record takes
precedence where measurements differ from estimates.

## Execution record

- The complete production backup restored into an isolated PostgreSQL 16 cluster
  in about 30 minutes. The restored database was 52.2 GB, with 92 migrations and
  the existing Ponder build `29871611ab`. The clone was removed after testing;
  production data and services were not changed during Phase 1.
- Release `f0bd9a0` reproduced the installed Ponder reorg fix and continued the
  Ethereum, Base, Polygon, and BNB checkpoints. A second BNB writer was refused
  by the new advisory lock. The previous Ponder and BNB programs then continued
  from candidate-written clone checkpoints, proving code rollback on that data.
- The previous and candidate main APIs matched exactly on 41 of 42 sampled
  routes. On a cold clone, the previous API timed out on one indexed BNB rarity
  count while the candidate returned 200; the bounded owner rarity response
  matched exactly. Collector APIs matched on all 18 routes. Five reader routes
  matched after candidate writes and four more after the trait table swap.
- The candidate completed a full trait and leaderboard refresh: 512,342 wallet
  rows in 15 scopes, with the existing metadata release retained. The full
  multichain verifier passed with a representative cross-chain owner; its
  default owner had 7,530 Base tokens and timed out on the cold clone.
- Rehearsal used a clone-only privileged database role with `--no-owner --no-acl`.
  Production schema ownership and grants were checked separately. Metadata Base
  replay on the clone was deferred by the shared RPC budget; the production
  cursor matched the restored state and had no pending or failed publication jobs.
- Protected machine-readable evidence is stored under the rehearsal directory
  beside the premerge backup on the production host. The code switch is scripted
  in `apps/yunipals-indexer/scripts/cutover-production.sh`, with the inverse in
  `apps/yunipals-indexer/scripts/rollback-cutover.sh`.
- A fresh full PostgreSQL dump (6,986,947,356 bytes), globals file, and recovery
  bundle were encrypted and uploaded to the Storage Box. Each file was downloaded,
  decrypted, and hash-checked; the off-host report completed at 22:58:34 UTC.
  The recovery bundle includes the previous checkout, exact old and new runtime
  paths, dependencies, service definitions, private configuration, certificates,
  PostgreSQL configuration, and rehearsal evidence. The database dump passed
  `pg_restore --list`. This is a full snapshot recovery point; no WAL/PITR claim
  is made. Routine code rollback retains the live database and later writes.
- The service switch completed at 23:02:54 UTC without a database migration.
  All six services now run release `f0bd9a0` through the versioned monorepo path;
  the progress monitor also runs a versioned copy. Ponder kept build `29871611ab`,
  BNB advanced from block `124609100` to `124609148` during the switch, and the
  active metadata release remained `metadata-20260921-v1`. Exactly one BNB
  ownership writer held the database advisory lock after startup.
- Eleven public checks returned 200 after the switch, including indexer and
  collector reads, Base traits, BNB leaderboard, three legacy metadata domains,
  marketplace capabilities, and a real BNB marketplace asset. The static
  collector capabilities and all three metadata response bodies matched their
  pre-cutover hashes. The protected production-cutover record contains exact
  before/after checkpoints and route digests.

## Outcome

Run the collection indexer, BNB ownership worker, metadata worker, leaderboard
worker, main API, and collector API from one reproducible monorepo release.
Preserve the existing production database, checkpoints, metadata release, API
contracts, and public routes. Exactly one BNB ownership worker may write to the
production BNB schema at a time.

## Verified pre-cutover starting point

| Component | Current production | Proposed release command |
| --- | --- | --- |
| `yunipals-indexer` | `/root/indexer-next`, Ponder on 9010 | `start:indexer` |
| `yunipals-bnb` | `/root/indexer-next`, BNB ownership | `start:bnb` |
| `yunipals-metadata` | `/root/indexer-next`, archive publisher | `start:metadata` |
| `yunipals-leaderboard` | `/root/indexer-next`, local rarity | `start:leaderboard` |
| `yunipals-api` | `/root/indexer-next`, HTTP on 9011 | `start:api` |
| `yunipals-collector-api` | `/opt/yunipals-collector/releases/20260923-rarity-range`, HTTP on 9012 | `start:collector` |

Commands are package scripts in `@protopals/yunipals-indexer`. Production units
should use absolute, pinned runtime and entrypoint paths; the table describes
their corresponding workspace commands.

- Production database: `yunipals_backfill`, PostgreSQL 16.
- Node: `/opt/node-v24.18.1/bin/node`; target pnpm: 9.12.0; Ponder: 0.17.5.
- Ponder schema: `yunipals_indexer_v3`; BNB schema: `bnb_indexer`; combined read
  schema: `yunipals_read_v4`.
- Main API, metadata, and leaderboard use `METADATA_SOURCE_MODE=archive` and
  `RARITY_READ_SOURCE=local`, supplied by systemd environment-file overrides.
- Collector enables filters and rarity ranges, disables name search, and does
  **not** currently receive the archive/local environment override. Its behavior
  must be compared independently before choosing its release configuration.
- Ponder runs an `ExecStartPre` patch from `/opt/yunipals-indexer-ops/` that changes
  reorg trigger handling in the installed Ponder dependency. A clean package
  installation alone does not reproduce this runtime.
- Nginx sends the main indexer API and several legacy metadata domains to 9011;
  collector capabilities and `/v2/owners/` go to 9012. Marketplace traffic uses
  a separate service. Its BNB order-discovery worker has a separate purpose
  from the BNB ownership worker being migrated.

### Backup and capacity

The existing backup is
`/var/backups/yunipals-indexer-premerge-20260928TAduj0X`. Its 4.4 GB compressed
database archive, application, configuration, and PostgreSQL roles were verified
locally and after encrypted Storage Box upload/download/decryption. Its full
restore was completed in Phase 1. The database was approximately 56 GB when
inspected for backup.

Production had about 100 GiB free disk and 14 GiB available memory before the
rehearsal.
The development host has no normally available disk space. Capacity must be
remeasured before execution. Use the Storage Box for encrypted backups; keep
the rehearsal PostgreSQL data on local storage.

## Phase 1 — restore and prove parity

### 1.1 Capture the complete deployment baseline

1. Record the exact source/release hashes, installed dependency versions,
   service units and drop-ins, effective non-secret configuration, listener
   ports, proxy routes, database/schema identifiers, and current checkpoints.
2. Inventory startup hooks, timers, and cron jobs referring to the old checkout.
   Identify every writer to affected database schemas, including API visibility
   changes, ENS caches, metadata jobs, and marketplace consumers.
3. Extend the encrypted recovery bundle with the complete Ponder patch directory
   and helper/original runtime files, current collector release and private
   configuration, and any additional referenced runtime assets. Verify the
   actual archive member lists; the existing manifest covers the checkout and
   `/etc` configuration but does not establish coverage of these `/opt` trees.
4. Record normal API latency/error rates, worker cycle durations, chain lag,
   publication queues, and database resource use. Keep manifests and reports
   free of credentials; retain private configuration only in protected backups.

Deliverable: a deployment inventory, complete recovery manifest, and baseline
measurements.

### 1.2 Prepare an isolated rehearsal environment

1. Use a separate PostgreSQL 16 instance/container, an isolated data directory,
   loopback ports, fresh credentials, and a network boundary that denies access
   to the production database. Preserve production schema names inside it.
2. Budget for one full restored database, restore/WAL/index overhead, application
   dependencies, and at least 25 GiB of free production disk after projected
   peak use. Cap restore concurrency and rehearsal CPU/memory/I/O. If the
   estimate exceeds available capacity, use another host or additional local
   storage before restoring. Do not keep two 56 GB clones on this host.
3. Fetch the encrypted backup from the Storage Box, decrypt privately, and verify
   manifest hashes before restore. Recreate necessary owners/grants only in the
   isolated cluster; audit globals so restored roles cannot authenticate to
   production. Validate application permissions using rehearsal-only credentials.
4. Restore the complete dump with errors treated as failures, then analyze it.
   Record duration, peak space, restore errors, schema inventory, critical table
   counts, constraints, active archive release, and restored checkpoints.
5. Explicitly override all database destinations and ports when constructing
   rehearsal configuration. Permit only necessary, budgeted RPC traffic.
   Enforce loopback exposure for every rehearsal API: the main API currently
   omits an explicit bind address, despite logging a loopback URL.

Deliverable: successful full restore report and measured recovery duration.

### 1.3 Make the candidate release reproducible

1. Install the exact monorepo revision with Node 24.18.1, pnpm 9.12.0, and the
   frozen lockfile. Include the vendor archives and their recorded hashes.
2. Bring the reviewed Ponder reorg fix into version-controlled packaging,
   preferably as a pinned pnpm dependency patch. Verify that the packaged runtime
   reproduces the production patch. Rehearse reorg/restart behavior while readers
   are active. Remove dependence on mutating a shared pnpm store at startup.
3. Compare Ponder configuration/schema/indexing build identity with production.
   Ponder 0.17.5 rejects a different build ID in an existing schema. If it differs,
   resolve the cause and repeat the rehearsal; do not overwrite its metadata or
   drop a production schema to force startup.
4. Compare BNB schema/ABI/settings and checkpoint semantics with the old worker.
   Validate the explicit `BNB_RPC_URL`, range limits, 20 confirmations, and
   shutdown deadline. The new worker has stricter configuration validation.
5. Add a tested database advisory-lock guard for the BNB writer, held on a
   dedicated connection for its lifetime and acquired before worker writes.
   A second candidate worker must fail before writing, and lock-connection loss
   must stop the worker. The legacy worker does not participate in that lock:
   stop-and-confirm remains required during cutover and rollback.
6. Re-run indexer typecheck/tests and relevant integration checks using the
   pinned runtime. Exercise destructive fixture/check scripts only in disposable
   databases. Inventory each script's side effects before using it in rehearsal.

Deliverable: immutable candidate artifact, dependency/patch manifest, and exact
service command mapping.

### 1.4 Compare old and new readers on the same restored state

Keep writers stopped for the initial comparison. Run the archived production
main API and actual collector artifact against the restored database, capture
responses, then run candidate readers against that same state. Account for API
cache writes; reset any changed state before a comparison that depends on it.
Preserve current per-service feature flags and metadata modes for this baseline.

| Area | Required comparisons |
| --- | --- |
| Ownership | Counts by chain, owners, burns/remints, lifecycles, transfer ordering, cross-chain token-ID collisions |
| Browsing | Token details, owner holdings, pagination without gaps/duplicates, sorting and visibility |
| Collector | Capabilities, multi-chain filters, trait facets, rarity ranges, totals, cursor validation, and empty results |
| Metadata | Active release, bindings, JSON content, images/attributes, legacy aliases, HTTP status, ETag and cache behavior |
| Rarity | Supplied/local scores, capped scores, formula/version, sort order, and missing-score behavior |
| Derived data | Per-chain/combined traits and leaderboard snapshots with matching release IDs |
| Consumers | Marketplace ownership/lifecycle reads and existing read-view permissions |

Use a deterministic dataset covering all four chains and exceptional records.
Normalize only explicitly volatile fields such as request timing. Ownership,
scores, release IDs, and missing records must not be normalized away. Comparing
a frozen backup to today's live API is a smoke check, not proof of parity.

Collector mode is a specific decision gate: compare current behavior first,
then validate archive/local mode if needed for the unified deployment. Any
response differences must be understood and documented before cutover.

Deliverable: machine-readable response differences, aggregate SQL checks, and
an explicit list of accepted intentional differences.

### 1.5 Prove worker continuation and rollback

1. Record restored state, run only required migrations on the clone, and inspect
   schema/data differences. Determine the smallest production migration set;
   a source relocation should need none if schemas already match. Never run
   `bnb:standalone-views` on the four-chain deployment.
2. Start candidate Ponder on the clone and verify that it resumes existing
   checkpoints for Ethereum, Base, and Polygon, retaining required read views
   and triggers. Verify a clean stop and restart.
3. Resume candidate BNB from the restored cursor. Validate its hash against RPC,
   replay to a chosen finalized endpoint using `BNB_END_BLOCK`, and compare
   supply at that block, owners, lifecycles, and deduplicated events. Do not
   reset to the deployment block. Allow for the configured reconciliation cycle.
4. Start archive metadata and leaderboard workers. Check Base metadata replay,
   publication claims, release bindings, retries, freshness, and queue progress.
   The existing active release must remain active.
5. Run read/API checks during worker activity and restart recovery. Exercise
   the single-writer guard and interruption/idempotent recovery with disposable
   fixtures where the restored dataset lacks a useful event case.
6. Stop candidate workers, restore previous process definitions/code, and start
   the old workers/readers on candidate-written clone data. Verify continued
   indexing and API parity. This proves code rollback without discarding new
   database writes. Reset/re-restore the clone sequentially if required.

### Phase 1 exit gate

Proceed only when the full restore succeeds; runtime packaging reproduces the
host patch; Ponder resumes; BNB cursor/hash/supply checks pass; reader differences
are resolved; workers make progress; and the old release works after candidate
writes. Record actual restore/restart timings, resource use, RPC consumption,
and any migrations. A destructive migration or incompatible old reader requires
a separate migration/recovery design before phase 2.

## Phase 2 — production cutover

### 2.1 Stage the tested release and recovery material

1. Publish the tested artifact into a versioned directory, proposed as
   `/opt/yunipals/releases/<git-sha>/apps/yunipals-indexer`. Verify its hashes and
   installed dependency patch. The artifact must be identical to the rehearsal.
2. Prepare reviewed systemd overrides for all six services: absolute entrypoint,
   working directory, runtime path, shutdown behavior, and environment-file
   precedence. Preserve existing RPC budgeting, database identifiers, feature
   flags, and archive/local settings. Replace the old Ponder patch startup hook
   with verification of the packaged patch and retain other required hooks.
3. Place the release's private runtime configuration under an operator-owned
   `/etc/yunipals-indexer/` directory with restricted permissions. Preserve the
   existing configuration for rollback. Keep API and worker database privileges
   scoped to their actual operations, including explicit API cache/visibility
   writes where required.
4. Retain service names and ports 9010/9011/9012 so existing proxy routing can
   continue. Include collector migration in this deployment; retain its old
   artifact for reversal. Verify all legacy metadata domain mappings.
5. Produce a fresh full backup and expanded config/runtime bundle, encrypt and
   verify it on the Storage Box, and record its snapshot time. Verify coverage
   of the actual database by any existing WAL/PITR system before claiming
   point-in-time recovery. Otherwise document the precise backup recovery point
   and potential post-snapshot loss; code rollback is the normal reversal path.
6. Prepare exact forward/rollback command files, previous unit definitions,
   baseline checkpoints, and a monitoring checklist. Schedule the cutover using
   measured restart times. Allow brief API restart errors and delayed indexed
   updates; do not promise zero downtime before rehearsal results.

### 2.2 Switch writers, then readers

1. Recheck candidate hashes, backup verification, database health, disk headroom,
   service status, active metadata release, and normal public responses. Check
   for source/config drift since rehearsal; repeat affected checks if needed.
2. Pause identified schedulers that could restart an old writer. Stop metadata
   and leaderboard workers, then Ponder and the old BNB ownership worker. Allow
   in-flight work to finish. Confirm old processes and database sessions have
   ended; record final durable checkpoints and hashes.
3. Apply only the schema changes explicitly rehearsed, with bounded lock waits.
   The default is to reuse existing data and schema. If an unplanned migration
   is needed, return to phase 1.
4. Install the reviewed overrides and reload systemd. Start candidate Ponder and
   BNB; verify expected process paths, BNB lock ownership, unchanged checkpoint
   origins, successful RPC hash validation, and forward progress.
5. Start metadata, then leaderboard, and verify readiness, publication progress,
   and compatible snapshots. Check old readers during this interval; their
   compatibility must already have been proven in rehearsal.
6. Restart the main API and collector API individually onto the candidate.
   Verify loopback readiness and public requests through Nginx after each.
   Check the main API, collector routes, legacy metadata domains, and marketplace
   ownership reads. Preserve public ports and route mappings.
7. Re-enable only schedulers whose commands/configuration match the new release.
   Confirm no old process or timer can launch a second ownership writer.

### 2.3 Acceptance and observation

- Immediately: six intended services run the pinned artifact; readiness checks
  pass; active release and response samples match; no duplicate writer exists.
- First 60 minutes: poll every minute for crashes, API failures/latency, chain
  lag, BNB hash errors, publication queue age, snapshot freshness, database locks,
  CPU/memory/disk, and RPC budget. Require observed progress over multiple normal
  worker cycles, not just green process status.
- Next 24 hours: observe existing monitoring and normal publication/refresh
  cycles; investigate any regression before retiring recovery material.
- Proposed regression triggers: an ownership/metadata mismatch, cursor hash
  failure, restart loop, two consecutive minute samples of critical route
  failure, sustained API p95 above twice baseline, or a worker exceeding two
  configured cycles without expected progress. Fix numeric thresholds in the
  runbook from phase 1 measurements, including provider budget backoff behavior.

### 2.4 Rollback

**Code/configuration problem:** stop new writers and confirm they have exited;
restore the previous unit definitions, hooks, private configuration and API/
collector entrypoints; reload systemd; start previous chain workers, then
metadata/leaderboard, then readers. Verify checkpoints and routes. Preserve the
current database so successfully indexed events and user changes remain intact.
Allow Ponder only its proven restart recovery behavior. Never overlap old and
new BNB workers, even though the new worker has a lock.

**Suspected data corruption or incompatible schema:** stop affected writes and
fence affected reads, retain diagnostic state, and restore into a separate
database using the rehearsed backup/PITR path. Reconcile writes after the
recovery point, especially off-chain visibility/preferences and other shared
database data that chain replay cannot regenerate. Validate before repointing
services. A full live database overwrite is not part of routine rollback.

Keep the old checkout, Ponder patch files, collector release, configuration,
and verified Storage Box backups through the observation period. Cleanup and
retention changes follow successful acceptance as a separate step.

## Deliverables and completion criteria

1. Expanded backup manifest and successful full restore report.
2. Reproducible release including the reviewed Ponder patch and BNB singleton
   guard, with a response/checkpoint parity report.
3. Tested unit definitions, forward/rollback command files, measured downtime
   estimate, and documented database recovery point/time.
4. Deployment record containing commit/artifact hashes, final service mapping,
   before/after checkpoints, public smoke results, and observation results.

Complete when all six services run the pinned monorepo release, indexing and
publication continue correctly, public consumers pass their checks, exactly one
BNB ownership writer is active, and the observation period is accepted.
