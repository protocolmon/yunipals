# Adventures serums and fusion implementation plan

Approved product plan, updated 20 November 2026. Branch: `codex/adventures-serums-fusion`, based on `origin/main` at `1998529`. Product decisions are settled and the full-stack implementation is prepared for review. Production release remains a separate step.

## Confirmed product rules

- There are 121 named Essence × Form serum types, each with 11 possible Presence traits: 1,331 complete serum combinations. Keep the existing serum names and display Presence separately. Visual direction, Presence lifecycle and weights, Essence/Form rarities and the eleven-tier adventure drop table are approved.
- Holy has a 1% chance among found serums; each of the other ten Presences has a 9.9% chance. This roll is independent of Essence/Form rarity and does not vary with sequence. Higher sequence still improves the chance of rare Essence/Form outcomes.
- Drinking a serum replaces the card's current Presence with the new serum's Presence. Earlier physical effects continue stacking, and every dose's Presence remains in ordered history. This includes replacing Holy with a non-Holy Presence.
- Fusion randomly inherits one input card's current Presence, with an equal 50/50 parent selection when they differ. The owner does not choose, and the image generator does not roll the result. Matching parent Presences produce that same Presence with certainty. Preserve both parents' histories and the settled inheritance result.
- An unmodified parent counts as neutral (Presence 0) in that same 50/50 inheritance. Holy plus neutral has a 50% Holy / 50% neutral outcome; two neutral parents remain neutral.
- Approved art direction: expressive eyes and poses, essence-specific environments, recognizable Yunipal identity, a clearly visible Presence trait and dramatically enhanced Avatars. Avatar combines the other forms into one coherent maximum-enhanced creature and still consumes only one dose. Character artwork contains no bottle.
- Every live ungraded TCG card, including fused cards, can adventure. Graded cards cannot adventure. Only the current owner can initiate the call; marketplace approvals do not confer this right.
- Adventures use Chainlink VRF v2.5 direct funding paid in native ETH. The result determines whether a serum is found and its type.
- Adventures resolve when VRF settles, without an additional artificial adventure timer. The rolling 24-hour cooldown remains separate from result timing.
- A serum is contract state attached to a card, not an NFT, wallet inventory item or independently transferable asset. A newly found serum replaces that card's previous unused serum.
- Each card can adventure once per rolling 24 hours. Higher mint-sequence positions have higher chances of rare outcomes. An adventure that finds nothing keeps the previous unused serum.
- First serum use assigns a permanent Normal / Golden / Black finish at 70% / 25% / 5%; every new fusion rolls a fresh finish. First-serum and fusion rolls use player-funded VRF, separate from serum rarity and Presence.
- Applying a serum costs exactly 0.1 USDC, changes artwork and metadata, and stacks onto existing effects. Repeated applications of the same serum strengthen its effect.
- A card can drink at most 11 doses of its own. Every newly fused card retains both parents' effects and receives 11 new doses. A fully developed four-card result can therefore carry 77 doses across its ancestry.
- Application order matters: A then B can differ from B then A, and both remain recorded in history.
- First fusion: two unfused cards at neighbouring sequence positions within the same original lineage; both must have the same owner.
- Second fusion: two first-level fusion cards from different original lineages, with no adjacency requirement between those lineages. It contains four distinct original source cards.
- Stop at the second fusion level: four-card fusions cannot fuse again. Reject base-plus-fusion and any other level combination.
- Each fusion operation costs exactly 0.1 USDC for generation. The player also pays the quoted Chainlink VRF cost in native ETH for every fusion to roll its new finish, plus ordinary transaction gas. The same request also settles Presence; matching Presences remain guaranteed. Two first fusions plus their second fusion cost 0.3 USDC in total, excluding any VRF charges, serum applications and transaction fees.
- Successful fusion burns both inputs and creates one new fusion NFT. Burning an original also ends its remaining daily offspring claims. Burning only offspring does not end their original's claims.
- Reserve inputs and the generation fee while a fusion is pending. Burn the inputs and mint the result atomically only after successful artwork completion. Applied effects remain inherited; unused input serums are discarded only when fusion succeeds.
- The fused card inherits the later next-adventure time of its inputs, so fusion cannot reset the cooldown.
- There is no per-original limit of 11 fusions. Adjacency, ownership and consuming the inputs are the constraints.
- Fusion NFTs belong to the existing YunipalMonsters ERC-721 collection, using compatible upgrades and distinct fusion provenance. Both fusion levels must be supported by portal grading.
- Fused-card adventure odds use the floor of the average immutable sequence of all original source cards. Store the exact sequence sum and source count; do not average already rounded intermediate values.
- A fusion qualifies for a portal when one actual source card satisfies all of its applicable requirements together. An originals-only portal accepts the fusion if that matching source card was an original.
- Grading uses the existing player spell → portal transformation → graded result flow. Preserve the card's defining serum and fusion features while adding the portal effect and spell.
- Grading retains existing admission fees, competition scoring and the one-completed-grade rule. Serum rarity, dose count and fusion level confer no automatic score bonus; the 0.1 USDC evolution fee does not include grading.
- Once a card has a completed grade, it cannot adventure, consume serums or be used as either input to a fusion. This applies to both base and fused cards, including cards graded before the feature launches. Preserve the current product's one-completed-grade rule; this feature does not introduce regrading. An original's daily offspring claims remain available.
- Failed artwork jobs remain recoverable and are retried until completed, without charging again. There is no automatic timeout cancellation/refund. Durable job recovery and operator intervention are required; provider availability is not a contract-level guarantee.

## Lifecycle rules and implementation details

| Decision | Behavior |
| --- | --- |
| Adventure duration | Return when VRF settles; no artificial hours-long timer. |
| Fusion cooldown | Inherit the later next-adventure time of the two inputs, so fusion cannot reset the daily timer. |
| Unused input serums | Discard at successful fusion; the new fusion starts with an empty unused-serum slot. Applied effects remain inherited. |
| Two equal effects | Preserve both contributions and increase intensity. A mixed fusion preserves both effects, without inventing a new serum ID. |
| Burning timing | Lock inputs and reserve the fee first; settle any fusion Presence randomness, then burn and mint atomically only after valid artwork is ready. |
| Unmodified fusion parent | A parent with no consumed serum has Presence 0 (neutral/no Presence). Under confirmed equal parent inheritance, Holy + neutral has a 50% Holy / 50% neutral outcome. |
| Pending generation | Keep the card/input reservations until completion, with visible status and durable retry. There is no automatic release after a timeout. This can prevent use or transfer for the whole delay. |
| Grading economics | Use the existing portal-kind admission fees and competition contribution, separately from the 0.1 USDC serum/fusion fee. No automatic grading is bundled into that fee. |
| Grading competition | Use the same competition and scoring rubric, with no automatic bonus for serum rarity, number of doses or fusion level. Calibrate against matched base and fused-card examples. |
| Existing portal edits | Preserve the latest finalized artwork and its immutable asset reference; serialize all new mutation operations through a common version/lock mechanism. Grades remain tied to the artwork actually graded. |
| Unused serum after grading | Retain it as inactive attached state/history; it cannot be consumed or transferred separately. |
| New artwork | Preserve recognizable species ancestry and the frame; no empty bottle on character artwork. Serum item previews may depict their bottle. |

