# Fresh-release generation and cache candidates

This review-first preparer creates four dormant selector/drop-in files for the
fresh combined source. It does not stop a writer, install a drop-in, run a
generation or cache build, migrate a guard, change a role, or request RPC.
Existing credentials, private file order, pool limits and ordinary worker
entrypoints remain the same. Detailed production observations stay in protected
host receipts or local `/tmp` captures; they are not publication artifacts.

## Fixed dependency inventory

| Dependency | Purpose |
| --- | --- |
| `ypal-native-metadata-candidates-v1.py`, SHA `146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525` | Exact source/read-view and artifact loader; its `prepare` and staging functions are not called |
| Actual combined source owner `3a70a116…`, operation `a80ce9cc…`, result `c96d558e…` | Current owned source and preserved launch ancestry; no obsolete old-source whole validation |
| Actual read-view owner `2e8e9747…`, created receipt `17f7ee31605485e8a04793f3afb079da5d692bc920ac0e76118a95e37e5163d3` | Fresh read-view object identities and definitions |
| Existing v4 dormant candidate receipt `be0e6ec9…` | Authenticated original selector/template bytes, retained unchanged |
| Retained worker primitives `4cf40a8e…` | Strict public environment parser/Node roundtrip and original leaderboard snapshot |
| Normalization installer `08fa7d4c…`, installed receipt `14ca61da…`, artifact `cf333946…` | Existing metadata/read-view runtime ancestry; it has no generation/cache bundle |
| Accepted source `41e5b5fd…`, manifest `6e678bbd24a69202de7084b47901295effc82fa075831cf3cdf97b5e75030801` | Unchanged official generation and cache source entries |

The source boundary is physical `unified_ypal_20261023_v1`, release
`0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3`,
read schema `yunipals_ownership_4e77f52b_v4`, read identity
`0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67`.
The acknowledged owner receipts bind the actual physical/read object OIDs;
this preparer does not manufacture object identities or native checkpoints.

The preparer verifies these 13 installed boundary/entry files against the
accepted source manifest. This finite check is not a new full-runtime audit:

- `scripts/refresh-leaderboard.ts`
- `scripts/migrate-read-cache.ts`
- `lib/leaderboard/refresh.ts`
- `lib/leaderboard/worker.ts`
- `lib/metadata/projection-refresh.ts`
- `lib/metadata/read-cache-worker.ts`
- `lib/metadata/read-cache.ts`
- `lib/metadata/read-cache-schema.ts`
- `lib/metadata/chain-readiness.ts`
- `lib/metadata/read-source.ts`
- `lib/ownership/readiness.ts`
- `lib/offchain/db.ts`
- `lib/constants.ts`

The official generation path reads its ownership identity from the selected
view, builds a new generation and publishes it through its existing validation
and atomic pointer change. The official cache worker retains its advisory lock,
per-collection builds, current-generation identity and freshness checks. Neither
entry needs an executable change to read the new environment selectors.

## Exact dormant changes

`yunipals-leaderboard.selectors.env` changes five existing public values:
`DATABASE_SCHEMA`, `OWNERSHIP_READ_SCHEMA`, `READ_DATABASE_SCHEMA`,
`OWNERSHIP_RELEASE_ID`, and `UNIFIED_INDEXER_RELEASE_ID`.

`yunipals-read-cache.ownership.env` changes four existing public values:
`DATABASE_SCHEMA`, `OWNERSHIP_READ_SCHEMA`, `READ_DATABASE_SCHEMA`, and
`OWNERSHIP_RELEASE_ID`. This file did not contain
`UNIFIED_INDEXER_RELEASE_ID`; no new selector or credential is inserted.
Both files preserve archive/native/generation modes. The cache preserves its
two explicit pool limits. Neither file receives a database URL or RPC URL.

The two corresponding `.service.drop-in.candidate` files change only the one
`EnvironmentFile` reference to their new dormant selector file. The ordered
original private files, existing private database-overlay path, UID/group,
WorkingDirectory, Node/tsx arguments and official worker source remain exact.
No current definition or file under `/etc` is touched.

