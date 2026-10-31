# Collection versions activation and rollback

The collection now supports verified origin badges, links between NFT versions, expandable grouped cards, separate group and NFT counts, and grouped collector holdings. Sale and price filters use individual NFTs. The feature is disabled until a verified relationship mapping is published and the application settings are enabled.

**Reconstruct the mapping from indexed mints**

An old ownership snapshot is optional for grouping. The read-only audit uses the first canonical zero-address Transfer for each Base NFT to establish its initial recipient, then checks the original NFT across all three configured original chains using both the Base token ID and archived monster ID, shared metadata identity, and current lifecycle binding. The archived chain field is not used to restrict the search. The current owner is recorded separately and does not have to match the initial recipient.

Run from `apps/yunipals-indexer` with the deployed database and ownership selectors:

```sh
pnpm versions:audit-initial-owners --output /absolute/path/base-initial-owners.jsonl --manifest /absolute/path/manifest.json
```

The default scans every indexed Base NFT, including burned NFTs, through streaming cursors in bounded batches. Each read-only transaction covers at most 5,000 NFTs, then refreshes the indexer freshness checks; the metadata release must remain unchanged throughout. Use `--limit 10` for a small validation run, `--batch-size 100` to reduce batch size, or `--progress` for aggregate progress counts. No database records are changed. Current owners in the report are observations from the corresponding audit batch. Existing output files are never overwritten. Each audit record contains the first mint recipient and transaction, the current owner, a matching status, and the archived original monster records (including their source hashes and historical `minted` flags). Missing mint history, remints, ambiguous source identities, and missing bindings stay outside the generated manifest. Large token IDs remain strings.

The generated `base-mint-and-source-identity` evidence records the initial recipients and an `auditSha256` of the exact audit file. The importer rechecks canonical mint transactions, recipient addresses, current lifecycles, and original source identity. This proves the NFT relationship and initial recipients; it does not assert historical snapshot eligibility or invent a snapshot date. A historical ownership snapshot is needed only when adding those eligibility claims.

The bounded production audit on 30 October 2026 had already confirmed that sampled Base bindings point to archived monster records from BNB and Ethereum. The mint reconstruction provides the missing initial-recipient evidence directly from indexed chain history.

Create a manifest with `version: 1`, the active `metadataReleaseId`, and a `groups` array. Each group contains `members`, `evidence`, and an optional `snapshotDate` in ISO date format. Each EVM member supplies `chain`, `contractAddress`, decimal-string `tokenId`, `lifecycle`, `mintTransactionHash`, `mintLogIndex`, `assetKey`, and `role` (`original`, `airdrop`, or `version`). A Solana original supplies `chain: "solana"`, its case-sensitive mint address as `tokenId`, `contractAddress: null`, identity marker `lifecycle: 1`, and an immutable `sourceHash`; its EVM mint transaction and log fields are null. Each group must have one non-Base original and at least one Base airdrop, with a shared verified metadata identity. The maximum is eight members per group; larger allocations need a deliberate contract change rather than truncation.

If using an independently reviewed historical allocation instead, each group's evidence contains `kind: "ownership-snapshot-airdrop"`, `source` (the historical source description), decimal-string `snapshotBlock`, `snapshotBlockHash`, and `allocationSha256`. The latter must match the allocation file supplied to the importer. Omit unknown dates. Do not substitute current owners for snapshot recipients.

**Monster identity and original NFTs**

A monster record and an issued NFT are distinct. A Base NFT can retain an original monster's ID even when the archive says that monster had not been minted on its original chain. An archived `minted: false` value describes that historical record; it does not prove the monster was never minted later. Special collections outside the three configured original contracts also remain unresolved by this audit.

The completed read-only audit on 31 October 2026 found an archived original monster identity for every one of the 440,194 indexed OG Base NFTs. Of those, 437,542 retain the archived numeric monster ID; 2,652 instead point to a Solana Exomon mint address through their shared metadata identity. Every initial mint recipient was present, no NFT IDs were duplicated, and all current mint lifecycles were one.

The corrected lookup checks both the Base token ID and archived original ID across all three configured original chains, then requires shared identity and canonical current mint evidence. This produces 48,762 verified original/Base NFT pairs, matching an independent comparison of the complete contract bindings. Every verified EVM pair retains the same token ID. The lookup also finds 12 Polygon NFT versions whose archived primary identity is a Solana mint address. It supports an archived original EVM ID that differs from the Base ID without assuming that equal IDs alone prove a relationship.

