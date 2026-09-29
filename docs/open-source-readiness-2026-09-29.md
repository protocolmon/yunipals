# Open-source publication check — 29 September 2026

The monorepo and query fixes are committed and deployed. Before a release/main
update, address or explicitly triage the imported indexer's dependency findings.
The earlier zero-advisory result predates this import.

## Checked state

- Revision checked: `851e860`; 41 commits ahead of fetched `origin/main`
  (`a147a85`). Working tree was clean.
- Gitleaks 8.30.1 scanned the entire incoming commit range with redacted output:
  zero findings.
- All three vendor package archives were extracted and scanned separately:
  zero findings.
- Tracked environment files are examples. No tracked production environment
  files, private keys, database dumps or PostgreSQL globals were found by the
  filename inventory. These checks do not prove absence of every possible secret.
- The real PostgreSQL parity and catalog checks and both API typechecks passed
  during implementation; see the
  [deployment record](query-reliability-rollout-2026-09-29.md).

## Fresh dependency result

`pnpm audit --json` reports **57 findings: 24 high, 31 moderate, two low and no
critical**. All reported dependency paths start in `apps/yunipals-indexer`.
The report contains 57 unique advisory entries across 17 package names;
multiple dependency paths can refer to the same advisory. These are dependency
advisories, not 57 demonstrated exploits in Yunipals.

The JSON result, checked revision and lockfile SHA-256 are recorded in
[the audit evidence](audit/indexer-dependency-advisories-2026-09-29.json).

Affected groups include:

- Pinned Polkamon package dependencies: Axios, its cache interceptor, Lodash,
  Solana web3, bigint-buffer, bn.js, elliptic, WebSocket and stream-json packages.
- Indexer/Ponder dependencies: Hono, its Node adapter, Drizzle/Kysely and
  Vite/esbuild.
- Indexer test dependencies: Vitest and its mocker.

Prioritize packages used by the live reader/worker and distinguish reachable
runtime behavior from tooling, unused adapters and platform-specific findings.
Use compatible upgrades or narrow fixes with regression verification; a broad
forced dependency update could break Ponder or the retained renderer/scorer.
Record any remaining accepted findings with their usage and rationale.

## Separate production acceptance

The targeted 24-hour observation remains open. Its last check during this
publication review showed no 500/503/read errors and three separately recorded
429 capacity responses. It is scheduled to finish on **30 September at about
23:01 Europe/Berlin time**. Completing that window supports the reliability
claim; publishing source alone does not complete that acceptance gate.
