# Continuous integration

The CI workflow runs on branch pushes, pull requests, and manual dispatches.
It uses GitHub-hosted Ubuntu 24.04 runners, the Node version in `engines.node`,
the pnpm version in `packageManager`, and `pnpm install --frozen-lockfile`.
The pnpm store is cached by lockfile. New commits cancel older runs for the
same branch or pull request.

## Checks

| Check name             | Coverage                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck              | All three applications through `pnpm typecheck`                                                                                                    |
| Unit tests             | Wallet dependency regressions, frontend collector/marketplace/Islands/Exomon tests, synthetic fixtures, indexer unit tests, offline legacy metadata/rarity parity |
| Build                  | Self-hosted web build with Exomon enabled and marketplace API/worker bundles; verifies expected outputs and uploads them for seven days                                |
| Marketplace PostgreSQL | Complete marketplace suite with schema migrations and a separate restricted runtime role, including catalog snapshot and connection lease checks   |
| Indexer PostgreSQL     | Single BNB writer fixture, rarity/cache pagination and invalidation parity, real Ponder dependency/reorg compatibility, Exomon snapshot/API parity |
| Secret scan            | Reachable commit history, source tree, and each extracted vendor archive                                                                           |

The indexer runs directly from TypeScript. Its typecheck and real Ponder build
compatibility test are its build checks; it has no standalone `build` script.

Each PostgreSQL job gets a separate PostgreSQL 16 service container with only
local fixture credentials. The runner connects through `127.0.0.1`; this also
satisfies the existing tests' loopback/database-name guards. Indexer suites use
four separate databases so schema resets cannot affect the other suites.
Market tests use `market_test_owner` for migrations and `market_test_runtime`
for API reads/writes. CI does not need deployment secrets, production databases,
live wallets, OpenSea keys, or live chain RPC credentials.

The Exomon PostgreSQL suite uses synthetic observations, not Helius or live
Solana RPC. Tests that explicitly use Anvil/provider forks are outside these
required checks.
The BNB worker check serves its own fake RPC. The optional collector benchmark
remains skipped unless its fixture is supplied.

Actions are pinned to commits, checkout does not persist credentials, and the
workflow token has only `contents: read`. Fork PRs use ordinary `pull_request`
events. The pinned standalone Gitleaks binary is checksum-verified before use;
scanner output is redacted. `.gitleaks.toml` extends the default rules and allows
only the exact public OpenAPI SHA-256 at its manifest path for the generic API
key rule. Other values, paths, and rules remain scanned.

## Weekly audit

`dependency-audit.yml` runs every Monday at 07:18 UTC, or manually. It checks the
frozen dependency graph with `pnpm audit --json`; any reported advisory causes
the job to fail. The JSON report is retained as an artifact for fourteen days.
There are no muted advisories. Scheduled workflows start once the workflow is
on the repository's default branch.

## Require checks before merging

After the first GitHub run passes, require these six check names on `main` in
the repository's branch ruleset or branch protection settings:

- `Typecheck`
- `Unit tests`
- `Build`
- `Marketplace PostgreSQL`
- `Indexer PostgreSQL`
- `Secret scan`

Require the branch to be up to date before merging. The weekly audit is separate
from PR acceptance and is not a required status check. CI runs on every PR;
there are no path filters that could leave a required check pending.

Publishing `.github/workflows` requires the pushing credential to have workflow
write access. Changing branch rules requires repository administration access.
The user's repository role and the token's granted permissions are separate.

## Reproduce locally

Run from the workspace root using the pinned Node and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:dependencies
pnpm test:web
pnpm test:fixtures
pnpm test:indexer
VITE_SELF_HOSTED=1 \
  VITE_EXOMON_ENABLED=true \
  VITE_YUNIPALS_INDEXER_URL=https://indexer.example.test \
  VITE_YUNIPALS_MARKETPLACE_URL=https://market.example.test \
  pnpm build
```

For marketplace PostgreSQL tests, follow the disposable database setup in the
[marketplace README](../apps/yunipals-market-api/README.md). After migrating,
`.github/scripts/setup-test-databases.mjs marketplace` can initialize the test
runtime role using `MARKET_TEST_DATABASE_URL`.

For the indexer job, supply `CI_POSTGRES_ADMIN_URL` for a disposable loopback
PostgreSQL server's `postgres` database as `indexer_test_owner` and run
`node .github/scripts/setup-test-databases.mjs indexer`. Then use the four
database URLs and suite commands from `.github/workflows/ci.yml`.

Run `bash .github/scripts/scan-secrets.sh` on a clean source checkout without
installed dependencies or private local environment files. The dedicated CI
scanner job does not install dependencies or receive production secrets.
