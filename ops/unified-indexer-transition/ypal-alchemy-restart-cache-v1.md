# Genuine71e restart/cache gate

Native safe checkpoint and the `ponder_sync_block` fetch gauge do not prove a
normal Ponder restart will avoid older cache holes. The installed0.17.5 database
uses native `safe_checkpoint` for crash-recovery **extraction/indexing**, but its
independent sync progress starts from configured filters and computes the first
missing fragment. This gate reads that actual cache matrix. It never changes
checkpoints, copies headers, skips a hole, changes a block interval, rebuilds a
native schema or invokes a provider/application.

The fixed sibling filters JSON is produced by the actual71e config, schema and
registered indexing handlers through actual installed `buildIndexingFunctions`
and `getFragments`. It contains84 callbacks/fragments:80 log filters across12
contract deployments, plus4 interval1 callbacks whose fromBlock is dynamically
`latest`. No address factory, transaction or trace filter is present. Counts by
chain including the block callback are Ethereum6, Base66, Polygon4, BNB8. The
four latest placeholders are symbolic; synthetic headers used by offline build
resolution are never presented as canonical observations.

The same source's actual minimum starts are Ethereum12134519, Base22224075,
Polygon21814218 and BNB7579197. Actual `getLocalSyncProgress` always requests a
numeric header at that minimum and at its continuous cached point, even with a
complete cache. Compile/start also reads `latest` and a numeric finalized header.
The source handlers use event data rather than extra historical RPC calls; already
recorded nonzero same-chain safe checkpoints avoid the cross-chain recovery
fallback. The revised financial plan explicitly admits the configured minimum
header within the same profile/address/method scope and original allowance; the
old tail-only permit cannot satisfy normal startup. This gate never widens a
permit, adds a free routing exception or confers financial authority.

`validate_restart_capture(query, plan, native)` is the exact Python API for the
separate lifecycle owner. `query` must be its existing scoped, time-bounded,
READ ONLY source-database query primitive. `plan` is the actual immutable financial
plan already authenticated by that owner, and `native` is its fresh actual native
frame. Call after owned source stop/kernel/session drain and official unlock or
25-second heartbeat expiry, immediately before the once-only paid source start.
The caller revalidates source, financial and kernel/actor gates afterward and
stores this actual returned proof in its start intent. The helper cannot replace
those gates.

Before and after the one SQL capture,14 fixed installed public Ponder semantics
files are hashed against the pinned filter artifact. No runtime module is imported.
The fixed path is the actual retained source008 Ponder dependency. Existing pnpm
hardlinks are read-only inputs, not republished files: exact current bytes, root
ownership/nonwritable mode and stable inode/metadata are checked. No source/
private environment is read or modified.

`capture_sql()` returns the finite single-query proposal. It captures source DB
OID17584 on its Unix socket/port5432, actual native namespace75963410, all44
relation identities, same app/checkpoints and complete sync-cache catalog, and80
fragment rows. It performs the genuine `getIntervals` union of every exact
`adjacentIds` superset using `range_agg(unnest(blocks))`; MAX(upper) is not coverage.
Ponder stores `numrange(start,end+1,'[]')` with BOTH ends inclusive and subtracts
one from upper on read. This detail is verified with the real official
`createSyncStore.insertIntervals/getIntervals` and disposable PostgreSQL16.

Every log filter must have a continuous prefix from its actual configured start
through the native safe checkpoint's raw block, including the exact raw block
when the checkpoint is partially completed. An older gap refuses even if another
later interval or fetch gauge is higher. Actual cached diagnostic headers must
fit the owned permit rather than be silently clamped. Missing/foreign fragments,
changed native44/cache/app/cursors, wrong profile/range and fresh locked metadata
refuse. Native clock is deliberately not compared byte-for-byte; actual query
clock checks the official hardcoded25-second expired-heartbeat branch. App may
be unlocked0 or locked1 with that genuine expiry. The caller must separately prove
that its source really stopped and no other writer was adopted.

The four block filters restart at the newly observed latest head. Older callback
cache is not falsely asserted continuous: applicability before that new start is
empty. Caller canonical/current-header validation must ensure new latest is not
behind native safe. These callbacks and Base/Arena latest behavior remain exactly
as71e; the helper adds no application-depth buffer. In particular, normal Ponder
`latest` callbacks do not fill past quiet-block witness gaps after a restart. This
packet does not pretend they do, and does not modify the observer/projection point
witness contract.

Read-only host proposal, executed only by root after source review/staging:

1. Pin this helper and its exact sibling filters JSON in the lifecycle's external
   manifest. Keep the actual registered source/config/build/current-writer proof.
2. For pre-stop inspection, run `query(capture_sql())` inside the existing READ ONLY
   source peer and save the raw matrix root0700/0600. An active app is not a final
   restart acceptance. Release only counts, heights and checksums.
3. After the owned stop/drain/official timeout, take a fresh `native`, call
   `validate_restart_capture(query,plan,native)`, save the actual proof privately,
   then perform the lifecycle's final all-writer/financial/actor CAS before start.
4. Refuse an actual older hole. Do not overwrite the cache, checkpoint or financial
   plan to manufacture acceptance. A separate recovery action needs its own
   concrete review.

The standalone CLI only describes source preparation; it does not query the host.
No production capture, source readiness, canonical/provider qualification,
permission admission or paid source start is claimed by the local results.

Validation commands:

```
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-restart-cache-v1.test.py
cd apps/yunipals-indexer
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx /root/yunipals/ops/unified-indexer-transition/ypal-alchemy-restart-cache-v1.ponder.test.mjs
```

The12 Python controls cover real installed file hashes, exact matrix/identity
binding, gaps, raw partial checkpoint, permit diagnostics and graceful/crashed
unlock. A regression executes the fixed55ba source-query producer against a
capturing primitive, deriving the genuine5432/yunipals_backfill argv and refusing
the financial15438 port; it does not start psql. The7 genuine Ponder/PostgreSQL groups include200 equivalence cases against
actual `getCachedBlock`, actual startup RPCs, actual official fragment and interval
reader equality, real80-row SQL and real separated-hole/adjacent-superset controls.
Only a unique database in the fixed disposable PG16 container is created/dropped;
production identity normalization is explicit fixture-only data.

The `.prepare.mjs` tool derives the public filter artifact locally. It authenticates
the frozen cost-study builder and installed semantics bytes, uses a separate public
workspace clone with fake preflight/build headers, and preserves actual71e
config/schema/handler hashes. Its output is exclusive under `/tmp`; it never edits
the running tree or reads real database credentials. The derivation's fake headers
and original installed runtime/build checks are evidence about configuration, not an
actual host cache matrix.
