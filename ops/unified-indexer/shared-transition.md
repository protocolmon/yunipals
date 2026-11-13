# Completing the shared source transition

Use the detailed [transition plan](https://github.com/protocolmon/yunipals-ops/blob/main/docs/unified-indexer/shared-indexer-arena-v2-transition-plan-2026-11-02.md)
for production gates, backups, consumer inventory and rollback. Commands below
prepare artifacts; they do not authorize activation or establish native readiness.
Run indexer commands from `apps/yunipals-indexer` with Node 24 and the reviewed
public source configuration loaded. Keep private credentials on the server.

## Final source and identity

The manifest must enable exactly eleven retained non-Arena sources, the fighter
registry and one `YunipalsArenaV2` source. Both modes use that contract. The old
video and standalone Anime contracts are absent from continuous ingestion.
When `UNIFIED_PORTALS_JSON` is configured, the manifest additionally requires all four portal sources (17 enabled sources in total). Follow the [portal migration plan](../../docs/unified-indexer/portals-migration-plan.md) for portal views, private-consumer handover and parity.

Registered booster ingestion ABIs and per-contract deployment blocks must remain
identical even when the wallet SDK adds contract helpers.

The production marketplace retains depth-20 sale policies for Ethereum and
Polygon. Include `UNIFIED_OWNERSHIP_DEPTHS_JSON='{"ethereum":[20],"polygon":[20]}'`
when preparing this release. The specification records these explicit additions
to the existing latest/finalized policies. Baseline validation permits only those
declared additions; addresses, ABIs, start blocks, receipt history and existing
policies still have to match exactly. This allows the marketplace consumers to
move off legacy scanning without weakening or renaming their confirmation rules.

`scripts/build-shared-indexer.mjs --schema SCHEMA --output /absolute/fresh-build.json`
uses Ponder's real compiler with stubbed headers and no database or provider
connections. It verifies every enabled address, deployment block and handler.
Its build identity must match the subsequent running Ponder build. Production
preflight remains mandatory.

Prepare a fresh deployment specification with:

```sh
node --import tsx scripts/prepare-shared-indexer.ts \
  --baseline /absolute/current-manifest.json \
  --arena-baseline /absolute/previous-shared-arena-manifest.json \
  --profile /absolute/reviewed-rpc-profile.json \
  --schema FRESH_SCHEMA --build-id ACTUAL_BUILD \
  --read-schema FRESH_OWNERSHIP_VIEW \
  --output /absolute/fresh-deployment.json
```

This specification binds the schema, actual build, complete manifest, ownership
view and four reviewed relay endpoints. Registration still uses
`unified-control.ts register` against actual native framework metadata. Never
relabel the previous source schema or overwrite its registration.

## RPC service lifecycle

Migration 30 adds explicit `temporary` and `service` approvals. Existing approvals
remain temporary with their original expiry. New production service approvals
require a fresh `profile.reviewId`, `lifecycle: "service"` and `expiresAt: null`.
The database stores positive infinity so existing relay expiry predicates remain
compatible. They remain revocable and subject to the same coordinator and budgets.

Run `apps/yunipals-market-api/scripts/review-unified-rpc-policy.ts --file INPUT`
with the restricted operator connection, inspect the policy and review hash,
then apply that exact hash. Use a new identity instead of trying to renew an old
insert-only approval. No budget, allocation or usage counter is reset. Every
paid replay permit still needs a finite expiry, explicit range and CU maximum;
the service lifecycle grants no paid replay authority. Normal operation uses
`UNIFIED_RPC_FREE_ONLY=true` and no replay permit IDs.

Expired/disabled profile readiness returns a bounded error code such as
`rpc_profile_expired`; provider credentials are never included in that response.

## Consumer settings and observer

Use the same validated deployment file for the observer, readers and each v2
mode. `scripts/configure-shared-consumer.ts` replaces the frozen, release-specific
reader configuration path for this transition:

```sh
node --import tsx scripts/configure-shared-consumer.ts \
  --deployment /absolute/deployment.json --consumer reader \
  --output /absolute/fresh-reader.selectors.env
```

`reader` sets the physical schema, immutable ownership view, release and native
metadata/generation mode. `publisher` also updates the four projection-anchor RPC
routes and their reviewed profile. `booster` selects its public source schema.
`marketplace-ownership`, `marketplace-sales`, `marketplace-bnb-discovery` and
`marketplace-bnb-sales` emit their respective explicit source selectors, retaining
private connection files and requiring reviewed operational consumer selection.
For `marketplace-ownership`, pass `--ownership-read-schema` explicitly. Marketplace
ownership uses `latest` on all chains: the most recent complete indexed prefix,
without requiring BNB coverage to reach the moving head-minus-20 target.
Create a fresh immutable view schema over the existing shared release with
`scripts/unified-ownership-views.ts` and `UNIFIED_INDEXER_BNB_READ_POLICY=latest`,
then apply the existing restricted source grants and import its five read
relations into the marketplace FDW database before selecting it. Existing
project read schemas keep their original policies; never rewrite their markers.
This changes SQL views only and requires no new Ponder instance or historical
replay. Rebuild the marketplace API and BNB worker together. Trading retains its
separate confirmation, current-owner, transfer-gap, approval, order-state and
simulation checks. Halted/stale sources and changed canonical branches still
reject reads, including held catalog pages.
`arena` emits only its three source selectors, keeping
mode configuration and private operational work intact. `observer` also requires
`--profile /absolute/profile.json` and emits its RPC and deployment settings.
The generator writes a new public overlay; it does not edit service files, grant
database privileges, switch Arena epochs or restart workers. Retain the installed
application artifacts and their private inputs unless a compatible rebuild is
required. In particular, preserve current monster-version functionality.

Install the overlay after existing service environment files, checking both
systemd's environment and Node's `--env-file` layers. The inherited process
environment overrides Node env files. For the new source, remove obsolete Arena
aliases and all replay permit IDs from its private base before applying public
settings. Changing `active_release` alone does not migrate explicit consumers.

`scripts/shared-indexer-observer.ts inspect|health|observe-once|worker` checks the exact
registered build/manifest/profile, holds a singleton observation lease and runs
independent bounded loops for all four chains. It performs observation support,
not log ingestion or provider generation. Use automatic recovery from the
observer unit example. The receipt service/timer examples reuse the reviewed
`unified-control.ts receipts-once` command with a bounded pool and batches, after
qualification. Existing receipt evidence is keyed by chain/block/transaction and
is reused across releases; it is not blindly regenerated or reset. Preserve its
restricted control-table grants. Neither support task performs log ingestion.

Native Base metadata approval must also remain fresh while the full metadata
worker runs lengthy publication scans. Install the separate native-approval
service/timer using the existing `native-base-metadata` worker profile and the
same protected metadata writer configuration. Its `native-refresh` command
checks the adopted frontier and implementation with bounded point reads; it
does not adopt, scan logs or generate media. The existing advisory lock prevents
overlap with the full worker. Keep the two-minute approval expiry and all source
checks. Route these point reads through the ordinary production Base endpoint
at port 19202, rather than a retired source-specific relay. No provider, wallet
or spending authorization is changed. The example uses the existing root-run
metadata service identity and limits network access to localhost.

## Qualification, handover and retirement

Create immutable ownership views, native metadata adoption and complete derived
cache generations before publishing reader selectors. Require current
source-specific readiness on all chains. Run:

```sh
node --import tsx scripts/verify-shared-indexer.ts \
  --deployment /absolute/deployment.json --baseline-release REGISTERED_ID \
  --output /absolute/fresh-parity.json
```

Canonical comparison runs in a read-only repeatable snapshot and streams every
retained event at common hash-verified boundaries, including decoded arguments,
timestamps and raw log evidence. It uses native ordering indexes and paginates
within dense blocks. Topic arrays use the existing receipt verifier's strict
decoder: Ponder's trailing empty historical slots compare with their realtime
form, while changed topics or invalid/interior padding fail verification.
After hashing, it checks current readiness and the compared
headers in a fresh transaction, so a held snapshot cannot hide a reorg or a
stopped source. Use `--archived-arena-baseline` only for the registry/v2 comparison.
If the new source lacks an old quiet-block header, that mode requires the exact
`UNIFIED_RPC_PROFILE_FILE` and bounded free canonical point checks before and
after comparison. It never inserts historical headers or framework checkpoints.
Row counts alone are insufficient. Verify current collection/metadata/booster/Islands/marketplace
responses as well as existing v2 films, tasks, transactions and credits.

The optional qualification service/timer runs `qualify-shared-indexer.ts` with
the inspected main and previous shared-Arena release IDs. It waits for native
health, performs both complete comparisons and writes protected reports. Its
`qualified.json` covers **public source ingestion only**. It never switches a
reader, changes private jobs, submits a transaction or enables admissions. The
actual cutover still requires current checks, native metadata adoption, complete
derived generations and each reviewed operational source epoch. Disable the
qualification timer when transferring ownership to the canonical service.

Use `production-health.py` with a root-owned public configuration for the final
observation. Record the exact source deployment, thirteen source IDs, source
health command, preserved adapter directories, current services/timers, retired
units and representative local/public API assertions. Budget policy checks are
read-only hashes of the existing policy rows, not mutable usage counters. Reuse
the official observer's `health` command under its existing support identity;
it validates all thirteen sources without RPC calls or database writes.
The source and budget probes run as the existing support/Postgres accounts in
separate oneshots, with Unix sockets only and no capabilities. The main monitor
requests both probes before each check, then validates their successful service
result, owner, configuration hash and two-minute freshness. Probe output exposes
only public source health and policy-match booleans. It contains no raw policy
rows or credentials. The main monitor has no user-switch capabilities.
Replace obsolete monitor dependencies and artifact paths while retaining the
current product checks. Keep unrelated provider failures visible.

The minute timer retains a protected history and resets its continuous window
after a failed check, reboot, configuration change, reversed clock or a gap
greater than three minutes. Its `oneHourPassed` marker therefore requires
continuous successful evidence for the final deployment. A source-only check
or earlier qualification cannot establish full product acceptance.
The owner replaced both the four-hour period and the 90-minute checkpoint with
one continuous healthy hour. This
threshold-only change preserves genuine continuous evidence already collected;
it does not change health checks, failure resets or the retained history.
An independently observed public failure also invalidates the window. Require
one healthy hour after confirmed external recovery as well as the monitor marker.

The Marketplace foreign server uses `keep_connections=false`. Apply
`marketplace-fdw-connection-policy.sql` with the existing database owner on the
production operational cluster, including after restoring its schema. The
guarded, idempotent script preserves source mapping, owner and grants. Remote
connections stay open for the local transaction and close when it ends.
Keeping idle foreign connections previously exhausted the existing
`market_prod_source_read` limit of 32; do not increase that limit to compensate.
The connection-policy runtime correction starts a new observation window.
See [PostgreSQL connection management](https://www.postgresql.org/docs/16/postgres-fdw.html#POSTGRES-FDW-OPTIONS-CONNECTION-MANAGEMENT).

For encrypted Arena recovery, set
`YUNIPALS_SHARED_INDEXER_BACKUP_CONFIGURATION` and
`YUNIPALS_SHARED_INDEXER_BACKUP_RELEASE` together to protected canonical config
and source-artifact directories. This replaces the old candidate source/relay/
observer directory requirements. Both roots must exist and contain no symlinks;
private files remain inside the encrypted backup flow.

Include data for the final immutable read schema's `_unified_read_release`
binding as well as its DDL, physical source, control state and mutable metadata
publication pointers. A schema-only read-view backup omits that provenance row
and cannot pass consumer validation after restore. Keep an immutable binding
artifact explicitly bound to the qualified release/identity when it is captured
separately from the consistent mutable-data snapshot. Restore the exact binding
and verify its source/build before any worker starts. Refresh Marketplace's
operational backup after all five source selections have moved, and retain the
review/application journals in the encrypted recovery set.

Stop the qualification candidate before transferring its qualified schema and
artifact to `yunipals-indexer.service`. Configure
`YUNIPALS_INDEXER_LOCK_FILE=/run/yunipals-indexer/ingestion.lock`, preserve the
existing Solana directory/private settings and reset obsolete source bind mounts.
Exit 78 prevents duplicate supervisors. Transient child failures restart with
bounded backoff; process-group shutdown drains both adapters.

Gate v2 work and use `ArenaSourceSwitch` review/exact-hash application separately
for video and anime. Preserve immutable epoch history and nondecreasing
operational block/hash floors. Never edit `source_selection` directly or reset
provider tasks and signed transaction records.

Retire the old video/standalone Anime workers and extra source/observer/relay
sets, including boot dependencies and monitors. The old tournaments were personal
tests: no historical UI, settlement worker or claims interface is required. The
user handles any old contract claims directly onchain. Keep protected rollback
backups; do not submit owner transactions, claims or refunds during retirement.

Verify boot registration for the continuous Marketplace sale readers, rather
than relying on their current running state. Retain their existing continuous
configuration, chain policies, budgets and ordinary RPC dependencies. The
Marketplace services' five-start/two-minute limit must remain unchanged; space
failure retries thirty seconds apart so a cold shared source cannot exhaust that
limit before recovery. Do not weaken application startup/source checks. Prove
automatic recovery with a reboot after installing these settings.

Verify effective selectors and one Ponder process after restart, both managed
children, fresh observations, representative product reads, source advancement,
unchanged budget limits and no duplicate provider submissions. Record actual
acceptance and outstanding observation windows separately; a prepared artifact
does not establish a completed production cutover.

## Coordinated generation publication

For this transition, keep the old generation publisher stopped while preparing
its replacement. Use the routed storage environment and `projection-prepare`
worker to build an unpublished generation. Preserve the actual current/previous
generation IDs. The storage preflight must pass as the application role, and
native metadata adoption/approval must belong to the final source.

Before building the replacement read cache, drain the old cache worker and
coordinate the reader maintenance interval. The existing `migrate-read-cache.ts`
command installs the final source's invalidation guards in one transaction; this
invalidates existing cache proofs. Run it with the existing schema owner, using
only explicit public source selectors and its established database connection.
Never install guards on a guessed source or keep an old cache writer running
while it would remove the unpublished candidate's rows.

Build worker profiles `read-cache-schema`, `read-cache-prepare` and
`projection-publish` with `scripts/build-application-worker.mjs`. Then run the
prepared cache worker with `--generation ACTUAL_ID`, followed by the publication
worker with `--generation ACTUAL_ID --predecessor ACTUAL_CURRENT_ID --journal
/absolute/fresh/protected-directory`. Use the reviewed private routed environment;
the cache build timeout remains bounded by the existing maximum of 900000 ms.
The candidate cache check uses all normal freshness, identity, canonical-boundary
and invalidation proofs while requiring that the generation is unpublished.
Ordinary HTTP readers still require the current/previous publication pointer.

The publication coordinator holds the existing writer/recovery locks, prepares
wallet statistics privately in repeatable read, refreshes native approval and
retains both sets of canonical anchors. It stages wallet rows and stamps together
with the official generation compare-and-swap in one read-committed transaction.
It fsyncs the transaction intent before COMMIT and records its acknowledgement.
A journal failure before COMMIT rolls back global staging. A lost COMMIT response
stops with `projection_publication_commit_unconfirmed`: inspect the actual pointer,
transaction and protected journal before any retry. Never rerun the operation
blindly or replace its official publication function with a direct pointer write.

The publisher retains production's existing cache-preparation lease and final
publication-lock protocol from `3c3d0655`; do not replace it with only a preflight
cache check. Preparation renews a twenty-minute lease, and cache cleanup retains
leased generations. The final pointer statement rechecks cache proofs while
holding shared epoch/set row locks through COMMIT. Native observation and approval
TTLs are unchanged. `check-projection-capacity.ts --phase generation|leaderboard`
can inspect a single read-only phase; its default checks both. WAL budgeting
credits allocated segment blocks once against the same 150% peak target.

## Shared RPC failover and catalog readiness

The four dedicated shared-source RPC units load a final public environment-file
overlay setting `MARKET_RPC_PROXY_FREE_TIMEOUT_MS=2000` and
`MARKET_RPC_PROXY_FREE_ORDER_TIMEOUT_MS=2000`.

Each free-provider attempt must leave time for failover within Ponder's
ten-second request deadline. A ten-second provider attempt consumed that entire
deadline during a slow response, causing retries and BNB ingestion lag. The
two-second attempts retain the same endpoint pools, request pacing, concurrency,
byte limits, source policies, profile, budget counters and disabled paid
fallback. Ordinary application RPC units do not load this overlay.

Catalog snapshots validate the chains requested by a query. Additional chains
can qualify against the same held marketplace/source snapshots; their checks
run through the existing bounded read lanes and roll back to savepoints on
refusal. An unavailable chain cannot retire an otherwise usable snapshot.
The existing three-generation and connection limits remain unchanged.
Fresh ownership and canonical checks still apply to every requested chain,
including empty result pages. Visibility and final ownership SQL explicitly
restrict both token and transfer-history scans to the selected collections,
so postgres_fdw cannot evaluate an unrelated chain's failing boundary function.
Pagination cannot introduce a chain that was not
qualified in its snapshot. Reset the production acceptance window after
deploying either runtime correction.
