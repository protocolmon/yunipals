# Yunipals indexer

One managed service runs the Ponder EVM indexer and the Solana snapshot worker. Ponder indexes Ethereum, Base, Polygon and BNB, including the configured collection, Islands, marketplace and Arena sources. Both children start together; a fatal child exit stops the service so its supervisor can restart it.

## Setup

Use Node 24, pnpm 9.12 and Bash 4.3 or newer on Linux or macOS (WSL on Windows). On macOS, install a current Bash and put it on PATH. Install PostgreSQL with its client tools before starting. The database and RPC setup below is required once per installation. The Solana database also needs its metadata archive and Exomon manifest; startup preserves these records.

From the repository root:

```sh
node --version
corepack enable
pnpm install --frozen-lockfile
cp apps/yunipals-indexer/.env.example apps/yunipals-indexer/.env
cp ops/unified-indexer/solana.env.example apps/yunipals-indexer/.env.solana
cp ops/unified-indexer/service.env.example ops/unified-indexer/.env.service
chmod 600 apps/yunipals-indexer/.env apps/yunipals-indexer/.env.solana
```

Fill in both private child files and the public service settings. For a new Solana database, install its schema with the database owner before assigning the runtime role:

```sh
pnpm --filter @protopals/yunipals-indexer exec node --env-file=.env.solana --import tsx scripts/migrate-solana.ts
```

The Ponder runtime creates and maintains its own indexed schema. Choose `UNIFIED_PONDER_SCHEMA` before the first start and keep the same source configuration and schema on restart. Use a database role with the required schema permissions. Application APIs, metadata, caches and transaction workers retain their own database roles and private configuration.

## Database and RPC prerequisites

For a new local source database, create a restricted database owner and database. Put its connection in the private Ponder file. Use separate roles for application readers and operational workers.

```sh
sudo -u postgres createuser --pwprompt --no-superuser --no-createdb --no-createrole indexer
sudo -u postgres createdb --owner=indexer yunipals
```

The RPC coordinator uses the marketplace schema in a separate configured coordinator database. Set up its owner connection and deployment (`staging` or `production`) using [the owner env example](../../ops/unified-indexer/rpc-owner.env.example), then apply the repository schema:

```sh
pnpm --filter @protopals/yunipals-market-api exec node --env-file=/absolute/rpc-owner.env --import tsx src/migrate.ts
```

For a **new scope**, use the owner-only SQL templates [configure-opensea-budget.sql](../yunipals-market-api/scripts/configure-opensea-budget.sql) and [configure-rpc-compute-budget.sql](../yunipals-market-api/scripts/configure-rpc-compute-budget.sql). Configure a private libpq service called `yunipals-rpc-owner` for that same database. Supply the public scope, coordinator UUID and request limits from the provider account; do not substitute a different scope for each API key. The compute template sets a one-million-CU daily ceiling with a 200,000-CU foreground reserve. Inspect those values against the account allowance before using it. These templates update existing rows, so skip them for an already configured scope.

```sh
psql 'service=yunipals-rpc-owner' -v ON_ERROR_STOP=1 \
  -v budget_scope="$RPC_SCOPE" -v coordinator_id="$RPC_COORDINATOR_ID" \
  -v all_per_hour="$RPC_ALL_PER_HOUR" -v fulfillment_per_minute="$RPC_FULFILLMENT_PER_MINUTE" \
  -v publication_per_hour="$RPC_PUBLICATION_PER_HOUR" \
  -f apps/yunipals-market-api/scripts/configure-opensea-budget.sql
psql 'service=yunipals-rpc-owner' -v ON_ERROR_STOP=1 \
  -v budget_scope="$RPC_SCOPE" -v budget_enabled=true \
  -f apps/yunipals-market-api/scripts/configure-rpc-compute-budget.sql
```

