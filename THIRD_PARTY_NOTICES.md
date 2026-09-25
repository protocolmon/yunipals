# Third-party dependencies and assets

The root MIT license covers original Yunipals code. Dependencies retain their own
copyright, license and notice requirements. The package metadata inventory is in
[docs/audit/dependency-licenses.json](docs/audit/dependency-licenses.json).

Production web builds generate `dist/THIRD_PARTY_LICENSES.txt`, available through
the footer's **Software licenses** link. It includes bundled package license and
NOTICE texts, plus [supplementary notices](licenses/browser-supplement.txt) for
nested metadata, prebundled wallet components, and packages that omit full license
files. Keep this file with redistributed web builds. API distributions must also
retain the notices in their installed runtime dependencies.

## RainbowKit and UAParser

RainbowKit 2.2.11 is MIT licensed and remains in use. A scoped override selects
MIT-licensed UAParser 1.0.41, with a compatibility patch for macOS detection.
The current installed dependency inventory contains no AGPL package. See the
[patch documentation](patches/README.md) before updating either dependency.

## MetaMask SDK

This application uses `@metamask/sdk@0.33.1`,
`@metamask/sdk-communication-layer@0.33.1`, and
`@metamask/sdk-install-modal-web@0.32.1`.
**Copyright ConsenSys Software Inc. 2022. All rights reserved.**

Their bundled license grants use and redistribution for its defined
**Non-Commercial Use**, requires this notice, and applies the same notice and use
restriction to the resulting application and further distributions. One of its
qualifying conditions is no more than **10,000 monthly active users across all
versions and platforms globally**. It also defines personal/noncommercial and
specified institutional uses. The exact terms, including ConsenSys's discretion,
are reproduced in the supplementary notices and generated license file.

Operators and redistributors must satisfy those terms or obtain separate
permission from `metamask.license@consensys.net`. The MIT license on original
Yunipals code does not grant broader rights to the bundled SDK. Publishing the
source alone does not waive this condition. On 2026-09-22, the project owner
confirmed that Yunipals meets the user-count condition above. This repository does
not measure traffic; operators must continue to satisfy the applicable terms.

The SDK analytics package declares MIT in metadata, while its source repository
contains the ConsenSys license; the supplement retains both declarations with
their provenance instead of treating the entire SDK as MIT.

## Other notices

- `@metamask/eth-json-rpc-provider@1.0.1` omitted its license declaration. Upstream
  [restored the missing ISC license](https://github.com/MetaMask/eth-json-rpc-provider/commit/69d7d5d073de339766117658ea23293870a45e11);
  that text and provenance are included in the supplement. The metadata scanner
  continues to show Unknown for the unmodified published package.
- `@ethereumjs/rlp`, `@ethereumjs/tx`, `@ethereumjs/util` and
  `webextension-polyfill` use MPL-2.0. The supplement includes its full text and
  publisher source-archive links for these unmodified components.
- Tooling/data dependencies include CC-BY, CC0 and Blue Oak licenses. Preserve
  their package notices when redistributing the tooling or its data; the browser
  notice generator describes the browser bundle, not the complete development
  installation.

For collection artwork and third-party brand assets, see
[ASSET_LICENSE.md](ASSET_LICENSE.md). For current findings and validation, see
[the audit](docs/open-source-audit.md).
