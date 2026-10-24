# Whole-response RPC deadline

This is a source-only successor to the exact combined transport in
`ypal-combined-source-v1/payload/rpc-preflight.ts` (SHA256 `15d2157d…`). It adds a
deadline around each actual HTTP attempt, including response-body consumption.
It does not stage files, restart a source, change a policy, modify checkpoints or
claim that the current indexing delay was caused by a stalled request.

## Confirmed failure mechanism

The accepted source dependency is viem 2.55.13, with ESM entry SHA256
`ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057`.
Its HTTP client selects a supplied request signal instead of the signal created
by its internal timeout. Its timeout aborts that internal controller; it does
not independently reject the operation. The frozen transport supplies persistent
signals to isolate source, evidence and full-block batch schedulers. Those
signals do not expire. Response-body consumption also occurs after viem's
internal fetch timeout has ended.

The local reproduction executes the exact frozen transport. With a synthetic
25ms timeout, both a headers-pending response and a body-pending response remain
pending after 90ms. A stalled Base source request retains its global one-request
slot, so the next Base request cannot dispatch. No network or database is used.

The 10,000-block policy limit has an independent working adaptation path: the
frozen proxy emits `-32005 / Max range: 10000` for a range-only refusal. Ponder
0.17.5 recognizes that hint and shrinks the interval. The deadline fix does not
change that policy or infer a new range from a generic provider failure.

## Change

`boundedRpcFetch` owns a separate controller and timer for each HTTP dispatch.
It forwards caller cancellation, races a pending fetch against cancellation,
and keeps the same deadline while the response body is read. Completion or body
cancellation clears the timer and detaches the caller listener. A response that
arrives after cancellation has its body cancelled and cannot supply a result.
Local cancellation completes without waiting for an unresponsive upstream
cleanup callback, including when viem rejects an oversized streaming body.
Timeouts use the existing viem `TimeoutError`, preserving Ponder's retry and
backoff classification.

The wrapper is installed when each existing HTTP transport is initialized, using
the same timeout precedence as viem: factory parameter, configured timeout, then
10 seconds. It does not replace the scheduler's isolation signal with a new
signal for each batch member. Source/evidence isolation and the full-block tiers
therefore retain their batch keys. The Base source FIFO still owns one active
logical call; aborting a queued caller removes only that waiter, and aborting an
active request releases its own slot through the existing `finally` path.

The deadline covers an HTTP attempt and its body. FIFO waiting and multiple
adaptive requests or Ponder retries can take longer. No ten-second bound is
claimed for a whole historical interval. Existing headers, payload bytes,
response status, byte limits, range adaptation, source manifest, permits, budget
and provider selection remain unchanged. Configuration without unified-policy
opt-in keeps its original behavior.

## Focused checks

```sh
/root/.nvm/versions/node/v24.18.1/bin/node --import /root/yunipals/apps/yunipals-indexer/node_modules/tsx/dist/loader.mjs ops/unified-indexer-transition/ypal-rpc-deadline-v1/rpc-deadline.test.mjs
```

The sixteen controls exercise the exact old failure, stalled headers and bodies,
late-response disposal, queued and active cancellation, batch isolation, timeout
precedence, completed timer cleanup, response preservation and the existing byte
cap. An AST comparison removes only the new fetch helper and HTTP initialization
wrapper, then requires equality with the frozen transport. A targeted strict
TypeScript check resolves imports as they will resolve at the actual application
overlay path; it does not claim a full repository typecheck.

The test loader maps the two source files to ESM, preserving the production
dependency's error-class identity. It maps their relative imports to the existing
application and policy source. All HTTP responses are explicit fixtures; global
fetch refuses real network calls. Detailed production observations are separate
private evidence.

## Live adoption remains a separate reviewed operation

The current source is restored to the original pool-five configuration. All
source, recovery and restoration packets remain immutable. This preparation is
not an executable restart owner and does not make any old whole validator pass.

The finite runtime delta is one read-only mount backing: stage this new file at
the corresponding versioned public operations path, then bind it to the existing
application's `lib/unified/rpc-preflight.ts`. Retain the original pool-five
`ponder.config.ts` and `booster-config.ts` bindings and all three writable cache
bindings. Do not edit the original source workspace or an accepted public file.

Before a controlled restart, a separately reviewed owner must bind the actual
restored-source receipt, current RPC acknowledgement, new file SHA and exact
overlay definition. It must perform an inactive official config/schema/handler
evaluation with this one new backing and compare all three build hashes. This
package does not assert that a newly evaluated build is identical. Actual
official policy preflight, preserved pack/API checks, positive kernel session
drain, unchanged native/cache identity, recorded safe/finalized floors and the
official lock-expiry condition remain required. No larger database pool is
needed for this change.

After the single owned restart, a new producer must acknowledge the new actor,
overlay and namespace, genuine new heartbeat and positive backend ownership.
The original restored-source validator is expected to reject the changed mount;
its receipt must not be relabelled or rewritten. Performance and current source
readiness require fresh observations after that separate adoption.

## Fetch progress and native checkpoints

Ponder's historical sync transaction stores RPC data and intervals in the shared
sync cache, then advances `ponder_sync_block`. Its local event generator emits
an indexing batch when cached blocks exist, or when its cursor reaches the
historical finalized target. A quiet gap can therefore advance fetch/cache
progress while emitting no intermediate indexing checkpoint. Block callbacks
configured from `latest` do not populate every old quiet block.

The native `_ponder_checkpoint` is written by the separate indexing transaction
after handlers and cache flush. Nonempty batches can advance it before the full
backfill finishes; this is not a universal whole-history barrier. A short sync
transaction and advancing fetch metric establish activity, not committed native
coverage or canonical acceptance. Never copy the fetch cursor into the native
checkpoint to hide that distinction.
