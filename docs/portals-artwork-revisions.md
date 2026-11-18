# Portal NFT artwork revisions

Portal marketplaces read the JSON returned by `PortalCollection.tokenURI`. Updating website assets alone does not change that JSON.

The collection's `kindArtwork(kindId)` returns the current display image, its SHA-256 byte commitment and its revision. Revision zero resolves to the original kind definition. `getKind` continues to return the original mint configuration, including its original image, hash and configuration commitment.

After minting has frozen a kind, a `CONFIG_ROLE` holder can call `setKindArtwork(kindId, expectedRevision, imageURI, artworkHash)`. This explicitly allows subsequent administrator-controlled presentation changes; it does not unfreeze the mint configuration. Each update increments the revision, validates the image URI and nonzero hash, and emits `KindArtworkUpdated` and the ERC-4906 `BatchMetadataUpdate` event over that kind's allocated token range. The collection advertises ERC-4906 through ERC-165. Burned IDs and committed, unfinished mints can lie within the refresh range; nonexistent tokens still reject `tokenURI` requests.

An artwork revision affects existing and future NFTs of that kind. It cannot change their names, gate traits, owners, balances, mint odds, caps, randomness inputs or pool membership. In particular, the frozen configuration hash used by pending mints remains unchanged. A stale expected revision reverts. Restoring an older image is a new revision with that image's original URI and byte hash.

## Release procedure

1. Publish the approved full-card PNG at a new immutable/content-addressed HTTPS or IPFS URI. Verify the public response bytes against their SHA-256 hash. Keep every previous image available; never overwrite an old hash-addressed file.
2. Verify the live implementation against the reviewed baseline. Check storage compatibility, including nested layouts and the reserved gap. The artwork mapping consumes one gap slot.
3. Test the exact implementation deployment and `upgradeToAndCall` transaction on a fork of the target chain. Encode `setKindArtwork` in the upgrade call so the first revision is atomic with the upgrade. Verify all existing token metadata, ownership and traits before and after. Simulate pending and partially finished mints in the contract suite.
4. Deploy the compatible API reader before the wallet upgrade. Older implementations retain their original display image; the new reader uses `kindArtwork` when the collection advertises ERC-4906. Pin all reads to the same block and propagate RPC failures instead of silently displaying stale artwork.
5. Have the authorized admin wallet review and sign the prepared transactions. Verify exact calldata, receipts, deployed runtime, role bindings, artwork revision and metadata-update event. Keep operator-specific scripts, receipts and rollback information in the private operations repository.
6. Read live `tokenURI` JSON and fetch its `image` without authentication. Check that marketplaces ingest the refresh event; request a supported marketplace refresh if their cached image remains old. Event emission does not guarantee immediate refresh by every marketplace.

The `image` field is the static upgraded card. The app's interactive glitter and pointer-driven depth are presentation effects and are not embedded in the PNG. A future marketplace animation would require its own published media and `animation_url` support.

References: [ERC-4906](https://eips.ethereum.org/EIPS/eip-4906), [OpenSea metadata standards](https://docs.opensea.io/docs/metadata-standards).
