# Yunipals

A collection explorer and collector toolkit for Yunipals NFTs on
Ethereum, Base, Polygon and BNB Chain. Browse tokens and traits, follow ownership
and transfer history, compare rarity and collector rankings, and manage your own
collection. Buying and selling are optional features within the web app.

The canonical application is **https://www.yunipals.com**. Collection browsing,
collector profiles and booster packs share `apps/yunipals-home-web`; old
`app.yunipals.com` links redirect to the corresponding main-site route. This
repository contains the frontend, booster contracts, indexing/API code, artwork
generator and deployment scripts.

## Projects

- [Web app](apps/yunipals-home-web/README.md): browse the collection, inspect
  traits and token histories, view collector profiles and rankings, and manage
  your own NFTs. Optional listing and purchase actions use your wallet.
- [Collection indexer](apps/yunipals-indexer/README.md): serves four-chain
  ownership, metadata, rarity, collector, leaderboard and Ethereum Islands reads.
  One managed service supervises EVM and Solana ingestion. Its README is the
  setup, startup and systemd guide.
- [Booster contracts](contracts/boosters/README.md): upgradeable Base pack rules,
  shared monster NFTs, duplicate-free draws and VRF recovery.
- [Artwork generator](docs/boosters/artwork-runtime/README.md): reference-based
  card recipes, review and content-addressed publication, with a durable queue.
- [Shared core](packages/yunipals-market-core/README.md): chain registries,
  order encoding and validation shared by the web app and API.
- [Marketplace API and workers](apps/yunipals-market-api/README.md): supports
  the optional buying and selling features. The web app calls it for listings
  and purchase transaction details. It reads OpenSea orders on Ethereum, Base
  and Polygon and reconstructs BNB orders from public Seaport events. It checks
  order status and keeps provider keys out of the browser; wallets sign the
  transactions.

For a local collection demo, use synthetic fixtures without either backend.
Running this app with live buying or selling requires the marketplace API and,
for ownership checks, the collection indexer. OpenSea and on-chain events are the
underlying order sources; the API does not custody NFTs or funds.

The complete four-chain collection view needs the indexer API, RPC endpoints and
a PostgreSQL database. Follow the [indexer setup guide](apps/yunipals-indexer/README.md)
for the managed service.

## Development

Use Node.js 24.18.1 and pnpm 9.12.0 (see `package.json`). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev:web
pnpm typecheck
pnpm test:dependencies
pnpm test:web
pnpm test:indexer
pnpm build
```

Copy the relevant app's `.env.example` to `.env.local` for Vite or export the
API variables in your shell. Frontend variables are public build-time values;
never put provider keys or database credentials in a `VITE_` variable.
The API test suite needs the isolated database described in its README.
GitHub CI covers typechecks, tests, builds, PostgreSQL integration, and secret
scanning. See the [CI guide](docs/ci.md) for check names and local reproduction.

For a populated local UI without an indexer, database, provider keys or wallet
project, run `pnpm dev:fixtures` and open `http://127.0.0.1:5177`.
It provides 48 synthetic tokens, filters, pagination, token details, collector
profiles and rankings. Wallet connections and trading are disabled. See the
[fixture guide](apps/yunipals-home-web/scripts/fixtures/README.md).

## Deployment

The web project root is `apps/yunipals-home-web`. The checked-in Vercel config
runs `pnpm build:www --mode vercel-cloud` to produce the curated collection and
booster app with SPA routing. See the [canonical build guide](docs/boosters/mainnet-launch/canonical-www-build-2026-10-22.txt).
Generic self-hosted builds remain `pnpm build`, with output in `dist`;
marketplace-enabled production builds require `VITE_YUNIPALS_MARKETPLACE_URL`.
Configure `VITE_YUNIPALS_INDEXER_URL` for your own metadata indexer. Set
`VITE_SELF_HOSTED=1` to make a build reject missing URLs or Yunipals service
domains; see the [self-hosting guide](docs/self-hosting-bnb.md).
Set `VITE_WALLETCONNECT_PROJECT_ID` to your public Reown / WalletConnect project
ID in Vercel **Project → Settings → Environment Variables**, select Production
(and Preview if needed), then redeploy. Production builds require it. Local
development without an ID offers browser wallets only. See the web app README
for the local `.env.local` setup and domain allowlist guidance.

Start the collection indexer from the repository root with one command:

```sh
pnpm indexer:start --env-file /etc/yunipals-unified/indexer.service.env
```

The [indexer setup guide](apps/yunipals-indexer/README.md) covers PostgreSQL,
separate private child settings, the public service file, health checks and
systemd. Use the same settings and database when restarting the service.

Build the marketplace API with `pnpm build:api`; run its bundled entry points
with installed production dependencies. Keep credentials, backups and
operational incident records outside source control.

## Optional buying and selling

Yunipals includes optional tools for buying and selling NFTs. Ethereum, Base
and Polygon orders come from OpenSea. On BNB Chain, sellers publish orders
through a Seaport validation transaction, and the
marketplace worker indexes the public events. Purchases settle through Seaport
smart contracts. Yunipals is not endorsed by or affiliated with OpenSea.

Yunipals does not hold users' private keys or take custody of customer funds or
NFTs. Users authorize orders, approvals and transactions through their own
wallets. Smart contracts may execute valid signed orders later; disconnecting a
wallet or closing the website does not cancel an order. Token approvals can
remain active until revoked, and cancelling an order does not necessarily revoke
those approvals.

Review the network, NFT, currency, payment amounts, fee recipients, expiry and
approval permissions before signing. Order reviews show seller proceeds and any
order fees; network gas is additional. Fees can vary between chains and orders.
Non-custodial operation does not mean trading is free of fees or risk.

Risks include wallet compromise, smart-contract defects, market volatility,
unavailable or outdated listings and third-party outages. Yunipals generally
cannot reverse completed blockchain transactions. No profit, liquidity or resale
value is guaranteed, and collection rankings are not investment advice. Buying
an NFT does not automatically transfer copyright or commercial artwork rights.

Trading is subject to the [Yunipals Terms of Use](https://yunipals.com/terms),
[Privacy Notice](https://yunipals.com/privacy) and applicable third-party terms,
including the [OpenSea Terms of Service](https://opensea.io/tos) when using OpenSea
services. Trading must not be used where prohibited by applicable law or
sanctions. Nothing in this summary limits mandatory legal rights.

The source-code license does not grant permission to use third-party services or
establish regulatory approval. Anyone operating their own deployment must assess
their applicable obligations, provider agreements and user disclosures.

## Contributions and rights

Follow [AGENTS.md](AGENTS.md). Run type checks, relevant tests and builds before
merging changes. Original code is [MIT-licensed](LICENSE); Yunipals-owned artwork
and brand graphics have [noncommercial asset terms](ASSET_LICENSE.md).
Third-party dependencies and assets retain their own terms. See
[RIGHTS.md](RIGHTS.md) and the [open-source release audit](docs/open-source-audit.md).

Production web builds include `THIRD_PARTY_LICENSES.txt`, linked from the footer.
Keep it with the generated JavaScript when redistributing a build. Dependency
pins and their small compatibility patches are explained in
[patches/README.md](patches/README.md).

Booster packs: see [implementation and rollout](docs/boosters-implementation.md)
and [contracts](contracts/boosters/README.md). The current Base pack uses 264
variants, costs 1 YPAL plus VRF/gas, and earns one mint credit every 24 hours
after reveal. The [live release evidence](docs/boosters/mainnet-launch/canonical-www-production-2026-10-22.json)
distinguishes accepted mainnet behavior from remaining elapsed-time and
unattended-artwork work.
