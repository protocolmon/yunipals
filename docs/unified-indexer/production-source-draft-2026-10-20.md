# Production shadow source draft

The public inputs in `ops/unified-indexer/production-source.env.draft` generate `production-rpc-profile-2026-10-20.draft.json`. They select no database, active release, service or replay permit. No production source or consumer configuration has been changed.

The generated profile is `0x1415f5e214bc95aae57ca8aa3eed2c2c1a5102097f5eda0a30d71bb1060443c5`; its source manifest is `0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029`. Its coordinator is the observed existing `yunipals-opensea` account scope, rather than another provider account or independent budget. Profile approval, bounded permits and new workload allocations have not been applied.

The draft enables all four NFT chains, both Islands contracts, Base metadata, the deployed Arena, all three booster proxies and BNB Seaport discovery. Sources retain their full verified event starts. Booster configuration uses the earliest deployment block from the confirmed deployment record; this is conservative for each later-created proxy. Solana is managed separately by the shared launcher, preserving its existing snapshot and provider budget; it is not an EVM RPC-profile source.

| Receipt source | Draft first block | Basis |
| --- | ---: | --- |
| Ethereum NFT transfers | 19,442,152 | Existing sale-history start |
| Base NFT transfers | 22,224,075 | NFT deployment; explicit consumer alignment required |
| Polygon NFT transfers | 54,889,689 | Existing sale-history start |
| BNB NFT transfers | 122,080,975 | Earliest signed order and maximum active-order window |
| BNB Seaport discovery | 123,769,700 | Existing discovery launch; unchanged full-receipt default |

Base's deployed legacy sale configuration starts at 11,872,655, before this NFT existed. The candidate rejects that unsupported start. Adoption must explicitly review a corrected consumer start of 22,224,075 and prove retained activity parity. This draft neither silently moves that cursor nor manufactures earlier receipt coverage.

The BNB witness used the existing production budget proxy for 34 bounded client requests: one chain identity and 33 block headers. All four accepted orders have admission blocks. Their earliest signed start time, 1,789,498,400, maps exactly to block 122,080,975; the predecessor has timestamp 1,789,498,399. This is earlier than the earliest admission, 122,090,342, and earlier than the current maximum-duration active-order window. Historical block hashes were checked again before completion. See `production-bnb-sale-history-witness-2026-10-20.json`. Its 661 modeled client CU are not a provider invoice or a measurement of paid dispatches.

A separate read-only snapshot counts the NFT transfer transactions at these proposed receipt boundaries: Ethereum 2,705, Base 6,326, Polygon 1,282 and BNB 50. The previous whole-history BNB count was 1,115,576. These are receipt candidates, not sale counts; BNB Seaport discovery contributes additional transactions. Full historical ownership and its block-header work remain required below every receipt floor. See `production-receipt-floor-cardinality-2026-10-20.json`.

All RPC range, batch, response, pacing and CU guards remain in effect. The draft retains a 500-block historical log-range cap. A production sample must measure actual throughput and paid/free dispatches before estimating full replay. No paid allowance or global daily-cap increase is implied by this draft.
