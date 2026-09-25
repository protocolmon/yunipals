# Remaining implementation: BNB orders published on Seaport

Status: historical implementation plan, written 24 September 2026. On-chain
publication and execution are live in production; this is no longer a list of
pending release gates. See [rollout status](bnb-onchain-rollout.md) for the
current result. The BNB ownership indexer is public in this repository.
Publishing the existing four-chain metadata indexer is a separate project and
is not required for the BNB order source.

## Target and constraints

A new BNB listing or offer is published with the maker's Seaport `validate`
transaction. The chain event, not an API POST, is the recoverable source of its
terms. The shared backend still indexes, filters, serves pages and prepares
transactions. Ethereum, Base and Polygon keep their current OpenSea integration.

There is no import of prelaunch BNB orders. Every operator supplies its own
database and RPC; ordinary browser reads use its API cache. Keep the five-minute
worker cadence initially. Do not add a transaction-hint wakeup until observed
indexing latency justifies its extra request/budget complexity.

## 1. Qualify and harden the read-only worker

1. Run a capped provider qualification through the existing source and
   order-projection RPC routes: verify chain 56, Seaport runtime hash,
   `finalized` support, practical `eth_getLogs` ranges, event decoding and
   counter/status reads at one finalized anchor. Include one real Seaport
   validation receipt on an isolated BNB fork. Count attempts, bytes and CUs;
   stop at the previously proposed 50,000-CU allowance and report actual
   routing/cost before a sustained live scan.
2. Test failed ranges, 429s, oversized single blocks, an anchor change and a
   restart after a partial chunk. Expose scan lag, oldest state observation,
   active-candidate backlog, failures and paid/free RPC usage in existing
   worker health output. A backlog above the 100-order refresh cap must lower
   availability rather than leave old `active` labels looking current.
3. Rehearse migrations through 24 and runtime grants on a disposable local
   PostgreSQL database before deploying an API/worker binary with exact
   migration readiness. Keep BNB actions paused during production preview.

Acceptance: a disposable fork database can rebuild postlaunch fixture orders from a clean cursor;
provider failures leave `coverage: partial`; repeated API GETs make zero RPC
calls; the measured scan remains inside the existing source/projection budgets.

## 2. Bind discovered orders to NFT lifecycle and normal reads

1. At the publication block, derive the NFT's mint/lifecycle from the retained
   collection transfer history. Store the publication lifecycle and its block
   proof in the derived record. If the history is missing or behind, retain the
   publication as `unavailable`; never guess lifecycle zero. Recheck current
   lifecycle, ownership, burn and visibility before showing an actionable
   listing or offer. A burn/remint or transfer out and back must not revive an
   earlier order in the UI. This is an application eligibility rule: it cannot
   cancel a still-valid Seaport order for a third-party fulfiller. The maker's
   cancellation/counter controls and user-facing order terms must remain clear.
2. Add a validated-order branch to `src/reads/orderRows.ts` and the existing
   asset, wallet and collection catalog readers. Preserve source provenance
   separately from the existing signed-order row; do not populate the
   signature-required table with fabricated values. Keep the standalone
   discovery endpoint for diagnostics and use stable pagination/coverage in
   normal reads. A partial or stale discovery feed cannot establish an
   authoritative empty book, floor price or executable order.
3. Define one parser for the reconstructed components and summary. Check the
   published hash, current maker counter and fee/currency policy before the
   summary enters normal reads. Avoid duplicate display if a locally pending
   operation corresponds to the same hash.

Likely files: `src/bnb/discovery.ts`, a new lifecycle projection module,
`src/reads/orderRows.ts`, `orders.ts`, `catalogQuery.ts`, and a new migration.

Acceptance: token, wallet and collection pages show only eligible validated
orders with accurate coverage. A simulated burn/remint, stale transfer indexer,
counter change and incomplete scan remove actionable status without losing
the public cancellation record.

## 3. Publish new BNB orders from the wallet

1. Branch the BNB path in `useOrderCreation.ts`; leave OpenSea publication
   unchanged. Build the constrained listing/offer components with the existing
   policy, fee, time and counter helpers. The maker sends a single
   `Seaport.validate([order])` transaction with empty signature. A different
   sender must supply a valid maker signature, so the UI should require the
   connected maker wallet for the empty-signature path.
2. Simulate the exact calldata and verify wallet account, chain, order hash,
   policy version, owner/lifecycle and prerequisite approvals or WBNB funding
   immediately before submission. Estimate gas for the exact transaction and
   show the wallet's current fee estimate before confirmation. The gas payment
   is the intended publication cost; the old EIP-712 sign-and-POST path is
   no longer used for new BNB orders.
