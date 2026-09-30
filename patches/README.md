# Dependency compatibility

The root `pnpm.overrides` and `pnpm.patchedDependencies` keep RainbowKit 2.2.11
and its wallet integrations usable with the selected dependency versions.
Install from the workspace root with `pnpm install --frozen-lockfile`.

- **Ponder reorg readers:** Ponder 0.17.5 drops and recreates reorg triggers in
  a way that can block long-lived collection readers. The patch packages the
  verified production trigger-toggle fix into the pinned dependency. Keep its
  version and patch together; compare the generated runtime with the protected
  production copy before deploying. The helper source and production SHA-256
  are recorded in `ponder-reorg-triggers.mjs`.
- **Ponder dependency security:** scoped overrides update its Node adapter to
  1.19.17, Drizzle to 0.45.2, Kysely to 0.28.17 and Vite to 6.4.3. Its retained
  Vite Node 1.0.2 also uses Vite 6.4.3. Ponder remains at 0.17.5 with the reorg
  patch above. Before changing these pins, run the dedicated PostgreSQL check
  described below; a typecheck alone does not exercise migrations or rollback.
- **Legacy metadata dependencies:** the original Polkamon archives are retained
  for deterministic rendering and rarity calculation. Scoped overrides remove
  their unused Solana and Ethers SDK dependencies, including unpatched
  `bigint-buffer` and `elliptic` paths. Only the deep metadata/rarity entrypoints
  used by `legacy.cjs` are supported; their general blockchain SDK entrypoints
  are unavailable. Axios 1.18.0, its cache interceptor 1.11.1, Lodash 4.18.1 and
  BN.js 5.2.5 replace the vulnerable transitive versions. The ordinary indexer
  suite replays archived response families with network access and removed SDK
  imports blocked. Keep the archive hashes and scoring version unchanged while
  this output remains identical.
- **Frontend Zod peer:** Zod 3.25.76 is explicit in the web manifest to preserve
  its previous Wagmi/Viem peer resolution. Removing the legacy SDK graph would
  otherwise let pnpm select Zod 4 and introduce a wallet peer mismatch.

- **RainbowKit / UAParser:** only RainbowKit's UAParser dependency is pinned to
  MIT-licensed 1.0.41. RainbowKit uses its named `UAParser` export to select desktop
  download links. The patch accepts v1's `Mac OS` name as well as v2's `macOS`.
  RainbowKit stays at 2.2.11, including its wallet-detection and security fixes.
  Revisit the pin and patch together when upgrading RainbowKit.
- **Query String / URL decoder:** `decode-uri-component@0.5.0` fixes the malformed
  percent-encoding denial-of-service finding. Query String 7.1.3 is CommonJS, so
  its patch reads the new decoder's ESM `default` export. This works in the Vite
  bundle and on the repository's required Node 24.18.1. Keep the patch while
  retaining this decoder override.
- **Cuer / QR encoder:** Cuer 0.0.3 asks for `border: 0`, which QR 0.6.0 and 0.7.0
  reject. Its patch requests one padding module and removes that ring from the
  returned matrix, as documented in QR 0.7.0's encoder. This preserves Cuer's
  finder positions and RainbowKit's existing visual padding, fixing the
  WalletConnect QR-screen crash without changing wallet connectors.
- **UUID:** older MetaMask dependencies use the named `v4` API. UUID 11.1.1 fixes
  the bounds-check advisory and retains CommonJS support, unlike newer ESM-only
  major releases.
- **WebSocket / YAML / Coinbase:** patched releases stay within the corresponding
  major versions. Refreshing the lockfile also updates `sha.js` under the legacy
  Coinbase alias; the ordinary Coinbase override does not affect that alias.

Run `pnpm test:dependencies` after changing these versions. It exercises platform
detection, QR encoding, WalletConnect query round trips, a timeout-protected
malformed-input case, and MetaMask's UUID API. Also run the frontend/API suites,
type checks, production builds, and wallet browser checks. Keep the API's Viem
2.38.0 pin until a separate update handles newer HTTP/RPC error classification.

For Ponder compatibility, create an empty local PostgreSQL database named
`yunipals_ponder_dependency_test` and run:

```sh
PONDER_DEPENDENCY_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/yunipals_ponder_dependency_test \
  pnpm --filter @protopals/yunipals-indexer test:ponder:postgres
```

The check resets `dependency_check` and `ponder_sync` in that dedicated database.
It refuses remote hosts, a different database name and URL query overrides.
It builds the real config/schema/handlers through Vite, applies sync migrations,
creates the production table shapes and indexes, and verifies multichain rollback
while an open reader retains its snapshot. It also checks trigger restoration and
subsequent journaling. It does not use a live RPC or production database.

The build generates `/THIRD_PARTY_LICENSES.txt` from bundled package notices and
[supplementary license texts](../licenses/browser-supplement.txt), linked from the
production footer. Recheck the supplement when updating its named packages.
