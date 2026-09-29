# Open-source release audit — updated 2026-09-22

The [29 September publication check](open-source-readiness-2026-09-29.md)
supersedes the dependency result below for the expanded monorepo. Its imported
indexer's 57 advisories were remediated and the final workspace audit again
reports zero known advisories. The checked versions and compatibility evidence
are linked from that publication record; this older report describes the earlier
repository scope.

RainbowKit remains in use. Original Yunipals code is MIT licensed, with separate
noncommercial artwork terms. The dependency remediation removes the AGPL parser
from the current installation and reduces the npm audit from **115 findings to
zero known vulnerabilities**. These are dependency-advisory results, not a claim
that the application has no security defects.

The deployed wallet bundle retains MetaMask SDK's separate use conditions. Its
notices are now included in production builds. On 2026-09-22, the project owner
confirmed the applicable user-count condition and rights to license Yunipals
artwork and branding. Repository publication remains a separate step.

## Resolved findings

- **UAParser:** RainbowKit 2.2.11 now resolves MIT-licensed UAParser 1.0.41 through
  a scoped override. A one-line patch preserves macOS download-link detection.
  The regenerated license inventory contains no AGPL package.
- **Critical hashing advisory:** refreshing the legacy Coinbase SDK path updates
  `sha.js` to a patched version. The Coinbase package-name override alone did not
  affect its `cbw-sdk` alias.
- **Dependency advisories:** updated React Router, Vite, Wagmi, Hono and its Node
  adapter, and compatible transitive dependencies. Scoped overrides address
  pinned WebSocket, YAML, UUID and URL-decoder versions. The URL decoder's ESM
  export has a small Query String compatibility patch.
- **Wallet QR rendering:** browser verification found that Cuer passed a zero
  border rejected by both the old QR 0.6.0 and updated 0.7.0. A small patch follows
  the encoder's documented padding-and-slicing approach, preserving the matrix
  expected by RainbowKit. A regression test covers a WalletConnect URI.
- **Distribution notices:** production builds generate `THIRD_PARTY_LICENSES.txt`
  and expose it through the footer. The supplement supplies missing upstream
  texts, ConsenSys notices/use terms, and MPL source-archive references.
- **Missing provider license:** upstream restored the omitted ISC declaration for
  `@metamask/eth-json-rpc-provider`. Its text and provenance are included; the
  unmodified package's metadata still appears as Unknown in the inventory.
- **API validation gap:** an isolated PostgreSQL 16 container, migrated database
  and restricted runtime role allowed the complete 368-test API suite to pass.

The API retains Viem 2.38.0: testing a newer version exposed changed HTTP/RPC error
classification. Its WebSocket dependency is patched independently. The frontend
uses Viem 2.56.8. Dependency decisions and patches are documented in
[../patches/README.md](../patches/README.md).

## Owner confirmations and publication

- **MetaMask use condition:** the installed SDK licenses define qualifying uses,
  including at most 10,000 monthly active users across versions/platforms. The
  project owner confirmed that Yunipals meets this user-count condition on
  2026-09-22; this records the owner's confirmation, not measured traffic.
  Operators must continue to satisfy an applicable condition or obtain separate
  permission. Original-source MIT licensing does not override the SDK terms. See
  [the full notice](../THIRD_PARTY_NOTICES.md).
- **Artwork and branding:** the project owner confirmed the rights to license
  Yunipals artwork and branding on 2026-09-22 under the existing
  [noncommercial asset terms](../ASSET_LICENSE.md). Third-party assets, including
  the OpenSea mark, retain their separate terms and are excluded from that grant.
  Existing NFT-holder agreements remain separate.
- **Release scope:** repository visibility remains a separate publication step.
  The indexer, smart contracts and production operational environment are outside
  this source audit. No live transactions were signed or sent during validation.

## Evidence and reproducibility

[audit/dependency-advisories.json](audit/dependency-advisories.json) records the
current audit result and exact lockfile SHA-256. The earlier 115-finding snapshot
remains in Git history at `8d3cf46`.
[audit/dependency-licenses.json](audit/dependency-licenses.json) is the regenerated
`pnpm licenses list --json` inventory, with machine-specific paths removed.
Package metadata is evidence, not a legal certification; installed SDK license
texts and upstream corrections were inspected separately.

Validation uses Node 24.18.1 and pnpm 9.12.0:

- TypeScript checks and web/API production builds pass.
- All 23 frontend test files and four fixture contract tests pass.
- Five dependency regressions cover QR encoding, desktop platform detection,
  WalletConnect query round trips, bounded malformed-input handling and UUID APIs.
- All 368 API tests pass against a disposable database; no production DB was used.
- Browser checks cover sample catalog pagination/filtering, token detail,
  collector holdings, rankings, mobile layout, and disabled sample wallets.
- Simulated MetaMask discovery, connection, collector navigation, account settings
  and disconnection pass on desktop and mobile. No real wallet was used.
- WalletConnect's QR flow is checked separately without pairing a real wallet.
- Large production-chunk warnings and upstream deprecation/optional-peer warnings
  remain. Wallet vendor SDKs include prebundled code; the package advisory audit
  is not an independent audit of all code embedded inside those SDKs.

Recheck with `pnpm audit --json`, `pnpm licenses list --json`, `pnpm typecheck`,
`pnpm test:dependencies`, `pnpm test:web`, `pnpm test:fixtures`, and `pnpm build`.
Run `pnpm test:api` using only the disposable database setup in the API README.
The generated third-party notice file must accompany redistributed web builds.

## Earlier secret and history review

The initial review scanned both commits reachable at `0539c7a` (including initial
commit `31c70d1`) and a source snapshot. Gitleaks 8.30.1 found one candidate at
`apps/yunipals-market-api/src/app.test.ts:652`: manual review identified a public
NFT contract address in a fixture, not an API credential. A supplementary scan
covered 374 historical blobs. No verified secret or tracked real environment file
was found. Remote-only refs, attachments and private operational storage were
outside this review; scanner results cannot prove absence of every secret.

The previous WalletConnect ID is a public client identifier and remains in Git
history. It is now configurable via `VITE_WALLETCONNECT_PROJECT_ID`; production
Vercel builds require it. Control allowed client origins in Reown. Original-code
and asset licensing, sample fixtures, and Vercel configuration were completed in
`8d3cf46` before this dependency remediation.