A token with 11 locally consumed doses cannot drink again. An ungraded card can still adventure under the stated product rule, but the UI must show the dose limit before the owner spends ETH; an unused serum does not raise the limit.

## Confirmed grading lifecycle and eligibility

Grading ends a card's adventure, serum and fusion progression. Owners can build an ungraded card through serum applications and up to two fusion levels, then enter a portal to transform and grade it. After a completed grade, adventures, serum consumption and further fusion are permanently unavailable for that token under the feature rules. Preserve the existing one-completed-grade admission rule. Failed or rejected attempts that never completed do not permanently mark a card graded.

This restriction is per card, not per original lineage. Grading an original does not end its daily offspring claims or make its offspring graded. Those offspring have independent eligibility. Only burning the original ends its remaining claim rights.

For adventure odds, source positions 40, 41, 200 and 201 yield floor(482 / 4) = 120. This derived value is not a reassigned family sequence or the fusion's ERC-721 token ID. Store ancestral positions exactly, so rounding at an intermediate fusion never loses information.

Include a rounding regression for sources 40, 41, 201 and 202: the correct derived position is 121. Averaging the already rounded intermediate values 40 and 201 would incorrectly yield 120.

Portal gates use an actual ancestor, not that average. A red dragon and a blue aqua cannot combine their separate traits into a blue-dragon match. For an originals-only portal, the same qualifying source must also have been an original; an unrelated original elsewhere in the ancestry does not satisfy the requirement. Preserve the portal's existing original-only-versus-sequence gate semantics.

A qualifying burned original remains usable as provenance evidence. It does not become live again, restore daily offspring claims, or change the fused token into a base original.

Pending adventures, grading and evolution jobs are mutually exclusive. Starting a grading job temporarily blocks adventure, serum and fusion requests; successful grading makes those restrictions permanent. A generation delay cannot be bypassed by transferring the NFT or hiding its grading metadata.

## Product decisions approved

The eleven Presence concept cards, Holy at 1%, other Presences at 9.9% each, latest-dose Presence replacement, random parent inheritance and player-funded fusion VRF are confirmed. The final five lifecycle choices are also confirmed: VRF-settlement adventure timing, later inherited cooldown and unused-serum discard, neutral-parent inheritance, reservations until successful artwork completion, and existing grading fees/scoring/one-grade policy.

The user approved eleven tiers of 24 sequence positions, with fixed probabilities inside each tier and the same starting/maximum rates. This replaces the earlier per-position interpolation proposal. The remaining technical defaults in the lifecycle table are implementation choices consistent with the confirmed rules, not additional product questions.

The branch has been rebased onto current main while preserving the plan. Current-main `apps/yunipals-indexer/lib/portals/chain.ts` rejects admissions with an already completed grade, and the card picker excludes graded cards. The earlier plan's regrading assumption has been removed. When evolved artwork introduces nonzero art revisions, replace the API's current `artVersion != 0` shortcut with canonical completed-grading history so an ungraded serum/fusion card remains gradeable.

### Confirmed final lifecycle review

- Adventure result arrives when VRF settles; no additional artificial adventure timer.
- Fusion inherits the later input adventure cooldown, so fusion cannot reset daily eligibility.
- Successfully fusing discards unused input serums; all already-applied effects and histories remain inherited.
- A neutral/unmodified parent participates in the same 50/50 inheritance. Matching Presences, including two neutral parents, produce a guaranteed result.
- Reserve the inputs and generation fee on request. Burn and mint atomically only once valid artwork is ready. Retry the same job until completion without another generation fee or another randomness draw; no automatic timeout cancellation/refund.
- Preserve existing grading fees and competition scoring. Serum rarity, dose count and fusion level confer no automatic score bonus. Grading ends progression and keeps the existing one-completed-grade rule.
The lifecycle rules and adventure drop-rate table are approved; production release remains a separate step.

## Approved serum traits

Use three catalogue traits: **Essence** describes the material/magic, **Form** describes what physically changes, and **Presence** controls eyes, expression and body language. Each Essence/Form pair retains the name `{Essence} {Form} Serum`; Presence is a separate visible trait, giving 1,331 complete combinations without requiring 1,331 different serum names.

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
| 5 | Fangs | Muzzle and teeth; expression follows Presence | Uncommon |
| 6 | Talons | Claws, hooves and limb detail | Uncommon |
| 7 | Spines | Back ridges, spikes and tail growth | Rare |
| 8 | Wings | Wings or species-compatible fin fans | Rare |
| 9 | Wraith | Spectral body material and edges | Epic |
| 10 | Sovereign | Regal armor and a larger, imposing silhouette | Legendary |
| 11 | Avatar | Maximum enhancement combining wings, fangs, talons, spines, hide, runes, crest, armor, aura and spectral details into one coherent creature | Mythic |

For example: Bloom Runes, Ember Hide, Crystal Spines, Dreadthorn Wraith, Bloodmoon Sovereign and Voidheart Avatar.

The three dark essences retain dark materials and supernatural motifs, while Presence controls disposition. A Holy Voidheart can therefore have obsidian anatomy and sacred luminous eyes; a Bloom creature can be aggressive. Do not force every dark essence to look evil or let Fangs override a calm Presence. Fusion level is a separate trait from serum Form: Eclipse and Singularity name our example fusion appearances, not extra serum types.

### Approved Presence and environment direction

| ID | Presence | Defining expression and pose |
| --- | --- | --- |
| 1 | Holy | Luminous ivory-gold eyes with halo-shaped irises, compassionate expression and dignified posture |
| 2 | Aggressive | Narrowed eyes, bared teeth and a tense forward stance |
| 3 | Calm | Soft, focused eyes and balanced, attentive composure |
| 4 | Chill | Half-closed eyes, loose limbs and a casual lounging pose |
| 5 | Happy | Bright eyes, open smile and playful movement |
| 6 | Panicked | Wide eyes, startled recoil and frantic movement |
| 7 | Mischievous | Knowing grin, sideways glance and sneaking posture |
| 8 | Proud | Raised chin, lifted chest and deliberately displayed features |
| 9 | Curious | Tilted head, attentive gaze and tentative exploration |
| 10 | Melancholic | Downcast eyes, lowered head and a quiet, slumped pose |
| 11 | Sinister | Calculating stare, unsettling smile and deliberate stillness |

All serums influence the environment. Essence supplies the setting and materials; Form controls the scale of the transformation, and Presence informs lighting, stillness or movement. Avatar transforms the entire scene along with the creature. Preserve identifiable ancestry and the Yunipals card style across all combinations. Backgrounds are derived artwork, not a fourth rolled trait.

