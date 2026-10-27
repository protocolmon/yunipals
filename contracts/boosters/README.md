# Yunipals booster packs

Three UUPS proxies implement the shared monster collection, frozen pack registry, and native-funded Chainlink VRF engine. A successful opening burns the complete payment and reserves an original token ID. The VRF callback draws and mints automatically. Originals earn rolling, banked credits; each has a sparse, independent permutation of its eligible variants. Offspring earn no credits.

**Dependencies and checks.** Solidity 0.8.30, OpenZeppelin contracts and upgradeable contracts 5.4.0, Chainlink contracts 1.4.0, forge-std 1.9.7 (commit `77041d2ce690e692d6e03cc812b57d1ddaa4d505`). The installer verifies npm SHA-512 integrity and the pinned forge-std commit. Dependencies and generated build outputs are ignored by Git.

```sh
python3 contracts/boosters/install-dependencies.py
forge test --root contracts/boosters
python3 scripts/boosters/check-storage.py
pnpm test:boosters
pnpm typecheck
pnpm build:web
```

The ordinary test run skips the network fork. To verify the real Base PROTO burn and wrapper request entirely in local fork memory:

```sh
BOOSTER_FORK_RPC_URL=https://mainnet.base.org BOOSTER_FORK_BLOCK=52607968 \
  forge test --root contracts/boosters --match-contract ProtoForkTest -vv
```

The pinned fork proves that 1 PROTO is removed from supply and 1 backing PMON is transferred to `burnAddress`. PMON supply itself remains unchanged in this transaction. No transaction is broadcast to Base by these tests. Recheck current token configuration at launch.

**Configuration.** Start from [the draft manifest](config/base-standard-v1.draft.json). The [trait dictionary](config/base-standard-v1.traits.json) maps the launch IDs to the exact supplied names: types 1–11 and colors 1–6 follow the user's order, horns 1–2 are Spiral and Diamond, and glitter 0–1 is No and Yes. These are identifiers for the new collection, independent of legacy Yunipals numbering. Artwork and deployment inputs remain empty. Categories use sorted, unique uint32 IDs, including zero when meaningful. `allowedVariantIds` is either empty (full Cartesian product) or a sorted subset of Cartesian ranks. Both the CLI and registry reject duplicate ranks and unequal marginal rarity. Decoding order is glitter, horn, color, then type, with glitter varying fastest. NFTs use monotonically allocated collection token IDs and independent zero-based variant ranks. For an allowed subset of K Cartesian ranks, NFT variant IDs and metadata filenames are 0 through K - 1; each decodes through the allowed-rank list. Reserved IDs may exist before reveal, and IDs are never reused.

```sh
pnpm --filter @protopals/yunipals-indexer boosters:prepare \
  --manifest ../../contracts/boosters/config/base-standard-v1.draft.json
```

The preparation command validates data and prints calldata; it never sends a transaction. Incomplete drafts cannot produce activation calldata. To activate a complete manifest, set `status` to `ready`, supply the deployed engine, durable manifest/metadata URIs and a nonzero hash of the canonical artwork manifest. First configure a new draft with type ID 0, then use its `TypeConfigured` event's actual allocated ID to prepare activation with `--type-id ID`. Check that the configured draft matches before activating. The metadata base ends with `/`, and variant documents live at `BASE/VARIANT_ID.json`. Content-addressed publication is recommended because an onchain artwork hash cannot make a mutable HTTP host immutable.

The launch defaults charge exactly 1e18 PROTO units, one credit per 86400 seconds (24 hours), unlimited supply, and batches of at most seven. The final 19 October catalog has 11 types, six colors, two horn values and two glitter values: all 264 combinations are eligible. There is no speed boost. The original counts as the first variant, so the final additional credit accrues 263 days after reveal. See [the product plan](../../docs/booster-packs-plan.md) for the exact trait names. Default callback gas is `450000 + 250000 * quantity`. The auditor full-catalog, 512-byte-URI tests measured about 387k for an opening and 1.37m for seven offspring before remediation; verify the final catalog, URI lengths, wrapper limits and gas model before activation. The engine reserves 150k outside its atomic inner mint call. Failure of the inner mint call preserves the same seed for permissionless recovery; it never buys a reroll. Recovery can use more gas than the request-time estimate and reverts if it cannot finish, allowing wallets to estimate sufficient gas. New types require at least 400k base gas and 200k per mint. Exhausting the entire outer callback can still lose delivery, so production gas-envelope checks remain necessary.

