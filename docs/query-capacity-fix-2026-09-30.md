# Query capacity and metadata-filter latency

## Changes

Marketplace catalog generations have two independent read slots. Each slot uses
one marketplace connection and two direct indexer connections. All followers
import the same database snapshot as their exporter. Counts with equivalent
filters share their work across sorts; order-book reads share their work within
the generation. Expiry retires cursors and drains both active slots before
releasing connections. The bounded queue and rate limits remain in place.

Pool limits include three live generations and one draining generation: eight
marketplace connections and seventeen indexer connections, including readiness.
The HTTP catalog concurrency limit is four, with a four-second queue deadline. Rate, concurrency, and queue
rejections produce structured logs and an `X-Capacity-Reason` response header.
The observation script records those reasons alongside status counters.

The main API gains an indexed read cache for validated metadata membership,
metadata availability, and exact scores. It also indexes current token identities
that have no validated search row. A separate worker builds each collection under
a repeatable-read snapshot, outside HTTP requests. Ownership, burn status, and
visibility are evaluated against the live token tables on every read.

Each proof dependency has an invalidation trigger. A metadata, mint-anchor,
lifecycle, publication, release, or projection change increments the collection's
revision in the writer's transaction. Projection triggers use transition tables
to invalidate once per statement. Triggers remain enabled for replication writes;
TRUNCATE has its own invalidation trigger. Owner-only transfers avoid metadata
cache invalidation. Base event coverage and publisher errors invalidate Base.

The read validates the cache revision, generation, source mode, relation OIDs,
and enabled triggers in the same SQL statement. If any check fails, it uses the
existing canonical proof query. A proof committed during a cache build therefore
makes that build unusable, even if the builder commits later. Broad metadata/range counts use guarded membership directly and subtract live
hidden identities. Counts with owner, burn, or trait filters retain the
current-token join. Count caching keeps its existing 15-second lifetime; this change does not extend count staleness.

## Operations

1. Complete and verify an encrypted Storage Box backup of the database, globals,
   runtime, releases, and service configuration.
2. Run `pnpm api:read-cache:migrate` as the database owner with generation mode and
   the correct physical, BNB, and read schemas. The migration is transactional,
   uses a one-second lock timeout, and mirrors existing projection SELECT grants.
3. Run `pnpm start:read-cache` as a separate supervised worker. The included
   systemd example requires the operator to provide a protected environment file
   and select the deployed release. A session advisory lock prevents overlapping
   workers. Builds have a 60-second statement deadline and one-second lock timeout.
4. Warm the cache and test a candidate API with `YUNIPALS_READ_CACHE=1`. Compare
   counts, rows, and scores with the original path before switching production.
5. Start a new 24-hour observation after cutover. Review latency, rejection reasons,
   SQL errors, pool pressure, restarts, and generation transitions.

Cache invalidation is a database invariant. After intentionally disabling or
replacing guards, reinstall the migration before re-enabling cached reads.
Reinstallation increments every collection revision. Do not modify cache rows
manually. A stopped worker preserves correctness through fallback but can bring
back cold-query latency after proof changes.

Rollback uses the retained API releases and service configuration and disables
`YUNIPALS_READ_CACHE`; stop the new cache worker. The additive tables and guards
can remain while the problem is investigated. Rare trait queries still require
canonical trait validation and are outside this metadata-filter optimization.

## Verification

Local checks passed:

- Indexer: 93 unit tests passed, one skipped; offline parity covered five legacy
  families and four scored families.
- Marketplace: 384 tests passed. After increasing the queue deadline, all 39
  focused catalog, lease, and HTTP checks passed again.
- PostgreSQL parity: 288 pagination cases, 72 broad count cases, and 25
  invalidation/race scenarios. Counts also matched the canonical path during
  proof mutations and owner/burn updates.
- Secret scans of both implementation commits found no leaks.

The production-sized candidate matched main API rows/totals for all six observed
rarity families and marketplace rows/totals for raw, capped, and combined reads.
Continuations kept their snapshot and counts and had no duplicate tokens.

| Candidate check | Original API | Final candidate |
| --- | --- | --- |
| BNB available, raw rarity, cold count | 5,473 ms | 299 ms |
| BNB missing, raw rarity, cold count | 5,904 ms | 203 ms |
| BNB missing, capped rarity | 6,111 ms | 228 ms |
| BNB capped market page after raw page | 1,959 ms | 126 ms |

