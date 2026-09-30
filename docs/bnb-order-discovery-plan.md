# BNB order discovery: shared indexer build plan

Status: discovery and the public BNB ownership indexer are implemented and
tested locally. The worker remains disabled until a launch block is configured.
The bounded provider qualification and historical log scan are complete; a
full production-preview worker run and production migration remain open.

## Deliverable

Add a BNB publication-discovery task to the existing marketplace worker. It
reads Seaport events, reconstructs supported orders, stores a rebuildable
Postgres view and serves it through the existing API. Use the public BNB
ownership indexer for collection transfer and lifecycle data and reuse the
server's free-first RPC approach where available.

The independence test is a second self-hosted instance rebuilding from public sources with its own credentials. Ordinary browsers consume cached API data. No browser history scanner, IndexedDB orderbook engine, public Alchemy key or backend-retirement work is needed.

Support orders published from a recorded launch block only. Existing orders need no import or migration. Wallet publication and production trading integration follow the read-only discovery build.

## 1. Public source and supported orders

| Setting | Design |
| --- | --- |
| Chain | BNB, chain ID 56 |
| Seaport | Existing 1.6 deployment at `0x0000000000000068F116a894984e2DB1123eB395` |
| Collection | `0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d` |
| Publication | `OrderValidated(bytes32 orderHash, OrderParameters orderParameters)` |
| Listings/offers | Full, open, fixed-price, single-NFT orders; native BNB listings and WBNB offers; existing reviewed fee policy and direct approvals |
| Order source | Canonical events, including publications made through another operator's client |
| API database | Derived publications, current observations, coverage and operational jobs |

Filter RPC queries by Seaport address and event topic. The NFT collection is not indexed in `OrderValidated`, so decode and discard unrelated orders locally. Keep work bounded if unrelated Seaport publication volume grows.

Retain the proposed active-feed policy: an order must already be active at publication, and its total duration must not exceed 30 days:

```text
startTime <= publicationBlock.timestamp < endTime
0 < endTime - startTime <= 2,592,000 seconds
scanStart = max(launchBlock, rolling30DayBoundaryBlock)
```

For publication P, start S, expiry E, duration limit D and finalized time T, `S <= P`, `E <= S + D` and `E > T` imply `P > T - D`. This proves the active-order scan bound. A duration limit without the publication-time condition would not suffice. Use actual block timestamps to find the boundary. Future-start or longer orders are outside this supported feed.

Record the launch block before enabling the first publication. A normal worker resumes its cursor rather than replaying the window every cycle. A new operator can choose the bounded active-order rebuild; full publication history since launch can be a separate explicit backfill.

## 2. Reuse the server and report costs before RPC use

The inspected indexer-next worker already persists progress, queries up to 100,000 blocks at a time and reconciles every five minutes. Its proxy uses free recent-read endpoints, Alchemy for history and durable CU budgets. Source indexing has automatic paid fallback disabled; other workloads have distinct policies.

Reuse the existing budgeted RPC infrastructure and keep credentials server-side. Do not add a collector per API replica or an unmetered parallel route to the Alchemy key. Use a database lease so only one worker processes a stream at a time; an independently operated installation has its own lease/database.

Route publication scans through the log-capable source pool and source budget; use the order-projection/current-state route for counter/status checks. The current proxy's default order pool falls back to its primary dataseed pool, so routing all discovery calls as order projections could unnecessarily send unsupported log reads to paid fallback. Verify this routing explicitly without increasing the existing allocations.

The [cost report](bnb-discovery-costs.md) prices one shared worker and records
the bounded provider qualification already performed. The measured calls used
112 paid CUs. A sustained historical scan remains to be measured under a cap.

Qualification must establish chain/Seaport identity, finalized reads, a nonempty event range, practical historical chunk sizes, current contract reads, response bytes and agreement on a small sample from a second provider. Test through server routing; browser CORS is no longer a discovery requirement. Previous public probes established recent access, not complete historical availability.

