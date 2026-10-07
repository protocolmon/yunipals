# Yunipals indexer

This workspace app contains the EVM collection indexer, the Exomon Solana
snapshot worker, and their HTTP API.
It also indexes the Ethereum Islands collection as `ethereum-islands`, with
separate metadata publication and collection-scoped v2 reads. See the
[Islands rollout guide](../../docs/islands-indexing.md) for candidate replay,
full ownership verification, worker setup, read grants and activation.
Ponder indexes Ethereum, Base, and Polygon. **One BNB worker**, at
`lib/bnb/worker.ts`, indexes BNB ownership, lifecycle, transfer, and role events
into `bnb_indexer`. It starts at block 7,579,197 and requires 20 confirmations
by default. No other BNB ownership writer is shipped in this repository.

The metadata worker supports `METADATA_SOURCE_MODE=legacy-http` and `archive`.
Archive mode serves published snapshots from PostgreSQL and uses the pinned
Polkamon packages in `vendor/` for rendering and local rarity calculation. The
API serves collection, collector, visibility, trait, and leaderboard reads. The
marketplace API is a separate app and reads the BNB tables and
`yunipals_read_v4` views. Neither API should use the indexer's write credential.
The Solana worker uses Helius DAS only for current ownership, burn and
delegation observations of the archived Exomon mint set. It publishes bounded
snapshots to PostgreSQL; API reads and browser traffic make no Helius requests.

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

The trait/search projection supports `YUNIPALS_PROJECTION_MODE=legacy` (the
default) and `generation`. Install its additive tables with `projection:migrate`
after the normal migrations, then stop the old trait worker and run
`projection:seed` against the current published snapshot. Switch both indexer
APIs and the marketplace catalog to `generation` before restarting the worker
in that mode. `projection:rollback` atomically selects the protected previous
generation if the current one is bad; it rejects a previous generation from an
obsolete metadata release. Never run the old trait worker after generation
readers are enabled.

After the normal schema migrations, run `api:proof-indexes` with a schema-owner
credential to install concurrent covering indexes for publication, mint,
lifecycle, revision and count reads. It has a 15-minute deadline per index and
can wait for older snapshots, including backups and projection builds. It
validates every index and safely resumes its own interrupted concurrent build.
Run it again after recreating the physical Ponder schema. API readers retain
read-only credentials.

Run `api:maintenance` as the schema owner to lower the vacuum/analyze threshold
to 2% on the lifecycle and metadata proof tables and disable vacuum truncation
on those tables and their TOAST storage. This keeps index-only proof reads useful
as rows change. It has a one-second lock deadline and can be safely retried.
If existing visibility maps are sparse, run a cost-limited
`VACUUM (ANALYZE, TRUNCATE FALSE)` on those tables before measuring performance.

`test:rarity:postgres` requires a disposable loopback PostgreSQL database named
`yunipals_rarity_test`. It recreates its fixture schemas and checks rarity
pagination against the original validated reader across missing metadata,
null scores, stale proofs, visibility, ownership, traits and numeric ties.

Generation builds check free space on the PostgreSQL filesystem before writing.
`PROJECTION_MIN_FREE_BYTES` defaults to 25 GB and
`PROJECTION_BACKUP_PEAK_BYTES` defaults to 65 GB until the backup peak has been
measured and reduced. `PROJECTION_STORAGE_PATH` can identify the database
filesystem when it is mounted at a different path on the worker host. The
test-only capacity bypass requires a loopback database named `*_test`.

The metadata source migrations and import, backup, restore, status, and
reconciliation commands are available under the `metadata:*` scripts in
`package.json`. Source inventory and import require an explicit `--legacy-root`
path; no server-specific legacy data path is built in. An archive release must
be imported, bound, validated, and activated before starting the API or worker
with `METADATA_SOURCE_MODE=archive`. Set the mode consistently for the API,
metadata worker, and leaderboard worker. `legacy-http` remains the default.

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

## Exomon on Solana

The fixture website works without Solana setup. For live indexing, import,
bind, validate and activate a `metadata_source` archive containing the Exomon
mint mappings. The archive and production database are not included with the
source. Supply `HELIUS_API_KEY` only to the Solana worker's private environment.
Keep `SOLANA_SYNC_ENABLED`, `SOLANA_API_ENABLED` and
`SOLANA_LEGACY_METADATA_ENABLED` as separate controls. The API needs no Helius
credential. Audit the manifest without RPC before any provider call:

```sh
pnpm --filter @protopals/yunipals-indexer solana:manifest:audit
```

Apply `solana:migrate` with the intended schema owner, run an initial controlled
`solana:sync`, and inspect `solana:status` before enabling the Solana API. The
worker defaults to a 15-minute scan using ten DAS batches for a 10,000-mint
manifest. It reserves credits before provider calls and enforces per-scan,
UTC-day and rolling-31-day caps. `solana:preflight` itself uses provider credits;
it is not a frontend smoke test. Unknown current ownership is reported as
unavailable, never inferred as a burn or assigned to a historical owner. See
the [operator runbook](docs/exomon-solana-rollout.md) for health, exception and
rollback details.

The PostgreSQL integration check writes only to a disposable loopback database
whose name starts with `exomon_test_`. It seeds synthetic mints and observations,
publishes snapshots and exercises Solana API queries without using Helius:

```sh
EXOMON_TEST_DATABASE_URL=postgresql://localhost/exomon_test_local pnpm test:solana:postgres
```

## Metadata and rarity

The September 18 source snapshot, September 21 metadata retry fix, collector
API patch, and September 28 running-checkout comparison are recorded in
[source provenance](SOURCE_PROVENANCE.md). Active production service configuration
sets `METADATA_SOURCE_MODE=archive` and `RARITY_READ_SOURCE=local`. Its archive
reader, renderer, publisher, main API changes, and local rarity formula are
included here with the pinned package archives. `RARITY_READ_SOURCE=metadata`
uses scores supplied in metadata; `RARITY_READ_SOURCE=local` reads the locally
recalculated scores, falling back to supplied scores where a calculation is not
valid. The renderer and scorer have deterministic fixture tests; compare live
release and response parity before replacing a production process.

Before replacing a running indexer, compare schema and API responses on a
disposable database, replay BNB
from the start block or verify the current cursor and table contents, and check
all four chain and metadata worker checkpoints. This repository change does not
switch any production process or database.

See the [BNB self-hosting guide](../../docs/self-hosting-bnb.md).
