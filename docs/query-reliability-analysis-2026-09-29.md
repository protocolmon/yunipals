# Remaining query failures: analysis and recommended fixes

Investigated on 29 September 2026 against the deployed indexer reader
`e8e7180` and marketplace bundle `f7d4774-projection`. During that investigation,
production work was limited to bounded GET requests, database inspection, and
read-only query experiments. The recommendations below describe the initial
plan; subsequent deployment results are linked below.

Implementation and deployment results are recorded in
[the rollout record](query-reliability-rollout-2026-09-29.md).

## Findings and confidence

| Issue | Evidence | Conclusion |
| --- | --- | --- |
| Main API BNB rarity browse | `metadata=all`, `sort=rarity-desc`, `limit=2` returned 503 after 30,135 ms. PostgreSQL logged the page statement timeout. Both page and count were active during the request. | Confirmed query performance failure independent of projection publication locks. |
| Main API rarity browse with available metadata | The same request with `metadata=available` returned 200 in 18,558 ms: page 5,627 ms, cold count 18,547 ms. | The inner-join variant is faster, but exact counts can still dominate the response. |
| Marketplace v2 error classification | Local fault injection of SQLSTATE `57014` returned v1 HTTP 503 / `market_unavailable`, but v2 HTTP 500 / `internal_error`. | Confirmed handler defect: expected database failures on the frontend's v2 route become generic 500s. |
| Historical deep-pagination 500 trigger | Forty v1 BNB token-ID pages, six v1 raw-rarity pages, six capped-rarity pages, 32 v2 BNB rarity pages, and four v2 combined-chain pages returned 200. The next v2 request was throttled with 429. A continuation at the expiry boundary returned the expected 409. Missing-metadata rarity and token-ID reads also returned 200. | The historical request's precise database or transaction failure was not reproduced. The handler defect explains how a database timeout could surface as 500, but does not establish that it caused that particular incident. |

The seven-route refresh observation does not exercise rarity sorting, deep
pagination, or every v2 catalog query. Its clean result cannot establish that
those query families are healthy. The live main API uses a 30-second statement
budget; its code default is 10 seconds. Increasing that budget again would leave
the measured query bottleneck in place.

## 1. Make rarity pages use bounded ranked reads

The main API only selects its indexed rarity path when `metadata=available`.
With the default `metadata=all`, it starts from tokens, left joins a validated
search relation, then sorts before applying the limit. Its captured PostgreSQL
plan estimates about 580,000 BNB candidates. It scans the token population and
builds the validated search side before producing the first page.

The validation is necessary: release, lifecycle, mint anchor, publication hash,
projection revision, and Base metadata event checks protect correctness. The
problem is doing that work through a broad join before selecting a small page.

A read-only prototype drove the query from the existing generation rarity
index and performed correlated token and publication checks. It selected three
valid non-null candidates in **8.56 ms execution plus 12.49 ms planning**.
The index and proof lookups each processed three rows. This was one warm query,
not a complete endpoint benchmark: it excludes the exact count, document
enrichment, null-score tail, sparse filters, and concurrent load.

Recommended implementation in `apps/yunipals-indexer/lib/api/server.ts` and
`lib/metadata/read-source.ts`:

1. Separate raw/capped rank query construction from token-ID browsing. Use the
   captured generation's search table as the ordered source for non-null
   scores, with point token identity joins and correlated validation.
2. Apply ownership, lifecycle, visibility, metadata, trait, and rarity filters
   before accepting each result. Continue from the last examined rank when
   rejected candidates require another bounded batch; a fixed overfetch followed
   by filtering must not produce short pages or skipped rows. For selective
   owner or trait filters, choose a plan driven by matching identities instead
   of searching the whole rarity index for a few matches. Measure both families.
3. Handle validated null scores and absent or invalid search rows in separate
   query phases. Merge their token identities in the existing numeric token-ID
   and collection order. Invalid publication or revision data must continue to
   behave as missing derived data, and newly indexed tokens must remain visible
   under `metadata=all`.
4. Preserve exact numeric score values, ascending token-ID ties, cross-chain
   identity, and `NULLS LAST` for raw/capped ascending and descending sorts.
   Bind one projection generation throughout the request.
5. Enrich only the final bounded page with metadata documents. Use separate
   physical token stores before merging selected chains.

