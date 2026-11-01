# Collection chain exclusions and Base original links

The landing page opens the ordinary OG NFT grid with `excludeChain=base` for visitors without saved filters. Explicit URLs and saved collection choices take precedence. Removing the visible “Not Base” chip or choosing All includes Base again; choosing Base directly opens its individual NFTs. TCG, Islands and collector profiles retain their existing behavior.

## Chain filters

Offer the existing positive chain selection plus independent exclusion controls for every supported chain, including Solana. Serialize exclusions as repeated `excludeChain` parameters. Resolve the selected chains minus excluded chains before making token, marketplace and facet requests, so pagination, counts, sorting and trait facets use the same selection. An empty effective selection returns no results without accidentally requesting all chains. Clearing filters removes exclusions. Preserve exclusions in saved preferences and mobile filter drafts.

## Base detail pages

Read the verified relationship only when opening an individual Base NFT. Show the original chain and link to the original NFT, including Solana mint addresses. Explain that the Base airdrop and the original have independent ownership and that buying or transferring one does not include the other. Missing or unverified relationships produce no invented original link. Unavailable and burned originals retain their labels.

## Relationship data and rollout

Keep the existing provenance audits, immutable identity checks, relationship storage and import tools. The verified candidate covers 51,402 relationships, including 2,652 Solana originals. Current ownership does not define the relationship. See [rollout instructions](collection-versions-rollout.md) for candidate hashes, validation and publication.

Chain exclusions need only the frontend change and existing filtered NFT APIs. Original links additionally require the relationship import and enabled API/frontend settings. No full ownership reindex is required.

The grouped cards, grouped page/count API, grouped cursors and view switch have been removed. Ordinary NFT pagination, collector holdings and trading remain on their existing paths.

## Verification

Check the default exclusion, explicit Base navigation, saved choices, multiple exclusions, empty selections, counts/facets, pagination and mobile controls. Test the real relationship API and import validation, including Ethereum and Solana originals, distinct owners, remints, hidden peers and unavailable originals. Run workspace type checks, the frontend build and relevant collection/marketplace regressions.
