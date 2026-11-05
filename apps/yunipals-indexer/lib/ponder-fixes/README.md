# Ponder runtime fixes

An optional Node 24 preload that corrects two Ponder 0.17.5 bugs in memory, using
Node's synchronous loader hooks. Installed dependency files, the build ID, the
schema, RPC budgets and finality policy are all unchanged.

Why a preload and not `patches/ponder@0.17.5.patch`: a deployed release shares its
`node_modules` with the RPC gateways and consumers. The preload affects only the
indexer process, needs no lockfile change, and is removed by changing one setting.

## The bugs

Ponder leaves historical recovery only when a whole round finishes in under 30
seconds (`runtime/historical.ts`). Each round must also fetch every block produced
during the previous one, so a slow round keeps the shared runtime out of live mode
for every chain.

- **Log requests never merge (`sync-historical/index.js`).** The config builder
  sets unused topic filters to `null`, but the merge check only recognizes
  `undefined`. Each event sends its own `eth_getLogs`. On Base that means 72
  requests per block range where 7, one per address, are enough.
- **The rate limit can stop growing (`rpc/index.js`).** A provider admits at most
  `floor(rpsLimit)` requests per second, but growth requires every second to reach
  `0.9 * rpsLimit`. For limits such as 3.46 that is impossible (3 < 3.114), so after
  a burst of 429s the limit stays low until the next restart.

Together, these held Base at about 150 log requests per round at about 3 requests
per second. A round took 63 seconds, which is longer than the 30-second exit allows.

## Configuration

The managed launcher accepts one preload, so use the file that also loads the
profiler. It registers the profiler first, because the profiler checks the checksum
of the source it receives.

```dotenv
YUNIPALS_INDEXER_PONDER_PROFILER=/path/to/lib/ponder-fixes/preload-with-profiling.mjs
```

Before enabling it, run both checks from the deployed Ponder application directory
as the service account:

```sh
node /path/to/lib/ponder-fixes/preload.mjs --check
node /path/to/lib/profiling/preload.mjs --check
```

Startup fails explicitly if the installed files differ from the pinned checksums.
`yunipals_ponder_fixes_enabled` in the service journal confirms activation. Recheck
both fixes against upstream, and delete this preload if they are resolved, when
upgrading Ponder.

## Verification

Run with Node 24:

```sh
node --test apps/yunipals-indexer/lib/ponder-fixes/fixes.test.mjs
```

The tests run the real Ponder config builder, historical sync and RPC queue, each
with and without the preload, so the unfixed run must reproduce each bug. They cover
identical fetched and stored logs, topic-filtered events staying separate, range
splitting on dense responses, limit recovery only under sustained saturation, and
the profiler running alongside the fixes.
