# Source provenance

The base app comes from the Git-tracked snapshot in
`/root/protobits/services/yunipals-indexer` at commit
`d267fdbac68f5ada824de45297dbd9d2c0bd0728`. Its own provenance records an
import from `/root/indexer-next` on 18 September 2026. That running checkout is
not available in this workspace, so this import does not claim production
parity. The snapshot precedes the September 22–23 collector patch, which was
merged here from `patches/collector-indexer/collector.patch`.

The BNB worker was consolidated from this repository's former
`packages/bnb-indexer` into `lib/bnb`. Its source schema is shared by the
four-chain read-view migration and the BNB-only migration.

Environment files, credentials, generated Ponder state, database backups,
host-specific service definitions, and the snapshot's private rarity package
archives were excluded. Local rarity calculation is limited to supplied metadata
scores; see the README for the production cutover gate.
