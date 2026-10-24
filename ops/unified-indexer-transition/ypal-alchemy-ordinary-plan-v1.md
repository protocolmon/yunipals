# Ordinary Alchemy proposal: 1.5M source / 2M shared CUs per UTC day

This is a reviewable proposal, not an admission or permission to spend. It does
not execute SQL, issue a provider request, alter an existing permit or expiry,
change a service, or change the source program. The separate ordinary-budget
authorization and all future closure/start receipts are still required. The
current catch-up deadline remains in force until the owned handover below has
an acknowledged replacement.

`ypal-alchemy-ordinary-plan-v1.py` is the finite implementation of the proposed
financial transition. It reuses the exact frozen catch-up financial model for
the old closure and produces a held transaction packet for the existing
financial `Client`/kernel-identity/XID protocol. It is deliberately not another
generic host controller. Its CLI prints proposal-only metadata and performs no
actions. No SQL from this package is an executable authorization receipt.

## Daily limits and four-chain permits

| Existing normal policy             | Proposed ordinary policy           |
| ---------------------------------- | ---------------------------------- |
| Shared account: 1,000,000 CU/day   | Shared account: 2,000,000 CU/day   |
| `unified_source`: 25,000 CU/day    | `unified_source`: 1,500,000 CU/day |
| Foreground reserve: 200,000 CU/day | Unchanged: 200,000 CU/day          |
| Six other workload allocations     | Unchanged                          |

The other background allocations remain upper limits, not guaranteed shares.
At the full source allocation, 300,000 CUs remain under the shared background
ceiling for those workloads. Foreground remains separately reserved. Existing
priority, account-enabled, profile-enabled and coordinator checks remain in use.

All four proxy instances reserve against the same durable
`(scope='yunipals-opensea', workload='unified_source', UTC date)` row. There is no
new daily partition by chain. Each chain receives an equal lifetime permit cap
of `1,500,000 * touched UTC dates`; the shared daily allocation still prevents
the four caps from becoming four independently spendable budgets. This lets a
busy chain use the available shared source allowance. It does not guarantee
fair scheduling when total demand exceeds the allowance.

The permit expiry is exactly the existing profile expiry,
`2026-11-19T18:00:00.000Z`. It is not a renewal of the original eight-hour window.
An October 24 start touches 27 UTC dates and produces a 40,500,000-CU lifetime
ceiling on each permit, behind the single shared daily gate. The first day's
already booked catch-up CUs count against the new absolute daily ceilings. No
booking, used value, permit spend or reservation is reset or refunded. The
proposal refuses admission when the current day already exhausts one of its
shared/source/background limits. It does not silently add catch-up usage on top
of the new 2M/1.5M limits.

The finite range starts at the actual enabled deployment minimum in the pinned
manifest, because ordinary Ponder startup still fetches the configured starting
headers. The upper range is a fresh observed head plus the already-reviewed
eight-hour per-chain margin scaled to this finite profile horizon. This is a
bounded permission range, not evidence of canonicality, historical coverage or
a projected source ETA. No source manifest, callbacks, cache or native data are
rewritten. Before the existing profile expiry, a separately reviewed ordinary
profile/permit replacement will be needed; this packet does not invent automatic
renewal or authority after that date.

The daily limits are conservative **booked-CU limits**, not an invoice or exact
wall-clock-day dispatch meter. The unchanged allocator books 1,000-CU leases;
unused local lease units can cross midnight. It retains the prior 31 UTC days
of ledger rows through its existing housekeeping. This proposal changes neither
behavior. Its validation permits only that existing historical retention and
refuses decreases in retained counters.

## Exact financial delta and held transaction

The old close correctly uses an additive current-day limit to preserve ordinary
headroom after catch-up bookings. For example, a close after 100,000 newly
booked source CUs can have `daily_cu=1,100,000` globally and `125,000` for source.
Those are policy ceilings; the booked rows remain separate. The new generator
authenticates that calculation with the frozen model. It does **not** run a
preliminary UPDATE to force the old rows to 1M/25k merely to pass a constructor.

The ordinary admission packet contains exactly:

