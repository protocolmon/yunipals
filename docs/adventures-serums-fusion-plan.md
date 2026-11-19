# Adventures serums and fusion implementation plan

Draft for product decisions, 19 November 2026. Branch: `codex/adventures-serums-fusion`, based on `origin/main` at `1a96902`. This is a planning change; implementation and PR creation follow resolution of the decisions below.

## Confirmed product rules

- There are exactly 121 serum types, formed from two traits with 11 values each. The proposed names and rarity assignment are below; their balance is not yet approved.
- Every live TCG card, including fused cards, can adventure. Only its current owner can initiate the call; marketplace approvals do not confer this right.
- Adventures use Chainlink VRF v2.5 direct funding paid in native ETH. The result determines whether a serum is found and its type.
- A serum is contract state attached to a card, not an NFT, wallet inventory item or independently transferable asset. A newly found serum replaces that card's previous unused serum.
- Each card can adventure once per day. Higher mint-sequence positions have higher chances of rare outcomes.
- Applying a serum costs exactly 0.1 USDC, changes artwork and metadata, and stacks onto existing effects. Repeated applications of the same serum strengthen its effect.
- A card can drink at most 11 doses of its own. Every newly fused card retains both parents' effects and receives 11 new doses. A fully developed four-card result can therefore carry 77 doses across its ancestry.
- First fusion: two unfused cards at neighbouring sequence positions within the same original lineage; both must have the same owner.
- Second fusion: two first-level fusion cards from different original lineages, with no adjacency requirement between those lineages. It contains four distinct original source cards.
- Stop at the second fusion level: four-card fusions cannot fuse again. Reject base-plus-fusion and any other level combination.
- Each fusion operation costs exactly 0.1 USDC. Two first fusions plus their second fusion cost 0.3 USDC in total, excluding serum applications and transaction fees.
- Successful fusion burns both inputs and creates one new fusion NFT. Burning an original also ends its remaining daily offspring claims. Burning only offspring does not end their original's claims.
- There is no per-original limit of 11 fusions. Adjacency, ownership and consuming the inputs are the constraints.

## Proposed defaults still to review

| Decision | Proposed behavior |
| --- | --- |
| Daily reset | Rolling 24 hours from a successful adventure request, not midnight. Cooldown belongs to the card and survives transfer. |
| Empty adventure | Keep the previous unused serum. Only finding a new serum replaces it. |
| Adventure duration | Return when VRF settles; no artificial hours-long timer. |
| Fusion sequence for odds | Floor of the average immutable sequence of the original source cards; retain the exact sum and source count. Fusion gives no extra rarity multiplier. |
| Fusion cooldown | Inherit the later next-adventure time of the two inputs, so fusion cannot reset the daily timer. |
| Unused input serums | Discard at successful fusion; the new fusion starts with an empty unused-serum slot. Applied effects remain inherited. |
| Two equal effects | Preserve both contributions and increase intensity. A mixed fusion preserves both effects, without inventing a new serum ID. |
| Burning timing | Lock inputs and reserve the fee first; burn and mint atomically only after valid artwork is ready. |
| AI failure | Retry the same job without another fee. After a configured timeout, allow cancellation of the AI job, refund its escrowed fee and release its reservations. |
| Artwork ordering | Serum application order is part of the recipe. The result of A then B may differ from B then A. |
| Fusion collection | Use a dedicated ERC-721 fusion collection and show it together with base TCG cards in the UI. This avoids inventing a base variant ID for a multi-parent card. |
| Existing portal edits | Preserve the latest finalized artwork and its immutable asset reference; serialize all new mutation operations through a common version/lock mechanism. Grades remain tied to the artwork actually graded. |
| New artwork | Preserve recognizable species ancestry and the frame; no empty bottle on character artwork. Serum item previews may depict their bottle. |

A token with 11 locally consumed doses cannot drink again. It can still adventure under the stated product rule, but the UI must show the dose limit before the owner spends ETH; an unused serum does not raise the limit.

## Proposed serum traits

