# Source provenance

The base app came from the Git-tracked snapshot in
`/root/protobits/services/yunipals-indexer` at commit
`d267fdbac68f5ada824de45297dbd9d2c0bd0728`. Its own provenance records an
import from `/root/indexer-next` on 18 September 2026. The snapshot includes
the 21 September persistent-404 metadata retry fix (`d267fdba`).

On 28 September 2026, the current `/root/indexer-next` checkout was compared
read-only over SSH. Its `lib/api/server.ts` and `lib/api/openapi.ts` match the
recorded originals in `patches/collector-indexer/manifest.json`; the collector
patch applies cleanly to that checkout. The newer metadata source migrations,
archive storage, publication schema, chain readiness, and related verification
scripts were then reconciled into this app. The checkout's metadata archive
reader, renderer, publisher, main API changes, and local rarity calculator depend
on three pinned Polkamon package archives, now included under `vendor/`. The
runtime modules and parity fixtures were imported from the checked-out source.
The checkout's `.env` leaves
`METADATA_SOURCE_MODE` unset, but active systemd drop-ins load
`METADATA_SOURCE_MODE=archive` and `RARITY_READ_SOURCE=local`. The running service
therefore requires those remaining modules and dependencies for parity.
After applying the collector patch, the app's `lib/` tree matches the checked
checkout outside `lib/bnb/`. The newer consolidated BNB implementation is the
intentional exception.

The BNB worker was consolidated from this repository's former
`packages/bnb-indexer` into `lib/bnb`. Its source schema is shared by the
four-chain read-view migration and the BNB-only migration. The production
checkout's BNB worker predates this consolidated worker, so the newer local
worker was retained. There is one BNB ownership writer in the repository.

Environment files, credentials, generated Ponder state, database backups,
host-specific service definitions, and one-off host cutover scripts were
excluded. The three vendor archive SHA-256 values are:

| Package | SHA-256 |
| --- | --- |
| `util-essentials-27.3.3` | `b765a47078cc6a7037bca88d2c1b02e86c620bdbeb0a98e42f582ab3b38c4e12` |
| `web3-util-core-30.8.3` | `3b4d233afea82af42b58792f0166c3d38c050d78cd7c21bea9b8215419fcb368` |
| `web3-util-pmons-31.15.1` | `3312decd5e2a1501d4ab757fb1bcaca5a18296697e8be1d988d923fa87bc5e4e` |

This source comparison did not change the remote checkout, services, database,
or routing.

## Exomon Solana release, 5 October 2026

The preceding notes describe the earlier monorepo snapshot. The Exomon feature
was developed in the local reconstructed worktree `/root/yunipals-exomon` on
`feature/exomon-solana`, starting from deployed monorepo release `f0bd9a0` and
overlaying the later deployed API implementation `9a2bb8a-read-api`. The core
feature is local commit `320687b`; the authoritative upstream Git checkout was
unavailable. See `/root/yunipals-exomon/docs/exomon-source-provenance.md` for
reconciliation details. The runtime artifact is
`/opt/yunipals/releases/exomon-20261005-v1`. Its inherited
`capacity-release.json` describes the API base, not the Exomon feature.
