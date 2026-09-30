# Open-source publication check — 29 September 2026

The dependency cleanup is complete and verified in source. The final workspace
audit reports zero known advisories. The query fixes are deployed; the dependency
cleanup has not been deployed to production. Its rollout is separate from source
publication and from the ongoing 24-hour query observation.

## Checked state

- Remediation revision checked: `eca67f0`; 43 commits ahead of fetched `origin/main`
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

## Dependency remediation

Before cleanup, `pnpm audit --json` reported **57 findings: 24 high, 31 moderate,
two low and no critical**, across 17 package names. Every reported dependency
path started in `apps/yunipals-indexer`. The final audit reports **zero** at all
severity levels, with no muted advisories. These results describe the installed
dependency graph, not an absence of application security defects.

The [original evidence](audit/indexer-dependency-advisories-2026-09-29.json)
is retained. The final result, checked revision, lockfile and archive hashes,
per-package resolutions and regression results are recorded in
[the remediation evidence](audit/indexer-dependency-remediation-2026-09-29.json).

| Dependency                                             | Resolution                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Hono / Node adapter                                    | 4.13.8 / 1.19.17, including Ponder's adapter                       |
| Drizzle / Kysely                                       | 0.45.2 / 0.28.17, including Ponder's database dependencies         |
| Ponder Vite / Vite Node's Vite                         | 6.4.3; vulnerable esbuild 0.21.5 is removed                        |
| Vitest / mocker                                        | 4.1.11; its Vite is also pinned to 6.4.3                           |
| Legacy Axios / cache interceptor                       | 1.18.0 / 1.11.1                                                    |
| Legacy Lodash / BN.js                                  | 4.18.1 / 5.2.5                                                     |
| Legacy Solana / Ethers SDKs                            | Unused dependency edges removed from both retained vendor packages |
| bigint-buffer / elliptic / stream-json / old WebSocket | Vulnerable SDK dependency paths removed                            |

Ponder remains pinned to 0.17.5 with its reader-compatible reorg patch. The vendor
archives and rarity formula version remain unchanged. Those packages support
the existing deep metadata/rarity entrypoints; their unused general blockchain
SDK entrypoints are unavailable after pruning. Frontend Zod 3.25.76 is now
explicit to retain the previous wallet peer selection. Marketplace Viem remains
2.38.0. Compatibility pins and the PostgreSQL check are documented in
[the dependency guide](../patches/README.md).

## Verification

All checks used Node 24.18.1 and pnpm 9.12.0:

- Frozen workspace installation succeeds; final audit has zero findings.
- All three app typechecks and both production builds pass.
- Wallet dependency checks: five passed. Frontend suites: six collector and
  143 marketplace checks passed. Marketplace API suite: 382 passed using the
  isolated PostgreSQL fixture.
- Indexer: 93 passed, one optional test skipped. Its default test command now
  includes a separate process that blocks network and removed SDK access and
  compares all five captured metadata families; four have scored rarity parity.
- Real PostgreSQL rarity pagination: 144 parity cases. Catalog and transaction
  lease suites: 22 passed, including connection failure, expiry and queue cases.
- Ponder compatibility passes against a dedicated local database: real Vite
  config/schema/handler loading, Kysely sync migrations, Drizzle tables/indexes
  and writes, multichain rollback with an open repeatable-read snapshot, trigger
  restoration and subsequent journaling.
- Gitleaks 8.30.1 finds no secrets in all 43 incoming commits or the new regression
  scripts. The three unchanged unpacked vendor archives also had zero findings.

The Ponder check verifies a local fixture, not a full production indexing replay
or a deployment of the updated dependency tree.

## Separate production acceptance

The targeted 24-hour observation remains open. Its last check during this
publication review showed no 500/503/read errors after approximately 71 minutes
and eight separately recorded 429 capacity responses. It also crossed one
generation publication. It is scheduled to finish on **30 September at about
23:01 Europe/Berlin time**. Completing that window supports the reliability
claim; publishing source alone does not complete that acceptance gate.