Use two independent catalogue traits: **Essence** describes the material/magic, and **Form** describes what physically changes. Every combination is a distinct serum, named `{Essence} {Form} Serum`. This is more visually varied than 121 palette swaps.

| ID | Essence | Main visual effect | Minimum rarity |
| --- | --- | --- | --- |
| 1 | Bloom | Living leaves, flowers and root growth | Common |
| 2 | Ember | Charred scales, magma seams and fire | Common |
| 3 | Tidal | Aquatic fins, flowing water and pearls | Common |
| 4 | Frost | Ice crystals and frozen mist | Uncommon |
| 5 | Storm | Charged markings and lightning | Uncommon |
| 6 | Crystal | Faceted mineral growth and refraction | Uncommon |
| 7 | Solar | Golden radiance and sun-forged armor | Rare |
| 8 | Starlight | Star fields, nebula glow and astral particles | Rare |
| 9 | Dreadthorn | Black thorns and venom-green corruption | Epic |
| 10 | Bloodmoon | Crimson eclipses and nightmare motifs | Legendary |
| 11 | Voidheart | Obsidian growth and violet singularities | Mythic |

| ID | Form | What changes | Minimum rarity |
| --- | --- | --- | --- |
| 1 | Veil | Aura, particles and surrounding glow | Common |
| 2 | Runes | Body markings | Common |
| 3 | Hide | Skin, scales, fur or fleece | Common |
| 4 | Crest | Horn and crown structure | Uncommon |
| 5 | Fangs | Muzzle, teeth and expression | Uncommon |
| 6 | Talons | Claws, hooves and limb detail | Uncommon |
| 7 | Spines | Back ridges, spikes and tail growth | Rare |
| 8 | Wings | Wings or species-compatible fin fans | Rare |
| 9 | Wraith | Spectral body material and edges | Epic |
| 10 | Sovereign | Regal armor and a larger, imposing silhouette | Legendary |
| 11 | Avatar | Extreme whole-body embodiment of the essence | Mythic |

For example: Bloom Runes, Ember Hide, Crystal Spines, Dreadthorn Wraith, Bloodmoon Sovereign and Voidheart Avatar.

The three dark essences should produce increasingly evil expressions and anatomy; the other essences remain recognizable fantasy transformations. Fusion level is a separate trait from serum Form: Eclipse and Singularity name our example fusion appearances, not extra serum types.

Rarity is the higher minimum rarity of the chosen essence and form. This yields 9 Common, 27 Uncommon, 28 Rare, 17 Epic, 19 Legendary and 21 Mythic serums, totaling 121. Every Voidheart serum is Mythic; every Bloodmoon serum is at least Legendary.

`serumId = 1 + (essenceId - 1) * 11 + (formId - 1)`; zero means no unused serum. See [the complete proposed catalogue](adventures-serums-catalog.draft.json), which enumerates all 121 IDs and names. Rarity, effects and rendering recipe version must be explicit, immutable attributes of a published catalogue version.

## Proposed adventure odds

These are initial balance proposals, not approved probabilities. Values below are unconditional probabilities per adventure, including finding nothing.

| Outcome | Sequence 0 | Sequence 263 |
| --- | ---: | ---: |
| Nothing found | 35% | 35% |
| Common | 40% | 25% |
| Uncommon | 18% | 24% |
| Rare | 6% | 12% |
| Epic | 0.9% | 3.5% |
| Legendary | 0.09% | 0.45% |
| Mythic | 0.01% | 0.05% |
| Total | 100% | 100% |

Interpolate by the immutable per-original sequence, not global token ID, date, wallet size or current artwork. Use parts per million for precision. Keep None fixed, floor the interpolated Uncommon-through-Mythic weights, and assign the remainder to Common so every integer sequence sums to exactly 1,000,000. Check monotonicity at all 264 positions.

Draw the outcome bucket, then choose uniformly among that rarity's serum IDs. Use separate domain-separated entropy for the two choices with unbiased bounded sampling. Freeze catalogue/rules version and effective sequence in the request before requesting VRF.

