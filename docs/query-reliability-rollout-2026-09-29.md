# Query reliability rollout — 29 September 2026

This implements the fixes in
[the query analysis](query-reliability-analysis-2026-09-29.md). Both reader APIs
are deployed. The targeted 24-hour acceptance window is **still running**.

## Releases and changes

| Process | Installed release | Previous compatible release |
| --- | --- | --- |
| Main indexer API | `feb12d5c4f4647adf0ac54dbbe38fb511aecc87e` | `e8e7180` |
| Marketplace API | `3a4ba38bf47f2d2e8a79449f3d4d56e5a7bb8952` | `f7d4774-projection` |
| Projection writer | `5dd51e7`, unchanged | Same generation-capable writer |

Main API directory: `/opt/yunipals/releases/feb12d5/apps/yunipals-indexer`.
Marketplace directory: `/opt/yunipals-marketplace/releases/3a4ba38-query`.
Both use Node 24.18.1 and generation reads. Their actual process arguments and
generation flags were checked after deployment. Marketplace capabilities were
identical before and after its restart.

The release is a documented source overlay on the previous compatible runtime.
`query-release.json` identifies the new code; the preserved `release.json`
identifies the base. All 399 source/bundle files were SHA-256 checked against
`/opt/yunipals-ops/release-sha256.json`. The uploaded release archive SHA-256 is
`a6a960d6a32dc28c465f86ac2a6f32015bfce266e32ee4a5cc5b6db581229c15`.
The marketplace bundle has the same source as the earlier tested `3a4ba38`
build; the follow-up commit changes only the main indexer.

### Main API

- Drive ordinary rarity pages from the generation rank indexes, with correlated
  current-token and publication proofs before accepting rows.
- Keep exact counts independent of sort, sharing their existing 15-second
  cache across sort/limit/cursor changes. Include generation and the complete
  visibility identity/ownership/lifecycle/anchor revision in the count key.
- Bound distinct cold count loaders to four. Settle page and shared count work
  and log which branch and page phase failed.
- Split null scores into validated ranked rows and missing/invalid search rows.
  Materialize the bulk validated identities before the missing-row anti-join.
  This prevents an ordered `LIMIT` scan from repeating a full proof per token.
- Keep bulk planner settings local to bounded read-only transactions. Broad
  proofs use 64 MB `work_mem`, no JIT, hash-oriented planning, and a local
  page-cost/join-order configuration measured on this host. Document enrichment
  runs separately on the bounded candidate records with ordinary point-read
  planning. Applying bulk settings to enrichment was tested and rejected.
- Narrow trait candidates using captured-generation raw identities, deduplicated
  across matching values. Preserve every validated trait predicate before
  ordering/limit. Owner/trait-filtered metadata counts use correlated point
  proofs after narrowing identities.
- Preserve exact numeric scores, numeric token-ID/collection ties, nulls last,
  current lifecycle/ownership/visibility, publication hashes and mint anchors.

### Marketplace

- Classify expected database timeouts, lock/acquisition failures and unavailable
  connections consistently on v1 and v2 as 503. Unexpected programming failures
  still return 500.
- Record request ID, route, normalized filter hash, sort, page phase, generation,
  snapshot age, queue wait, execution duration and sanitized SQLSTATE.
- Exclusively lease held source transactions with an eight-request queue and
  1.5-second acquisition deadline. Busy requests return 429 with retry guidance.
- Distinguish expiry, source failure, generation change and shutdown. Retire a
  failed transaction and wait for active/sibling reads before releasing it,
  with a hard cleanup guard. Expired continuations retain the existing 409
  refresh response.

## Database maintenance

`api:proof-indexes` installed eight concurrent covering indexes across the two
physical token stores, projection revisions and publication proofs. All eight
were ready and valid at 20:22:38 UTC. An initial two-second lock deadline expired
while waiting for old snapshots. The resumable migration safely removed its own
invalid index and retried with a 15-minute statement deadline; ordinary reads
and ingestion remained available.

Statistics showed sparse lifecycle visibility maps, including BNB lifecycle
pages with only about 15% marked all-visible. Cost-limited
`VACUUM (ANALYZE, TRUNCATE FALSE)` completed on both lifecycle tables and
`metadata.token_metadata` at 20:31:34 UTC. Lifecycle pages became fully visible.

`api:maintenance` lowers vacuum, insert-vacuum and analyze scale factors to 2%
on those three tables and disables vacuum truncation on them and their TOAST
storage. The production settings were applied and verified. Its table lock was
tested to coexist with a held reader on real PostgreSQL. Rerun both additive
maintenance commands after recreating a physical schema; API roles remain
read-only. No global PostgreSQL planner settings were changed.

The recurring writer's measured backup allowance was corrected from 10 GB to
35 GB in `/opt/yunipals-ops/query-capacity.env`, retaining its 25 GB reserve.
The worker was restarted after its completed cycle and its process environment
was checked. Generation 6 is active, with generation 5 protected. Generation 6
published at 20:08:10 UTC in 10.3 ms while the fresh backup was underway.

## Recovery backups

Verified encrypted Storage Box copies remain under:

- `yunipals-marketplace/indexer-next-recovery/cutover-20260929T083427Z`
- `yunipals-marketplace/indexer-next-recovery/cutover-20260929T153545Z`
- `yunipals-marketplace/indexer-next-recovery/cutover-20260929T193946Z`
- `yunipals-marketplace/indexer-next-recovery/query-code-feb12d5-20260929T205841Z`