3. Save components, expected hash and pending transaction hash in the existing
   local recovery/pending-transaction model. After confirmation, verify the
   receipt's `OrderValidated` event and wait for the shared indexer to expose
   that hash. Handle reload, replacement hash, rejection and a delayed indexer
   without sending a second validation transaction automatically. Always keep
   cancellation parameters available, even if the API is temporarily down.

Likely files: `useOrderCreation.ts`, a BNB-specific publication module,
`orderRecovery.ts`, `pendingTransactions.ts`, `transactionIntent.ts`,
`marketApi.ts`, and shared Seaport calldata helpers.

Acceptance: an EOA and supported smart wallet can publish listing and offer
fixtures on an isolated fork; a second API instance discovers the same hashes
without an order-submission request to the first API. Failed and ambiguous
wallet transactions recover without duplicate publication.

## 4. Execute, cancel and replace validated orders

1. Give `BnbFulfillmentService` a loader for the derived publication/components.
   Require a current-counter hash match and `getOrderStatus.isValidated` before
   accepting an empty signature. Keep fresh finalized/head checks, indexed NFT
   lifecycle, ownership, approvals, WBNB/native balances and exact `viem`
   simulation; a five-minute browse observation is never a trade quote.
2. Build listing purchase and offer acceptance with the reconstructed
   `OrderParameters` and `signature: "0x"`. Preserve existing actor-bound
   preflight/quote identifiers, short expiries and frontend transaction-intent
   checks. Check status and policy again after prerequisites before the wallet
   submits. Reconciliation should observe fills/cancels from chain without a
   private accepted-order row.
3. Return cancellation components from the derived publication even when its
   browse state is stale or terminal. Keep the maker-only on-chain cancel and
   counter actions. Replacement must wait for confirmed cancellation of the
   exact previous order before publishing a new one.

Likely files: `src/bnb/fulfillment.ts`, `chain.ts`, `recovery.ts`,
`reconciliation.ts`, `src/app.ts`, `useBnbTrade.ts`,
`useOrderCancellation.ts`, and `transactionIntent.ts`.

Acceptance: isolated-fork purchase, offer acceptance, cancel and replacement
work through either independent API instance. Wrong maker, changed counter,
unvalidated hash, missing approval/funding, burn/remint and reorg all fail
closed. OpenSea chain tests still pass.

## 5. Make an independent installation reproducible

1. Use the public BNB ownership indexer in this repository for BNB token,
   transfer and lifecycle data. Do not make the server's private four-chain
   metadata indexer a prerequisite for rebuilding BNB orders.
2. Provide one documented clean-room setup: Postgres schema owner/runtime
   roles, migrations and grants, indexer, RPC proxy/budgets, marketplace API,
   worker, OpenSea credentials and Vite URLs. The web app already has
   `VITE_YUNIPALS_MARKETPLACE_URL` and `VITE_YUNIPALS_INDEXER_URL`; verify the
   complete flow against operator-provided values. Add no paid service to the
   default local fixture path.
3. Start two empty databases and two independent API/worker stacks against
   the same isolated fork. Publish through instance A, block access to A's API
   and database from instance B, and compare supported active order hashes,
   lifecycle, cancellation/fill state and collection views after B rebuilds.

Acceptance: a maintainer can follow public instructions and reproduce the BNB
orderbook without a Yunipals database export or Yunipals-operated API. A full
four-chain site also needs independent collection metadata and each operator's
own OpenSea API access for the other three chains.

## 6. Cut over with a reversible action pause

1. Rehearse migrations/grants and publication-to-trade flow on disposable local
   infrastructure, then deploy the API/worker code with BNB actions paused.
   Verify a production-preview worker restart and complete coverage. Record
   the BNB launch block before the first supported production publication.
2. Enable discovery, wait for complete coverage and current state, then enable
   wallet publication and validated-order trading. At that point disable new
   private-only BNB admission and remove its rows from active browse views.
   Existing orders receive no migration or new support; do not cancel anyone's
   Seaport order automatically. Keep the OpenSea chains unchanged.
3. Monitor scan lag, backlog, RPC CUs, API availability, quote failures and
   transaction confirmations. If a fault appears, pause **new** BNB publication
   and trade actions while preserving discovery and cancellation/recovery.
   Do not silently resume private-only creation after public launch, which
   would split the order source again. Remove obsolete signed-order creation
   code only after the validated path is stable.

Completion means new BNB orders have a chain publication receipt; another
operator rebuilds them from public inputs; existing marketplace pages and
trade actions use that derived feed; and ordinary visits do not increase scan
RPC usage.

References: [Seaport order documentation](https://github.com/ProjectOpenSea/seaport/blob/main/docs/SeaportDocumentation.md),
[Seaport event definition](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ConsiderationEventsAndErrors.sol),
[Seaport validate interface](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ConsiderationInterface.sol),
[Alchemy CU method costs](https://www.alchemy.com/docs/reference/compute-unit-costs).