Add the two indexer workloads with explicit operator-chosen limits. The first command inspects current policy and prints `reviewHash`; repeat it with `--apply` and that exact hash. This bootstrap only inserts missing `unified_source` and `unified_evidence` background allocations. It refuses different existing values, never raises global caps, and never resets usage. Both workloads continue sharing the existing global ceiling with other consumers.

```sh
pnpm --filter @protopals/yunipals-market-api exec node --env-file=/absolute/rpc-owner.env --import tsx \
  scripts/configure-unified-rpc-allocations.ts --scope "$RPC_SCOPE" \
  --source-cu "$RPC_SOURCE_DAILY_CU" --evidence-cu "$RPC_EVIDENCE_DAILY_CU"
# Repeat the same arguments with: --apply 0x<reviewHash>
```

After finalizing optional Ponder source settings in `.env`, generate the exact source profile:

```sh
pnpm --filter @protopals/yunipals-indexer exec node --env-file=.env --import tsx \
  scripts/unified-rpc-profile.ts --scope "$RPC_SCOPE" --coordinator-id "$RPC_COORDINATOR_ID" \
  --output "$PWD/ops/unified-indexer/rpc-profile.json"
```

This prints `profileId` and writes a draft; it does not approve paid requests. Create an absolute policy input JSON file with exactly `{ "profile": <the generated JSON object>, "expiresAt": <UTC ISO timestamp>, "permits": [...] }`. The [policy review command](../yunipals-market-api/scripts/review-unified-rpc-policy.ts) validates the expiry and each explicit replay permit's chain, block range, maximum CU and expiry. Inspect it first, then repeat with the returned `--apply 0x<reviewHash>`:

```sh
pnpm --filter @protopals/yunipals-market-api exec node --env-file=/absolute/rpc-owner.env --import tsx \
  scripts/review-unified-rpc-policy.ts --file /absolute/rpc-policy.json
```

Grant the dedicated proxy role access with [grant-opensea-budget.sql](../yunipals-market-api/scripts/grant-opensea-budget.sql), supplying `market_budget_role` through psql. Build and run one proxy per chain with its own private upstream/budget env plus the [public profile selectors](../../ops/unified-indexer/rpc-consumer.env.example):

```sh
pnpm --filter @protopals/yunipals-market-api build
pnpm --filter @protopals/yunipals-market-api exec node --env-file=/absolute/rpc-chain.env dist/rpc-budget-proxy.mjs
```

Each proxy env needs `MARKET_OPENSEA_BUDGET_DATABASE_URL`, `MARKET_OPENSEA_BUDGET_SCOPE`, `MARKET_OPENSEA_BUDGET_COORDINATOR_ID`, `MARKET_RPC_PROXY_UPSTREAM`, `MARKET_RPC_PROXY_PORT`, `MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE`, `MARKET_RPC_PROXY_UNIFIED_PROFILE_ID` and `MARKET_RPC_PROXY_CHAIN_ID`. Bind the four proxies to `127.0.0.1` on ports 19201/19202/19203/19204 for chains 1/8453/137/56. Keep upstream credentials private. Put the same absolute profile path, returned profile ID and replay permit IDs in Ponder's `.env`, then check them before starting:

```sh
pnpm --filter @protopals/yunipals-indexer exec node --env-file=.env --import tsx scripts/unified-rpc-preflight.ts
```

## Optional application readers

Starting ingestion does not select or authorize application readers. After Ponder has created its schema and is synchronized, the existing source-owner CLI can create control tables, register the actual schema/build and create immutable V5 read views:

```sh
pnpm --filter @protopals/yunipals-indexer exec node --env-file=/absolute/source-owner.env --import tsx scripts/unified-control.ts migrate
pnpm --filter @protopals/yunipals-indexer exec node --env-file=/absolute/source-owner.env --import tsx scripts/unified-control.ts register
pnpm --filter @protopals/yunipals-indexer exec node --env-file=/absolute/source-owner.env --import tsx scripts/unified-ownership-views.ts
```

