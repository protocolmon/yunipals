# Yunipals arena contracts — Base mainnet preparation

**Status: implemented and tested locally; not deployed and not connected to public paid entry.**

See [the mainnet launch plan](../../docs/arena/mainnet-launch-plan-v1.md) for remaining contract changes, application integration, policy decisions and launch checks.

User approved Base mainnet and **2 USDC per participant**. Four entries make an
8 USDC pool: **75% / 6 USDC to the winner**, **5% / 0.40 USDC to the island owner**,
and **20% / 1.60 USDC to operations**. Approved settings are in
`config/launch-economics.json` and `.env.example`. Joining is allowed for seven days
from first paid entry; strategies get twenty-four hours after the roster and island are
ready. These approved windows are in `config/launch-timing.json`. The referee gets twenty-four hours after input freeze. Public operational addresses
and the exact deployment settings are now prepared in `config/deployment.mainnet.env`;
remaining launch-policy confirmation is still pending.
Existing test fixture amounts and 50/10/40 splits
exercise generic contract behavior; they are not the launch configuration.

The deployer is the initial admin and operations treasury. Admin ownership can move
through `transferOwnership` and `acceptOwnership`. The owner can call `setTreasury`
to change the operations recipient for newly opened lobbies. Each lobby snapshots its
treasury, preserving existing tournament allocations and already claimable rewards.

## Deployment wallet

Foundry **v1.8.5** is installed on `yunipals-main` (`168.119.172.10`) in
`/opt/foundry/v1.8.5`, with `cast`, `forge`, `anvil` in `/usr/local/bin`.
The official Linux amd64 archive was verified against release SHA-256
`6c66ffcc55fa4249197721baa3098bc208014ea1d8aa04b2ed50ac6bccffb226`.

In the user's own SSH terminal:

```sh
ssh root@168.119.172.10
umask 077
cast wallet import yunipals-arena-deployer --interactive
```

Foundry prompts privately for the key and an encryption password. The encrypted
keystore is `/root/.foundry/keystores/yunipals-arena-deployer`. Share only its public
address in chat. No key or password belongs in source code, shell arguments, `.env`,
deployment artifacts, or chat. An interactive deployment can unlock this keystore
in the user's terminal without sharing its password with an agent.

## Reproducible build

```sh
python3 contracts/arena/install-dependencies.py
python3 scripts/arena/build_contract_pool.py
cd contracts/arena
forge build
forge test -vv
```

Toolchain: Foundry 1.8.5, Solidity 0.8.30, Cancun target, optimizer 200, via IR.
Dependencies: Chainlink contracts 1.4.0, OpenZeppelin 5.4.0 (npm integrity hashes
checked), forge-std 1.9.7 (commit pinned in installer). Dependency source licenses
remain in `lib/`. `lib`, build caches, broadcast records and `.env` are ignored.

## Contract behavior

- Deployment starts with entry paused. Owner opens numbered lobbies, preventing arbitrary
  callers from creating unlimited operator-funded VRF requests. Server admission tickets
  provide another admission/rate-limit boundary.
- All four supported Yunipals collections can enter noncustodially. The central server
  attests ownership with a short-lived EIP-712 permit. Base ownership is also checked
  onchain; Ethereum, Polygon and BNB ownership requires the server's finalized read.
  A join binds the seat to its paying wallet. Later NFT transfers do not transfer that seat.
- A distinct NFT can hold one active seat across tournaments. One wallet may enter distinct
  NFTs; four seats do not prove four distinct people. Semifinals are seats 0–1 and 2–3.
- First paid join requests one Chainlink VRF v2.5 native-paid word. Wrapper:
  `0xb0407dbe851f8318bd31404A49e658143C982F23`. 10 confirmations, 120,000 callback gas.
  The callback only stores the bound word. Anyone can finalize its island afterward.
- Immutable pool: Base replacement islands `0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168`,
  525 Genesis × 3, 373 Personal × 1 = 1,948 tickets. Hash and full entries are in
  `config/island-pool.json`; generated Solidity contains the exact 898 token IDs.
- Onchain draw version `yunipals-arena/onchain-island/v1` uses rejection sampling over
  `keccak256(abi.encode(domainHash, chainId, arenaAddress, tournamentId, poolHash, word, counter))`.
  Values below `2^256 % 1948` are rejected; ticket is value modulo 1948. This is a **new
  versioned mapping**, not the lab's JSON/SHA-256 mapping. It never requests another VRF word.
- Later entrants can see the selected island before choosing an NFT, as requested.
  This gives later entrants information unavailable to the first entrant. VRF selects the
  island only; it does not select or certify the LLM winner.
- Four seats plus a finalized island opens the strategy window. Prompts remain offchain.
  The server needs all four wallet approvals before freezing their commitments/input hash.
  Each commitment salts the prompt with 32 random bytes. Atomic private intake and public
  reveal are still duties of the server, which can read the prompts before public reveal.
- Only the configured referee can settle the frozen input once. It must identify one
  semifinal winner from each pair and one of those finalists as champion. The published
  result hash binds the offchain evidence. The contract does **not** run/verify the LLM.
