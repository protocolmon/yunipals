# Ethereum Islands indexing

The collection ID is `ethereum-islands`; its network remains `ethereum`, chain
ID `1`. The ERC-721 contract is
`0xa22e2f53ca787414dc0643c399f92234949e2305` ([OpenSea collection](https://opensea.io/collection/yunipals-islands)).
Its [deployment transaction](https://eth.blockscout.com/tx/0x5d60ee3e3b46fa806eedfd560be277905c9d5057772dfe5c104b5ce18519897e)
was mined at block **14,570,451**. Ponder shares the existing mainnet RPC and
indexes the contract's Transfer and OwnershipTransferred events from that block.
Token, lifecycle, transfer and contract-owner event identities include the
collection ID. Islands never enter the monster rarity formula or leaderboard.

The old `/v1` chain filters and collection totals retain their existing four
monster collections. The combined BNB read views exclude Islands; the new
collection API reads Islands directly from the configured physical Ponder schema.
The retired `/legacy-meta/v1/all-islands-by-address` endpoint retains its 410
response. The new paginated ownership endpoint is documented below.

## Metadata

Run a dedicated `start:islands-metadata` worker alongside the existing metadata
worker. It works with both `METADATA_SOURCE_MODE=archive` and `legacy-http`; it
does not require changing or activating a monster archive release. A PostgreSQL
session lock permits one Islands worker per database.

The worker reads `tokenURI`, `metadataStorage` and `genesisLimit` at a finalized
Ethereum block. It fetches only allowlisted HTTPS
`/v1/island-meta/grassland/<numeric-id>` URLs on `meta.polychainmonsters.com` or
`meta.yunipals.com`. HTTP redirects are rejected and payloads have the configured
size limit. Unsupported URIs and RPC/HTTP failures remain retryable and visible
as unavailable metadata; ownership reads still return the indexed token.

Raw documents are content-addressed in `metadata_source.source_blob`. Immutable
`metadata_source.island_revision` rows retain the raw-source hash, normalized
document, renderer version, URI and finalized block evidence. The normalized
document gets its `id` from the NFT token, plus an empty description/attributes
when absent. Current owner fields are removed from the normalized document.
HTTP fetch time is recorded separately from URI block evidence; a current HTTP
document is not a claim about its contents at a historical block.

Publication is stored separately in `metadata.island_publication`. Every read
checks its lifecycle, mint transaction and log index against canonical Ponder
events. A replay that replaces a mint anchor hides the old publication until
republished. The worker rechecks URIs and JSON content hourly by default because
the contract and metadata storage do not emit metadata-update events. Shared
fallback JSON is fetched once per batch; it is not cached across audits. A
changed URI, storage contract or JSON document creates a new revision.

The API exposes `edition: Genesis | Personal` derived from the contract's fixed
genesis boundary of 1,000. Source attributes are preserved. Rarity remains null.
Burned tokens leave active lists and wallet holdings but retain their history and
previously published metadata.

## Candidate deployment and activation

### Isolated deployment alongside live monster services

For an existing live indexer, Islands can use a separate physical schema and
three services without restarting or rebuilding the monster collections.
Set `DATABASE_SCHEMA` to a fresh name and `PONDER_ISLANDS_ONLY=true`. Start Ponder
with `--config ponder.islands.config.ts --hostname 127.0.0.1 --port 9014`.
This configuration uses only Ethereum and registers only the two Islands event
handlers. Its historical log queries use a 100,000-block range, verified through
the production RPC gateway; Ponder handles request pacing and retries. The combined config
rejects the isolated flag to catch configuration mistakes.

Run `islands:migrate` using the schema-owner credential. This appends the same
Islands migration ledger entries as `db:migrate`, but does not recreate monster
read views or indexes. It requires all preceding migrations to be present.
Run `start:islands-metadata` and `islands:verify --activate` against the isolated
schema. Grant a dedicated API role read access to its token, lifecycle, transfer,
checkpoint and build tables, and the Islands readiness/publication/revision
tables described below. Run `start:islands-api` with that read-only credential,
`DATABASE_SCHEMA` set to the isolated schema, `API_ISLANDS_ENABLED=true`, and
`API_PORT=9015`. Its `/ready` checks only Islands readiness.

Route only `/yunipals-indexer/v2/collections/ethereum-islands` and its descendants
to this API, removing the `/yunipals-indexer` prefix. The existing `/v1` routes
continue using the current monster API. The isolated OpenAPI document is at
`/yunipals-indexer/v2/collections/ethereum-islands/openapi.json`.
Validate Nginx configuration before reloading. Roll back by removing only the
Islands proxy include and stopping the three new services; retain the isolated
schema and append-only archive tables.

`islands:backup` exports the physical schema, revisions, publications and
verification receipts at one PostgreSQL snapshot, plus only the raw source blobs
referenced by Islands revisions and the Islands readiness row. The private
backup directory includes SHA-256 hashes. Configure `ISLANDS_BACKUP_DIR` for
the server's backup location. Restore the source blobs before restoring revision
foreign keys, and re-verify ownership before serving a restored deployment.

### Combined candidate replay

Adding this contract/table changes the Ponder build. Complete a candidate replay
before changing production readers. Use the repository's Node.js 24.18.1 and
pnpm 9.12.0, server-side PostgreSQL credentials and RPC variables. Keep credentials
in private environment files. Load the same candidate settings for every process.

1. Select unused `DATABASE_SCHEMA` and `READ_DATABASE_SCHEMA` names. Start the
   candidate Ponder process on a free port:

   ```sh
   pnpm --filter @protopals/yunipals-indexer exec ponder start --port 9013
   ```

2. Once Ponder has created its tables, run the append-only schema migrations
   using the schema-owner credential:

   ```sh
   pnpm --filter @protopals/yunipals-indexer db:migrate
   pnpm --filter @protopals/yunipals-indexer api:proof-indexes
   ```

   This adds the Islands publication/revision tables and a rebuilding readiness
   row, and recreates the candidate combined read views with monster scopes.
   It does not mark Islands ready. Reinstall the normal Ponder indexes and
   maintenance settings on a recreated physical schema as described in the
   indexer README.

3. Grant the candidate API's read-only role SELECT on the physical schema's
   `token`, `token_lifecycle`, `transfer_event`, `_ponder_checkpoint` and
   `_ponder_meta` tables, and `metadata.chain_readiness`,
   `metadata.island_publication`, `metadata.island_verification` and
   `metadata_source.island_revision`.
   Grant USAGE on those schemas. Use existing operator-managed role names; the
   API must not run with the writer/schema-owner credential. The metadata worker
   needs reads on the physical event tables, writes to `island_publication`, and
   SELECT/INSERT on `source_blob` and `island_revision`.

4. Start the Islands metadata worker and wait for historical indexing and initial
   metadata publication to complete:

   ```sh
   pnpm --filter @protopals/yunipals-indexer start:islands-metadata
   ```

5. Verify live ownership at one pinned finalized block. The command compares
   every enumerated token and owner with reconstructed Transfer history, checks
   current token-table consistency and the Ponder checkpoint, and rechecks the
   finalized block hash. It does not use a fixed expected supply of 898.

   ```sh
   pnpm --filter @protopals/yunipals-indexer islands:verify --output /tmp/islands-verification.json
   ```

   To mark the collection ready, use the readiness writer/schema-owner role:

   ```sh
   pnpm --filter @protopals/yunipals-indexer islands:verify --activate --output /tmp/islands-activation.json
   ```

   `--activate` repeats live verification and requires published metadata for
   every active token at that block. Reports refuse to overwrite existing files.
   The command checks the RPC chain ID and never treats RPC errors as empty
   enumeration results.

6. Start the candidate API with `API_ISLANDS_ENABLED=true` and a free API port.
   Check Islands status, stats, token details, both editions, owner holdings and
   pagination. Also complete the existing four-chain API/release parity gates
   before replacing any process that serves the old endpoints. Switch readers
   and supervise `start:islands-metadata` through the deployment manager.

API readiness requires both the verified Islands readiness row and a completed
Ponder replay whose checkpoint reaches the verified block. Activation records
are specific to the physical schema and Ponder build ID, so verifying a candidate
does not activate another schema. Re-verify and activate after a Ponder build
change. A replay temporarily blocks Islands reads. Islands readiness failures
do not affect v1 readiness.
Track checkpoint progress, active supply, `metadataAvailable`, retry counts and
worker output. Metadata settings are in the indexer's `.env.example`.

For rollback, set `API_ISLANDS_ENABLED=false`, restore the previous API/Ponder
deployment and its read views, and stop the new metadata worker. Preserve the
additive source/publication tables for later recovery. Back up
`metadata_source.source_blob`, `metadata_source.island_revision`,
`metadata.island_publication`, `metadata.island_verification` and
`metadata.chain_readiness` with PostgreSQL;
the legacy release-export command covers monster releases, not these Islands
revisions. Restore those tables together before re-verifying a replay.

## API

All paths below are rooted at `/v2/collections/ethereum-islands`:

| Path                         | Result                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `/indexing-status`           | Enabled flag and collection-specific replay/verification status; accessible before activation |
| `/`                          | Collection identity and deployment block                                                      |
| `/stats`                     | Known tokens, active supply, burns, holders, edition counts and metadata coverage             |
| `/tokens`                    | Paginated tokens; `owner`, `edition`, `burned`, `sort`, `limit`, `cursor` filters             |
| `/tokens/:tokenId`           | Ownership, publication/provenance and mint/burn lifecycle                                     |
| `/tokens/:tokenId/transfers` | Paginated transfers ordered by block, transaction index and log index                         |
| `/owners/:address/tokens`    | Paginated active holdings for an Ethereum wallet address                                      |

Limits are 1–100, default 50. Sorting supports `token-id-asc` and `token-id-desc`.
Token lists default to `burned=false`; `true` and `all` are also available.
Wallet holdings always exclude burned tokens. Owners are wallet addresses; ENS
resolution remains available on the existing collector APIs. Pass `nextCursor`
unchanged with the same filters. A mismatched cursor returns 409. Unsupported
filters, duplicated parameters and noncanonical token IDs return 400.

Reads return 503 while disabled or ownership verification/replay is pending.
Metadata failures are local to the token and expose `metadataStatus` rather than
dropping the token. Every token includes `collectionId`, `chain`, `chainId` and
`contractAddress`; token IDs and block numbers are strings. Metadata provenance
includes source/revision hashes and URI block evidence. OpenAPI documentation
is served at `/docs`.

## Validation

```sh
pnpm --filter @protopals/yunipals-indexer typecheck
pnpm test:indexer
```

The suite includes embedded PostgreSQL tests for publication, mint-anchor
replacement, metadata changes/retries, burn history, numeric pagination,
readiness isolation and finalized ownership verification. It compiles and
exercises the actual registered event callbacks through Ponder's Vite loader.
The existing disposable PostgreSQL `test:ponder:postgres` fixture also covers
the new table's reorg triggers during schema compatibility checks.

## Website collection browser

The collection browser exposes Islands at `/?collection=islands`, with Genesis
and Personal edition filters, numeric token sorting, cursor pagination, wallet
holdings, and token ID lookup. Detail routes use
`/collection/ethereum-islands/:tokenId` and include artwork, ownership and transfer
history. Islands use the existing `VITE_YUNIPALS_INDEXER_URL` setting.

```sh
pnpm --filter @protopals/yunipals-home-web typecheck
pnpm test:web
pnpm --filter @protopals/yunipals-home-web build
```

`test:islands:ui` verifies the browsing flow against the public Islands API. It
accepts `--url`, `--playwright` and `--chromium` arguments for the website and your
existing browser tooling; it does not submit wallet transactions.