The owner file needs `UNIFIED_INDEXER_DATABASE_URL`, the chosen `UNIFIED_INDEXER_SCHEMA`, the actual Ponder `UNIFIED_INDEXER_BUILD_ID`, then the returned `UNIFIED_INDEXER_RELEASE_ID` and a distinct `UNIFIED_INDEXER_READ_SCHEMA`. Registration checks the actual Ponder build; read-view creation does not publish the release or grant reader access.

The [support-worker env](../../ops/unified-indexer/support.env.example) and [grant template](../../ops/unified-indexer/grant-unified-support.sql.example) describe the separate canonical-observation/receipt worker. [Ownership consumer selectors](../../ops/unified-indexer/ownership-consumer.env.example) describe API/metadata read selection. Native Base metadata has explicit `native-adopt` and `native-refresh` commands in [unified-base-metadata.ts](scripts/unified-base-metadata.ts); these require the configured archive/recovery state and source identity, and are not automatic startup actions.

There is currently no general fresh-install CLI that provisions all application roles, metadata archive data, global publication and application-specific grants/selection together. Those inputs must be supplied by the database/application owner before enabling the relevant readers. The available [archive restore command](scripts/backup-metadata-source.ts) accepts `--env-file`, `--release` and `--input`; it requires a real archive backup. An empty Solana schema is not a replacement for that data. The ingestion command remains usable independently of optional application readers once its own database, archive and RPC prerequisites are ready.

## Configuration

| File                                | Contents                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ops/unified-indexer/.env.service`  | Public paths, child directories, Ponder listener/schema and shutdown grace.                                   |
| `apps/yunipals-indexer/.env`        | Ponder database connection, RPC endpoints, profile identity, replay allowances and optional source addresses. |
| `apps/yunipals-indexer/.env.solana` | Solana database connection, Helius key, snapshot interval, missing-asset policy and credit limits.            |

The parent reads only the public service file. Node loads each private file in its own child process. Private file values take precedence over ambient shell credentials because the launcher excludes those credentials from the child environment. Do not put database URLs, provider keys or signer keys in the public service file. The indexer does not need transaction signer keys.

Paths in the public settings file resolve relative to that file; absolute paths are also accepted. Both application directories default to this checkout. Installed deployments can set `YUNIPALS_INDEXER_PONDER_DIRECTORY` and `YUNIPALS_INDEXER_SOLANA_DIRECTORY` explicitly.

Optional Ponder overlay files load after its private base file in this order: `YUNIPALS_INDEXER_PONDER_RUNTIME_ENV_FILE`, `YUNIPALS_INDEXER_PONDER_OVERRIDE_ENV_FILE`, `YUNIPALS_INDEXER_PONDER_REPLAY_ENV_FILE`. Later files override earlier files. Solana receives only its own private file.

RPC policy enforcement stays enabled. Set `UNIFIED_RPC_PROFILE_FILE` and `UNIFIED_RPC_PROFILE_ID` to the profile installed by the budget coordinator and use the four proxy URLs in the example. Historical replay also needs the coordinator's bounded replay allowances. A missing or mismatched profile stops startup. Optional sources must match that profile.

## Collection snapshots and storage

Application snapshot publication uses the existing `yunipals_indexer_control.chain_anchor` table when a build outlives Ponder's short block-header cache. The publisher role needs `SELECT`, `INSERT` and `UPDATE` on that table. It verifies the captured block and a current Ponder witness through the budget proxy before retaining evidence; a conflicting physical block still rejects publication.

Give the publisher the same public `UNIFIED_RPC_PROFILE_ID` as the shared indexer. Set `PROJECTION_ANCHOR_RPC_URL_<chainId>` to each chain's loopback `/unified` URL when its ordinary `PONDER_RPC_URL_<chainId>` serves another purpose. `PROJECTION_ANCHOR_RPC_PROFILE_ID` can select that profile independently. These checks use the `unified_evidence` allocation and preserve the coordinator's daily caps.

Snapshot builds need space for a new generation and private input tables alongside published data. Keep `PROJECTION_MIN_FREE_BYTES` and the configured backup overlap allowance; pointing `PROJECTION_STORAGE_PATH` at an empty disk does not move PostgreSQL data there. If derived relations use a separate PostgreSQL tablespace, mount its volume before PostgreSQL starts and include it in physical backups. PostgreSQL supports moving existing tables and indexes with [`SET TABLESPACE`](https://www.postgresql.org/docs/16/sql-altertable.html), preserving their SQL identity and data. Keep enough space on both filesystems for the move and subsequent builds.

For a full logical restore onto different storage, use `pg_restore --no-tablespaces` to place objects in the target database's default tablespace, or create the intended tablespace locations before restoring. An application metadata archive is separate from a full database backup.

## Start and stop

Run the supported command from the repository root:

```sh
pnpm indexer:start
```

To select an installed configuration:

```sh
pnpm indexer:start --env-file /etc/yunipals-unified/indexer.service.env
```

Logs stream to the terminal. Press Ctrl+C to stop both children. SIGTERM also drains them. The launcher waits up to `YUNIPALS_INDEXER_SHUTDOWN_GRACE_MS` (default 30000) before terminating remaining processes. Restart by running the same command with the same settings.

There is one ingestion entrypoint. BNB and boosters are included by the combined Ponder configuration; they do not have separate supported start commands.

## System service

Install the repository under `/opt/yunipals-unified/indexer`, install its dependencies and make Node 24 available on the service's PATH. Create a `yunipals-indexer` service account with access to its application files, database, private env files and writable `.ponder` directory.

Copy the public settings to `/etc/yunipals-unified/indexer.service.env`, change the child env paths to absolute paths under `/etc/yunipals-unified/`, and keep those private files readable only by the service account. Install `ops/unified-indexer/yunipals-indexer.service.example` as `/etc/systemd/system/yunipals-indexer.service`. Adjust the Node executable and filesystem paths for the host before enabling it.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now yunipals-indexer.service
sudo systemctl status yunipals-indexer.service
sudo journalctl -u yunipals-indexer.service -f
sudo systemctl restart yunipals-indexer.service
sudo systemctl stop yunipals-indexer.service
```