At the endpoints, any Mythic is approximately 1 in 10,000 versus 1 in 2,000 adventures. A particular one of the 21 Mythics is approximately 1 in 210,000 versus 1 in 42,000. These are per-attempt odds, not limited edition supplies; many cards adventuring daily can still produce many rare serums. Balance with portfolio-size simulations before acceptance.

## Variant counts

The base catalogue has **264** variants: 11 species × 6 colors × 2 horns × 2 glitter states. Each original lineage receives every base variant once, without replacement.

Define a variant here as a canonical trait/history recipe, ignoring token IDs, lineage IDs, mint times and incidental differences in AI pixels. Two equivalent recipes may generate different images; two recipes may look similar. Actual mintable supply depends on existing cards, their sequence permutations and which inputs have already been burned.

### Fusion only, before serum histories

| Recipe class | Formula | Count |
| --- | --- | ---: |
| Base cards | 264 | 264 |
| First fusion | C(264, 2) | 34,716 |
| Second fusion | C(34,716 + 1, 2) | 602,617,686 |
| Total | Sum of the above | **602,652,666** |

First-fusion inputs cannot have the exact same base variant because each variant occurs once in a lineage. They can have the same species, including two dragons with different color, horn or glitter traits. The dragon illustrations are appearance examples, not proof that every pair of depicted cards is eligible.

Second-fusion recipes allow repetition: the same first-fusion recipe can occur in two different original lineages. Pair order is irrelevant, but the pairing tree matters: (A+B)+(C+D) is a different recipe from (A+C)+(B+D).

These are theoretical recipe possibilities across all possible lineage permutations. One already minted, complete lineage offers only **263 adjacent candidate pairs**, and those overlap. At most **132 first-level fusions** can actually be made from its 264 cards. Two complete lineages offer 263² = **69,169 candidate four-source pairings**, before consuming inputs; at most 132 final four-card fusions can consume all cards across those two lineages. Do not advertise the theoretical counts as combinations simultaneously available to one owner.

### With up to 11 ordered doses per new card

With the confirmed allowance of 11 NEW doses per newly fused card, preserving its parents' histories, and the proposed rule that dose order is part of the recipe:

```
H = sum(121^k, k = 0..11)
  = 82,081,105,631,730,092,455,932 local serum histories

B = 264 × H
F1 = C(264, 2) × H³
F2 = C(F1 + 1, 2) × H
Total = B + F1 + F2
```

The three factors of H in F1 belong to its two source cards and the resulting fused card. F2 includes the two complete first-fusion recipes and its own local doses.

| Recipe class | Approximate possibilities |
| --- | ---: |
| Base with serum history | 2.16694 × 10²⁵ |
| First fusion with all histories | 1.91981 × 10⁷³ |
| Second fusion with all histories | 1.51262 × 10¹⁶⁹ |
| Total | Approximately **1.51262 × 10¹⁶⁹** |

This is a finite combinatorial recipe space, not a count of guaranteed visually distinct collectibles. If application order is intentionally discarded, a single card has C(132,11) = 3,461,014,728,350,400 unordered dose multisets instead of H. Existing free-text portal edits and future catalogue versions are outside these counts.

For comparison, allowing only one optional serum state per base card would produce 32,208 base appearances (264 × 122), but that is not the selected stacking design.

## Existing implementation anchors

- `contracts/boosters/src/YunipalMonsters.sol`: immutable provenance, originalTokenId, sequence/mint facts, owner-only burn, metadata routing and ERC-4906 events.
- `contracts/boosters/src/BoosterPacks.sol`: original claim rights, current-owner checks, native-funded VRF and original-burn forfeiture.
- `contracts/boosters/src/PortalRandomness.sol` and `BoosterProofRecovery.sol`: request binding, authenticated callback, saved entropy, same-proof recovery and excess-ETH refund credits.
- `contracts/boosters/src/PortalGrading.sol`: existing paid artwork jobs, input hashes/art versions, completion authority and graded metadata priority.
- `apps/yunipals-indexer/ponder.config.ts` and `lib/unified/`: the global source registry, canonical event ingestion, rollback-managed projections and confirmed reads.
- `packages/yunipals-indexer-server/src/readers.ts`: shared reader boundary, release identity, coverage and durable consumer cursors.
- `apps/yunipals-indexer/lib/portals/indexed-jobs.ts`, `worker.ts`, `store.ts`, `assets.ts` and `publication.ts`: indexed job intake, resumable paid work, immutable asset verification and publication checks.
- `apps/yunipals-home-web/src/pages/collection/`, `components/` and `hooks/usePortals.ts`: existing card browsing and wallet transaction flows.