The approved local reference set is `generated/serum-presence-examples/`, with all eleven original images and exact generation prompts. This ignored review artifact must be curated into versioned, deployment-neutral worker reference assets before implementation; runtime jobs must not depend on a developer worktree. The examples vary Essence and Form as well as Presence and are visual targets, not a controlled same-serum comparison.

Rarity is the higher minimum rarity of the chosen essence and form. This yields 9 Common, 27 Uncommon, 28 Rare, 17 Epic, 19 Legendary and 21 Mythic serums, totaling 121. Every Voidheart serum is Mythic; every Bloodmoon serum is at least Legendary.

`serumId = 1 + (essenceId - 1) * 11 + (formId - 1)`; zero means no unused serum. Store an unused serum and each applied dose as at least `(catalogueVersion, serumId, presenceId)`; Presence IDs are 1–11 for found serums, with zero reserved for an unmodified card. See [the complete approved catalogue](adventures-serums-catalog.draft.json), which enumerates all 121 IDs and names plus eleven Presence values. Rarity, Presence distribution, effects and rendering recipe version must be explicit, immutable attributes of a published catalogue version.

## Approved adventure odds

The approved table has eleven tiers of 24 positions each, covering all 264 positions exactly. Odds are fixed inside a tier and improve at each tier boundary. All values below are unconditional probabilities per adventure; **Nothing found stays 35% in every tier**, so each row totals 100% including that outcome.

| Tier | Sequence positions | Common | Uncommon | Rare | Epic | Legendary | Mythic |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 0–23 | 40% | 18% | 6% | 0.90% | 0.090% | 0.010% |
| 2 | 24–47 | 38.5% | 18.6% | 6.6% | 1.16% | 0.126% | 0.014% |
| 3 | 48–71 | 37% | 19.2% | 7.2% | 1.42% | 0.162% | 0.018% |
| 4 | 72–95 | 35.5% | 19.8% | 7.8% | 1.68% | 0.198% | 0.022% |
| 5 | 96–119 | 34% | 20.4% | 8.4% | 1.94% | 0.234% | 0.026% |
| 6 | 120–143 | 32.5% | 21% | 9% | 2.20% | 0.270% | 0.030% |
| 7 | 144–167 | 31% | 21.6% | 9.6% | 2.46% | 0.306% | 0.034% |
| 8 | 168–191 | 29.5% | 22.2% | 10.2% | 2.72% | 0.342% | 0.038% |
| 9 | 192–215 | 28% | 22.8% | 10.8% | 2.98% | 0.378% | 0.042% |
| 10 | 216–239 | 26.5% | 23.4% | 11.4% | 3.24% | 0.414% | 0.046% |
| 11 | 240–263 | 25% | 24% | 12% | 3.50% | 0.450% | 0.050% |

Compute `tier = 1 + floor(effectiveSequence / 24)` for the supported range 0..263. A base card uses its immutable per-original sequence. A fused card first computes the floor of the exact average of all original source positions, then selects its tier; do not average parent tiers or already rounded intermediate averages. For example, sources 40, 41, 200 and 201 yield effective sequence 120 and tier 6. Portal eligibility still evaluates actual source cards, not the adventure tier.

Store the eleven exact weight rows in parts per million; each totals 1,000,000. Validate complete nonoverlapping coverage of all 264 positions, fixed odds within each tier, increasing Uncommon-through-Mythic weights at all ten boundaries, decreasing Common weights and unchanged None. The table's weights are exact integers, so no runtime interpolation or residual rounding is needed. Preserve sequences as immutable positions; tiers are not levels gained by taking more adventures.

Draw the outcome bucket, then choose uniformly among that rarity's serum IDs, then draw Presence using its approved distribution. Use separate domain-separated entropy for all three choices with unbiased bounded sampling. Freeze catalogue/rules version, Presence distribution, effective sequence and its derived tier in the request before requesting VRF. Recovery reuses the same entropy and must never reroll Presence or use a newer tier table.

At the endpoints, any Mythic is approximately 1 in 10,000 versus 1 in 2,000 adventures. A particular one of the 21 Mythics is approximately 1 in 210,000 versus 1 in 42,000. These are per-attempt odds, not limited edition supplies; many cards adventuring daily can still produce many rare serums. Review portfolio-size simulations before release.

### Approved Holy weights and adventure balance

Confirmed Presence distribution: independently draw Holy at 1% of found serums and each other Presence at 9.9%. This remains constant across sequences; higher sequence still improves rare Essence/Form outcomes. Under the approved 65% find rate, any Holy serum has a 0.65% per-adventure chance, approximately 1 in 154.

| Direct adventure result | Sequence 0 | Sequence 263 |
| --- | ---: | ---: |
| Any Holy serum | 1 in 154 | 1 in 154 |
| Any Holy Mythic serum | 1 in 1,000,000 | 1 in 200,000 |
| A specific Holy Mythic, e.g. Holy Voidheart Avatar | 1 in 21,000,000 | 1 in 4,200,000 |

Under one adventure per card each day for 30 days, expected counts are:

| Adventuring cards | Any Holy finds | Any Mythic finds, all sequence 0 | Any Mythic finds, all sequence 263 |
| --- | ---: | ---: | ---: |
| 1 | 0.195 | 0.003 | 0.015 |
| 11 | 2.145 | 0.033 | 0.165 |
| 100 | 19.5 | 0.3 | 1.5 |
| 1,000 | 195 | 3 | 15 |

These are analytical expected counts, not guarantees, empirical simulations or probabilities of at least one find. They assume every adventure is completed daily; generation locks and grading can reduce attempts. A complete lineage spans all sequences rather than either endpoint. A new find can replace an unused serum, so findings are not a wallet inventory balance.

Holy is not necessarily tied to a Mythic dose: a cheaper/common Holy serum can set Presence on a card that already has Mythic physical effects, and a Holy parent can pass Presence to a fusion. Therefore the tiny direct combined-drop probabilities must not be advertised as the rarity of obtaining a final Holy transformed card. Every new drink still sets the latest Presence, even if it replaces Holy.

## Variant counts

The base catalogue has **264** variants: 11 species × 6 colors × 2 horns × 2 glitter states. Each original lineage receives every base variant once, without replacement.

Define a variant here as a canonical trait/history recipe, ignoring token IDs, lineage IDs, mint times and incidental differences in AI pixels. Two equivalent recipes may generate different images; two recipes may look similar. Actual mintable supply depends on existing cards, their sequence permutations and which inputs have already been burned.

### Fusion structure, before serum histories and finishes

| Recipe class | Formula | Count |
| --- | --- | ---: |
| Base cards | 264 | 264 |
| First fusion | C(264, 2) | 34,716 |
| Second fusion | C(34,716 + 1, 2) | 602,617,686 |
| Total | Sum of the above | **602,652,666** |

First-fusion inputs cannot have the exact same base variant because each variant occurs once in a lineage. They can have the same species, including two dragons with different color, horn or glitter traits. The dragon illustrations are appearance examples, not proof that every pair of depicted cards is eligible.

