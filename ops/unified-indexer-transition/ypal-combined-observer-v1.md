# Finite combined-source chain observer

This package observes the registered combined source using the unchanged official
`observeIndexerChain` implementation. It does not run market receipt discovery,
receipt enrichment, event/log scanning, migrations, grants, consumer selection,
source/service changes, signing or paid-budget renewal.

The runner authenticates the physical source008 module closure and the admitted
combined profile. It loads the exact registered combined manifest from the DB
and compares it to that profile; it never rebuilds a manifest from environment
or relabels old checkpoints. The source tree's base transport/config modules are
intentionally retained outside the ingestor's private overlay namespace. Their
evidence transport receives the four exact new URLs/profile explicitly. All25
transitive source files are pinned before import.

A small public preload resolves only exact bare `pg` and `viem` imports whose
parent is inside the physical source008 tree. It uses the existing accepted
release's API context for `pg`8.23.0 and indexer context for `viem`2.55.13. Their
package files, separate require/import entries, parent package files and TSX
loader are hash-pinned. The API's older `viem`2.38.0 is deliberately not used:
it lacks an export required by the retained official preflight. CommonJS uses
the fixed public `createRequire` context and ESM retains Node's import conditions;
both require the exact resulting entry. Other packages, subpaths and parents
retain ordinary resolution. No retained source, dependency, permissions or
module data is changed.

The only database peer is the existing restricted support role. No database URL,
password, private source environment or owner credential is copied. A single
bounded Unix pool is used. The child requires UID969/GID963, no extra groups,
NNP, all capability sets zero and the actual launcher parent PID.

`inspect` in the JS runner performs only read-only DB snapshots: zero fetch and
zero SQL writes. `observe-once` handles selected fixed chains sequentially. Its
transport allows only `eth_chainId` and header-only `eth_getBlockByNumber` through
19221–19224 `/unified`, with exact combined profile/evidence headers and no permit,
authorization or cookie. There are at most64 RPC calls, a120-second RPC window,
2MiB per response and16MiB total. An exhausted byte budget refuses the next call
before dispatch. Well-formed finalized-tag JSON-RPC errors retain the official
algorithm's separate latest/finality handling; malformed/HTTP failures remain
terminal. No request retries or worker loop are added.

The official algorithm alone writes the existing control `chain_status` and
`chain_anchor` rows, with its revision, native-witness, branch, finality and final
head rechecks. Native tables are never written. A chain lacking a fresh locked
runtime, complete prefix or real native witness is skipped before fetch/write.
Framework readiness is reported as read, never changed or inferred. An observed
control row is not native coverage acceptance or metadata approval.

## Root launcher and prerequisites

Actual READ admission is still required. The launcher must receive the **actual**
acknowledgement SHA produced by the exact reviewed read-admission-v2 owner. It
revalidates that acknowledgement and current combined source/RPC/YPAL facts.
An arbitrary hash, missing result or stale predecessor validator is not accepted.
Keep actual role graphs, receipts, observations and full outputs private; this
public package includes source and synthetic fixtures only.

Stage the exact reviewed owner `.py`, runner `.mjs` and
`ypal-combined-observer-context-v1.mjs` under the existing protected operations
directory. Preserve the existing profile/source/dependencies and all predecessors.
The fixed peer command imports the pinned absolute public TSX loader, then the
public context preload, and disables TSX's disk cache.
Review a finite selected chain set and a unique explicit run ID:

```text
python3 ypal-combined-observer-v1.py --read-admission ACTUAL_READ_ACK_SHA --run-id EXPLICIT_RUN_ID --chains 8453
```

Default root review is read-only. It returns a review hash and the exact planned
peer command; it starts no process and writes no operation record. A deliberate
observation uses that fresh hash:

```text
python3 ypal-combined-observer-v1.py --read-admission ACTUAL_READ_ACK_SHA --run-id EXPLICIT_RUN_ID --chains 8453 --observe ACTUAL_REVIEW_HASH
```

The root launcher enforces a150-second **outer** alarm/deadline, separate from the
child transport's120-second RPC window. It first executes the actual restricted
peer in zero-effect `inspect` mode. A dependency/readability/role failure therefore
refuses before any write intent. It then rechecks the source/control binding,
creates an exclusive private run directory, fsyncs review/preflight/intent and
starts exactly one observer child. No service or schedule is installed. The
owned child has its own process group, parent-death SIGKILL and cleared capabilities.
A timeout kills only that newly owned group; it never signals the ingestor or any
other retained worker.

Outputs and terminal acknowledgement are retained privately. Success requires all
selected official observations acknowledged, exact current control revisions and
string-typed witness fields, real native canonical block proofs, fresh observation
times and unchanged current source qualification. The result explicitly makes no
native/source-readiness claim.

Each run ID permits one write attempt. A timeout, partial observation, missing
output or lost acknowledgement remains unknown/unconfirmed; the launcher never
repeats it or fabricates success from catalog state. Inspect it read-only:

```text
python3 ypal-combined-observer-v1.py --read-admission ACTUAL_READ_ACK_SHA --run-id EXPLICIT_RUN_ID --chains 8453 --inspect
```

Inspection reads the owned journal and current canonical control state, starts no
child and writes no result. Any later observation needs an explicitly new run ID,
fresh source/control review and owner action. There is no automatic continuation.
Use the same actual READ acknowledgement and source gates; never bypass pending
read authorization or native readiness.

## Offline checks

```text
python3 -I -B ops/unified-indexer-transition/ypal-combined-observer-v1.test.py
node --import ./apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs ops/unified-indexer-transition/ypal-combined-observer-v1.test.mjs
node ops/unified-indexer-transition/ypal-combined-observer-context-v1.test.mjs
```

Use the pinned existing Node24 installation. The ten root controls use synthetic
processes and records; the17 JS groups execute the actual official observer and
RPC adapter against mocked DB/HTTP. They cover inspect zero effects, valid
ready0 prefixes, missing/stale witnesses, foreign identities, reorg/revision
races, changed final heads, optional finality errors, exact endpoints/headers,
forbidden logs/receipts/contracts/signing, exhausted budgets, SQL write scope,
durable intent, lost acknowledgement, canonical confirmation and owned timeout.
The seven resolver controls also cover exact package/parent scope, require/import
conditions, package and entry drift, and real-file permission/hash rejection.
No production, real DB write or provider call is made by these tests.

Separately, an ephemeral read-only host qualification imported this exact public
preload and all25 physical official source files under the actual restricted
peer. It created no pool or database connection and dispatched no fetch/provider
request; two optional TSX local Unix IPC attempts were blocked. It changed no
production file, permission or service. Detailed actual evidence remains private.
This import qualification does not prove database admission or free endpoints.
Those still require the real zero-effect peer preflight after acknowledged READ
admission, before any explicit observer write. No observation has been executed
by this preparation, and pending read authorization is not bypassed.