- The result is fixed before video production, with all entry money still held.
  After the finished film is published, the referee calls `releasePayouts` with its
  SHA-256 hash. This credits winner, island owner and treasury exactly once. The
  contract trusts the publisher to attest availability; it cannot inspect a video.
  Video failure keeps payouts pending for technical recovery, without changing the
  accepted result or automatically refunding it. Pre-result expiry refunds are unchanged.

## Funds, hosting share and expiry

- Currency, raw entry fee, payout bps, windows and rules hash are immutable per deployment.
  Standard ERC20 or native ETH is supported. ERC20 transfer-in accounting rejects short
  transfers; fee-on-transfer/rebasing currencies must not be configured.
- Entry escrow and unclaimed refunds/payouts are liabilities. The owner can withdraw only
  excess native ETH used for VRF. Entry funds cannot fund randomness, including when
  the entry currency is ETH. First entry reverts atomically if the VRF reserve is too low
  or the wrapper quote exceeds the configured per-request cap.
- Winner and host shares round down; the treasury gets the remainder. Payouts use a
  withdrawal balance: recipients can claim to another address without blocking settlement.
- Treasury updates emit `TreasuryChanged`; each lobby emits `TournamentTreasuryAssigned`
  with its fixed recipient. Neither a treasury update nor an admin transfer moves existing
  claim balances. A fallback hosting allocation uses that lobby's treasury snapshot.
- The hosting beneficiary is the island owner at **island finalization**, not lobby creation
  or VRF callback time. A burned/unreadable island retains its draw and sends any hosting
  allocation to the treasury. No ownership lookup or payout is performed inside the callback.
- An empty lobby has deadline zero and cannot be expired. The first successful paid entry
  starts the seven-day joining window and emits `JoinWindowStarted`; failed payments do
  not start the clock and later entries do not extend it. Four seats plus island finalization
  immediately starts the twenty-four-hour strategy window. Resolution deadline begins when
  input is frozen; its duration is still pending. No early cancel in the draft.
  Anyone may expire a stalled tournament at its deadline, crediting full entry refunds.
  Operator pays sunk VRF costs. No-show strategy penalties are not implemented.
- Expiry preserves request and result audit history, accepts late VRF fulfillment, cannot
  reopen the tournament, and never reveals partial prompts. Timeout refunds do not ensure
  players cannot abandon an unfavorable island and enter a different future tournament;
  admission policy must limit repeated abandonment. No paid lobby is open yet.

## Mainnet deployment procedure (pending configuration)

1. Use the approved economics; agree timeouts and public entry rules. Freeze the rules, referee prompt/schema,
   pool, protocol version and operational addresses in a reproducible deployment manifest.
2. Create a separate restricted server admission/referee signer; keep the deployment wallet
   out of the web process. Supply its public address in configuration.
3. Populate `.env` from `.env.example` with public settings, retaining the approved USDC economics.
4. Run `forge test` and a Base simulation using the production budget proxy; inspect deployment
   bytecode, constructor arguments, gas estimate and resulting address before broadcasting.
5. In the user's own terminal, run the same script with the encrypted keystore. For example,
   **only after the preceding steps**:

```sh
# From the prepared arena contract directory on yunipals-main:
# Public configuration is loaded by Foundry from .env.
forge script script/DeployArena.s.sol:DeployArena \
  --rpc-url http://127.0.0.1:19202 \
  --account yunipals-arena-deployer --broadcast
```

6. Verify source, constructor settings, pool hash and paused state on Base. Fund the separate
   VRF reserve. Record tx/address/block/config receipts; no private wallet material.
7. Finish and verify the live API/indexer/wallet path before enabling paid entry. The local
   `/arena-lab` and its simulated randomness must remain explicitly separate.

## Remaining application integration

The contract package alone is not a live arena product. Required before opening entries:

- Wallet-authenticated private submission using the onchain seat, immutable first submission,
  client salt, four signatures, atomic reveal and durable encrypted storage.
- Ownership admission against the existing indexer, with a bounded fresh finalized read and
  budgeted fail-closed chain checks. No NFT signing permit based only on an unverified cache.
- An event projector with a persistent cursor, block hashes, confirmations and reorg rollback.
  Browser polling reads its database. Reuse the shared RPC coordinator; never scan on page load.
- An operator worker for island finalization, approved input submission, result attestation,
  refunds/status and video job handoff. Frozen outcome is immutable across render retries.
- A production route showing fees, deadlines, draw proof, roster, private prompt status,
  result and claim/refund actions. Public operational keys and economic policy must be fixed.

Primary references: [Chainlink Base deployments](https://docs.chain.link/vrf/v2-5/supported-networks),
[VRF security requirements](https://docs.chain.link/vrf/v2-5/security),
[official Foundry release](https://github.com/foundry-rs/foundry/releases/tag/v1.8.5).

## Restricted lobby operator

`Config.lobbyOperator` may call `openTournament` while entries are unpaused. It cannot
change recipients, pause settings, ownership, admission/referee identities or withdraw
VRF reserves. The owner may rotate it with `setLobbyOperator`; old authority is revoked
immediately. The deployment script requires this public address explicitly.

The launch script also checks the approved Base USDC address, 2 USDC entry, 75%/5%
shares, seven-day joining and twenty-four-hour strategy windows. Initial owner and
treasury must match the deployer. Generated application ABI: `packages/yunipals-market-core/src/arenaAbi.ts`.
