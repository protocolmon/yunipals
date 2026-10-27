# Reviewed unified RPC profiles and bounded replay

Unified indexing now has an explicit opt-in RPC policy. Existing untagged marketplace traffic at `/` keeps its routing and budgets. Unified traffic uses `/unified` and must select the exact approved source profile and one of two background allocations, `unified_source` or `unified_evidence`, under the **existing provider-account coordinator scope**. Missing headers on that isolated path fail closed, so an accidental header loss cannot fall into legacy paid routing. It cannot borrow the marketplace foreground allocation.

The new managed unified service requires this preflight; directly invoking the general Ponder config retains its legacy behavior until `UNIFIED_RPC_POLICY_REQUIRED=true` or a profile file is supplied. The shared support CLI also requires the reviewed policy before observation/receipt work. No production setting or provider allocation was changed by this implementation.

## Public configuration and approval

The nonsecret profile belongs at a host-specific path such as `/etc/yunipals-unified/rpc/profile.json`. Generate it using the exact same source configuration as the candidate Ponder process:

```sh
node --env-file=/etc/yunipals-unified/ponder.env --import tsx \
  scripts/unified-rpc-profile.ts \
  --scope EXISTING_ACCOUNT_SCOPE \
  --coordinator-id EXISTING_COORDINATOR_UUID \
  --output /etc/yunipals-unified/rpc/profile.json
```

Run that command from `apps/yunipals-indexer` with Node 24. It refuses an existing output file and creates a **draft only**. The file contains public deployment addresses, source start blocks, manifest, coordinator identity and proposed limits; no provider URLs or credentials. Make it readable by both the indexer and existing proxy service roles while keeping their private env files protected. Defaults are ten calls per batch, 500 blocks per historical log range, 50 addresses and 128 topic values. `--log-range` can propose a different reviewed cap, up to 10,000. A new draft receives a fresh `reviewId`, so an unchanged source policy can receive a new expiring approval without resetting an older permit's counters.

First apply marketplace migration 28 through the existing migration owner workflow. Provision the two background workload allocation rows in the existing account scope using explicitly selected CU limits; the implementation supplies no production allowance. Keep the existing global daily cap and foreground reserve. Apply [grant-opensea-budget.sql](../../apps/yunipals-market-api/scripts/grant-opensea-budget.sql) for the existing budget runtime role. Its new permissions are SELECT on the two policy/permit tables and EXECUTE on the atomic permit reservation function. Runtime receives no approval, expiry, cap or spent-counter writes.

Prepare a public review input containing:

```json
{
  "profile": "REPLACE WITH THE GENERATED PROFILE OBJECT",
  "expiresAt": "REPLACE WITH AN EXACT UTC ISO TIMESTAMP",
  "permits": []
}
```

That is a template, not an executable approval. A profile approval may last at most 30 days. An empty `permits` array approves free-only operation. Each optional replay permit is an object with `permitId` (a new random 32-byte hex identity), `chainId`, decimal-string `fromBlock` and `throughBlock`, positive integer `maximumCu`, and UTC ISO `expiresAt`. Permit expiry must be within 24 hours and no later than profile expiry. There may be at most one new permit per chain in one review input. Every height, expiry and CU limit must be deliberately chosen; historical paid access is never inferred from free-failure fallback flags.

From `apps/yunipals-market-api`, using an existing operator/migration database connection in `UNIFIED_RPC_REVIEW_DATABASE_URL`:

```sh
node --import tsx scripts/review-unified-rpc-policy.ts --file /ABSOLUTE/review.json
node --import tsx scripts/review-unified-rpc-policy.ts --file /ABSOLUTE/review.json --apply EXACT_REVIEW_HASH
```

The first command validates the profile, expiry, bounded permits and existing enabled coordinator/background allocations, then prints the concrete review hash and public policy. It makes no provider request. The second recomputes and requires that exact hash before an approval transaction. Approval is INSERT-only: reusing a permit never resets its spending, changes its limits or revives it. Repeating the same approval preserves spent CU. A changed review hash, mismatched existing identity or expired input is refused. Keep the review output with the deployment record.

## Runtime selectors and startup

For each existing per-chain budget proxy, add these public settings only after approval:

```text
MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE=/etc/yunipals-unified/rpc/profile.json
MARKET_RPC_PROXY_UNIFIED_PROFILE_ID=REVIEWED_PROFILE_DIGEST
MARKET_RPC_PROXY_CHAIN_ID=THIS_PROXY_CHAIN_ID
```

The paid upstream and account coordinator remain their existing private configuration. Merely adding these selectors does not change legacy calls. Configure the Ponder/support child env with:

