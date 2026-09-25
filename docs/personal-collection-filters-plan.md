# Personal collection search, sorting, and filtering

Implementation plan, 22 September 2026. The web app and a guarded external-indexer patch are now implemented. The rollout uses bounded checks on production, with the new API isolated until those checks pass. Performance limits below remain acceptance targets, not claims about the deployed service. See `patches/collector-indexer/README.md` for applying the backend patch and `docs/personal-collection-performance.json` for local SQL measurements and production validation.

Add rarity sorting, Type/Color filters, and search to `/collector/:address`. Queries must cover the entire collection while transferring and rendering only one small page. Start with rarity, traits, and exact token ID search; deliver name search after its database query passes the same performance checks.

**1. Confirm the backend contract and establish a baseline**

The ownership/rarity indexer is an external service, as documented in the repository README. Its implementation, existing indexes, cursor guarantees, and supported owner-query parameters must be inspected in that service before finalizing migrations. The frontend client currently exposes only chain, visibility, limit, and cursor for owner reads; this does not prove what the deployed backend supports.

Relevant existing code:

- `apps/yunipals-home-web/src/pages/collector/page.tsx`: 24-item infinite query, 30-second polling, visible/hidden views, and immediate purchase updates.
- `apps/yunipals-home-web/src/lib/yunipalsIndexer.ts`: owner API client, token data, rarity helpers, and trait metadata.
- `apps/yunipals-home-web/src/components/CollectionFilters.tsx`: reusable trait controls and mobile drawer patterns; Type and Color already have display priority.
- `packages/yunipals-market-core/src/collectionFilters.ts`: existing trait serialization and sorting vocabulary.
- `apps/yunipals-home-web/src/pages/collector/hooks/useTokenVisibility.ts` and `src/lib/marketplace/confirmedSettlements.ts`: cache updates that must remain correct after pagination changes.

Record current API/database latency, response size, largest wallet sizes, and request counts on page load and refresh. Inspect the owner endpoint's current ordering, current-lifecycle metadata joins, burned-token rules, ENS resolution across chains, and visibility semantics. Verify actual Type/Color names and values from indexed metadata.

**2. Define the user-visible behavior**

- Sort by rarity descending or ascending, defaulting to descending. Match the rarity shown on token cards, including the capped/raw fallback. Unknown rarity sorts last in either direction.
- Allow multiple Type and Color selections: OR within a trait, AND between traits. Filters also apply in the existing hidden view. Include the existing chain selector so identical token IDs across chains are understandable.
- Treat digits or `#123` as an exact token ID, returning matching holdings across selected chains. Keep token IDs as decimal strings rather than JavaScript numbers.
- Add case-insensitive name-prefix search in the second increment, with a two-character minimum and an indexed query. Label this behavior clearly. Substring/fuzzy search is outside the initial scope.
- Keep applied filters and sorting in the URL. A change resets pagination; Back/Forward restores the corresponding filter state. Mobile filters use a draft and one Apply action.
- Show selected filters, Clear filters, loading/error states, and a distinct “No matches” state. Existing profile statistics continue describing the whole collection.
- Initially display “Showing N results on this page.” Exact filtered totals are optional and must pass a separate count-query benchmark; never present the wallet's total holdings as the number of matches.

**3. Extend indexed owner queries**

The implementation adds `/v2/owners/:owner/tokens`, retaining existing ownership, ENS, and visibility behavior. Do not switch to the generic tokens endpoint until equivalent behavior has been proven. Preserve existing callers' default behavior and send an explicit sort from the new UI.

Add validated chain selections, Type/Color selections, sort, and exact token ID. Introduce name-prefix search only after its index and query plan are verified. Reuse shared filter vocabulary through a collector-specific subset; marketplace price and sale parameters do not belong in this query.

Use parameterized SQL, a sort allowlist, and bounded inputs: the UI requests 24 items; proposed API maximum is 48, at most four chains, at most 20 values per trait, and at most 80 search characters. Reject malformed or unsupported filters instead of silently returning unfiltered holdings.