```sql
-- Four INSERTs, one for each chain (1, 56, 137, 8453).
-- IDs are deterministic hashes of the exact proposal and chain.
INSERT INTO yunipals_market.unified_rpc_replay_permit
  (permit_id, profile_id, chain_id, from_block, through_block,
   maximum_cu, enabled, expires_at, reviewed_at)
VALUES (/* exact values generated from authenticated closed state + fresh range */);

UPDATE yunipals_market.rpc_compute_budget
SET daily_cu = 2000000
WHERE scope = 'yunipals-opensea';

UPDATE yunipals_market.rpc_compute_allocation
SET daily_cu = 1500000
WHERE scope = 'yunipals-opensea' AND workload = 'unified_source';
```

The generated SQL has finite literal values; the comment above is explanatory,
not a template accepted by an executable owner. The generator binds the exact
baseline and asserts the complete expected result. It changes no other profile,
permit, allocation, ACL, column ACL, reservation function, role or counter.

Use the existing financial transaction protocol, with a distinct ordinary
private attempt directory and producer receipt, rather than repinning an old
catch-up owner to claim its old acceptance:

1. Authenticate the actual protected old prepared/close receipts, the explicit
   new ordinary approval, source-drained and four-free-route ACKs, the exact
   profile and a fresh fixed four-chain range capture. No producer pin can be
   guessed. The pure function's receipt arguments do not themselves prove the
   caller read authentic protected files.
2. Hold the existing financial operation lock and lifecycle handover lock. Run
   `held_packet_sql()` through the frozen fixed-peer `Client`. It starts
   SERIALIZABLE, takes the existing advisory lock and seven finite table locks,
   compares the full snapshot, applies the six statements, and checks the exact
   after-snapshot. Statement/lock/idle bounds remain 15s/2s/30s.
3. The returned packet leaves that same transaction open and contains its XID,
   backend PID and backend start. Verify the actual UID111/GID113, zero
   capabilities, NNP and owned-process-group `kernel_identity()` exactly as in
   the accepted financial owner. A root file must durably record producer,
   ordinary approval, exact before/after/proposal/SQL hashes, all closure proofs,
   boot, XID and kernel/backend identity **before** `Client.finish(True)`.
4. First execute the same packet with `Client.finish(False)` and prove the exact
   before state and aborted XID. Then use a fresh one-shot commit attempt. No
   `COMMIT` is present in the generated packet. Only the owning reviewed host
   action may send the sole COMMIT after durable intent and final input checks.
5. If the reply is lost, query `pg_xact_status(xid8)` and the actual full catalog
   read-only. A committed XID plus the exact intended state can produce the new
   financial ACK; an unknown/in-progress outcome cannot be resent. Intent-only
   loss must remain reconcilable without requiring a failure marker. No SQL
   retry, second set of permits or ledger reset is permitted.

The local PG test exercises the actual generated held SQL, frozen old closure,
real reservation function and actual four-instance `PostgresRpcComputeBudget`.
The fixed-host wrapper, ordinary actor handover and guard-retirement executor
are still separate review work; these tests do not claim those host effects.

## Concrete old-close → ordinary actor handover

Finish this before changing the retained consumer/source actors or their owned
private files. Old lifecycle initial/common checks still bind temporary YPAL,
legacy OG and retained RPC frames; a later consumer mutation must not strand
the original close.

1. Preserve the current source-completion ACK and all fixed source, proxy,
   private input, schema/cache/build and old financial receipts. Authenticate
   the actual current completion owner. Call its existing `close(resume=false)`
   early. It stops/drains the owned paid source, stops/drains its four paid
   proxy epochs, restores the original free definitions, starts those free
   proxies and emits paid-quiet plus financial-close ACKs. The paid-quiet leaf
   requires active restored free proxies; stopped paid proxies alone are not
   equivalent. If drain is incomplete, stop here with the acknowledged partial
   state. Do not start another source or new paid actors.
2. Obtain the new ordinary financial ACK by the held protocol above. Until this
   point all old deadline activation paths remain installed. The original
   catch-up permit expiry and deadline are never moved. The source remains
   stopped and all four proxies remain free during the financial handover.
3. Under the owned lifecycle lock, retire **all** old future activations only
   after the old close and new financial ACK exist. There are three fixed
   families: `yunipals-alchemy-catchup-{close,utc}-v1`,
   `yunipals-alchemy-catchup-{close,utc}-v2`, and
   `yunipals-alchemy-controlpid-{close,utc}-v1`, each with a `.timer` and
   `.service`. Also account for the two controlpid service completion drop-ins
   `10-source-completion-v1.conf`, and all six timer boot links.
