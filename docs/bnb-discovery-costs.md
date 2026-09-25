# BNB order discovery: shared-indexer RPC cost estimate

Prepared 22 September 2026. The initial estimate used source files, service configuration and read-only local database queries. A bounded provider qualification was run on 24 September as recorded below. Credentials were not copied into the browser or this report.

## Recommendation

Keep one shared indexer and the existing API. Serve cached order data to all visitors, with public sources sufficient for another operator to rebuild their own instance. OpenSea remains the order source on the existing OpenSea-supported chains; new BNB orders come from Seaport events on BNB. Existing orders need no migration.

The earlier per-visit estimate assumed every browser independently scanned history. That is not the intended architecture and no longer applies. With shared indexing, blockchain discovery work depends on elapsed time, candidate orders, chain activity and refresh frequency, not the number of cached API reads. API serving/bandwidth and transaction checks can still increase with usage.

For **25 candidate orders checked every five minutes**, the model below gives **$0.77/month at a 10% paid-read fraction**, or **$7.67/month if every read uses Alchemy**. These are incremental discovery RPC estimates, excluding hosting, existing indexer workloads, OpenSea usage and trading. The paid fraction is an assumption to measure, not a promise.

## What already exists on the server

The active `yunipals-bnb.service` runs indexer-next's `lib/bnb/worker.ts`. It uses HTTP, persists a database cursor and requests logs filtered by the collection address and relevant topics. Its effective settings are:

| Control | Existing configuration |
| --- | --- |
| Historical chunk size | Up to 100,000 blocks; split on failures |
| Reconciliation | Every 300,000 milliseconds, or five minutes |
| Confirmation setting | 20 blocks |
| Metadata URI audit | Weekly |
| Recent-read routing window | 4,096 blocks |
| Free current-state RPC | BNB public dataseed pool |
| Free log RPC | `rpc-bsc.48.club`, with PublicNode fallback |
| Historical RPC | Alchemy BNB, behind a local budgeted proxy |
| Paid fallback after free-provider failures | Disabled for source indexing; selected marketplace workloads have separate fallback policies |
| Proxy concurrency | At most eight requests in flight |

The proxy has a shared durable limit of **1,000,000 CUs/day**, with a **200,000-CU foreground reserve** and workload allocations. At the published PAYG rate, fully consuming that daily limit for 30 days corresponds to **$15.75**. This is the cap on accounted traffic through this proxy, across its workloads/chains; it is neither an Alchemy account-wide cap nor a BNB-only allowance.

For the seven complete UTC days from 15–21 September, its database recorded **29,000 CUs in grants**, equivalent to approximately **$0.015** at PAYG rates. The partial 22 September window showed another **117,000 CUs**, or approximately **$0.061**. Grants reserve budget in chunks and can include unused capacity; these figures are **proxy accounting, not an Alchemy invoice**, and exclude requests made outside this proxy. They demonstrate the existing low paid-RPC footprint without establishing a future monthly bill.

The reusable local implementations are `apps/yunipals-market-api/src/rpcBudgetProxy.ts` and `src/opensea/rpcComputeBudget.ts`. Reuse this server infrastructure and keep the existing credential private. Meter the new discovery task under the appropriate workload allocation; do not silently increase the shared cap or bypass the proxy.

## Published prices and limits

