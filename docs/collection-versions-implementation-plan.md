# Collection versions implementation plan

Implementation plan, 30 October 2026. Status: implemented locally, including Solana grouping, with the complete mint and Solana identity audits finished; activation pending import and production performance checks. See [activation and rollback](collection-versions-rollout.md).

Make the relationship between an original monster and its Base airdrop visible, then offer one collection card containing their separate NFT versions. Deliver the labels and links first; introduce grouping once the relationship data, pagination, and counts are reliable.

**1. Product behavior and scope**

Apply this to the OG monster collection, its NFT detail pages, and collector profiles. A group represents one verified original and its related NFT versions, including its Base airdrop and any verified Polygon version. It does not represent every monster of the same species or every NFT with matching artwork. Keep the existing OG/TCG selector and call the related NFTs “versions” to avoid confusing the two concepts.

| Surface | Intended behavior |
| --- | --- |
| Individual NFT card | Keep the chain badge and add “Original” or “Base airdrop” when the relationship is verified. |
| NFT detail | Show the relationship, links to the other versions, and a short explanation of independent ownership. |
| Grouped collection | Show the artwork once, a “2 versions” control, and expandable rows for each matching NFT. Support more than two versions in the data model. |
| Personal collection | Show which versions the viewed collector currently owns, using “You own both” only when that collector is the connected user. |
| View selector | Offer “Grouped monsters” and “All NFTs.” Default ordinary OG browsing to grouped mode after rollout checks pass. |
| Sale and price filters | Use All NFTs for the first release so each result and purchase refers to one asset. Explain the view change and preserve the filters. |

Keep chain-specific NFT URLs working. Selecting an individual version opens its existing detail page. The grouped card's primary control opens its version list; it must not silently pick an NFT to buy.

Base NFTs without a verified airdrop relationship remain ordinary cards. TCG cards and Islands retain their existing collection behavior. Solana Exomon and their Base copies share the same grouped response. Their original mint addresses remain case-sensitive and distinct from numeric Base IDs. The twelve Solana/Polygon/Base lineages appear as three versions of one monster. This change does not alter rarity calculations, leaderboard scores, ownership, staking, or trading contracts.

**2. Establish the relationship data**

A Base NFT can represent an original monster without that monster having an issued NFT in the configured original contracts. Report archived original identity coverage separately from verified NFT-pair coverage. Search all configured original chains; archived chain fields can be stale. Equal token IDs are a useful lookup, and must be confirmed with shared identity and mint evidence.

The repository already stores metadata identities in `metadata_source.asset_binding`, with mint-specific evidence in `metadata_source.lifecycle_binding`. The metadata resolver explicitly handles one metadata asset having multiple live NFT bindings. These are useful starting points, but a shared metadata identity alone does not establish an original-to-airdrop relationship.

Start with a bounded audit of Ethereum, Polygon, BNB, and Base records:

- Identify the authoritative monster airdrop source: allocation records, snapshot manifests, or a provable minting rule tied to chain events. Verify original and destination contract identities, token IDs, and mint lifecycles.
- Compare those records with the existing metadata bindings. Record verified pairs, original monster records without a verified NFT counterpart, missing evidence, and conflicting relationships. Include examples from every supported source chain and remapped token IDs.
- Distinguish airdrops from bridging, burn/remint lifecycles, evolutions, and shared artwork. Do not repurpose `asset_origin` evolution relationships as airdrop evidence.
- Establish coverage and the largest verified group size. Keep unresolved NFTs separate and avoid assigning them an “Original” or “Base airdrop” role.

Production inspection belongs on `yunipals-main`, reached through `ssh root@168.119.172.10`; verify the remote hostname first. The development workspace is not the production indexer. Begin with read-only, bounded checks.

Create a small, versioned relationship projection from the verified evidence. Use the existing bindings where they establish identity and add explicit airdrop provenance where needed. Proposed records should contain:

