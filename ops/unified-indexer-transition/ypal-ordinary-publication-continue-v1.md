# Cache continuation over the actual aborted attempt

This is a new provider, reader and caller domain over the immutable acceptance2
provider `8be98860…`, reader `973cc759…` and kernel caller `6b261303…`. It does
not relabel their failed SQL attempt, copy their ACKs, move their journals or
repeat their drain. The private ten-field cache input remains the actual
`2aafbf18…` file. The generation binding, accepted generation105 lineage, data
schema/OIDs, cache effect SQLa8a4, reader SQL05e8, peers and wire stay unchanged.

The prior authority is deliberately narrow: the original durable apply intent,
opened XID16540148, child/backend epoch, boot archive, cache stop and private
records must prove the real old transaction aborted and its actor disappeared.
No prepared, committed or final cache ACK may exist for that attempt. Catalog
inspection is performed outside held transactions. During the new held
callback, an exact positively attributed new SQL owner may replace the old
zero-session observation; the old zero-session predicate is then explicitly
reported false. Surviving unknown APP sessions refuse.

`construct_records` creates a new current post-drain baseline and executes a
genuine new rehearsal that rolls back. It links the exact retained four-READ
authorization and actual original stop. It performs no new service stop or
boot move. The old boot archive remains at the original acceptance2 path; both
cache owner and cache-finish lifecycle functions use that exact path. New
before/rehearsed/authorization records describe current observations and the
new producer rather than copied old success.

The added official-approval gate runs immediately before the actual SQL child
launch, after dependency, admitted-role, all-column and protected-FD checks.
It reads the actual database clock and existing official approval, preserving
the original 90-second expiry and all frontier, checked block/hash, release,
implementation, read identity and source readiness predicates. It does not
write or refresh an approval. A stale or insufficient remaining lifetime
refuses before launch. Root may separately perform a genuine official refresh;
the gate never infers freshness from that command's intent or wall clock.

`qualify_held` measures the complete actual gate-to-held-SQL-to-prepared-callback
path. All original prepared predicates execute. Only the qualification copy's
durable prepared observation is redirected to its audit directory, and the
parent's sole accepted `commit-authorized` constant is replaced by a wrong
literal. The child must reject it, roll back and leave an actual aborted XID,
terminal child/backend and unchanged full catalog. Qualification never creates
a production prepared ACK or sends the accepted COMMIT authorization.

The measured whole path plus five seconds must fit the approval lifetime
remaining at launch. Before the real literal ACK, the complete original
callback and durable save run again, then actual monotonic remaining lifetime
is checked. The new raw parent narrows its tail deadline to five seconds at
that boundary; a late or unknown result requires reconciliation. This is an
explicit new bound, not a claim that the old process wait bounded COMMIT. The
old standalone 77-second callback and the observed 52-second opened-file age
cannot authorize this continuation.

The source-only builder emits an actual finite reader manifest after all new
sources and the authority's source manifest are final. The caller requires that
manifest SHA explicitly. The authority is an authenticated fixed external
program in the manifest, so no source-hash cycle is introduced. Import and
default CLIs remain inert. No input, candidate, runtime receipt or future SHA is
emitted by the builder.

Root's reviewed driver loads the published acceptance2 input renderer by its
existing source SHA, obtains `report = renderer.render(actual_candidate_sha)`,
and checks the already-existing cache input against the exact report. The
renderer remains static file-lineage evidence. Load the new caller and static
reader renderer through `renderer.h.load_code` using their final reviewed
source hashes from this package's finite preparation record. Use the actual new
reader manifest SHA, not the previous6884 manifest.

```python
def cache_session():
    session = caller.Session(report["sourceRefs"], actual_new_manifest_sha)
    session.preflight()
    session.cache_context(report["cacheInputsSha256"])
    return session

# Each capture/attempt ID is a fresh root-selected exclusive journal name.
# Review each actual result before the next operation.
session = cache_session()
observed = caller.construct_records(session, baseline_capture_id)

session = cache_session()
measured = caller.qualify_held(session, held_capture_id)
held_ref = {"captureId": measured["captureId"], "sha256": measured["sha256"]}

session = cache_session()
prepared = caller.execute_cache(
    session, "commit", [], commit_attempt_id, held_ref
)
```

`commit` authenticates the exact new complete held qualification before entering
the genuine commit function, and repeats the late approval gate internally.
Its successful return already includes the production prepared ACK. Do not
call `prepare-ack` again after success. For an unknown effect, use only the
original explicit `inspect`/`reconcile-commit` paths; an actual committed result
may require one later explicit `prepare-ack` when its file is absent. Neither a
new attempt ID nor a failed prepared callback permits automatic reexecution.

After the actual new prepared file exists, the new static input renderer is:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-continue-inputs-v1.py --prepared-sha "$actual_new_prepared_sha" --manifest-sha "$actual_new_manifest_sha"
```

It authenticates the finite code closure and actual new before/committed/
prepared chain, observer, unchanged peer qualification and existing immutable
install receipts. It returns exactly ten `readerInputs`, with
`immutableFileLineageOnly:true` and `currentReadinessQualified:false`. It never
constructs a current Context, calls a live validator or writes an input.

```python
inputs = static_inputs.reader_inputs(
    actual_new_prepared_sha, actual_new_manifest_sha
)["readerInputs"]

def reader_session():
    session = caller.Session(report["sourceRefs"], actual_new_manifest_sha)
    session.preflight()
    session.reader_context(actual_new_manifest_sha, inputs)
    return session

session = reader_session()
review = caller.execute_reader(session, "review", [inputs], reader_review_id)
before = caller.qualify_reader(session, before_login_capture_id)
before_ref = {"captureId": before["captureId"], "sha256": before["sha256"]}
caller.execute_reader(
    session, "admit-readers",
    [inputs, review["reviewHash"], review["binding"]["loginAuthorizationSha256"]],
    reader_admit_id, before_ref
)

# A genuinely new Context and mode qualification follow the actual LOGIN.
session = reader_session()
publication = caller.execute_reader(
    session, "publication-review", [], publication_review_id
)
after = caller.qualify_reader(session, after_login_capture_id)
after_ref = {"captureId": after["captureId"], "sha256": after["sha256"]}
caller.execute_reader(
    session, "publish", [publication["reviewHash"]], reader_publish_id, after_ref
)
```

Reader timing still requires the complete callback plus the exact 70-second
reserve to be strictly below the 240-second idle window. Cache/nonpublication
parents remain360 seconds and publication1200 seconds. The stricter forward
cache approval budget is additional. New timing binds the actual new caller,
provider, reader, manifest, authority, SourceGuard6, query, protocol, generation
binding, complete inputs, source refs and mode. Old receipts cannot authorize
the new graph.

The added forward approval gate is explicitly inapplicable to a genuine typed
inverse context; that result claims no approval or inverse authority. Exact
reader operation/inverse intents, cache committed/prepared chain, held child
epoch, XID and kernel ownership remain required. Public inverse source/effect
dispatch remains closed until a separate actual source-prefix and inverse
callback qualification. The new feature hook names only the new continue
feature/context and its exact immutable reader ACK ancestry.

The observed periodic official-approval expiry remains an independent blocker
to stable native API availability. This package does not claim to solve cadence
or accept a restarted metadata actor under an old epoch. No live qualification,
cache COMMIT, LOGIN, publication, event or downstream acceptance is claimed by
source tests. Relevant control entry:
`python3 -I -B ops/unified-indexer-transition/ypal-ordinary-publication-continue-v1.test.py`.