Second-fusion recipes allow repetition: the same first-fusion recipe can occur in two different original lineages. Pair order is irrelevant, but the pairing tree matters: (A+B)+(C+D) is a different recipe from (A+C)+(B+D).

These are theoretical recipe possibilities across all possible lineage permutations. One already minted, complete lineage offers only **263 adjacent candidate pairs**, and those overlap. At most **132 first-level fusions** can actually be made from its 264 cards. Two complete lineages offer 263² = **69,169 candidate four-source pairings**, before consuming inputs; at most 132 final four-card fusions can consume all cards across those two lineages. Do not advertise the theoretical counts as combinations simultaneously available to one owner.

Including the approved finish rolls but still no serum doses, there are **104,148** first-fusion recipes and **16,270,365,078** second-fusion recipes (three new finishes for each unordered pair of first-fusion recipes, retaining their finishes). Together with 264 untouched base variants, that is **16,270,469,490** recipes. These remain theoretical possibilities across lineages.

### With up to 11 ordered doses per new card

Include all 1,331 serum/Presence combinations, ordered local histories, both fusion parents' histories and the settled inherited Presence at each fusion. A later dose replaces visible Presence but does not erase the earlier inheritance result from history. Matching parent Presences count as one outcome; differing Presences count as two possible outcomes.

The following calculation uses the confirmed neutral-parent rule (Presence 0 participates in the 50/50 inheritance) and assumes that every serum/Presence combination has nonzero probability. It counts recipes, not their probability; making Holy rare does not change the number of possible recipes.

```
H = sum(1331^k, k = 0..11)
  = 23,242,616,942,008,024,538,100,265,366,080,792
h = (H - 1) / 11
C = choose(264, 2) = 34,716

A = 1 + 3 × (H - 1)
n[0] = 1; n[p] = 3 × h for p = 1..11
l[0] = 0; l[p] = h for p = 1..11
K = 2 × A² - sum(n[p]², p = 0..11)

B = 264 × A
F1 = 3 × C × K × H
f[p] = 3 × C × (2 × A × n[p] - n[p]² + K × l[p])
sum(f[p]) = F1

cross = (F1² - sum(f[p]², p = 0..11)) / 2
F2 = 3 × (choose(F1 + 1, 2) + cross) × H
Total = B + F1 + F2
```

Here `A` counts base histories including the first-dose finish: an empty history is unassigned, each nonempty history has three possible finishes. `n[p]` groups these by current Presence. `K` counts both source histories and distinct inherited-Presence outcomes for a fixed pair of base variants. `f[p]` counts completed first-fusion recipes whose current Presence is p: the first term covers no new local dose; the last term covers nonempty local histories. At level two, every unordered parent pair has one outcome, and each pair with different current Presences has one additional outcome. Multiplying by H adds the resulting card's local doses; the factor 3 adds the fresh finish at each fusion. Parent finish assignments remain part of retained history.

| Recipe class | Approximate possibilities |
| --- | ---: |
| Base with serum history | 1.840815 × 10^37 |
| First fusion with all histories and inheritance | 2.246855 × 10^109 |
| Second fusion with all histories and inheritance | 3.360107 × 10^253 |
| Total | Approximately **3.360107 × 10^253** |

This is a finite combinatorial recipe space, not a count of guaranteed visually distinct collectibles or obtainable supply. It excludes token/lineage IDs, VRF seed values, exact random samples when they produce the same Presence, unused-serum inventories, free-text portal transformations and future catalogue versions. Recalculate if the neutral-parent policy or retained-history definition changes.

## Approved card finishes (20 November)

- Finish IDs: 0 unassigned, 1 Normal (70%), 2 Golden (25%), 3 Black (5%). An untouched base card remains unassigned. Its first serum application rolls once; later doses, ownership transfers and grading preserve that finish. Every newly fused card rolls afresh regardless of either parent’s finish or Presence.
- First serum application and every fusion require player-funded native-ETH Chainlink VRF, quoted before signing alongside the unchanged 0.10 USDC generation fee. Later serum applications need no finish VRF. First-serum admission reserves the card and fee before requesting entropy; failure reverts admission atomically.
- Finish and Presence use separate domain-separated unbiased draws. Finish is unrelated to serum rarity, source sequence or Presence. A Black card can be Holy. No grade bonuses apply.
- Settled finish is included in the request binding before AI generation. Generation retries, duplicate callbacks and same-proof recovery cannot reroll it. `EvolutionRandomnessSettled` exposes the pending result; `FinishAssigned` assigns it to the completed card. The global indexer handles both with its existing canonical, rollback-managed projections.
- Artwork policy version 3 integrates the finish into the actual image: Normal pearlescent frame with purple lettering/colored logo; Golden polished gold with embossed lettering and gold mascot at **standard border width**; Black dark illustration/frame with legible gunmetal lettering and black chrome mascot, retaining creature highlights. No decorative geometric overlay, thicker Golden border or swirl feature. Grading preserves these materials, text and mascot treatment.
- Approved, optimized concept references live in `apps/yunipals-home-web/public/images/evolution/finishes/`. They illustrate the same Holy dragon; the frontend labels them as concepts, not live NFTs. Metadata exposes Finish separately from Presence and serum rarity.
- This updates the evolution ABI and rendering-policy hash. Deploy compatible contracts, API, global event sources, worker and frontend together before enabling requests. Existing in-flight requests from older unreleased rehearsals must be drained using their matching worker/policy; do not upgrade them blindly or reinterpret unassigned legacy jobs as finished rolls.


### Review fixes: collection reads, publication, and selective holo

- Wallet pages skip only known unsupported packs, unavailable base artwork and missing imported card facts. Cursors advance over scanned token IDs, including skipped cards. RPC failures and unknown contract errors still fail the page rather than silently hiding eligible cards.
- Evolution images, metadata and mask PNGs have a separate public read path. `EVOLUTION_ENABLED=false` disables intake/configuration routes without hiding already-published assets. Asset reads use the global indexer's retained twelve-block confirmation boundary and canonical publication events; they do not require fresh RPC calls, a running observer, or healthy unrelated feature sources. Database/storage access and the registered evolution publication source remain required. Reorg evidence, missing branch witnesses and release-identity mismatches still fail closed. Keep the publication source/history available when stopping intake.
- Rendering policy v3 calibrates the exact generated image using the existing portal AI configuration. Bounded numeric geometry produces four immutable PNG masks: outer card cutout, creature silhouette, illustrated background and reflective creature details. Background foil excludes the frame and creature; highlights follow existing gems/metal/glitter. Masks are served under `/v1/evolution/layers/<artwork-hash>/<mask-hash>.png` only when referenced by canonically published metadata. Route both the asset and layer paths on the public asset origin.
- Artwork and mask checkpoints survive retries independently. A mask failure cannot regenerate the paid artwork or reroll its finish. Deploy/configure the newly computed rendering-policy hash before enabling new requests; drain older policy jobs with their matching worker. Generation now includes one additional vision calibration call using the portal grading model. Provider fixtures cover the pipeline; visually review live calibration on representative new artwork before production activation.
- Adventure detail and enlarged views use the shared tilt/cutout viewer; thumbnails retain the outer cutout. Portal metadata preserves the mask references for evolved cards before grading. Completed graded cards retain the existing slab presentation.

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