Apply ownership, current lifecycle, visibility, and trait predicates before pagination. Query `limit + 1` rows to establish whether another page exists. Return opaque next/previous cursors using the sort value, explicit null state, chain/collection identity, and numeric token ID as stable tie breakers. Bind cursors to normalized owner resolution, visibility, filters, sort, and contract version; validate that binding server-side. Reject incompatible cursors with a recoverable restart response.

Use keyset pagination rather than an offset into all matching rows. Implement reverse traversal with the inverse ordering, reversing the small returned page for display. Stable tie breakers prevent ambiguity when rarity values match. Keyset pagination alone does not provide snapshot isolation: if ownership or metadata changes during traversal, offer a refresh from page one and define the service's cursor-expiry behavior explicitly.

Inspect existing indexes before adding any. Candidate access paths are owner/current-token lookup, numeric token ID lookup, current-lifecycle trait membership, and owner plus the effective rarity order where the schema permits it. Use indexed trait relations and existence checks instead of expanding every token's metadata JSON per request. If rarity lives in a joined table, measure the owner-bounded join and sort before considering a maintained projection. Do not invent a composite index spanning separate tables.

For name search, normalize the searchable name during metadata ingestion and use an index compatible with the chosen prefix comparison and collation. Escape wildcard input. Measure broad prefixes as well as selective ones. Avoid per-item RPC, external metadata fetches, and per-item SQL queries in this read path. Preserve the indexer's existing ENS cache so typing does not repeatedly resolve the same name.

Validate page, reverse-page, and optional count queries with `EXPLAIN (ANALYZE, BUFFERS)` on representative data. Index column order depends on actual equality and ordering predicates; choose it from those plans. See the [PostgreSQL multicolumn index guidance](https://www.postgresql.org/docs/current/indexes-multicolumn.html).

**4. Keep frontend work bounded**

Replace accumulating Load more results with cursor-based Previous/Next navigation, retaining the 24-card grid. This is the proposed UX tradeoff for a fixed rendering and memory budget. Users can still traverse every holding; no arbitrary collection-size cutoff is introduced.

Create a page-specific query hook using the existing React Query dependency. Key requests by owner, visibility, canonical filters/sort, and cursor. Keep the existing owner-token key prefix for invalidation, but migrate every cache reader/writer from `InfiniteData` to the new page shape. Check settlement reconciliation as well as the visibility hook.

Debounce text search by 300 ms; Enter commits immediately. Pass the existing abort signal through fetch and cancel superseded reads. Keep drafts separate from committed filters so typing does not rebuild the grid. Responses from an older key must never populate a newer filter or wallet view. On owner/visibility changes, do not show previous-view placeholders. On other changes, clearly mark retained results as updating and disable actions until they match the committed view.

Remove the collection's unconditional 30-second polling. Use a 30-second freshness window, stale refresh on focus/reconnect, and explicit refresh after ownership/visibility changes. Only the active page refetches; invalidate inactive pages without eagerly fetching them. Keep profile-stat refresh independent of filter changes. This addresses the current infinite-query behavior, where a refetch visits loaded pages sequentially. See [TanStack's infinite-query documentation](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries).

Retain at most five collector token-page responses across filter variants, protecting the active query and evicting the least recently used inactive entries. Give inactive pages a short expiry, initially 60 seconds. Expiry alone is not a hard cache limit; explicitly verify eviction under rapid filtering. Re-fetch an evicted page using its cursor rather than retaining its token objects. Do not prefetch every page.

Reuse cached collection-wide Type/Color option lists, initially with a ten-minute freshness window. Suppress global occurrence counts in the personal-collection controls, since they are not wallet counts. Do not request new facets on every selection or calculate them by downloading all holdings. Owner-specific dynamic facet counts can be a later measured enhancement.

Reuse the existing card artwork behavior: fixed aspect ratio, lazy images, async decoding, and only the first six images eager. With 24 mounted cards, virtualization and a new rendering dependency are unnecessary.