| Field | Meaning |
| --- | --- |
| `groupId` | Stable identity for the verified lineage, independent of owner and display name. |
| Asset identity | For EVM NFTs: chain, contract, token ID, and verified mint lifecycle. For Solana: the case-sensitive mint address and immutable manifest/source hash. Keep IDs as strings; do not invent EVM mint events for Solana. |
| `role` | `original`, `airdrop`, or `version`, assigned only from verified evidence. A Solana original can have both a Polygon version and a Base airdrop. |
| Source and destination | Explicit references to the related NFT identities. |
| Evidence | Source record or manifest hash, applicable snapshot, and mint transaction references. Store snapshot dates and recipients only when known. |
| Revision and status | Publication revision plus verified, unresolved, or conflicting status for audit and cache invalidation. |

Publish validated revisions atomically. A transfer changes current ownership, not the historical relationship. A burn/remint or corrected binding must revalidate the applicable lifecycle before reusing a relationship. Changes to artwork or traits do not automatically erase a verified lineage; display any differences per version.

Current owners must come from the existing ownership reads. Never use the original airdrop recipient or archived metadata owner as the current owner.

**Acceptance:** a reproducible audit identifies supported relationships and exceptions; no group is inferred solely from artwork, names, matching token IDs, or current wallet ownership.

**3. Ship labels and counterpart links**

Add an optional relationship summary to the individual token responses used by the public collection, marketplace catalog, owner pages, and token details. Add shared TypeScript definitions and response validation. Keep existing consumers compatible when the field is absent.

Hydrate summaries in bounded database batches. Do not add a browser request or RPC lookup for each card. Include a capability and relationship revision so the frontend can distinguish unsupported data from a verified NFT with no counterpart.

Add reusable `TokenOriginBadge` and `TokenVersionInfo` components. Keep chain identity visible alongside the role. Render counterpart links outside the card's main link to avoid nested links, and use `Link` for internal navigation.

The detail explanation should say that the Base version was airdropped based on ownership at the applicable snapshot and that each NFT can now have a different owner. Explicitly explain that buying or transferring one does not include the other. Show the snapshot date only when verified. Reuse the Islands explanation pattern without copying its date, replacement history, or eligibility rules.

Unavailable provenance must leave the NFT usable with its normal chain badge. If a known counterpart is burned or unavailable, show that status instead of implying it is available to buy. Use the current version's artwork and traits on its detail page.

**Acceptance:** a user can identify which NFT is the original, understand why the Base version exists, and navigate between them without interpreting chain icons alone. This release remains useful before grouping is ready.

**4. Add correct grouped queries and counts**

Grouping must occur before pagination. Deduplicating only the current browser page would miss counterparts on later pages, produce short pages, and miscount results.

Add a separately versioned grouped response contract to the indexer, shared by collection and collector browsing. Grouped mode reads that endpoint directly; All NFTs mode retains the existing marketplace catalog and collector paths. Keep individual NFT responses, listing snapshots, and cursors intact. Enrich existing NFT cards with one bounded version-summary request per batch.

The query sequence is:

1. Select NFTs using the existing ownership, visibility, chain, search, metadata, trait, and rarity rules.
2. Assign each matching NFT its verified group identity, or a singleton identity based on its complete asset identity.
3. Select one representative matching NFT per group using the requested sort order. Use that member's displayed rarity and artwork on the card; use a stable group identity as the final tie breaker. Preserve null-rarity ordering and numeric token ID precision.
4. Paginate group identities, then batch-load the matching version rows for those groups. Return other permitted counterparts separately as related information.

Use 24 groups per page, with validated request limits. Enforce a documented bound on inline versions; if the audit finds larger groups, paginate their expansion instead of truncating them silently. Count queries must use the same predicates and read revision as the page query.

The grouped contract should expose `groupId`, representative, matching members, matching version count, permitted related-version references, relationship revision, and coverage. Page totals should distinguish `groupTotal` from `nftTotal`; they describe all matching results, not just loaded cards. Return null or an explicit unavailable status for a total that cannot be established.

