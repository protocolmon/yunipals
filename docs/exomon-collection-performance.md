# Exomon branch collection performance

The combined collection waits for both the EVM and Solana pages before merging
their rarity order. The initial EVM page took 11.6 seconds; Solana took 0.29
seconds. This delay did not involve chain RPC.

On 7 October 2026, `EXPLAIN (ANALYZE, BUFFERS)` against the current indexed data
showed PostgreSQL spending 10,720 ms compiling 881 JIT functions. The same query
with JIT disabled executed in 30.5 ms, plus 108.6 ms planning. Its existing rarity
indexes and bounded metadata lookups were already efficient.

The interactive API pool now disables JIT at connection startup. It preserves
other connection-string or `PGOPTIONS` settings; the worker pool keeps its
original settings. Queries, visibility checks, live ownership reads, cursor
semantics and the existing 15-second exact-count cache are unchanged. No page
response cache or extra RPC requests are needed. The frontend loading label now
says “Loading collection…” because it waits for the page as well as the count.

Validation used an isolated API with PostgreSQL read-only transactions and the
same indexed data. The cold first response took approximately 1.1 seconds and
matched the production JSON exactly, including all 24 items, total and cursor.
All six sort orders were exercised across two pages, checking ordering and
duplicates; Base-only and Solana-only requests were checked separately. Both
TypeScript checks passed, as did 118 indexer unit tests (one pre-existing skip)
and 288 disposable PostgreSQL pagination cases with 25 invalidation cases.

## Branch Preview

The Solana branch Preview uses
`https://api.yunipals.com/yunipals-indexer-solana-preview` as its public indexer
URL. Only its exact `/v1/tokens` route goes to the isolated read-only candidate
API on loopback port 9017. Other routes use the existing API. Its PostgreSQL
connections enforce `default_transaction_read_only=on`.

The candidate runs as `yunipals-exomon-preview-api.service` from a committed
release under `/opt/yunipals/releases/exomon-query-20261007-v1`. The Nginx snippet
is `/etc/nginx/snippets/yunipals-exomon-preview-location.conf`. Runtime overrides
are passed through `ExecStart`'s `env` command because `EnvironmentFile` values
override systemd `Environment` entries, including `API_PORT`.

To retire this candidate, first repoint the branch's Preview indexer URL to the
normal API and redeploy the Preview. Then remove the preview Nginx include,
validate and reload Nginx, and stop/disable the candidate service. Production
API rollout is separate: install the committed backend change and restart its
API service after validating the candidate.
