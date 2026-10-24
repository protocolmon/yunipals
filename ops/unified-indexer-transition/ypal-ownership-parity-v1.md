# Combined-source all-six parity and fixed-boundary witnesses

These are new external capture programs for the combined native release. They do
not modify an ingestor, role, schema, selector, provider policy or frozen receipt.
The protected legacy baseline is a private runtime input; it is not part of the
public source or test closure. Its unchanged SHA256 is
`69f91e57c10171dd7b8ab2424236dd22c07e913b27b0376fdc579bde0d549540`.
All six OG/Islands collections remain mandatory, including BNB. NFBs stay included
because the original normalized ownership queries have no metadata/origin filter.
No marketplace receipt work is added.

`ownership-parity-peer-v4.mjs` calls the unchanged peer-v2 capture and dataset/hash
implementation, pinned to `d1e8283b...`. It cannot select a subset. Its one added
preflight runs after the original query caps in the **same** repeatable-read,
read-only snapshot, before any dataset cursor. It checks the new physical/read
schema OIDs, registered release, build, manifest, read marker and complete native
checkpoints for all six comparisons. A partial checkpoint uses the original
complete-block adapter; the raw event tail is never accepted as completed work.

The actual comparison heights are unchanged:

| Chain    |              Fixed height |
| -------- | ------------------------: |
| Ethereum |                26,236,452 |
| BNB      |               128,816,538 |
| Polygon  |                95,883,932 |
| Base     | 52,870,956 and 52,870,977 |

The actual production preflight on 24 October confirms BNB checkpoint
126,174,632 is **2,641,906 blocks short**. The other five collection boundaries
are covered. This observation is neither full parity nor current source/canonical
acceptance. Use a fresh preflight before capture; do not omit BNB, truncate the
baseline or run a full dataset scan when any fixed boundary is incomplete.

## Fixed proof context

The new data source is release
`0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3`,
build `71e2a7f3b7`, physical schema `unified_ypal_20261023_v1` and read identity
`0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67`.
The old `008028af...` source directory and its acknowledged runtime inventory are
used only as immutable generic PostgreSQL/Ponder helper dependencies. They are
not an accepted old data source or an old readiness receipt. The wrapper reads
only the new physical namespace; the witness checks its registered manifest and
new read marker explicitly. No old whole-runtime validator is reported passed.

Create a protected plan from `ownership-parity-peer-v4.plan.json.example` and a
fresh root-owned private output directory. Stage both new capture programs and
the exact peer-v2 dependency together at the public operations path. Plans and
reports stay on-host; transfer only their hashes and aggregate summaries. Existing
files are never overwritten.

The three exact runtime modules and the protected parity plan have been staged.
Actual static review passed without database connections or provider requests;
the separate read-only coverage preflight passed its identity checks and reported
the incomplete BNB boundary above. The private output directory is empty apart
from the review/preflight records. No full parity report or canonical witness
has been captured, and no consumer, permission or service selection changed.

Use the pinned Node 24.18.1 runtime with a clean environment, no credentials,
no `PGPASSWORD`/service selector, and an absent `PGPASSFILE` sentinel. Default
review verifies the complete unchanged source/runtime inventory, baseline and
combined public RPC profile without database or provider calls:

```sh
node ownership-parity-peer-v4.mjs --plan ACTUAL_PROTECTED_PARITY_PLAN
node ownership-parity-peer-v4.mjs --plan ACTUAL_PROTECTED_PARITY_PLAN --preflight ACTUAL_REVIEW_SHA
node ownership-parity-peer-v4.mjs --plan ACTUAL_PROTECTED_PARITY_PLAN --apply ACTUAL_REVIEW_SHA
```

Only the last two commands open a Unix peer-authenticated PostgreSQL connection.
They require root on the exact host and drop supplementary groups/GID/UID before
creating the client. The root process opens an exclusive `0600` report descriptor
before dropping privileges; the report remains root-owned. The capture retains
the original 90-second statement limit, 2-second lock limit, 30-second idle
transaction limit, 8MB work memory, 512MB temporary file cap and 2,048-row cursor
pages. A 900-second between-query wall check refuses overdue captures; a running
statement remains bounded by its original statement timeout. No readiness wait,
provider call or retry occurs in parity capture.

The capture writes format `yunipals-ypal-ownership-parity-v1`; the unchanged full
peer-v2 report is nested under `parity`. It reports data equality separately from
`allBoundaryHashesMatch`. The original exit code 3 remains expected when data
matches but the legacy baseline has unrecorded historical hashes. Four legacy
Ponder hashes remain absent; they must not be fabricated or filled from today's
canonical headers. Exit 2 indicates a real dataset difference. Failure leaves
no success receipt; any reserved output file is inspected rather than reused.

