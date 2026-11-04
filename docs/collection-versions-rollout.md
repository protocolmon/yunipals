# Collection versions activation and rollback

The landing page defaults to individual NFTs with Base excluded when there are no saved filters. Chain exclusions work through existing collection APIs. Base detail pages can show a verified link to the original NFT once the relationship mapping and settings below are enabled. Grouped cards and the grouped browsing API have been removed.

**Reconstruct the mapping from indexed mints**

An old ownership snapshot is optional for reconstructing NFT relationships. The read-only audit uses the first canonical zero-address Transfer for each Base NFT to establish its initial recipient, then checks the original NFT across all three configured original chains using both the Base token ID and archived monster ID, shared metadata identity, and current lifecycle binding. The archived chain field is not used to restrict the search. The current owner is recorded separately and does not have to match the initial recipient.

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

Relationship identity and current ownership are independent. A verified Solana manifest member can remain a related reference even if the ownership service cannot currently observe it. Such references say “Ownership unavailable” and never become matching holdings. During validation, two Solana NFTs were unobserved overall, including one linked original. Burned originals remain labeled burned references. A published scan outside the existing ownership freshness limit, or an unavailable scan, returns a recoverable unavailable response.

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

**Enable Base original links**

Deploy the backward-compatible API routes and frontend code before changing the settings:

| Setting | Behavior |
| --- | --- |
| `API_MONSTER_VERSIONS_ENABLED=true` | Exposes the active, validated relationship revision and bounded version summaries. |
| `SOLANA_API_ENABLED=true` | Enables Solana version reads against the existing published ownership source. |
| `VITE_EXOMON_ENABLED=true` | Exposes Solana collection, detail, and collector surfaces in the frontend. |
| `VITE_MONSTER_VERSIONS_ENABLED=true` | Enables original-NFT links on individual Base detail pages. |

Vite settings take effect in a new frontend build. Chain exclusions do not require relationship settings or a mapping import. Enable original links after validating and publishing the mapping. The capability endpoint is `/v1/monster-version-capabilities`; `/v1/monster-versions` supplies bounded relationship summaries. The frontend calls these only on Base NFT detail pages.

Before enabling original links, check summary-query latency for real Ethereum and Solana counterparts and verify the exact destination NFT. Existing NFT APIs continue to handle collection counts, sorting and pagination.

**Verification**

Backend tests cover provenance, import validation, atomic publication, read-only summary responses, missing or stale Solana ownership and unavailable counterpart references. Frontend checks cover chain exclusion defaults, serialization, effective API chain selection, empty selections, and original links.

Run the targeted checks with Node 24:

```sh
pnpm --filter @protopals/yunipals-indexer exec vitest run test/monster-versions.test.ts test/solana-monster-versions.test.ts test/base-initial-owners.test.ts
pnpm --filter @protopals/yunipals-home-web test:versions
```

For the browser fixture, start the fixture server on port 5177 with `VITE_MONSTER_VERSIONS_ENABLED=true`, then run `pnpm --filter @protopals/yunipals-home-web test:versions:ui`. The script accepts `--playwright`, `--chromium`, and `--url` for installed local tooling. Run workspace type checks/builds and existing collection, Solana and marketplace regressions.

Production smoke checks should cover a fresh landing page, removing Not Base, selecting Base explicitly, exclusion combinations, and original links on Base NFTs. Include an Ethereum original, a Solana original with a different numeric Base ID, a split-owner pair, and an unavailable original. NFTs with no verified original must not show a guessed link.

**Refresh after the shared-indexer merge — 4 November 2026**

PR #13 was refreshed with `main` at `febd5ea874adef1af8a4497f0fc7aab2cbc75c74`, including PRs #14 and #15. The merge required no conflict resolution. Relationship reads and the importer already select the configured ownership views rather than a fixed historical source schema.

Validation on the combined branch passed workspace type checks, the production frontend build, all existing web test groups, fixture tests, the frontend relationship test, 22 focused relationship/ownership tests, 13 shared-deployment/parity tests, and all 12 browser checks. The browser checks use synthetic data; they do not establish production mapping readiness.

A hostname-verified, read-only check as the production API identity confirmed that its unified ownership view matches the selected release. Neither relationship table is installed. The audit and combined manifest are no longer present at the `/tmp` paths recorded in the October audit summaries, so the full production manifest check could not be rerun. Those summaries are historical evidence, not a current import approval.

Before enabling original links, restore the exact audit and manifest and verify their recorded SHA-256 hashes, or regenerate them using the current reader selectors and active metadata archive. Retain the resulting evidence in durable storage, rerun `versions:import ... --check`, and then follow the publication and permission steps above. The refresh does not activate settings or change production data. Chain exclusions require no reindex; preparing relationship evidence uses existing indexed history and does not require replaying the chains.

**Rollback**

Set `API_MONSTER_VERSIONS_ENABLED=false` to stop relationship reads, or disable `VITE_MONSTER_VERSIONS_ENABLED` in the next frontend build. Individual NFT browsing and exclusions continue to work. Keep the evidence and additive tables for diagnosis. A new metadata release requires a newly checked relationship publication; existing mappings do not silently carry across it.
