# Arena source rollback with preserved private work

This is a compatibility implementation and local proof. It does not establish production replay parity, backup restoration, database grants, deployment acceptance, or the observation window in the unified-indexer plan. No production source has been changed by these tests.

## Source selection

Keep the operational Arena database in `indexer_mode='unified'` during both forward operation and rollback. The compatible native readers/workers continue using the same durable opening identities, encryption contexts, provider UUIDs, reservations/costs, adjudications, film manifests, signed transaction bytes/nonces and client hashes. Running the old side-effecting binaries against the operational database is unsupported and remains fenced.

Rollback selects an isolated old public projection through `ArenaRollbackSource`. Its own scanner may run in `legacy` mode in that separate database. The adapter reads only `deployment`, `tournament`, `chain_event` and `credit`; it never copies that database's private records into the operational database. Runtime and the source-switch CLI reject a rollback endpoint whose PostgreSQL server/database identity matches the operational database.

`ARENA_INDEXER_MODE=unified` continues to select compatible consumer semantics. Set `ARENA_INDEXER_SOURCE_KIND` to `unified` for shared Ponder or `legacy_rollback` for the old public projection. `ARENA_INDEXER_DATABASE_URL` identifies the selected read database. For Ponder, `ARENA_INDEXER_RELEASE_ID` is its pinned release. For rollback it is the identity returned in the reviewed target: a digest of hostname, port, database name, contract, start block and ABI. Usernames, passwords and URL query parameters are excluded from that digest and from review output.

The operational selector records a UUID epoch. A runtime captures the selected epoch and refuses another kind, source identity or later epoch. Workers running before the first selector publication are refused once that publication exists. `/health` and `/config` expose the selected source kind and epoch; `/health` requires actual source readiness.

## Coverage and actions

The old projection must have a complete cursor at or beyond the accepted operational floor and a coverage observation newer than three minutes. Its deployment address/start must match, its mode must be `legacy`, and it must not be halted. The adapter verifies Base, a recent latest head, the cursor block/hash, and the accepted floor block/hash using bounded RPC point reads. These are not log-range scans.

Opening identity is derived from the exact `TournamentOpened` transaction/log identity and block hash, using the same digest as native Ponder. An old numeric tournament ID does not replace an adopted origin. Opening/public state, supported event names, complete-block bounds, and `InputFrozen` input/commitment proofs must agree. Missing or malformed evidence throws; it is never interpreted as an empty successful source.

Native action checks still compare canonical opening/last/freeze blocks and the current contract phase/input/result at one recent head. Switch review also checks the current published film hash for settled tournaments. A complete old cursor is not labeled Ethereum finality: the transaction adapter returns `finalizedThroughBlock=null`, leaving finality audits to actual chain point checks.

If the old source is behind a new entry, that entry remains `indexing` until its block is covered. If its public state differs from the current contract, dependent actions wait. A legacy scanner following Ethereum-finalized blocks therefore has a temporary recovery delay. This does not add a block buffer to normal shared-Ponder operation.

Operational transactions record a monotonic accepted complete-block watermark when their source check succeeds. The switch also includes existing client receipt blocks, canonical execution receipt blocks, the previous accepted floor and the operator's recorded cutover floor. It refuses a target below their maximum. The operator-supplied block/hash is required by the CLI so earlier work predating the new watermark is not silently assumed covered.

## Fencing

Native admission signing, transaction signing/broadcast and provider requests hold a shared session advisory lease through the actual external call. Private operational transactions hold its shared transaction counterpart through commit. The reviewed source switch requires the exclusive lease. An in-flight call causes a busy refusal; it is allowed to finish and retain its saved response before retrying the switch. Every native runtime must run this lease-aware compatibility artifact before source publication. A pre-migration-9 native binary does not honor this lease and must be stopped/replaced; a contract cannot retract a raw transaction already signed by an obsolete key holder.

Migrations 9–12 add the watermark, selector and immutable switch ledger, require a halted compatible deployment and a matching review before changing the selector, and forbid deleting the selector to bypass its epoch. Selector changes acquire the exclusive lease even if issued as SQL. Each review must name the exact current predecessor epoch/kind/source, so retained reviews cannot be replayed to re-enable an earlier epoch. The operational watermark cannot be directly lowered or deleted, and its writes must match the selected source. Migration 10 permits deliberate teardown of deployments that only have a derived watermark; deployments with immutable switch history remain protected. Previously applied migration SQL/checksums are retained.

