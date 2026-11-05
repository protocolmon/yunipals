# Continuous profiling rollout — 2026-11-05

The production shared indexer on `yunipals-main` now supports the optional
`YUNIPALS_INDEXER_PONDER_PROFILER` preload. Implementation and metric definitions
are in `apps/yunipals-indexer/lib/profiling/README.md`.

## Why this was added

BNB sales remain `syncing` until the consumer completes its page, source readiness
is true, and the completed block equals the source's finalized anchor. A decreasing
lag alone does not clear that status (`sharedBnbReplay.ts`). The source readiness
check requires coverage through the observed finalized boundary.

Production logs before rollout showed BNB falling from approximately two seconds
behind at 06:59:58 UTC to 432 seconds behind at 08:39:59 UTC. During the slowdown,
processing averaged roughly 2.0–2.1 blocks/second while BNB produced about 2.22.
Later processing exceeded arrival rate and lag declined. This establishes a
throughput deficit, but those logs did not separate queue wait from RPC and
processing time. The preload provides those missing measurements continuously.

## Deployed files

- Release directory: `/opt/yunipals-unified/profiling-20261105-v1`.
- Indexer override: `/etc/systemd/system/yunipals-indexer.service.d/90-profiling.conf`.
- Original supervisor: `/opt/yunipals-unified/shared-supervisor-20261103`.
- Original configuration: `/etc/yunipals-unified/shared-20261102-v2/indexer.service.env`.
- Profiler rollback: `/opt/yunipals-unified/profiling-20261105-v1/rollback.sh`.

The deployed supervisor was staged from the existing production files, adding only
the optional preload setting and Ponder import argument. This preserves production's
additional ingestion lock, which is absent from the repository's original launcher.
Both versions were tested. The deployed launch configuration was compared with the
original after parsing; only the profiler setting differs.

The new configuration is owned by `root:yunipals_unified_shadow`, mode `0640`.
Preflight must run as `yunipals_unified_shadow`, not only as root. An initial attempt
used root-only permissions and was rolled back before correcting permissions.

The Ponder application, dependencies, schema `unified_shared_20261102_v2`, and build
ID `157acd243f` are retained. No RPC budget or finality policy was relaxed.

## Startup dependency recovered during rollout

Restart exposed an independent Base startup failure: the primary PublicNode
endpoint rejected `eth_getBlockByNumber("0x0", false)` with HTTP 403 / RPC -32602,
while the Tenderly fallback returned HTTP 429 / RPC -32005. This prevented the
shared runtime from finishing startup, including BNB.

The already configured free Blast provider returned chain ID `0x2105` and genesis
hash `0xf712aa9241cc24369b143cf6dce85f0902a9731e70d66818a3a5845b296c73dd`,
matching Base's official endpoint. Blast was added to Base's source failover pool:

- Public override: `/opt/yunipals-unified/profiling-20261105-v1/base-startup-fallback.public.env`.
- Gateway override: `/etc/systemd/system/yunipals-shared-rpc@base.service.d/90-startup-fallback.conf`.

The Base gateway was restarted. Its genesis query then succeeded; paid fallback
remained disabled and paid calls remained zero. This dependency failure was
observed at restart and does not establish the cause of the earlier BNB slowdown.

Profiler rollback leaves this working Base fallback in place. To separately revert
the fallback, remove only its named systemd override, reload systemd, and restart
`yunipals-shared-rpc@base.service`. Doing so can reintroduce the startup failure.

## Validation

Twelve tests passed covering the real Ponder realtime generator, logger and RPC
queue; duplicate-head acknowledgements; bounded, sanitized summaries; exact RPC
return/error preservation; runtime-file checks; launcher credential isolation;
preload propagation only to Ponder; and shutdown/fatal-child behavior. The existing
unified-service supervision checks also passed. The production supervisor variant
passed its six launch tests separately. All three deployed Ponder module checksums
passed preflight under the production service account.

## Initial production measurements

The profiler emitted summaries for all four EVM chains. A startup recovery window
lasted 140,482 ms with 128,571 ms of process CPU; this delayed the timer and is not
representative of steady live indexing.

