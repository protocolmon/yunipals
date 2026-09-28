# BNB validated-order rollout

BNB order discovery uses Seaport `OrderValidated` logs. The database cursor
defaults to `preview` on a fresh installation; the Yunipals production cursor
was switched to `live` on 2026-09-24. Ethereum, Base and Polygon continue to
use OpenSea.

## Dependencies before a live switch

- Apply marketplace migrations through version 24 and the runtime grants with
  the schema-owner role before starting the new API/worker binary. Rehearse the
  migration against disposable local PostgreSQL first; no persistent staging
  deployment is required. Migration 24 clears only the rebuildable discovery
  cache and cursor, then starts discovery in `preview`.
- Run the [BNB ownership worker](../apps/yunipals-indexer/README.md) against
  the same BNB chain and expose `bnb_indexer.sync_state`,
  `yunipals_read_v4.token`, and `yunipals_read_v4.transfer_event` to the
  marketplace runtime role. Its source and an independent two-instance
  ownership fixture are included. The BNB worker can run independently of the
  app's other chain and metadata processes and has no private package dependency.
  The metadata processes may continue to serve collection artwork, rarity and
  other chains during a BNB order rollout.
- Set `MARKET_BNB_DISCOVERY_START_BLOCK` to a finalized block before the first
  supported validation transaction. Keep the same value after restarts. The
  worker scans at five-minute intervals with a database advisory lock and
  persists its cursor. Ordinary marketplace GETs only read Postgres.
- Use the existing source and order-projection RPC routes with their durable CU
  limits. The [cost report](bnb-discovery-costs.md) records the 112-CU initial
  qualification and a successful 58-request historical Seaport log scan. The
  complete worker must run in production `preview` with BNB actions paused,
  including retry and paid/free accounting, before the live switch. Do not
  raise the proxy cap or put an RPC credential in the Vite app.

## Isolated verification

The API suite (375 tests), web suites (148 tests), builds and root typecheck
passed during implementation. After the production catalog query fix, the
targeted catalog and order integration tests (24 tests), source-health regression
test, API typecheck and build passed. The `test:bnb:validated-fork` fixture
published a listing and WBNB offer on a verified isolated BNB fork. The maker
wallet sent
`Seaport.validate([{ parameters, signature: "0x" }])`, and each validation
receipt contained the expected `OrderValidated` hash. Two empty, separately
credentialed databases rebuilt the same hashes and lifecycle. B's first rebuild
ran while A's database pool was closed. The script then bought the listing,
cancelled another listing, published its replacement, accepted the WBNB offer,
and compared terminal
states and asset reads in both databases. It used direct discovery calls and a
fork-only wallet. Two separate HTTP API processes served the same listing;
instance B kept serving after A stopped. A focused Chromium test used an
injected maker wallet to validate a listing on the fork, matched the
`OrderValidated` hash to its saved cancellation record, and made no private
order-publication POST. Its fixture API deliberately showed the order waiting
for indexing; the two-database fork test verified the later indexed state.

## Production switch

1. Deploy the code with discovery in `preview`. Keep
   `MARKET_BNB_ACTIONS_PAUSED=1` until the worker and indexer checkpoints are
   healthy. It hides BNB publish/buy/accept actions while leaving reads and
   cancellation available. OpenSea actions remain independent.
2. Check `GET /v1/market/bnb/discovered-orders?limit=1`: `coverage` must be
   `complete`, with a current `updatedAt`, no unbound active publications and
   `nextBlock > targetBlock`. Check the indexer checkpoint and RPC budget.
3. In one schema-owner database transaction, set
   `yunipals_market.bnb_discovery_cursor.mode='live'` for its singleton row.
   Live mode hides the old private BNB rows, rejects new signed BNB admission,
   and reads/executes only reconstructed validated orders.
4. Restart the API with `MARKET_BNB_ACTIONS_PAUSED=0` only after the live feed,
   quote path and cancellation path pass smoke checks. The worker's
   `bnb_discovery_pass` log reports `lagBlocks`, `unbound`, `staleActive` and
   `oldestStateObservedAt`; watch these with quote failures and the separate
   RPC proxy CU accounting.

If a fault occurs, set `MARKET_BNB_ACTIONS_PAUSED=1` and restart the API.
Leave discovery and `mode='live'` running. Do not switch back to `preview` after
on-chain publication has started: that would expose a split orderbook.

The production cutover completed on 2026-09-24. The BNB worker caught up in
preview with no unbound or stale active orders, then the cursor was switched to
`live` and the API was restarted to clear pre-cutover snapshots. The two old
private BNB listings were intentionally hidden; no on-chain validated orders
existed at cutover. The public BNB catalog and discovery feed returned 200 with
complete coverage, OpenSea catalog reads returned 200, and both production
product-health checks passed. BNB trading capabilities were enabled after
retired-order lookup, cancellation and preflight all rejected the old order.
The first real BNB listing for token `10001147716` was validated on chain and
then bought in production. Purchase transaction
[`0xa4dc07f5…21e2e12`](https://bscscan.com/tx/0xa4dc07f5a9fc5d52ef014d575a786129a191aeda5529f8bc0afa67c5021e2e12)
was confirmed at block 123,826,820; the indexed order is `filled`. The purchase
preparation took noticeably long, so transaction-preparation latency remains a
performance issue to measure separately from order-source correctness.

On 25 September, a fresh public source clone with an empty disposable database
replayed Seaport logs from launch block 123,769,700 using an independent RPC
connection and reconstructed order
`0xae7063b9575b6dda61c20c51006e670a8ec1bbdde6c54de50bacdccfc8ed5877`
and its `filled` state. It did not query the Yunipals marketplace API or copy
its database. The bounded pass used two `eth_getLogs` calls and an estimated
888 provider CUs, about $0.00047 at the published PAYG list price if all paid.
The empty database had no NFT transfer history, so its order remained unbound
to an ownership lifecycle; this replay proves independent order discovery and
Seaport status, while the two-instance isolated-fork fixture covers lifecycle
binding and trading. A complete live ownership-indexer replay was not run: the
collection has over a million historical transfers and that job has a
separate, much larger RPC and storage cost. No staging system was deployed.