The fresh database dump is 7,196,139,927 bytes. Its dump, globals, runtime archive
and manifest were uploaded, downloaded, decrypted and SHA-256 checked at
20:08:44 UTC. Their report is
`/var/backups/yunipals-indexer-cutover-20260929T193946Z/offhost-report.json`.
The final code/configuration archive was verified at 20:58:44 UTC before either
API deployment. It includes the exact source/bundles, release hashes, both new
API overrides, and the writer capacity override/configuration. Its report is
`/var/backups/yunipals-query-code-feb12d5-20260929T205841Z/offhost-report.json`.

Only redundant local payloads with verified off-host copies were removed to
recover space. Local reports/manifests and off-host recovery copies remain.
The earlier verified MongoDB backups remain intact.

A full restored PostgreSQL rehearsal was **not completed**. Automatic approval
review rejected copying the production dump to the local workspace without
explicit authorization for that destination. Verification instead used
disposable PostgreSQL fixtures and bounded, read-only loopback instances on the
actual host. The dump's archive listing and round-trip integrity checks passed;
these checks do not establish that a complete PostgreSQL restore has succeeded.

## Verification and measured results

- Node 24 typechecks passed for both apps.
- Indexer unit suite: 93 passed, one skipped.
- HTTP/classifier/lease tests: 18 passed.
- Real PostgreSQL catalog suite: 19 passed, including statement timeout,
  snapshot expiry during an active read, source loss and concurrency.
- Real PostgreSQL rarity parity: 144 cases across four chains, raw/capped
  ascending/descending, owner/trait/multiple-value filters, score ranges,
  null/missing/stale proofs, hidden/transferred/burned tokens and uint256 IDs.
- Main production-size replay passed 32 ordinary pages and all 70 missing rows
  in both tested sorts, with no duplicate/skipped identities.
- Marketplace paced replay passed 61 pages, including BNB raw/capped and combined
  chains, with stable snapshots/totals and no duplicate identities.

| Measured request family | Result |
| --- | --- |
| Main ordinary rarity, 32 candidate pages | p95 127 ms; maximum 184 ms |
| Main missing metadata, six candidate pages | 5.6–6.9 seconds |
| Main simultaneous cold available/missing reads | 5.7 and 11.0 seconds; both 200 |
| Main sampled trait filter, final candidate | 9.0 seconds all; 8.9 available; 10.1 missing; all 200 |
| Main sampled owner with available metadata | 61 ms; exact total 5 |
| Marketplace continuation p95 | Raw 212 ms; capped 200 ms; combined 273 ms |
| Main live post-deployment first page | 97 ms all; 5.9 seconds missing; 5.0 seconds available |
| Marketplace live post-deployment first page | 2.1 seconds; 24 items |

Both readiness endpoints passed after deployment. Public GETs passed through
the deployed paths `/yunipals-indexer/v1/tokens` and
`/yunipals-marketplace/v2/market/tokens` on `api.yunipals.com`. The marketplace
check used the allowed frontend origin `https://yunipals.com`.

Cold filtered exact counts still exceed the proposed two-second target. Sparse
or broad trait filtering and missing-row tails remain slower than ordinary
ranked browsing. These measurements show deadline headroom for the tested
requests, not a guarantee under arbitrary load. The precise historical deep
pagination 500 trigger remains unconfirmed; the classifier defect and unsafe
transaction-sharing/retirement behavior are covered by regression tests.

## Running acceptance window

`yunipals-query-24h-observation-20260929.service` started at **21:01:01 UTC** and
runs through approximately **30 September, 21:01 UTC**. Its script is the
hash-verified `scripts/observe-query-reliability.py`. Its report is
`/var/lib/yunipals-query-observation/20260929/report.json`.

It checks main raw/capped rarity and available/missing metadata, marketplace
v2 first pages and raw/capped/combined continuations, with a 24-page replay
every 15 minutes. It verifies retained snapshots, exact totals and duplicate
identities, records generation changes and disk reserve, and reports expected
409 refreshes and 429 capacity responses separately from read errors. The
earlier seven-route projection observer also continues. Scheduled backups and
projection cycles fall inside this window.

At 21:06 UTC, six cycles had zero read errors/500s/503s. Two combined first-page
429s were recorded separately; minimum free space was 74.27 GB. Both isolated
candidate APIs were stopped after deployment. Acceptance remains pending until
the completed report is reviewed, including projection/backup overlap and any
subsequent failures.

## API rollback

Remove only the new override for the affected API, reload systemd and restart
that service:

```sh
rm /etc/systemd/system/yunipals-api.service.d/zz-query.conf
systemctl daemon-reload
systemctl restart yunipals-api.service
```

```sh
rm /etc/systemd/system/yunipals-market-production-api.service.d/zzzzzzzz-query.conf
systemctl daemon-reload
systemctl restart yunipals-market-production-api.service
```

This returns to the compatible generation readers shown above. Verify readiness,
actual process arguments, generation flags and affected GETs after rollback.
Keep the additive covering indexes and safe maintenance settings. The writer
and active projection pointer are unchanged by API rollback. Do not return to
stale legacy projection tables or restore the whole database for an API rollback.