Among the 391,432 Base NFTs without a verified EVM counterpart, 386,785 have archived originals marked `minted: false`. The remaining 4,647 have archived originals marked `minted: true`, including 2,640 Solana originals and special collections outside the configured original contracts. These are coverage categories, not claims that the original monsters do not exist. The Solana extension groups those originals with their Base copies and includes any verified Polygon version in the same lineage.

The audit status `original_not_indexed` means no verified counterpart was found in the configured indexed NFT contracts. Original archive coverage and verified NFT-pair coverage are reported separately. The archived `minted` flag is diagnostic information and never substitutes for current ownership or mint evidence.

The final `v5` candidate manifest passed identity, role, duplicate, coverage, and evidence-hash checks. It supersedes the earlier `v2` mapping, whose lookup incorrectly depended on the archived chain and original ID. The complete mint scan was followed by bounded read-only verification of the exceptional identities; initial mint and owner observations were preserved. Neither mapping nor feature has been activated. [Audit totals and file hashes](audit/base-initial-owners-2026-10-31.json) identify the exact artifacts and their source audit.

**Include Solana originals**

Use the complete initial-mint audit and its EVM candidate to generate the combined mapping:

```sh
pnpm versions:solana --manifest /absolute/path/evm-manifest.json --audit /absolute/path/base-initial-owners.jsonl --output /absolute/path/combined-manifest.json
```

This command only reads the database and creates a new output file. It verifies the audit hash, active archive, canonical Base mint/recipient and lifecycle binding, and the Exomon manifest's mint address, shared asset identity, and immutable source hash. Each batch contains at most 250 records, uses a fresh read-only snapshot, and keeps a five-second statement deadline. It merges existing Polygon/Base pairs into their Solana lineage instead of creating overlapping groups. No Solana transfer history or mint transaction is invented.

The production candidate covers all 2,652 Solana originals: 2,640 new pairs and 12 expanded Solana/Polygon/Base groups. The combined candidate contains 51,402 groups and 102,816 NFT versions. An independent validation checked every mapped Base mint against the complete audit and every Solana source hash against its archived original. [Combined audit totals and artifact hashes](audit/solana-monster-versions-2026-10-31.json) identify the exact file. The candidate has not been activated.

Relationship identity and current ownership are independent. A verified Solana manifest member can remain a related reference even if the ownership service cannot currently observe it. Such references say “Ownership unavailable” and never become matching holdings. Grouped reads include only Solana tokens observed in the current published scan; their response reports `unavailableNfts` separately. During validation, two Solana NFTs were unobserved overall, including one linked original. Burned originals remain labeled burned references. A published scan outside the existing ownership freshness limit, or an unavailable scan, returns a recoverable unavailable response.

**Check and publish the mapping**

Use the existing database and ownership selector configuration for the intended deployment. The production indexer is on `yunipals-main`, reached through `ssh root@168.119.172.10`; verify the hostname before operating there. Use the approved operator identity without displaying credential values.

From `apps/yunipals-indexer`, run the check first:

```sh
pnpm versions:import /absolute/path/manifest.json /absolute/path/base-initial-owners.jsonl --check
```

The check validates the evidence file hash, configured contracts, complete NFT identities, original/airdrop/version roles, group conflicts, EVM canonical lifecycle bindings and mint events, and Solana manifest/source hashes. Reconstructed evidence additionally checks the initial Base recipient and shared archived monster identity. An original NFT may now be on a different chain than the archived record describes. It does not create or publish relationship records. The manifest is tied to the current metadata archive release.

After reviewing the audit coverage and successful checks, publish with the same files:

```sh
pnpm versions:import /absolute/path/manifest.json /absolute/path/base-initial-owners.jsonl --activate
```

Publication creates the additive relationship tables, validates members in batches of 256, and changes the active revision atomically. A validation failure leaves the preceding release active. Review the importer's revision, group count, and member count against the audited matches before enabling reads.

Solana reads use the existing `solana_indexer.manifest`, `manifest_asset`, `asset_metadata`, `token`, `sync_state`, `scan_run`, and `rpc_usage` permissions. API reads validate the stored source hash against the curated manifest and do not read private archive payloads.

