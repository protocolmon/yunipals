# Native generation input snapshots

The native metadata approval expires after 90 seconds. A long repeatable-read
generation cannot see approval refreshes committed by another worker. Its first
query can succeed and later queries can lose the same guarded input. This affects
search, traits, revisions, facets and leaderboard generation after native adoption.

The shared indexer now captures the guarded metadata and ownership inputs in one
statement at the start of the repeatable-read transaction. Private temporary
relations hold those inputs for the build. The public approval lifetime remains
unchanged, and no native write or row-lock privileges are added.

Each candidate retains its source release, read identity, archive release, four
canonical block anchors and Base metadata frontier. A fresh publication transaction
checks those facts inside the pointer update itself. A changed frontier, reorg,
halt, stale source, identity change or replaced predecessor refuses publication.
Ordinary head advancement can proceed while the captured input remains canonical.
The pointer and matching traits stamp commit together.

Leaderboard publication checks both its own captured inputs and the already
published traits generation. The explicit `refresh-leaderboard-only.ts` command
can complete an acknowledged generation without starting another trait build.
`PROJECTION_PRESERVE_GENERATION_IDS` accepts a finite list of positive generation
IDs so a rollout can retain its exact recovery predecessors during cleanup.
Its default behavior is unchanged when no list is configured.

The explicit `prepare-native-generation.ts` entry builds and validates a ready,
unpublished candidate. It preserves the active generation, both derived stamps
and the existing wallet statistics. This separation is required because the
current legacy readers reject the native ownership identity. The existing
default refresh command still publishes; it is not the preparation command.

The actual local PostgreSQL test covers 20 groups, including approval expiry,
complete generation publication, canonical races, a role with SELECT-only native
access, cleanup retention, unpublished candidate preservation, and leaderboard-only
completion and reorg refusal.
The full indexer typecheck and an independent rerun passed. Run from
`apps/yunipals-indexer`:

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx scripts/test-projection-snapshot.mjs
```

The PostgreSQL test uses the existing disposable local instance and creates and
removes its own database and reader role. It performs no production or provider
requests. These checks do not mean a production generation has been built.
The separate runtime artifact, complete recovery capsule, actual read admission,
native metadata readiness, capacity check and owned execution remain rollout gates.
Native candidate publication, leaderboard replacement and reader selection belong
to the subsequent coordinated cutover; a prepared candidate is not an active one.

The private leaderboard preparation now supports that cutover without publishing
before its expensive computation. On one dedicated client, a repeatable-read
transaction computes session-private wallet statistics and returns an immutable
handle. A later read-committed transaction checks the complete private-row digest,
stages the wallet rows and leaderboard stamp invisibly, and applies the final
pointer update with both canonical source proofs. The caller commits the pointer,
traits stamp, leaderboard stamp and wallet rows together. A failed proof or caller
rollback leaves the previous committed tuple intact. The handle is bound to the
exact client and temporary relation; copied handles, changed rows and changed
metadata or canonical anchors refuse before publication.

The expanded genuine PostgreSQL suite covers 32 groups, including private
preparation, old/new visibility across a single commit, complete rollback,
same-count wallet mutations, independent source-anchor races and transaction
context refusal. Run it with `node --import tsx
scripts/test-native-leaderboard-preparation.mjs`. The separate
[publication library artifact](../../ops/unified-indexer-transition/ypal-generation-publisher-v1.md)
is installed inactive; this does not start a generation or perform the reader
switch.
