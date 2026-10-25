# Ordinary/V6 YPAL feature handover

This successor prepares the fresh YPAL booster API and artwork queue to read
the combined native source. It then permits a separately reviewed retirement
of the temporary YPAL scanner. Source preparation does not grant privileges,
switch traffic, start a worker or create a business transaction.

The ordinary standalone source remains the writer during this handover. Its
actual `3bf5811a…` receipt and input are mandatory. The `5a1f4629…` current
source proof receives an explicit temporary-writer callback: an exact current
FRESH actor, or a terminal actor set authenticated by this operation's real stop
intent and known PID disappearance. A restored temporary source has a new owned
inverse start receipt. Old c96/de4 receipts remain static ancestry.

The independently managed supervisor can follow scanner retirement. Its current
foundation correctly refuses a remaining temporary writer. Operational feature
CLI scope is the initial ordinary epoch or its owner's acknowledged terminal
prefix. A later managed operational inverse needs an explicit current-source
adapter; neither an initial ordinary receipt nor this feature leaf supplies
that future writer authority.

## Business gate and artifacts

The existing reviewed lifecycle makes a genuine new event a **hard retirement
gate**. Initial API and queue cutover does not require that event. Retirement
requires a public event identity strictly after the switch boundary, the same
event exactly once in both native schemas, its current canonical block hash,
fresh all-eight-table parity at or after the event, and actual API and scheduled
queue coverage. V6 adds a deliberate stricter check: the event must be
`RequestCreated` or `RequestCompleted`, and its complete event row, including
the payload, must be identical in both native schemas. Those events cover an
opening/daily-claim request or fulfillment. Configuration and administrative
events cannot qualify retirement. The frozen predecessor did not restrict event
names; V6 runs its unchanged canonical and boundary checks after this new check.
No synthetic event,
receipt timestamp refresh, signer transaction or old event relabel is allowed.

The standalone feature API on 9030 and artwork queue retain the accepted
`41fe…`/`e2b…` artifacts and installed private inputs. They consume the ten
physical native tables and a public schema selector. The separately built
`f2fa4746…` latest-complete main API belongs to the coordinated reader package;
it is not substituted into the booster API command. The immutable new reader
acknowledgement authenticates that package separately.

## New inputs and source closure

The fixed owner is `ypal-ordinary-feature-handover-v6.py`; its context is
`ypal-ordinary-feature-context-v6.py`. The new journal root is:

```text
/var/backups/yunipals-ypal-ordinary-feature-handover-v6-20261025
```

The protected input file is
`/var/backups/yunipals-ypal-ordinary-feature-input-v6-20261025/config.json`.
It contains actual nonzero SHA256 references for:

- `readAdmissionSha256`, `readPlanSha256`, `readContextInputSha256`: the actual
  V5b logical admission retaining the original READ143 ancestry.
- `cachePreparedSha256`, `cacheInputsSha256`: the separate four collector cache
  SELECTs and their real authorization, rehearsal, XID and COMMIT chain.
- `readerResultSha256`, `readerManifestSha256`: the actual new V6 publication
  and three-reader cutover acknowledgement.
- `ordinaryResultSha256`, `ordinaryInputSha256`: the actual ordinary source.

`ypal-ordinary-feature-v6-manifest.py` creates the exact public code manifest
only after the concrete reader and provider source files exist. It pins the
fixed finite dependencies, the two new feature sources, and the actual new
reader/provider bytes. It never emits a missing or guessed producer hash.
Root reviews and publishes that exact manifest before host execution.

Build this manifest only after the V6 reader/provider source graph is finalized.
It includes actual SHA256 values read from the concrete files; it does not insert
future hashes or a future runtime acknowledgement. The reviewed reader manifest
is authenticated separately by `readerManifestSha256` in the protected input.
The feature manifest depends on the reader. The reader does not hash this feature
manifest into its own closure; the explicit external leaf refs below prevent a
circular hash graph.

The concrete feature manifest is
`1df245406c7356481f918791732c9a3ec4f3bcea9b9f4535574e391a2a5d6e58`.
It pins owner `4e66f48d…`, context `743645a9…`, provider `46bd4b09…` and
reader coordinator `7601a4f9…`. The separately reviewed reader source manifest
is `870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200`.
These are source identities. They do not stand in for completed cache, reader,
feature or event acknowledgements.

The new context consumes `static_read_host`, `cache_runtime`, and immutable
`acknowledgement` on the ordinary V6 publication packages. The feature independently checks
its collector graph and eight-read delta. A current reader leaf is not invoked
recursively to authenticate the feature's own eight reads.

## Review, switch and retirement

Use the retained explicit CLI with `--manifest-sha` and `--input-sha`. Default
with no arguments is source-only. With actual references, default review is
read-only. The original `--rehearse`, `--admit`, `--switch-review`, `--switch`,
`--retirement-review`, `--retire`, `--inverse-review`, `--inverse`, `--inspect`
and `--validate` phases remain separate.

Each mutation requires its real preceding review and durable intent. The SQL
delta is exactly eight SELECTs on the feature tables for the existing collector
role. Complete table and column ACL semantics, including refusal of overlapping
pre-existing column SELECTs, are retained. The old API, queue schedule, private
inputs and dormant source schema remain available for the owned inverse.