**Ownership, burns, and fees.** Opening recipients are the purchasing wallets. Daily requests require the current original owner; ERC-721 operator approvals do not confer claim rights. Pending offspring follow the original until minted. Transfers preserve elapsed time and committed credits. Burning an original forfeits pending mints, unused credits and future rights; an authenticated late callback records the result without minting. Previously minted offspring remain with their current owners. Burning offspring never restores a pool entry.

Native ETH funds the wrapper in the user's request transaction. The engine recomputes the quote and enforces the caller's fee cap and deadline. Request failure rolls back payment, burning and credit reservation together. Successful requests do not offer a PROTO refund for indefinite oracle delays. Excess ETH is returned immediately; wallets rejecting ETH receive withdrawable credit. No administrator sweep can spend that liability. The wrapper's spent fee is not reconciled to actual callback gas afterward.

**Deployment.** `script/DeployBoosters.s.sol` initializes each proxy atomically with `BOOSTER_ADMIN` and uses `BOOSTER_WRAPPER`. It accepts Base and Base Sepolia only, and registers no pack, so deployment alone enables no sales. Supply the administrator and wrapper explicitly, dry-run the script on the intended network, and review Foundry's receipts before publishing addresses and exact deployment blocks. The user selected Base mainnet for the limited live smoke test. The independent re-review dated 20 October clears the original findings and supplies the R-01 checkpoint hardening now applied. Live end-to-end checks remain; a local fork does not establish real oracle delivery. No live deployment is part of the current implementation.

Separate `CONFIG_ROLE`, `PAUSER_ROLE` and `UPGRADER_ROLE` after bootstrap as needed. `pauseSales` affects new purchases for one type; emergency `pauseRequests` affects new engine requests but never fulfillment or saved-seed recovery. Active type setters are frozen. Upgrade authority remains capable of changing logic, so preserve those purchased rules through governance and review.

**Upgrades.** Pause new requests and normally drain callbacks first. Keep all original state, reserved IDs, provenance, request IDs and seeds, permutation slots, ownership, and refund balances. OpenZeppelin's inherited modules use namespaced storage. Their exact dependency version is pinned; application storage layouts have committed baselines. `check-storage.py` checks structural compatibility without compiler-generated type-ID noise, and integration tests upgrade all three proxies while a claim is pending. Updating a baseline is a reviewed migration, not a routine way to silence a failed check.

After changing interfaces, regenerate the shared ABI:

```sh
forge build --root contracts/boosters
python3 scripts/boosters/export-abi.py
```

See [the implementation and rollout notes](../../docs/boosters-implementation.md) for the indexer, frontend, and local browser test.

**Audit re-review, 20 October 2026.** The auditor confirms F-01 through F-09 are fixed, documented or explicitly accepted. F-02 lost-delivery recovery is verified; a never-produced oracle proof remains an explicit liveness dependency. The auditor's additional Low finding R-01 is patched: `checkpointRequestBlock` only persists recent EVM hashes, keeping an incorrect external-store value from becoming permanent. Read [the independent result](../../docs/boosters/audit/response-2026-10-20/audit-response-2/REPORT-RE-REVIEW.txt) and [the implementation response](../../docs/boosters/audit/checkpoint-hardening-2026-10-20/RESPONSE.txt). The owner explicitly accepts single-wallet governance (F-03); this does not remove the upgrade authority or make active rules immutable against upgrades. The revised pack-preparation CLI reads the actual engine wrapper, wrapper overhead and coordinator gas/confirmation limits at one block before emitting ready calldata. Re-run just before activation: Chainlink can change configuration afterwards. New types also reject a mismatched engine registry and confirmations above 200.

**Wrapper incident runbook.** On wrapper disablement, abnormal request age or repeated RecoveryRequired events, pause new requests and sales. Record request IDs, per-request status, affected originals and wrapper/coordinator configuration at a pinned block. Completed and stored-seed requests must not be re-requested. Permissionless recovery remains available for stored seeds even while requests are paused or the wrapper is disabled. For missing seeds, obtain the original fulfillment transaction and use the original-proof recovery procedure below. A proof that the oracle never produces cannot be reconstructed independently. Any wrapper migration for existing originals requires an independently reviewed UUPS upgrade that preserves the original request authentication and entropy, handles request-ID collisions across wrappers and retains all ownership, pool and refund storage. Registering a new engine only serves future types. Rehearse the exact migration on a state fork; resume only after source, roles, pending callbacks and collection accounting are checked.