**5. Preserve ownership and visibility correctness**

The current purchase overlay appends newly bought tokens to the grid without considering traits or rarity order. Do not append unsynchronized purchases into the new sorted pages. Preserve immediate feedback in a separate, bounded “Recently acquired — updating collection” notice with links; refresh the active page when indexing catches up. Keep settlement synchronization independent of whether a purchase matches the current filters, and preserve the existing bounded reconciliation workflow.

After hide/unhide, immediately remove the token from incompatible cached pages, mark all owner-page variants stale, and refresh only the active page. If the final item on a non-first page disappears, recover to an available previous page or restart cleanly. Reset cursors after mutations when their ordering context may have changed.

Preserve existing visibility permissions and public-view behavior. URL parameters and filter controls must not change who can manage a token. Test ENS owners with different resolved addresses per chain, wallet switching, and purchases/transfers while browsing.

**6. Verify performance and roll out in order**

Use dedicated fixtures for correctness and browser checks, plus the actual indexer database query for performance testing. The collector fixture has 128 tokens and exercises bounded forward/reverse pagination. Passing fixtures is not evidence of production query performance.

Test empty wallets, 24/25-item boundaries, 250, 2,500, and 10,000 holdings, plus the largest observed real wallet size. Cover first and deep pages, reverse traversal, equal/null rarity, multi-chain token IDs, selective and common traits, combined filters, zero matches, broad name prefixes, hidden items, and metadata/ownership changes between pages.

Performance targets and production validation:

- Target warm token-page API p95 below 300 ms and p99 below one second. Production smoke checks are sequential, with pauses between requests, and stop on errors or deadline overruns. Record cold reads separately. Do not run the optional 20-session load workload on production by default; low-rate smoke results do not establish concurrency capacity.
- Warm database page-query p95 below 100 ms; deep-page cost should not grow with the number of preceding pages. Include filtered worst cases and count queries separately, and inspect pool saturation, buffers, and spill behavior.
- One token-page request per committed filter action or page navigation, excluding a bounded retry; no requests per token and no timer-driven token polling while idle. Rapid typing produces a debounced committed request, and obsolete reads are cancelled.
- At most 24 mounted token cards and five retained page responses. Browsing 100 pages and changing filters repeatedly must not produce linear token-cache or DOM growth.
- Search input remains responsive under four-times CPU throttling; no repeated grid-update tasks over 50 ms. Measure page rendering and image requests on a mobile viewport.
- Correctness tests prove filters match holdings beyond the original first page, stable datasets have no duplicates/skipped tokens in either direction, and mismatched/expired cursors recover without silently dropping filters.

Add focused API/client contract tests, filter serialization tests, fixtures with Color/hidden/null-rarity cases, and browser flows for desktop/mobile, history navigation, rapid filter changes, and visibility/purchase updates. Run repository type checks, relevant fixture/marketplace regression tests, and builds. Add the backend query and cursor tests in the external indexer repository.

Deploy backwards-compatible backend support and measured indexes first, then the frontend controls. Keep controls disabled until the API version/capability is confirmed; never fall back to downloading an entire wallet. Observe latency, slow queries, errors, request volume, and indexer ingestion overhead during rollout. Stop rollout if bounded core checks fail or hit the SQL deadline. Record slower large-wallet reads explicitly rather than claiming the aspirational 300 ms target passed. Keep optional name search disabled if it misses the deadline.

Deliver in three reviewable increments: backend contract/indexes with benchmarks; bounded collector UI with rarity, Type/Color, and token ID search; indexed name-prefix search. The external indexer is the main implementation dependency, and its inspection is the first required step.

Production validation found that the large public sample needs roughly 0.5–0.65 seconds for rarity pages. Core filters and pagination passed their checks; name-prefix search remains disabled because broad prefixes exceeded the one-second query deadline. There is no staging requirement and no production concurrency stress test.
