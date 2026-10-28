# ETH pack payments

Buyers choose YPAL or ETH. The ETH payment contract buys the exact pack price via
WETH/PMON (Uniswap V3, 1%) or WETH/PROTO (Uniswap V2, then unwraps PROTO). It wraps
PMON to YPAL and funds `BoosterPacks.openPacksFor` in the same transaction. The
existing engine burns the YPAL and creates the normal independent requests.
Randomness and NFT minting finish asynchronously. One wrapper displays all cards.

The buyer is bound to the payment contract's `msg.sender`. Engine events retain
the buyer as payer, so existing indexer projections need no schema change or
reindex. Receipt validation accepts only the configured adapter, binds request
counts to actual transaction input, and checks each request's payer against the
transaction sender. Purchases, collection ownership and replay keep the engine's
existing identifiers.

## Deployment

1. Build and test the contracts with Solidity 0.8.30, via IR, optimizer runs 1.
   `BoosterPacks` runtime is 24,552 bytes (24 bytes below EIP-170). Three compact
   custom errors replace internal payment/proof dependency error strings to fit.
   Storage fields, existing requests, rules and proof recovery remain compatible.
2. The unsigned package in `apps/yunipals-home-web/src/lib/fixtures/eth-payment-package.json`
   pins the current Base engine, previous implementation and runtime hash,
   dependencies, candidate bytecode and constructor arguments. CI compares its
   bytecode against the build. Regenerate after contract changes:
   ```sh
   cd apps/yunipals-home-web
   node scripts/boosters/prepare-eth-payment.mjs src/lib/fixtures/eth-payment-package.json
   ```
   This performs public RPC reads and writes the review package; it never signs.
3. Open `/boosters/setup/ypal?payment=eth` with the deployment owner on Base.
   Review and confirm the four steps: implementation deployment, payment contract
   deployment, engine upgrade, then `PAYMENT_ADAPTER_ROLE` grant. Transactions are
   saved immediately and deployment hashes can be restored. Bytecode, constructor
   input, deployment sender, runtime, dependencies and upgrade predecessor are
   checked before continuing. A grant can be revoked using the engine's existing
   access control.
4. Verify source for both deployed candidates on BaseScan using the compiled
   standard JSON, optimizer runs 1 and `viaIR`. The payment constructor is
   `(engine, YPAL, PROTO, WETH, V2 router, V3 router)` as pinned in the package.
5. Set `VITE_BOOSTER_ETH_ADAPTER` to the confirmed payment contract address when
   deploying the web app. Checkout appears only after its immutable dependencies
   and engine role grant match the selected deployment. There is no default address.
6. Check the first real purchase's swap, YPAL burn, buyer ownership, collection
   entry and replay. Local fork results are not evidence of a real purchase.

To disable ETH purchases, revoke the adapter's engine role. Keep its configured
address so old replay links and refund withdrawals remain usable. Ordinary YPAL
purchases and daily claims continue through their existing entry points.

## Quotes and refunds

The review compares both executable routes including estimated Base L1/L2 gas.
It caps acquisition at 0.5% above the quote and randomness separately with the
existing 10% buffer. The quote expires after ten minutes. Before submission,
wallet identity, activation, simulation and available ETH are checked again.
The reviewed calldata and caps are never silently replaced. If either swap or
opening request reverts, the entire purchase rolls back; gas is still charged.

Acquisition surplus is returned by the adapter; unused randomness budget is
returned by the engine. Each has buyer-owned refund credits if a receiver rejects
ETH. The openings panel exposes both withdrawal actions. Reentrancy guards and
balance deltas protect credits and pre-existing balances across purchases.
Only the two fixed routers may send ordinary refunds to the payment contract.

## Verification

```sh
python3 contracts/boosters/install-dependencies.py
forge test --root contracts/boosters
python3 scripts/boosters/check-storage.py
BASE_FORK_RPC=https://base-rpc.publicnode.com forge test --root contracts/boosters \
  --match-contract BoosterEthPaymentForkTest -vv
cd apps/yunipals-home-web
node --experimental-strip-types --import ./scripts/register-typescript.mjs --test \
  src/lib/boosterEth.test.ts src/lib/boosterEthSetup.test.ts \
  src/lib/boosterReveal.test.ts src/lib/boosterPurchase.test.ts src/lib/boosterPermit.test.ts
```

The fork test upgrades the existing proxy locally, checks all 49 storage slots
and an original, exercises both live liquidity routes for 1/3/5/10 packs, and
simulates authenticated oracle callbacks to check card ownership. It uses only
read calls against Base; all state changes occur on the disposable fork. It does
not generate or claim a real Chainlink proof. Offline tests cover slippage/VRF
bounds, output mismatches, reverted purchases, route access, daily claims,
refund rejection, forced donations, count bounds and the existing engine suite.

For the checkout browser check, start a disposable Anvil fork on local port 8598
with chain ID 8453. Run `node scripts/boosters/prepare-eth-ui.mjs` from the web app
folder; it refuses non-local RPCs and checks that the endpoint is an Anvil fork.
It writes `/tmp/yunipals-eth-ui-fixture.json`. Configure the dev server with that
fixture's adapter, the package's engine/registry/collection/YPAL addresses and
`VITE_BOOSTER_LAUNCH_ID=base-ypal-v1`, then run:

```sh
node scripts/test-boosters-eth-ui.mjs --url http://127.0.0.1:5199 \
  --manifest /tmp/yunipals-eth-ui-fixture.json \
  --playwright /path/to/playwright-core/index.mjs --chromium /path/to/chromium
```

The test redirects the application's Base reads to the fork and signs only
local transactions. It checks the ETH review, cancelled confirmation, exactly
one submitted transaction without approval signatures, immediate loading, saved
history after reload and mobile layout. Reports and screenshots stay in `/tmp`.
