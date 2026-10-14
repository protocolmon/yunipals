# Base islands reveal preflight

Historical preflight checked on 14 October 2026. The replacement route was subsequently selected and completed; see the replacement release record below.

## Contract limitation

The deployed Base contract `0x1058f1a6fedcaec94e488d6ec3c639e541faf066`
is an immutable ERC-721. Its two token URI constants are shared across the Genesis
and Personal editions. It has no metadata setter, external metadata storage hook,
or upgrade mechanism. Owner access and `finalizeAirdrop()` cannot change this.

The live runtime hash matches the verified implementation at finalized block
`52579557`. Calls to `tokenURI(1)` and `tokenURI(1001)` returned the legacy shared
placeholder URLs. Changing our metadata host or requesting a marketplace refresh
cannot give this contract individual revealed metadata.

## Prepared assets

All 898 Base snapshot IDs match the published reveal cohort exactly. All 898
metadata file hashes and their ten trait values match the published assignments;
all ten arena profile hashes match. Each token already has a hosted image.
The existing published metadata identifies the original Ethereum collection.
Preserve it unchanged along with the VRF evidence and commitment.

Evidence: `docs/audit/base-islands/reveal-preflight.json`.

## Available routes

### Yunipals website and game

Associate the verified Base collection/token identity with the published arena
assignment for its matching original token. Keep canonical contract metadata
separate from this arena data. Display the revealed artwork, traits, and resident
on the island browser and detail page, with a clear note that external NFT
marketplaces still read the legacy contract metadata. Keep current Base ownership,
original/Base labels, and counterpart links. This route requires no chain write.

### Marketplace reveal

Prepare a separate replacement or migration contract with per-token metadata
support and an explicit ownership policy. Preserve all published trait assignments
and images. A migration must account for current Base owners rather than blindly
reuse the original airdrop recipients, because tokens can have transferred.
Review deployment, claims or wrapping, old/new NFT treatment, and website/indexer
cutover before authorizing any deployment or mint. The existing Base contract
cannot be retrofitted.

## Replacement release

The user chose a new airdrop to current Base owners at a fixed finalized snapshot.
Replacement contract: `0x79b68a12a2952a9a8d0cc4d0b3fb00252c41d168` (Base).
All 898 tokens retain their IDs and published reveal assignments.
Snapshot block: `52587044`, hash `0x805301a21f019844c3d9fd37441d40a863f85c7b812c21491bc4f96a996fe97b`.
The snapshot differs from the original airdrop recipients for 23 tokens.

All 898 mint recipients and per-token URLs were verified. Three post-mint
transfers (IDs 294, 320 and 365) were independently reconciled against Transfer
logs, and the indexer follows the current owners. The contract is finalized;
its owner is the zero address, and the source is verified on BaseScan.

- Metadata: `https://islands-meta.yunipals.com/v2/base-islands/{tokenId}`
- Public inputs: `https://islands-meta.yunipals.com/v2/base-islands/release.json`
- Completion proof: `https://islands-meta.yunipals.com/v2/base-islands/completion.json`
- Deployment and mint receipts: `contracts/islands-base-v2/deployments/replacement-v2/`
- Active indexer collection: `base-islands-v2`; schema `yunipals_base_islands_v2`.
- The old Base contract remains on-chain but is superseded in the website.

The Ethereum original and the replacement are separate NFTs. The original reveal
commitment, VRF result, trait assignments and artwork are unchanged.
