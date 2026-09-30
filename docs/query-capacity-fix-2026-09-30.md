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
The HTTP catalog concurrency limit is four. Rate, concurrency, and queue
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
makes that build unusable, even if the builder commits later. Count caching keeps
its existing 15-second lifetime; this change does not extend count staleness.

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

Pending final test and production measurements.