## 3. Pure event decoding and reconstruction

Extend `packages/yunipals-market-core/src/seaportEvents.ts` with the publication event and put pure reconstruction helpers in the shared package.

For each log:

1. Check contract, topic, range, canonical block reference and strict ABI encoding. Reject pending/removed or malformed records.
2. Track event identity `(chainId, blockHash, transactionHash, logIndex)` separately from order identity `(chainId, protocolAddress, orderHash)`. Handle several orders per transaction and smart-wallet/relayer publication; do not require the outer sender to be the maker.
3. Validate collection, supported item types/counts, currencies, amounts, recipients, zero zone/conduit and `totalOriginalConsiderationItems`. Preserve original parameters, hash and provenance; never rewrite terms to fit policy.
4. Read/cache timestamps only for relevant publication blocks and apply the supported time policy.
5. At one finalized block H, read each distinct maker's current counter and candidate order's Seaport status. Reconstruct components, replacing `totalOriginalConsiderationItems` with the counter, then recompute the order hash.
6. Only a hash match establishes components for the current counter. A mismatch is inactive; do not invent a counter, assume zero or subtract one. Historical counter reconstruction is not required for the open-order feed.

`OrderValidated` contains parameters and hash, but no original signature/counter. On-chain validation establishes authorization; it does not establish current ownership, approval, funds or executability. Preserve existing status precedence: complete fill, cancellation, counter mismatch and expiry. Unexpected partial fills or inconsistent validation state remain unsupported/inconsistent, not active.

## 4. Postgres records and synchronization

Add migrations with existing tooling. Keep discovery separate from the signed-order admission table: it currently requires a non-null maker signature for locally sourced orders and an NFT lifecycle. Do not satisfy those constraints with fabricated values.

| Proposed record | Stored information |
| --- | --- |
| BNB publication | Original parameters/hash, chain/protocol, token/maker/expiry, transaction/log identity, publication block/hash/time and policy version |
| BNB observation | Components when current-counter matching succeeds; protocol status/reason and finalized observation block/hash/time |
| Discovery checkpoint | Launch/policy identity, coverage start, next block, last anchor, freshness/error state and lease ownership |

Exact SQL should follow existing DB conventions. Reuse checkpoint/job primitives where they fit. Treat NFT lifecycle/ownership as joined observations from the retained collection indexer and chain checks; discovery alone must not populate an executable `MarketOrder`.

Worker cycle:

1. Acquire/renew the stream lease and validate stored anchor hashes. Resolve finalized target H and verify head freshness.
2. Resume the next unprocessed block. On an empty database, choose the active-window boundary. Scan ascending chunks, initially up to 100,000 historical blocks and the qualified smaller limit for free recent logs.
3. Decode/filter each chunk. Commit its publication records and cursor advance atomically. Deduplicate by event/order identity. A crash must not leave coverage advanced past missing records.
4. On range limits, split; on 429/timeouts, back off with bounded retries; on exhausted budgets, pause and report stale coverage. Failed requests never become successful empty ranges.
5. Refresh candidate status/counters at H with deduplicated makers and bounded batches. Use qualified multicall when possible; JSON-RPC batching alone does not lower billed CUs. Store observation and coverage freshness separately.
6. Verify the observation anchor before making it current. On a canonical-hash conflict, invalidate affected derived records/checkpoints and replay from a safe anchor. Never silently change a finalized requirement to latest.
7. Reconcile every five minutes by default, independently of visitor count. Verified publication/transaction hints may schedule a deduplicated early pass within budget; ordinary GET requests do not wake a scan.

Expose lag, last successful scan/state observation, lease state, RPC counts, free/paid routing and budget exhaustion through existing worker health mechanisms. Avoid a separate monitoring system.

## 5. Cached API and later trade integration

