# Continuous Ponder profiling

The optional Node 24 preload writes bounded, per-chain JSON summaries to the
indexer's standard output every 30 seconds. It measures the real Ponder queue;
it does not enable verbose trace logging or change queue scheduling, RPC budgets,
finality policy, application configuration, or database schema.

Configure the managed launcher with an absolute path:

```dotenv
YUNIPALS_INDEXER_PONDER_PROFILER=/path/to/lib/profiling/preload.mjs
```

Only the Ponder child receives the preload. The Solana adapter is unchanged.
Before enabling it, run from the deployed Ponder application directory:

```sh
node /path/to/lib/profiling/preload.mjs --check
```

The preload requires Ponder 0.17.5 and verifies SHA-256 checksums of all three
instrumented modules before installing any hooks. It transforms modules in memory
using Node's synchronous loader hooks; installed dependencies are not modified.
An incompatible runtime fails startup explicitly. Requalify the instrumentation
and tests when upgrading Ponder. Removing the setting and restarting the managed
service disables profiling. A restart resets in-memory queues and is not a fix for
sustained indexing lag.

## Reading a summary

Filter the service journal for `event=yunipals_indexer_profile` (JSON field) and
`chainId=56` for BNB. `yunipals_indexer_profile_enabled` confirms activation.

- `queue.pendingHeads` and `peakPendingHeads`: polled heads awaiting ingestion.
  These are queue entries, including duplicate heads, not a count of missing blocks.
- `head_queue_wait`: time from poll delivery until the head leaves that queue.
- `head_processing`: time from dequeue until Ponder acknowledges or rejects it.
  This includes missing-block reconciliation and downstream backpressure.
- `head_total`: queue wait plus processing, recorded at completion.
- `fetch_block_data`, `index_block`, `finalize_block`, `reorg_block`: Ponder's
  existing stage timers, captured before log-level filtering.
- `rpc_queue.*`: time waiting for Ponder's RPC worker; `rpc_bucket_wait.*`: time
  waiting for an available Ponder provider; `rpc_attempt.*`: individual request
  time, including any upstream gateway pacing; `rpc_total.*`: whole request time
  including queueing, provider waits, retries and backoff.
- `rpc_attempt_errors.*`, `rpc_errors.*`, `rpc_retry_backoff`: retry/failure evidence.
- `latestReceivedBlockAgeMs`: age of the most recently polled block, which helps
  distinguish stale source data from a local processing backlog.
- `receivedToIndexedBlocks`: latest received head minus last indexed block; this
  is not a finalized-readiness verdict. `lastIndexUpdateAgeMs` measures time since
  an indexing log, not the indexed block's timestamp.

Durations are inclusive and may overlap across concurrent work; do not add all
stage totals together. Histograms use fixed buckets: p50/p95 fields are bucket
upper bounds, and null means the percentile exceeded the largest finite bucket.
Completion timings can span reporting windows. Process CPU is shared across all
chains and repeated in each row, so do not sum it across chains.

Labels are restricted to fixed chains, methods and stages. No request parameters,
URLs, addresses, hashes, credentials, raw logs or error messages are retained.
Output is skipped if stdout's buffer is over 64 KiB; `droppedWindows` counts skipped
rows across chains. Output failures cannot change RPC success/failure results.

## Verification

Run with Node 24:

```sh
node --test apps/yunipals-indexer/lib/profiling/runtime.test.mjs scripts/start-indexer.test.mjs
node apps/yunipals-indexer/scripts/test-unified-service.mjs
```

Tests exercise the actual pinned Ponder logger, RPC queue and realtime generator,
including duplicate heads and acknowledgement behavior, plus credential isolation,
optional preload propagation, shutdown, bounded labels and runtime-drift rejection.