4. Recompare actual manager jobs, timers, service PIDs and every owned
   device/inode/hash/mode/link target against the private inventory and original
   owner receipts immediately before each effect. Stop only those six exact
   timers, prove all corresponding services/jobs terminal, then move only the
   owned definitions, links and drop-ins into the new root-private retained
   directory. Fsync before/after rename; daemon-reload and prove no remaining
   loaded/boot activation can reset the new policy. Do not rely on an old
   validator rejecting the changed financial state. Foreign files/jobs refuse.
   Existing actual inventory belongs in private evidence, not this runbook.
5. After the retirement ACK, publish a new distinct public source env file
   containing only the four generated `UNIFIED_RPC_REPLAY_PERMIT_ID_{1,56,137,8453}`
   values. Keep the same compiled proxy, source program, namespace, cache, role,
   private env order, endpoints, poll/callback settings and database pool limits.
   Switch the four restored free proxy actors to new owned ordinary paid
   definitions, then start the same source with the new permit file. Reuse the
   existing bounded stop/drain/start, typed manager properties, immediate actor
   CAS and process/kernel-session checks; never claim the old source ACK now
   describes the new invocation.
6. Produce an actual new source/proxy/financial ACK, followed by a bounded
   health/CU sample. Only this successor can be consumed by later consumer
   transitions. A lost start reply is reconciled against the exact owned
   start intent and actual epoch; it is not an invitation to restart again.

A crash after the financial ACK but before guard retirement or new activation
leaves the source stopped and paid actors drained. Reconcile the actual prefix;
do not create another permit set or pretend old timer outcomes are current
ordinary acceptance. If a deadline races, inspect the exact manager job and
financial state before continuing. Budget admission never authorizes killing a
foreign actor or overriding an unknown commit.

## Routing and inverse boundaries

Keep the currently reviewed routing settings:

- Ethereum/Base/Polygon:
  `MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=true`,
  `MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=false`.
- BNB hybrid:
  `MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_PRIMARY=false`,
  `MARKET_RPC_PROXY_UNIFIED_SOURCE_PAID_LOGS=true`.

Numeric block/range requests are eligible for the paid permit path. The current
`latest`/`safe`/`finalized` header and blockHash-only log lanes remain free;
“paid primary” is not “every request uses Alchemy.” BNB retains its reviewed
free-block path and permit-bound numeric fallback. This proposal adds neither
a new generic fallback nor a paid method. Exhausted daily limits/profile expiry
can stall the paid numeric lane; they do not guarantee a free transparent
fallback or uninterrupted freshness. No observation window establishes a
future load guarantee.

Owned inverse requires stopping and draining the new ordinary source and four
paid proxy epochs, proving their budget backends terminal, and restoring the
acknowledged free definitions. Disable exactly the four new permits; retain
their rows/spent values and every global/workload booking. For the admission
day, restore the old acknowledged close ceilings plus **only the new source
bookings**, capped at the newly authorized 2M/1.5M ceilings. For later days use
the original 1M/25k plus that day's ordinary source bookings, with the same cap.
Other workloads' spending is not refunded. The pure `inverse_target()` computes
and verifies this exact result, including after permit expiry. A separately
owned, acknowledged UTC cleanup can restore exact 1M/25k after midnight; it
must not re-enable any old timer that can act on the superseded source epoch.

Retain all old files for exact definition restoration, but do not blindly arm
expired catch-up timers during rollback. Source recovery from saved checkpoints
uses a new explicit free-start receipt; no reindex, checkpoint rewind or source
identity rewrite is part of this plan. If ordinary activation cannot complete,
restore free operation under this explicit inverse rather than leave a second
scanner or an unacknowledged paid owner.

## Local checks

```sh
python3 -I -B ops/unified-indexer-transition/ypal-alchemy-ordinary-plan-v1.test.py
/root/.nvm/versions/node/v24.18.1/bin/node \
  --import ./apps/yunipals-indexer/node_modules/tsx/dist/loader.mjs \
  ops/unified-indexer-transition/ypal-alchemy-ordinary-plan-v1.postgres.test.mjs
```

The latter verifies the existing disposable local PostgreSQL container before
creating a fresh random database and cleans it up. Neither test reads a private
production receipt or contacts a provider.
