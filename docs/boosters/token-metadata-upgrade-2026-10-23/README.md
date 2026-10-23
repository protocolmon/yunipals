# Per-NFT monster metadata upgrade

Status: prepared and locally tested; no deployment, signature or mainnet transaction was performed by the preparation tools. This is an upgrade candidate requiring owner execution and source verification, not a new audit approval.

The existing Monsters proxy is `0x105319be2182018c31FB10B1bE198c3cf238a146` on Base (8453). The recorded implementation is `0xDe0f58649B6D272E4b7AFAeE1231F2c83c1599b9`. The unsigned package pins their code hashes and the existing owner `0xB3883Cd96d72B08b8226452305A28D65974a3727`; these must be checked again against the live chain before signing.

The new implementation optionally returns `<tokenMetadataBaseURI><tokenId>.json`. Until configured, or after resetting the base to the empty string, it returns the existing frozen pack variant URL. The configured URL is:

```
https://api.yunipals.com/yunipals-indexer/v1/boosters/metadata/0x105319be2182018c31fb10b1be198c3cf238a146/
```

This allows two NFTs with the same artwork variant to have distinct mint metadata. The API derives the actual NFT mint timestamp from indexed chain data. Its birth day is `floor((this NFT's mint timestamp - original NFT's mint timestamp) / 86400)`, and an original is day zero. This upgrade does not store or calculate dates, change trait/artwork selection, or modify pack, daily-credit, supply, transfer or burn rules. Artwork remains shared by variant.

`setTokenMetadataBaseURI` requires the existing `CONFIG_ROLE`. The existing UUPS upgrade requires `UPGRADER_ROLE`. URI configuration accepts an empty reset, or a literal HTTPS/IPFS base of at most 512 bytes ending in `/`. Credentials, escapes, whitespace, queries and fragments are rejected. The setter emits `TokenMetadataBaseURISet` and EIP-4906 `BatchMetadataUpdate(0, nextTokenId - 1)` when IDs have been allocated; that range can include burned or reserved IDs. ERC-165 reports EIP-4906 support.

Storage consumes one existing gap slot: the original four fields and the complete `Provenance` struct remain unchanged, the new string occupies slot 4, and the 45-slot gap spans slots 5–49. No reinitializer is used. OpenZeppelin namespaced ERC-721, initialization and access-control storage is unchanged. The legacy fixture contains the exact creation payload from the committed mainnet deployment package, rather than an approximation of the old implementation.

## Reproduce the review package

Use the repository's existing Foundry dependencies and Solidity 0.8.30. Compiler settings remain Cancun, optimizer 200 runs, via IR and no metadata bytecode hash.

```sh
cd contracts/boosters
forge test --offline -vv
cd ../..
python3 scripts/boosters/check-storage.py
node scripts/boosters/prepare-token-metadata-upgrade.test.mjs
node scripts/boosters/prepare-token-metadata-upgrade.mjs
cp docs/boosters/token-metadata-upgrade-2026-10-23/upgrade.unsigned.json apps/yunipals-home-web/public/boosters/monsters-token-metadata-upgrade-v1.json
```

Do not run the storage script with `--write-baseline`; the committed pre-upgrade baseline remains the compatibility authority. `solc-standard-input.json` is a self-contained verification input whose independently recompiled creation bytecode matches the Foundry candidate.

The default package leaves the nonce, gas estimate and deployment address unknown. Its deployment transaction can be prepared by the wallet; the upgrade transaction is intentionally unresolved until the actual implementation address is known. The owner setup UI pins this public package and uses the confirmed deployment receipt address. For a separately reviewed deterministic nonce plan, the script also accepts `--starting-nonce DECIMAL`; that supplied nonce is never represented as freshly verified, and an intervening wallet transaction invalidates the predicted addresses.

## Owner execution and checks

1. Recheck the chain, owner, proxy code, ERC-1967 implementation slot, old implementation code and both required roles. Verify the NFT #1 metadata response identifies collection/token/original correctly, has birth day zero and the actual mint timestamp. Check an existing offspring too when available. Variant IDs are artwork identities and must not be substituted for token IDs in this endpoint.
2. Estimate gas and deploy only `candidate.creationBytecode` from the package. Confirm the receipt and actual implementation address. Read and hash its runtime code after replacing the template's two 32-byte `__self` immutable spans with that address. Compare `proxiableUUID` to the pinned implementation slot.
3. Recheck that the proxy still has the recorded old implementation. Estimate and sign `upgradeToAndCall(actualImplementationAddress, configurationCalldata)`. This atomically upgrades and configures the exact approved URI. A configuration revert rolls the upgrade back. Do not initialize the proxy again.
4. Confirm the implementation slot, configured base, NFT #1 token URI, an offspring URI, ownership/provenance and refresh event. Verify the implementation source on BaseScan with the supplied compiler input. Preserve the receipt and hashes as separate live execution evidence.

The preparation script makes no RPC requests and never signs or broadcasts. It supplies no fee, gas limit or current balance claim. Unpublished metadata must be resolved before activating the URI. If the metadata service later needs correction, the existing `CONFIG_ROLE` can reset the base to `""` to restore the original variant URLs and emit a refresh event. A further implementation change requires its own reviewed upgrade; there is no automatic downgrade transaction in this package.

## Validation

The focused suite passes eight tests against a proxy initially running the exact historical creation payload. It verifies owners, balances, approvals, roles, provenance, reserved originals, IDs, continued minting, frozen rules, matching-variant token URL separation, role denial, atomic failure rollback, URI guards, interface/events and nonexistent/burned token behavior. The full local suite passes 62 tests; seven RPC-dependent fork cases are skipped without network configuration. The offline package has five focused controls, and the standalone compiler reproduction is byte-identical. See `preparation.json` for the exact artifact hashes and limits of this evidence.
