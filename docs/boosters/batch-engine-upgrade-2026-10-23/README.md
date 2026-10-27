# Batch purchase engine upgrade

Prepared unsigned package for the existing Base8453 engine proxy
`0x455FaBAd0ac8fF1eA4DF70ca07AA56A272cB2609`, owned by
`0xB3883Cd96d72B08b8226452305A28D65974a3727`.

The owner flow is `/boosters/setup/batch`. It requires two separate explicit wallet
reviews: deploy the new implementation, verify its actual successful receipt
address/runtime, then call `upgradeToAndCall(actualImplementation,0x)`. It never
initializes the existing proxy and does not purchase packs. The page rechecks
Base, owner, UPGRADER_ROLE, current proxy/implementation code, and exact
registry/monsters/wrapper before preparing and signing. The wallet supplies the
current nonce; no guessed gas, nonce or future implementation address is shipped.

`openPacks(typeId,count,maxTotalVrfPrice,deadline)` supports up to10 independent
originals in one user purchase transaction. Each original retains its own VRF
request, card history and daily claims. The existing single-purchase method stays
available before and after upgrade. `quoteOpenPacks(typeId,count,gasPrice)` returns
total VRF cost and callback gas per original. The ordinary purchase UI detects
capability; it does not call unsupported batch methods before the owner upgrade.

## Exact package and compiler

Public artifact `boosters/engine-batch-upgrade-v1.json`, SHA256
`bf06804bab6c68cd42515500af5c7118a1ee1ebf66a4f46c96a854fd7f80fc1e`,
is byte-identical to `upgrade.unsigned.json` in this directory. The curated full-app
builder verifies and copies it alongside the preserved `e59f7ce6…` monsters metadata
upgrade package.

Compile the candidate with the explicitly reviewed batch profile:

```sh
cd contracts/boosters
FOUNDRY_PROFILE=batch forge build --use /tmp/yunipals-solc-0.8.30 --offline
cd ../..
node scripts/boosters/prepare-batch-engine-upgrade.mjs --max-open-packs 10
node scripts/boosters/prepare-batch-engine-upgrade.test.mjs
```

The profile uses solc0.8.30, Cancun, viaIR, optimizer1 and metadata bytecode hash
none; output/cache are isolated in `out-batch`/`cache-batch`. The default audited
profile remains optimizer200. Runtime24258bytes fits EIP170; creation24489bytes
fits EIP3860. The generated standard input was independently compiled with native
solc0.8.30 and reproduced both candidate creation and runtime templates exactly.
This package does not deploy or select any other artifact.

The baseline fixture is the actual deployed old engine creation bytecode, checked
against mainnet deployment transaction4 and source SHA
`002e18027f375ac438d4cb9f5c9171cdca6dde63903163bd792f79cdafe7d49c`.
Its separate historical compiler immutable references reproduce the actual old
implementation runtime hash `0x5a38a201…`. All10 storage-layout rows are recursively
identical:9 application fields, original/request structs, pool/refund mappings and
all41 gap slots at8–48. Recovery/OZ dependencies are unchanged; only the already
approved monsters metadata source additions are allowed in the import closure.
No storage slot, schema, role, indexer, source, API, private configuration or provider
budget is changed by preparation.

## Owner verification and recovery

A successful implementation receipt must have the approved owner, exact creation
input, no recipient and zero ETH value. Its actual `contractAddress` is checked
against both compiler UUPS `__self` offsets, `proxiableUUID` and MAX_OPEN_PACKS10.
A manually restored address undergoes the same exact runtime checks. Upgrade
calldata is independently encoded with empty initialization bytes. Completion
requires the actual ERC1967 slot, candidate code/capability and preserved fixed
engine dependencies, rather than receipt status alone.

Versioned local storage contains public transaction hashes/address hints only.
Pending hashes block duplicate submissions; refresh and explicit receipt/address
recovery never submit transactions. Confirmed cancelled/reverted receipts require
explicit resolution. Wallet/account/network changes invalidate reviews, including
changes while the final simulation is pending. Repriced/replaced receipts are
checked against the approved creation/upgrade input and actual resulting state.

Validation:8 unsigned-builder controls,22 validator/receipt controls, full frontend
TypeScript, and7 synthetic real-browser groups passed. Browser tests execute the
actual owner page with all external requests blocked: exactly two synthetic
transactions, a deferred network switch producing zero sends, refresh/manual
runtime rejection, receipt restoration, explicit reverted-hash resolution and
mobile layout. They do not claim a real wallet upgrade. A public read-only Base
preflight at block52985612 separately confirmed the original audited implementation,
proxy code, owner role, fixed dependencies and unpaused state. No signatures or
broadcasts have been performed by this preparation.

A final published-product browser check and the owner's two explicit signatures
remain required. Current-state/fee reviews must be repeated by the page at the
time of signing; the historical preflight is evidence, not signing authority.
