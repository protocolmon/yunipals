# Yunipals marketplace API

Node.js service for Seaport order validation, listing discovery, fulfillment
preparation, reconciliation and collection/activity reads. Ethereum, Base and
Polygon integrate OpenSea services. BNB Chain serves orders reconstructed from
Seaport validation events; the Yunipals production feed has been live since
24 September 2026. Production rejects private signed-order publication.

## Configuration

Start from [.env.example](.env.example). The API reads exported environment variables;
it does not automatically load that file. The configuration parsers in
[src/environment.ts](src/environment.ts) and the worker environment modules define
supported options and validate the selected deployment mode.

Use a dedicated marketplace database. Runtime credentials must be separate from
the migration owner. Optional `MARKET_INDEXER_DATABASE_URL` uses a separate
SELECT-only account for direct indexer reads. Never reuse indexer write credentials.
Provider and RPC credentials belong in your private deployment configuration.

For generation-backed indexer search, set `YUNIPALS_PROJECTION_MODE=generation`
on the marketplace API only after the indexer has installed and seeded its
`metadata_projection` schema. Grant the direct source role with
`scripts/grant-projection-read.sql`. If catalog reads use postgres_fdw instead
of `MARKET_INDEXER_DATABASE_URL`, install
`scripts/migrate-projection-fdw.sql` on the marketplace database and grant the
runtime role there. The catalog holds one generation ID for each retained source
snapshot.

```sh
pnpm typecheck
pnpm build
pnpm start
```

Worker entry points have separate `start:*` scripts in `package.json` and must be
configured and supervised independently. API startup does not apply migrations.
Production admission checks require healthy workers and appropriate policy/scope
configuration; a successful build alone does not enable order admission.

## BNB on-chain order discovery

Set `MARKET_BNB_DISCOVERY_START_BLOCK` on the **marketplace worker** to the BNB
block at or before the first on-chain Seaport publication you intend to support.
Apply migrations through 24 with the schema owner and run the updated
`scripts/grant-runtime.sql` for the worker/API role first. Use the existing
budgeted BNB RPC configuration; publication logs use the source workload and
counter/status reads use the order-projection workload. Keep provider keys on
the server. One database advisory lock prevents duplicate scans across worker
replicas. Omitting the launch block disables the worker, while the API reports
partial coverage and an empty feed.

The worker scans finalized `OrderValidated` events for this collection, starting
at the configured launch block or the safe 30-day active-order boundary. It
stores immutable publication terms, a scan cursor and current Seaport status in
Postgres. Its policy fingerprint forces a rebuild if collection, currency, fees,
duration or policy version changes. Another operator can rebuild the derived
tables from the same public event stream with its own RPC and database; no
order API requests make RPC calls. Only immediately active, fixed-price,
single-NFT orders with a duration up to 30 days are included. Older existing
orders, delayed starts and longer orders are outside this feed.

`GET /v1/market/bnb/discovered-orders` returns up to 25 recent orders and
coverage/freshness metadata. Optional `tokenId` and `maker` filters narrow the
result; pass `nextCursor` back as `cursor` to page through the feed.
`coverage: partial` means the feed is incomplete or stale, so an empty
response is not evidence that no orders exist. Each order has a separate
`protocolStatus`; `unavailable` means its state observation is stale. The feed
defaults to preview mode on a fresh installation. After the documented
[rollout gates](../../docs/bnb-onchain-rollout.md), switching the discovery
cursor to live makes normal BNB reads and trading use validated orders. The web
app publishes with a maker-wallet Seaport
`validate` transaction and no private order-submission POST.

Collection ownership and lifecycle in the response can come from the public
[BNB ownership worker](../yunipals-indexer/README.md). It does not use
the server's private metadata packages. A full four-chain site needs additional
metadata and ownership sources for the other chains.

## Isolated tests

Run from this directory. The following database is disposable and uses local-only
test credentials. Do not point test variables at production.

```sh
docker run -d --name yunipals-market-test -p 127.0.0.1:55436:5432 \
  -e POSTGRES_USER=market_test_owner -e POSTGRES_PASSWORD=local-test-only \
  -e POSTGRES_DB=yunipals_market_test postgres:16
export MARKET_TEST_DATABASE_URL=postgresql://market_test_owner:local-test-only@127.0.0.1:55436/yunipals_market_test
export MARKET_TEST_RUNTIME_DATABASE_URL=postgresql://market_test_runtime:local-runtime-test-only@127.0.0.1:55436/yunipals_market_test
# Wait for pg_isready in the container before migrating.
MARKET_DEPLOYMENT=staging MARKET_DATABASE_URL="$MARKET_TEST_DATABASE_URL" pnpm db:migrate
docker exec -i yunipals-market-test psql -X -U market_test_owner \
  -d yunipals_market_test -v ON_ERROR_STOP=1 < scripts/init-test-role.sql
docker exec -i yunipals-market-test psql -X -U market_test_owner \
  -d yunipals_market_test -v ON_ERROR_STOP=1 -v market_runtime_role=market_test_runtime \
  < scripts/grant-runtime.sql
pnpm test
```

Optional `test:*:fork` scripts require additional isolated Anvil/provider fixtures;
read each script's required variables and identity checks before running.
`pnpm test:bnb:validated-fork` specifically requires two empty PostgreSQL 16
databases named `yunipals_bnb_fork_a` and `yunipals_bnb_fork_b`, exposed on
different loopback ports with different owner credentials. Set
`MARKET_TEST_DATABASE_URL_A` and `MARKET_TEST_DATABASE_URL_B` to those databases.
Start an isolated Anvil BNB fork on `127.0.0.1:18647` and set
`MARKET_TEST_FORK_RPC` if its port differs. The script rejects non-loopback
targets, verifies that B's credentials cannot access A, and uses only public
test wallet keys. It verifies a historic mint receipt via the BNB public
dataseed, then tests real Seaport validation, listing purchase, cancellation,
replacement and WBNB offer acceptance. Each installation rebuilds and serves
the resulting orders from its own database; B's first rebuild runs after A's
database pool is closed. Two separate HTTP API processes serve the same listing,
and B continues after A stops. Only the isolated fork receives transactions.
The focused browser wallet check runs separately with
`pnpm --filter @protopals/yunipals-home-web test:marketplace:ui --onchain-only`
against a local fixture web server and fork; it does not require a persistent
staging system. The legacy opt-in remote test harness is not part of the BNB
rollout; no remote test deployment or server is required.

Production operational runbooks, backups and incident evidence are maintained
privately outside this source repository.