Define filter behavior precisely:

- One NFT must satisfy all active predicates for its group to match. Do not combine a trait from one version with a chain or rarity value from another.
- A Base filter returns matching Base versions. An Ethereum counterpart may appear as a clearly labeled related link, but is not counted as another matching result.
- Owner filtering counts only that collector's matching holdings. An unowned counterpart is related information, not a holding.
- Preserve existing hidden-item rules. Expanding a visible group must not reveal a hidden member or enable an action that the current view does not permit.
- Exact token search matches the actual NFT ID; a linked counterpart may have a different ID.
- Trait facet counts, if shown, must be labeled by unit. Retain NFT counts explicitly or omit the badges until grouped facet counts are implemented.

Bind group cursors to view mode, filters, sort, resolved owner addresses, visibility, relationship revision, and the applicable ownership/metadata snapshot. Extend the catalog's snapshot and visibility checks to the relationship revision. Expired or incompatible cursors should produce the existing recoverable refresh behavior.

For mixed EVM/Solana browsing, group all matching versions in the server query before pagination. Use one bounded cursor and one set of group/NFT totals. Sort EVM IDs numerically and Solana mint addresses with case-sensitive ordering. Bind cursors to both the EVM ownership identity and the published Solana scan/manifest. Include only Solana holdings observed in that published scan; retain unavailable originals as labeled related references and report missing coverage separately.

Do not advertise an exact unique-monster total while relationship coverage is incomplete. Use “groups” with a short coverage explanation, or retain All NFTs mode if the grouped capability is unavailable. Never silently strip active filters during fallback.

**Acceptance:** verified pairs occur once across first and deep pages; identical artwork without a relationship remains separate; counts agree with filtered results; no collection-wide downloads or per-card queries are introduced.

**5. Add grouped cards and preserve collector actions**

Add a `MonsterGroupCard` and a compact, accessible version list. Version rows show role, chain, token ID, current ownership, and version-specific listing information when available. If traits or artwork differ, make those differences visible rather than presenting one version's values as shared facts. Use a button with `aria-expanded`, keyboard support, visible focus, and controls that work without hover.

Add `view=grouped|nfts` to URL parsing, serialization, persisted collection preferences, and query keys. Explicit URLs take precedence over saved preferences. Filter or view changes reset pagination; Back/Forward restores the selected mode. Migrate saved settings without discarding existing filters. Show the view control only for the supported collection.

When users apply a sale or price filter, switch visibly to All NFTs with “Sale and price filters show individual NFTs.” Disable grouped mode while those filters are active and explain how to return. Keep listing amounts, currencies, and Buy actions attached to the exact NFT. Grouped cards use “View versions” rather than a combined price or Buy action. Grouped sale/price sorting can be a later enhancement.

On collector profiles, derive ownership language from the viewed collector's resolved addresses on each chain. Use “You own both” only for the connected collector with two verified owned versions; otherwise show the appropriate count or “This collector owns…” wording. Loading or stale ownership must not produce a positive ownership claim.

Keep hide/unhide and any transfer or trading action scoped to an individual version. Update the existing visibility and settlement reconciliation paths to invalidate grouped queries and counts as well as NFT queries. Remove an incompatible version immediately, then refresh the active page. If the last member disappears, remove the group and recover pagination. Do not append a purchased NFT into a sorted group page without checking filters and ordering.

Preserve the collector's existing 24-item page size and bounded page cache, now measured in groups. Keep profile score statistics independent of the selected display mode; label any NFT totals clearly rather than reinterpreting them as unique monsters.

**Acceptance:** owning one version never appears to mean owning both; hiding or selling one leaves the other correct; switching view does not lose filters or create stale trade targets.

**6. Implementation locations**