## Default review and optional dormant staging

After independently reviewing and staging this public source at the fixed OPS
path, root can run its default read-only review:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-generation-cache-candidates-v1.py
```

The output binds the actual source/read receipts, original candidates, current
old generation/cache writers, private input hashes, accepted source entries,
current read-view catalog, old generation identity and all legacy guard rows.
Keep that detailed output local. It is preparation ancestry, never authority to
stop whichever process happens to exist at a later handover.

After reviewing its exact hash, append `--stage <actual-review-hash>` once.
This exclusively creates the following directory and files:

```text
/var/backups/yunipals-ypal-generation-cache-candidates-v1-20261024/
  intent.json
  yunipals-leaderboard.selectors.env
  yunipals-leaderboard.service.drop-in.candidate
  yunipals-read-cache.ownership.env
  yunipals-read-cache.service.drop-in.candidate
  result.json
```

The directory is0700 and files0600. Inputs and output bytes are checked again
before success is recorded. Any existing/partial destination is refused; there
is no overwrite or implicit retry. Source and runtime programs are unchanged.
The result explicitly says no selection, generation, cache start, guard
transition, database writes, services, providers or acknowledged read admission.

Historical generation103 remains an old ready generation with null ownership
identity. The 35 old guard mappings and four epochs remain old. This preparer
refuses to label those as fresh native results. It neither regenerates them nor
copies their rows into a new identity.

The source loader retains the accepted pre-grant role graph. Once new read
admission changes that graph, a separately reviewed acknowledgement-aware
preservation successor is required; calling the old guard and claiming success
is not permitted. Dormant selector rendering does not acknowledge an ACL delta.

## Required later owners

These are identified dependencies, not actions performed by this package:

1. Obtain real fresh Base metadata adoption/current approval and provenance,
   canonical coverage, and actual required read-admission acknowledgements.
2. Drain the exact old generation writer and its restart paths under a reviewed
   inverse before any one-shot generation. Keep the original selectors available
   as rollback inputs without resuming a competing legacy writer.
3. Prepare a fresh bounded one-shot owner. The retained
   `consumer-generation-v4-readiness.mjs`, capacity monitor and example service
   hard-pin the old read identity, selector paths, unit and private runtime
   namespace. They cannot execute unchanged. Preserve their official ownership,
   metadata and capacity checks, no-backup window, disk reserve, owned backend
   cancellation and no-retry semantics in that successor; do not blindly replace
   strings in frozen executables or mutate their module globals.
4. Run the unchanged official refresh once only after fresh capacity and
   readiness pass. Require an actually new generation with the fresh release
   and read identity. Old generation103 is neither modified nor relabelled.
5. Drain the old cache writer before the separately owned guard transition.
   The old `consumer-v4-cache-guard-transition.mjs` and generation proof helpers
   hard-pin the old physical namespace/identity. A fresh owner must compile the
   unchanged official `installReadCache` with the new selectors, rehearse its
   exact actual OID/trigger/finite-grant effect in ROLLBACK, then bind its guarded
   commit and monotonic-epoch inverse. This preparer does not perform SQL,
   including a rollback rehearsal.
6. Qualify a fresh current consumer producer chain with the actual new generation,
   exact native guards and new read-view/admission history. Install cache first
   under its existing restricted role and verify a genuine current-generation
   build before other readers. The dormant templates alone do not satisfy those
   installation gates, change LOGIN, or authorize a service start.

## Focused local checks

```sh
python3 -I -B ops/unified-indexer-transition/ypal-generation-cache-candidates-v1.test.py
```

Ten synthetic controls cover exact five/four public selector changes, unchanged
pool/private-path/worker bytes, foreign selector/mode/credential/RPC refusal,
source-producer pin, generation103 and old35 guard identity, dormant role
negative attributes, read-only execution scope, exclusive real-filesystem stage
and refusal to acknowledge changed stage inputs. They use no real database,
provider, service manager or private configuration.