```text
UNIFIED_RPC_POLICY_REQUIRED=true
UNIFIED_RPC_PROFILE_FILE=/etc/yunipals-unified/rpc/profile.json
UNIFIED_RPC_PROFILE_ID=REVIEWED_PROFILE_DIGEST
PONDER_RPC_URL_1=http://127.0.0.1:19201/unified
PONDER_RPC_URL_8453=http://127.0.0.1:19202/unified
PONDER_RPC_URL_137=http://127.0.0.1:19203/unified
PONDER_RPC_URL_56=http://127.0.0.1:19204/unified
```

An explicitly approved replay also supplies `UNIFIED_RPC_REPLAY_PERMIT_ID_1`, `_8453`, `_137` and/or `_56` for the corresponding chain. Omit an unapproved chain's permit. The generic `UNIFIED_RPC_REPLAY_PERMIT_ID` is suitable only for a single-chain configuration/fixture; it will fail a different chain's permit preflight. An exhausted/expired configured permit refuses startup rather than silently buying more calls.

Run `node --env-file=/etc/yunipals-unified/ponder.env --import tsx scripts/unified-rpc-preflight.ts` before starting. It requires all four explicit production loopback URLs, the exact generated source manifest/profile digest, enabled unexpired owner approval, matching existing account scope/coordinator, both background allocations and a configured free endpoint pool. It returns public daily allocation/grant counters and any bounded permit status. It makes only the small free `eth_chainId` checks through those proxies, never historical log/state requests. Wrong upstream chains, missing/disabled policy, changed manifest, arbitrary paid URLs, absent budget evidence and invalid configured permits fail closed. Ponder and support workers then send their profile and workload headers with standard viem transports; Ponder's synchronization/reorg engine is unchanged.

## Spending and request limits

The reviewed read set is `eth_chainId`, `eth_blockNumber`, block by number/hash, `eth_getLogs`, `eth_getTransactionReceipt` and `eth_getCode`. Unknown methods, block receipts, writes and traces are unavailable to unified callers. Historical numeric log ranges require registered source addresses and cannot precede the earliest reviewed start among the addresses actually requested. Address/topic/batch/range caps apply before dispatch. Native Ponder's unfiltered **single exact block hash** log query remains supported; it filters those results using its normal source rules. Header/hash/receipt reads remain bounded by request bytes, response bytes, pacing and upstream concurrency.

A full receipt can contain companion Seaport logs on Ethereum, Base or Polygon even though their Seaport events are not independently indexed. Accordingly, on a chain with an enabled full-receipt source, code reads also permit **only** market-core's exact Seaport 1.6 deployment address, from the earliest full-receipt source start. This derives a protocol-code proof permission without adding a log source, changing event coverage or allowing unrelated addresses. The existing per-chain runtime fingerprint validation remains mandatory. Paid historical protocol-code reads still require the same explicit numeric-height permit and cost 20 modeled CU.

Every paid unified request additionally needs an enabled, unexpired permit matching the profile and chain. Its numeric height or log range must lie inside the permit. The SQL function atomically charges its modeled CU before the existing account/workload reservation and upstream dispatch, across concurrent proxy processes and restarts. No automatic refund occurs after errors, timeouts or lost outcomes. A later account-budget denial or queue failure may conservatively consume permit allowance without a provider dispatch. Empty/no-free-provider routing and failed-free fallbacks cannot bypass the permit.

Paid hash, receipt and current-tag lookups are refused because their height cannot be established before dispatch. They remain free-only. An unavailable free provider therefore causes unavailability rather than unconstrained paid access. Existing fallback flags still decide whether a failed eligible free route may try paid; **both** an enabled fallback and the bounded permit must allow it. For direct old numeric logs/state, the explicit permit is mandatory regardless of those legacy flags. Mixed batches containing unbounded paid shapes are refused as a whole.

The exact modeled costs for the permitted paid subset are 60 CU per `eth_getLogs`, 20 per numeric block read and 20 per historical code read, using existing `alchemy-2026-09-08` weights. A batch charges their sum. Optional `eth_getBlockReceipts` is not enabled or repriced: production Ponder's receipt flag stays false and full evidence uses exact individual receipts. Those fixed model units are **not a current provider invoice or ETH estimate**. Confirm the actual production provider's pricing/capabilities before approving paid production work. The durable existing global cap and foreground reserve continue to apply in addition to each permit.

Source and evidence requests have independent free pacing/circuit state. Evidence uses the bounded low-priority queue; it does not receive foreground funding. Production defaults remain eight upstream requests in flight, 400 ms source spacing, a 2 MiB request cap and 32 MiB response cap. The local integration explicitly uses a different 32-request/zero-delay fixture to exercise correctness; it does not establish production throughput or justify changing these defaults.

## Verification and remaining gates