Use three focused feature contracts, with shared interfaces and compatible upgrades to the existing NFT collection and grading contracts.

1. **SerumCatalogue**: versioned 121-entry base catalogue plus eleven Presence definitions, catalogue hash, trait IDs, rarity pools, Presence distribution and sequence odds. Freeze versions once used; changes apply to future requests only.
2. **YunipalAdventures**: owner validation against the existing collection, per-card cooldown, pending request, effective sequence, unused serum, native VRF payment and settlement.
3. **YunipalEvolution**: 0.1 USDC escrow, serum-application and fusion jobs, card reservations, input snapshots, first-serum and every-fusion VRF requests, settled finish and Presence, completion/failure state, artwork versions and deterministic history hashes.

Upgrade **YunipalMonsters** to allocate and mint fusion IDs in its existing ERC-721 namespace. Store immutable parents, flattened source-card references (maximum four), original-lineage references, sequence sum/count and inherited history commitment in separately reviewed fusion storage. No third level and no separate ERC-721 collection.

### Same collection compatibility

- Share the existing monotonic nextTokenId allocator with base mints and reserved originals. Interleaved fusion mints must never collide with reserved IDs or change a family's next sequence.
- Add an explicit card kind/fusion level and a typed fusion-provenance getter. Preserve the existing base Provenance and CardFacts storage layout and meaning; do not insert a fabricated variantId or a fabricated originalTokenId for fusions.
- Emit FusionMinted with ancestry and generation references. Keep MonsterMinted and CardFactsRecorded semantics for actual base cards. Emit normal ERC-721 Transfer events for all cards.
- Restrict mint/burn-for-fusion methods to the configured evolution controller and an authorized pending job. Owners and approved marketplaces must not be able to mint arbitrary fusion cards.
- Use the ordinary original-burn notification only when a real base original burns. A fusion containing an original does not acquire offspring claim rights and must not trigger original-burn logic again.
- Update ownership, collection listings, token metadata, grading and marketplace-facing metadata consumers to branch on card kind before reading legacy base-only fields. Existing legacy getters returning zeroed mappings for a fusion must not be interpreted as a valid base variant.
- The 264-variant completion view and offspring credit accounting continue counting actual base mints. Fusions appear in the same collection with their own ancestry, fusion level and serum attributes.

Bind dependencies through deployment-neutral configuration and validate both sides of each authorization relationship. Existing UUPS storage layouts must remain compatible; use reviewed namespaces or reviewed gap consumption, not blind baseline replacement.

### Adventure lifecycle

- `adventure(card, expectedRulesHash, maxVrfPrice, deadline)` checks live ownership in YunipalMonsters, no completed grade through the canonical `hasCompletedGrade` check, card kind, initialized base facts or validated fusion ancestry, cooldown and absence of conflicting pending work. A card with a pending adventure cannot start grading.
- Set cooldown and request snapshot atomically with payment and VRF request; a transaction revert restores everything.
- Only one outstanding adventure per card. A transfer may carry the pending adventure and cooldown; the result belongs to the card's current owner.
- While randomness is pending, disallow consumption, fusion, burning and artwork mutations of that card. Freeze all result-relevant inputs.
- Callback authenticates the configured wrapper, saves the seed and performs only bounded, failure-isolated processing. A permissionless settle function can complete from the same seed.
- Settlement updates the unused-serum slot only on a successful find; None keeps it unchanged. Replaying callbacks or settle calls has no effect.
- Retain the existing same-proof recovery model. Do not offer a fresh VRF request to replace a missing/unfavorable result. Track requests by chain, consumer, wrapper and request ID.
- No AI request is made during an adventure, because the unchanged card does not yet drink the serum.

This follows Chainlink's [direct-funding model](https://docs.chain.link/vrf/v2-5/overview/direct-funding) and [security guidance](https://docs.chain.link/vrf/v2-5/security): bind inputs before requesting, authenticate fulfillment, avoid rerolls and keep callback work safe.

### Drinking a serum

- `consumeSerum(card, expectedSerumId, expectedPresenceId, expectedCatalogueVersion, expectedArtVersion, expectedHistoryHash, maxVrfPrice, deadline)` requires current ownership, no completed grade, an unused serum matching the full expected tuple, fewer than 11 local doses and no conflicting job. Recheck graded status at finalization as well as admission.
- Collect exactly 100,000 units of six-decimal USDC using SafeERC20 and verify the deposited amount. Reserve the serum and card against replacement, transfer, burn or another mutation.
- Emit a request with immutable input artwork/hash, recipe version, serum ID, Presence ID, catalogue version, lineage/history and payer. Bind the current-Presence transition policy to the request.
- After the AI worker publishes validated assets, an authorized completion binds their image/metadata hashes to the request and prior art version.
- Atomically append the dose, increment local count and art version, clear the unused slot, release locks and pay the fee recipient. Emit MetadataUpdate.
- Retry provider/publication failures without another payment or increment. Preserve the reserved serum, input snapshot and pending job until successful completion; no automatic timeout refund or cancellation.
- Persist work checkpoints and retain validated generated outputs across restarts. Escalate old or repeatedly failing jobs for operator-assisted recovery. A worker crash, provider timeout or changed service capacity must not erase the obligation or cause a second fee.

### Fusion