Use current API and React query patterns for token orders, wallet orders and collection listings. Extend the backing read service to include event-derived BNB orders. Serve stored data and cached aggregates; HTTP traffic must not create repeated upstream discovery work.

Return whether publication coverage is complete and how fresh state observations are. A partially rebuilt or stale store cannot claim an authoritative empty orderbook, current floor price or executable order. Rebuilding browser caches simply refetches the API.

Keep existing preparation, preflight, fulfillment, cancellation, policy and wallet intent checks. In the later trading build, adapt them to on-chain-validated orders and fresh owner/lifecycle, balance, approval and status observations. Exact simulation and checks remain necessary before submission. Five-minute browsing observations do not relax execution requirements.

OpenSea-supported chains retain their upstream order source, API integration and in-app trading. This BNB build does not change OpenSea behavior.

## 6. Implementation sequence

| Build | Main locations | Reviewable result |
| --- | --- | --- |
| A. Provider qualification | New metered script under `apps/yunipals-market-api/scripts`, existing RPC routing/budget code | Measured history/state reads and CU counts within the reported allowance |
| B. Pure discovery | Shared `seaportEvents.ts` and new order-discovery helpers | Parser, time policy, hash reconstruction and protocol-status derivation |
| C. Durable indexing | New modules under `apps/yunipals-market-api/src/bnb`, existing `src/db` migrations/checkpoints/jobs, `src/worker.ts` | One leased scan loop, restart/reorg recovery and persisted observations |
| D. API projection | Existing `src/reads`, BNB services and response types | Read-only event-derived views with coverage/freshness; no per-visit scan |
| E. Independent setup | API/indexer setup docs, fixtures and existing fork harness | A clean installation rebuilds the same orderbook using its own providers |

Expose launch block, policy, polling and provider settings through existing
environment conventions. Do not hardcode Yunipals hostnames or keys. The
[BNB ownership worker](../apps/yunipals-indexer/README.md) supplies the
transfer and lifecycle data needed for a BNB orderbook rebuild; independent
operators do not need the server's private indexer checkout or database.

## 7. Verification and completion

- **Core:** real-format encoded fixtures, multi-order/smart-wallet publications, malformed/unrelated logs, wrong collection/currency/recipients, time boundaries, future-start exclusion, non-unit counter changes, fill/cancel precedence and inconsistent state.
- **Database/worker:** lease contention, restart mid-chunk, duplicates, launch boundary, failed ranges, provider disagreement, budget exhaustion and reorg rollback. Enforce bounded retries and immutable raw terms.
- **Independent rebuild:** publish representative orders on an isolated BNB fork; start two installations with separate empty databases and the same finalized target. Compare supported open-order hashes after cancellation/fill/counter changes. Instance B must never call instance A or import its rows. Dropping and rebuilding only the disposable discovery schema must reproduce the same set.
- **Cost behavior:** compare upstream RPC counts for repeated API reads with one client and many clients over the same indexing cycles. Counts must not multiply with cached GET traffic. Price publication wakeups, transaction checks and larger candidate sets separately.
- **Integration:** point a frontend at the second instance while Yunipals-operated API hosts are blocked. Verify responses, freshness and configured URLs. Production trading remains a subsequent build; discovery success alone does not enable Buy.

Done means a metered, restartable shared worker discovers supported postlaunch orders from chain data, independent installations can rebuild the same current feed, API reads reuse its stored results, and failures leave explicit incomplete/stale states.

References: [Seaport interface](https://docs.opensea.io/docs/seaport-interface), [event definitions](https://github.com/ProjectOpenSea/seaport-types/blob/main/src/interfaces/ConsiderationEventsAndErrors.sol), [validation implementation](https://github.com/ProjectOpenSea/seaport-core/blob/main/src/lib/OrderValidator.sol), [counter implementation](https://github.com/ProjectOpenSea/seaport-core/blob/main/src/lib/CounterManager.sol), [RPC cost estimate](bnb-discovery-costs.md).
