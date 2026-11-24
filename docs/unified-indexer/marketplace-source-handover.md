# Marketplace release handover

`marketplace-consumer.mjs` reviews each consumer independently. An unrelated
shared-indexer release can preserve marketplace progress instead of replaying
sale history or clearing the BNB discovery feed.

First run a read-only review while the old source is still available. Configure
the review process with the existing policy/history settings and candidate
shared-source selectors, without changing the serving workers or APIs. Use
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
  continuity cannot be proven. Normal apply refuses this result before any
  operational mutation. `applyAllowed` is false unless `--replay` was explicitly
  requested. This includes initial/legacy registrations.

Review **all affected consumers before stopping the current source**. Require
`preserve` or `unchanged` for a routine handover. A blocked review leaves the old
source serving: repair missing boundary witnesses, wait for candidate coverage,
or investigate changed history before trying again. Do not automatically add
`--replay` in deployment automation to get past the gate.

Once every preflight passes, stop the affected workers and wait for their
in-flight passes to finish. Review again to bind their final positions, then
apply those fresh hashes. The live preflight hash will usually have expired
because the worker advanced; it is not a reservation or authorization for a
later cursor. Keep old schemas and block witnesses through apply and rollback.

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

The flag must be present for both review and apply. Its review hash differs from
the blocked default review, so a default review cannot authorize a replay. There
is no unchecked “preserve” override. Intentional replay can interrupt live
history and discovery; it is a maintenance decision, not a routine deployment
fallback. Legacy-to-shared transitions still replay with this explicit review.

Changes to marketplace decoding or projection semantics must change the
consumer configuration identity, or explicitly request `--replay`. Matching
indexer history alone does not prove that a changed marketplace decoder would
produce the same derived records.

The tool makes no RPC calls. Verification is a deployment-time database scan,
not a recurring worker or request-path cost. It does not restart services,
change other source selectors, restore previously discarded progress, or make
multiple consumer/database switches atomic. Resume the compatible worker with
the selected release and perform the normal source and public API checks.

Deployment acceptance must include every affected consumer's fresh checkpoint
and public activity response, with verified coverage and acceptable freshness;
Ponder readiness alone is insufficient. Retain the prior source for rollback
until these checks pass. A blocked review is not permission to publish another
part of a coordinated handover.

This gate prevents an accidental live replay; it does not implement background
rebuilds. A future background rebuild needs separate derived tables, cursors and
receipt qualifications, with the old projection continuing to serve. Publication
must switch the API binding, checkpoint and qualifications together after parity
and freshness checks. Running two replay workers against the existing live
tables is unsafe. The current tool also cannot eliminate interruptions from
provider outages, reorgs or unrelated source switches.
