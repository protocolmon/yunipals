# Upcoming portal card counts

The grading schedule shows a connected wallet's currently matching cards. This is an informational snapshot, not a reservation or a guarantee of eligibility when the window opens. The picker and submission retain their existing contract checks.

## Read path

`GET /v1/boosters/portal-card-counts?owner=<address>&grading=<address>&collection=<address>&portalIds=1,2,...`

- Accepts at most 11 distinct positive uint256 portal IDs. All addresses are validated and normalized.
- Uses the configured booster deployment and indexed grading configuration. The API does not accept caller-provided gates or pack types.
- Opens a repeatable-read, read-only database snapshot and requires a healthy indexer and the new source definitions. Refuses partially processed blocks, unknown portal/config rows, and missing tables with HTTP 503. An unavailable source is never reported as zero matches.
- Materializes the owner's holdings once using the owner index; joins primary-key card facts and pending-spell records; counts the matches for all requested portals. No collection-wide history scan, wallet pagination, artwork loads, RPC client, or external calls are involved in this endpoint.
- Applies the same pack type, known card facts, color, type, original-only, sequence wraparound, glitter and diamond-horn conditions as `PortalGrading.matches`. Also excludes burned cards, other owners, retired portals and cards with a pending grading request.
- Each SQL statement has a 3-second timeout. The frontend has an 8-second request deadline, caches by wallet/deployment/portal set for 30 seconds, and refreshes every 30 seconds while the page is visible. Countdown ticks and the existing active-portal polling do not change this cache key. Spell submission invalidates the existing `portals` query family.
- HTTP responses are not shared-cacheable. Disconnected wallets make no count request. Errors have an explicit unavailable state and retry control.

## Indexer changes and rollout

This feature needs a **new replayed unified indexer release**, not an API-only deployment:

1. The monster source ABI now includes `CardFactsRecorded`, including historical imported facts. Never infer sequence from token ID or count missing facts as initialized.
2. The grading source adds `Initialized` and `Upgraded`. At ingestion, the indexer reads grading configuration at the event block. At each `PortalMinted`, it reads the immutable `portalRecord` at the event block. These are ingestion-time enrichment reads, not user-triggered RPC calls. Historical RPC access is needed for replay.
3. The new Ponder tables hold recorded card facts, grading configuration, immutable portal gates/retirement, and pending spells. Ponder journals and reverses them with the existing ownership projections on a reorg. Completion removes the matching pending request.
4. Replay from the configured deployment start blocks into a new physical schema, including initialization, card-fact imports, portal mints and all grading requests/completions. Register the new manifest/build and recreate the release-bound portal read views. Grant the booster API reader SELECT on the new tables plus `indexer_source` and `canonical_event` in that schema. Existing schemas must not be partially backfilled or repointed in place.
5. Verify the source is ready, sample eligible counts, and time the aggregate with representative large wallets. Then switch the API source and publish the UI using the private deployment tooling. If the UI is published first, it shows “Count unavailable” until the new source is ready.

Keep operator-specific commands, release identities, hosts, credentials and production verification/rollback records in the private operations repository. No production deployment is performed as part of this change.

## Validation

- `test/portal-card-counts.test.ts`: SQL eligibility, batched counts, empty/unavailable distinction, source boundaries, input validation and a 10,000-card wallet against a 110,000-card fixture; checks the owner index is used.
- `scripts/test-boosters-ponder.mjs`: compiled card-fact ingestion and duplicate delivery.
- `scripts/test-portal-shared-ponder.mjs`: real PostgreSQL/Ponder rollback of configuration, gates, retirement and pending completion.
- Home web `scripts/test-portal-picker-ui.mjs`: count badges, one batch request, polling isolation, retry, disconnect, and existing selection/mobile behavior.
