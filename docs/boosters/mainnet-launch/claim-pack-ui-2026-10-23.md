# Daily packs and physical extraction

The Packs page shows purchased packs and one daily claim pack per owned original. Its accrued credits become multiple pulls from the same wrapper, capped at seven per request; excess credits stay saved. Cards remain on Collection. Original details link to Packs instead of starting a second claim flow.

The existing quote, wallet review, ownership checks and VRF flow are retained. A successful request can display its waiting state, but the ripping/card viewer starts only after onchain completion and an exact indexed request-card set. Mixed, incomplete or duplicate sets are rejected. Token IDs need not be consecutive; transfers and later burns do not change request membership.

The wrapper now paints in front of the extraction card and clips it at the moving opening, including transparent asset margins. A short peek precedes dragging. Cancelled touch/mouse drags retract safely; full extraction clears the wrapper. Multi-card packs tear once and continue pulling from the already-open wrapper.

Validation: thirteen source-bound browser checks, TypeScript checking, three request-membership validation tests, and the existing booster utility suite pass. The browser uses local fixtures with zero provider, signature or transaction calls. [Component evidence](claim-pack-component-acceptance-2026-10-23.json). A genuine elapsed daily mainnet claim is still separate and scheduled after the original’s 24-hour boundary.

Birth-day semantics are now agreed: elapsed whole days between the original NFT mint and this NFT’s mint, plus the actual mint timestamp. Existing tokenURI values identify a variant, so identical-looking NFTs share metadata today. Per-NFT birth metadata requires a separate token metadata path/contract upgrade; this UI release does not claim to supply it.