The switch appends only the new public selector and two owned drop-ins, observes
a real new API invocation, runs one real queue pass, restores the existing
schedule, and requires local and public HTTP acceptance. An unknown effect or
existing intent is never automatically resent. Preserve private journals and
diagnose the actual prefix; an unacknowledged phase is not a success.

Retirement additionally requires the genuine event gate above. It stops the
exact temporary source, proves all captured source backend tuples drained and
all remaining native writer sessions kernel-owned, and archives the exact
temporary boot inode. It does not drop data, reset checkpoints or revoke old
source reads.

The two owned temporary-source boot moves use atomic `RENAME_NOREPLACE` in the
new namespace. A foreign destination appearing after review cannot be replaced.
The original review/intent/ACK and inverse cursor bodies otherwise remain intact.

The inverse restores that boot inode if retired, starts the original temporary
program once under its new epoch and heartbeat floor, catches it up through the
last accepted native feature cursor, restores the prior API/queue selectors and
schedule, and revokes only this operation's eight SELECTs. Repeated unknown
actions remain refused under the original protocol.

Detailed source, actor, catalog and private-path observations stay in exclusive
root-only files beneath the input directory. CLI output contains hashes and
fixed aggregate status only.

## Leaf interfaces

```python
validate_feature_leaf(result_sha, manifest_sha, input_sha)
validate_inverse_leaf(result_sha, manifest_sha, input_sha, reader_inverse_refs=None)
```

The V6 forward and inverse leaves retain their genuine business validation
bodies. A finite return seam adds `manifestSha256`, `inputSha256`, `contextSha256`
and `readerAncestry`. The latter contains only actual recorded
`readerResultSha256`, `readerManifestSha256`, `readerOperatorSha256`,
`readerOperationSha256`, `readerPublicationSha256`, `readConfig`,
`cachePreparedSha256` and `cacheInputsSha256`. The existing `operatorSha256`
continues to identify this feature owner. Only immutable
`acknowledgement(result_sha, manifest_sha)` supplies reader ancestry; it never
recurses into `validate_reader_leaf` or its feature refs.

A V6 reader/supervisor caller passes the external feature refs as exactly:

```text
resultSha256, manifestSha256, inputSha256, producerSha256, contextSha256
```

The fixed producer/context filenames are `ypal-ordinary-feature-handover-v6.py`
and `ypal-ordinary-feature-context-v6.py`. The caller authenticates both sources
and the feature manifest before importing the owner, then compares every
returned reader ancestry field against its actual published reader operation
and acknowledged cache input. V5 feature receipts cannot be relabelled into this
V6 namespace.

The forward leaf proves its own API, collector, queue schedule and retired
temporary source. It supplies no current combined writer or financial authority.
The inverse leaf proves the owned restored temporary epoch and positive kernel
session subset. With explicit actual `reader_inverse_refs` containing
`result_sha` and `manifest_sha`, it composes the new reader's completed inverse
leaf and the exact acknowledged cache-four reversal. It does not claim that the
removed four privileges remain present.

The focused tests reuse the original 25 lifecycle/filesystem/unknown-ACK
controls and execute the new namespace, reader-ACK, source callback, real PID,
private output and event-gate seams. These source tests are not production
parity, API/queue acceptance, scanner retirement or a genuine-event receipt.

## Source validation and remaining runtime gates

The source suite retains the 25 original lifecycle/filesystem/unknown-ACK
controls and adds new immutable ancestry, tamper refusal, manifest closure,
private output, actual live PID and explicit return-seam checks. The disposable
PostgreSQL matrix verifies real catalog, RLS, full table/column ACL, exact eight
SELECT admission/reversal, ownership, catalog CAS and cache-four preservation.
The additional disposable PostgreSQL event matrix executes the actual V6 event
SQL and rejects administrative names, changed payloads, duplicates, noncanonical
headers and pre-switch identities. These test suites are not a production event,
parity capture or handover receipt.

The focused source suite passes 43 controls. The retained PostgreSQL matrix
passes 11 groups and the V6 event SQL matrix passes 7 groups against the local
disposable `postgres:16.15` fixture. That fixture has no host mounts and exposes
only `127.0.0.1:56967`; each matrix removes its isolated fixture database and
roles. The retained matrix wrapper fixes Docker to the local Unix socket and
removes inherited remote context/TLS selectors.

Generation V5c, cache-four admission/COMMIT, reader publication/cutover and the
fresh feature switch must each produce their real protected acknowledgement
before this feature input can exist. Do not construct an input from a source
preparation report. After the API/queue switch, keep the temporary scanner until
a genuine post-switch business event, its same canonical identities in both
schemas, fresh full-eight parity and real API/scheduled-queue coverage qualify
the separate retirement review. Never submit a synthetic business transaction
or substitute a test event for this gate.

This source work performs no production calls, service changes, privileges,
provider requests, feature switch or retirement. Managed EVM/Solana runtime
adoption remains a separate explicit source-owner integration; these leaves
provide no new current-writer authority.