## Separate canonical witness phase

`fixed-boundary-witness-v3.mjs` preserves the previous canonical capture and
qualification functions byte-for-byte. Its changes are the explicit combined
release/build/manifest/profile, ports, new read marker and new receipt envelope.
The source and runtime byte verification, five fixed points, finality/freshness,
branch repeat, response-ID checks, immutable baseline and dataset equality gates
remain intact.

Use a new protected witness plan. Set `candidateReportFile` to the actual new
parity report and `candidateReportSha256` to its exact bytes. The example keeps
both null deliberately; without the report, witness capture can only produce
unqualified diagnostic evidence.

```sh
node --import EXACT_ACCEPTED_TSX_LOADER fixed-boundary-witness-v3.mjs --plan ACTUAL_PROTECTED_WITNESS_PLAN
node --import EXACT_ACCEPTED_TSX_LOADER fixed-boundary-witness-v3.mjs --plan ACTUAL_PROTECTED_WITNESS_PLAN --apply ACTUAL_REVIEW_SHA
```

Default is static review. Explicit witness capture uses exactly 21 free-only RPC
calls in 12 HTTP requests, with no permit headers or retries. Those HTTP requests
are four `/unified/preflight` GETs and eight `/unified` POST batches on ports
19221–19224. It never contacts MAIN, collector, cache or generation HTTP routes.
There is no dependency on generation publication or reader cutover. Database
source readiness and current canonical/finalized headers remain separate from
matching dataset digests. This tool performs no provider calls unless the
explicit witness apply phase is invoked by the operator.

## Coordinator receipt contract

The intended protected paths in the plan examples are:

- `/var/backups/yunipals-ypal-ownership-parity-v1-20261024/parity.json`
- `/var/backups/yunipals-ypal-fixed-boundary-witness-v3-20261024/result.json`

No actual capture or SHA is supplied by this preparation. The coordinator must
pin the actual files and both exact producer source hashes. The pure exports are
`validateParityReceipt(receipt, baselineBytes)` and
`validateWitnessReceipt(witnessReceipt, parityBytes, baselineBytes)`. The first
recomputes all six complete dataset/count/hash/bucket equalities against the
original baseline; it qualifies neither current readiness nor canonical history.
The second recomputes the unchanged full canonical acceptance and binds the exact
parity bytes, source/read context and capture protocol. It reports qualification
**at capture**, with `currentReadinessQualified:false`. Fresh source, canonical,
metadata and publication predicates remain the coordinator's responsibility.
Neither equality nor a stale witness authorizes publication by itself.

## Validation

```sh
node --test ops/unified-indexer-transition/ownership-parity-peer-v4.test.mjs ops/unified-indexer-transition/fixed-boundary-witness-v3.test.mjs
node ops/unified-indexer-transition/ownership-parity-peer-v4-postgres.test.mjs
```

With `YPAL_PARITY_PRIVATE_BASELINE` unset, the public suite passes nine controls
and explicitly skips five private opt-in controls. Its synthetic all-six baseline
contains only empty fixture digests and has a different hash from the protected
baseline. Public controls cover source/read identities, BNB and partial-checkpoint
coverage, the unchanged all-six query tool, synthetic-input refusal by the strict
production receipt gate, and the unchanged canonical protocol. No public test
loads an untracked production baseline or downloads production data.

An operator who already holds the protected baseline may explicitly run the five
additional strict capture/composition controls locally:

```sh
YPAL_PARITY_PRIVATE_BASELINE=ACTUAL_PROTECTED_BASELINE node --test ops/unified-indexer-transition/ownership-parity-peer-v4.test.mjs ops/unified-indexer-transition/fixed-boundary-witness-v3.test.mjs
```

The supplied file must hash to the exact unchanged `69f91e57...` baseline or the
suite fails. This option supplies test data only; it does not replace, inject or
relax either production program's baseline validator. The local explicit opt-in
run passed all fourteen controls. Its in-memory receipt fixtures and protected
baseline bytes are never included in the public package.

The separate genuine local PG16 test is self-contained: it creates and cleans its
own database and runs the pinned original all-six transfer/burn/remint fixture
through the frozen peer-v2 functions. It does not need the protected baseline,
claim production parity or exercise the production-only OIDs in the added
identity preflight. All captures and canonical HTTP responses in the pure tests
are synthetic; no production database or provider requests were performed.
