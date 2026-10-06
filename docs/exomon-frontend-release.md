# Exomon frontend and source release

The backend Exomon worker and API already run separately from the website. A
frontend release reads their published PostgreSQL snapshot through the public
indexer API. Website traffic does not start DAS scans or require a Helius key.

## Source integration

The release branch is based on the current public
[`protocolmon/yunipals`](https://github.com/protocolmon/yunipals) `main` branch.
It ports the Exomon worker, API, frontend, fixtures, tests, and documentation
from the reconstructed development worktree described in
[source provenance](exomon-source-provenance.md). The public branch's newer API
fixes, Islands feature, and CI remain in place. The reconstructed baseline
history is not part of the release branch.

The three `UNLICENSED` Polkamon archives recorded in the
[open-source audit](open-source-audit.md) are already in the public repository
and are unchanged by this release. Their redistribution rights still need
separate owner review. Keep environment files, database state and metadata
archives outside Git. A fresh clone must install with the frozen lockfile and
run the fixture website without credentials.

## Checks on the reconciled commit

Use Node 24.18.1 and pnpm 9.12.0:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:dependencies
pnpm test:web
pnpm test:indexer
```

Run `pnpm test:api` using the disposable marketplace PostgreSQL setup in the
[marketplace API README](../apps/yunipals-market-api/README.md). Run
`pnpm test:solana:postgres` against a separate loopback database named
`exomon_test_*`; it uses synthetic observations and makes no Helius calls.
Build the frontend with `VITE_EXOMON_ENABLED=true`, then build the marketplace
API. Confirm `apps/yunipals-home-web/dist/THIRD_PARTY_LICENSES.txt` is present.
The [CI workflow](../.github/workflows/ci.yml) runs these checks with
disposable PostgreSQL 16 databases and test-only credentials.

## Website configuration and preview

Use the existing Vercel project, whose source root should be
`apps/yunipals-home-web`, build command `vite build` and output directory
`dist`. Preserve the monorepo workspace install, SPA rewrites and existing EVM
configuration. Configure these public build-time values in Preview and
Production as appropriate:

| Variable | Production value |
| --- | --- |
| `VITE_EXOMON_ENABLED` | `true` |
| `VITE_YUNIPALS_INDEXER_URL` | `https://api.yunipals.com/yunipals-indexer` |
| `VITE_YUNIPALS_MARKETPLACE_URL` | Existing public marketplace API URL |
| `VITE_WALLETCONNECT_PROJECT_ID` | Existing public Reown project ID |

Do not set `VITE_SELF_HOSTED=1` for the Yunipals deployment. Never expose
`HELIUS_API_KEY` as a `VITE_` variable. The Solana API must already be enabled
with a fresh published scan. Test the Preview URL against the public HTTPS API;
loopback API tests alone do not verify deployed routing or origins.

Check `/exomon`, a real `/collection/solana/:mint`, the linked
`/collector/solana/:address` and `/leaderboard?chain=solana` on desktop and
mobile. Exercise filters, pagination, direct navigation and refresh. Use fixture
mode for burned, unavailable-owner and expired-cursor states. Confirm no
Exomon wallet signing or trading controls appear and existing EVM pages still
work. Browser requests should go to the indexer API, not Helius or Solana RPC.

## Production cutover and rollback

Record the previous website deployment and the reviewed upstream commit. Check
the project's automatic production deployment behavior before merging. Build
the reviewed commit using Production environment variables, verify that build,
then route the production domain to it. [Vercel's deployment guidance](https://vercel.com/docs/deployments/promoting-a-deployment)
notes that promoting Preview to Production can rebuild with Production values;
verify the Production artifact itself.

Immediately smoke-test the public routes and keep the previous deployment
available for rollback. `VITE_EXOMON_ENABLED` is embedded into the JavaScript at
build time, so changing it also requires a new deployment. Observe the indexer
health and credit ledger through one normally scheduled scan. Do not trigger an
extra provider sync for the website release. The
[Solana runbook](../apps/yunipals-indexer/docs/exomon-solana-rollout.md)
describes backend incident response; keep its schema and credit ledger intact.