Focused tests verify profile/method/source caps, exact native request shapes including omitted empty params, concurrent durable exhaustion, expiry/revocation, runtime denial of counter/policy writes, explicit paid gating, exact review-hash approval and repeated approval without counter reset. Existing legacy proxy regressions remain green. Startup tests verify exact source/account/proxy/chain bindings without real network calls.

The actual `ponder start` integration runs `scripts/test-unified-rpc-sync.mjs --budget-proxy` against fresh local Anvil port 55445/Ponder port 55446, separate from the earlier direct-RPC fixture. The real proxy uses the existing PostgreSQL budget classes and the approved profile/permit tables. Both free and simulated paid routes terminate only at guarded local Anvil; no provider/mainnet request or production signer key is used. It retains unique source schemas/releases and existing global cache/control data. The [final evidence](budgeted-rpc-sync-2026-10-20.json) records exact code hashes, modeled spending, receipt evidence, empty coverage, actual short reorg and crash/restart behavior.

The final isolated-path run passed in 97.7 seconds with 200 empty initial blocks, 17 local transactions, 12 canonical journal events, a seven-block replacement, actual native range adaptation to a 20-block profile limit and deliberate SIGKILL/restart. It made 1,241 free and 325 simulated paid dispatches. The atomic permit charged 19,500 of 50,000 modeled CU; the existing source budget leased 20,000, while evidence used zero paid CU. Three full receipts contained actual companion Seaport logs from the existing Base runtime executing `incrementCounter()` and retained its exact verified runtime fingerprint after three `eth_getCode` calls through `/unified`. Base Seaport was not registered as a log source. All 12 retained source release identities and the active pointer were unchanged. Ponder and Anvil then stopped cleanly.

Post-change verification passed 43 affected marketplace RPC/PG tests, 21 indexer guard/source/RPC tests, both application typechecks and a final six-test policy pass including explicit refusal of companion Seaport log scans. The separately recorded 536-test marketplace baseline predates the final path/companion changes; the affected checks and genuine lifecycle above cover those changes. Migration 28 is frozen at SHA-256 `c60e6cfa40bd17aeb0932eb30e79d220b96ebefa6fb34c3fa662999863a7fd9e`. Its source-counter reservations, expiry and grants were not relaxed for the fixture.

This proves local policy and runtime compatibility. A fixed-CU production sample, real four-chain capability/latency measurement, whole-history cost/time/disk estimates, historical parity, backup/rollback acceptance and operator-approved cutover remain required. No historical production replay has been started by these changes.

## Candidate 2: historical source free routing and native batching

The later candidate changes free eligibility for approved `unified_source` historical `eth_getLogs` only. The complete request must first pass the existing profile, registered source addresses, deployment floor, method, topic, range and batch limits. Eligible logs then use the existing paced free pool. This supersedes the earlier direct-old-log paid classification described above for this workload; legacy `/`, `unified_evidence`, historical code reads and mixed batches with paid-only companions keep their existing classification. A failed free request still needs both the explicit fallback flag and a matching bounded permit before paid admission. No allocation, migration, permit cap or upstream pacing was increased.

The unified source and evidence viem transports now batch at most ten calls, further limited by the reviewed profile, with a ten-millisecond collection window. Each transport retains a distinct abort signal, so batching cannot combine source and evidence workload headers merely because they share a URL. Batching reduces HTTP dispatches; it does not remove the proxy's per-endpoint spacing, response limits or native Ponder work. The [local scheduling analysis](ponder-proxy-throughput-local-2026-10-20.md) records the BNB event-block lower bounds and the distinction between independent historical progress and global realtime readiness.

The new [candidate 2 evidence](budgeted-rpc-sync-free-source-batched-2026-10-20.json) is separate from the immutable earlier run. Actual Ponder, the real proxy and PostgreSQL permit/account coordination passed again in 98.222 seconds. Both upstream routes still terminated only at local Anvil. To preserve meaningful paid-path coverage, the fixture deliberately returned one free failure after validating a ten-call historical source-log batch. Its one paid HTTP dispatch charged exactly 600 modeled CU to both the bounded permit and source account; the evidence workload used zero paid CU. The other 268 HTTP dispatches used the free route.

That run retained the 200-block empty prefix, actual seven-block replacement, SIGKILL/restart, quiet-block resume, 12 canonical journal events and three full companion Seaport receipt/runtime proofs. All 13 previously retained release identities and the active pointer were unchanged. The restarted Ponder and Anvil processes stopped cleanly. The six real-PostgreSQL policy tests also passed with historical source logs free and bounded historical code reads still paid; seven focused new proxy guards and both application typechecks passed. Migration 28 retains the checksum recorded above.

These are local correctness and routing results. The fixture includes deliberate polling, failure and recovery waits, so its duration does not measure production backfill throughput. The existing deployed artifact and its historical evidence remain unchanged; candidate packaging, bounded production observation and the remaining cutover gates are separate operations.
