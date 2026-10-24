# Inactive native generation runtime

Rebuild this immutable candidate runtime from public commit `4aa5f2b0` on
`codex/indexer-monorepo`. Later revisions add separately packaged publication
libraries and intentionally differ from this builder's exact application pins.
Use a separate checkout at that revision when running this v2 builder or its
build tests; the installed artifact remains unchanged.

This immutable package contains four entrypoints: unpublished generation
preparation, the existing combined refresh, the recurring leaderboard worker and
leaderboard-only completion. Its digest is `f81cdb76…`. The preparation entry
builds and validates a candidate without changing active reader data.

The builder binds 37 source and resolution inputs to the acknowledged consumer
baseline, with five explicit application changes. Three package/lock snapshots
and two existing RPC input snapshots retain the accepted dependencies and
configuration. It installs no dependencies and changes no retained source.
Reproduce against the application source recorded in the manifest, including
the preparation branch in commit `c250fd83`. Subsequent source changes require a
separate artifact; this builder deliberately refuses different input bytes.

Four build/relocation controls reproduce all ten artifact files byte for byte.
Four real-filesystem installer controls cover a fresh install, drift refusal and
retained installation algorithms. The application preparation tests separately
cover twenty actual PostgreSQL groups. The public preparation and manifest files
record these fixed source/output hashes; actual host receipts remain private.

The reviewed installer is read-only by default. It validates the exact incoming
payload, Node executable and external package entries against the retained
runtime inventory. Installation requires its current review hash and creates
one new directory plus a protected receipt. It performs no application import,
database query, provider call or service action.

On 24 October the exact package was installed in its separate production
directory. An independent check revalidated the receipt, layout and dependency
entries and syntax-checked all four entrypoints. The preparation unit was absent;
no generation, publication, worker selection or reader switch occurred.

Actual execution still requires acknowledged read admission, native metadata
readiness, complete recovery procedures and sufficient workspace. The measured
capacity check requires about 47.73 GB free on root while maintaining the existing
25 GB reserve and 30 GB abort threshold. The observed 40.58 GB does not pass.

The newer caller-owned leaderboard/publication helpers are not included in this
package. They need their own immutable library and coordinated cutover owner.
Recurring worker selection must retain its original capacity configuration and
receive only the separately reviewed generation-retention selector; the one-shot
preparation capacity file is not a recurring-worker configuration.
