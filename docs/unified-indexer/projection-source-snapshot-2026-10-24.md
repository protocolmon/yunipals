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

The actual local PostgreSQL test covers 19 groups, including approval expiry,
complete generation publication, canonical races, a role with SELECT-only native
access, cleanup retention, and leaderboard-only completion and reorg refusal.
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
