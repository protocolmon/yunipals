# Yunipals portals and spell grading implementation plan

Product decisions updated 11 November 2026. The portal implementation, including fee accumulation and burn-to-claim, is validated locally and in an isolated Base Sepolia rehearsal using real Chainlink VRF and OpenAI. The 111-entry competition in section 10 and sequential winner-derived themes in section 11 are implemented. A historical eleven-entry live-AI Sepolia challenge verified real images, grades and exact public payouts; the new sequential transition is verified locally with a separate real theme-extraction sample. The default settlement flow is permissionless: a winner or any other caller pays gas to resolve a ready batch through the app. Chainlink CRE and server settlement automation are optional. Production activation remains release work. See [validation and release status](portals-implementation-status.md). Target chain: Base, alongside the Yunipals TCG collection. Model choices and the initial originality-penalty cap remain subject to production calibration before launch.

The [detailed burn-to-claim implementation plan](portals-burn-to-claim-plan.md) specifies the contract accounting, stable VRF snapshots, API/indexing, frontend owner claims, deployment changes and acceptance tests. Its implementation defaults resolve the retirement and final-portal cases below.

Create an upgradeable ERC-721 portal collection and a global registry that opens one portal at a time. During its 11-minute window, card owners can submit an eligible TCG card and a spell, pay the portal kind's fee, and receive an AI-edited artwork version with four onchain grades. Every spell starts from the card's latest completed artwork. The same card NFT keeps its identity and grading history through edits and ownership changes.

Each portal NFT accumulates the portal component of payments made through it. Its current owner can claim that accumulated USDC only by permanently burning the portal NFT. The balance follows the NFT through transfers and sales. Each redemption reduces the live portal supply; admin minting remains possible within the original lifetime caps.

The [illustrated system overview](artwork/portal-system-overview-v3.png) shows fee accumulation, owner redemption, the grading flow and model roles. It uses the actual Rainbow Portal and Blue Yunidragon TCG images as generation references. The edited monster card is illustrative and does not represent a completed grading result. Its prompt and sources are retained beside the image. Earlier diagrams showing a direct portal-wallet payout are superseded.

**1. Portal collection and admin minting**

Use the existing TCG's UUPS proxy and role-based administration pattern for the new contracts. Admin can create portal kinds and mint additional NFTs of an existing kind at any time, within its lifetime cap. Keep upgrade storage compatible and avoid adding ordinary storage to the shared stateless BoosterAdmin base.

Reserve 1,000 token IDs per kind. Kind IDs start at 1, and serial numbers within each kind start at 1:

`tokenId = (kindId - 1) * 1000 + serial`

Rainbow Portal is kind 1 and owns IDs 1 through 1,000. Kind 2 owns 1,001 through 2,000. A kind may have a lower configured cap, but never more than 1,000 lifetime allocations. Pending reservations count against the cap; IDs are never reused. The initial airdrop quantity and recipient list are launch inputs, not a commitment to the earlier example of 100 NFTs.

The initial airdrop grants one new Rainbow Portal TCG card for every live OG Rainbow Portal or Ghost Portal NFT held across the OG collections on Ethereum, BNB Chain, Polygon and Base. Count each chain's holding separately, including matching token IDs on different chains. Resolve staked portals to their verified current beneficiaries rather than the custody contract. Finalize and revalidate the recipient snapshot before execution; unknown metadata does not establish eligibility. Recipient evidence, quantities and ordered mint batches belong in private operator records.

Admin minting commits the kind, ordered recipients, allocated token IDs and gate rules before requesting VRF. Derive each token's gates from the returned seed with separate labels for the request, token and field. Keep the callback small and complete minting in bounded, retryable transactions using that same seed. A failed recipient must not block unrelated recipients permanently or permit reassignment of favorable gates.

Maintain historical indexes of fully minted, revealed tokens globally and per kind, alongside authoritative live eligibility and live counts. A reserved ID, unrevealed token or burned portal is not eligible for a new selection request. Burning must not reuse a token ID, restore its kind's lifetime mint allowance or erase its gate, payment and activation history. Preserve committed VRF candidate mappings when eligibility changes; simply removing array entries would invalidate existing selection snapshots.

Freeze each kind's artwork commitment and gate distribution when its first mint request is committed. Payment settings have a separate, admin-updateable policy. Individual portal gates remain fixed through normal contract operations; rotation never redraws them.

**2. Onchain card traits and sequence**

The existing [YunipalMonsters contract](../contracts/boosters/src/YunipalMonsters.sol) stores type, color, horn and glitter in provenance. Add each card's sequence within its original's family and its actual mint timestamp using compatible additional storage. Preserve the existing provenance structure and interface.

An original has sequence 0, its first offspring has sequence 1, and its final offspring has sequence 263. A batch receives consecutive sequence values. In the [minting engine](../contracts/boosters/src/BoosterPacks.sol), assign `mintedBeforeBatch + indexWithinBatch`; the cumulative minted count currently updates after the mint loop. Transfers and burns never renumber a family.

Keep sequence distinct from both the randomly drawn artwork variant ID and Birth day. Birth day remains elapsed whole days between the card's actual mint and its original's actual mint. Store mint timestamps so the existing Born and Birth day traits can also be derived onchain.

Backfill existing cards directly from verified canonical mint events and block timestamps. Historical sequence can be reconstructed from completed request counts and the ordered mint events: `completedMinted - quantity + indexWithinBatch`. Verify parent relationships and counts before importing. Make imports write-once and disable the migration mechanism when complete. No separate migration manifest is required. Unknown sequence data must never silently become sequence 0.

Eligibility always uses these underlying onchain traits and sequence. Grading and artwork edits do not rewrite them. Bind the checker to the approved TCG collection and 264-card catalog rather than accepting arbitrary caller-supplied traits or NFT contracts.

**3. Portal gates and Rainbow probabilities**

Store every portal NFT's gates onchain and expose them through a public getter and its metadata. All applicable conditions must pass together.

