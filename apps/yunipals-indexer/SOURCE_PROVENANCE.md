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
on private Polkamon package archives. Those parts remain outside this import
pending an explicit dependency decision. The checkout defaults to
`METADATA_SOURCE_MODE=legacy-http`; archive mode was a candidate, not the active
source mode in the checked environment.

The BNB worker was consolidated from this repository's former
`packages/bnb-indexer` into `lib/bnb`. Its source schema is shared by the
four-chain read-view migration and the BNB-only migration. The production
checkout's BNB worker predates this consolidated worker, so the newer local
worker was retained. There is one BNB ownership writer in the repository.

Environment files, credentials, generated Ponder state, database backups,
host-specific service definitions, and the private package archives were
excluded. Local rarity calculation is limited to supplied metadata scores; see
the README for the production cutover gate. This source comparison did not
change the remote checkout, services, database, or routing.
