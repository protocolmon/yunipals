# Dependency compatibility

The root `pnpm.overrides` and `pnpm.patchedDependencies` keep RainbowKit 2.2.11
and its wallet integrations usable with the selected dependency versions.
Install from the workspace root with `pnpm install --frozen-lockfile`.

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

The build generates `/THIRD_PARTY_LICENSES.txt` from bundled package notices and
[supplementary license texts](../licenses/browser-supplement.txt), linked from the
production footer. Recheck the supplement when updating its named packages.