Alchemy advertises **30 million CUs/month on Free** and **$0.525 per million CUs on PAYG**. PAYG bills all usage at that rate; the Free allowance is not deducted from PAYG usage. Account plan, current invoice, discounts and remaining credit were not inspected. The estimates exclude taxes and any separately purchased throughput capacity. [Pricing](https://www.alchemy.com/pricing), [PAYG FAQ](https://www.alchemy.com/docs/reference/pay-as-you-go-pricing-faq).

| RPC method | Billed CUs | Cost per 1,000 calls at PAYG |
| --- | ---: | ---: |
| `eth_getLogs` | 60 | $0.03150 |
| `eth_call` | 26 | $0.01365 |
| `eth_getBlockByNumber`, `eth_getCode` | 20 | $0.01050 |
| `eth_blockNumber` | 10 | $0.00525 |

JSON-RPC batching charges the sum of its methods. A verified on-chain multicall can reduce outer `eth_call` requests; the estimates below conservatively give it no savings. [Method costs](https://www.alchemy.com/docs/reference/compute-unit-costs).

The important Free-plan restriction is **10 blocks per BNB `eth_getLogs` request**. PAYG advertises unrestricted BNB block ranges subject to a 150 MB response cap; practical Seaport ranges still need qualification. At the previously sampled block interval, scanning 30 days on Free would need about **576,000 calls / 34.55 million CUs for logs alone**, exceeding the monthly Free allowance for a single fresh scan. The Free plan is therefore unsuitable as the historical source for this design. [BNB row in Alchemy's log-range table](https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-logs).

## Shared-worker cost model

Assumptions for one operator's installation:

- One leased discovery loop runs every five minutes, or 8,640 cycles per 30-day month, independently of browser traffic.
- Each cycle reads two anchor headers, the latest head and one recent publication-log range: `2 × 20 + 10 + 60 = 110 CUs`.
- Each candidate order adds one `getOrderStatus` call; each distinct maker adds one `getCounter` call, at 26 CUs each. The table assumes one maker per order and checks every candidate each cycle. Fewer makers or verified multicall reduce work; the table gives no multicall savings.
- Include 20% overhead for bounded retries, publication headers and extra checks. High event volume, extra ranges or frequent transaction-triggered wakeups require additional allowance.
- The table counts protocol discovery/status only. It does not include every existing marketplace validation, NFT ownership/approval check, trade simulation or collection-indexer task.

```text
cycles_per_month = 30 × 24 × 12 = 8,640
cycle_CUs = 110 + 26 × (candidate_orders + distinct_makers)
monthly_USD = cycles_per_month × cycle_CUs × 1.20
              × paid_CU_fraction × 0.525 / 1,000,000
```

| Candidate orders / distinct makers | Monthly discovery RPC with 10% of CUs paid | Monthly discovery RPC if all CUs are paid |
| --- | ---: | ---: |
| 0 / 0: scan and head checks only | $0.06 | $0.60 |
| 25 / 25 | **$0.77** | **$7.67** |
| 100 / 100 | $2.89 | $28.90 |

If all ongoing reads succeed on qualified free RPCs, ongoing Alchemy cost is zero. The 10% column is a sensitivity scenario, not observed provider reliability. These are demand estimates at list price before enforcement of existing workload caps. Hitting a cap must pause work and expose stale coverage; the table does not authorize raising a cap. Actual account plan/invoice and future provider performance remain unverified.

For the same 25-order workload, 1,000, 10,000 or 100,000 monthly visits produce the same scheduled discovery request count. They can produce different HTTP serving, bandwidth and trading costs. Each independently hosted marketplace pays for its own indexer and providers; replicas within one installation must share the lease and cache.

Increasing the periodic refresh from five minutes to one minute multiplies this scheduled workload by five: about $3.84/month at 10% paid, or $38.37 all-paid for 25 orders. Start at five minutes, with bounded immediate checks after relevant transactions. Browser GET traffic should never trigger full upstream refreshes.

## One-time rebuild and other costs

An empty indexer rebuilds once and then persists its cursor. For a full 30-day active window, the earlier block-time sample gives approximately 5,758,209 blocks. At 100,000 blocks per historical request, that is 58 log calls. With 23 boundary-search headers, 25 relevant publication headers, one bytecode read and one `information()` call:

```text
rebuild_CUs = 58 × 60 + 23 × 20 + 25 × 20 + 20 + 26 = 4,486
rebuild_USD = 4,486 × 1.20 × 0.525 / 1,000,000 = $0.00283
```

That is approximately **$0.003 per empty-instance rebuild** under these assumptions, excluding initial status reads already represented by the worker cycle. It is not paid again for every visitor. Launch-period rebuilds cover less history. Larger Seaport payloads or more relevant publication blocks increase this amount. The 100,000-block Seaport log ranges were measured below; a full archive rebuild from launch is a different, potentially larger job than this bounded active-feed rebuild.

Publishing remains a wallet cost: the earlier Seaport 1.6 estimate was about **$0.0026 per listing/offer** at the sampled gas and BNB price, or **$2.60 per 1,000 publications**. Wallets pay unless sponsored. This is separate from RPC costs and changes with gas and BNB/USD.

Existing server rent, storage, bandwidth, OpenSea integration, asset indexing and transaction preparation/validation are not priced by this discovery-only model. Reusing the current server avoids adding a new hosting subscription if it has sufficient capacity; capacity has not been load-tested in this planning step.

## Implementation choices that keep the bill small

1. **One shared collector:** run a discovery task alongside the current marketplace worker and indexer-next. Use a database lease to avoid duplicate loops across API/worker replicas.
2. **Persist the cursor:** Postgres retains events and coverage. Resume gaps on restart; no history scans per visitor or periodic full rebuilds.
3. **Free-first private RPC:** route publication scans through the log-capable source pool and counter/status checks through the current-state pool. Reuse metered Alchemy for history/allowed fallback. Keep keys server-side and caps unchanged. Public-provider failures never count as empty results.
4. **Cheap API reads:** query indexed tables/cache for browsing. Expose freshness and coverage; deduplicate transaction-triggered refreshes and enforce rate/budget limits.
5. **Bound state work:** five-minute reconciliation, deduplicated maker reads, qualified multicall and expiry pruning. Use fresh checks for actual trades rather than shortening every browsing refresh.
6. **Reproducible hosting:** document the source, migrations, RPC/OpenSea credentials and budgets required for an independent installation. Public listings must be recoverable without our private database.

### Bounded provider qualification, 24 September 2026

One historical `eth_getLogs` request for the BNB collection's `Transfer` topic
covered blocks 7,579,197–7,679,196 through the existing production budget
proxy. It returned **1,417 logs in 906,831 response bytes** with HTTP 200 in
**937 ms**. The proxy recorded one paid source call and **60 used CUs**, with
zero free source calls for this request. Its durable budget leased a 1,000-CU
grant, which is a reservation rather than 1,000 actual method CUs. At the
published PAYG list rate, 60 CUs corresponds to about **$0.000032**; the
actual account plan and invoice were not inspected. No service configuration,
cursor or database row was changed by the qualification. This validates one
100,000-block log range on the configured provider, not the full historical
scan, sustained rate or OpenSea traffic.

Two historical Seaport `eth_call` requests at block `0x75fa1ef` then returned
the maker counter (32 bytes) and order status (128 bytes) successfully in
63 ms and 42 ms respectively. They used another **52 paid CUs**, with no
additional grant. The three bounded provider calls together used **112 CUs**,
about **$0.000059** at the published PAYG list rate. This checks that the
configured route serves historical state, but it is not a throughput or
full-order reconstruction benchmark. The [Alchemy method costs](https://www.alchemy.com/docs/reference/compute-unit-costs)
and [current list price](https://www.alchemy.com/pricing) were rechecked on
24 September 2026.

### Bounded Seaport log scan, 24 September 2026

A separate read-only scan queried the configured BNB proxy for Seaport
`OrderValidated` events in 58 consecutive ranges, from block 117,985,278 through
123,743,486 (5,758,209 blocks). All 58 calls succeeded. They returned 414
events and 1,029,508 response bytes in 21.4 seconds; the slowest individual
call took 562 ms. One additional 100,000-block recent-range probe returned
zero events in 233 ms. The script stopped at 60 requests and capped each
response at 20 MB. This validates practical log range throughput, not an exact
30-day timestamp boundary or a complete worker rebuild. At 60 CUs per
`eth_getLogs`, 58 methods correspond to **3,480 CUs**, approximately
**$0.00183** at the published PAYG list rate if every call was paid. Proxy
retries, the actual paid/free split and the account invoice were not measured
for this scan. No production cursor, service configuration or database row was
changed.

The production worker subsequently ran in `preview`, caught up, and switched to
`live` on 24 September 2026; see the [rollout result](bnb-onchain-rollout.md).
Cached API reads use Postgres and do not start RPC scans per visitor. The
historical **50,000-CU / approximately $0.026** figure was a qualification
ceiling, not an ongoing allowance. No persistent staging system was deployed.