| Field           | Behavior                                                            | Rainbow minting probability |
| --------------- | ------------------------------------------------------------------- | --------------------------- |
| `originalOnly`  | True requires an original card and bypasses only the sequence gate. | 10% true                    |
| `glitterGate`   | True requires glitter; false imposes no glitter restriction.        | 10% true                    |
| `diamondGate`   | True requires a Diamond horn; false imposes no horn restriction.    | 10% true                    |
| `colorGate`     | One color from 0 through 5.                                         | Uniform across all six      |
| `typeGate`      | One monster type from 0 through 10.                                 | Uniform across all eleven   |
| Sequence length | Number of consecutive positions accepted on the circular sequence.  | 100: 75%; 10: 20%; 1: 5%    |

Draw the boolean gates independently. Sequence settings are ignored when originalOnly is true; glitter, diamond, color and type still apply. When originalOnly is false, originals can pass if sequence 0 lies in the selected range.

Choose the sequence start uniformly from 0 through 263. Ranges wrap from 263 back to 0: a length-10 range starting at 260 includes 260 through 263 and 0 through 5. Store start and length as uint16. After validating the card sequence is within 0 through 263, test membership with:

`(sequence + 264 - start) % 264 < length`

Wrapping gives every position equal coverage for a fixed length. These probabilities describe gate generation when minting, not guaranteed quotas in a finite airdrop or a fixed mix of activation rounds.

The [TCG trait dictionary](../contracts/boosters/config/base-standard-v1.traits.json) uses colors 1 through 6 and types 1 through 11. Preserve the portal's requested zero-based fields by comparing the TCG value to `gate + 1`. Glitter Yes is ID 1 and Diamond horn is ID 2. Keep portal kind IDs separate from monster type gates.

**4. Global activation and Chainlink randomness**

An upgradeable PortalRegistry records activation rounds with portal ID, start time and end time. Each opened round lasts exactly 660 seconds. At most one portal accepts new entries at a time. New entries stop at the end timestamp even if no replacement is ready.

Anyone can fund and trigger a rotation request. Adapt the existing pack-opening Chainlink VRF v2.5 direct-funding integration, including native ETH fee quotes and limits, wrapper authentication, request tracking, excess-payment accounting and recovery of the original randomness. Do not copy the pack's YPAL burn, original-card rights or daily-claim economics into portal rotation.

For each rotation, snapshot the fully revealed eligible pool and exclude the previous active portal. Draw uniformly across individual NFTs, not uniformly across kinds. A different next portal requires at least two eligible NFTs. Later mints must not affect an already committed draw. Allow only one pending next-round request and prohibit cancellation or replacement with a fresh draw for the same rotation.

