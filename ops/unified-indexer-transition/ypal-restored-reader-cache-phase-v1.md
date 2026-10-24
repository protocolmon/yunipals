# Reader/cache acceptance after the restored feature handover

This source-only facade supplies the explicit new feature predicate for the
frozen restored reader and cache acceptance functions. It cannot execute a
cutover, inverse, SQL change, service action or provider request. Its default
CLI is static. No actual reader, feature or cache completion is fabricated.

The fixed public entrypoint is `ypal-restored-reader-cache-phase-v1.py`. A later
managed owner must pin it under its own `readerCachePhase` manifest key. The
only operational APIs are:

```python
validate_reader_leaf(result_sha, manifest_sha, feature_refs)
validate_cache_leaf(result_sha, manifest_sha, feature_refs)
```

`manifest_sha` must be the frozen `15998fac…` reader manifest. `result_sha` is the
actual corresponding fixed reader-v2 or cache-finish-v3 completed result hash.
`feature_refs` has exactly `retirementSha256`, `manifestSha256`, and `inputSha256`,
all actual protected references for the new restored feature handover. Arbitrary
paths, unknown keys, historical e506 receipts and mixed new producers refuse.

The facade pins reader `3e133cad…`, proof `cf4b55e5…`, cache finish `f072c85e…`,
new feature `11b2a886…` and its context `3eae0ed8…`. It constructs a distinct
namespace and explicit completed-reader Context. The frozen modules and their
globals remain unchanged. The complete frozen reader acceptance function and
complete frozen cache acceptance function still execute; the cache function
calls that same new reader context.

Only the phase predicate changes. The new feature leaf must independently
qualify its exact API actor, retired temporary source and collector-only graph.
The unchanged reader role-slice helper then permits exactly the eight separately
owned native booster SELECTs, with exact object OIDs, grantee/grantor and no
extra grant option. All four owned reader/metadata role slices, dependencies,
current metadata callback, current readers/private inputs/boots, publication,
generation, current cache actor, four-collection cache freshness and complete
cache-guard checks remain. Full all-grantee column ACLs must also equal the
authenticated reader/cache SQL acknowledgement. Feature and catalog observations
are repeated around the capture.

The leaf remains deliberately narrower than a whole global catalog or writer
qualification. It does not claim active source/current-writer, source readiness,
observer, financial, all-configured-source or historical whole-validator
success. A managed caller owns those independent phase authorities and must
compare its exact current physical/logical dataset around these leaf calls.
The returned `newFeature` is authenticated scoped feature evidence; the original
reader/cache receipt producer stays identified honestly, with a separate
`phaseFacadeOperatorSha256` and `historicalFeatureOwnerAccepted: false`.

Order is material: Arena source admission precedes the fresh143 baseline and
feature catalog capture. Actual143, observer activation, initial metadata and
generation precede cache4 and the two LOGIN changes. Only actual completed
reader/cache records followed by the new feature switch/event/retirement can
qualify these post-feature leaves. No prior ACK or historical plan is rewritten.
The source-independent completed reader inverse uses its separate frozen
d5dbc helper; this forward post-feature facade does not replace inverse gates.

Local validation:

```sh
python3 -I -B ops/unified-indexer-transition/ypal-restored-reader-cache-phase-v1.test.py
```

Nine controls pass. They preserve the prior eight producer, exact-eight-edge,
column ACL, LOGIN and namespace negative controls and add executable calls to
the real reused reader and cache acceptance entrypoints. Their external SQL,
manager, HTTP and actor facts are explicit fixtures, while protected temporary
journals, receipt checks and acceptance dispatch are real. A historical loader
fails if called. This proves the composition seam locally, not host readiness
or an actual feature/admission acknowledgement.
