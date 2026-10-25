# Root-owned metadata cadence and held cache qualification

This is a source-only execution recipe. It creates no input, ACK or acceptance.
Root owns every actual command and observation. The inactive artifact install
alone is insufficient: first obtain the genuine Owner3 program-epoch ACK and
current actor proof. Keep the refused Owner1/Owner2 observations, aborted cache XID16540148,
old selected282 and original cache journals/inodes intact. These refusals do
not establish a historical heartbeat cause or a successful replacement epoch.

The reviewed identities are:

- Owner3 `ypal-native-metadata-approval-epoch-v3.py`:
  `62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1`.
- Owner3 source manifest:
  `464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e`.
- CONT3 caller `ypal-ordinary-publication-continue-v3.py`:
  `a4a1269b25aaa336fc101cc51252d7d1c275ccef0be63d84e59a4df1b2a22730`.
- CONT3 reader source manifest:
  `518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d`.
- Complete public stage: `ypal-ordinary-publication-continue-v3.stage.json`,
  `cdd3d804f92a0366d24c92aa828425a2b14714570742c865bcbee3cf2d1e0cf1`.

Load code through the existing reviewed protected-file loader at those exact
hashes. The owner and caller also authenticate their finite source closures.
Use the genuine Owner3 render/review/upgrade sequence from its runbook. Owner3
excludes only `sessions.owned` and `sessions.otherPeers` from authorization
hashing after requiring a positive genuine ownership proof. It retains the
complete raw observation. Stable selected actor, private, source, catalog,
cursor, boot and program facts remain bound. Every real review still captures
fresh positive kernel ownership, and the unchanged immediate pre-stop actor
CAS captures fresh sessions; both prior and fresh owned epochs must terminate. A pre-effect refusal is not
permission to repeat an unknown effect or remove an intent.

After Owner3 actually accepts the new process, derive the following references
from its real fixed files. Here `owner` is the exact loaded Owner3 module:

```python
metadata_refs = {
    "mode": "current",
    "resultSha256": owner.sha(owner.public(owner.BASE / "result.json")),
    "inputSha256": owner.sha(owner.public(owner.INPUT)),
    "producerSha256": owner.own_sha(),
    "manifestSha256": owner.sha(owner.public(owner.MANIFEST))
}
ack = owner.acknowledgement(
    metadata_refs["resultSha256"], metadata_refs["inputSha256"]
)
actor = owner.actor_current(
    metadata_refs["resultSha256"], metadata_refs["inputSha256"]
)
assert ack["immutableAcknowledgementOnly"] is True
assert actor["currentActorQualified"] is True
```

Do not substitute source-test fixture references, the inactive install ACK, or
the historical selected PID. Preserve the actual result/input hashes and the
new PID/startTicks/invocation/boot binding in the root-private record. The
metadata actor leaf confers no READ, publication, source or financial authority.

Use the existing accepted-generation static renderer to obtain its actual
`report`; it remains immutable file-lineage evidence. The canonical cache input
must still be the actual2aaf file. It receives no additional metadata field.
The exact new caller constructor is:

```python
manifest_sha = "518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d"
session = caller.Session(report["sourceRefs"], manifest_sha, metadata_refs)
session.preflight()
session.cache_context(report["cacheInputsSha256"])
session.host.prerequisites()  # The complete genuine current metadata body.
```

This initial current proof must pass before cadence acceptance. It retains the
actual READ, native mode/probe, canonical publication comparison, zero remaining
archive rows and actor/boot bookends. The original complete publication query
still has its60-second bound. Source preflight and static Host construction are
outside the SQL child's held-transaction interval.

Observe normal unheld operation for150seconds, sampling at approximately5-second
intervals, with an explicit180-second parent bound for the sampling loop. Use
the actual `session.cache.continuation_authority.approval_snapshot(session.host)`
for each sample. It executes the unchanged official-frame SQL using the database
clock, checks the full dataset/frontier/canonical/hash/implementation/native
predicates and conservatively subtracts query time from the unchanged90-second
approval lifetime. It writes or refreshes nothing. Existing per-command query
bounds remain in force. Any query error, expired/blocked/future approval or
failed predicate refuses cadence acceptance.

