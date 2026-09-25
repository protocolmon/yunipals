# Personal collection indexer patch

The ownership indexer is external to this repository. This patch adds collector capabilities, bounded owner pages, query tests, a standalone collector server, and an optional name-prefix index. Its baseline is the production **on-disk** source inspected on 22 September 2026.

The running legacy API predates that source. Do not restart it merely to install this feature: doing so would activate unrelated pending metadata changes. This rollout uses a separate loopback collector process and routes only the two new endpoints to it. It uses the same database and runtime metadata mode as the existing API.

## Source installation

With Node 24, against a separate copy of the inspected source:

```sh
node scripts/apply-collector-indexer-patch.mjs /path/to/indexer --check
node scripts/apply-collector-indexer-patch.mjs /path/to/indexer
```

The installer checks original source hashes, new-file collisions, and the patch hash. A different baseline requires a rebase. It does not install dependencies, migrate tables, restart services, or enable features. The patch also registers the routes in the main API for a future coordinated release; the standalone entry point is `lib/api/collector-server.ts`.

## Query and resource limits

`/v1/collector-capabilities` advertises support. `/v2/owners/:address/tokens` reads 24 items by default, at most 48. Cursors bind owner resolution, filters, visibility, sort, and page size and expire after 15 minutes. Sorting has numeric ID tie breakers and keeps unknown rarity last in both directions. Inclusive `rarityMin`/`rarityMax` bounds use that same effective score: capped rarity with raw rarity as a fallback. Previous pages use reverse keyset traversal.

Queries use physical owner indexes, current-lifecycle metadata, selective trait predicates, and bounded page enrichment. A conservative count of potentially hidden rows permits a top-N sort without dropping visible results. Hidden reads first select potentially hidden identities. Rarity joins remain correlated to owned tokens; allowing a full projection hash join was slower on production. Read-only transactions have a one-second statement deadline, JIT disabled, and 16 MB work memory. The standalone service uses a four-connection pool with a one-second acquisition timeout and binds only to `127.0.0.1`.

Archive-mode reads reuse the indexer's publication and mint-anchor validation and chain-recovery checks. When migrating metadata mode, update the collector service's shared environment along with the main API and repeat its read checks.

## Verification

Run the external indexer's typecheck and tests. SQL integration is isolated from production:

```sh
COLLECTOR_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js \
COLLECTOR_BENCHMARK=1 npm test
```

The SQL fixture traverses 423 pages in a 100,140-token dataset. It tests forward/reverse ordering, equal/null scores, current ownership visibility, more than a page of hidden results, exact IDs, and escaped name prefixes. Results go to `/tmp/yunipals-collector-sql-benchmark.json` unless overridden by `COLLECTOR_BENCHMARK_OUTPUT`.

## Production checks and rollout

There is no staging environment. Use sequential read-only checks on production, with pauses, and stop on unexpected errors or deadline overruns. Keep the standalone endpoint private until those checks pass. Deploy backend routes before the web controls. Do not run a concurrency load test against live users by default.

Feature switches are disabled by default in code:

- `API_COLLECTOR_FILTERS_ENABLED=true`: rarity, Type/Color/chain filters, and exact token IDs.
- `API_COLLECTOR_RARITY_RANGE_ENABLED=true`: inclusive effective-rarity ranges; enable after bounded production reads pass.
- `API_COLLECTOR_NAME_SEARCH_ENABLED=true`: name prefixes; keep this disabled until its index and actual query pass production checks.

The optional `scripts/collector-read-indexes.sql` creates the metadata name-prefix index concurrently, outside a transaction. Inspect index validity after a cancelled build; `IF NOT EXISTS` does not repair an invalid index. It does not change Ponder-managed tables. The owner and trait indexes already exist.

The HTTP benchmark defaults to one session for 60 seconds, one read every five seconds:

```sh
node scripts/benchmark-collector-api.mjs --url http://127.0.0.1:9012 --owner 0xYOUR_TEST_WALLET
```

Concurrent or extended runs require explicit `--load`; they are not a release requirement on production. A small smoke run does not prove sustained capacity. See `docs/personal-collection-performance.json` and the production rollout record for measured results and limitations.

## Rollback

Set either feature switch to `false` in the collector service environment and restart **only** `yunipals-collector-api`. Capability version zero makes the web app use legacy collection browsing after capabilities refresh/reload. Removing only the collector Nginx include returns the original routing. Restore the recorded previous Vercel deployment and its frontend-monitor manifest together when rolling back the web app. Preserve the existing indexer and marketplace services.
