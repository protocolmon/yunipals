# Protected publication input rendering

`ypal-ordinary-publication-input-render-v1.py` performs protected file reads and
prints JSON. Its import and default CLI do not inspect the host. It does not
write inputs, query a database, inspect services, construct a runtime Host,
call an installer validator, qualify a live source or authorize an effect.
`fileLineageValidated:true` means only the recorded file chain was checked;
`currentReadinessQualified:false` remains explicit.

The renderer pins the actual generation binding `a6d4f0b8…` and reader source
manifest `bbd19325…`, authenticates their finite source closure, and accepts only
the actual V2 candidate domain/producer and retained capsule/recovery semantics.
It checks the candidate's operation and input, acceptance intent and successful
worker records. The exact completed metadata input, original selection,
provenance-2 receipt, selector result and V5b READ triple remain mandatory.
The old selection-time `provenanceComplete:false` is not rewritten; the separate
completed provenance receipt supplies that evidence.

Only after the real candidate has been accepted, obtain its SHA from the
protected fixed `candidate-result.json` and run:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-input-render-v1.py --candidate-sha "$actual_candidate_sha"
```

The report contains all ten `cacheInput` fields, its canonical
`cacheInputsSha256`, the fixed private `cacheInputFile`, and `sourceRefs`
derived from the actual metadata input's `ordinaryRuntime`. The renderer emits
no candidate receipt when that file is absent or any lineage check fails.
`--cache-input-only` emits exactly the canonical cache input bytes (sorted compact
JSON and one newline). Root must first capture stdout and require exit status0,
review the report, then exclusively create the fixed private input with mode0600
under its root-owned mode0700 directory. Never redirect an unchecked command's
partial/error stdout directly into the input. Existing inputs are not replaced.

After the genuine cache `prepared.json` exists, the following additional mode
also returns a complete ten-field `readerInputs` object:

```sh
/usr/bin/python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-publication-input-render-v1.py --candidate-sha "$actual_candidate_sha" --reader-inputs
```

This mode requires the already-created cache input to have the report's exact
canonical SHA. It reads the actual bound cache prepared receipt, the fixed
retained-prefix observer receipt and the new bound peer qualification result.
It uses the actual static reader core's accepted publisher/main receipt pins,
checks those existing receipt files, and takes the witness SHA from the pinned
reader source manifest. No runtime reader Context is constructed. Missing
receipts, frozen V6 prepared/peer domains, foreign producers or old wire hashes
refuse. The full immutable/current receipt predicates still execute in the
subsequent genuine caller Context; rendering does not replace them.

The following is the exact API recipe for a root-controlled driver after source
hash verification. The `candidate_sha` parameter must be the actual accepted
candidate SHA, never a planned value. Load this renderer by its reviewed source
hash; `renderer.h.load_code` then authenticates the fixed caller source. Keep
review outputs and timing references from each actual call. The snippets are a
recipe, and are not executed by this renderer.

```python
import uuid

renderer = renderer_module.Renderer()
report = renderer.render(candidate_sha)
h = renderer.h
caller = h.load_code(
    renderer_module.OPS / "ypal-ordinary-publication-bound-v1.py",
    "667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130"
)

def fresh(label):
    return label + "-" + uuid.uuid4().hex[:12]

def timing_ref(result):
    return {"captureId": result["captureId"], "sha256": result["sha256"]}

def cache_session():
    session = caller.Session(report["sourceRefs"])
    session.preflight()
    session.cache_context(report["cacheInputsSha256"])
    return session

# These explicit caller actions create their own actual exclusive journals.
# Root reviews each result before authorizing the next effect boundary.
session = cache_session()
review = caller.execute_cache(session, "review", [], fresh("cache-review"))
rehearsed = caller.execute_cache(
    session, "rehearse", [review["reviewHash"]], fresh("cache-rehearse")
)
caller.execute_cache(
    session, "drain",
    [review["reviewHash"], rehearsed["additionalReadDeltaSha256"]],
    fresh("cache-drain")
)

# The complete cache callback is measured only after the actual owned drain.
session = cache_session()
measured = caller.qualify(session, fresh("cache-prepared"))
cache_timing = timing_ref(measured)
caller.require_timing(session, cache_timing, "cache-prepared")
caller.execute_cache(session, "commit", [], fresh("cache-commit"), cache_timing)
caller.execute_cache(session, "prepare-ack", [], fresh("cache-prepare-ack"))
```

`qualify` creates separate audit captures and redirects only the timing copy's
prepared save. It never supplies a production prepared ACK. Its completion
alone does not enforce the arithmetic bound; `require_timing` checks the exact
caller/context/binding/mode receipt and window before the effect. `commit`
repeats that timing check internally. The complete cache callback must take
strictly less than240seconds. It is not measured using an old provider or a
fabricated receipt packet with independently skipped predicates.

The reader recipe uses the actual cache/observer/install/qualification refs
that are now present. `generationBindingSha256` is a cache field and must not be
added as an eleventh reader field.

```python
report = renderer.render(candidate_sha)
inputs = renderer.reader_inputs(report)

def reader_session():
    session = caller.Session(report["sourceRefs"])
    session.preflight()
    session.reader_context(renderer_module.READER_MANIFEST_SHA, inputs)
    return session

session = reader_session()
review = caller.execute_reader(session, "review", [inputs], fresh("reader-review"))
before = timing_ref(caller.qualify(session, fresh("reader-before-login")))
caller.require_timing(session, before, "reader-before-login")
caller.execute_reader(
    session, "admit-readers",
    [inputs, review["reviewHash"], review["binding"]["loginAuthorizationSha256"]],
    fresh("reader-admit"), before
)

# A new real post-LOGIN Context/mode qualification is required for publication.
session = reader_session()
publication = caller.execute_reader(
    session, "publication-review", [], fresh("publication-review")
)
after = timing_ref(caller.qualify(session, fresh("reader-after-login")))
caller.require_timing(session, after, "reader-after-login")
caller.execute_reader(
    session, "publish", [publication["reviewHash"]], fresh("reader-publish"), after
)
```

Each complete reader callback plus the exact70second effect reserve must be
strictly below the240second SQL idle window, so each callback must be below170
seconds. The cache/nonpublication parent bound remains360seconds and the
publication parent bound1200seconds. Timings bind the actual caller/provider/
reader/helper hashes, generation binding, complete Context inputs, source refs,
direction and mode. Old V6, old wire, different input and pre-LOGIN timing
receipts cannot authorize a later boundary. Source preflight/postflight,
current source/cache/consumer/catalog/private predicates, exact held XID,
literal ACK, and original owner reconciliation remain genuine.

Unknown effects must be inspected through the existing explicit reconciliation
actions; do not repeat an effect using a new attempt ID. The reader inverse
effect route remains closed. Neither renderer mode proves a real event,
changes publication103/102, starts a worker or fabricates an acceptance/ACK.

Source controls:
`python3 -I -B ops/unified-indexer-transition/ypal-ordinary-publication-input-render-v1.test.py`.
The tests use a synthetic receipt tree, the actual pure source validators and
actual static reader core. The two expected installer receipt SHAs alone are
substituted in reader fixtures because synthetic bytes cannot hash to real
production receipts. No synthetic result is production evidence.