Systemd supervises the same launcher as `pnpm indexer:start` and restarts it after a fatal child exit. `KillMode=control-group` stops the complete service process tree.

A running process is not a synchronization guarantee. Check Ponder's indexed heads and readiness in its logs, and check successful Solana scans and credit-budget status before relying on application reads. Preserve database volumes, metadata archives and private keys across restarts.

## Staking verification

The staking worker verifies custody and wallet membership against a finalized Ethereum block. It reads indexed deposits and makes bounded contract calls; it does not scan chain logs. Owner and membership checks use batches of up to 40 calls against the same canonical block hash.

Set `ISLANDS_STAKING_MAX_TOKENS` to cover the full custody count (maximum 500), keeping `ISLANDS_STAKING_MAX_RPC_CALLS=128` and `ISLANDS_STAKING_MAX_SECONDS=120`. Run the dedicated worker once and require `complete=true` with no unverified deposits before enabling its five-minute timer. It needs its existing restricted database role, source selectors and local RPC proxy.

Build a standalone worker with the installed dependencies:

```sh
pnpm --filter @protopals/yunipals-indexer build:staking-support --outdir /absolute/staking-runtime
```

The output includes a source manifest and requires the `pg` runtime package. Its only command argument is `once`.

The collection publisher libraries can also be built from the current checkout:

```sh
node apps/yunipals-indexer/scripts/build-publication-runtime.mjs --outdir /absolute/publication-runtime
```

The builder records input and output hashes, checks its exported functions, and verifies that the compiled worker includes the statistics refresh before filter generation and vacuum after the build. Keep the generated manifest with the installed libraries and their declared runtime dependencies.

## Local checks

```sh
pnpm test:indexer:service
pnpm --filter @protopals/yunipals-indexer typecheck
```

The service checks use temporary child fixtures and do not contact PostgreSQL, RPC providers or Helius.
