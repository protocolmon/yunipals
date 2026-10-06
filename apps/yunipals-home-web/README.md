# Yunipals web app

Vite, React and TypeScript collection explorer for Yunipals across four EVM
chains and Exomon on Solana. Browse traits, rarity, ownership, collector
profiles and rankings. Wallet-based collection management and optional
listing/purchase flows apply to the EVM collections only. Exomon views are
read-only and show observed ownership changes, not a complete transfer history.

## Local development

Install workspace dependencies from the repository root, then copy `.env.example`
to `.env.local` in this directory and configure your local services.

```sh
pnpm dev
pnpm typecheck
pnpm test:solana
pnpm test:marketplace
pnpm build
```

`VITE_YUNIPALS_INDEXER_URL` supplies collection/ownership data.
The Exomon views use only this indexer API. The Helius key stays on the indexer
server and must never be placed in a `VITE_` variable. Set
`VITE_EXOMON_ENABLED=true` to show the Exomon routes and navigation in a
frontend rollout; they stay hidden without it, except in fixture mode. The API must have its Solana
routes enabled and a fresh published scan before these views can serve data.
`VITE_YUNIPALS_MARKETPLACE_URL` enables optional listing and purchase features.
Both values are public; credentials belong in the backend only.
Set `VITE_SELF_HOSTED=1` for an independent deployment. Its build requires
both service URLs to point away from Yunipals domains; the full website also
needs the [collection indexer API](../yunipals-indexer/README.md), as explained
in the [BNB self-hosting guide](../../docs/self-hosting-bnb.md).
`VITE_WALLETCONNECT_PROJECT_ID` is your public project ID from the
[Reown dashboard](https://dashboard.reown.com/). Add it to this app's `.env.local`
and restart Vite. With no project ID, local development supports injected
browser wallets only; QR/mobile WalletConnect connections are unavailable.
Omitting the marketplace URL disables those features during local development.
Production Vercel builds reject a missing marketplace URL.
They also reject a missing WalletConnect project ID. In Vercel, open this
project's **Settings → Environment Variables**, add
`VITE_WALLETCONNECT_PROJECT_ID`, select Production and any Preview environments
that should support WalletConnect, then redeploy. Vite embeds this value at build
time; changing a variable does not update an existing deployment. Configure your
allowed website origins in the Reown project settings. Never use a secret API key
in place of the public project ID. See
[Vercel environment-variable documentation](https://vercel.com/docs/environment-variables).

## Sample collection

From the repository root, run `pnpm dev:fixtures`. Open `http://127.0.0.1:5177`.
No `.env.local`, database or provider credentials are needed. This mode overrides
service URLs and the wallet project ID, serves local synthetic reads and disables
wallet connections and trading. It includes synthetic Exomon tokens and Solana
collector rankings. It is development-only: builds in `fixtures`
mode fail. See [the fixture guide](scripts/fixtures/README.md).

## Personal collection filters

Collector pages support rarity sorting, Type/Color/chain filters, and exact token
ID search when the indexer advertises support. Name-prefix search is enabled
separately. Pages render 24 cards and retain at most five token-page responses;
filtering never downloads the whole wallet.

The collector routes are included in the [indexer app](../yunipals-indexer/README.md).
Validate them against your own database before enabling their feature switches.
The existing owner API remains available
when the controls are disabled. See the [performance evidence](../../docs/personal-collection-performance.json)
for the local benchmark's scope and production validation.

## Exomon on Solana

`/exomon` lists active Exomon with Type, Color and other categorical filters,
capped-rarity range and sorting. `/collection/solana/:mint` shows token details,
`/collector/solana/:address` shows current holdings, and
`/leaderboard?chain=solana` shows the Solana rankings. Mint and wallet addresses
are base58 public keys and preserve case. Collection and owner pages request 24
items at a time, retaining at most five page responses in memory. An expired
cursor resets paging to the first page after the next published scan.

Run `pnpm test:solana` for URL, client and fixture checks. In fixture mode,
visit `/exomon`; no Solana RPC or Helius credential is used by the browser.

Run `pnpm test:collector` for client/filter/cache tests. In fixture mode, visit
`/collector/0x000000000000000000000000000000000000000c` for a synthetic 128-item
wallet, including hidden tokens and missing rarity. Run `pnpm test:collector:ui`
with `--playwright /path/to/playwright/index.mjs --chromium /path/to/chrome`
against the fixture server for browser and request-volume checks.

## Browser and fork checks

The `scripts/test-marketplace-*-ui.mjs` scripts use a local app and a supplied
Playwright module/Chromium executable. See each script's arguments. Activity UI
checks use the isolated API paths `/__market-test` and `/__indexer-test` on the
local app origin. [Activity fixtures](scripts/fixtures/README.md) are self-contained.

Fork scripts are optional integration checks. They require explicitly configured,
isolated Anvil forks and disposable databases, with identity checks before any
transaction. Read their configuration requirements before running them.

## Hosting

Use this directory as the project root, `vite build` as the build command and
`dist` as the output directory. `vercel.json` supplies client-side route rewrites.
Provide the two public service URLs in the hosting environment and deploy `main`.