| Area | Existing files to extend |
| --- | --- |
| Identity and evidence | `apps/yunipals-indexer/lib/metadata/source/schema.ts`, `source/bindings.ts`, and `lib/metadata/resolve.ts`; add a dedicated relationship module and additive migrations. |
| Collection and owner APIs | `apps/yunipals-indexer/lib/api/server.ts`, `collector-routes.ts`, and `collector-query.ts`. |
| Marketplace catalog | `apps/yunipals-market-api/src/reads/catalog.ts` and `catalogQuery.ts`; preserve snapshot, availability, and visibility behavior. |
| Shared types | `packages/yunipals-market-core/src/collectionTypes.ts` and the catalog token validators; add explicit relationship and group types. |
| Frontend clients | `apps/yunipals-home-web/src/lib/yunipalsIndexer.ts`, `collectionBrowser.ts`, `collectionBrowserFilters.ts`, `collectionEdition.ts`, `collector.ts`, and `marketplace/catalog.ts`. |
| Cards and pages | `apps/yunipals-home-web/src/components/TokenCard.tsx`, new version components, `src/pages/collection/page.tsx`, and `src/pages/collector/page.tsx`. |
| Queries and mutations | `apps/yunipals-home-web/src/hooks/marketplace/useMarketCatalog.ts`, collector hooks, and `src/lib/marketplace/confirmedSettlements.ts`. |
| Compatibility | `apps/yunipals-home-web/src/lib/boosterCollectionGrid.ts` and its tests; preserve TCG identity and edition behavior. |

**7. Verification and delivery order**

Use focused API and browser fixtures that cover original-only, Base-only, both-owned, split ownership, unrelated matching artwork, identical IDs in different contracts, remapped IDs, missing evidence, conflicting evidence, burned originals, reminted IDs, changed metadata, and groups larger than two. Include hidden members and owners with different resolved addresses on different chains.

Test pagination at 23/24/25 groups and on deep pages, including pairs that previously appeared on different NFT pages. Cover ascending/descending rarity, tied/null values, exact search, chain and trait combinations, mixed Solana results, expired snapshots, and relationship revision changes. Assert that every matching NFT belongs to exactly one returned group on a stable dataset.

Browser checks should cover desktop and mobile, keyboard expansion, direct counterpart links, URL history, saved preferences, mode changes under market filters, visibility changes, and a purchase of only one version. Run relevant existing collector, collection browser, marketplace, Islands, and pack-grid regressions alongside the new tests, followed by workspace type checks and builds.

Benchmark grouped page and count queries separately against representative data and the largest observed wallet. Inspect query plans and add indexes based on those plans. Record latency, query count, response size, and deep-page behavior against the current collection baseline. Require fixed page sizes, bounded version hydration, and compliance with existing request deadlines; establish numeric latency budgets from the baseline before enabling grouped mode by default.

Deliver in four reviewable increments:

1. **Verified relationships and labels:** audit, additive relationship storage, optional API summaries, badges, detail explanation, and counterpart links.
2. **Grouped backend:** shared contract, collection/catalog/collector queries, counts, cursor validation, and performance evidence. Keep the UI default unchanged.
3. **Grouped interface:** version cards, view persistence, collector ownership language, and mutation/cache integration. Enable through an application setting centralized in `src/environment.ts`.
4. **Default rollout:** enable grouped ordinary browsing after correctness and performance checks pass, while retaining All NFTs and an independent switch for grouping. Deploy backward-compatible backend support before frontend activation.

Before each production change, verify the target host and deployed service versions. Use low-rate smoke checks for known original/Base pairs, a split-owner pair, a large wallet, and Base NFTs with only an archived original. If grouping fails, disable it while preserving the labels and links. Keep additive schema and evidence records for diagnosis; rollback should not require deleting relationship data.

The first increment can ship independently. The mapping can be reconstructed from canonical Base mint recipients and verified original NFT identities; an old snapshot is needed only for historical eligibility claims. The grouped default additionally depends on complete pagination, ownership/visibility behavior, and acceptable query performance.
