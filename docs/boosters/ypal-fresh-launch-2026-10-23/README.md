# Fresh YPAL launch

The user confirmed on 23 October 2026 that packs should restart with a new PMON
wrapper, a fresh registry, engine and NFT collection, and one unlimited public
pack. There is no capped or smoke-test pack in this launch. Existing PROTO pack
openings and collection rights are outside the new active product; their old
onchain records and recovery data are not rewritten.

YPAL is named **Yunipals**, with symbol **YPAL**. Its starting source and all
dependencies come from the verified Base PROTO contract
`0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3`. Preserve wrapping and unwrapping at
1:1, ERC-2612 permits, PMON-backed burning, ownership, configuration locking and
reserve-preserving recovery functions. The new token starts without minted
supply. The approved deployment wallet owns its administration directly.

The live reference check at Base block 52,993,724 confirmed these inputs:

- Owner for the new deployment: `0xB3883Cd96d72B08b8226452305A28D65974a3727`.
- PMON: `0x60edae6E86546428DA423b5FBe0fba46Ca552Fc7`.
- PMON burn destination: `0xff2Ba07e6F84D22730eD78D1117735a4B041c6EF`.
- Initial wrapper configuration is unlocked, matching PROTO's current setting.
- Chainlink VRF wrapper: `0xb0407dbe851f8318bd31404A49e658143C982F23`.

The fresh pack burns 1 YPAL per original. Each original has an independent,
duplicate-free set of 264 variants; one additional mint accrues every rolling
24 hours after reveal. Existing transfer, burn, pending-claim, refund and proven
VRF recovery semantics remain. A transaction can buy up to ten originals; daily
claims keep their seven-pull callback limit. There is no speed boost.

Reuse the approved lavender artwork, precise OG species/color references,
shared images per variant and interactive foil layers. The existing immutable
artwork manifest can be reused by the fresh pack without importing old token
ownership or opening history. Per-NFT metadata uses the fresh collection's
actual address and retains birth-day attributes.

## Deployment sequence

The wallet review builds each step from confirmed receipts, never from a guessed
nonce or a predicted future address:

1. Deploy YPAL with the approved PMON and burn destination.
2. Deploy the registry implementation.
3. Deploy and initialize its fresh proxy.
4. Deploy the NFT implementation, including per-NFT metadata support.
5. Deploy and initialize its fresh proxy.
6. Deploy the permit-enabled engine implementation.
7. Deploy and initialize its fresh proxy with the confirmed dependencies.
8. Set the fresh collection's token-specific metadata base URI.
9. Configure exactly one unlimited public pack using YPAL.
10. Activate the actual configured type from its receipt.

All ten actions need explicit wallet review and signature. Source preparation,
local tests and explorer verification do not send those transactions. Pending,
reverted, replaced and cancelled transactions require receipt reconciliation;
leaving the page or changing wallet/network invalidates an unsubmitted review.

## Indexing and public cutover

After actual deployment, bind the launch manifest to confirmed receipt addresses,
creation data, runtimes, initialized roles, implementation slots and deployment
blocks. Index only the fresh active booster stack in a new launch schema. Keep
the existing OG collection and running shared BNB replay intact. Rebind the
booster API, queue, collection views, recent openings and buyer transactions to
the fresh stack; old TCG NFTs and requests must not leak into the new product.

The final shared-indexer source manifest also needs the fresh deployment. Its
existing historical replay and caches must be preserved until the replacement
source has been prepared and accepted. The old booster comparison and temporary
scanner retirement evidence cannot be reused as proof for a new deployment.
The final objective remains one managed indexer across the configured chains.

## Confirmed deployment, 23 October 2026

The owner completed all ten actions. The actual receipt-derived addresses are:

- YPAL: `0xCd3709E84fc817b46196FA2D5b7202710AB51346`.
- Registry: `0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3`.
- NFT collection: `0x7D62628806E7eeF76A354C7c48787879e3440b16`.
- Engine: `0xDF4AaA47Fe0e8208b5a33c74898f834B2952189e`.

[deployment.confirmed.json](deployment.confirmed.json) binds all ten successful
canonical receipts to the reviewed package. Public type 1 is active and unlimited.
Independent current-state checks cover the deployed bytecode, implementation
slots, roles, PMON backing/configuration, permit domain, rules and metadata prefix.

[BaseScan results](verification/basescan-results.json) were completed at
19:00 UTC. YPAL and all three implementations have full exact-source verification.
The three proxies have correctly linked implementations and a fully verified
similar-source reference. Its complete creation/runtime bytecode and ABI were
independently recompiled and match the reviewed deployment exactly; the
[reference evidence](verification-proxy-reference/README.md) records the distinct
compiler settings and source paths without calling these new addresses full
exact-source matches.

The website still awaits the fresh indexing/API switch and buyer activation.
This deployment and explorer verification do not establish a first YPAL purchase,
VRF callback or daily claim. Those require separate observations after cutover.