Four simultaneous cold catalog queries returned 200 in 1.6–3.2 seconds. With
the first candidate's 1.5-second queue, two of those four requests returned
catalog_queue_timeout; the final four-second queue passed the same check.

An extra token-ID/available probe timed out on the old API after 30 seconds
with 503; the candidate returned 200 in 1,684 ms. That probe had no successful
old response for row comparison. The six rarity families provided the production
parity gate; the expanded token-ID probe is recorded as a separate finding.

Detailed sanitized evidence is in
[the acceptance report](audit/query-capacity-acceptance-2026-09-30.json).

## Production rollout

Cutover completed at **2026-09-30 11:40:00 UTC**.

| Service | Installed release |
| --- | --- |
| Main API | /opt/yunipals/releases/9a2bb8a-read-api |
| Marketplace API | /opt/yunipals-marketplace/releases/9a2bb8a-capacity |
| Read-cache worker | /opt/yunipals-read-cache/releases/3d36d9b |

The API is a standalone production dependency deployment. Marketplace retains
its compatible runtime dependencies with the new server bundle. The two reader
releases are recorded by their capacity-release.json files. All 31,875 base
artifact files and five overlay files were SHA-256 verified. Both implementation
commits passed secret scans.

The cache worker uses a separate readable release directory and the existing
PostgreSQL system account over the local peer-authenticated socket. Its service
has a protected environment file, filesystem hardening, a private temporary
directory, and automatic restart on failure. The API and worker use the same
canonical proof implementation; the later API commit adds count/browse selection
and changes the market queue deadline.

Before restarting the normal API services, nginx temporarily served the
validated candidates. Once both normal ports were ready and warm, nginx was
restored. Public readiness and read checks all returned 200. Main API public
available/missing reads took 194/280 ms, and the sampled public market page took
219 ms. Marketplace capabilities matched exactly before and after restart.
Both API services and the cache worker had zero automatic restarts.

The first build covered 580,093 BNB tokens, 36,686 Ethereum tokens, 440,194 Base
tokens, and 15,970 Polygon tokens. BNB/Base builds took about 33/35 seconds;
Ethereum/Polygon took about 1.7/0.7 seconds. During a rebuild or proof invalidation,
the canonical fallback can still incur cold-query latency. This is a correctness
fallback, and the worker warms the replacement outside user requests.

The original observer was preserved and stopped at 14 hours 42 minutes. It
recorded no read errors and 134 capacity responses. Its available/missing p95
latencies were 5,972/7,513 ms; its final few samples overlap this rollout.

A fresh observation began at **2026-09-30 11:43:31 UTC** and is due to finish
**2026-10-01 11:43:31 UTC**. After the first five cycles it had no read errors,
429s, or generation transitions. Those early samples are not a completed
24-hour acceptance result.

- Unit: yunipals-capacity-24h-observation-20260930.service
- Report: /var/lib/yunipals-query-observation/20260930-capacity/report.json

## Verified recovery copies

The Storage Box copies are encrypted and were downloaded, decrypted, and
SHA-256 checked.

- Full database/globals/runtime/configuration:
  yunipals-marketplace/indexer-next-recovery/cutover-20260930T101522Z,
  verified at 11:02:48 UTC. Database dump: 7,196,478,768 bytes.
- Final source, bundles, hashes, worker configuration, and prepared reader
  overrides:
  yunipals-marketplace/indexer-next-recovery/query-code-capacity-final-20260930T112701Z.

The initial attempt to archive every historical release hit its time limit.
The completed archive includes all four indexer releases used by running
services and the active marketplace release. The completed database dump was
retained, checked with pg_restore --list, and used by the successful resume.
The incomplete archive was retained separately and was not treated as verified.

## Exact rollback steps

Remove the new reader overrides:

- /etc/systemd/system/yunipals-api.service.d/zzzz-capacity.conf
- /etc/systemd/system/yunipals-market-production-api.service.d/zzzzzzzzz-capacity.conf

Reload systemd and restart those two services. Their retained overrides select
the previous feb12d5 and 3a4ba38-query readers. Stop/disable
yunipals-read-cache.service. Verify readiness and public reads, and start a
separate observation for that rollback. The additive cache tables and guards can
remain; the previous API does not enable cached reads.

A change to canonical publication/search proof logic requires matching API and
cache-worker code and rerunning the cache migration before enabling cached
reads. Reinstallation invalidates existing sets. Cached proof results must
not be reused under a different proof definition.