**Contract-wallet recipients.** Minting intentionally does not call ERC721Receiver during the oracle callback. Only hold originals in a wallet/contract capable of managing these ERC-721 tokens. Pending offspring are minted to that original's current owner; transferring into a vault or other contract without NFT withdrawal support can strand both the original and its offspring. There is no administrative rescue or recipient override.

**Storage review.** BoosterAdmin must remain stateless unless new fields use a separately reviewed ERC-7201 namespace. Existing gaps are deliberately not resized in this remediation. The prefix checker does not prove gap consumption or inherited namespace safety; any OpenZeppelin upgrade or added storage requires a full layout/migration review. No storage baseline was rewritten for these fixes.

**Lost-callback recovery (F-02 reviewed).** `restoreRandomness(requestId, proof)` verifies the original Chainlink proof onchain and saves the exact original word; then `recover(requestId)` performs the usual mint. Anyone may submit either operation, with ordinary transaction gas. There is no second VRF purchase, reroll, administrator seed setter or PROTO refund. The opening clock starts when its verified result is first saved. Transfers, burned rights, committed quantities and duplicate protection use the existing rules. Recovery emits the usual indexer events, making the existing **Finish reveal** action available after restoration.

Each new request records its chain, original block, coordinator and coordinator blockhash store in a separate ERC-7201 namespace. The same pinned Chainlink verifier derives word zero. Recent EVM block hashes, permissionless checkpoints or the original coordinator's store authenticate the block. For expired hashes missing from the store, verified parent headers can backfill in batches of at most 64; no caller can simply assert a hash. The captured store retains its original trust assumptions. See [the recovery review brief](../../docs/boosters/audit/vrf-recovery-2026-10-19/RESPONSE.txt) for the exact formulas and limits. Old requests created before this version have no recorded context and are not automatically repaired by an upgrade.

Prepare unsigned repair transactions with the original fulfillment transaction hash from the coordinator or its batch router:

```sh
pnpm --filter @protopals/yunipals-indexer boosters:recover-vrf \
  --engine ENGINE --request REQUEST_ID --sender YOUR_WALLET \
  --fulfillment ORIGINAL_FULFILLMENT_TX_HASH --output restore.unsigned.json
```

The tool reads Base, matches the request/block/wrapper, simulates the cryptographic verification onchain and estimates gas. It never signs or sends. Once that transaction confirms, use **Finish reveal** in the app, which estimates the separate mint transaction. If normal fulfillment wins the race, the proof transaction reverts harmlessly; inspect the latest status. Request pauses and wrapper disablement do not stop proof recovery.

For delayed requests, proactively preserve the block hash before 256 blocks elapse:

```sh
pnpm --filter @protopals/yunipals-indexer boosters:recover-vrf \
  --engine ENGINE --request REQUEST_ID --sender YOUR_WALLET \
  --checkpoint --output checkpoint.unsigned.json
```

For older requests this mode prepares a 64-header backfill from a recent anchor. After signing and confirming each prepared transaction, repeat with the printed `--anchor BLOCK` until reaching the request block, then prepare the original proof. If the captured Chainlink store already has the historical hash, call `restoreRandomness` directly: it consults the store without persisting that hash. `checkpointRequestBlock` now requires a recent EVM hash and rejects expired blocks. Header preparation uses an archive-capable RPC and rejects serialization/hash mismatches. Long uncheckpointed gaps can require many batches; this is an exceptional manual runbook, not an unattended service.

If Chainlink never produces or discloses the original proof, this path cannot invent it. Keep that oracle-liveness limitation explicit; do not abandon or re-request the same commitment based on a timeout.

**Repaired openings and live testing.** The reveal clock starts when a valid result is first saved, including proof restoration after a lost delivery. Days between the lost callback and restoration earn no credits. The request-ID and word-zero formulas follow the pinned Chainlink 1.4.0 coordinator; re-check compatibility before accepting a coordinator migration. The engine has limited EIP-170 code-size headroom; do not add features without a size check.

The auditor recommends a Sepolia live run before mainnet; the user has selected a limited Base mainnet smoke test instead. This is a scope difference, not evidence that the live tests have passed. Keep sales disabled while deploying. Verify an actual opening, a 24-hour claim, a seven-card batch after sufficient accrual, and original-proof recovery under the wrapper's own key before a public launch. A forced proof-recovery exercise belongs on an isolated disposable test deployment. Making only the inner mint call fail saves the seed and exercises `recover`, not `restoreRandomness`; the latter requires a genuinely unreceived callback (`received == false`). Do not deliberately break delivery for real collection holders.
