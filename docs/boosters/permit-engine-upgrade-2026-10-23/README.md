# Permit-enabled booster opening candidate

This candidate lets a buyer sign an exact PROTO allowance off chain and submit approval plus one to ten independent original-pack openings in one onchain transaction. The current `0xeba9D4dEB6914Ab67A820Ea27C2fC3F43812E471` implementation supports batches but has no permit-opening entrypoint. The candidate is prepared and tested; it is not deployed or activated.

The new payable function is:

```solidity
openPacksWithPermit(uint256 packTypeId, uint32 count, uint256 maxTotalVrfPrice,
                    uint256 deadline, uint8 v, bytes32 r, bytes32 s)
```

It returns no values. Every independent request/original remains identified by its actual `RequestCreated` log, preserving the existing receipt-based grouped reveal. `PERMIT_OPEN_VERSION()` returns `1`; the existing `MAX_OPEN_PACKS()`, single/batch purchase functions, quote, claims, recovery and refunds remain available.

The permit is bound to `msg.sender`, this engine proxy, the configured token, the exact frozen pack price times count, and the purchase deadline. The guarded low-level token call forwards zero ETH and does not copy return data. A failed permit may already have been submitted by another sender, so payment proceeds through the existing `SafeERC20.safeTransferFrom` and balance/supply burn checks. Without sufficient valid allowance, the whole purchase reverts. The same path also works for a future non-permit ERC20 when the buyer already granted allowance.

All purchase entrypoints retain `nonReentrant`. A later wrapper/budget/sales failure rolls back the permit nonce/allowance, token burn, all original reservations and all VRF requests together. Caller and eventual original recipient remain the buyer. No application storage, request/original struct or reserved gap changes; all 75 prior ABI entries remain exact. The only added dependency is the standard `IERC20Permit` interface, whose full source/hash is included.

The shared batch body uses an equivalent count-error branch with the same error text and check order. Its unchecked price multiplication is bounded by a `uint128` price and count at most ten, well below `uint256`. The old direct single-opening body is unchanged.

## Reproducible artifacts

- `upgrade.unsigned.json`: deterministic unsigned owner package, SHA256 `ee7eb521a91a761192a915c64bd50ff16d03143c78ecd44452cecc87bc912afc`.
- `solc-standard-input.json`: exact 43-source compiler closure; all previous dependencies remain byte-identical and the one new interface is explicitly pinned.
- `contract-preparation.json`: source, runtime, immutable spans, full storage/ABI comparisons, preserved older package hashes and test evidence.
- `standalone-reproduction.json`: native Solidity 0.8.30 reproduces creation/runtime bytes exactly. ABI entries are identical ignoring order; immutable offsets match even though compiler AST identifiers differ.

The `permit` profile uses Solidity 0.8.30, Cancun, via IR, optimizer runs 1 and no bytecode hash. Runtime is **24,569 bytes**, leaving **7 bytes** below EIP170; creation code is 24,800 bytes. Recheck size after any contract change. Existing `out-batch`, `cache-batch`, the approved `bf068…` package and its compiler input are retained unchanged.

Executed from the repository root with the local pinned compiler/toolchain:

```sh
FOUNDRY_PROFILE=permit BOOSTER_FORK_RPC_URL= RUN_DEPLOYED_BOOSTER_FORK=false \
  /tmp/yunipals-foundry/node_modules/@foundry-rs/forge-linux-amd64/bin/forge test \
  --root contracts/boosters --offline --use /tmp/yunipals-solc-0.8.30
node scripts/boosters/prepare-permit-engine-upgrade.test.mjs
node scripts/boosters/prepare-permit-engine-upgrade.mjs
/tmp/yunipals-solc-0.8.30 --standard-json \
  < docs/boosters/permit-engine-upgrade-2026-10-23/solc-standard-input.json \
  > /tmp/yunipals-booster-permit-solc-reproduction.json
```

All 95 local contract tests passed: the 76 prior cases and 19 focused permit cases. Seven opt-in network-fork tests were skipped. Nine pure package controls passed. The independent contract review reran all 19 permit and 14 batch cases and reproduced the standalone compiler output. No provider requests, wallet signatures, broadcasts or production state changes were performed by these checks.

## Owner activation

The package pins the actual acknowledged batch implementation, runtime and source, the approved batch package and its mainnet activation record. With no explicit nonce input, it contains no predicted implementation address, nonce, gas limit or ready-to-send upgrade transaction.

The owner must first review fresh Base state and explicitly sign deployment. After the actual successful deployment receipt, verify its address-patched runtime, UUPS identity, ten-pack limit and permit version. The second explicit signature upgrades the existing proxy using `upgradeToAndCall(actualImplementation, 0x)`. Do not initialize the proxy again or change its pack rules, dependencies or pending state. Verify the installed runtime and both capability getters afterward.

This package does not sign a buyer permit or purchase a pack. The buyer UI and genuine mainnet permit opening require separate verification after owner activation. The previously prepared and completed batch upgrade remains historical evidence.
