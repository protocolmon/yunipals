# Independent BNB marketplace installation

The BNB orderbook is derived from public Seaport `OrderValidated` events. An
operator can rebuild it without a Yunipals API, database export, or private
indexer package. The public BNB indexer supplies ownership and lifecycle; the
marketplace worker supplies publications and status; the API serves the resulting
reads and prepares transactions. Use Node.js 24, pnpm 9, PostgreSQL 16, and an
operator-owned BNB RPC connection. Keep RPC keys and PostgreSQL passwords on
the server.

This recipe covers the **BNB marketplace**. The web app's collection artwork,
rarity, profiles, and Ethereum/Base/Polygon pages also call the
[collection indexer API](../apps/yunipals-indexer/README.md), now included in
this repository. To operate the complete website, run that API with its metadata
and chain workers and supply your own OpenSea API access for the three other
chains. The BNB orderbook can run with only the indexer's BNB worker and views.

## One database, separate roles

Create a new PostgreSQL database with three separate login credentials:

- A schema owner to run marketplace migrations and budget policy SQL.
- A `market_runtime` account for the marketplace API and worker. It must not
  own schemas or have indexer write privileges.
- A `bnb_indexer` account that owns only its BNB schema and the BNB-only read
  views. Do not give its password to the API.

Run these from the repository root with your own private environment values:

```sh
pnpm install --frozen-lockfile
DATABASE_URL="$BNB_INDEXER_DATABASE_URL" pnpm --filter @protopals/yunipals-indexer bnb:migrate
DATABASE_URL="$BNB_INDEXER_DATABASE_URL" pnpm --filter @protopals/yunipals-indexer bnb:standalone-views
MARKET_DEPLOYMENT=production MARKET_DATABASE_URL="$MARKET_RUNTIME_DATABASE_URL" \
  MARKET_MIGRATION_DATABASE_URL="$MARKET_OWNER_DATABASE_URL" \
  pnpm --filter @protopals/yunipals-market-api db:migrate
```

`bnb:standalone-views` refuses to replace existing `yunipals_read_v4` views.
For a complete four-chain indexer, use that app's `db:migrate` to create combined
views after Ponder tables exist. As the respective schema
owners, grant the market runtime account `USAGE` and `SELECT` on `bnb_indexer`
and `yunipals_read_v4`, then run
`apps/yunipals-market-api/scripts/grant-runtime.sql` with
`-v market_runtime_role=market_runtime`. Granting indexer writes will make API
startup fail its role safety check.

For production RPC accounting, configure a budget scope in the same marketplace
database with `configure-rpc-compute-budget.sql`. The current API and worker also
initialize the shared OpenSea request-budget coordinator even in a BNB-only
runtime. Configure its scope with `configure-opensea-budget.sql`, give a
separate budget role the permissions in `grant-opensea-budget.sql`, and set
`MARKET_OPENSEA_BUDGET_DATABASE_URL`, `MARKET_OPENSEA_BUDGET_SCOPE`, and
`MARKET_OPENSEA_BUDGET_COORDINATOR_ID` on both API and worker. The coordinator ID
is an operator-generated UUID. Match the scope and coordinator ID in SQL and
environment variables. Use provider allowances appropriate to your account;
the supplied RPC allocation file assumes a one-million-CU daily envelope.

## Start the independent sources

The BNB worker needs its own `DATABASE_URL` and `BNB_RPC_URL`; see its
[configuration](../apps/yunipals-indexer/.env.example). Its default start block
is the collection's first BNB deployment. A full ownership-history replay is
large and may take substantial time and RPC budget. It is **not** part of the
quick local fixture. Check `bnb_indexer.sync_state` before expecting listings
to bind to current token lifecycles.

Configure both marketplace API and worker with the same runtime database URL,
budget scope, BNB RPC, policy, and launch block. For a production installation,
the relevant values are:

