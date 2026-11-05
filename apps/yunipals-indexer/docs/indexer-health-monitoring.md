# Indexer health monitoring

The [request monitor](request-monitoring.md) times public pages, and those stayed fast
while BNB indexing fell 15 minutes behind on 2026-11-05. `yunipals-shared-production-health`
records failures but does not notify anyone, and it also reported healthy during that
stall. This monitor covers that gap. It checks every minute, and emails the request
monitor's recipient when a problem persists and again when it recovers.

| Condition             | Problem when                                          | Checks to alert |
| --------------------- | ----------------------------------------------------- | --------------- |
| `indexer-ready`       | Ponder's `/ready` is not 200                          | 5               |
| `lag-<chain>`         | BNB or Base over 120s behind, others over 300s        | 5               |
| `oldest-transaction`  | A snapshot has been open over 20 minutes              | 3               |
| `dead-rows-<table>`   | `pg_attribute` over 200,000, checkpoints over 10,000  | 3               |
| `metadata-worker`     | No worker heartbeat for 15 minutes                    | 3               |
| `observation-<chain>` | A chain observation has an error or is 5 minutes old  | 5               |
| `market-<checkpoint>` | A sales checkpoint is not `available`                 | 10              |
| `production-health`   | The existing report is unhealthy or 10 minutes old    | 15              |
| `reorg-tracking`      | The indexer journal cannot be read for reorg counting | 15              |

Two healthy checks close an incident. A value that cannot be read counts as a problem, so
an unreachable database cannot look healthy.

## Choosing thresholds

These come from the 2026-11-05 measurements. In healthy operation the oldest snapshot
peaked at 89 seconds and `pg_attribute` at about 16,000 dead rows, and BNB stayed within 5
seconds. BNB started falling behind about 3 hours after that day's stuck query began, so
the 20-minute limit is a warning well before any visible effect. Lag and readiness wait
5 checks because a normal indexer restart takes about 4 minutes. `production-health` waits
15 because it often has short failures during deployments.

## Reading the history

Each check is appended to `/var/lib/yunipals-indexer-health-monitor/samples-<date>.jsonl`
and kept for 7 days. If BNB falls behind, compare `metrics.oldest` and `metrics.dead` with
`index_block` in the `yunipals_indexer_profile` journal records. Rising dead rows with slow
indexing points to a blocked vacuum, and normal values point somewhere else.

## Reorg tracking

Each check also reads new indexer journal lines and records every reorg Ponder saw in
`/var/lib/yunipals-indexer-health-monitor/reorgs.jsonl`. That file is kept indefinitely,
because the journal only keeps a few days. These records never send email. To see how often
reorgs happen, run `yunipals-reorg-report` as root on the server.

| Record                    | Source                                                           | Deeper than 30 blocks                      |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `reorg`                   | Ponder's `Reorged block` line, for a reorg it handled            | No depth recorded                          |
| `beyond_ponder_window`    | `Encountered unrecoverable reorg`                                | Yes, when the window is at least 30 blocks |
| `stale_provider_response` | The same warning, but the received block was older than finality | No: not a reorg                            |
| `reorg_depth`             | A `yunipals_indexer_reorg` profiler line with the exact depth    | When the depth is over 30                  |

Ponder's finality window is 30 blocks on Base and BNB, 65 on Ethereum and 200 on Polygon, so
reorgs of 31 to 65 blocks on Ethereum, or 31 to 200 on Polygon, are only counted as deep from
`reorg_depth` records. The current profiler does not emit those yet.

Both "unrecoverable reorgs" in the journal from 2026-11-01 to 2026-11-05 were stale provider
responses: on Base the received block was 6 blocks older than Ponder's finalized block, and on
BNB 16,431 blocks older. Shallow `reorg` records can also come from providers briefly
disagreeing, not only from real chain reorgs.

To import older journal entries once, run the monitor with `--backfill-reorgs <date>`. Records
are keyed by journal cursor, so repeated imports add nothing twice.

## Installation

`ops/unified-indexer/recovery-20261105/install-indexer-health-monitor.sh` performs these
steps from the repository root. Review it first: it adds a permanent timer on production
and sends one test email.

The monitor runs as `postgres`, like `yunipals-shared-budget-health`, because only that role
can see every session's snapshot age. It connects through a local socket without stored
database credentials, and every query is read-only with a 10-second limit, so it cannot
become the long-open transaction it reports. It reuses the request monitor's mail settings.

1. Pin an immutable release containing `scripts/indexer_health_monitor.py` and
   `scripts/request_monitor.py`.
2. Install `deploy/indexer-health-monitor.json` at
   `/etc/yunipals-indexer/indexer-health-monitor.json`. Update `release_id` and the
   checkpoint schema names whenever the indexer moves to a new schema.
3. Install the service template with `@RELEASE_DIR@` replaced, then the timer.
4. Start the service once and inspect its journal, then send a test email by adding
   `--test-email` to the same command.
5. Run `systemctl enable --now yunipals-indexer-health-monitor.timer`.

```sh
python3 -m unittest discover -s apps/yunipals-indexer/scripts -p 'test_indexer_health_monitor.py' -v
journalctl -u yunipals-indexer-health-monitor.service --since '1 hour ago'
```

Stop checks with `systemctl disable --now yunipals-indexer-health-monitor.timer`. Setting
`email_enabled` to `false` keeps the history but sends nothing.

## Limits

This runs on the server it monitors, so a whole-server outage sends no alert. If a check
fails unexpectedly, the monitor sends at most one email an hour saying so, but a timer
that has stopped entirely is silent. An external heartbeat would cover both.