The required rank indexes already exist. Add or alter indexes only if measured
plans show a remaining mismatch. PostgreSQL documents how a matching B-tree
order allows a limited query to stop early instead of sorting its population:
[Indexes and ORDER BY](https://www.postgresql.org/docs/16/indexes-ordering.html).

## 2. Make exact counts independent of sorting

The route currently includes the sort in its count-cache identity and selects
its inexpensive count path only for token-ID browsing. However, changing the
sort does not change how many tokens match a filter. A default rarity browse
with `metadata=all` and no rarity or trait filters needs the same total as the
equivalent token-ID browse; it does not need publication and rarity joins to
compute that total.

Recommended implementation:

- Decide which relations a count needs from its filters, independently of the
  page's sort strategy. Reuse the physical-token count and active-hidden-token
  subtraction where equivalent. Preserve owner and burned-token semantics.
- For counts that require metadata or rarity predicates, use physical bulk
  validation joins rather than a point-read existence check for every token.
  Check both warm and cold plans at production size.
- Use a normalized filter-only count key, excluding sort, limit, and cursor.
  Include the projection generation and all relevant release and visibility
  dependencies. Preserve the existing count freshness contract and account for
  live transfers, burns, visibility changes, and recovery before extending cache
  lifetimes. An immutable metadata generation does not make ownership immutable.
- Retain single-flight loading and bound concurrent cold count work. Log page
  and count failures separately. Settle or cancel request-owned sibling work
  after a failure. Shared count loaders need their own deadline and consumer
  accounting; cancelling one request must not abort a count another request
  still needs. Avoid late writes to a retired cache entry.
- Keep the v1 `total` exact under its existing freshness contract. If some
  uncommon filtered counts still cannot meet the interactive budget, introduce
  an explicit optional count contract in a versioned endpoint; do not silently
  substitute estimates or omit the current field.

## 3. Make marketplace v2 failures explicit and diagnosable

The frontend requests `/v2/market/tokens`. In `src/app.ts`, recognized domain
errors preserve their status, but the generic marketplace error branch matches
only `/v1/market/`. An unwrapped `pg` exception therefore becomes a v2 500.
`CatalogService.heldRead()` retires a generation and rethrows statement failures,
so a catalog SQL timeout can take this path.

Recommended implementation in `apps/yunipals-market-api/src/app.ts`,
`src/reads/catalog.ts`, and `src/db/pool.ts`:

1. Add a common, typed database failure classifier for supported marketplace
   versions. Statement/lock timeouts, unavailable connections, and exhausted
   acquisition budgets return a bounded availability response. Retain 500 for
   unexpected programming failures and log them. Changing status alone does not
   fix a slow query.
2. Log a request ID, route/version, normalized filter hash, sort, page phase,
   snapshot age, projection generation, SQLSTATE, lane/queue wait, and execution
   duration. Do not log connection strings, credentials, or complete request
   bodies. Correlate failures at the API and source database.
3. Distinguish snapshot expiration, database failure, and shutdown in the
   generation lifecycle. Expired cursor work should return the existing
   `snapshot_refresh_required` 409. A statement failure must retire the damaged
   transaction; it must not be reused or blindly retried within that transaction.
4. Lease source lanes exclusively with a bounded queue. The current code selects
   the least busy lanes but can select lanes with active work, leaving `pg` to
   queue statements. Count time spent waiting against the request budget.
5. Coordinate retirement with active reads. Mark the generation unavailable for
   new work immediately, then settle/cancel bounded operations before releasing
   their connections. A hard expiry or source connection failure must have a
   known error outcome for affected requests, including concurrent siblings.
6. Verify non-null and null-tail continuation plans, rare trait filters, and
   listed/price queries on the actual failing query family. Preserve the current
   signed cursor, retained source snapshot, current ownership/visibility checks,
   and exact monetary ordering. Keep immutable snapshot books reusable where a
   measured benefit justifies a bounded cache.

The historical deep-page trigger remains an open investigation item. Structured
failure evidence and a production-sized replay are required before claiming it
has been eliminated. The observed expiry-boundary result was already correct;
the lifecycle changes above address concurrency and failure handling risks,
rather than a demonstrated failure of every expired cursor.

## Delivery order and acceptance

1. Add the v2 classifier and failure telemetry, with local HTTP fault-injection
   coverage for SQLSTATE `57014`, `55P03`, connection failure, expiry, and an
   unexpected programming exception. This makes the next failure attributable.
2. Rewrite main API rarity candidates and sort-independent counts. Use real
   PostgreSQL parity tests covering missing/stale publications, null ranks,
   hidden/transferred/burned tokens, numeric ties, combined chains, and sparse
   filters. Benchmark a restored full-size database before rollout.
3. Reproduce or replay the failing marketplace family using the new evidence;
   fix its query or lane lifecycle with a targeted regression test. Exercise
   expiry during work, a killed source connection, a timed-out statement, and
   simultaneous continuation requests.
4. Observe the affected v2 and rarity routes during projection publication and
   controlled backup overlap. Track intentional 409/429 responses separately
   from unexpected 500/503 responses.

Proposed performance gates are an unfiltered rarity page p95 below 500 ms,
continuation p95 below 500 ms, common cold count p95 below two seconds, and no
targeted statement crossing its database deadline under the agreed concurrent
load. Verify and adjust these targets on the restored production dataset.
The prototype is not evidence that these endpoint targets already pass.

Completion requires no unexplained pagination 500s in replay, correct recovery
from expected expiry and database failures, exact result/count parity, bounded
query and queue work, and 24 hours of observations covering the previously
failing request families. Broader performance tests should include default
24-card pages, large uint256 identities, long score ties, null tails, rare
filters, source recovery, and generation changes.
