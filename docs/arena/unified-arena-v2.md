# Shared video and anime arena

The replacement is one Base contract with video and anime modes. The existing
video and anime contracts keep their battle records, films and outstanding
claims. New entries move only after a reviewed browser deployment and native
source transition. The existing anime fighter registry and approved manifests
are reused. No deployment address is predicted or substituted for a receipt.

Video keeps its 2 USDC entry and 6 / 0.40 / 1.60 USDC allocations. Anime keeps its
1 USDC entry and 3.20 / 0.20 / 0.60 USDC allocations. Both keep the published
combat rules, four seats, island pool, strategy windows and publication gates.
Each mode starts paused and has its own pause control. An NFT cannot occupy
active seats in both modes at once.

The first successful join supplies ETH for that battle's Chainlink request in
addition to USDC. The transaction's approved ETH value is its spending limit;
there is no immutable operator-funded draw cap. The contract requires enough
ETH for the actual request and never spends another player's refund balance.
Only one randomness request is made per battle. If two wallets both prepare a
first-entry payment, the later transaction refunds its entire attached ETH.
Unused quote buffer is refunded automatically; a receiver that rejects ETH
gets a withdrawable credit instead of losing its entry. Withdrawals can use a
different recipient, and owner withdrawals cannot consume refund credits.
The used oracle fee is an incurred cost and is not part of refundable USDC
entry escrow if a battle later expires.

Tournament IDs are unique within the shared contract: video uses odd IDs and
anime uses even IDs. Each mode advances independently, avoiding competing lobby
workers opening the same ID. Opening events bind the mode, rules and ID.
USDC claims and native refund credits remain separated by mode.

The indexer registers one new shared-arena event source while retaining both
old sources. Public projections and private operational identities use
`8453:ADDRESS:video` and `8453:ADDRESS:anime` for the new contract only. Historical
identities, ciphertext contexts, provider IDs and signed transaction histories
are retained unchanged. Workers reject a tournament from the other mode.
The existing signer-wide nonce lock continues to serialize shared signers.

Work order: contract and financial tests; shared ABI and indexed mode proofs;
mode-aware runtime/admission/capacity/execution; browser quotes and payment
recovery; browser deployment and legacy battle access; offline end-to-end
verification; signed deployment; native source activation; controlled paid
acceptance. Existing contracts stay available for claims and settlement.
