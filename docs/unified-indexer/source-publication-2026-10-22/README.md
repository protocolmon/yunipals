# Unified migration source publication

Status: published in public commit
[`f1c1fc0`](https://github.com/protocolmon/yunipals/commit/f1c1fc0f06c953f40d9767dff75dbaef51f73c80).
Root verified the finite source hashes and secret scan before committing and pushing. The fixed source closure contains 437 files (6,736,490 bytes):
257 new source files, three modified tracked files, and their existing tracked
dependencies. The three publication metadata files are listed separately so the
manifest does not need to hash itself.

Use `new-tracked-paths.json` as the explicit array of 260 new paths to add:
257 source paths plus these three metadata files. Also include the modified
tracked paths listed under `trackedChanges` in `manifest.json`. The manifest
records each source path's exact SHA-256, current entry versions, dependency
edges, and whether it is runtime code, verification, a template, or frozen source.

The four historical sources are preserved under
`ops/unified-indexer-transition/frozen-runtime-source/`. Its manifest maps their
original paths to verified public release digests, hashes and owners. This keeps
the older action reader and three source6 proxy inputs available without changing
the current application source or any existing operator pin.

The reviewed scanner append patch is
`ops/unified-indexer-transition/publication-gitleaks-exact-public-values.patch`.
Root applied its five path-specific `generic-api-key` allowlists. Nine exact public
schema/hash path-value combinations account for the 19 initial findings. The
copied closure, frozen blobs and privateFile source scan with zero findings using
the actual repository configuration, which matches the reviewed append.

Backend and frontend typechecks passed; root-reported log paths are recorded in
the manifest. The corrected privateFile helper passed all 79 root-direct controls.
It also passed read-only qualification in all eight actual unchanged worker
namespaces: loaded values matched their protected sources, stderr was empty, and
no service, database or provider actions occurred. The qualification report SHA-256
is `f0c42f5fe8e3be324f931984ca98dedd6d812470e4bf601b685679be3e994c26`.
This proves compatibility with protected read-only systemd mounts; the running
workers have not been replaced. The parser accepts kernel optional propagation
fields while preserving read-only, ownership, descriptor and mount-line checks.
A later build operator can be published separately once its source and
qualification are final.

Private environment values, database/ownership exports and unredacted private runtime
receipts are excluded. Production operations continue to require their existing
protected configuration, receipts and retained generated artifacts. Public
templates and structural policies are included. Bulk media and unrelated
experimental operator iterations remain outside this finite source closure.

Only explicitly authorized public archives, source files and manifests were read
from production to recover the four historical blobs. No private configuration or
database data was read or transferred. This preparation made no production changes.

The 437-file manifest above remains the immutable published historical snapshot.
The later explicit synthetic-fixture mode correction and actual 79-control
umask077 qualification are recorded separately in
[current-correction-addendum.json](current-correction-addendum.json). The exact
historical baseline archive is preserved by
[frozen-baseline-addendum.json](frozen-baseline-addendum.json). The V1 terminal
fixture failure and fresh V2 preparation/launch remain separate public records;
these additions do not claim a completed V2 runtime build or deployment.

The correction and frozen baseline were published in commit
[`b270265`](https://github.com/protocolmon/yunipals/commit/b270265db73076885dcbf10a85a095b40e1b7f08).
All archived source hashes were verified independently, and both the finite
current-source review and extracted archive passed secret scans before publication.

Later public records separately document the
[completed credential build](../arena-credential-build-success-v2-2026-10-22.json),
[unselected installation](../arena-credential-installed-v2-2026-10-22.json), and
[schema maintenance with runtime recovery](../arena-owner-maintenance-runtime-recovery-2026-10-22.json).
The schema migration passed; the application candidate failed the production
rules-hash guard and its eight owned overrides were removed. Original workers
and their configuration were restored without reverting the schema or private
records. Native Arena adoption requires the complete production feature rebase.