Ordinary operational roles require `SELECT` on `source_selection`/`source_switch_history` and `SELECT, INSERT, UPDATE` on `source_operational_cursor`. Only the cutover role should insert switch-history records or insert/update the selector. Neither role needs `DELETE` on these tables. The isolated source account requires read access to its four public tables and ordinary PostgreSQL database/server identity functions. Production grants remain a rollout gate.

## Review and apply

1. Keep the old public projection caught up in isolation, or restart only its scanner. Disable its old signers, admission/provider workers and API writers. Retain the operational database and original media storage.
2. Install and verify the lease-aware compatibility artifact in every native runtime, then stop affected consumers at clean boundaries and halt the operational deployment. Record the last accepted block/hash from the approved cutover record and operational evidence. Keep the currently selected source environment unchanged while running the switch command.
3. Supply the target URL through a protected environment variable. The command accepts its variable name, not the URL. Run the built command without `--apply` to review:

   ```sh
   node dist/arena-source-switch.mjs \
     --target-kind legacy_rollback \
     --target-database-env ARENA_ROLLBACK_DATABASE_URL \
     --minimum-block RECORDED_BLOCK \
     --minimum-hash 0xRECORDED_HASH
   ```

4. Inspect the returned accepted floor, source identity, durable opening/input witnesses, and private-table counts/digests. Review is bounded to 1,000 durable identities and 10,000 rows per private family; larger deployments require a measured extended rehearsal. It checks known private origins and the latest 30 target tournament IDs. This is a switch gate, not a replacement for the plan's full fixed-boundary dataset comparison.
5. Repeat the identical command with `--apply 0xREVIEW_HASH`. Apply rebuilds the review while holding the exclusive fence. Changed private records, selectors, origins, inputs or floor cause refusal. The publication transaction appends history and updates only the source selector; it does not rewrite private work or restore a backup. It can operate when the current Ponder source is unavailable, using the saved accepted watermark and current verified target evidence.
6. Configure all compatible runtimes with the returned rollback source identity, the isolated target URL and `ARENA_INDEXER_SOURCE_KIND=legacy_rollback`. Restart them, verify the epoch/source/coverage and retained media, then unhalt. Keep the source-selection epoch and review with the rollout record.
7. Before returning to Ponder, catch its release up beyond the same accepted floor. While halted, review and apply the same command with `--target-kind unified --target-release-id 0xPINNED_RELEASE` and an environment variable holding its URL. Restart consumers with the Ponder kind/release and recheck the new epoch before unhalting.

Do not change `indexer_mode` back to `legacy`, relabel private rows as legacy, delete identities to recreate them, reset a cursor to repeat work, or overwrite the operational database with an older dump. If an accepted opening is missing or changed in the target, source switching refuses it until explicit origin reconciliation. Legitimate orphaned response histories remain retained; this command does not decide a new branch's rights for them.

## Local evidence and limits

`src/arena/live/rollback.test.ts` uses PostgreSQL 16 with an isolated old-source schema (query remapping models a separate database). It executes legacy identity adoption, preserves encryption AAD, submissions, permits, fighter snapshots, frozen disclosure evidence, adjudications, immutable publications and client hashes, resumes one already-charged response by its saved UUID without a new POST, and resumes one saved signed transaction without signing new bytes. It then switches back to the native source and checks the same film pointer.

The remaining cases reject stale/insufficient coverage, changed input/opening, source changes during an actual provider call, direct SQL selector changes through the lease, stale review hashes, and selector/history deletion or mutation. Provider calls and chain responses are stubs; transaction signing uses a disposable local key. No real provider request, production write or mainnet broadcast is part of this test.

The native workflow regression run includes intake/admission/disclosure, provider/media adoption, client tracking, transactions and durable identity tests. The separate actual-contract Anvil lifecycle uses a receipt-fed handler ledger. A subsequent [real Base RPC smoke test](real-rpc-sync.md) now runs actual `ponder start`, short reorg recovery and crash/restart against a separate local node. Real multichain synchronization and historical production replay remain unproven. Distinct-database grants/connection identities, real old-source catch-up, full fixed-boundary parity, protected backup restore, production forward/rollback rehearsal and the observation period remain required.
