# Marketplace release handover

`marketplace-consumer.mjs` reviews each consumer independently. An unrelated
shared-indexer release can preserve marketplace progress instead of replaying
sale history or clearing the BNB discovery feed.

Stop the affected worker and wait for its in-flight pass to finish. Configure
its existing policy/history settings and candidate shared-source selectors. Use
`MARKET_MIGRATION_DATABASE_URL` for the operational migration owner; the source
connection needs read access to both retained release schemas and their control
ledger. The owner connection needs temporary-table privileges. No new runtime
privileges or schema migration is required.

```sh
node dist/marketplace-consumer.mjs collection-sales:base
node dist/marketplace-consumer.mjs collection-sales:base --apply 0x<review-hash>
```

The other consumer names are `collection-sales:ethereum`,
`collection-sales:polygon`, `bnb-sales` and `bnb-discovery`.

Review output includes `impact.mode` and `impact.reason`:

- `unchanged`: the exact release and consumer configuration are already selected.
  Applying is an idempotent no-op.
- `preserve`: the consumer configuration, complete source definition, canonical
  cursor boundaries, retained event history and receipt qualifications match.
  The switch replaces the release identity while retaining the cursor (including
  a partially consumed page), checkpoint/coverage, discovery rows, preview/live
  mode and activity snapshots. It increments the consumer generation to fence
  old workers and requalifies only verified receipts against the candidate.
- `replay`: the consumer/source changed, there is no usable cursor, or history
  continuity cannot be proven. Applying uses the existing reset/replay path.

Preservation checks run in a consistent, read-only source snapshot. They compare
events in both directions through the cursor target/completed boundary, including
raw logs, decoded arguments and receipt requirements. Every retained receipt
qualification must reference a matching candidate event in the consumed prefix
and valid, complete receipt evidence. Both releases must retain canonical block
witnesses for the cursor boundaries. A stopped previous indexer is supported;
its registered schema/build must still be readable. Missing/expired witnesses
never count as a match. Retain them using the ordinary canonical-anchor tooling
before the switch if necessary.

The review hash binds the operational state and continuity proof. Apply takes
the existing worker locks and repeats verification before changing anything.
Changed cursors, qualifications or evidence require a new review. Replacement
registration, receipt qualifications and immutable review history commit in one
operational transaction; errors roll everything back. Runtime identity fences
and foreign keys remain enabled. Source/database failures abort without silently
approving a reset.

If a rebuild is intentional, or the old source is no longer readable, request
and review an explicit replay:

```sh
node dist/marketplace-consumer.mjs bnb-discovery --replay
node dist/marketplace-consumer.mjs bnb-discovery --replay --apply 0x<review-hash>
```

The flag must be present for both review and apply. There is no unchecked
“preserve” override. Legacy-to-shared transitions still replay.

Changes to marketplace decoding or projection semantics must change the
consumer configuration identity, or explicitly request `--replay`. Matching
indexer history alone does not prove that a changed marketplace decoder would
produce the same derived records.

The tool makes no RPC calls. Verification is a deployment-time database scan,
not a recurring worker or request-path cost. It does not restart services,
change other source selectors, restore previously discarded progress, or make
multiple consumer/database switches atomic. Resume the compatible worker with
the selected release and perform the normal source and public API checks.
