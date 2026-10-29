# Shared Arena release — 29 October 2026

Implementation commit: `5d3b74c8d970c1cbe5a6703c948157a1bd2c3d74`.

Website deployment `dpl_BuKGjhhCy9XnuoDsetiGnvvTHcre`:
`https://yunipals-47susbslq-devving.vercel.app`, promoted to
`https://www.yunipals.com` after staged verification. Promotion aliases for
`yunipals.com`, `www.yunipals.com` and `yunipals-web.vercel.app` completed.

Reviewed public deployment package SHA256:
`3234c6116adecd55b5db04c754c12cd0c72c0406bbeec092e07dcb9fe61053bd`.
The package deploys one shared contract with two paused modes. Runtime size is
19,166 bytes. Existing registry `0xdbcab53a8e32d43997de252fd49c43ab8df290bf`
and the four approved pilot fighters are reused.

Video rules hash:
`0xd30e53016123ccf34051a493c8d1d35f2f5eadc57ddf149138e6fa8857477f1a`.
Anime rules hash:
`0x53016f2d742310660bb30ae48e0f0efdba74f0516a7238b3bf8a935e810363af`.

Validation completed:

- All 98 Solidity tests, including legacy suites and 21 shared-arena tests.
  Includes first-entry funding, no reserve subsidy, concurrent first quotes,
  rejected refunds, reentrancy, fee-on-transfer rollback, late callbacks,
  automatic strategies, independent mode claims and refund fuzzing.
- 101 existing API regression tests across 15 files, three new mode/receipt
  tests, 100 credential-policy tests and the four-test capacity suite.
- PGlite native reader/reducer checks, including mode-scoped balances,
  withdrawals, rewards, history and rejection of inconsistent evidence.
- Four shared deployment/payment/storage tests and four existing browser
  deployment helper tests, run directly so individual assertions execute.
- Strict API, indexer and website TypeScript checks; API and curated website
  builds; scoped Gitleaks scan; worker provider/key isolation check.
- Browser deployment flow with synthetic wallet/RPC clients: exact creation,
  chain/wallet changes, pending retention, reload recovery, confirmed reverted
  retry and mobile layout. No real transaction was sent by these checks.
- Staged and canonical website checks: correct admin, frozen package checksum,
  setup desktop/mobile, mode hub, historical claims link, unchanged old anime
  package and accessible old pilot. No browser exceptions or horizontal overflow.

The curated frontend contains 227 files / 14,079,382 bytes. Its release manifest
SHA256 is `0b1ac95f8e109d5e9d58fb061cdc51f5c34ccb71c666c11315fe19e0406fc336`.
Prototype media and private credentials are excluded.

Pending: the admin's browser-signed deployment and confirmed record. No new
shared contract address has been configured or invented. The new modes have
not been activated; `VITE_SHARED_ARENA_API_URL` remains unset. Existing server
services, old contracts and claims remain in place. The old video liability was
2 USDC at the migration audit and must remain claimable. Continue with the
address-dependent cutover in `ops/arena-modes/README.md`, then run the real paid
pilot and record actual production provider costs. No provider generation was
performed for this release's development checks.
