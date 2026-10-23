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

At preparation time YPAL and the new stack are not deployed. No new address,
public activation, live permit purchase, VRF callback or explorer verification
is claimed until observed on Base.
