# Recurring native generation lineage, source preparation

This packet supplies a one-cycle protocol, a private append-only receipt ledger,
logical lineage validation and descendant recovery of the original capsule. It
does not install or activate a recurring worker. There is no production receipt,
rollback rehearsal, sustained cadence or 24-hour acceptance in this preparation.

The ordinary installed `leaderboard-worker` and `generation-refresh` entries must
stay unselected: they publish traits before computing the global leaderboard.
The installed `generation-prepare` entry prepares an unpublished candidate. The
separately installed publisher libraries and frozen publication protocol commit
the pointer, wallets and both derived stamps together. No app or installed
artifact in this packet is edited or rebuilt.

## Data and receipt contract

The epoch root binds the original coordinated publication, the actual capsule,
its original generation103/prior/archive binding, the registered native data
identity, first native generation G0, and the recurring producer/operation.
`capsuleSha256` is the sorted JSON value digest with a trailing newline, distinct
from the capsule's own sorted JSON hash domains. Both are checked explicitly.

Every cycle links the preceding acknowledged receipt and exact predecessor ID,
candidate snapshot, full row hash, immutable row hash, actual publication XID and
prepared wire packet. `ownedDerivedObservation` is the capsule algorithm's
aggregate observation of that publication. Reports contain hashes and counts;
capsule wallet rows remain in the database. Native/public/private/actor authority
is not inferred from an array of generations supplied by a caller.

The production ledger path is fixed:

```
/var/backups/yunipals-ypal-generation-lineage-v1-20261024/epochs/<epoch-id>/
  root.json
  cycle-0001/{intent,built,private,prepared,result}.json
  cycle-0002/{intent,built,private,prepared,result}.json
```

Epoch IDs are bounded literal names. The activation owner creates the root and
private0700 epoch directory exclusively. The ledger requires root-owned,
nonwritable ancestors and single-link0600 regular files; writes use exclusive
creation and fsync. It never overwrites an intent or result. Exact `wireJson`
envelopes preserve protocol950b's insertion-order hashes when canonical receipt
files sort object keys. Complete candidate/private/prepared/result links are
checked again when files are reopened. Unknown or incomplete prefixes block the
next cycle. This ledger alone grants no database or activation authority.

The finite epoch admits at most768 cycles and cannot extend its original scope
expiry. Each cycle requires an explicit current scope proving the singleton
generation writer, actual current source, all four canonical/readiness gates,
native metadata, reader/cache phase, private files, original capsule, retained
generation policy, capacity and completed rollback rehearsal. The scope's stable
binding and expiry must remain equal throughout the cycle. An expiry crossed
during prepared XID fsync refuses before the official final CAS/COMMIT.

`runGenerationLineageCycle` invokes exactly one caller-supervised official
unpublished preparation, then frozen950b's one-client atomic publication with
the installed2b libraries. It has no scheduler or automatic retry. An unresolved
build, private preparation, publication or receipt acknowledgement stops the
epoch. `reconcileGenerationLineageCycle` is read-only: it requires the complete
protected prepared prefix, a committed actual XID and the exact global tuple.
It returns an acknowledgement candidate, writes no receipt and never rebuilds or
republishes. An execution owner must explicitly authenticate and acknowledge that
result before another cycle can begin.

## Retention and archive progression

The exact preparation selector is103, the original prior generation if present,
and G0. Current/previous generations remain protected by official cleanup. The
installed f81 cleanup may retire eligible older intermediates and delete their
payloads, but it keeps their generation rows. The validator permits only that
state/retired_at change after the official15-minute eligibility bound; every
other row field, snapshot and parent stays bound to its durable acknowledgement.
Missing generation rows and unowned parent or validation rewrites refuse.

Each inspection also hashes the actual original103/prior/archive rows in the
capsule's exact hash domain. The protected first native/current/previous rows
must remain ready with their full acknowledged row hashes. The XIDs of this
finite epoch are checked as committed; unavailable historical transaction status
refuses qualification. There is no assumed perpetual transaction-status history.

Normal native metadata frontier advance between cycles is allowed. Each new
build captures and validates its own frontier; historical snapshots are not
relabeled current. A race during publication still uses the official fresh
dual-snapshot canonical predicate. Activating another archive suspends the epoch
and original capsule recovery. It requires a separately owned archive/capsule
transition, not an automatic selector repin.

## Descendant inverse and remaining activation work

`ypal-generation-lineage-recovery-v1.mjs` is reproducibly derived from exact
frozen b45. It has a new exported identity/signature. The original capsule
privacy, complete wallet/stamp restoration, official locks, exact derived-state
CAS, old generation checks, monotonic epoch invalidation and transaction handling
remain. It validates the entire acknowledged lineage, locks its rows and the
retained anchors, then uses the actual owned head's predecessor in the two
comparisons that formerly required103 directly. It keeps every generation row.

The caller must first stop the actual recurring writer and prove its cgroup,
known processes and positive kernel-mapped sessions terminal. Current source,
metadata, archive, role and external consumer state must be separately qualified;
any required reader/cache/feature inverses must already have their own receipts.
The recovery callback must durably acknowledge the real XID and recheck those
phase-specific predicates before COMMIT. Unknown COMMIT is inspected, never
resent. This component does not call frozen3e's original single-generation inverse
or claim that its original first-publication tuple is still current.

The original41e recurring writer must remain stopped after descendant recovery.
It does not implement the reviewed preserve-ID policy and is not a safe fallback
activation for this epoch. Source and role activation are separate authorities.

Before ordinary refresh can be selected, a new supervised activation and reader
phase must still be prepared and reviewed. It must consume actual coordinated
publication and rollback-rehearsal receipts; use a current managed source leaf;
preserve the private files, pool limits, existing25GB reserve/30GB abort and backup
exclusion policy; select only f81 preparation plus atomic2b publication; own its
boot/singleton/session lifecycle; and accept an authenticated descendant head
without weakening static reader/cache/ACL/canonical gates. The frozen reader and
cache leaves deliberately report later-generation/24-hour authority false. They
cannot be reused unchanged once a descendant is published. Actual continuous
cadence, archive stability and successful HTTP refreshes must be measured before
any 24-hour claim. This packet is not that activation owner.

## Local verification

From the repository root:

```sh
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-generation-lineage-recovery-build-v1.mjs
/root/.nvm/versions/node/v24.18.1/bin/node ops/unified-indexer-transition/ypal-generation-lineage-v1.test.mjs
```

From `apps/yunipals-indexer`, with the existing disposable local PostgreSQL16
fixture available:

```sh
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx ../../ops/unified-indexer-transition/ypal-generation-lineage-v1.postgres.test.mjs
```

The default filesystem test is self-contained and synthetic. The PG test creates
and drops a fresh synthetic database, uses the actual native DDL/read functions
and official preparation/publication code, and denies provider calls. It covers
G0→G1→G2, advancing metadata frontier, atomic visibility, legitimate intermediate
cleanup, retained103/prior/G0, missing/rewritten lineage refusal, expiry crossing
during fsync, real lost-ACK reconciliation, archive rotation, rollback on refused
capsule COMMIT and complete original capsule restoration after descendants. Its
explicit synthetic clock aging makes15-minute cleanup eligible without sleeping;
it is not a production timestamp change, capacity measurement or24-hour rehearsal.
The unchanged installed f81 cleanup body is pinned in the public test, so no
private baseline or pre-existing `/tmp` artifact is needed by the default suite.
