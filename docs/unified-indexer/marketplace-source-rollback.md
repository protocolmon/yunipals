# Marketplace consumer source rollback

The compatible release can return collection sale history, admitted BNB sales
and BNB discovery to their legacy RPC scanners through an owner-reviewed
command. Migration 29 retains the review history, selects an explicit legacy
epoch and requires fresh receipt qualification under that epoch. Migrations
25–29 are append-only; existing migrations must keep their recorded checksums.

This is an application source switch. It does not restore an old database dump,
delete signed/admitted orders, rewrite original receipt policies or restart
historical binaries. Ownership/API selectors, metadata, Solana and Arena have
their own coordinated rollout/rollback steps. Use the same compatible artifact
on both sides; old binaries do not understand these source fences/epochs.

## Review and apply

Stop the affected shared consumer and wait for its in-flight pass to end. Keep
its original public configuration/cursor for the review. Use the migration
owner through `MARKET_MIGRATION_DATABASE_URL`; never pass a database URL on the
command line. Default execution only prints a review hash.

For a collection, provide the existing history start, a positive legacy depth,
the exact legacy worker policy label and finality mode:

```sh
node dist/marketplace-rollback.mjs \
  --consumer collection-sales:base \
  --start-block VERIFIED_EXISTING_HISTORY_START \
  --confirmations VERIFIED_POSITIVE_LEGACY_DEPTH \
  --policy VERIFIED_LEGACY_POLICY_LABEL \
  --finality finalized
```

Then repeat the identical arguments with `--apply 0x<review-hash>`. The command
does not choose example numbers or infer historical coverage from a moving
head. The compatible production sale worker retains its existing finalized-tag
semantics; staging fixtures can explicitly select confirmation depth. Base's
native zero-depth/latest configuration must return to a positive depth with a
distinct truthful policy label. A changed confirmation model cannot reuse an
old label to relabel original receipts.

For BNB, its existing deployment configuration supplies the approved financial
policy, finalized/depth policy and discovery launch block:

```sh
node dist/marketplace-rollback.mjs --consumer bnb-sales
node dist/marketplace-rollback.mjs --consumer bnb-discovery
```

Review and apply each affected consumer separately. There is no cross-consumer
or cross-database atomic switch. The command requires a currently selected
shared consumer, the migration owner, the exact unchanged operational state,
the appropriate advisory/row locks and an unused review identity. Runtime
roles cannot select an epoch or modify review history. A changing cursor makes
the review stale, so stop the worker and obtain a fresh review.

## Resume the compatible scanner

Set the affected `MARKET_SALE_INDEXER_MODE`, `MARKET_BNB_SALE_INDEXER_MODE` or
`MARKET_BNB_DISCOVERY_INDEXER_MODE` to `legacy` and remove that consumer's
`_DATABASE_URL`/`_RELEASE_ID` selectors. Configure the matching existing RPC and
policy settings. Start the compatible `sale-worker.mjs` or `worker.mjs`
entrypoint from the reviewed release, retaining current offchain/provider
configuration. A mismatched selected legacy policy/finality is rejected before
RPC. The shared worker is fenced by `reader_mode` if it is accidentally left
running. Source selection must not grant another recurring scanner the same
projection concurrently.

Collection/BNB sale rollback marks derived sales/exclusions noncanonical,
removes derived scan anchors, invalidates activity snapshots and resets coverage
to unavailable. It keeps immutable receipt bytes/labels, signed orders, native
source provenance and application jobs. The compatible scanner reads fresh
canonical receipts, verifies its configured chain/runtime/finality, and commits
new epoch-qualified proof hashes together with sales and coverage. Conflicting
receipt bytes fail. Activity requires this current qualification even if the
original receipt happens to carry the same policy label; old evidence cannot
automatically become accepted in a new epoch. Missing/mismatched proofs remain
unavailable. History returns progressively as verified replay advances.

Discovery rollback atomically clears only its derived publication feed and
resets target/hash/error state. It preserves the exact launch block and
preview/live mode. A deliberately old reset timestamp forces the legacy
rolling-window calculation, so matching policy fingerprints do not trigger an
unnecessary replay from a distant launch. Active native rows cannot appear
before the legacy rebuild. Signed/admitted order tables are retained.

The review command itself makes no RPC/provider/signing calls. A successful
application proves selection, not healthy upstreams, replay capacity or API
acceptance. Preserve current RPC caps and perform the normal canonical/replay
and public route checks before declaring recovery complete.

## Return to the shared source

Stop the legacy consumer, verify the shared source has accepted canonical
coverage, and configure the native owner-selected collection history/policy
again (Base uses zero-depth/latest). Run the existing
`marketplace-consumer.mjs <consumer>` review/apply command. It records another
immutable review, removes the active legacy epoch/qualifications and installs a
fresh shared registration. Native receipts must again earn source-specific
qualifications. Both discovery switches clear and rebuild the derived feed;
preview/live mode remains unchanged. Original receipt bodies/policies and
review history are preserved throughout.

Local PostgreSQL checks exercise Base policy changes, stale reviews, runtime
permission rejection, immutable history, positive-depth enforcement, preserved
original receipt bytes, fresh canonical requalification, corrupt qualification
withholding, admitted BNB order preservation and discovery forward/rollback
with rolling-window recalculation. Production application/replay and complete
coordinated rollback acceptance remain outstanding.