- `requestFusion(cardA, cardB, expectedVersions, expectedPolicyHash, maxVrfPrice, deadline)` requires exact ownership of both in YunipalMonsters, no completed grade on either input, compatible card kinds/levels, distinct IDs and no pending adventures, generation or grading jobs. Recheck both inputs' graded status before finalization. The caller supplies the quoted native-ETH VRF payment for every fusion; enforce `maxVrfPrice` and deadline. One request rolls its new finish and settles Presence. Use the existing pull-credit pattern for any excess native payment; retries do not charge for new entropy.
- Level one: both are base cards in the supported 264-variant pack, same originalTokenId, initialized cardFacts and absolute sequence difference exactly one. No wrap between 263 and 0.
- Level two: both are level-one fusion cards, their original lineages differ, and all four leaf card IDs are distinct.
- Snapshot both current artworks, current Presences, catalogue/policy versions and history hashes, reserve inputs and collect one 0.1 USDC fee before requesting any fusion entropy. Canonicalize parent order for the recipe; swapping transaction inputs cannot bias inheritance.
- Even when current Presences match, request one Chainlink VRF result for the new finish and Presence using fresh entropy bound to this fusion request; never reuse a known adventure seed or use a block timestamp/hash or AI choice. Apply an unbiased 50/50 parent selection.
- Authenticate the configured callback, store its entropy and settle the inherited Presence once. Use bounded callback processing and same-proof permissionless recovery. Snapshot the two parents before requesting, and prevent transfers, burns, drinking, grading, adventures and competing fusions while locked. A failed VRF request reverts admission and fee collection atomically. There is no cancellation or reroll after learning the result.
- Lifecycle: reserved → awaiting randomness → finish and Presence settled → generation → publication → completed. The worker starts only after the inheritance result is canonically confirmed. An AI retry uses the same Presence and fee; neither retry nor delayed settlement changes the selected parent. Persistent randomness failure also requires operator-assisted recovery without fresh entropy.
- On successful completion, burn both inputs through narrowly authorized controller methods, then mint the one result in the same collection to the requester atomically. A failure rolls back the whole finalization and leaves the job retryable.
- The base burn path must still call onOriginalBurned for an original. Do not preserve claim rights contrary to the confirmed burn policy.
- Reject fusion of an original with an already outstanding booster claim. While it is reserved for fusion, prevent new offspring claims; elapsed claim time can continue accruing until the original burns on success.
- Input NFTs remain present and visibly pending until success under the confirmed reservation policy. Failed AI work is retried, with operator recovery for stuck jobs; it does not automatically release or refund the request.
- Record inherited cooldown and effective sequence without using the new fusion token ID as a sequence.
- Preserve source provenance after burn. Do not overwrite the 264-card base trait mapping or fabricate a single original ID for a two-lineage result.
- Previously minted offspring remain eligible to adventure and fuse after their original burns; lineage identity does not require that original to remain alive.
- Store at most 11 local serum/Presence/version tuples per card plus the two immutable parent references and history hashes. A level-two card has a bounded seven-node ancestry tree. Preserve the settled inherited Presence and its source parent in the fusion history even after a later dose replaces its current visible Presence. Matching parent Presences are one recipe outcome, not two distinct outcomes merely because either parent could be named.
- Mint/receiver behavior must not let arbitrary receiver code corrupt completion or permanently trap a reserved job; rehearse contract-wallet recipients.

### Shared mutation and metadata integration

Introduce a common busy/art-version interface for serum, fusion and portal operations. Check it at both admission and finalization. YunipalMonsters transfer/burn hooks enforce relevant locks for both base and fused cards. A portal job accepted under old rules must complete or be explicitly migrated before enabling competing mutations on that card.

Use a single canonical resolver for latest finalized artwork. Existing portal records remain preserved and readable; new portal requests must use the latest serum/fusion art as input. Successful grading prevents subsequent serum/fusion mutations and further grading admissions. Preserve historical records without introducing regrading. Both fusion levels must be gradeable at feature launch; gate handling is required scope.

Events should include sufficient immutable data to rebuild state: AdventureRequested/Resolved, SerumReserved/Consumed, EvolutionRequested/Completed, FusionRequested/RandomnessRequested/PresenceResolved/Completed, policy versions, parent/source references, fees and asset/history hashes. Include VRF request binding and whether a Presence result was deterministic. Record worker retries separately from onchain lifecycle; no timeout-cancellation event is required under the chosen policy. Emit ERC-4906 updates from YunipalMonsters.

### Grading compatibility work

- Extend PortalGrading.matches to dispatch by base/fusion kind. Inspect at most four immutable base-source records, evaluating all applicable gates against the same record. Burned source NFTs need not still be live; the fused token itself must be live and owned by the submitting wallet.
- For original-only portals, require that this same qualifying source record has isOriginal=true. Preserve the existing branch where original-only replaces the sequence-window check. Do not infer original status from a sequence average of zero, or borrow original status from a different ancestor.
- Expose a canonical hasCompletedGrade check that covers both legacy and new successful grading requests. Grading history, not the current art revision or a visible slab, establishes this status: serum applications also change art revisions and must not accidentally mark a card graded.
- Preserve the graded restriction through transfers, attempted repeat grading, metadata updates and grading-contract upgrades. Existing completed grading history must be recognized at activation; do not trust a frontend flag or start every token as ungraded. Enforce one-completed-grade admission consistently using grading history rather than the evolved card's art revision.
- Record the matching source used for gate qualification in the admitted context. Resolve multiple matches deterministically, such as the lowest eligible source token ID. Its traits are a qualification witness, not the fusion's entire identity.
- Extend inputArtwork to use the canonical current-art registry for ungraded fusions and serum-mutated cards. Neither a missing base variant artwork nor an old portal result should be a fallback for a card with finalized evolved art.
- Separate monotonic current-art revision from number of grading attempts. Do not use grading history length to index serum revisions. Bind admission, spell commitments, worker jobs, results and publication checks to the actual current image hash and revision.
- Extend PortalAIContext beyond its current single baseColor: include card kind, source species/colors, qualifying source, fusion level, local/inherited serum history and current image reference. Update per-portal color-preservation checks for mixed ancestry under a versioned policy; never guess immutable eligibility traits from pixels.
- Grade the new portal attempt against its input artwork and the player spell. Shared serum recipes, inherited details and automatic fusion effects are not evidence that a player copied another player's spell, and do not automatically earn Creativity points.
- Preserve defining serum/fusion features in generation and grading checks while applying the portal effect and player spell. For up to 77 inherited doses, supply a deterministic bounded summary with the authoritative history hash rather than letting player text redefine lineage.
- Slabs and metadata bind scores to the exact graded output image. Preserve existing historical slabs without enabling new repeat grades. Fusion parents must be ungraded, so there are no parent scores to inherit or average.
- Keep already admitted competition entries and their submitter entitlements unchanged when a card transfers or burns through an otherwise permitted path. A graded card cannot be burned through fusion; do not duplicate payouts, create repeat-grading entries or move an entry to another token.
- Drain or migrate pending jobs before activating incompatible grading context/rubric changes. Respect existing competition rubric boundaries; do not mix an incompatible new rubric into a batch already bound to another one.

## Global indexer and AI worker

Extend the existing global Ponder indexer. Do not add a separate chain-log poller or dedicated ingestion service.

