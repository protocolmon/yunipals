# Ordinary runtime consumer intake

This read-only adapter authenticates a real ordinary standalone source epoch
through the fixed3bf runtime producer. Actual result and input SHA256 values
are supplied at invocation; no future ACK or successful old source predicate
is embedded. It performs no SQL write, role/LOGIN change, service action,
consumer selection, source restart or provider request.

`observe_runtime(result_sha, input_sha, retained_current=None)` calls the full
ordinary runtime before and after current native44/cache and registered data
queries. `validate_runtime` returns only its stable binding. The exact source,
program/private/boot/mount, routing, financial ancestry and owned epoch remain
qualified by3bf. Only its precise positive-kernel pool CAS error permits at most
three full-leaf attempts; failed attempt codes are retained in observations.
Heartbeat, checkpoints, readiness and connection counts remain observations.
The fixed dataset, source binding and actual receipt refs define stable identity.
Canonical coverage is not inferred from framework readiness.

This is explicitly a standalone source. It never manufactures a
`currentManagedEpoch`. Paid mode preserves `managedHandoverAllowed=false`,
`ordinaryFinancialClosed=false` and financial authority false. A future paid
managed source owner must explicitly authenticate the actual89a financial
ownership and its own source transition; this intake does not authorize that
transition. Free mode is allowed for managed handover only when the real3bf
runtime has authenticated its disabled-financial ACK and restored free epoch.

Three separate component leaves are available:

- `query_components()` returns current finite native44/cache identity, registered
  full12-source manifest and read marker, plus the unchanged fbb historical SQL
  and query objects under `components`. Those nested old source/restore objects
  retain historical labels and confer no active writer authority. The current
  query leaf does not require the obsolete de4/70f actor to be running.
- `read_acknowledgement(read_result_sha)` uses the actual c2da recorded chain,
  without a source constructor or DB query. Its original same-boot ancestry
  requirement remains. Initial70f is recorded history, not current authority.
- `read_catalog_current(read_result_sha)` separately checks the actual full143
  catalog and all-grantee column ACLs. Its authority remains graph-only. After
  later owned cache/LOGIN/feature deltas, callers need their phase-specific graph
  proof instead of pretending this initial exact143 graph still passes.

The registered C96 release receipt and created unselected read-view receipt are
immutable data ancestry. Current SQL checks the actual registered full manifest,
all12 physical `indexer_source` definitions, read-schema OID and exact marker.
Neither that historical receipt nor a historical query helper qualifies an old
source PID. Native44/cache identity must match the actual new ordinary runtime.

The optional retained callback is passed unchanged to3bf's positive kernel
attribution contract: only an independently authenticated temporary source or
its owned terminal retirement prefix can be added. The adapter does not infer
ownership from role names, age, zero counts or a caller's arbitrary success flag.

After public review/staging, default invocation is static. Root can separately
inspect current data or actual recorded143 ancestry:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-ordinary-consumer-context-v1.py --query-components
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-ordinary-consumer-context-v1.py --read-ack ACTUAL_C2DA_RESULT_SHA
```

Only after the ordinary source has a real acknowledged result and input:

```sh
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-ordinary-consumer-context-v1.py --runtime ACTUAL_ORDINARY_RESULT_SHA ACTUAL_ORDINARY_INPUT_SHA
```

CLI output is aggregate hashes/counts/flags. Full in-process actor/query objects
remain private on host. No existing metadata, cache, generation, reader, feature
or managed owner is silently retargeted by this packet. It is an intake seam
for a later explicitly reviewed owner and its own current business/graph guards.

Six isolated controls check the genuine pinned runtime API and fbb/c2da sources,
actual protected-file loader refusal, writer/data/receipt drift, progress versus
binding identity, bounded precise retries, full registered source/read marker
checks and separate immutable/current catalog authority.

```sh
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-ordinary-consumer-context-v1.test.py
```
