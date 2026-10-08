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

## Optional Mixpanel analytics

Analytics is disabled by default and separate from trading-term acceptance.
Visitors must explicitly allow analytics before the SDK loads or any events are
sent. The footer and privacy notice provide Analytics settings. Choices last
180 days; withdrawal removes the browser identifier and local analytics records
and blocks collection in other open tabs. DNT and GPC also keep collection off.

Set these public build-time variables in the frontend deployment environment:

| Variable                         | Value                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `VITE_MIXPANEL_ENABLED`          | `true` only after project setup and disclosure are verified                      |
| `VITE_MIXPANEL_TOKEN`            | The public project token from Mixpanel Project Settings → Overview → Access Keys |
| `VITE_MIXPANEL_REGION`           | `eu`, `us`, or `india`, matching the actual project residency                    |
| `VITE_ANALYTICS_ENVIRONMENT`     | `production`, `preview`, or `development` explicitly                             |
| `VITE_ANALYTICS_RETENTION_YEARS` | Actual event-retention period in years; `2` for the new Yunipals project         |
| `VITE_ANALYTICS_RETENTION_DAYS`  | Alternative for policies stated in days; leave blank when years are set          |
| `VITE_PRIVACY_EMAIL`             | Monitored contact for analytics access/deletion requests                         |

The provided Yunipals project uses EU ingestion. Configure its public token in the production project environment. Keep previews/local development disabled or use a separate test
project. Fixture mode always disables analytics. Rebuild after changing values.
Incomplete configuration disables collection. Independent deployments must use
their own Mixpanel projects and privacy contacts.

The newly created Yunipals project uses Mixpanel's standard two-year event
retention policy, as documented in its
[Data Retention Policy](https://docs.mixpanel.com/docs/privacy/gdpr-compliance#data-retention-policy).
The privacy contact is `privacy@yunipals.com`. Set these values for Production in the hosting project before deploying:

```dotenv
VITE_MIXPANEL_ENABLED=true
VITE_MIXPANEL_TOKEN=<public project token>
VITE_MIXPANEL_REGION=eu
VITE_ANALYTICS_ENVIRONMENT=production
VITE_ANALYTICS_RETENTION_YEARS=2
VITE_ANALYTICS_RETENTION_DAYS=
VITE_PRIVACY_EMAIL=privacy@yunipals.com
```

Set exactly one retention unit. These variables change the privacy disclosure;
they **do not configure Mixpanel retention**. Match the actual project policy.
EU ingestion must match an EU-resident project; changing the SDK endpoint does
not migrate a project.

The SDK is pinned and loaded from its core-only entry point after consent.
Autocapture, session replay, heatmaps, feature flags and IP-derived geolocation
are disabled. SDK persistence and batching are disabled: Yunipals owns the
expiring browser identifier, and no events are queued before consent. Network
connections still expose the request IP address to Mixpanel. A strict final
payload allowlist excludes URLs, referrers, titles, search text, wallet addresses,
ENS names, signatures, transaction/order hashes, raw errors and automatic
marketing attribution. Unique visitors represent consenting browsers.

### Events and initial reports

| Event                                                   | Meaning                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Page Viewed`                                           | Normalized logical page; redirects, hash changes and filter changes do not create extra views |
| `Collectible Viewed`                                    | A Yunipal, Island or Exomon detail successfully loads                                         |
| `Collection Filter Applied`                             | Visitor applies filters/sorting; selected owner/trait input is excluded                       |
| `Collection Search Submitted`                           | Search category and validity, without search text                                             |
| `Wallet Connect Started` / `Wallet Connected`           | Explicit wallet connection entry point and success, excluding passive reconnections           |
| `Trade Started` / `Trade Submitted` / `Trade Confirmed` | Reviewed settlement attempt, wallet submission, and validated receipt                         |
| `Trade Interrupted`                                     | Bounded stage/reason; no provider error payload                                               |
| `Order Published` / `Order Cancelled`                   | Successful publication or confirmed cancellation                                              |

The local transaction records distinguish settlement from approvals/wrapping and
avoid duplicate confirmations between an active dialog and receipt recovery.
Replacement transactions share a local operation ID. Historical receipts that
were not observed during an accepted analytics session are not backfilled.
These events are frontend observations, not an authoritative blockchain ledger.
Declined consent, blockers and closed browsers reduce observed conversion counts.

In Mixpanel, create reports for collection engagement and returning browsers;
Page Viewed → Collectible Viewed → Wallet Connected; Trade Started → Trade
Submitted → Trade Confirmed; and interruptions by stage, reason, chain and
marketplace. Filter every report by `environment`. `schema_version` is currently
set to `1`. No user profiles or wallet-based identity merges are created.

For an analytics privacy request, open Analytics settings and copy the privacy
request identifier before withdrawing consent. Use Mixpanel's authorized
access/deletion workflow for that identifier. Withdrawal alone does not delete
historical events. Never add service-account credentials or API secrets to any
`VITE_*` variable.

### Verification

Run `pnpm test:analytics`, `pnpm typecheck`, and `pnpm build`. The browser check
uses the real SDK, intercepts every Mixpanel request, asserts a test token and
EU endpoint, and never sends analytics to a live project. Start an isolated dev
server from this directory:

```sh
VITE_MIXPANEL_ENABLED=true VITE_MIXPANEL_TOKEN=analytics-test \
VITE_MIXPANEL_REGION=eu VITE_ANALYTICS_ENVIRONMENT=development \
VITE_ANALYTICS_RETENTION_YEARS=2 VITE_ANALYTICS_RETENTION_DAYS= \
VITE_PRIVACY_EMAIL=privacy@example.test \
VITE_WALLETCONNECT_PROJECT_ID= VITE_YUNIPALS_MARKETPLACE_URL= \
VITE_YUNIPALS_INDEXER_URL=http://127.0.0.1:5188/__fixtures/indexer \
pnpm exec vite --host 127.0.0.1 --port 5188 --strictPort

pnpm test:analytics:ui --playwright /path/to/playwright/index.mjs \
  --chromium /path/to/chrome
```

Test constants above are synthetic and must not be used for production
activation. The test supplies collection fixtures through browser interception;
it does not enable analytics in the application's fixture mode.

Rollback: set `VITE_MIXPANEL_ENABLED=false`, rebuild and redeploy. Already-open
tabs retain their loaded build until refreshed. Updating the public SDK package
requires rerunning both payload and consent checks before deployment.
