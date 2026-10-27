# Shared indexer server readers

`@protopals/yunipals-indexer-server/readers` provides read-only PostgreSQL adapters for registered Yunipals Ponder releases. It imports no application environment, RPC clients, signing configuration, workers, migrations, or generation providers.

Pass a caller-owned `pg` pool. `createIndexerReader(pool)` selects the published release once; pass `releaseId` to inspect a registered candidate. Recreate the reader for a new request or publication boundary. A retained reader remains bound to its physical schema, build and manifest.

- `status(sourceId, policy)` checks complete coverage, current witnesses, observations and the source's allowed confirmation policy.
- `page(sourceId, policy, options)` returns bounded canonical events and optional full receipt facts. Persist its exact cursor with destination changes. Missing receipts cannot advance completed coverage.
- `snapshot(sourceId, policy, read)` reads domain tables and source evidence in one read-only, repeatable-read transaction. The caller must enforce the returned readiness and keep work short; perform RPC and external effects outside this transaction.

Only internal durable consumers may supply the optional bounded `verifyOldAnchor` callback. Never expose it or a physical schema selector as untrusted HTTP input. Public cursor expiry requires an explicit refresh response. Source generation changes and reorgs invalidate incompatible cursors rather than silently replaying them into existing application state.

`@protopals/yunipals-indexer-server/ownership` adds `readOwnershipToken(reader, definition, tokenId)`. It reads source readiness and the token's state at the permitted boundary in the same snapshot. Tokens changed after that boundary are reconstructed from transfer/lifecycle history, including earlier owners, burns and remints; future mints are absent. Mint and last-transfer evidence must match the canonical journal. Set `requireReady: true` when a consumer must be caught up to its policy boundary.

The ownership module also exposes the SQL fragments used by candidate compatibility views. A data-only SQL result is not a source-health proof: validate `source_status` for every selected collection in the same snapshot before interpreting an empty result as a healthy empty collection. Source predicates must remain explicit to preserve bounded queries and isolate unavailable chains.