- Add feature source definitions, shared ABIs, source policies, deployment blocks and full receipt coverage where needed. Include new fusion transfers in canonical ownership.
- Project adventures, unused serum tuples, current Presence, ordered local dose histories, immutable ancestry, fusion randomness/Presence settlements, jobs, locks, fees, cooldowns, completed-grade status and current art versions into rollback-managed tables with historical versions for confirmed reads. Reconstruct completed-grade status from canonical successful grading events, including historical events; an orphaned grading completion must not permanently lock the indexed card. Orphaned fusion settlements must never start or finalize a job with the wrong Presence.
- Use the shared reader API with explicit source readiness. A missing or behind source is not an empty inventory.
- An offchain generation consumer reads confirmed canonical requests with a durable cursor. It never performs AI work inside Ponder handlers.
- Job identity binds chain, contract, request incarnation, input versions and recipe hash. Deduplicate replay and release handovers, preserve paid outputs across restarts, and reject outputs from orphaned/replaced requests.
- Revalidate canonical request state before paying for AI and before sending completion. Deep reorgs can still incur an unrecoverable provider cost; they must never produce a live orphan NFT.
- Reuse the existing provider boundary, asset validation, content-addressed storage, resumable stages and publication verification. Keep API credentials and signing keys outside indexer source configuration.
- Use approved parent artwork as input; for fusion provide both parents. Preserve the species and established visual grammar, expressive Presence, transformed environment and complete Avatar anatomy. Repeated serum doses affect physical intensity through the versioned recipe; do not generate a new random rarity or Presence. The latest consumed serum sets current Presence; keep full ordered dose tuples and fusion inheritance results in history. Generate from the explicit settled current Presence instead of blending conflicting expressions visible in parent art.
- Generate on demand, retain immutable source images/metadata and historical outputs, and compose card text/frame deterministically where practical. Never attempt to pre-render the recipe space.
- The 0.1 USDC charge is the user price, not a proven estimate of provider cost. Benchmark representative single and dual-reference jobs, retries, storage and completion gas before launch. Any subsidy belongs in the operating budget; do not silently change the agreed fee.
- Keep a pending job's last finalized artwork visible. Publish the new image only when its onchain completion and indexed canonical evidence agree.

Suggested API resources: catalogue and odds; owner card state; per-card adventure status; compatible fusion partners; consume/fusion quotes; job progress; versioned metadata and ancestry. Quotes include expected ownership, artwork/history, serum/policy, completed-grade status, fee and deadline, but contracts independently recheck eligibility. Return a specific graded-card ineligibility reason before requesting approvals or payments.

## Frontend

Build the feature within the existing collection/card experience, with reusable dedicated adventure and fusion views as needed.

- Card detail: current art, local dose count /11, inherited history, unused serum, adventure tier (1–11), exact sequence range and per-outcome odds, cooldown and adventure action. Explain fused cards' source-average position. Present tier as a property of the card's sequence, without an experience/progression meter suggesting adventures can raise it.
- Adventure: clear native-ETH VRF estimate, wallet signature, awaiting randomness, found serum or no find, and saved-seed recovery where available.
- Serum reveal: illustrated bottle card, essence, form, Presence, rarity and an Apply for 0.10 USDC action. Keep the familiar serum name and show Presence as a distinct trait. Explain that finding the next serum replaces the unused bottle.
- Consumption: preview of intended effects clearly marked as a concept, spending review, generation progress and eventual before/after. Show the exact current-Presence → new-Presence change, particularly when Holy will be replaced.
- Fusion picker: only compatible owned, ungraded partners; show original lineage and exact sequence positions rather than relying on appearance. Explain why graded cards cannot be selected.
- Fusion review: two input cards, expected two/four-source result, inherited physical effects, parent Presences and 0.10 USDC. Show each differing Presence at 50%, or one guaranteed Presence when they match; no selector or reroll. Show the player-paid native-ETH VRF quote separately from USDC and transaction gas, then distinct awaiting-randomness and generation states. For an original, explicitly show that remaining daily claims end on successful fusion.
- Final card: clear fusion level, current Presence, two/four-source family tree and locally consumed versus inherited doses, with each dose's Presence retained in history.
- Pending work survives reload and wallet changes. Handle rejected signatures, insufficient USDC/ETH, expired quotes, transferred/burned cards, indexer lag, VRF delays and AI retry/recovery separately. Show when a card is reserved and why it cannot currently transfer or enter another job.
- Grading entry shows the matching ancestor and portal requirements under the selected eligibility policy. The input preview is always the fusion's latest artwork, not the ancestor's old image.
- Separate the completed grade from previous unsuccessful grading attempts. After grading, disable adventure, serum, fusion and repeat-grading actions and explain that grading ends those progression paths. Before submitting the first grade, show this consequence clearly. Keep ancestry, inherited serum effects and any original daily claims visible.
- Use actual collection art and the approved Voidheart/Eclipse/Singularity examples as clearly labeled previews. No invented balances, active rewards or guaranteed generated output.
- Preserve accessibility, reduced-motion preferences, responsive layouts and lazy-loaded optimized artwork.

## Delivery sequence and verification

1. Review the revised eleven-tier adventure drop table requested after the endpoint-balance review. Preserve the approved Presence distribution, latest-dose replacement, random parent inheritance including neutral, player-paid fusion VRF, VRF-settlement timing, inherited cooldown, unused-serum discard, reserved-input completion and unchanged grading economics/scoring. Rebase onto current main, preserve the one-completed-grade admission rule, curate the approved image references, and retain the verified variant calculations. Retain the confirmed physical inheritance, stacking order, daily timing, burn, same-collection and grading eligibility rules in the specification and fixtures on this branch.
2. Implement shared recipe definitions, exact combinatorial calculations and contract state machines. Test ownership, sequence checks, level boundaries, 11-dose cap, repeated doses and ancestry.
3. Implement same-collection fusion minting, grading eligibility and metadata/version coordination with compatible upgrades. Rehearse interleaved base/fusion token allocations, pending booster claims, original burns, portal jobs, transfer locks and rollback.
4. Extend global ingestion, ownership, confirmed projections and durable job intake. Test duplicate/out-of-order events, replay, reorgs, stale sources and release handover without duplicate paid generation.
5. Add generation/publication worker and API. Test retries, immutable input hashes, stale completions, persistent reservations, operator-assisted recovery, canonical publishing and USDC liability accounting.
6. Build frontend with deterministic mock fixtures, then local end-to-end contract/indexer/API/worker/browser flows using a stub AI provider. Complete Base Sepolia VRF and a bounded real-image quality/cost rehearsal when implementation is ready.
7. Run relevant contract suites, storage compatibility checks, indexer/Postgres integration tests, frontend/type checks and production builds. Require invariant/fuzz coverage for financial state, burns, locks and request replay. Cover mixed species/colors/horns/glitter, joint versus invalid split-source gate matches, original-only inherited eligibility, burned ancestors, serum → fusion → grade flows at both fusion levels, rejected grade → adventure, grade → serum and grade → fusion attempts, legacy graded tokens, mutually exclusive pending adventure/grading requests, transfer/regrading lock bypasses, independent offspring rights, historical slabs and unchanged competition payout entitlements.
8. Prepare a PR with the confirmed rules, architectural changes, user flow screenshots, validation evidence and deployment-neutral migration/rollback instructions. Production release uses the private operator workflow and is a separate step.

Primary invariants: no unauthorized actions; each source card consumed at most once; each successful job charged once; no third fusion level; no dose increment on retry; cooldown never reset by transfer/fusion; no fresh randomness for recovery; no parent changes after a fusion VRF request; settled Presence never rerolls on retry or input-order changes; equal parent Presences remain guaranteed while the fusion still rolls its finish; only successful consumption updates current Presence to the latest dose; no new artwork overwrites a newer version; USDC escrow and native-ETH refund liabilities stay covered; original claim forfeiture happens exactly on original burn; fusion IDs never alter base variant/sequence accounting; every published grade identifies its exact assessed artwork; completed grading permanently prevents adventures, serum consumption and fusion; one actual ancestor satisfies all applicable portal requirements together.