At 12:02:35 UTC, Base log queries showed mean Ponder provider-wait time of
11,458 ms versus mean individual request time of 1,564 ms. At 12:03:05 UTC those
means were 10,855 ms and 1,605 ms. There were 12 failed log attempts in each window.
Direct checks of the same bounded public log query succeeded on PublicNode,
returned HTTP 429 from Tenderly, and were rejected by Blast and the official Base
endpoint. No additional log-provider or budget changes were made.

At 12:07:14 UTC, the next recovery round reduced Base's outstanding target range
from 188 to 136 blocks. BNB's corresponding historical pass had finished, but
Ponder's shared startup barrier waits for all chains. The marketplace consequently
reports the source as unavailable during recovery. The live head-queue hooks are
covered by the actual-runtime integration test; their steady-state production
measurements still require this recovery to finish. The earlier BNB throughput
slowdown is not yet attributed to a specific stage.

## Recovery completed the same day

The profiling above made the causes measurable. Four chains returned to live indexing
at 13:20:47 UTC, and BNB sales became `available` at 14:18:02 UTC. No RPC budget,
finality policy or readiness rule changed, and paid RPC calls stayed at zero. The
installed files and rollback steps are in
[the recovery directory](../../ops/unified-indexer/recovery-20261105/README.md).

Correction to the notes above: the ingestion lock is on `main`. It was only absent
from the older branch this work started from. `main`'s launcher plus the preload
setting is byte-identical to the deployed launcher.

### Why recovery never finished

Ponder leaves recovery only when a whole round takes under 30 seconds. The alternative
exit could not pass, because BNB finalizes more than its 30-block allowance in any
30-second round. Every round took 63 seconds because of two Ponder bugs:

- **Log requests never merged.** Unused topics are `null`, but the merge check only
  recognizes `undefined`. Base sent 72 requests per block range rather than 7, or about
  150 per round.
- **The rate limit could not recover.** A burst of 429s after the restart lowered
  Base's limit to 3.46 requests per second. Growth required every second to reach
  `0.9 * 3.46 = 3.11` requests, but the limit only admits 3, so it stayed there.

The 11-second provider wait measured earlier was this limiter. Individual Base log
requests averaged 175 ms at the same time.

`lib/ponder-fixes` corrects both in memory, pinned to checksums of the deployed files.
Merged requests were compared with per-event requests on real Base data: 122 logs with
no differences on PublicNode, and 72 logs identical through the production gateway.

| Base                 | Before          | After       |
| -------------------- | --------------- | ----------- |
| Fetch per round      | 61 seconds      | 4 seconds   |
| Provider wait, mean  | about 11,500 ms | about 1 ms  |
| Restart to live mode | never           | 3.5 minutes |

The build ID stayed `157acd243f`, so Ponder resumed the retained schema. The OpenSea
workers on Ethereum, Base and Polygon, unavailable since 11:51 UTC, also recovered.

### Why BNB sales stayed `syncing` after that

This was a separate problem. The observer read the indexer's position before asking
for the finalized block. BNB finalizes 4 to 6 blocks behind head, so the position was
below the answer in all 13 sampled observations, by 2 to 13 blocks. Readiness then
reported `catching_up` every time, however current the indexer was. A control case in
`test-observer-finality-coverage-postgres.mjs` reproduces this with the real code.

The observer now waits up to 6 seconds for the indexer to reach the finalized block
before recording its position. If the indexer does not get there, the source still
reports `catching_up`, so incomplete coverage cannot be hidden.

In the 10 minutes after deployment, the position reached finality in all 25 new
observations, and `bnb-sales` was `available` in 183 of 188 samples. The samples that
were not cover the 11 seconds before the first new observation, plus one 7-second dip
back to `syncing` at 14:23:31 UTC, whose cause was not investigated.

### What still shows a warning

Views limited to BNB or Base are clean. Views including Ethereum or Polygon still report
those chains as unavailable. Their `seaport-sales` checkpoints record
`unsupported_sale_events`, with 68 and 35 excluded `unsupported_collection_sale`
events. The newest are months old, so this predates and is unrelated to this incident.

### Still open

The original BNB throughput deficit from 06:59 to 08:39 UTC is unexplained. An earlier
idea that gateway pacing capped BNB at 2.5 batches per second was wrong: pacing is per
endpoint, and the pool rotates. The limiter cannot be ruled out either, because its
warning only fires after a 15-second wait. Since going live, BNB's head queue has stayed
at 0 to 1 and its provider wait at 1 to 3 ms.
