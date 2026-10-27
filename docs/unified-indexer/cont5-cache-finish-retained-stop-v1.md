# CONT5 cache lifecycle with actual retained stop ancestry

`ops/unified-indexer-transition/ypal-ordinary-cache-finish-retained-stop-v1.py`
is a separate cache lifecycle owner. It consumes the genuine completed Reader5
operation and the genuine cache prepared ACK. It does not create a new cache
stop receipt or add its filename to the immutable Reader5 manifest `455c09d5…`.

The source manifest has 324 actual files: this owner and the 323 frozen CONT5
source files. It has no consumer mapper, consumer source core, or metadata
inverse dependency. The original Reader5 and qualification owner `fd6d00b8…`
remain unchanged. No private input, service action, SQL action, or runtime
acceptance is included in this source package.

The missing-path reproducer is
`ops/unified-indexer-transition/ypal-cont5-cache-finish-stop-ancestry.test.py`.
The original lifecycle asks for `CONT5_CACHE_BASE/stopped.json`, although the
genuine CONT5 `stopped()` returns an authenticated retained-stop envelope
pointing to the original `8be98860…` operation. The new review consumes that
actual tuple and validates the old receipt, prior aborted transaction
`16540148`, saved journal frames, original actor and config, new before and
rehearsal bindings, and the original parked boot-link inode. It binds both the
old stop SHA and the explicit retained ancestry into its own review.

The fixed paths are:

- Input: `/var/backups/yunipals-ypal-ordinary-cache-finish-retained-stop-input-v1-20261026/input.json`.
- Own journals: `/var/backups/yunipals-ypal-ordinary-cache-finish-retained-stop-v1-20261026`.
- Retained stop: `/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025/stopped.json`.
- Retained boot archive: `/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025/original-boot-link`.

The protected root-owned input must be mode `0600` and contain exactly
`format`, `readerRefs`, and `cachePreparedSha256`. Its format is
`yunipals-ypal-ordinary-cache-finish-retained-stop-v1-input`. `readerRefs`
contains exactly the actual `resultSha256`, Reader5 `producerSha256`
`c108f1c9…`, and Reader5 `manifestSha256` `455c09d5…`. The prepared SHA and
completed Reader5 result must already exist. The immutable Reader5 ACK and its
actual operation are authenticated before the factory returns. The input does
not select a stop path, boot path, source core, or future result.

`runtime(root, proof, input_sha)` constructs the separate lifecycle over the
actual Reader5 controller and proof. Every retained lifecycle function has the
same code, constants, defaults, and closure, except these declared boundaries:

- `load` authenticates this owner's own source closure and the unchanged
  Reader5 manifest separately.
- `review` captures the genuine returned stop tuple, replaces the missing-file
  hash with the validated actual old stop hash, and adds own-input, Reader5 ACK,
  and retained-stop provenance to the binding.
- `operation` runs the complete original operation validator, then requires
  the exact own input, Reader5 ACK and operation, prepared cache, and manifest.
- `drain_for_inverse` authenticates the complete original Reader5 drain body,
  retains its existing boot-archive expression, and changes only its producer
  lookup and operation-input guard. Its producer is authenticated by this
  owner's source manifest; the unchanged Reader5 manifest gains no row.

The original four boot-archive expression seams already present in Reader5
are retained. Original current/source checks, catalog scope, generation drain,
pool capacity, native actor checks, exclusive journals, start reconciliation,
four official freshness checks, three reader API/actor checks, boot restoration,
configuration reconciliation, and inverse stop/restore bodies remain active.

The CLI is inert without arguments. Explicit actions require `--input-sha` on
the fixed root host. It constructs a fresh genuine forward Caller5 Session and
reader context, holds both the original shared transition lock and generation
lock for the action, then runs the full source postflight after releasing them.
The finite action options are `--review`, `--start REVIEW_SHA`,
`--accept-review`, `--accept REVIEW_SHA`, `--reconcile-start`,
`--reload-review`, `--reload-config REVIEW_SHA`, and
`--reconcile-reload REVIEW_SHA`. Reload actions also require the original
`--reload-phase` choice. Review hashes must come from actual fresh reviews.
Unknown starts or reloads require the original reconciliation route; these
commands do not authorize replay.

`acknowledgement(result_sha, input_sha)` authenticates the actual completed own
result, operation, Reader5 ACK, prepared/before lineage, all original saved
journal frames, and original boot ancestry. It constructs no Host and invokes
no source or current callback. It returns
`immutableCacheAcknowledgementOnly: true`, the new producer and input identity,
and actual retained ancestry. All current actor, reader, writer, source, READ,
and financial authority flags are false, with zero actions. A later inverse
does not turn this immutable receipt into a current observation.

A separate mapper or effect coordinator may supply exact external
`cacheFinish` refs `{inputSha256, producerSha256, manifestSha256}`. It must
authenticate this actual fixed owner's complete source map before evaluating
it, and route cache-finish operation/start/stop/reload journals to this owner's
BASE. Reader and metadata coordinator journals remain in the genuine Reader5
BASE. Default or null refs confer no new owner authority. No input or static
dependency points back to a consumer mapper or source core.

Run the local controls with:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-ordinary-cache-finish-retained-stop-v1.test.py
python3 -I -B ops/unified-indexer-transition/ypal-cont5-cache-finish-stop-ancestry.test.py
```

The 13 owner controls use the actual composed Reader5 lifecycle and authority
`stopped()` bodies, real temporary private files and symlink inodes, and both
genuine lock/contextmanager bodies with explicitly relocated lock files.
Service-manager, process/session, SQL/HTTP, Reader5 receipt, and full-source I/O
are explicit fixtures. They cover start acknowledgement gaps without service
replay; successful acceptance and inverse drain; all four freshness, reader
health, capacity, producer/input/config/path/boot refusals; journal mutation;
and unchanged Reader5 manifest identity. These are source and local filesystem
controls, not production qualification or a complete coordinated rollback
receipt. The separate inverse caller, mapper/core, workload drain, and later
metadata and cache restoration still require their actual owned proofs.
