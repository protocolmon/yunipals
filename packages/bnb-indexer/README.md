# BNB ownership indexer

This package publishes the BNB NFT ownership and transfer source required by
the [marketplace API](../../apps/yunipals-market-api/README.md). It is extracted
from the server's `indexer-next` BNB worker without the bundled Polkamon
packages. It uses only PostgreSQL and a BNB JSON-RPC endpoint. The same chain
events can rebuild its tables on an independent installation.

It indexes the Yunipals BNB collection from block 7,579,197. It stores token
ownership, mint/burn lifecycles, transfer and role events, plus a finalized
cursor in `bnb_indexer`. It does **not** index Ethereum, Base or Polygon, fetch
NFT metadata, or run the marketplace's Seaport order-discovery worker. Those
remain separate services. BNB order discovery does not require redistribution
of the server's four-chain metadata indexer or its private dependencies.

Use Node.js 24 and PostgreSQL 16. Copy `.env.example` into your own secret
configuration and set `DATABASE_URL` and `BNB_RPC_URL`. No RPC key belongs in
the browser. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @protopals/yunipals-bnb-indexer db:migrate
pnpm --filter @protopals/yunipals-bnb-indexer start
```

`db:migrate` creates only the `bnb_indexer` schema; it does not change existing
`yunipals_read_v4` views. If no other indexer owns those views, run
`db:standalone-views` once to create BNB-only token, lifecycle and transfer
views. That command refuses to replace any existing view. For a combined
four-chain installation, provide union views from the other indexer instead.

The default RPC batch spans up to 100,000 blocks and splits ranges that the
provider rejects. Check your provider's actual `eth_getLogs` limits and set
`BNB_LOG_BLOCK_RANGE` accordingly. A ten-block provider limit makes a full
historical rebuild very expensive in request count. `BNB_CONFIRMATIONS=20`
keeps the cursor behind the tip; a finalized cursor hash mismatch stops the
worker for investigation. `BNB_END_BLOCK` can cap a one-time replay. The worker
does not silently treat provider failures as empty blocks.

Run `pnpm --filter @protopals/yunipals-bnb-indexer build` to produce plain
JavaScript in `dist/`. The integration fixture requires a disposable PostgreSQL
database in `DATABASE_URL` and a local TCP allowance:

```sh
pnpm --filter @protopals/yunipals-bnb-indexer test
```

It starts two independent indexers against a synthetic RPC transfer and checks
that both rebuild identical token ownership, transfer rows and cursors. It drops
the test schemas afterward. Do not point the test at a database where the test
role can alter production schemas.