The existing base tokenURI gives portal metadata precedence. Adding serum JSON to the booster metadata endpoint alone would therefore fail for already graded cards. Resolve mutation routing and art-version ownership explicitly.

## Contracts

Use four focused feature contracts, with shared interfaces and narrowly scoped upgrades to existing contracts.

1. **SerumCatalogue**: versioned 121-entry catalogue hash, trait IDs, rarity pools and sequence odds. Freeze versions once used; changes apply to future requests only.
2. **YunipalAdventures**: owner validation for registered base/fusion collections, per-card cooldown, pending request, effective sequence, unused serum, native VRF payment and settlement.
3. **YunipalEvolution**: 0.1 USDC escrow, serum-application and fusion jobs, card reservations, input snapshots, completion/failure state, artwork versions and deterministic history hashes.
4. **YunipalFusions**: ERC-721 collection for level-one and level-two results; immutable parents, flattened source-card references (maximum four), original-lineage references, sequence sum/count and inherited history commitment. No third level.

Bind dependencies through deployment-neutral configuration and validate both sides of each authorization relationship. Existing UUPS storage layouts must remain compatible; use reviewed namespaces or reviewed gap consumption, not blind baseline replacement.

### Adventure lifecycle

- `adventure(card, expectedRulesHash, maxVrfPrice, deadline)` checks live ownership, registered collection, initialized sequence facts, cooldown and absence of conflicting pending work.
- Set cooldown and request snapshot atomically with payment and VRF request; a transaction revert restores everything.
- Only one outstanding adventure per card. A transfer may carry the pending adventure and cooldown; the result belongs to the card's current owner.
- While randomness is pending, disallow consumption, fusion, burning and artwork mutations of that card. Freeze all result-relevant inputs.
- Callback authenticates the configured wrapper, saves the seed and performs only bounded, failure-isolated processing. A permissionless settle function can complete from the same seed.
- Settlement updates the unused-serum slot only on a successful find; None keeps it unchanged under the proposed default. Replaying callbacks or settle calls has no effect.
- Retain the existing same-proof recovery model. Do not offer a fresh VRF request to replace a missing/unfavorable result. Track requests by chain, consumer, wrapper and request ID.
- No AI request is made during an adventure, because the unchanged card does not yet drink the serum.

This follows Chainlink's [direct-funding model](https://docs.chain.link/vrf/v2-5/overview/direct-funding) and [security guidance](https://docs.chain.link/vrf/v2-5/security): bind inputs before requesting, authenticate fulfillment, avoid rerolls and keep callback work safe.

### Drinking a serum

- `consumeSerum(card, expectedSerumId, expectedArtVersion, expectedHistoryHash, deadline)` requires current ownership, an unused serum, fewer than 11 local doses and no conflicting job.
- Collect exactly 100,000 units of six-decimal USDC using SafeERC20 and verify the deposited amount. Reserve the serum and card against replacement, transfer, burn or another mutation.
- Emit a request with immutable input artwork/hash, recipe version, serum ID, lineage/history and payer.
- After the AI worker publishes validated assets, an authorized completion binds their image/metadata hashes to the request and prior art version.
- Atomically append the dose, increment local count and art version, clear the unused slot, release locks and pay the fee recipient. Emit MetadataUpdate.
- Retry provider/publication failures without another payment or increment. Terminal timeout refunds the original payer and restores the reserved serum; late completions cannot revive cancelled jobs.

### Fusion

