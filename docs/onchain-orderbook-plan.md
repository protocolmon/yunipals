# Plan: a rebuildable marketplace with a shared indexer and API

Status: BNB discovery, wallet publication and trading integration are live in
production. The first real BNB listing was published and bought; an independent
empty-database replay reconstructed its publication and filled state from BNB
chain data. See the [rollout status](bnb-onchain-rollout.md). This document
records the design and acceptance criteria used for the rollout.

The original build order and acceptance checks are in
[BNB implementation plan](bnb-onchain-remaining-implementation.md).

## Outcome and scope

Keep the shared indexer, database and marketplace API. Anyone should be able to run the open-source marketplace with their own infrastructure and provider credentials, and reconstruct the supported orderbook without a Yunipals database export or a request to the Yunipals-operated API.

| Data | Source for rebuilding | Role of our backend |
| --- | --- | --- |
| Ethereum, Base and Polygon orders | OpenSea, as in the existing integration | Publish to OpenSea, synchronize/cache orders, prepare transactions and check current chain state |
| New BNB orders | Seaport publication events on BNB | Discover/reconstruct orders once, persist a searchable view and check current chain state |
| BNB NFT ownership and settlement | Chain state and events | Use the public BNB ownership indexer in this repository |

OpenSea remains an external service requiring appropriate API access. BNB's equivalent order source in this plan is the blockchain. Our database can retain cached orders, jobs and transaction records, but must not be the sole source needed to discover a published supported order.

Only new BNB orders are in scope. Record a launch block; no legacy-order import, compatibility layer or migration is required. Browser-side history scanning and removal of the backend are not requirements.

## 1. Add shared BNB order discovery

Implement the [detailed discovery plan](bnb-order-discovery-plan.md) as a task in the existing marketplace worker, alongside the public BNB ownership indexer. All visitors read the same indexed results through the API.

- Consume `OrderValidated` from the existing Seaport 1.6 deployment. Decode and filter for the supported collection and order policy.
- Reconstruct currently usable components from the event and maker counter; verify the emitted hash at a consistent finalized block.
- Persist publications and a restartable scan cursor in Postgres. A fresh instance rebuilds from the launch block or the proven rolling active-order window.
- Follow indexer-next's free-first RPC routing and durable budgets. Start with five-minute reconciliation, deduplicate state reads and allow bounded wakeups after verified publications.
- Serve cached responses without starting a chain scan or full orderbook refresh on each visit. Return coverage/freshness information when synchronization is incomplete.

The [revised cost estimate and bounded qualification](bnb-discovery-costs.md) model one shared worker. With 25 candidate orders and five-minute reconciliation, incremental discovery RPC cost is approximately $0.77/month at a 10% paid-read fraction, or $7.67 if all those reads are paid. Hosting, other indexers, OpenSea, transaction preflight and wallet gas are separate. The measured three-call historical qualification used 112 paid CUs; it is not a sustained-scan benchmark.

Acceptance: two independently configured instances, each starting with an empty discovery database, reconstruct the same supported open orders at the same finalized block. Neither needs the other instance's API or database.

## 2. Publish BNB orders on-chain

- Reuse existing order construction and API preparation where useful. The wallet publishes through Seaport `validate([order])`; an accepted private database row no longer establishes publication.
- Maker publication can use an empty Seaport signature. Preserve original components, expected hash and wallet transaction recovery data.
- Keep NFT/WBNB approval checks and wrapping separate from publication. Verify receipts and the expected event before showing confirmed publication.
- An optional transaction-hash hint can wake discovery promptly. Verify it on-chain, deduplicate it and apply rate/budget limits. Orders published through another client must still be discovered without a hint.
- Keep the current smart-wallet, replacement, rejection and reload recovery handling.

Acceptance: an order published using instance A becomes available through instance B's independent scan, with no shared application database or order-submission message between instances.

## 3. Integrate with existing trading

- Keep the API, React hooks, availability checks, collection joins and cached marketplace reads. Adapt BNB queries to event-derived records instead of rebuilding the frontend around direct RPC scans.
- Adapt fulfillment and cancellation to reconstructed orders and on-chain validation. Existing signed-order storage constraints must not be bypassed with invented signatures or lifecycle values.
- Reuse current owner/lifecycle, balance, approval, currency, recipient, counter, expiry and status checks. Discovery alone does not establish executability.
- Preserve frontend transaction-intent checks and exact simulation. Recheck before execution and after approvals; five-minute browsing data is not sufficient trade authorization.
- Keep OpenSea orders published to OpenSea and in-app buying/listing on the existing supported chains. Local pending jobs remain operational state, not a replacement public orderbook.

Acceptance: purchase, offer acceptance, cancellation and replacement work against an isolated BNB fork through either independently hosted instance. Cached browsing requests do not trigger upstream scans.

## 4. Make independent hosting reproducible

Document and test the frontend + API + worker + Postgres + public BNB ownership
indexer setup. Include migrations, grants, startup commands, public
chain/contract/launch configuration, provider URLs and budget settings. The
server's four-chain metadata indexer is outside this BNB order-source scope.

Each operator supplies their own database, RPC and OpenSea credentials. Keep provider keys on that operator's backend. Frontend API/indexer URLs must be configurable; no Yunipals hostname, production database snapshot or shared private token may be required to reconstruct the orderbook.

Provide fixtures for development without paid services and a disposable rebuild procedure. Local presentation settings, pending operations and private operational records are distinct from public order data; rebuilding listings does not imply recovering every instance's private settings.

Acceptance: a clean installation can rebuild the BNB active orderbook from RPC and synchronize the OpenSea orderbook with its own provider access while Yunipals-operated API hosts are blocked. Historical OpenSea availability remains subject to the provider; this is not a promise that OpenSea is decentralized.

## 5. Verify and cut over

- Test event reconstruction, counters, restart/reorg recovery, provider/budget failure, malformed orders and independent-instance rebuilding. Keep new publication/trading disabled until discovery passes its checks.
- Record the launch block before the first supported publication. Stop creating new private-only BNB orders when switching the UI; keep the API/indexer services.
- Existing orders are outside the new feed. No migration transactions or recovery bundle are required. Excluding an order does not cancel it on Seaport.
- Keep previews and a rollback path. Remove only obsolete private-only BNB publication code after verification; preserve shared OpenSea and collection-indexer infrastructure.
- Update setup instructions, fixtures and disclosures when behavior actually changes.

## Existing implementation to reuse

| Responsibility | Location |
| --- | --- |
| Seaport construction, hashing and events | `packages/yunipals-market-core/src/seaport.ts`, `seaportEvents.ts` |
| BNB policy, validation and execution | `apps/yunipals-market-api/src/bnb` |
| Worker and indexed reads | `apps/yunipals-market-api/src/worker.ts`, `src/reads` |
| SQL migrations, checkpoints and leases | `apps/yunipals-market-api/src/db` |
| Free-first routing and durable budgets | `apps/yunipals-market-api/src/rpcBudgetProxy.ts`, `src/opensea/rpcComputeBudget.ts` |
| OpenSea synchronization | `apps/yunipals-market-api/src/opensea` |

References: [Seaport interface](https://docs.opensea.io/docs/seaport-interface), [event definitions](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ConsiderationEventsAndErrors.sol), [OpenSea SDK](https://docs.opensea.io/reference/opensea-sdk).
