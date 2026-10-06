# Exomon Solana indexing

The worker reads the 10,000 archived Exomon mint mappings from the active
`metadata_source` release. It renders metadata locally and uses Helius DAS
`getAssetBatch` only for current ownership, burn and delegation observations.
The default 15-minute scan uses ten DAS requests, normally 100 credits. Every
attempt reserves credits in `solana_indexer.rpc_usage` before the request.

The code and service template are release artifacts. The service must be pinned
to an immutable monorepo release and given a root-readable
`/etc/yunipals-indexer/solana.env` containing `HELIUS_API_KEY` and
`SOLANA_SYNC_ENABLED=true`. The main API does not need the key. Set
`SOLANA_API_ENABLED=true` only after a full published scan has been reviewed.
Legacy metadata owner overlay has the separate flag
`SOLANA_LEGACY_METADATA_ENABLED=true`.

Run `solana:migrate` with the intended database role, then `solana:sync` once
and inspect `solana:status`. Confirm a 10,000-asset manifest, the expected
published count, zero unexplained missing assets, bounded credit usage and
case-sensitive wallet addresses. A missing DAS asset never proves a burn.
Rehearse migration, scan resume, API, and backup/restore in disposable
PostgreSQL before altering a live service.

The first live scan on 2026-10-05 found two DAS assets with `burnt=false` and
an empty owner:
`DZVsCoVF2sV15cgm1LRN56ucYxMBsgFfxPk7YASvQ8MY` and
`GdfTdfy4bfqy4EframXYoJVLYvMdZXpNDMRfHWCoqxmK`. Treat them as unknown
ownership. Production explicitly sets `SOLANA_MAX_MISSING=2`; any additional
unknown asset fails publication. The API returns 503 for these known mints
until DAS provides a valid owner. The published scan contained 9,998 valid
assets: 9,177 active and 821 burned. The two exceptions are never counted as
burned or assigned their historical owner.

`solana:preflight` reserves ten credits in the same ledger as scans. A normal
ten-batch scan costs 100 credits, and the default per-scan, UTC-day, and
rolling-31-day caps are 500, 15,000, and 500,000 credits. `solana:manifest:audit`
validates the archive without using RPC. A complete failed scan with only an
excess missing count can be reviewed and published with `solana:publish -- <id>`
after raising the explicit exception limit. The publish guard requires the
latest run, matching manifest checksum, all staged assets, and a scan younger
than 30 minutes. Do not restart a failed partial scan just to bypass a guard.

The production source is `/root/yunipals-exomon`; its runtime artifact is
`/opt/yunipals/releases/exomon-20261005-v1`. The credential is in
`/etc/yunipals-indexer/solana.env`, mode 0600. The additive schema migration
ran after a fresh directory-format PostgreSQL backup at
`/var/backups/yunipals-exomon-before-20261005` (see its checksum manifest).
The existing EVM indexer, BNB indexer, metadata worker, and collector keep
their pinned artifacts. The API uses a later pinned artifact preserving the
live projection, read-cache, and query-capacity fixes.

Rollback the API by removing its Exomon systemd drop-in and restarting only
`yunipals-api.service`. Stop and disable `yunipals-solana.service` to stop DAS
usage. Leave `solana_indexer` tables intact for audit and a later resume;
dropping them also removes the durable credit ledger and is not part of a
routine rollback.

The API requires explicit `chain=solana`. Unfiltered requests retain the
existing EVM default and mixed Solana/EVM requests return 400. Solana details
include observed ownership changes, not a complete transaction history.
Solana signed visibility is unsupported. Keep the production API's current
projection, cache, and query-capacity release paths when producing its next
immutable artifact.
