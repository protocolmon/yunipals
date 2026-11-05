# Indexer recovery, 2026-11-05

This records what was installed on `yunipals-main` to bring the shared indexer back
to live indexing and clear the BNB sales warning. Full background and measurements
are in
[the rollout notes](../../../docs/unified-indexer/continuous-profiling-2026-11-05.md).

Nothing here contains credentials. Verify the hostname is `yunipals-main` before
using any of it.

## What was wrong

1. Ponder sent one `eth_getLogs` per event because unused topics are `null` and its
   merge check only recognizes `undefined`. Base needed 72 requests per block range
   instead of 7.
2. Ponder's adaptive rate limit could not grow from values such as 3.46, so Base
   stayed at about 3 requests per second after a burst of 429s.
3. Together these kept each recovery round at 63 seconds. Ponder only enters live
   mode after a round under 30 seconds, so every chain stayed in recovery.
4. Separately, the observer read the indexer's position before asking for the
   finalized block. BNB finalizes 4 to 6 blocks behind head, so the position was
   always below the answer, and `bnb-sales` could never become `available`.

5. A stuck URI audit query held a database snapshot open for almost 4 hours. Vacuum
   could not remove dead rows, so block indexing slowed until BNB fell 885 seconds
   behind. Cancelling that query cleared it. The audit's read now has a 5-minute limit (`lib/metadata/uri-audit.ts`), deployed at 16:24 UTC.

The first two are fixed by
[`lib/ponder-fixes`](../../../apps/yunipals-indexer/lib/ponder-fixes/README.md). The
fourth is fixed in `apps/yunipals-indexer/lib/unified/observer.ts`. No RPC budget,
finality policy or readiness rule changed.

## What is installed

| File here                                                                                    | Location on `yunipals-main`                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `systemd/yunipals-indexer.service.d/90-profiling.conf`                                       | `/etc/systemd/system/yunipals-indexer.service.d/`                              |
| `systemd/yunipals-indexer.service.d/91-ponder-fixes.conf`                                    | `/etc/systemd/system/yunipals-indexer.service.d/`                              |
| `systemd/yunipals-indexer-observer.service.d/90-finality-coverage.conf`                      | `/etc/systemd/system/yunipals-indexer-observer.service.d/`                     |
| `systemd/yunipals-shared-rpc@base.service.d/90-startup-fallback.conf`                        | `/etc/systemd/system/yunipals-shared-rpc@base.service.d/`                      |
| `systemd/yunipals-shared-rpc@.service.d/z-free-deadline-20261103.conf`                       | `/etc/systemd/system/yunipals-shared-rpc@.service.d/`                          |
| `systemd/yunipals-metadata.service.d/zzzzzzzzzzzzzzzzzzzzzzzzzzzz-audit-limit-20261105.conf` | `/etc/systemd/system/yunipals-metadata.service.d/`                             |
| `base-startup-fallback.public.env.example`                                                   | `/opt/yunipals-unified/profiling-20261105-v1/base-startup-fallback.public.env` |
| `source-timeouts.public.env.example`                                                         | `/etc/yunipals-unified/shared-20261102-v2/rpc/source-timeouts.public.env`      |

Release directories on the server:

- `/opt/yunipals-unified/profiling-20261105-v1`: the launcher, which matches
  `scripts/start-indexer.mjs` and `ops/unified-indexer/run-indexer.sh`, and the
  profiler.
- `/opt/yunipals-unified/ponder-fixes-20261105-v1`: `lib/profiling`,
  `lib/ponder-fixes`, and `indexer.service.env`. That env file is the previous one
  with one setting changed:
  `YUNIPALS_INDEXER_PONDER_PROFILER=<release>/apps/yunipals-indexer/lib/ponder-fixes/preload-with-profiling.mjs`.
- `/opt/yunipals-unified/shared-observer-v3-20261105`: the observer bundle.
- `/opt/yunipals-unified/metadata-worker-audit-limit-20261105`: the metadata worker bundle.

## The observer bundle

Production's observer was built from an older entry file than the one on `main`, so
this hotfix patches that exact bundle instead of rebuilding it, which keeps the change
to this one behaviour. `patch-observer-bundle.py` checks the checksum of its input and
output. It carries the same logic as `lib/unified/observer.ts`, and the new test passes
against both:

```sh
OBSERVER_TEST_ARTIFACT=/path/to/bundle-with-observeIndexerChain-exported.mjs \
  pnpm --filter @protopals/yunipals-indexer test:unified:observer:finality:postgres
```

The next observer built from `main` includes the fix through `observer.ts`, so this
script and `shared-observer-v3-20261105` can then be retired.

The metadata worker bundle was patched the same way, for the same reason, with
`patch-metadata-worker-bundle.py`.

## Monitoring

`install-indexer-health-monitor.sh` installs
[indexer health monitoring](../../../apps/yunipals-indexer/docs/indexer-health-monitoring.md).
It was run at 16:40 UTC from commit `e8aa443f`, into `/opt/yunipals-indexer-health-monitor/releases/`. It adds a permanent timer on production and sends one test email. The end of the script shows how to remove it.

## Rolling back

Each script removes one drop-in and restarts one service. Run them from the matching
release directory on the server, where they are also installed as `rollback.sh`.

- `rollback-metadata-worker.sh`: restarts only the metadata worker. The URI audit then has no time limit again.
- `rollback-observer.sh`: restarts only the observer. `bnb-sales` stays `syncing`
  again.
- `rollback-ponder-fixes.sh`: restarts the indexer. Both Ponder bugs return, and the
  next restart will stall in recovery again.
- `rollback-profiling.sh`: removes the profiling drop-in. Remove
  `91-ponder-fixes.conf` first, because that drop-in overrides this one.

Avoid indexer restarts when possible: each one triggers recovery and briefly
interrupts the EVM indexers and the managed Solana adapter.
