# BNB cost study: keep71e and2s polling

This is a source-only measurement packet. It does not change a source, proxy,
service, role, native table, checkpoint or budget. All RPC responses in the
experiment are synthetic and all builds use an explicit public source export.
The installed patched Ponder0.17.5 entrypoints and corresponding source files
are byte-pinned in `ypal-bnb-cost-study-v1.ponder-files.json` before evaluation.

The production observation is separate: the already captured10,000-block prefix
129499248–129509247 had zero Yunipal NFT events and six Seaport events across
five event blocks. Its read-only aggregate is authenticated by SHA256
`94c0750811defc69827f4a8f83a9a038239a5789f9e72ef69e17d4036492524c`.
No event data from the unindexed tail was queried or inferred. The31,000-block
extension and its nonempty cases are labelled synthetic.

## Actual installed-runtime results

| Scenario | Full header requests | BNB checkpoint callbacks | Handler DB method calls |
| --- | ---: | ---: | ---: |
| Synthetic31k quiet historical range, interval1 | 31,000 | 31,000 | 93,000 |
| Same range, interval10 | 3,100 | 3,100 | 9,300 |
| Synthetic31k with6 logs on5 blocks, interval1 | 31,000 | 31,000 | 93,000 |
| Same nonempty range, interval10 | 3,104 | 3,100 | 9,300 |

Every synthetic log and all five transaction objects survive the sparse
historical engine. These counts come from installed `createHistoricalSync` and
the actual BNB block handler loaded by Ponder's Vite build. DB counts are calls
to the handler's insert/upsert/delete interface, not a physical PostgreSQL write
or roundtrip benchmark; Ponder may buffer/coalesce operations. Receipt enrichment,
provider latency, real retries and actual catchup throughput are not measured.

For stock realtime, the installed `createRealtimeSync` reconciles *every*
intermediate header to maintain the parent-hash chain. A120-second synthetic
scenario at450ms/block processes266 new blocks:

| Polling | Latest requests | Missing-block requests | Total full headers | Interval1 callbacks |
| --- | ---: | ---: | ---: | ---: |
| 2s | 60 | 206 | 266 | 266 |
| 10s | 12 | 254 | 266 | 266 |

Changing the callback interval to10 reduces callbacks to26 in this scenario,
but **all266 realtime headers are still fetched**, at either polling rate.
Slower polling therefore does not deliver the claimed permanent header-CU saving
on a chain growing faster than the poll period. It can add up to8 seconds of
fresh-event latency. The synthetic zero-bloom fixture also triggers Ponder's
explicit empty-log query path; its count is reported separately and is not a
measurement of production BNB log calls.

At the scenario's rate and Alchemy's published20CU per `eth_getBlockByNumber`,
headers alone compute to3,830,400CU/day. This is a conditional model, not an actual
bill, account entitlement, observed24-hour rate or full source-cost estimate.
The published pricing also charges batch RPCs by the methods inside them, so
HTTP batching alone does not remove this floor. WebSocket/newHeads is not assumed
cheaper: Alchemy publishes byte-based subscription pricing. Sources checked
2026-10-24: [compute-unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs),
[subscription API](https://www.alchemy.com/docs/reference/subscription-api-endpoints).

## Build and correctness implications

The real public-export baseline reproduces build71e2a7f3b7, config hash
0f394941…, schema hashf4522b6a… and indexing hash8fdfce8c…. Changing only BNB
polling2s→10s preserves all three hashes and71e. Ponder's config content hash
includes contracts/accounts/blocks/ordering, but excludes chain polling options.
The source file hash changes and any real restart still needs its own actual
source/config/actor acknowledgement; unchanged build ID does not imply unchanged
runtime qualification.

Changing only `BnbCheckpoint.interval`1→10 changes the real build to67d8a35489.
The schema and handler hashes, all contracts/start blocks, pool5, and Base's2s
polling remain identical. Ponder's normal production database setup refuses a
different build in an existing namespace. A real sparse source thus needs a new
native namespace/replay, registration and physical-OID/read-view/consumer proof
closure. Neither this study nor its diagnostic config67d is an accepted sparse
source deployment.

Existing log fragments and historical event blocks in the retained Ponder sync
store can be reused by the normal runtime. They do not eliminate the need to
rebuild application state for a new build. An interval-specific block filter may
have a different cache fragment; never manufacture cache intervals, rewrite
`_ponder_meta.build_id`, or mark unprocessed blocks complete to avoid replay.

A sparse callback alone also breaks current proof semantics:

- The application `chain_checkpoint`/`chain_block` records are exact processed
  block hashes. A Ponder75-digit progress checkpoint contains a height/timestamp,
  not its canonical hash. Generic sync-store data alone does not bind that cache
  branch to this application's processed state.
- The observer caps indexed availability by a genuine native witness and obtains
  exact policy-boundary headers. Base/Arena latest policy must remain unchanged.
  BNB ownership uses depth20; returning the nearest sampled hash for the actual
  required height would be false evidence.
- Generation capture and final publication require the exact captured point to
  remain canonical even after the head advances. A proper sparse implementation
  would need genuine event-block witnesses for immediate NFT processing, safe
  sample/event retention, and an exact retained-anchor fallback bound to a still
  canonical physical witness.
- Existing metadata143 grants control.release and control.chain_status, but not
  control.chain_anchor. A retained-anchor fallback would need an explicit reviewed
  additional SELECT for the executing role(s), or a separately reviewed invoker
  contract. No SECURITY DEFINER or hidden native-read workaround is included.

## Recommendation and commands

Keep build71e/filter interval1 and BNB2s polling now. Finish the already requested
Alchemy-primary reliability transition under its own exact actual epoch/budget
proofs. Do not introduce a fresh native replay/OID/read-view migration merely to
save the remaining roughly31k hypothetical quiet header fetches. At20CU/header,
the synthetic maximum one-off reduction is558,000CU before any rebuild costs;
it is not a90% permanent source-CU saving. A future range-based realtime engine
would be a new synchronization/reorg design requiring its own implementation and
proofs, not a polling knob or an unqualified checkpoint adapter.

Run from `apps/yunipals-indexer`, with Node24 and the existing local dependencies:

```sh
node --import tsx ../../ops/unified-indexer-transition/ypal-bnb-cost-study-v1.mjs --output /tmp/yunipals-bnb-cost-study-20261024.json
node --import tsx ../../ops/unified-indexer-transition/ypal-bnb-cost-study-v1.test.mjs
```

The runner requires the exact cached public source export and the existing
sanitized production aggregate. It creates only a new bounded `/tmp` build area,
uses synthetic responses for the12 official preflight requests per variant and
blocks network sockets/fetch otherwise. Child output uses owned files rather
than sockets. Eight focused controls cover actual installed historical/realtime
behavior, nonempty preservation, input refusal, exact polling-only transform and
the real three-variant build proof. There are no host/provider/DB/service/Git
actions and no production single-ingestor or readiness acceptance claim.
