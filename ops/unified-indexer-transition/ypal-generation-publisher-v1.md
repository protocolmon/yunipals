# Native generation publication libraries

This package supplies the reviewed private leaderboard preparation and generation
publication functions for a separately owned coordinated reader cutover. It does
not run a worker, choose a generation, open a transaction, publish automatically,
or change an existing runtime. The candidate builder remains the separate v2
artifact; its installed bytes and commands remain unchanged.

The new artifact is
`2b104015af8aa0fd6f4710c07bcc73125819e663a3d2f15de8d31443e587cefe`.
Its manifest SHA256 is
`1a8174b05977bd6ef1adfd50a9f5679543c6be1325bbbf126a81cafec23c7b84`.
It contains two ESM libraries and their source maps. The 31 source/resolution
inputs preserve the accepted consumer dependency declarations and baseline RPC
sources. Exactly four application files differ from the accepted consumer:
projection refresh, projection snapshot, leaderboard refresh and the new private
leaderboard preparation helper. No token, ABI, provider policy or dependency
upgrade is included.

Build with the pinned Node 24.18.1 runtime from the repository root:

```sh
node ops/unified-indexer-transition/ypal-generation-publisher-build-v1.mjs --out /absolute/fresh/output
node ops/unified-indexer-transition/ypal-generation-publisher-build-v1.test.mjs
NODE_BINARY=/absolute/path/to/node24 python3 -B ops/unified-indexer-transition/ypal-generation-publisher-install-v1.test.py
```

The builder runs twice and compares the entire metafile and output bytes before
writing its fresh output. The tests also reconstruct the finite source tree in a
new location, compare every source map input, import both actual bundles with
network access refused, and prove outside-transaction rejection before business
queries. No dependency installation is needed.

## Installation boundary

Installation is a separate explicit root operation. Stage the six artifact files
at the installer's fixed `INCOMING` path, preserving its `dist` directory, and
stage the exact installer at the public operations path. Its default invocation
only reviews the files and resolves ESM and CommonJS external package entries
against the already acknowledged runtime inventory. It imports no application
code and performs no SQL, provider requests or service actions.

```sh
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-generation-publisher-install-v1.py
python3 /opt/yunipals-unified/operations/free-replay-20261020/ypal-generation-publisher-install-v1.py --install --expected REVIEW_BINDING_SHA256
```

Use the actual returned review binding, then retain the exclusive protected
intent and result. Installation creates one fresh content-addressed directory,
with a symlink to the accepted dependency tree. It refuses a pre-existing target
or receipt. A caller validates the actual result hash through
`installed(shared(), actual_result_sha256)` before importing the libraries. An
unknown installation prefix is inspected rather than repeated; existing
artifacts are never overwritten or removed.

## Caller-owned transaction sequence

The same `pg.PoolClient` and the same imported preparation module must remain
alive throughout the sequence. The private handle is an immutable object bound
in a module-local WeakMap to that exact client. A JSON copy or another client is
rejected.

1. Begin a writable `REPEATABLE READ` transaction. Call
   `prepareNativeLeaderboardCandidate(client, actualCandidateId)` from
   `dist/native-leaderboard-preparation.mjs`. It captures fresh guarded source
   inputs, verifies the ready unpublished candidate and computes private
   `pg_temp.next_wallet_stats` once. Commit only this preparation transaction.
   The global pointer, stamps and wallet rows remain unchanged.
2. The coordinated owner must qualify its actual candidate, metadata provenance,
   source/read admission, prepared cache guards, unchanged predecessor and
   consumer recovery boundary. This library receipt does not qualify those
   prerequisites or authorize a serving cutover.
3. Begin a writable `READ COMMITTED` transaction on the same client. Call
   `stagePreparedNativeLeaderboard(client, handle)`. It locks the official
   trait/leaderboard/chain-recovery boundaries, checks candidate and input
   canonical proofs, and compares the complete ordered private-row SHA256 before
   staging the wallet rows and leaderboard stamp. Other sessions still see the
   old committed values.
4. Persist the coordinated owner's bounded pre-COMMIT intent outside the SQL
   connection. Then call
   `publishGenerationInTransaction(client, handle.generationId,
handle.metadataReleaseId, handle.predecessor, handle.sourceSnapshot)` from
   `dist/projection-publication.mjs`. The final pointer UPDATE rechecks both
   source proofs, canonical anchors, unchanged metadata frontier, archive and
   predecessor in the same statement. It stages the traits stamp and publication
   timestamp in that transaction. Do not insert a long operation after this CAS.
5. The caller alone commits. On any failure it rolls back. It must never commit
   staged wallets without the successful final publication CAS. It then proves
   the actual committed pointer, both derived stamps and wallet digest before
   continuing its bounded reader handover. A lost COMMIT acknowledgement must be
   reconciled from those owned facts; it must not rebuild or repeat publication.

Both preparation and publication start with SAVEPOINT, which fails outside a
caller-owned transaction. Preparation and staging enforce their required
isolation levels. No TTL extension, custom freshness override, native write
permission or hidden transaction COMMIT is introduced. Post-publication recovery
still requires the separate database-local recovery capsule and coordinated
consumer/cache inverse. This package does not start the old writer or restore a
pointer by itself.

The shared source and genuine PostgreSQL tests cover private-row mutation,
canonical and metadata-frontier races, expiry, outside-transaction calls,
rollback, atomic old/new visibility and the existing legacy behavior. This
library preparation proves no current production source readiness, admission,
capacity or publication result.
