# Yunipals indexer

This workspace app contains the four-chain collection indexer and its HTTP API.
Ponder indexes Ethereum, Base, and Polygon. **One BNB worker**, at
`lib/bnb/worker.ts`, indexes BNB ownership, lifecycle, transfer, and role events
into `bnb_indexer`. It starts at block 7,579,197 and requires 20 confirmations
by default. No other BNB ownership writer is shipped in this repository.

The metadata worker fetches token documents and the API serves collection,
collector, visibility, trait, and leaderboard reads. The marketplace API is a
separate app and reads the BNB tables and `yunipals_read_v4` views. Neither API
should use the indexer's write credential.

## Local setup

Use Node.js 24.18.1, pnpm 9.12.0, and PostgreSQL 16. Copy `.env.example` into a
private environment file and supply your own database and RPC URLs. Load it in
your shell before running commands; pnpm does not load `.env` automatically.

```sh
pnpm install --frozen-lockfile
pnpm --filter @protopals/yunipals-indexer typecheck
pnpm test:indexer
pnpm --filter @protopals/yunipals-indexer bnb:migrate
pnpm --filter @protopals/yunipals-indexer db:migrate
```

`bnb:migrate` creates the BNB source tables. `db:migrate` creates metadata tables
and combined four-chain read views once Ponder tables exist. For an independent
BNB-only installation, run `bnb:standalone-views` after `bnb:migrate` instead;
it refuses to replace existing read views.

The metadata source migrations and import, backup, restore, status, and
reconciliation commands are available under the `metadata:*` scripts in
`package.json`. Source inventory and import require an explicit `--legacy-root`
path; no server-specific legacy data path is built in. These commands prepare
the PostgreSQL archive source and do not activate archive serving.

Run the processes separately with the same database and compatible RPC settings:

```sh
pnpm --filter @protopals/yunipals-indexer start:indexer
pnpm --filter @protopals/yunipals-indexer start:bnb
pnpm --filter @protopals/yunipals-indexer start:metadata
pnpm --filter @protopals/yunipals-indexer start:leaderboard
pnpm --filter @protopals/yunipals-indexer start:api
```

`start:collector` runs the optional collector-only API on loopback. The main API
also registers collector routes. Keep `API_COLLECTOR_FILTERS_ENABLED=false` until
its read path is verified against your data. `bnb:status` reports the durable
BNB cursor. `BNB_END_BLOCK` can cap a replay. The worker stops on a finalized
cursor hash mismatch and does not treat RPC failures as empty blocks.

The BNB integration fixture requires a **disposable** PostgreSQL database in
`DATABASE_URL`. It creates and drops two isolated test schemas:

```sh
pnpm test:bnb-indexer
```

Do not point this fixture at a database where the test role can alter production
schemas. The unit suite and typecheck do not require a database.

## Metadata and rarity boundary

The September 18 source snapshot, September 21 metadata retry fix, collector
API patch, and September 28 running-checkout comparison are recorded in
[source provenance](SOURCE_PROVENANCE.md). The running checkout defaults to
`METADATA_SOURCE_MODE=legacy-http`; its newer archive reader, renderer, publisher,
main API changes, and local rarity formula depend on private package archives
that are not included here. This app currently supports only
`RARITY_READ_SOURCE=metadata`. Raw and capped scores come from supplied metadata.
`RARITY_READ_SOURCE=local` fails at startup; a locally recalculated rarity score
must be implemented and compared with existing results before enabling that
mode. The old parity script must not be used as evidence of local formula
parity.

Before replacing a running indexer, reconcile this source with its current
checkout, resolve the archive runtime dependency, compare schema and API
responses on a disposable database, replay BNB
from the start block or verify the current cursor and table contents, and check
all four chain and metadata worker checkpoints. This repository change does not
switch any production process or database.

See the [BNB self-hosting guide](../../docs/self-hosting-bnb.md).
