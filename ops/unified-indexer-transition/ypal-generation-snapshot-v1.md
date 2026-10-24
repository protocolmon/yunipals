# Native generation snapshot and recovery preparation

This is source preparation. It does not authorize publication, writer selection,
permission changes, or a production run. The installed consumer source and older
artifacts remain unchanged.

## Snapshot artifact

The reviewed application change captures the official metadata scan and the
needed logical ownership-token columns in the first data statement of the
repeatable-read build. All guarded reads in that `DO` share its statement time
and MVCC snapshot. Subsequent generation statements use private temporary
inputs. The ordinary 90-second metadata approval and source observation TTLs
remain unchanged.

The candidate validation stores four canonical anchors, registered read/source
identity, the active archive release, predecessor, and Base metadata frontier.
A fresh publication transaction updates the active pointer only when that same
statement proves the candidate binding, unchanged predecessor/archive/identity,
all four ready sources, retained canonical anchors, no checkpoint regression,
and unchanged Base metadata frontier. Ordinary head advancement is allowed.
Traits stamps and `published_at` commit in the same transaction. A later reorg
continues to be subject to the ordinary canonical public read/cache guards.

Native leaderboard completion computes private inputs under the official
trait/leaderboard locks, then uses a fresh publication transaction. It checks
both the published traits generation's anchors and its new input anchors before
replacing statistics and stamps. `refresh-leaderboard-only.ts --generation ID`
never calls the trait builder and refuses another active generation.

`PROJECTION_PRESERVE_GENERATION_IDS` is a strictly parsed list of up to eight
positive bigint IDs. The future owner must set it to the actual capsule's current
and previous generation IDs for the one-shot and ordinary worker. Cleanup skips
those rows and payloads; it never relabels historical generations.

The current v2 artifact has four entries:

- `generation-prepare.mjs`: build and validate an unpublished candidate only.
- `generation-refresh.mjs`: the ordinary full trait and leaderboard CLI.
- `leaderboard-worker.mjs`: the ordinary recurring worker.
- `leaderboard-only.mjs`: explicit completion of a known published generation.

The v2 builder pins exactly five application source changes against the accepted
consumer source manifest. Resolution metadata snapshots retain its exact
package and lock bytes. Its runtime still requires the previously acknowledged
dependency inventory; the installer independently verifies external resolution
against that inventory before creating one fresh immutable directory.

```sh
NODE=/root/.nvm/versions/node/v24.18.1/bin/node
$NODE ops/unified-indexer-transition/ypal-generation-runtime-build-v2.mjs --out /tmp/fresh-generation-artifact
$NODE ops/unified-indexer-transition/ypal-generation-runtime-build-v2.test.mjs
python3 -I -B ops/unified-indexer-transition/ypal-generation-runtime-install-v2.test.py
```

The installer test expects the exact locally built candidate at the path named in
its fixture. It uses real filesystem operations with a synthetic dependency
qualification result. It does not claim production dependency verification.

## Serving availability gate

A global active-generation pointer and global derived stamps are shared with
legacy readers. A native generation is intentionally rejected by a legacy
reader's ownership proof. Consequently, keeping old API processes running is
**not** evidence that globally publishing a native generation preserves serving.

The execution owner remains unqualified until publication is composed with the
reader/cache transition. The candidate owner runs only the build-and-validate entry, preserving the
current global pointer, generation-row identities, both stamps and all wallet
statistics. A separate explicitly reviewed coordinated switch is required. Never run the full generation
entry while legacy generation readers still depend on the global pointer. The
candidate acknowledgement is not a publication or serving acknowledgement.

## Private recovery capsule

`ypal-generation-recovery-v1.mjs` is a database component, not a standalone
operator. Its caller must prove exact writer drain, READ/source/metadata receipts,
private inputs, current consumer/guard bindings, and capacity. The caller uses one
dedicated direct database-superuser connection and the official trait,
leaderboard, and chain-recovery advisory locks.

Capture creates one private database-local schema containing the original wallet
statistics, the complete traits/leaderboard stamps, and the original active and
previous generation/archive/guard context. It cleans default-grant privileges
only on its new objects and refuses nonprivate or foreign objects. It does not
alter existing global default ACLs. Only counts, object IDs, bytes and aggregate
hashes are returned; wallet rows never leave the database.

The caller fsyncs a protected prepared receipt and acknowledges it before the
component's sole `COMMIT`. Lost acknowledgements are reconciled by reading the
exact prepared catalog and content hashes; creation and SQL are not retried.