Burns introduce additional registry requirements: future draws exclude retired portals, a burned portal can never accept a new paid entry, and a pending draw must not silently select a different NFT because an index moved. The detailed change plan recommends immediate owner redemption, closing an active portal without advancing its scheduled end; a closed 660-second round for a committed draw selecting a subsequently burned portal; and consecutive rounds for the sole remaining live portal. Zero live portals means no new paid rotation requests. These implementation defaults preserve the committed token ID and prevent rerolling the same request; they allow an owner to sacrifice their own selected portal and forfeit its slot. See the [rotation settlement specification](portals-burn-to-claim-plan.md#rotation-settlement) and its tests.

Allow the next request to be prepared during the current round. Store a delivered result until the current window ends; it cannot open early. Anyone can then activate the committed result. If fulfillment or activation is late, admission remains closed until the next round opens, and that new round receives its own 660-second window. An expired portal never receives extra usage time. Read helpers must report that entry is closed even if the registry still stores the expired portal's ID. A service can submit the same permissionless calls promptly; transactions and VRF delivery are still required.

The initial portal is selected through VRF as well. Keep callback work bounded, persist the seed before any fallible follow-on work, and recover using the same result. An old or duplicate fulfillment must not overwrite a later activation round.

Expose utility methods to select a portal by kind or across the full collection, preserving the original external-helper requirement. Utility draws do not change the active portal or authorize entry through an inactive one.

**5. Entry and Rainbow payment policy**

The first kind is Rainbow Portal. After the one-time competition binding, its initial price for each card-and-spell submission is:

| Component                                      |  USDC |
| ---------------------------------------------- | ----: |
| AI fee for image generation and grading        | 0.245 |
| Portal fee credited to the specific portal NFT | 0.245 |
| Competition contribution reserved for prizes   | 0.500 |
| Total                                          |  0.99 |

Admin can update the AI and portal amounts independently per kind. The competition contribution is fixed at 0.50 USDC by the versioned competition contract. Requests accepted before competition activation retain the original 0.49 USDC terms and do not enter a competition. The AI component goes to the configured AI wallet. The portal component is held in a contract and credited to the exact portal NFT used, not sent to a fixed wallet or its owner. Version the payment policy and snapshot the amounts, AI recipient and portal token ID for each admitted request. Subsequent admin changes cannot reprice an accepted request or redirect an accumulated portal balance. The previously configured fixed portal payout wallet is superseded by this mechanism; retain the authorized AI payout configuration.

An entry transaction must check the expected portal and activation round, the strict start/end window, card ownership, all applicable gates, the current artwork version, and the quoted payment-policy version and maximum total fee. Perform admission and USDC collection atomically. Reject a stale round or quote without collecting the grading payment. Convert human prices using the verified payment token's decimals at configuration time.

Collect payment once and account for the AI transfer, per-portal credit and competition contribution exactly once, at successful admission. Processing retries and grading completion never charge the user or credit the portal again. Grading has no timeout, expiry or refund mechanism. This does not remove the existing VRF integration's handling of excess native ETH supplied for randomness requests.

**Portal balances and burn-to-claim**

Maintain an onchain USDC balance for each portal token ID, backed by the USDC held in the contract, and track total outstanding portal liabilities. Only successful paid admissions credit that balance. For example, 100 admissions at the initial Rainbow price accumulate 24.50 USDC for that specific portal, while 24.50 USDC goes to the AI wallet.

Transferring or selling a portal transfers the right to its entire unclaimed balance. Do not pay, reset or split the balance on transfer. The current owner must explicitly call a burn-and-claim action: verify ownership, retire and burn the portal, clear its balance and liability, and transfer its full accrued USDC to that owner in one atomic transaction. An approved marketplace operator must not independently redeem someone else's NFT. If the USDC transfer fails, the entire transaction must revert, preserving both NFT and balance. Prevent reentrancy, duplicate claims and credits to burned portals. There is no partial withdrawal or owner withdrawal while keeping the NFT, and no ordinary admin sweep of funds backing portal balances.

Redemption permanently removes that portal's future earning and activation capability. The owner's choice is to keep it available for future rounds, sell it with its accumulated balance, or burn it to withdraw. This mechanism burns the portal NFT, not the monster card submitted for grading. Already admitted grading requests retain their payment snapshots and can finish even after the portal is burned; redemption does not wait for AI completion and does not cancel those jobs.

Expose the live portal balance, live supply and retirement status through contract reads and the app. Provide an owner redemption screen showing the USDC payout and an explicit confirmation that burning permanently destroys the portal NFT. Index fee credits and burn/redemption events so balances and historical usage can be reconciled without relying on an offchain ledger.

**6. Spell processing and ownership changes**

Keep the same TCG NFT and token ID. Every new spell takes the latest completed artwork as its input. Commit that input version, its asset reference/hash, the spell reference/hash, the portal round, payment terms and grading-policy version when admitting the request. Preserve the original artwork and every completed version.

Permit unlimited regrading, with one pending grading job per card so two edits cannot overwrite each other's input version. Each new submission must independently satisfy the currently active portal's gates and pay its kind's then-current fee. There is no extra per-card cooldown after completion.

Do not lock transfers, listings, sales or burns while grading is pending. Check ownership when submitting, not again as a condition of completing the accepted request. The resulting grade and artwork follow the NFT to its current owner. Expose pending status onchain and in the app.

Admitted requests remain valid after the portal window closes. Use a durable worker queue, retries and operator recovery so failures can be worked through under the same paid request. There is no user timeout or refund path. Completion for a burned card may still be recorded in history; it must not recreate the NFT, and burning does not create a refund right.

The approved offchain service generates the edited image and performs a separate grading pass. Treat the submitted spell as input data, not instructions that can override the grading rubric. Give the service narrowly scoped grading authority. A result must bind to one accepted request, its input version and policy, and must be finalized only once. Record the actual generator and grader versions used. The onchain record attests to the authorized service's submission; it is not independent proof of subjective artistic quality.

Each portal kind can add a trusted automatic image instruction alongside the player's spell. Rainbow Portal turns the monster itself rainbow with a visible multicolor gradient while keeping its original base color recognizable as a dominant undertone or distinct areas. Rainbow scenery or a colorful border alone is insufficient. Preserve the creature's identity, anatomy and card frame/nameplates. The base color comes from immutable onchain card provenance, including when regrading a previously edited image; artwork recoloring does not rewrite that underlying trait or change gate eligibility.

Keep the player's signed spell separate from portal instructions. Include the per-kind instruction map in the versioned model policy committed by the admitted rubric; retain the matching worker policy for every accepted job. The default policy is `yunipals-spells-v4`, retaining v3's dedicated per-kind grading cases and adding sequential competition themes. Earlier v1/v2/v3 policies remain available with their original commitments and behavior. Record the resolved portal instruction, original base color and complete image prompt in the report. A portal instruction takes precedence over conflicting player requests to retain the exact old palette or remove the effect.

Give the visual grader the portal instruction as trusted context: Harmony and Craft consider both the spell and the mandatory effect. Automatic rainbow coloring earns no Creativity bonus by itself. Embeddings and originality assessment continue to use the player's spell alone, so the common portal instruction is not treated as copied player creativity. Show the portal's extra instruction alongside the spell before payment and make both readable in review views.

**Proposed AI models and responsibilities**

| Step                                                   | Proposed model or service                                             | Responsibility                                                                                                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal TCG card, once per kind                         | Codex image generation; proposed image model `gpt-image-2.6-sunburst` | Produce the shared, admin-approved finished portal card with the existing Yunipals TCG frame and nameplate before the kind's artwork commitment is frozen. |
| Card artwork, once per accepted spell                  | `gpt-image-2.6-sunburst`                                              | Edit the latest completed image using the player's spell while retaining the card's character identity.                                                    |
| Similar-spell retrieval                                | `text-embedding-3-small`, plus exact and normalized text matching     | Find relevant earlier published spells, including paraphrases, for comparison. Similarity alone never decides a penalty.                                   |
| Originality assessment                                 | `gpt-6.1-sol`, in a dedicated comparison pass                         | Evaluate the retrieved evidence and distinguish substantive copying from common phrases, independent ideas, self-reuse and meaningful new contributions.   |
| Four-category grading                                  | `gpt-6.1-sol`, in a separate visual grading pass                      | Evaluate the before image, spell and after image, and return structured grades. Apply the versioned originality policy to Creativity.                      |
| Gate checks, randomness, payment and result submission | Smart contracts, Chainlink VRF and the authorized worker              | Enforce deterministic rules, validate the returned result, and submit it; an LLM never chooses the active portal or moves funds.                           |

These proposed roles use the documented image-editing capabilities of [GPT Image 2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst), image input and structured output of [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), and text-relatedness search of [text-embedding-3-small](https://developers.openai.com/api/docs/models/text-embedding-3-small). Validate them on Yunipals examples before launch. The built-in Codex image tool controls its own model selection; the proposed application model does not identify the model that produced a planning illustration.

Version model configuration alongside the rubric, pin model snapshots where available, and record the actual model IDs and settings used. Measure image editing, both LLM passes, retrieval and expected retries together against the 0.245 USDC AI allocation. Keep the agreed 0.99 USDC customer price after competition activation; do not assume that the AI fee is an already-verified provider cost or silently change a paid job's model policy. If the measured cost exceeds the allocation, resolve quality settings or operator subsidy before launch.

**7. Grades and artwork history**

Store four integer grades from 1 through 100 for each completed attempt:

| Category   | Rubric                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creativity | Inventiveness of the transformation idea and its deliberate details, with the versioned penalty for substantiated copying of another player's spell. |
| Harmony    | How coherently the transformation fits the character and integrates with the source card.                                                            |
| Craft      | How successfully the image realizes the spell, including clarity, consistency and convincing visual changes.                                         |
| Impact     | The completed card's composition, atmosphere and memorable visual presence.                                                                          |

Evaluate the before image, spell and after image together. Prompt length and ornate language carry no automatic advantage; simple or subtle transformations can score highly. Version the detailed rubric. An optional overall display can use the equally weighted mean while retaining all four component scores.

Each portal kind has its own versioned grading case: category definitions, complete 1–100 score anchors, principles, required visual checks and explicit category ceilings for partial or missed requirements. Include this map in the accepted model-policy commitment. Rainbow checks the creature's rainbow coloring, retained immutable base color, realization of the player's central visual intention, and recognizable anatomy/card identity. Changing pose, gesture or aggression is permitted. Ordinary competent work uses the middle of the scale; 90+ requires exceptional evidence. A vague spell earns little player Creativity even when the automatic image effect is polished.

Require a reason for each category and visible evidence for each check. Apply case ceilings deterministically after the visual scores and the originality cap afterward. Retain raw scores, check-limited scores, final scores and every adjustment in the report. Verify cached assessments against the admitted case before finalization; a profile mismatch or missing case blocks provider work. Register a policy containing the new kind's dedicated case before minting or activating that kind, and retain all policies serving already admitted jobs.

Render per-kind rubrics and scored cases on the private review website. Keep previous artwork, scores and reviews available for comparison. Clearly label negative/adversarial controls and their expected behavior, distinguish live visual regrades from retained originality findings, and keep grading feedback separate from artwork feedback. The first Rainbow review has sixteen existing artworks plus unchanged-output, unfulfilled-pose and score-injection controls. This bounded sample supports review; it does not establish broad scoring calibration.

**Spell originality and copying penalties**

Copying another player's successful spell, including a translation or superficial paraphrase of its distinctive creative choices, must reduce the LLM grading result. Keep the four agreed categories: apply an explicit penalty to Creativity, which also lowers any equally weighted overall score. Harmony, Craft and Impact still judge the actual edited image.

Maintain a searchable archive of completed, published spell attempts with original submitter, accepted request order, publication time, input artwork, output artwork and grades. Search across the archive, including high-scoring examples; do not rely on a leaderboard-only corpus or ask the LLM to remember earlier spells. Freeze the comparison corpus at admission: only attempts already completed and public before this request was accepted can support a copying penalty. Other pending requests and later publications cannot create a retroactive penalty, regardless of worker completion order.

Use exact and normalized text matches plus semantic retrieval to produce a bounded candidate set. In a separate comparison pass, give the LLM the original texts and relevant visual context, require specific matching creative elements and source request IDs, and assess whether the new spell contributes a materially different idea. Treat every retrieved spell and report as untrusted data. A high similarity score, shared genre, common phrase or simple instruction such as "make it rainbow" is insufficient evidence of copying. Do not supply prior numeric grades to the visual grading pass, which should judge this attempt on its own merits.

Recommended initial penalty: when the evidence clearly establishes substantive copying with no meaningful new contribution, cap final Creativity at 20 out of 100: `min(baseCreativity, 20)`. Record the base score, applied cap, resulting score and reason. Uncertain comparisons receive no copying penalty. Genuine new interpretations are judged for their own contribution. Reusing one's own spell is not treated as stealing, but repetition does not automatically earn a high Creativity score. Preserve author identity from the original submission rather than the card's current owner; signed links between a player's wallets can establish self-reuse without claiming that wallet identity proves real-world authorship.

Keep spell text private in the worker's storage before acceptance and expose only a salted commitment bound to the submitter, card and request context onchain. Verify the worker's received text against that commitment. Publish the spell with its completed result and retain verifiable publication records. This prevents an observer from reading a pending transaction's spell and submitting the same visible text first; already public spells remain searchable for the originality check.

Persist the originality finding, applied cap, comparison cutoff and evidence-report commitment with the final grading record. Store source request references, matched excerpts and the concise assessment durably in the report so the player can understand a reduction. Validate the cap when recording the final four grades onchain. Once a result is finalized, retries must not create alternate scores; an originality-service failure leaves the existing paid job pending for recovery. It does not introduce a refund, extra charge, transfer restriction or fifth grading category.

Calibrate the cap and evidence rules against examples before launch: distinctive verbatim copies, paraphrases, translations, harmless short overlaps, independent similar ideas, substantial remixes, self-reuse, wallet changes, ownership transfers, concurrent requests and attempts to inject grading instructions. The automated finding is a game-scoring assessment supported by cited examples, not proof of theft or a legal authorship determination.

Persist request and portal-round identity, all four grades, grader identity, policy/version information and artwork references/hashes onchain. Store full spells, images and associated reports durably with matching commitments. Publish the completed artwork and its grades together, and keep history append-only through normal application methods.

The current artwork displays the scores for that exact version. Do not pair a new image with a better score from a different historical attempt. Provide access to prior results and the original image.

Portals themselves are Yunipals TCG cards. Each kind uses a finished portrait 2:3 card image matching the existing TCG's rounded lavender frame, Yunipals header/logo and bottom nameplate; Rainbow uses the nameplate RAINBOW PORTAL. The card's center contains the portal artwork. Every NFT of a kind references the same finished card image, with individual gates in onchain metadata and Card type set to Portal. Graded monster artwork is specific to the individual monster card and version. Do not overwrite the existing shared TCG variant assets. Metadata renders authoritative onchain traits and grades, and the NFT emits ERC-4906 metadata-update events for changed card metadata.

**Grading cases / slabs**

Each portal kind should give the completed monster card a distinct physical-style digital grading slab. This is the visual case around the card, separate from its numerical grading rubric. Rainbow's first case uses a clear beveled shell, pearlescent label, rainbow foil edging/seal and the intact finished card inside its recessed holder. The label shows the spell title, actual NFT/artwork-version identity, four recorded 1–100 grades and their arithmetic mean out of 100. Preview studies are explicitly labelled STUDY and must not invent minted NFT numbers.

Use a shared deterministic renderer and a versioned per-kind visual theme registry so the app and preview match. The case never changes grades, the raw edited artwork or gate traits. Continue using the raw latest completed card image as AI input on regrading; keep case typography and prior scores outside that input. The preview provides full SVG/PNG composites, while actual completed card-history entries use their onchain NFT/version and final component scores. Composite publication as the NFT metadata display image is a release integration step; retain separate raw-art references and byte commitments for generation and history.

**8. Implementation sequence and validation**

1. Extend the TCG collection and mint engine with sequence/timestamp storage and getters. Verify storage compatibility, batch numbering, originals, historical imports, actual mint times, transfers, burns and unchanged daily-claim behavior. Backfill directly and retire the import capability.
2. Build the upgradeable portal collection, kind configuration and VRF-backed admin mint flow. Verify role controls, ID ranges, the lifetime cap including reservations, committed recipients, unbiased gate draws, zero-valued seeds, retries and fixed gate metadata.
3. Build the gate checker and global activation registry using the pack VRF implementation. Verify every trait mapping, originalOnly precedence, wrapping at 263/0, all range lengths, strict timing boundaries, snapshot stability, exclusion of the previous portal, concurrent requests, stale callbacks and same-result recovery.
4. Build paid admission, per-portal USDC balances, atomic owner-only burn-to-claim, grading records and versioned artwork references. Verify exact USDC amounts and backed liabilities, balance transfer with NFT ownership, quote changes, unauthorized/operator claims, failed payouts, reentrancy, duplicate claims, burns overlapping admissions and VRF requests, no ID/cap reuse, and zero/one-live-portal behavior. Retain tests for card ownership at submission, transfer during processing, a single pending job, no duplicate charges/finalizations, continued processing after rotation or portal redemption, and burned-card history without reminting.
5. Add indexing, public metadata, the active-portal countdown and entry form, grading history, and admin kind/airdrop/pricing controls. Add the durable generation/grading worker, committed private spell uploads, the published-spell archive, similarity retrieval, originality assessment, versioned penalty enforcement and bounded recovery controls. Show a player's copying-penalty reason and supporting prior attempts with the completed grade. Validate false positives, paraphrases, publication cutoffs, model cost and unchanged retry/payment semantics. Keep API data consistent with the contract's active-window and pending/completed state.

   Extend the API and owner UI with per-portal balances, live supply and burn-to-claim; replace the old portal-wallet payment setting in contracts, ABIs, setup scripts, environment examples and admin controls. Update the explanatory diagram to match the new payment flow.

6. Exercise the full flow on Base Sepolia: mint Rainbow portals, rotate to one, submit a matching card and spell for 0.99 USDC, verify the AI transfer, portal balance and separate 0.50 USDC competition reserve, transfer the pending card, close the portal's window, finish grading for the new owner, and submit another spell using the latest completed artwork through a later eligible portal. Transfer a funded portal, redeem it as its new owner, verify the exact USDC payout and reduced live supply, and verify that later selections cannot activate it. Verify that an entry mined after its window closes is rejected and portal redemption does not prevent already accepted jobs from completing.
7. Prepare the production upgrades, direct backfill and deployment transactions from the verified current stack, and verify deployed sources and resulting state. Follow the operator's untracked deployment instructions and verify the target environment before production indexer/runtime changes.

**9. Inputs to supply before launch**

Launch configuration includes the AI payout wallet, initial Rainbow airdrop quantity and recipients, deployed contract/admin/grader addresses, the verified USDC and VRF network configuration, the Rainbow artwork, and AI provider/model credentials and operating configuration. Reuse already supplied operator settings from private configuration; a fixed portal payout wallet is no longer needed. Validate the proposed models, originality-penalty cap, rubric and operating costs during implementation; check credentials without printing their values.

This plan records the agreed behavior and implementation sequence. The implementation now includes separate shared Rainbow collection artwork; explanatory illustrations remain illustrative. Public-network deployments, production upgrades, backfill and service activation are release steps described in the runbook.

**10. 111-entry grading competition**

Requested on 10 November 2026: add a third payment allocation of 0.50 USDC per grading to a competition reward contract. Each non-overlapping group of 111 gradings awards its pool to its three highest-scoring entries. Custody, ranking and payouts are verifiable onchain. Updated on 11 November 2026: the user selected permissionless resolution by winners or any other caller; competition settlement requires neither Chainlink nor a server worker. The separate portal-selection VRF remains unchanged. Implemented on 11 November 2026. New admissions use the competition quote and 0.99 USDC total after the admin binds the dedicated pool. Legacy admissions remain available only before binding, and legacy paid jobs keep their original terms. Production deployment and activation are separate release steps.

**Economics and competition rules**

| Rainbow payment allocation      |  USDC | Destination                                                                |
| ------------------------------- | ----: | -------------------------------------------------------------------------- |
| Image generation and grading    | 0.245 | Existing configured AI wallet                                              |
| Portal earnings                 | 0.245 | Existing balance attached to the specific portal NFT; owner burns to claim |
| Competition contribution        | 0.500 | Dedicated onchain competition reward contract                              |
| Total after competition binding | 0.990 | Collected atomically at admission                                          |

Use six-decimal integer amounts: 245,000 + 245,000 + 500,000 = 990,000 units. A fully funded 111-entry batch contains 55,500,000 units, or 55.50 USDC, of prize money. The user confirmed shares of 50% / 30% / 20% on 11 November 2026: 27.75, 16.65 and 11.10 USDC. Preserve the entire competition contribution for prizes; the resolving caller pays transaction gas separately. Any future sponsored execution must use a separate operating budget. Do not silently deduct service fees or caller incentives from the advertised pool.

Implementation defaults:

- One global competition across portal kinds on the same chain and approved TCG collection. Only Rainbow exists initially. The batch spans multiple portal NFTs and multiple 11-minute activation slots; a portal rotation does not reset it.
- One entry per newly paid grading request. Unlimited regrading remains available, with the existing one-pending-request-per-card restriction. An earlier grade cannot be entered again without a new paid attempt.
- The three winning entries need not have three different wallets or card IDs. A player can win multiple places through separately paid attempts. A unique-wallet rule would not establish unique people and is not part of this proposal.
- Pay the recorded submitting wallet, captured at admission. Selling or burning either the monster card or portal afterward does not transfer or cancel this request's competition rights. This differs deliberately from the portal owner's burn-to-claim earnings.
- Rank by the sum of final Creativity, Harmony, Craft and Impact, from 4 through 400. This is exactly the same ordering as their equal-weight mean, without display rounding. Use the final scores after all grading-case ceilings and originality penalties. No second AI judging pass or score replacement takes place at settlement.
- Break equal totals by the smaller competition entry ordinal, assigned in onchain admission order. This is public and deterministic, but favors earlier inclusion; it is not a random tiebreak. Do not use grading completion time or manipulable block randomness. A VRF tiebreak would be an optional change with additional funding and asynchronous state.
- A copying finding keeps its existing Creativity penalty. It does not introduce a separate competition disqualification unless explicitly requested.

**Batch membership and completion**

Individual grading must proceed promptly after each accepted submission. Generate and grade each card independently, publish its completed artwork and grades as soon as that request is finalized, and make its history available without waiting for other competition entries. Image generation, AI grading, queue processing and onchain confirmation still take time; the competition adds no requirement to wait for 111 requests before starting or displaying a grade. Only the prize decision waits for the complete batch. Include this distinction in the player UI.

Updated on 11 November 2026: the user selected sequential themed batches (option 1), replacing overlapping admissions. Assign membership in successful paid admission order. Submissions #1–#111 enter competition 1; #112 starts competition 2 only after all 111 results exist and their winners' shared theme is published. Every result still appears as soon as its own request completes. Competition 1 can pay as soon as all its results exist, independently of theme publication. Completion order never changes membership:

1. Give each new competition-funded request a monotonically increasing entry ordinal. Legacy requests and earlier preview/test examples have no competition entry. For a one-based ordinal, `batchId = (ordinal - 1) / 111 + 1`, using integer division.
2. Freeze the batch's rules when its first entry is admitted. Entries 1–111 belong to batch 1, 112–222 to batch 2, and so on. Never move a paid entry, reuse an ordinal or make overlapping rolling windows.
3. Transfer its 0.50 USDC directly into the competition contract during the same admission transaction and record its batch, request identity, submitter and exact contribution.
4. When the accepted grading is finalized, record its final scores for that same batch exactly once. Maintain a bounded top-three list using the specified comparator; no unbounded historical scan is needed at settlement.
5. Mark a batch ready only after it has 111 funded entries and all 111 results are recorded. The last required completion triggers readiness; the highest scorer does not have to trigger anything. Pause new admissions after the 111th entry. Extract and publish the next theme from the final top three before reopening, without waiting for prize delivery.
6. Emit a readiness event for the app, public callers and any optional future automation. Freeze winners, shares and batch liabilities upon settlement. Late callbacks, replayed calls and later regrades cannot alter that result.

This prevents the grading worker from selecting batch membership by reordering completions. It does not prevent that trusted worker from withholding or fabricating grades. A stalled request now also delays admissions to the next batch, consistent with the chosen sequential flow and existing no-timeout/no-refund rule. Completed earlier batches can settle independently. An incompletely filled batch retains its contributions until it fills. There is no automatic sweep, expiry, rollover or cancellation of a partially filled batch.

**Contracts and preserved request bindings**

Add a dedicated `PortalGradingCompetition` contract responsible for funded entries, batch membership, immutable recorded results through ordinary methods, top-three ranking, settlement and prize accounting. Keep this logic outside `PortalGrading` to limit bytecode growth and separate competition reserves from portal-owner earnings.

State and interfaces:

- A fixed batch rule set: grading source, payment token, contribution, batch size, ranking/tie rules, shares, eligible grading-policy hash and competition rules hash.
- Per-entry records keyed by grading contract plus request ID, including admission ordinal, batch, submitter, contribution, completion flag and final score sum. Bind each completion to its admitted request and accepted grading policy.
- Per-batch funded/completed counts, members, top-three entries, reserved prize total, readiness and settlement state. Record each winner's entitlement and paid status independently.
- An authenticated admission/result integration from the approved grading contract, plus permissionless `recordCompleted(requestId)` recovery that reads an already finalized onchain result and cannot accept caller-supplied scores or payees. Idempotence makes normal completion and recovery converge on one result.
- Public getters for rules, entries, members, leaders, unsettled ready batches and prize status. Emit admission, contribution, result-recorded, batch-ready, batch-settled and prize-paid events with stable request/batch identities.
- A permissionless `settle(batchId)` and an individual `payPrize(batchId, rank)` callable by anyone. The destination is always the recorded winner; callers cannot choose a recipient or change amounts.

Extend the paid admission path to validate all three amounts, the competition contract and expected rules/version before collecting USDC. Preserve the existing card gates, strict 660-second window, stale-quote protection and maximum-fee limit. Use the existing grading-contract spender allowance where practical; users should not need an unrelated approval solely to route the third component. Any failed transfer or registration reverts the entire admission and all three payment legs. A zero-value or unbacked request must not become an eligible competition entry.

Do not expand the existing nested `PaymentPolicy` struct inside stored `Request` records in place: that can change storage offsets and the existing `requestBinding` ABI encoding. Append separate competition configuration and per-request snapshots using reviewed storage-gap slots or a dedicated namespace. Preserve old request bindings byte-for-byte; define a versioned additional commitment for new competition terms. Update new admission/quote interfaces so an old client cannot bypass the competition contribution or unknowingly accept different terms. Existing fee setters must not reset, disable or redirect a competition allocation by omission.

Activation establishes an explicit first eligible request/entry boundary. Requests admitted earlier retain their original fees, binding and processing path, with no retroactive charge or prize entitlement. New result integration must preserve completion after card transfers, portal burns and monster burns. The worker can continue finalizing legacy requests while competition-funded requests use their captured terms.

Pool invariants: contract USDC covers every unallocated batch contribution plus every unpaid settled prize; portal earnings are backed separately. Count actual accepted deposits, not unsolicited token transfers. Each entry funds exactly one batch, each result counts once, and each prize pays at most once. Donations must not silently change the advertised batch pot or future winners. There is no ordinary admin withdrawal of reserved competition funds, no borrowing from another batch and no access through portal burn-and-claim.

Settlement records all three entitlements before making any external token transfer. Then attempt the three fixed payouts independently. A failed recipient transfer remains owed and retryable without reverting successful payments or blocking another winner or batch. Do not report a failed transfer as a paid prize. Use reentrancy guards and checks-effects-interactions; allocate any integer remainder deterministically so the complete batch pool belongs to winners. With the fixed amount and 50/30/20 split there is no rounding residue.

**Permissionless resolution and the decentralization boundary**

Updated on 11 November 2026: competition settlement uses only information already recorded onchain, so no oracle or server worker is required. Once all 111 assigned results exist, any winner or any other wallet can call `settle(batchId)` through the app. One call records settlement and attempts all three fixed payouts. The caller pays network gas; it receives no special reward, cannot redirect another winner's prize, and does not need admin or grader permission. Each winner can retry its unpaid prize through `payPrize(batchId, rank)`; anyone can also submit that same retry for the recorded payee.

Show ready batches and the public settlement button as the primary flow. Keep the competition-number form usable during leaderboard/API outages. A wallet transaction is still required: a ready batch remains unpaid until someone resolves it. Do not require a designated winner to be online, impose a settlement expiry, or add a caller fee to the prize pool.

The existing CRE workflow and authenticated receiver can remain as an optional future integration. Enabling an independent keeper later means calling the same contract methods; winners, prize amounts and existing deposits need no migration. A keeper racing a public caller cannot pay twice. CRE deployment approval and a server settlement worker are no longer launch requirements. The existing Chainlink VRF used for random portal selection and minting remains separate and unchanged.

The initial scope keeps the current AI grader; decentralizing actual grading is later work. The authorized grader still submits subjective AI scores, and the contracts remain UUPS-upgradeable under admin authority as requested. Onchain settlement does not independently verify artistic quality or guarantee that every grading completes. Describe this as permissionless, onchain competition settlement using attested AI grades. Keep upgrade authority and the grading source visible when assessing the system's trust assumptions.

Preserve the upgradeability requirement and review a timelock/multisig upgrade policy before real prize deposits. Future grading decentralization needs its own score-attestation and governance design; it is outside this competition-settlement change.

**Fairness and policy changes**

Freeze the accepted grading model/rubric policy, competition contribution and prize/ranking rules for each funded batch. Existing per-kind AI/portal price changes continue to apply only to new requests; those two allocations do not change the competition pot. Queue policy changes for the next batch before its first admission, retain the old worker policy for already funded entries, and reject stale quotes when the next batch's policy differs. Keep updates to new portal-kind profiles at a batch boundary. The initial 0.50 contribution is the same for all eligible kinds; changing that in future is a new competition-rules version, not a retroactive repricing.

Dedicated per-kind rubrics must use a comparable four-category scale before sharing a global prize pool; test whether one kind systematically produces easier high scores. Do not normalize historical scores offchain at payout time or silently combine experimental preview policies with live prize entries. Before real prizes, review adversarial prompts, copying/self-reuse, repeat attempts, grader-key compromise and a player occupying all three places. The existing preview studies are useful calibration material, not funded entries or proof that a model cannot be exploited.

**Application and implementation work**

1. Record the exact versioned competition rule set using the confirmed fixed admission-order batches, 50% / 30% / 20% prize split and current AI grader. Review the proposed global scope, beneficiary and repeat-entry defaults while preserving prompt individual result publication.
2. Implement the separate competition contract and admission/completion integration. Extend storage-layout checks, request commitments, economic-version checks, deployment/setup scripts, shared ABI/types, and six-decimal fee helpers. Preserve the previous fee and request behavior for legacy jobs.
3. Extend the public ledger and API with batch membership, paid/completed counts, top-three standing, fixed rules, pool liabilities and individual payouts. The chain remains authoritative; indexer replay must rebuild the same results after a reorg.
4. Add the third fee line and 0.99 USDC Rainbow total to quote, approval and review screens. Explain eligibility, prize beneficiary, repeat entries and tie rules before payment. Display both submitted and completed counts, such as `111 entered / 108 graded`, projected prizes, waiting/ready/settled states, and history. Provide permissionless settlement and unpaid-prize retry controls. Preserve all current slab and artwork history.
5. Make public resolution the primary app flow and rehearse a winner or unrelated caller resolving a ready batch, exact payouts and unpaid-prize retries. Retain the already implemented CRE adapter only as an optional integration.
6. Validate locally and on Base Sepolia, then prepare concrete release configuration and transactions. No production reward deposits or fee activation are part of this planning step.

Required validation includes immediate per-request grade/artwork visibility while its batch is incomplete, 110/111/112 boundaries, sequential admission with independently outstanding payouts, out-of-order completion within a batch, ties in every rank including third place, all-equal scores, the same wallet/card winning multiple places, final copying-capped scores, no duplicate entry/result/payout, all three payment legs rolling back, stale quotes, unsolicited deposits, exact 55.50 accounting, failed recipient isolation, reentrancy, replayed/forged/stale CRE reports, direct settlement without Chainlink, pending jobs after sale/burn, indefinite incomplete batches, and legacy pending requests across upgrade. Add fuzz/invariant tests for liabilities and top-three ordering, storage and bytecode-size checks, and a full browser-to-contract rehearsal. Use deterministic grading fixtures for the 111-entry accounting tests and a small representative live-AI sample for compatibility; generating 111 paid images is not needed to prove batch arithmetic.

**Confirmed decisions — 11 November 2026**

1. Individual grades: process and display each result as soon as its own job completes; never wait for 111 entries to begin grading or reveal an individual result.
2. Prize split confirmed: 50% / 30% / 20%.
3. Decentralization scope confirmed: keep the current AI grader and decentralize competition settlement; decentralize actual grading later.
4. Batch membership confirmed: fixed groups of 111 successful paid submissions in admission order. Submissions #1–#111 form competition 1; #112 starts competition 2 after all previous grades and the next theme are available. Prize settlement waits for all 111 results in its assigned batch, but never waits for the theme.
5. Settlement uses onchain results directly. Winners or any other caller can resolve ready batches; Chainlink CRE and server automation are optional. Portal randomness still uses Chainlink VRF.

The competition decisions above are resolved. The implementation includes these decisions and the defaults above. The existing private artwork/slab preview is unchanged.

**Implementation and verification — 11 November 2026**

The dedicated UUPS competition pool, grading admission/result integration, CRE receiver and pinned SDK workflow are implemented. Admission uses the original grading spender and a separate quote for the pool/rules. Separate storage preserves historical request layouts and bindings. A self-only admission entry point keeps a single compiled payment implementation, and shared one-time catalog validation keeps grading within EIP-170. Completion reserves enough gas for its bounded notification so gas estimation cannot silently choose an underfunded hook; a genuine hook failure is recorded and recoverable through permissionless `recordCompleted(requestId)`.

The app shows the third fee, 0.99 USDC total, funded/completed counts, provisional leaders, finalized winners and paid/unpaid prizes. Its manual competition-number settlement form derives the pool directly from the configured grading proxy and can work during leaderboard/API outages. The event ledger indexes and reconciles entries, scores, winners and payments atomically, including reorg replay and payout reconciliation.

Validation covers the full Solidity suite, storage compatibility and runtime size, backend ledger tests, frontend/indexer type checks and build, a 112-entry local browser rehearsal and official SDK WASM compilation. The current browser rehearsal blocks #112 at the boundary, completes #111, recovers provider/publication failures, publishes the saved winner-derived theme and then admits #112. The public settlement button pays 27.75 / 16.65 / 11.10 USDC while retaining batch 2's 0.50 USDC. These are deterministic local grades, not 112 provider-generated images. See the implementation status for exact results and the [CRE workflow guide](../ops/portals-competition-cre/README.md) for optional deployment configuration.

The historical V1 Base Sepolia fixture completed 112 grades with overlapping admissions and preserved legacy grading bindings; that pool remains unpaid. A separate eleven-entry live-AI Base Sepolia run subsequently verified real artwork/grades and exact permissionless payouts. Neither historical run includes the new sequential theme contracts. Reconcile the private deployment/setup records before reviewed application activation; the user chose mainnet for remaining controlled live acceptance. Live CRE DON delivery is unverified and optional. Current engineering status and prerequisites are recorded in the implementation status and runtime guide.

**11. Themes from the previous winners — sequential batches**

Confirmed option 1 on 11 November 2026. Batch 1 starts with the fixed **Open imagination** brief. After a batch's 111th admission, entry pauses globally until all its grades are recorded and a theme derived jointly from its three winning spells is published for the next batch. Individual results continue normally. The 11-minute portal clock continues independently; a valid submission requires both an accepting portal window and an open themed batch. Waiting admissions collect no fees.

The existing AI service uses the versioned theme policy to extract a short title and broad creative brief. All three spells contribute equally, including when one wallet wins multiple places. It treats their text as untrusted source material, abstracts ideas rather than copying distinctive wording, and explains each winner's contribution. The brief must work across portal kinds; Rainbow's automatic recoloring remains a separate constraint. The first extraction requires no additional images or embeddings.

Store the title, brief and their commitment onchain before accepting the next entry. Bind publication to chain, pool, batch, previous winning entry/request IDs, evidence artifact and extraction policy. Only the authorized theme publisher can submit it; ordinary methods cannot overwrite a published theme. The worker verifies the winners' salted spell commitments and retains the exact sources, model response, usage and policy in a content-addressed report. The API releases that evidence only after confirmed publication. AI extraction remains trusted, as does the existing grader; permissionless prize settlement requires neither AI theme completion nor a server transaction.

The v4 grading policy assesses theme interpretation under **Harmony**, with the existing four-category scale and equal competition weights. A partial interpretation caps Harmony at 69; a missed theme caps it at 39. This check imposes no additional ceiling on Creativity, Craft or Impact. Shared theme ideas and wording are allowed in originality checks; copying a winner's distinctive spell remains subject to the existing Creativity penalty. The theme guides the player's spell and visual assessment; it is not silently inserted into the image-edit prompt. Legacy v1/v2/v3 policies and accepted requests retain their original behavior.

Quotes pin the upcoming batch and theme using the pool's `admissionHash`; a stale quote cannot drift into another challenge. The existing three-argument admission ABI is retained, with its final commitment now carrying that hash. Request storage and historical request bindings stay unchanged. Theme state consumes two reserved pool storage slots, with boundary-only activation available for an older proxy. Fresh pools enable themes and seed batch 1 during initialization.

The durable theme worker leases one extraction per winner-set/policy, checkpoints the response before publication and reuses it after a provider, transaction or process interruption. Missing completion notifications are recovered in bounded increments. Failed or dropped publication transactions retry the same evidence; there is no automatic reroll, timeout, refund or fallback theme. Show separate UI states for finishing grades and preparing the next theme, followed by the immutable brief before payment. An outage can delay the next batch; prior ready prizes remain callable throughout.