Record only bounded public scalars/hashes: sample index, database capture time,
checked-at microseconds, approval age/remaining time, checked block/hash,
implementation/read identity and the predicate results. Keep any full internal
proof root-private. Require at least two distinct advances of checked-at during
the observation, with every sample accepted. Bookend with the genuine current
Owner3 actor proof and `session.finish()`. This establishes the observed normal
cadence window; it does not guarantee freshness during future RPC, pool or CPU
stalls. Do not run a separate official refresh to manufacture this observation.

Stop the sampling loop before entering the held SQL qualifier. Concurrent full
frame probes can wait on the qualifier's catalog locks and distort the
measurement. The qualifier itself executes every required genuine held check.

After cadence and complete current proof pass, the actual new baseline and
rollback-only qualification are:

```python
baseline = caller.construct_records(session, baseline_capture_id)
measured = caller.qualify_held(session, held_capture_id)
held_ref = {"captureId": measured["captureId"], "sha256": measured["sha256"]}
```

Capture IDs are fresh exclusive root-selected names. Reusing this same genuine
Session for these two phases is supported: static construction is reused, while
all original current-source, metadata, private, catalog and prepared-callback
methods rerun. The qualifier restores the original raw transport and clears its
typed rollback scope. Fresh Sessions are also valid and require the same actual
metadata references. Use bounded root stage execution; the existing900-second
cache-context policy and360-second child-parent bound are unchanged.

Inspect the actual held result and its six immutable audit-file hashes. Success
requires the entire late-approval-capture → SQL → complete prepared callback and
audit path plus5seconds to fit the approval lifetime actually remaining at
launch. The exact accepted COMMIT literal is absent from this qualification
transport; the genuine child must reject its wrong reply before COMMIT. The new
opened XID must be actually aborted, child/backend gone, full catalog restored,
and source/epoch/context unchanged. No production prepared ACK is created.
Old77-second timing and the old opened-file age cannot authorize this attempt.

Only after inspecting that successful real result may root explicitly invoke:

```python
prepared = caller.execute_cache(
    session, "commit", [], commit_attempt_id, held_ref
)
```

A same-Session call retains every original commit/current check; a new Session
with the identical refs is also valid. The actual fresh approval gate runs
again immediately before Popen, after dependency/role/column/FD checks. It must
have enough remaining lifetime for the newly measured complete path plus the
reserve. The complete callback and raw ACK deadline checks run again before the
real accepted literal. The five-second ACK tail is an observation deadline, not
proof that a post-ACK database COMMIT was canceled. Unknown outcomes require
genuine readonly XID/catalog/child reconciliation, never automatic replay.
Successful commit already returns its own prepared ACK; do not prepare it twice.

After actual prepare, use the new static CONT3 input renderer for the exact ten
reader refs and separate metadata refs. Retain the existing before-LOGIN and
after-LOGIN callback qualifications, each binding this real epoch and manifest.
A new Session after actual LOGIN is required. All existing source, budget,
capacity, snapshot, ACK and publication gates remain in force.

For the later coordinated rollback, first prove actual owned native workloads
terminal through the genuine reader inverse proof. Restore the scheduler epoch
to a new owned CF333 invocation while frameworkReady remains1 and before
reversing the two LOGINs or the cache guard. The catalog-only lifecycle callback
requires that intact cache4/LOGIN graph and confers no workload or source
authority. The lifecycle separately requires the actual qualified source prefix.
Use its restoredEpochACK for the later genuine9b metadata inverse; never replace
it with selected282. Readiness-zero and later changed catalogs require their own
qualified continuation. Completed Arena inverse and a fresh return to native
remain required parts of the full rehearsal; this recipe does not claim them.