The inverse requires the owned new pointer, unchanged old ready generations and
archive release, exact protected post-run derived hashes, and unchanged or
separately inversed consumers/cache guards. It atomically restores every old
stamp identity column, old statistics and the old pointer. It increments current
cache epochs; it does not restore old epoch numbers or delete generation rows.
The caller must keep the fresh worker terminal. Restarting the original writer
also requires the separately acknowledged metadata inverse and verified original
runtime context.

If the cache has already switched, first drain it and perform its owned catalog
inverse, leaving it inactive. Restore the generation/derived capsule next. Only
then may the cache's own finish phase restore its old activation. Main/collector
reader changes must likewise be unchanged or separately inversed. A changed
consumer state is never normalized to its historical receipt.

## Capacity and verification

The build capacity check includes private snapshot input storage in addition to
the new generation or leaderboard staging estimate. A database-local capsule
also consumes real space, which is measured before admission. The proposed
one-shot keeps the existing 25 GB reserve, aborts below 30 GB, refuses backup
overlap, and is bounded to 1470 seconds within a 1500-second static unit. These
are prerequisites; they are not claims that the present host has enough space.
No paid permit or source policy changes are part of this work.

```sh
cd apps/yunipals-indexer
/root/.nvm/versions/node/v24.18.1/bin/node node_modules/typescript/bin/tsc --noEmit
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx scripts/test-projection-snapshot.mjs
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx ../../ops/unified-indexer-transition/ypal-generation-recovery-v1-postgres.test.mjs
```

These tests create fresh synthetic local PostgreSQL databases and clean them.
The snapshot suite executes the actual registered read-view functions and full
build, TTL expiry, canonical races, exact restricted-role permissions, cleanup
retention and leaderboard-only paths. The recovery suite exercises privacy,
prepared-ACK rollback, lost-COMMIT reconciliation, foreign-change refusal, full
identity restoration and monotonic epochs. They make no provider requests or
production changes. Production receipts and observations remain private.

## Candidate execution owner

`ypal-native-generation-v1.py` has explicit drain, capsule, build,
reconcile-build, accept-candidate and original-activation recovery phases. It
has no generic publication, leaderboard replacement, or post-publication inverse
CLI. Its fixed monitor invokes only `generation-prepare.mjs` and takes no user
command arguments. An actual READ admission, installed v2 artifact and complete
owned native-metadata selection/provenance receipts are mandatory CLI inputs.
No synthetic or future receipt is accepted.

Default review captures the actual original leaderboard runtime and sole boot
link. Drain rechecks its full actor immediately after its durable stop intent,
records fresh kernel-mapped backend tuples before stop, and then proves its
process group and those sessions terminal. It keeps the original inode-owned
boot link for recovery. The original private configuration is never rewritten.

Capacity admission includes measured existing relation allocations for the
capsule, input snapshot and next generation, with 1.5x estimates and the actual
30 GB abort floor. It also checks the complete no-backup window. A failed
capacity check is a refusal before drain/build; it is not permission to lower
reserves, delete recovery data, move live database files or change paid policy.

A successful candidate receipt has format
`yunipals-ypal-native-generation-candidate-v1` at the owner's fixed protected
`candidate-result.json`. It records the real ready/unpublished generation ID,
source/read/archive/predecessor identities, exact validation hash and snapshot,
installed artifact and metadata/READ receipts, capsule SHA, and unchanged global
aggregate observation. It does not claim current source/consumer readiness.

`validate_candidate_database_current(candidateSha)` is a read-only leaf for the
cache/coordinated owners. It authenticates that immutable receipt and exact
candidate/global database observations. It intentionally does not call the old
143-edge whole validator or require the old cache PID, because the cache's own
acknowledged four additional reads and drain are separate owned changes. Its
caller must qualify those admission, source, metadata and cache facts itself.

A build start intent is never repeated. Explicit reconciliation can observe the
same owned unit/invocation/runtime intent without issuing start. A partial drain
can restore the exact original boot link and retain the same still-running old
actor without another start. Original restart after a stop requires the actual
acknowledged metadata inverse, unchanged original configuration, terminal owned
candidate worker and unchanged global legacy data. Lost original-start ACK
reconciliation performs no second start. Candidate rows remain unpublished and
are not relabelled or deleted by activation recovery.

The future critical owner may compute private candidate leaderboard rows before
its switch, stage wallet rows and the leaderboard stamp invisibly, then invoke
`publishGenerationInTransaction` with both source proofs immediately before its
single caller-owned commit. That helper refuses autocommit and requires native
READ COMMITTED publication. It leaves transaction ownership and acknowledgement
handling to the coordinated caller. The v2 candidate artifact remains immutable;
this newer publication/leaderboard seam needs its own reviewed artifact.