The API identities need SELECT access to the two new `metadata.monster_version_*` tables and the existing `metadata_source.archive_release` and `metadata_source.lifecycle_binding` relations, alongside their existing ownership and published metadata reads. Check and grant only the necessary relations through the existing database administration workflow. The importer requires the corresponding writer privileges. Do not grant the API blanket access to archived source payloads.

**Enable labels and then grouping**

Deploy the backward-compatible API routes and frontend code before changing the settings:

| Setting | Behavior |
| --- | --- |
| `API_MONSTER_VERSIONS_ENABLED=true` | Exposes the active, validated relationship revision and bounded version summaries. |
| `SOLANA_API_ENABLED=true` | Enables Solana version reads against the existing published ownership source. |
| `VITE_EXOMON_ENABLED=true` | Exposes Solana collection, detail, and collector surfaces in the frontend. |
| `VITE_MONSTER_VERSIONS_ENABLED=true` | Enables batched origin badges and counterpart links in the frontend. |
| `API_MONSTER_GROUPING_ENABLED=true` | Enables grouped API reads independently of labels. |
| `VITE_MONSTER_GROUPING_ENABLED=true` | Enables the view toggle when the backend advertises grouping support. |
| `VITE_GROUPED_MONSTERS_DEFAULT=true` | Makes grouped ordinary OG browsing the default for users without an explicit or saved view preference. |

Vite settings take effect in a new frontend build. Start with labels and links, then enable the optional grouped view, then its default. The capability endpoint is `/v1/monster-version-capabilities`. A missing mapping, disabled setting, or changed metadata archive keeps the capability unavailable.

Individual NFT browsing continues through the existing catalog and collector APIs. Grouped browsing reads `/v1/monster-groups` directly from the indexer, avoiding changes to marketplace listing snapshots or purchase execution. `/v1/monster-versions` enriches existing NFT cards in batches of up to 48 identities. Group pages contain at most 24 groups. Solana and EVM results use the same server grouping/count query and keyset cursors in both directions. A relationship is grouped before pagination even when its members use different ID formats. Cursors expire on a new published Solana scan or manifest, as well as on EVM ownership or relationship changes. The frontend retains at most five cached pages.

Before making grouping the default, measure group/count query plans and latency on the real allocation, common trait filters, deep pages, and the largest wallet. Grouped SQL has a one-second statement deadline. Keep grouping disabled if the real query plans cannot meet that limit. Synthetic fixtures prove correctness, not production capacity.

**Verification**

The focused backend suite exercises import validation and atomic publication, actual API responses, counts, all six sort orders, forward/backward pagination with tied/null rarity, same-NFT filter predicates, split ownership, hidden versions, remints, expired cursors, and disabled capabilities. Frontend contract checks reject mismatched filters, revisions, assets, roles, hidden results, and duplicate groups. Browser fixtures cover keyboard expansion, counterpart navigation, view history, collector ownership wording, mixed Exomon pagination, mobile layout, and sale filters.

Run the targeted checks with Node 24:

```sh
pnpm --filter @protopals/yunipals-indexer exec vitest run test/monster-versions.test.ts test/solana-monster-versions.test.ts test/base-initial-owners.test.ts
pnpm --filter @protopals/yunipals-home-web test:versions
```

For the browser fixture, start the existing fixture server on its configured port, 5177, with all three frontend settings enabled, then run `pnpm --filter @protopals/yunipals-home-web test:versions:ui`. The script accepts `--playwright`, `--chromium`, and `--url` to select installed local tooling. Also run workspace type checks/builds and the existing collector, Solana, and marketplace regressions for changes to shared behavior.

Production smoke checks should cover verified original/Base pairs from each supported source chain, split ownership, Solana originals with different numeric Base IDs, a three-version Solana/Polygon/Base group, an unavailable Solana original, Base NFTs with only an archived original, a hidden version, and a large collector. Check the exact NFT detail target before any trading action. Grouped results must not show an unowned or hidden counterpart as a matching holding.

**Rollback**

Set `API_MONSTER_GROUPING_ENABLED=false` to stop grouped queries while keeping origin labels available. Refresh the frontend capability state; individual NFT browsing remains available through the view control. Disable the frontend grouping setting in the next build if necessary. Set `API_MONSTER_VERSIONS_ENABLED=false` to stop all relationship reads. Keep the evidence and additive tables for diagnosis. A new metadata release requires a newly checked relationship publication; existing mappings do not silently carry across it.