```sh
MARKET_DEPLOYMENT=production
MARKET_DATABASE_URL=<market runtime PostgreSQL URL>
MARKET_ALLOWED_ORIGINS=https://<your web origin>
MARKET_TRADING_RPC_BNB=https://<your primary BNB RPC>
MARKET_TRADING_RPC_FAILOVER_BNB=https://<independent BNB RPC host>
MARKET_BNB_DISCOVERY_START_BLOCK=123769700
MARKET_BNB_POLICY_VERSION=bnb-yunipals-native-zero-fee-v1
MARKET_BNB_MAX_DURATION_SECONDS=2592000
MARKET_BNB_POLICY_FEES=[]
MARKET_CAPABILITIES_BNB=read
MARKET_OPENSEA_BUDGET_DATABASE_URL=<budget role PostgreSQL URL>
MARKET_OPENSEA_BUDGET_SCOPE=<your account scope>
MARKET_OPENSEA_BUDGET_COORDINATOR_ID=<your UUID>
```

Start ownership indexing with
`pnpm --filter @protopals/yunipals-indexer start:bnb`. The two marketplace BNB
RPC URLs must use different provider hostnames. An operator-managed
production RPC budget proxy is an alternative; see the environment parser for
its fixed loopback endpoint. Keep `MARKET_BNB_DISCOVERY_START_BLOCK` stable
across restarts. Set it at or before the first publication you wish to support;
older orders are not imported automatically.

Build and supervise the API and BNB worker as separate processes:

```sh
pnpm --filter @protopals/yunipals-market-api build
pnpm --filter @protopals/yunipals-market-api start
pnpm --filter @protopals/yunipals-market-api start:worker
```

The worker starts discovery in `preview` on a fresh database. Once it has
complete coverage and the ownership indexer has caught up, follow the
[live-switch gates](bnb-onchain-rollout.md). Executable buy/list/offer actions
require explicit capabilities and the owner trade authorization schedule in
`src/environment.ts`; leave them disabled while proving an independent read
setup. Do not copy another operator's authorization or private RPC key.

## Point the web app at your services

Set these public build-time values and build the web app:

```sh
VITE_SELF_HOSTED=1
VITE_YUNIPALS_MARKETPLACE_URL=https://<your marketplace API base URL>
VITE_YUNIPALS_INDEXER_URL=https://<your indexer API base URL>
VITE_WALLETCONNECT_PROJECT_ID=<your public Reown project ID>
pnpm --filter @protopals/yunipals-home-web build
```

`VITE_SELF_HOSTED=1` makes the build fail if either service URL is missing or
points to a Yunipals domain. This prevents the web app's ordinary default
indexer URL from silently introducing a Yunipals dependency. Serve the `dist`
directory with SPA rewrites. If you are only verifying the BNB orderbook, the
web app's local synthetic fixture can exercise UI routes without any paid
service, but it is not proof of a complete live metadata service.

## Read-only checks

Check the runtime role, indexer cursor, API readiness, and discovery coverage
using your own hostnames:

```sh
psql "$MARKET_RUNTIME_DATABASE_URL" -c 'SELECT current_user'
psql "$BNB_INDEXER_DATABASE_URL" -c 'SELECT last_scanned_block,caught_up_at FROM bnb_indexer.sync_state'
curl -fsS 'https://<your marketplace API base URL>/health/ready'
curl -fsS 'https://<your marketplace API base URL>/v1/market/bnb/discovered-orders?limit=1'
curl -fsS 'https://<your marketplace API base URL>/v1/market/capabilities'
```

The response must report `mode: live` and `coverage: complete` before treating
an empty order list as complete. An independent local integration fixture for
the indexer's BNB worker and the marketplace API suite are documented in
their respective READMEs. Those use disposable data and never send a real
order. A fresh public Seaport-log replay and the isolated two-installation fork
check are recorded in the [rollout report](bnb-onchain-rollout.md); they do not
substitute for a full live ownership-history replay.
