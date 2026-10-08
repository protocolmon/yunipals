# Legacy Island collections and withdrawal

The Islands collector tab at `/collector/:wallet?collection=islands` includes wallet NFTs and verified stakes. The Islands explorer offers **All holdings** and **Staked** without requiring a wallet; `/?collection=islands&holding=staked` links directly to verified stakes across the collection. Selecting a wallet also offers **In wallet**. Holding filters combine with edition, numeric sorting and pagination, and clearing a wallet preserves **Staked**. The API uses `holding=all|wallet|staked`; explicit `wallet` requires an owner, while `staked` can span all verified staking wallets. The API still returns the staking contract as `owner`; `staking.staker` identifies the verified collector. Existing clients that omit `holding` keep direct-ownership semantics. Islands remain outside monster scores and rarity rankings.

The supported Ethereum contracts are the Island NFT at `0xa22e2f53ca787414dc0643c399f92234949e2305` and legacy staking at `0x6baad25b4807860e9fc3a0d2b6d1da4c895cfca8`. No new staking, reward dashboard, bulk withdrawal or replacement contract is introduced.

## Attribution and freshness

`start:islands-staking` reconstructs custody from existing Ponder Transfer history at one finalized Ethereum block. It verifies the collection address, custody balance, each NFT's owner, and each candidate depositor's `stakedIslandsOf` membership. A direct transfer into custody without membership is never assigned to its sender as a stake. Unknown custody remains visible as unverified on the NFT detail page.

The worker publishes positions and scan status atomically in two additive metadata tables, separate from Ponder's tables. It checks the finalized block hash and rereads the indexed deposit history and build before publication. API joins require the same Ponder build, token lifecycle and exact latest deposit event. Withdrawal, restaking and replay invalidate old attribution immediately. Errors mark the scan unavailable; data older than 15 minutes is excluded. Scans run every five minutes with bounded, multicall-batched RPC reads. Recent stakes can remain pending until finalization and the next scan.

Lists expose `total`, `complete` and `stakingStatus`; details expose `staking` and `stakingStatus`. If verification is disabled, stale or missing current deposits, `complete=false` for stake-inclusive lists. The UI displays that incompleteness and a retry action; directly held NFTs remain readable. `/staking-status` is scoped beneath `/v2/collections/ethereum-islands`.

## Wallet flow

The verified staking wallet reviews the gas estimate and automatic reward claim, switches to Ethereum when needed, and signs `unstakeGenesisIslands([id])`. Every submission repeats live custody/membership checks and simulation after any network switch. No token approval or backend signature is needed. Simulation also catches the contract's pause restriction; exhausted reward status does not block withdrawal.

Transaction hashes are retained locally by wallet and token for confirmation recovery after reload. A timeout offers confirmation checking rather than another send. Success requires both a successful receipt and the correct NFT Transfer from staking to the connected staking account, including for transaction replacements. The receipt triggers collection refresh; detail and collector reads poll during indexer catch-up. Gas is an estimate; the wallet presents the final fee.

## Deployment

1. Build and test the candidate release. Use the existing isolated Islands physical schema, not the monster schema. No Ponder contract/table changes or replay are required.
2. Run `pnpm --filter @protopals/yunipals-indexer islands:migrate` with the Islands schema-owner credential. The new statements append to the existing migration ledger.
3. Grant the Islands API role SELECT on `metadata.island_staking_scan` and `metadata.island_staking_position`. The staking worker needs reads on the Islands token/transfer/checkpoint/build tables, plus SELECT/INSERT/UPDATE/DELETE on these two metadata tables. Keep the API role read-only.
4. Configure the new worker with `DATABASE_URL`, `DATABASE_SCHEMA` and `PONDER_RPC_URL_1`; adapt `deploy/yunipals-islands-staking.service` to the actual release and private environment-file paths. Run `islands:staking:sync` once and inspect custody/verified/unverified counts, then supervise `start:islands-staking`. It has an advisory lock scoped to the physical schema.
5. Start the updated API with `API_ISLAND_STAKING_ENABLED=true`. Verify `/staking-status` reports ready, wallet/staked/all counts reconcile, and token detail and cursor behavior are correct. Observe unknown custody separately; do not invent a staking wallet.
6. Build the website with `VITE_ISLAND_STAKING_ENABLED=true`. Confirm the collector tab and wallet-filtered Islands browser against the deployed API.
7. Enable `VITE_ISLAND_UNSTAKE_ENABLED=true` in a separate website build after the fork and browser gates below pass. Wallet transactions are always initiated by the user.

Rollback visibility and withdrawals independently using the website flags. Disable API attribution with `API_ISLAND_STAKING_ENABLED=false` and stop the worker if necessary; normal NFT ownership remains available. Keep the additive tables. They are derived and can be regenerated from Ponder history and on-chain state after restore; do not serve a restored stale scan as current. The worker never needs legacy MongoDB or the retired metadata ownership endpoint.

## Validation

- Indexer PostgreSQL tests cover combined pagination and counts, direct transfers without membership, withdrawal, restaking, expired scans, replay/build changes, burns, RPC failures, contract custody mismatches, block-hash changes and disabled reads.
- Frontend tests exercise preflight checks, fee estimation, membership changes and receipt validation against unrelated/reverted/replaced transactions.
- `test:islands:staking-fork` accepts only a loopback Anvil fork and reverts snapshots. On the inspected deployment, #1, #8 and #9 returned to their stakers, disappeared from staking membership and paid the remaining claimable reward exactly; all three were exhausted. Pausing the contract blocked withdrawal. These are fork transactions, not live Ethereum withdrawals.
- `test:islands:staking-ui` uses the disposable API/database fixture and a local fork to exercise personal holdings, unavailable verification, network switching, wallet rejection, reward disclosure, withdrawal confirmation, retained collection visibility and mobile layout.

Run typechecks, `pnpm test:web`, `pnpm test:indexer`, and the production web build. Fork test:

```sh
ISLAND_FORK_URL=http://127.0.0.1:18547 pnpm --filter @protopals/yunipals-home-web test:islands:staking-fork
```

For browser verification, run a fresh loopback mainnet Anvil fork on port 18547; use only fork impersonation for the fixture staking wallet. From the indexer package run `ISLAND_STAKING_UI_FIXTURE=true node --import tsx scripts/island-staking-ui-fixture.mjs`. This creates a disposable PGlite database and serves real Islands API routes on loopback port 18548. From the web package run Vite on loopback port 5188 with both website flags enabled and `VITE_YUNIPALS_INDEXER_URL=http://127.0.0.1:18548`. Run `test:islands:staking-ui` with `PLAYWRIGHT_MODULE` pointing to an installed Playwright module. The fixture's control endpoints modify only its in-memory database. Restart the fixture between successful runs.
