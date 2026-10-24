# Four-chain Alchemy catch-up financial owner

This packet prepares one financial operation under the original 20,000,000 CU allowance. It creates at most 15,000,000 additional source CU: Ethereum 1M, BNB 9M, Polygon 2M and Base 3M. It does not activate a source, proxy or provider, change credentials or roles, renew a profile, reset counters, or approve a recurring 10M daily policy. No production financial operation is claimed by this preparation. The earlier unpublished tail-only draft (owner `3e7964fc…`, model `fc89e462…`, packet `aa9cbe06…`) was superseded before any host execution, financial BASE, plan or admission existed. Its exact eight files and review are retained privately under `/tmp/yunipals-alchemy-financial-tail-draft-aa9cbe06-20261024`; its tests/review do not attest these revised bytes.

The owner retains the existing seven allocation rows, original 1M normal global envelope and 200k foreground reserve. During the window it changes only the global daily ceiling to 16M, the source allocation to that day's original source bookings plus 15M, and four new bounded permits. The historical all-day source bookings must be at least the measured 4,547,000 CU, and that conservative booked total plus 15M must fit the original 20M. Allocation maxima are not a promise that all seven workloads can simultaneously consume their maxima. Existing permits, profile/coordinator rows, roles, schema/table/function identities, full table and column ACLs and booking ledgers remain unchanged except for legitimate monotonic spending.

The window is at most eight hours, ends on the same UTC day, and expires no later than fifteen minutes before UTC or the existing profile expiry. At least one hour must remain. Four fixed deadline units must already be authenticated by the separately reviewed `ypal-alchemy-primary-current-v1.py` leaf before COMMIT. Its 900-second close bound and the fifteen-minute guard are operational bounds; the existing PostgreSQL budget does not become a new cross-day cumulative-credit primitive.

## Fixed inputs and honest range provenance

Operators use `/opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-catchup-financial-v1.sources.json`, matching the adjacent public JSON schema. It pins the actual close/deadline leaf, the actual protected raw capture bytes and capture helper, and unchanged official checkpoint decoder. The helper is authenticated as provenance only and is never executed by this owner.

The protected range directory is `/var/backups/yunipals-alchemy-catchup-range-input-v1-20261024/`, with `input.json`, `raw.json`, `capture.py` and `ponder-checkpoint.ts`. The normalized input format is `yunipals-alchemy-catchup-range-input-v1`: exact profile/release/manifest/native schema/build/source actor digest, `observedAt`, and four integer chain observations. Each chain has `nativeCommittedBlock`, `syncCoveredBlock`, `headBlock`, `headTimestamp` and `marginBlocks`. The owner recomputes every observation from the raw capture and the pinned decoder semantics. The actual compiled runtime/cache proof independently checks the same enabled configured minima before paid restart. The native point is a complete committed checkpoint. **The field named `syncCoveredBlock` is the Ponder `ponder_sync_block` fetch gauge, not proof that every source has continuous cached coverage.** Every plan records `cacheCoverageQualified:false`. The source lifecycle must independently refuse older cache holes before paid startup; widening the permit is not a recovery action.

The permit starts at the minimum `startBlock` among the exact pinned profile's enabled sources on that chain: Ethereum 12,134,519; Base 22,224,075; Polygon 21,814,218; BNB 7,579,197. These values are derived from the real manifest, never accepted as arbitrary caller input. This explicit revision supports Ponder 0.17.5's unconditional numeric earliest-source header reads without adding a proxy exception. The native-tail diagnostic still uses `max(0,min(nativeCommittedBlock,syncCoveredBlock)-512)` and its gap to the fresh head must be at most 2M blocks. Head age is at most fifteen minutes, with two seconds of clock skew. The upper permission bound is fresh head plus at most Ethereum 7,200, BNB 80,000, Polygon 30,000 or Base 30,000 blocks. CU, per-chain, duration and original total bounds are unchanged. `restartRequirements` lives in the protected plan, outside the four database permit rows: paid startup must prove the real compiled filters and continuous cached coverage through every native safe point. Older holes refuse startup; the wider diagnostic-header permission is not a claim that historical RPC work is necessary or free. A fresh capture and current source/namespace proof belong to the source lifecycle. This financial packet does not claim canonical or source readiness.

## Reviewable execution sequence

The default command only reports source preparation and performs zero SQL/provider/service actions. Root must first publish and stage the exact reviewed public files. The existing fixed SDK supplies protected file/process primitives only; no obsolete source or reader constructor is invoked.

```sh
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py"
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --qualify-peer
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --prepare --sources-sha "$SOURCES_SHA" --range-sha "$RANGE_SHA"
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --rehearse
```

