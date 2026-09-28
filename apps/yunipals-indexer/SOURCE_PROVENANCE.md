# Source provenance

The base app comes from the Git-tracked snapshot in
`/root/protobits/services/yunipals-indexer` at commit
`d267fdbac68f5ada824de45297dbd9d2c0bd0728`. Its own provenance records an
import from `/root/indexer-next` on 18 September 2026. That running checkout is
not available in this workspace, so this import does not claim production
parity. The snapshot includes the 21 September persistent-404 metadata retry
fix (`d267fdba`). It precedes the September 22–23 collector patch, which was
merged here from `patches/collector-indexer/collector.patch`.

The collector patch references metadata publication and chain-readiness modules
that are absent from the available snapshot. Its imported routes currently use
the snapshot's metadata tables and have no archive-mode readiness check. Compare
those modules and all other post-snapshot source against the running checkout
before treating this app as a replacement for that service.

The BNB worker was consolidated from this repository's former
`packages/bnb-indexer` into `lib/bnb`. Its source schema is shared by the
four-chain read-view migration and the BNB-only migration.

Environment files, credentials, generated Ponder state, database backups,
host-specific service definitions, and the snapshot's private rarity package
archives were excluded. Local rarity calculation is limited to supplied metadata
scores; see the README for the production cutover gate.