- `requestFusion(cardA, cardB, expectedVersions, deadline)` requires exact ownership of both, registered collection/levels, distinct IDs and no pending adventures, generation or grading jobs.
- Level one: both are base cards in the supported 264-variant pack, same originalTokenId, initialized cardFacts and absolute sequence difference exactly one. No wrap between 263 and 0.
- Level two: both are level-one fusion cards, their original lineages differ, and all four leaf card IDs are distinct.
- Snapshot both current artworks and history hashes, reserve inputs and collect one 0.1 USDC fee.
- On successful completion, burn both inputs through narrowly authorized controller methods, then mint the one result to the requester atomically. A failure rolls back the whole finalization.
- The base burn path must still call onOriginalBurned for an original. Do not preserve claim rights contrary to the confirmed burn policy.
- Reject fusion of an original with an already outstanding booster claim. While it is reserved for fusion, prevent new offspring claims; elapsed claim time can continue accruing until success or cancellation.
- Input NFTs remain present and visibly pending until success. AI timeout cancellation releases them and refunds the fee.
- Record inherited cooldown and effective sequence without using the new fusion token ID as a sequence.
- Preserve source provenance after burn. Do not overwrite the 264-card base trait mapping or fabricate a single original ID for a two-lineage result.
- Previously minted offspring remain eligible to adventure and fuse after their original burns; lineage identity does not require that original to remain alive.
- Store at most 11 local serum IDs per card plus the two immutable parent references and history hashes. A level-two card has a bounded seven-node ancestry tree. Keep canonical recipe parent ordering independent of the owner's input order.
- Mint/receiver behavior must not let arbitrary receiver code corrupt completion or permanently trap a reserved job; rehearse contract-wallet recipients.

### Shared mutation and metadata integration

Introduce a common busy/art-version interface for serum, fusion and portal operations. Check it at both admission and finalization. Monster transfer/burn hooks and the fusion collection enforce relevant locks. A portal job accepted under old rules must complete or be explicitly migrated before enabling competing mutations on that card.

Use a single canonical resolver for latest finalized artwork. Existing portal records remain preserved and readable; new portal requests must use the latest serum/fusion art as input rather than an older portal image. A subsequent artwork mutation does not silently reuse a grade as if it assessed the new image. Fusion participation in portal gates needs an explicit lineage-derived rule or should remain unavailable in v1 with a clear UI explanation.

Events should include sufficient immutable data to rebuild state: AdventureRequested/Resolved, SerumReserved/Consumed, EvolutionRequested/Completed/Cancelled, FusionRequested/Completed, policy versions, parent/source references, fees and asset/history hashes. Emit ERC-4906 updates from the relevant NFT collection.

## Global indexer and AI worker

Extend the existing global Ponder indexer. Do not add a separate chain-log poller or dedicated ingestion service.

- Add feature source definitions, shared ABIs, source policies, deployment blocks and full receipt coverage where needed. Include new fusion transfers in canonical ownership.
- Project adventures, unused serums, local dose histories, immutable ancestry, jobs, locks, fees, cooldowns and current art versions into rollback-managed tables with historical versions for confirmed reads.
- Use the shared reader API with explicit source readiness. A missing or behind source is not an empty inventory.
- An offchain generation consumer reads confirmed canonical requests with a durable cursor. It never performs AI work inside Ponder handlers.
- Job identity binds chain, contract, request incarnation, input versions and recipe hash. Deduplicate replay and release handovers, preserve paid outputs across restarts, and reject outputs from orphaned/replaced requests.
- Revalidate canonical request state before paying for AI and before sending completion. Deep reorgs can still incur an unrecoverable provider cost; they must never produce a live orphan NFT.
- Reuse the existing provider boundary, asset validation, content-addressed storage, resumable stages and publication verification. Keep API credentials and signing keys outside indexer source configuration.
- Use approved parent artwork as input; for fusion provide both parents. Preserve the species and established visual grammar. Repeated serum doses affect intensity through the versioned recipe; do not generate a new random rarity.
- Generate on demand, retain immutable source images/metadata and historical outputs, and compose card text/frame deterministically where practical. Never attempt to pre-render the recipe space.
- The 0.1 USDC charge is the user price, not a proven estimate of provider cost. Benchmark representative single and dual-reference jobs, retries, storage and completion gas before launch. Any subsidy belongs in the operating budget; do not silently change the agreed fee.
- Keep a pending job's last finalized artwork visible. Publish the new image only when its onchain completion and indexed canonical evidence agree.