`--qualify-peer` is a separate actual READ ONLY gate: fixed Unix socket/market database, UID111:GID113, no supplementary groups, zero capabilities, NNP, actual PostgreSQL identity, original budget/profile and XID-status support. It requires no future lifecycle input and must pass on the host before financial execution. It has not been run by this packet's author. The transaction client is one bounded persistent `psql` child; no password/configuration is copied. Its actual kernel process and backend identity are recorded privately.

`--prepare` exclusively creates root0700 `/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024`, canonical root0600 `plan.json`, and `prepared.json`. `planSha256` is the exact `plan.json` byte hash. The separately owned lifecycle creates its immutable operation and installed deadlines against this plan before any financial COMMIT; it must not invent an admission result in advance. The rehearsal executes the exact four INSERTs/two UPDATEs under a serializable transaction and budget advisory/table locks, verifies the complete before/after graph and unchanged counters, then ROLLBACKs.

After root reviews the actual plan/rehearsal and required authorization, the explicit admission command is:

```sh
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --commit --deadline-sha "$DEADLINE_RECEIPT_SHA"
```

The same real installed deadline receipt is checked before the transaction and immediately before its sole COMMIT. A durable root ACK intent records the actual XID, backend/process epoch, exact SQL, full before/after catalog and deadline proof before COMMIT. All immutable code/profile/range bindings are rechecked. The protected `result.json` is written only after a read-only `pg_xact_status` query proves that actual XID committed and current financial state matches. Root then creates a separate exclusive financial-admission-link for the lifecycle's pre-existing immutable operation. No operation record is rewritten.

## Current authority, closure and recovery

`acknowledgement(result_sha)` authenticates immutable plan/intent/result and their recomputed SQL/catalog delta without current DB/provider/source checks. It remains historical evidence after expiry, with current financial/source/proxy authority false. It is same-OS-boot evidence and still requires the pinned protected input/source files. `validate_current(result_sha)` additionally verifies actual live budget/permit/booking state and installed deadlines. It refuses expired windows, counter refunds, changed unrelated rows/ACLs, or any started close transaction. Only that active validator authorizes the financial portion of paid effects; the lifecycle separately owns current source/proxy epochs, cache coverage and runtime authority. Old free-only validators are not relabelled as passing.

The lifecycle must first stop its own paid actors, drain their actual kernel-attributed sessions and return its own four proxies to verified free-first. The quiet leaf supports authenticated never-paid, prepared-stopped and paid-stopped prefixes; another actor's sessions are not a reason to require a global zero. Financial close then disables only the four owned permits. Before UTC it restores global/source ceilings to original values plus actual newly booked source CU, preserving normal headroom without refunding any charge. At/after UTC it restores exact original 1M/25k values. Both phases preserve all counters and old permits.

```sh
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --close --quiet-sha "$QUIET_SHA" --financial-result-sha "$FINANCIAL_RESULT_SHA"
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --utc --quiet-sha "$QUIET_SHA" --financial-result-sha "$FINANCIAL_RESULT_SHA"
```

An unknown COMMIT is never resent. With the exact durable intent SHA, use only:

```sh
python3 -I -B "$OPS/ypal-alchemy-catchup-financial-v1.py" --reconcile "$INTENT_SHA" --reconcile-phase admit
```

The same command accepts explicit `close` or `utc` phases. It authenticates the original phase/SQL/before/after/deadline-or-quiet chain, inspects XID status and current canonical budget state, then writes an exclusive ACK only if commit is proved. Expired committed admission can be acknowledged for cleanup, never for new paid effects. NULL, aborted, in-progress, mismatched state and missing durable intents remain unresolved; there is no blind retry or automatic replacement operation. An aborted/failed attempt requires a separately reviewed explicit recovery operation. Existing ACKs are never overwritten. Both the financial lock and SQL advisory lock are finite and independent of the source-transition lock.

## Local validation

The Python suites cover pure budget/range semantics, exact immutable chain and phase validation, real private-filesystem exclusivity, persistent pipe framing/timeout, intent-before-COMMIT, lost ACK without resend, expired historical acknowledgement, close/UTC and forbidden unrelated drift. The disposable PostgreSQL16 suite uses unchanged official migrations/reservation functions and the actual compute-budget implementation. It proves ROLLBACK/committed XID classification, conservative booked charging, overspend refusal, column-ACL/allocation/old-permit drift rejection and close/UTC counter preservation. Synthetic database identity normalization is explicit; it does not qualify production peer access.

```sh
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-catchup-financial-v1.test.py
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-catchup-financial-v1.owner.test.py
cd apps/yunipals-indexer
/root/.nvm/versions/node/v24.18.1/bin/node --import tsx /root/yunipals/ops/unified-indexer-transition/ypal-alchemy-catchup-financial-v1.postgres.test.mjs
```

Actual range captures, before/after catalogs, backend/process packets, authorization and financial receipts remain host-private. No actual production receipt or permission is manufactured by the source package.