Before public launch, resolve the product's existing legal question about paid randomized adventures and rarity-weighted tradable transformations. The guaranteed base collection alone is not being treated as approval for these new mechanics.

## Implementation checkpoint

The contracts, global indexer integration, artwork consumer, API and frontend are implemented on the feature branch. Both API and frontend actions are disabled by default. This checkpoint is a review candidate, not a production deployment.

- Added the immutable launch serum catalogue, direct-funded adventures, reserved serum/fusion requests, same-collection fusion ancestry and shared mutation reservations.
- Added source-based portal matching and canonical completed-grade checks, retaining grading history separately from artwork revisions.
- Added global Ponder event sources and rollback-managed projections. Reads require confirmed coverage for all three evolution sources, collection ownership and grading. Collection pages carry a release and block hash so subsequent pages retain the same snapshot.
- Added durable generation with fenced leases, bounded retries, immutable image/metadata checkpoints, saved-VRF settlement recovery and the existing transaction journal. A canonical request binding is checked before paid generation and submission. Saved outputs survive worker restarts and alternative reorg bindings do not overwrite them.
- Added `/v1/evolution` configuration, card, owner, fusion collection, quote, job, adventure and confirmed asset endpoints. Quotes validate current ownership and eligibility; the wallet validates their calldata and simulates after exact USDC approval.
- Added illustrated adventure and card pages, compatible fusion selection, fee/burn reviews, pending transaction recovery, ancestry and ordered dose history, collection and owner fusion galleries, and evolved card selection in portals. The eleven approved Presence images are optimized and labeled as concept previews.
- Portal generation and grading receive real source ancestry and serum history, preserve the current features and Presence, and give no automatic rarity/fusion bonuses. Metadata distinguishes a completed grade from serum artwork revisions.
- The user approved reusing the existing portal AI configuration for serum and fusion generation. No separate key was created or copied, and no live AI request or production deployment was made.

Verification completed locally:

- 198 Foundry tests pass, including randomized dose/escrow/replay coverage; nine opt-in fork tests were skipped. Existing booster and portal storage prefixes/gap boundaries remain compatible. Release size and generated ABI checks pass. BoosterPacks has only 42 bytes of EIP-170 headroom, so every runtime change must repeat the size check.
- The evolution catalogue/projection/worker suite and all 144 existing portal unit/recovery tests pass. Both application TypeScript checks, the portal picker tests and the frontend production build pass; the build still reports large chunks.
- PostgreSQL tests exercise actual Ponder tables and rollback triggers through evolution projection rollback/replay, plus global readiness, receipt concurrency and lease fencing. The enabled-source registration rehearsal covers all 19 configured sources. A serialization retry is limited to rolled-back receipt-claim transactions, before external effects.
- The local browser rehearsal uses real deployed contracts, wallet transactions, API routes and the generation worker. It covers adventure settlement, a serum, approval/consumption, saved-output recovery, fusion Presence settlement, atomic parent burn/result mint, inherited history/cooldown and collection reads at desktop/mobile sizes. This rehearsal feeds confirmed event fixtures through the same reducer into PGlite; it does not replace the separate PostgreSQL/Ponder checks. Deterministic fixture artwork verifies the flow without asserting live image quality or provider cost.
- CI runs evolution contract/ABI, worker, enabled-indexer and browser checks alongside the existing portal checks, and saves browser screenshots as artifacts.

Still required before launch: a deployment-specific fork and live VRF rehearsal, a bounded live AI quality/cost review (including mixed ancestry, Holy/dark combinations and maximum-dose grading), and load/recovery checks against the operator's selected infrastructure. Persisted images are reused, but a crash after a provider charges and before its output is checkpointed can repeat provider work; the player is not charged a second generation fee. Complete the existing product/legal review before exposing paid randomized mechanics.

## Deployment-neutral preparation and recovery

Use the private operator repository for deployments and evidence. Keep addresses, hostnames, credential locations and deployment receipts outside this repository.

1. Reuse the portal service's AI, asset, database, RPC and signer configuration. `evolution:policy` prints the rendering policy and hash without using a key. The worker reads the existing `OPENAI_API_KEY` and `PORTALS_MODEL_POLICIES_JSON`; it does not provision credentials. Run `evolution:migrate` with the existing database migration role and `PORTALS_WORKER_DATABASE_ROLE` to install the private job table and existing transaction journal. Keep worker writes separate from the global read-only indexer connection.
2. Prepare the catalogue and adventure/evolution proxies with `contracts/boosters/script/DeployEvolution.s.sol`. Its default Forge invocation simulates; it does not bind the collection. Compile and check the engine, collection and grading upgrades together. `evolution:prepare` emits unsigned administrator calls using environment-supplied deployment addresses and implementation addresses, grants the existing portal signer `GENERATOR_ROLE`, and puts `configureEvolution` last. Rehearse these calls against the intended chain state before any broadcast.
3. Register all three evolution sources and start blocks through `UNIFIED_EVOLUTION_JSON` in the existing global indexer release. Retain the collection ownership and portal grading sources. Require complete confirmed coverage and the correct release identity before consumption; there is no separate evolution event poller.
4. Configure `EVOLUTION_ENABLED=true`, `PORTALS_INDEXER_MODE=unified`, the existing `PORTALS_INDEXER_DATABASE_URL` and `PORTALS_INDEXER_RELEASE_ID`, and the portal service's existing asset configuration. The evolution endpoints serve assets from the same storage under `/v1/evolution/assets`; configure that route on the asset origin as well. Continue to serve published assets when pausing new requests.
5. After policy, bindings and `GENERATOR_ROLE` checks pass, start `evolution:worker` with `EVOLUTION_WORKER_ENABLED=true`, the existing portal signer configuration and `PORTALS_MAX_EXECUTION_FEE_WEI`. `--once` performs one pass. `--prepare` can generate and persist paid artwork without signing a completion; it is not a free dry run. Monitor outstanding reservations, retry age, provider spend and signer funds. Recover failed jobs by repairing the dependency and retrying their saved request, never by charging or rerolling it.
6. Enable the frontend using `VITE_EVOLUTION_ENABLED`, `VITE_EVOLUTION_ADDRESS` and `VITE_ADVENTURES_ADDRESS`, together with the existing collection/portal network and API configuration, after end-to-end verification. Owners must see both the USDC generation fee and any ETH randomness quote before submitting.

To stop intake, pause adventure randomness requests and evolution requests on their respective contracts (`pauseRandomness(true)` and `pauseRequests(true)`), and disable frontend actions as appropriate. Keep callbacks, recovery, generation completions and published assets available so already-reserved cards can finish. Restore the worker database and immutable assets together. Do not downgrade a collection or grading implementation to code that does not understand already-minted fusions or evolved artwork; prepare a compatible forward fix through the private release workflow.