Suggested API resources: catalogue and odds; owner card state; per-card adventure status; compatible fusion partners; consume/fusion quotes; job progress; versioned metadata and ancestry. Quotes include expected ownership, artwork/history, serum/policy, fee and deadline, but contracts independently recheck eligibility.

## Frontend

Build the feature within the existing collection/card experience, with reusable dedicated adventure and fusion views as needed.

- Card detail: current art, local dose count /11, inherited history, unused serum, sequence odds, cooldown and adventure action.
- Adventure: clear native-ETH VRF estimate, wallet signature, awaiting randomness, found serum or no find, and saved-seed recovery where available.
- Serum reveal: illustrated bottle card, essence, form, rarity and an Apply for 0.10 USDC action. Explain that finding the next serum replaces the unused bottle.
- Consumption: preview of intended effects clearly marked as a concept, spending review, generation progress and eventual before/after.
- Fusion picker: only compatible owned partners; show original lineage and exact sequence positions rather than relying on appearance.
- Fusion review: two input cards, expected two/four-source result, inherited effects and 0.10 USDC. For an original, explicitly show that remaining daily claims end on successful fusion.
- Final card: clear fusion level, two/four-source family tree and locally consumed versus inherited doses.
- Pending work survives reload and wallet changes. Handle rejected signatures, insufficient USDC/ETH, expired quotes, transferred/burned cards, indexer lag, VRF delays and AI retry/cancellation separately.
- Use actual collection art and the approved Voidheart/Eclipse/Singularity examples as clearly labeled previews. No invented balances, active rewards or guaranteed generated output.
- Preserve accessibility, reduced-motion preferences, responsive layouts and lazy-loaded optimized artwork.

## Delivery sequence and verification

1. Approve the proposed catalogue, odds, artwork ordering and lifecycle defaults. Retain the confirmed inheritance and burn rules in the specification and fixtures on this branch.
2. Implement shared recipe definitions, exact combinatorial calculations and contract state machines. Test ownership, sequence checks, level boundaries, 11-dose cap, repeated doses and ancestry.
3. Implement metadata/version coordination and narrow compatible upgrades. Rehearse pending booster claims, original burns, portal jobs, transfer locks and rollback.
4. Extend global ingestion, ownership, confirmed projections and durable job intake. Test duplicate/out-of-order events, replay, reorgs, stale sources and release handover without duplicate paid generation.
5. Add generation/publication worker and API. Test retries, immutable input hashes, stale completions, timeout refunds, canonical publishing and USDC liability accounting.
6. Build frontend with deterministic mock fixtures, then local end-to-end contract/indexer/API/worker/browser flows using a stub AI provider. Complete Base Sepolia VRF and a bounded real-image quality/cost rehearsal when implementation is ready.
7. Run relevant contract suites, storage compatibility checks, indexer/Postgres integration tests, frontend/type checks and production builds. Require invariant/fuzz coverage for financial state, burns, locks and request replay.
8. Prepare a PR with the confirmed rules, architectural changes, user flow screenshots, validation evidence and deployment-neutral migration/rollback instructions. Production release uses the private operator workflow and is a separate step.

Primary invariants: no unauthorized actions; each source card consumed at most once; each successful job charged once; no third fusion level; no dose increment on retry; cooldown never reset by transfer/fusion; no fresh randomness for recovery; no new artwork overwrites a newer version; escrow/refund liabilities stay covered; original claim forfeiture happens exactly on original burn.

Before public launch, resolve the product's existing legal question about paid randomized adventures and rarity-weighted tradable transformations. The guaranteed base collection alone is not being treated as approval for these new mechanics.
